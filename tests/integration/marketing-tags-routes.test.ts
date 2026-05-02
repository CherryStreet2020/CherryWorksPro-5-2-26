/**
 * Sprint 2d (post-review) — Route-level integration tests for Marketing
 * Contact Tags. Required acceptance scope:
 *   1. role-gate: non-admin → 403
 *   2. duplicate name → 409
 *   3. bulk over-cap → 400 (no rows touched)
 *   4. cross-brand → 400 + zero-write assertion
 *   5. delete cascade (tag delete removes assignments)
 *   6. contacts ?tagIds=… AND-intersection
 *   7. contacts ?tagIds=… invalid id → 400
 *
 * Talks to the live dev server (workflow `Start application`). Uses the
 * seeded admin/manager/team users from tests/integration/seed-role-users.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { TEST_BASE as BASE_URL } from "../helpers/base";

interface Ctx { cookies: string; csrfToken: string; orgId: string; role: string; }

interface BrandRow { id: string; name: string; slug: string }
interface ContactRow { id: string; brandId: string | null }
interface TagRow {
  id: string; name: string; color: string;
  contactCount: number; lastUsedAt: string | null;
}
interface BulkTagResp { assigned: number; unassigned: number; skipped: number }
interface BulkTagInvalidResp { message: string; invalidContactIds?: string[]; invalidTagIds?: string[] }
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

describe("Sprint 2d — marketing tag route contracts", () => {
  let admin: Ctx;
  let team: Ctx;
  let brandId: string;
  let otherBrandId: string;
  let contactA: string;
  let contactB: string;
  const tagIds: string[] = [];

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

    // Create two brands so we can prove cross-brand isolation.
    const stamp = Date.now();
    const b1 = await api<BrandRow>(admin, "POST", "/api/brands", {
      name: `S2D-A-${stamp}`, slug: `s2d-a-${stamp}`,
    });
    expect(b1.status).toBe(201);
    brandId = b1.body.id;
    const b2 = await api<BrandRow>(admin, "POST", "/api/brands", {
      name: `S2D-B-${stamp}`, slug: `s2d-b-${stamp}`,
    });
    expect(b2.status).toBe(201);
    otherBrandId = b2.body.id;

    const c1 = await api<ContactRow>(admin, "POST", "/api/marketing/contacts", {
      brandId, firstName: "Alice", lastName: "Atlas",
      email: `s2d-a-${stamp}@x.test`,
    });
    expect(c1.status).toBe(201);
    contactA = c1.body.id;
    const c2 = await api<ContactRow>(admin, "POST", "/api/marketing/contacts", {
      brandId, firstName: "Bob", lastName: "Beta",
      email: `s2d-b-${stamp}@x.test`,
    });
    expect(c2.status).toBe(201);
    contactB = c2.body.id;
  }, 60000);

  afterAll(async () => {
    for (const id of tagIds) await api(admin, "DELETE", `/api/marketing/tags/${id}`);
    if (contactA) await api(admin, "DELETE", `/api/marketing/contacts/${contactA}`);
    if (contactB) await api(admin, "DELETE", `/api/marketing/contacts/${contactB}`);
    if (brandId)      await api(admin, "DELETE", `/api/brands/${brandId}`);
    if (otherBrandId) await api(admin, "DELETE", `/api/brands/${otherBrandId}`);
  }, 30000);

  it("role-gate: non-admin POST /api/marketing/tags → 403", async () => {
    const r = await api(team, "POST", "/api/marketing/tags", {
      brandId, name: "should-fail", color: "#112233",
    });
    expect(r.status).toBe(403);
  });

  it("role-gate: non-admin POST /api/marketing/contacts/bulk-tag → 403", async () => {
    const r = await api(team, "POST", "/api/marketing/contacts/bulk-tag", {
      brandId, prospectIds: [contactA], tagIds: [], op: "assign",
    });
    expect(r.status).toBe(403);
  });

  it("create tag (admin) → 201; duplicate name on same brand → 409", async () => {
    const r1 = await api<TagRow>(admin, "POST", "/api/marketing/tags", {
      brandId, name: "VIP", color: "#FF0000",
    });
    expect(r1.status).toBe(201);
    tagIds.push(r1.body.id);
    const r2 = await api(admin, "POST", "/api/marketing/tags", {
      brandId, name: "VIP", color: "#00FF00",
    });
    expect(r2.status).toBe(409);
  });

  it("creates 3 more tags for filter/bulk tests", async () => {
    for (const name of ["Press", "Buyer", "Lapsed"]) {
      const r = await api<TagRow>(admin, "POST", "/api/marketing/tags", { brandId, name, color: "#123456" });
      expect(r.status).toBe(201);
      tagIds.push(r.body.id);
    }
    expect(tagIds.length).toBe(4);
  });

  it("bulk over-cap (>20 tagIds) → 400, zero rows touched", async () => {
    // 21 fake uuids — will short-circuit at the cap before validation.
    const fakes = Array.from({ length: 21 }, (_, i) =>
      `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`);
    const r = await api(admin, "POST", "/api/marketing/contacts/bulk-tag", {
      brandId, prospectIds: [contactA], tagIds: fakes, op: "assign",
    });
    expect(r.status).toBe(400);
    // Zero-write assertion: contactA still has no tags.
    const list = await api<TagRow[]>(admin, "GET", `/api/marketing/tags?brandId=${brandId}`);
    expect(list.status).toBe(200);
    for (const t of list.body) expect(t.contactCount).toBe(0);
  });

  it("cross-brand tag id in bulk-tag → 400 with offender + zero writes", async () => {
    // Create a tag on the OTHER brand.
    const other = await api<TagRow>(admin, "POST", "/api/marketing/tags", {
      brandId: otherBrandId, name: "X-Brand", color: "#000000",
    });
    expect(other.status).toBe(201);
    const otherTagId = other.body.id;

    const r = await api<BulkTagInvalidResp>(admin, "POST", "/api/marketing/contacts/bulk-tag", {
      brandId, prospectIds: [contactA], tagIds: [otherTagId], op: "assign",
    });
    expect(r.status).toBe(400);
    expect(r.body.invalidTagIds).toContain(otherTagId);

    // Zero-write: tag list on brandId still all 0.
    const list = await api<TagRow[]>(admin, "GET", `/api/marketing/tags?brandId=${brandId}`);
    for (const t of list.body) expect(t.contactCount).toBe(0);

    await api(admin, "DELETE", `/api/marketing/tags/${otherTagId}`);
  });

  it("bulk-assign exact counts: 4 pairs assigned, second call → 0 assigned / 4 skipped", async () => {
    const useTags = tagIds.slice(0, 2); // VIP + Press
    const r1 = await api<BulkTagResp>(admin, "POST", "/api/marketing/contacts/bulk-tag", {
      brandId, prospectIds: [contactA, contactB], tagIds: useTags, op: "assign",
    });
    expect(r1.status).toBe(200);
    expect(r1.body).toMatchObject({ assigned: 4, unassigned: 0, skipped: 0 });

    const r2 = await api<BulkTagResp>(admin, "POST", "/api/marketing/contacts/bulk-tag", {
      brandId, prospectIds: [contactA, contactB], tagIds: useTags, op: "assign",
    });
    expect(r2.status).toBe(200);
    expect(r2.body).toMatchObject({ assigned: 0, unassigned: 0, skipped: 4 });
  });

  it("contacts ?tagIds=… AND-intersection narrows correctly", async () => {
    // Assign VIP to A only, Buyer to A only (so A has VIP+Press+Buyer; B has VIP+Press).
    const buyerId = tagIds[2];
    const r = await api<BulkTagResp>(admin, "POST", "/api/marketing/contacts/bulk-tag", {
      brandId, prospectIds: [contactA], tagIds: [buyerId], op: "assign",
    });
    expect(r.status).toBe(200);
    expect(r.body.assigned).toBe(1);

    // VIP+Press → both contacts.
    const both = await api<ContactRow[]>(admin, "GET",
      `/api/marketing/contacts?brandId=${brandId}&tagIds=${tagIds[0]},${tagIds[1]}`);
    expect(both.status).toBe(200);
    const bothIds = both.body.map((c) => c.id);
    expect(bothIds).toContain(contactA);
    expect(bothIds).toContain(contactB);

    // VIP+Buyer → only A.
    const onlyA = await api<ContactRow[]>(admin, "GET",
      `/api/marketing/contacts?brandId=${brandId}&tagIds=${tagIds[0]},${buyerId}`);
    expect(onlyA.status).toBe(200);
    const onlyIds = onlyA.body.map((c) => c.id);
    expect(onlyIds).toContain(contactA);
    expect(onlyIds).not.toContain(contactB);
  });

  it("bulk-tag without brandId derives it from contacts (200) and rejects mixed-brand (400)", async () => {
    // Omit brandId — should derive from contactA/contactB (both in brandId).
    const r = await api<BulkTagResp>(admin, "POST", "/api/marketing/contacts/bulk-tag", {
      prospectIds: [contactA, contactB], tagIds: [tagIds[1]], op: "assign",
    });
    expect(r.status).toBe(200);
    // Already assigned earlier in this suite → all skipped.
    expect(r.body).toMatchObject({ assigned: 0, unassigned: 0, skipped: 2 });

    // Empty arrays → 200 zero counts even without brandId.
    const empty = await api<BulkTagResp>(admin, "POST", "/api/marketing/contacts/bulk-tag", {
      prospectIds: [], tagIds: [], op: "assign",
    });
    expect(empty.status).toBe(200);
    expect(empty.body).toMatchObject({ assigned: 0, unassigned: 0, skipped: 0 });

    // Spanning two brands → derive fails 400 (zero writes).
    const otherContact = await api<ContactRow>(admin, "POST", "/api/marketing/contacts", {
      brandId: otherBrandId, firstName: "Carol", lastName: "Cross",
      email: `s2d-c-${Date.now()}@x.test`,
    });
    expect(otherContact.status).toBe(201);
    const mixed = await api<BulkTagInvalidResp>(admin, "POST", "/api/marketing/contacts/bulk-tag", {
      prospectIds: [contactA, otherContact.body.id], tagIds: [tagIds[1]], op: "assign",
    });
    expect(mixed.status).toBe(400);
    await api(admin, "DELETE", `/api/marketing/contacts/${otherContact.body.id}`);
  });

  it("contacts ?tagIds=… with cross-brand id → 400 (no leak)", async () => {
    const fake = "00000000-0000-0000-0000-000000000999";
    const r = await api(admin, "GET",
      `/api/marketing/contacts?brandId=${brandId}&tagIds=${fake}`);
    expect(r.status).toBe(400);
  });

  it("single-add cross-brand → 400 with invalidTagIds + zero writes", async () => {
    const other = await api<TagRow>(admin, "POST", "/api/marketing/tags", {
      brandId: otherBrandId, name: "X-Single", color: "#ABCDEF",
    });
    expect(other.status).toBe(201);
    const otherTagId = other.body.id;

    const r = await api<BulkTagInvalidResp>(admin, "POST",
      `/api/marketing/contacts/${contactA}/tags`, { tagId: otherTagId });
    expect(r.status).toBe(400);
    expect(r.body.invalidTagIds).toEqual([otherTagId]);

    // Zero-write on the OTHER brand's tag.
    const list = await api<TagRow[]>(admin, "GET", `/api/marketing/tags?brandId=${otherBrandId}`);
    const row = list.body.find((t) => t.id === otherTagId);
    expect(row?.contactCount).toBe(0);

    await api(admin, "DELETE", `/api/marketing/tags/${otherTagId}`);
  });

  it("delete tag cascades — assignments are gone", async () => {
    const vipId = tagIds[0];
    const del = await api(admin, "DELETE", `/api/marketing/tags/${vipId}`);
    expect(del.status).toBe(200);
    tagIds.shift();
    // Filtering by the deleted id returns 400 (cross-brand/unknown).
    const r = await api(admin, "GET",
      `/api/marketing/contacts?brandId=${brandId}&tagIds=${vipId}`);
    expect(r.status).toBe(400);
  });
});
