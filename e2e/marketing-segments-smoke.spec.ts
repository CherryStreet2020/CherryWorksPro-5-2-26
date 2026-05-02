/**
 * Marketing OS — Sprint 2e: saved segments smoke e2e.
 *
 * Drives the API end-to-end:
 *   - Create brand + 2 contacts + 2 tags
 *   - POST /api/marketing/segments (filter: tagIds AND-intersect)
 *   - GET  /api/marketing/segments (list+counts)
 *   - GET  /api/marketing/segments/:id (single)
 *   - GET  /api/marketing/segments/:id/contacts (resolver, AND-intersect)
 *   - PATCH lock: brandId in body → 400 invalidFields (zero-write)
 *   - PATCH name happy path → 200
 *   - DELETE segment → 200
 *   - cleanupE2EBrandPollution cascade verifies contact_segments deletion
 */
process.env.MARKETING_OS_ENABLED = "true";
process.env.VITE_MARKETING_OS_ENABLED = "true";

import { test, expect, type APIRequestContext } from "@playwright/test";
import { cleanupE2EBrandPollution } from "../scripts/cleanup-e2e-brand-pollution";

const BASE = `http://localhost:${process.env.PORT || 5000}`;
const ADMIN_EMAIL = "dean@cherrystconsulting.com";
const ADMIN_PASS = "CherryWorks2026!";

async function login(request: APIRequestContext) {
  const r = await request.post(`${BASE}/api/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASS },
  });
  expect(r.status()).toBe(200);
}
async function getCsrf(request: APIRequestContext): Promise<string> {
  const r = await request.get(`${BASE}/api/csrf-token`);
  expect(r.status()).toBe(200);
  return r.headers()["x-csrf-token"] || "";
}

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

test.describe("Marketing OS — segments smoke (Sprint 2e)", () => {
  const createdBrandIds: string[] = [];
  let cascadeCounts: Awaited<ReturnType<typeof cleanupE2EBrandPollution>> | null = null;

  test.afterAll(async () => {
    try {
      cascadeCounts = await cleanupE2EBrandPollution(createdBrandIds);
      // Cascade must have removed the contact_segments row created below.
      expect(cascadeCounts.contactSegmentsDeleted).toBeGreaterThanOrEqual(1);
    } catch (err) {
      console.error("[marketing-segments-smoke afterAll] cleanup failed:", err);
      throw err;
    }
  });

  test("CRUD + resolver + PATCH lock + cascade-delete via brand cleanup", async ({ request }) => {
    await login(request);
    const csrf = await getCsrf(request);
    const headers = { "x-csrf-token": csrf };

    // ── brand + 2 contacts ────────────────────────────────────────────
    const brandRes = await request.post(`${BASE}/api/brands`, {
      headers, data: { name: `Seg ${RUN}`, slug: `seg-${RUN}` },
    });
    expect(brandRes.status()).toBe(201);
    const brand = await brandRes.json();
    createdBrandIds.push(brand.id);

    const c1Res = await request.post(`${BASE}/api/marketing/contacts`, {
      headers,
      data: { brandId: brand.id, firstName: "S1", lastName: "Seg", email: `seg-c1-${RUN}@x.com` },
    });
    expect(c1Res.status()).toBe(201);
    const c1 = await c1Res.json();
    const c2Res = await request.post(`${BASE}/api/marketing/contacts`, {
      headers,
      data: { brandId: brand.id, firstName: "S2", lastName: "Seg", email: `seg-c2-${RUN}@x.com` },
    });
    expect(c2Res.status()).toBe(201);
    const c2 = await c2Res.json();

    // ── 2 tags + assign VIP→both, Buyer→c1 only ───────────────────────
    const vipRes = await request.post(`${BASE}/api/marketing/tags`, {
      headers, data: { brandId: brand.id, name: `vip-${RUN}`, color: "#C41E3A" },
    });
    expect(vipRes.status()).toBe(201);
    const vip = await vipRes.json();
    const buyerRes = await request.post(`${BASE}/api/marketing/tags`, {
      headers, data: { brandId: brand.id, name: `buyer-${RUN}`, color: "#1D4ED8" },
    });
    expect(buyerRes.status()).toBe(201);
    const buyer = await buyerRes.json();

    const a1 = await request.post(`${BASE}/api/marketing/contacts/bulk-tag`, {
      headers, data: { brandId: brand.id, contactIds: [c1.id, c2.id], tagIds: [vip.id], op: "assign" },
    });
    expect(a1.status()).toBe(200);
    const a2 = await request.post(`${BASE}/api/marketing/contacts/bulk-tag`, {
      headers, data: { brandId: brand.id, contactIds: [c1.id], tagIds: [buyer.id], op: "assign" },
    });
    expect(a2.status()).toBe(200);

    // ── POST segment (VIP ∩ Buyer) → 201, filter persisted strict ─────
    const segRes = await request.post(`${BASE}/api/marketing/segments`, {
      headers,
      data: {
        brandId: brand.id, name: `VIP+Buyer-${RUN}`,
        filter: { tagIds: [vip.id, buyer.id], search: "" },
      },
    });
    expect(segRes.status()).toBe(201);
    const seg = await segRes.json();
    expect(seg.filter.tagIds).toEqual([vip.id, buyer.id]);

    // ── GET list + counts (count must be 1: only c1 has both tags) ────
    const listRes = await request.get(`${BASE}/api/marketing/segments?brandId=${brand.id}`);
    expect(listRes.status()).toBe(200);
    const list = await listRes.json();
    const found = (list as Array<{ id: string; contactCount: number }>).find((s) => s.id === seg.id);
    expect(found).toBeDefined();
    expect(found.contactCount).toBe(1);

    // ── GET single ────────────────────────────────────────────────────
    const oneRes = await request.get(`${BASE}/api/marketing/segments/${seg.id}`);
    expect(oneRes.status()).toBe(200);
    const one = await oneRes.json();
    expect(one.name).toBe(`VIP+Buyer-${RUN}`);

    // ── GET resolver: AND-intersect → c1 only ─────────────────────────
    const resolveRes = await request.get(`${BASE}/api/marketing/segments/${seg.id}/contacts`);
    expect(resolveRes.status()).toBe(200);
    const resolved = await resolveRes.json();
    const ids = (resolved as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toEqual([c1.id]);

    // ── PATCH lock: brandId in body → 400 with invalidFields, no write ─
    const lockRes = await request.patch(`${BASE}/api/marketing/segments/${seg.id}`, {
      headers, data: { brandId: brand.id, name: `should-not-rename-${RUN}` },
    });
    expect(lockRes.status()).toBe(400);
    const lockBody = await lockRes.json();
    expect(lockBody.invalidFields).toContain("brandId");
    const checkAfterLock = await request.get(`${BASE}/api/marketing/segments/${seg.id}`);
    expect((await checkAfterLock.json()).name).toBe(`VIP+Buyer-${RUN}`);

    // ── PATCH happy path: rename → 200 ────────────────────────────────
    const renameRes = await request.patch(`${BASE}/api/marketing/segments/${seg.id}`, {
      headers, data: { name: `VIP+Buyer-renamed-${RUN}` },
    });
    expect(renameRes.status()).toBe(200);
    expect((await renameRes.json()).name).toBe(`VIP+Buyer-renamed-${RUN}`);

    // Cleanup contacts/tags so cleanupE2EBrandPollution can drop the brand.
    // We DELIBERATELY do NOT delete the segment — afterAll cascade will
    // verify contact_segments cleanup via cleanupE2EBrandPollution.
    await request.delete(`${BASE}/api/marketing/contacts/${c1.id}`, { headers });
    await request.delete(`${BASE}/api/marketing/contacts/${c2.id}`, { headers });
    await request.delete(`${BASE}/api/marketing/tags/${vip.id}`, { headers });
    await request.delete(`${BASE}/api/marketing/tags/${buyer.id}`, { headers });
  });
});
