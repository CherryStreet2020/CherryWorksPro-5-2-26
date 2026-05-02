/**
 * Marketing OS — Sprint 2d: tags smoke e2e.
 *
 * Drives the API end-to-end:
 *   - Create brand + 2 contacts + 2 tags
 *   - listTagsByBrandWithCounts returns enriched rows
 *   - bulk-tag op=assign assigns; the contacts list ?tagIds= filter narrows
 *   - bulk-tag op=unassign removes; cross-brand tagId on bulk-tag → 400
 *   - PATCH rename/recolor; DELETE tag
 *
 * Mirrors the brands-smoke + marketing-contacts-smoke patterns
 * (createdBrandIds → cleanupE2EBrandPollution in afterAll).
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

test.describe("Marketing OS — tags smoke (Sprint 2d)", () => {
  const createdBrandIds: string[] = [];

  test.afterAll(async () => {
    try {
      await cleanupE2EBrandPollution(createdBrandIds);
    } catch (err) {
      console.error("[marketing-tags-smoke afterAll] cleanup failed:", err);
    }
  });

  test("CRUD + bulk-tag + tagIds filter + cross-brand 400", async ({ request }) => {
    await login(request);
    const csrf = await getCsrf(request);
    const headers = { "x-csrf-token": csrf };

    // ── brand A + brand B (cross-brand probe) ──────────────────────────
    const brandARes = await request.post(`${BASE}/api/brands`, {
      headers,
      data: { name: `Tags A ${RUN}`, slug: `tags-a-${RUN}` },
    });
    expect(brandARes.status()).toBe(201);
    const brandA = await brandARes.json();
    createdBrandIds.push(brandA.id);

    const brandBRes = await request.post(`${BASE}/api/brands`, {
      headers,
      data: { name: `Tags B ${RUN}`, slug: `tags-b-${RUN}` },
    });
    expect(brandBRes.status()).toBe(201);
    const brandB = await brandBRes.json();
    createdBrandIds.push(brandB.id);

    // ── two contacts in brand A ────────────────────────────────────────
    const c1Res = await request.post(`${BASE}/api/marketing/contacts`, {
      headers,
      data: { brandId: brandA.id, firstName: "C1", lastName: "T", email: `tag-c1-${RUN}@x.com` },
    });
    expect(c1Res.status()).toBe(201);
    const c1 = await c1Res.json();

    const c2Res = await request.post(`${BASE}/api/marketing/contacts`, {
      headers,
      data: { brandId: brandA.id, firstName: "C2", lastName: "T", email: `tag-c2-${RUN}@x.com` },
    });
    expect(c2Res.status()).toBe(201);
    const c2 = await c2Res.json();

    // ── two tags in brand A, one in brand B (for cross-brand probe) ────
    const tagARes = await request.post(`${BASE}/api/marketing/tags`, {
      headers,
      data: { brandId: brandA.id, name: `vip-${RUN}`, color: "#C41E3A" },
    });
    expect(tagARes.status()).toBe(201);
    const tagA = await tagARes.json();

    const tagA2Res = await request.post(`${BASE}/api/marketing/tags`, {
      headers,
      data: { brandId: brandA.id, name: `prospect-${RUN}`, color: "#1D4ED8" },
    });
    expect(tagA2Res.status()).toBe(201);
    const tagA2 = await tagA2Res.json();

    const tagBRes = await request.post(`${BASE}/api/marketing/tags`, {
      headers,
      data: { brandId: brandB.id, name: `cross-${RUN}`, color: "#15803D" },
    });
    expect(tagBRes.status()).toBe(201);
    const tagB = await tagBRes.json();

    // ── listTagsByBrandWithCounts ──────────────────────────────────────
    const list1 = await request.get(`${BASE}/api/marketing/tags?brandId=${brandA.id}`);
    expect(list1.status()).toBe(200);
    const tagsA = await list1.json();
    const found = (tagsA as Array<{ id: string; contactCount: number; lastUsedAt: string | null }>).find(
      (t) => t.id === tagA.id,
    );
    expect(found).toBeDefined();
    expect(found.contactCount).toBe(0);
    expect(found.lastUsedAt).toBeNull();

    // ── bulk-tag op=assign ─────────────────────────────────────────────
    const bulkAssign = await request.post(`${BASE}/api/marketing/contacts/bulk-tag`, {
      headers,
      data: {
        brandId: brandA.id,
        contactIds: [c1.id, c2.id],
        tagIds: [tagA.id],
        op: "assign",
      },
    });
    expect(bulkAssign.status()).toBe(200);
    const assignBody = await bulkAssign.json();
    expect(assignBody.assigned).toBe(2);

    // ── tagIds filter on contacts list narrows result ──────────────────
    const filtered = await request.get(
      `${BASE}/api/marketing/contacts?brandId=${brandA.id}&tagIds=${tagA.id}`,
    );
    expect(filtered.status()).toBe(200);
    const filteredRows = await filtered.json();
    const ids = (filteredRows as Array<{ id: string }>).map((r) => r.id).sort();
    expect(ids).toEqual([c1.id, c2.id].sort());

    // ── cross-brand tagId on bulk-tag → 400 with invalidTagIds ─────────
    const crossBulk = await request.post(`${BASE}/api/marketing/contacts/bulk-tag`, {
      headers,
      data: {
        brandId: brandA.id,
        contactIds: [c1.id],
        tagIds: [tagB.id],
        op: "assign",
      },
    });
    expect(crossBulk.status()).toBe(400);
    const crossBody = await crossBulk.json();
    expect(crossBody.invalidTagIds).toContain(tagB.id);

    // ── cross-brand tagId on contacts list filter → 400 ────────────────
    const crossFilter = await request.get(
      `${BASE}/api/marketing/contacts?brandId=${brandA.id}&tagIds=${tagB.id}`,
    );
    expect(crossFilter.status()).toBe(400);

    // ── bulk-tag over the per-call cap (>20 tagIds) → 400 ──────────────
    const overCapTagIds = Array.from({ length: 21 }, () => crypto.randomUUID());
    const overCap = await request.post(`${BASE}/api/marketing/contacts/bulk-tag`, {
      headers,
      data: {
        brandId: brandA.id,
        contactIds: [c1.id],
        tagIds: overCapTagIds,
        op: "assign",
      },
    });
    expect(overCap.status()).toBe(400);

    // ── unassign one of the contacts ───────────────────────────────────
    const bulkUn = await request.post(`${BASE}/api/marketing/contacts/bulk-tag`, {
      headers,
      data: {
        brandId: brandA.id,
        contactIds: [c1.id],
        tagIds: [tagA.id],
        op: "unassign",
      },
    });
    expect(bulkUn.status()).toBe(200);
    const unBody = await bulkUn.json();
    expect(unBody.unassigned).toBe(1);

    // ── PATCH rename + recolor ─────────────────────────────────────────
    const patchRes = await request.patch(`${BASE}/api/marketing/tags/${tagA2.id}`, {
      headers,
      data: { name: `prospect2-${RUN}`, color: "#0F766E" },
    });
    expect(patchRes.status()).toBe(200);
    const patched = await patchRes.json();
    expect(patched.name).toBe(`prospect2-${RUN}`);
    expect(patched.color.toLowerCase()).toBe("#0f766e");

    // ── DELETE tag (assigned tag — assignment cascade tested in unit) ──
    const delRes = await request.delete(`${BASE}/api/marketing/tags/${tagA.id}`, { headers });
    expect(delRes.status()).toBe(200);

    // Cleanup contacts so cleanupE2EBrandPollution can drop the brand.
    await request.delete(`${BASE}/api/marketing/contacts/${c1.id}`, { headers });
    await request.delete(`${BASE}/api/marketing/contacts/${c2.id}`, { headers });
    await request.delete(`${BASE}/api/marketing/tags/${tagA2.id}`, { headers });
    await request.delete(`${BASE}/api/marketing/tags/${tagB.id}`, { headers });
  });
});
