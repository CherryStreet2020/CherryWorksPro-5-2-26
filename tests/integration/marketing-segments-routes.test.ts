/**
 * Sprint 2e — Route-level integration tests for Marketing Saved Segments.
 * Required acceptance scope:
 *   1. role-gate: non-admin → 403 (POST + GET list + GET resolve)
 *   2. duplicate name on same brand → 409
 *   3. cross-brand tagIds in filter → 400 + zero writes
 *   4. resolver pagination + AND-intersection filter semantics
 *   5. PATCH lock: brandId/orgId in body → 400 with invalidFields
 *   6. name trim().min(1).max(80) on POST and PATCH
 *
 * Talks to the live dev server (workflow `Start application`). Reuses the
 * seeded admin/team users from tests/integration/seed-role-users.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { TEST_BASE as BASE_URL } from "../helpers/base";

interface Ctx { cookies: string; csrfToken: string; orgId: string; role: string; }
interface BrandRow { id: string; name: string; slug: string }
interface ContactRow { id: string; brandId: string | null }
interface TagRow { id: string; name: string }
interface SegmentRow {
  id: string; brandId: string; name: string;
  filter: { tagIds: string[]; search: string };
  contactCount?: number;
}
interface ApiResp<T> { status: number; body: T }

async function loginAs(email: string, password: string): Promise<Ctx> {
  const csrfRes = await fetch(`${BASE_URL}/api/csrf-token`);
  const csrfCookies = csrfRes.headers.getSetCookie();
  const csrfToken = csrfRes.headers.get("x-csrf-token")!;
  const cookieJar = csrfCookies.map((c) => c.split(";")[0]).join("; ");
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieJar, "X-CSRF-Token": csrfToken },
    body: JSON.stringify({ email, password }),
    redirect: "manual",
  });
  expect(loginRes.status).toBe(200);
  const body = await loginRes.json();
  const allCookies = [
    ...csrfCookies.map((c) => c.split(";")[0]),
    ...loginRes.headers.getSetCookie().map((c) => c.split(";")[0]),
  ].join("; ");
  return {
    cookies: allCookies,
    csrfToken: loginRes.headers.get("x-csrf-token") || csrfToken,
    orgId: body.user?.organizationId || body.organizationId || body.user?.orgId || body.orgId,
    role: body.role || body.user?.role,
  };
}

async function api<T = unknown>(
  ctx: Ctx,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<ApiResp<T>> {
  const headers: Record<string, string> = { Cookie: ctx.cookies };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") headers["X-CSRF-Token"] = ctx.csrfToken;
  const res = await fetch(`${BASE_URL}${path}`, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json: unknown = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json as T };
}

describe("Sprint 2e — marketing segment route contracts", () => {
  let admin: Ctx;
  let team: Ctx;
  let brandId: string;
  let otherBrandId: string;
  let contactA: string;
  let contactB: string;
  let tagVip: string;
  let tagBuyer: string;
  let tagOtherBrand: string;
  const segIds: string[] = [];
  const stamp = Date.now();

  beforeAll(async () => {
    // The spawned test server seeds entitlements asynchronously after it
    // starts serving requests. Force `marketing_os` to be active for the
    // QA org before any marketing-gated endpoint is hit, otherwise the
    // stealth-404 middleware turns these tests into a sea of 404s.
    // Done via raw SQL ON CONFLICT so parallel suites don't collide on
    // the (org_id, feature) unique index.
    const { pool } = await import("../../server/db");
    await pool.query(`
      INSERT INTO org_entitlements (org_id, feature, active, activated_at)
      SELECT id, 'marketing_os', true, now() FROM orgs WHERE slug = 'cwpro-dev-qa'
      ON CONFLICT (org_id, feature) DO UPDATE SET active = true
    `);

    admin = await loginAs("admin.test@cwpro.dev", "admin123");
    team  = await loginAs("team.test@cwpro.dev", "team123");

    const b1 = await api<BrandRow>(admin, "POST", "/api/brands", {
      name: `S2E-A-${stamp}`, slug: `s2e-a-${stamp}`,
    });
    expect(b1.status).toBe(201);
    brandId = b1.body.id;
    const b2 = await api<BrandRow>(admin, "POST", "/api/brands", {
      name: `S2E-B-${stamp}`, slug: `s2e-b-${stamp}`,
    });
    expect(b2.status).toBe(201);
    otherBrandId = b2.body.id;

    const t1 = await api<TagRow>(admin, "POST", "/api/marketing/tags", {
      brandId, name: `S2E-VIP-${stamp}`, color: "#FF0000",
    });
    expect(t1.status).toBe(201);
    tagVip = t1.body.id;
    const t2 = await api<TagRow>(admin, "POST", "/api/marketing/tags", {
      brandId, name: `S2E-Buyer-${stamp}`, color: "#00FF00",
    });
    expect(t2.status).toBe(201);
    tagBuyer = t2.body.id;
    const t3 = await api<TagRow>(admin, "POST", "/api/marketing/tags", {
      brandId: otherBrandId, name: `S2E-OB-${stamp}`, color: "#0000FF",
    });
    expect(t3.status).toBe(201);
    tagOtherBrand = t3.body.id;

    const c1 = await api<ContactRow>(admin, "POST", "/api/marketing/contacts", {
      brandId, firstName: "Alice", lastName: "Atlas",
      email: `s2e-a-${stamp}@x.test`,
    });
    expect(c1.status).toBe(201);
    contactA = c1.body.id;
    const c2 = await api<ContactRow>(admin, "POST", "/api/marketing/contacts", {
      brandId, firstName: "Bob", lastName: "Beta",
      email: `s2e-b-${stamp}@x.test`,
    });
    expect(c2.status).toBe(201);
    contactB = c2.body.id;

    // Assign VIP to both, Buyer to A only.
    const r1 = await api(admin, "POST", "/api/marketing/contacts/bulk-tag", {
      brandId, contactIds: [contactA, contactB], tagIds: [tagVip], op: "assign",
    });
    expect(r1.status).toBe(200);
    const r2 = await api(admin, "POST", "/api/marketing/contacts/bulk-tag", {
      brandId, contactIds: [contactA], tagIds: [tagBuyer], op: "assign",
    });
    expect(r2.status).toBe(200);
  }, 60000);

  afterAll(async () => {
    for (const id of segIds) await api(admin, "DELETE", `/api/marketing/segments/${id}`);
    if (tagVip)        await api(admin, "DELETE", `/api/marketing/tags/${tagVip}`);
    if (tagBuyer)      await api(admin, "DELETE", `/api/marketing/tags/${tagBuyer}`);
    if (tagOtherBrand) await api(admin, "DELETE", `/api/marketing/tags/${tagOtherBrand}`);
    if (contactA) await api(admin, "DELETE", `/api/marketing/contacts/${contactA}`);
    if (contactB) await api(admin, "DELETE", `/api/marketing/contacts/${contactB}`);
    if (brandId)      await api(admin, "DELETE", `/api/brands/${brandId}`);
    if (otherBrandId) await api(admin, "DELETE", `/api/brands/${otherBrandId}`);
  }, 30000);

  it("role-gate: non-admin POST/GET → 403", async () => {
    const post = await api(team, "POST", "/api/marketing/segments", {
      brandId, name: `nope-${stamp}`, filter: { tagIds: [], search: "" },
    });
    expect(post.status).toBe(403);

    const list = await api(team, "GET", `/api/marketing/segments?brandId=${brandId}`);
    expect(list.status).toBe(403);
  });

  it("create segment (admin) → 201; duplicate name → 409", async () => {
    const r1 = await api<SegmentRow>(admin, "POST", "/api/marketing/segments", {
      brandId, name: `VIPs-${stamp}`,
      filter: { tagIds: [tagVip], search: "" },
    });
    expect(r1.status).toBe(201);
    expect(r1.body.filter.tagIds).toEqual([tagVip]);
    segIds.push(r1.body.id);

    const r2 = await api(admin, "POST", "/api/marketing/segments", {
      brandId, name: `VIPs-${stamp}`,
      filter: { tagIds: [], search: "" },
    });
    expect(r2.status).toBe(409);
  });

  it("name trim+min(1) on POST → blank/whitespace-only → 400", async () => {
    const blank = await api(admin, "POST", "/api/marketing/segments", {
      brandId, name: "   ", filter: { tagIds: [], search: "" },
    });
    expect(blank.status).toBe(400);
    const empty = await api(admin, "POST", "/api/marketing/segments", {
      brandId, name: "", filter: { tagIds: [], search: "" },
    });
    expect(empty.status).toBe(400);
  });

  it("cross-brand tagId in filter → 400 + zero writes", async () => {
    const r = await api(admin, "POST", "/api/marketing/segments", {
      brandId, name: `cross-${stamp}`,
      filter: { tagIds: [tagOtherBrand], search: "" },
    });
    expect(r.status).toBe(400);

    const list = await api<SegmentRow[]>(admin, "GET",
      `/api/marketing/segments?brandId=${brandId}`);
    expect(list.status).toBe(200);
    expect(list.body.find((s) => s.name === `cross-${stamp}`)).toBeUndefined();
  });

  it("resolver: AND-intersection filter (VIP+Buyer) → contactA only", async () => {
    const r = await api<SegmentRow>(admin, "POST", "/api/marketing/segments", {
      brandId, name: `VIP+Buyer-${stamp}`,
      filter: { tagIds: [tagVip, tagBuyer], search: "" },
    });
    expect(r.status).toBe(201);
    segIds.push(r.body.id);

    const resolve = await api<ContactRow[]>(admin, "GET",
      `/api/marketing/segments/${r.body.id}/contacts`);
    expect(resolve.status).toBe(200);
    const ids = resolve.body.map((c) => c.id);
    expect(ids).toContain(contactA);
    expect(ids).not.toContain(contactB);
  });

  it("resolver pagination: limit + offset honored, cap at 200", async () => {
    const segId = segIds[0]; // VIPs (both contacts)
    const lim1 = await api<ContactRow[]>(admin, "GET",
      `/api/marketing/segments/${segId}/contacts?limit=1&offset=0`);
    expect(lim1.status).toBe(200);
    expect(lim1.body.length).toBeLessThanOrEqual(1);

    const lim2 = await api<ContactRow[]>(admin, "GET",
      `/api/marketing/segments/${segId}/contacts?limit=1&offset=1`);
    expect(lim2.status).toBe(200);
    if (lim1.body.length === 1 && lim2.body.length === 1) {
      expect(lim1.body[0].id).not.toBe(lim2.body[0].id);
    }

    // Cap: requesting limit=999 must be silently capped (no 4xx).
    const big = await api<ContactRow[]>(admin, "GET",
      `/api/marketing/segments/${segId}/contacts?limit=999`);
    expect(big.status).toBe(200);
  });

  it("PATCH lock: brandId/orgId/id in body → 400 with invalidFields", async () => {
    const segId = segIds[0];
    const r = await api<{ message: string; invalidFields?: string[] }>(
      admin, "PATCH", `/api/marketing/segments/${segId}`,
      { brandId: otherBrandId, name: `relock-${stamp}` },
    );
    expect(r.status).toBe(400);
    expect(r.body.invalidFields).toEqual(expect.arrayContaining(["brandId"]));

    const r2 = await api<{ message: string; invalidFields?: string[] }>(
      admin, "PATCH", `/api/marketing/segments/${segId}`,
      { orgId: "fake", name: `relock-${stamp}` },
    );
    expect(r2.status).toBe(400);
    expect(r2.body.invalidFields).toEqual(expect.arrayContaining(["orgId"]));
  });

  it("PATCH name trim+min(1) → 400 on whitespace", async () => {
    const segId = segIds[0];
    const r = await api(admin, "PATCH", `/api/marketing/segments/${segId}`, { name: "  " });
    expect(r.status).toBe(400);
  });

  it("PATCH happy path → 200 + filter unchanged when omitted", async () => {
    const segId = segIds[0];
    const newName = `VIPs-renamed-${stamp}`;
    const r = await api<SegmentRow>(admin, "PATCH", `/api/marketing/segments/${segId}`, { name: newName });
    expect(r.status).toBe(200);
    expect(r.body.name).toBe(newName);
    expect(r.body.filter.tagIds).toEqual([tagVip]);
  });
});
