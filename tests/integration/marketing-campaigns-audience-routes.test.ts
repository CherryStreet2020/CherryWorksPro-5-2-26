/**
 * Task #265 — Route-level integration coverage for the campaign audience
 * picker contract. Task #234 added unit tests for the recipient resolver,
 * but the create/update API routes had no automated coverage. A regression
 * that let through `(segment, no id)` or accepted a segment from another
 * brand would currently ship unnoticed.
 *
 * Scenarios covered (per Done-looks-like in the task):
 *  1. POST audienceType=all happy path → 201 + audienceSegmentId NULL
 *  2. POST audienceType=segment without segmentId → 400, no row written
 *  3. POST audienceType=segment with a segment from a different brand → 400
 *  4. POST happy path with valid segment for the same brand → 201
 *  5. PATCH switching from segment back to all clears audience_segment_id
 *  6. PATCH audienceType=segment with no existing/segment id → 400
 *  7. PATCH audienceSegmentId=<other brand's segment> → 400
 *
 * Mirrors the harness used by tests/integration/marketing-segments-routes.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { TEST_BASE as BASE_URL } from "../helpers/base";

interface Ctx { cookies: string; csrfToken: string; orgId: string; role: string; }
interface BrandRow { id: string; name: string; slug: string }
interface SegmentRow { id: string; brandId: string; name: string }
interface CampaignRow {
  id: string;
  brandId: string;
  name: string;
  audienceType: "all" | "segment";
  audienceSegmentId: string | null;
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

describe("Task #265 — marketing campaigns audience-picker route contracts", () => {
  let admin: Ctx;
  let brandId: string;
  let otherBrandId: string;
  let segmentId: string;
  let otherBrandSegmentId: string;
  const stamp = Date.now();
  const campaignIds: string[] = [];

  beforeAll(async () => {
    // Same QA-org entitlement seeding shim used by sibling marketing-OS
    // route tests: the test server seeds entitlements asynchronously, so
    // we force-flip marketing_os ON for the QA org before any gated route
    // is exercised. Without this the gate returns stealth-404s.
    const { pool } = await import("../../server/db");
    await pool.query(`
      INSERT INTO org_entitlements (org_id, feature, active, activated_at)
      SELECT id, 'marketing_os', true, now() FROM orgs WHERE slug = 'cwpro-dev-qa'
      ON CONFLICT (org_id, feature) DO UPDATE SET active = true
    `);

    admin = await loginAs("admin.test@cwpro.dev", "admin123");

    const b1 = await api<BrandRow>(admin, "POST", "/api/brands", {
      name: `T265-A-${stamp}`, slug: `t265-a-${stamp}`,
    });
    expect(b1.status).toBe(201);
    brandId = b1.body.id;

    const b2 = await api<BrandRow>(admin, "POST", "/api/brands", {
      name: `T265-B-${stamp}`, slug: `t265-b-${stamp}`,
    });
    expect(b2.status).toBe(201);
    otherBrandId = b2.body.id;

    const seg = await api<SegmentRow>(admin, "POST", "/api/marketing/segments", {
      brandId, name: `t265-seg-A-${stamp}`,
      filter: { tagIds: [], search: "" },
    });
    expect(seg.status).toBe(201);
    segmentId = seg.body.id;

    const otherSeg = await api<SegmentRow>(admin, "POST", "/api/marketing/segments", {
      brandId: otherBrandId, name: `t265-seg-B-${stamp}`,
      filter: { tagIds: [], search: "" },
    });
    expect(otherSeg.status).toBe(201);
    otherBrandSegmentId = otherSeg.body.id;
  }, 60000);

  afterAll(async () => {
    for (const id of campaignIds) {
      await api(admin, "DELETE", `/api/marketing/campaigns/${id}`);
    }
    if (segmentId) await api(admin, "DELETE", `/api/marketing/segments/${segmentId}`);
    if (otherBrandSegmentId) await api(admin, "DELETE", `/api/marketing/segments/${otherBrandSegmentId}`);
    if (brandId) await api(admin, "DELETE", `/api/brands/${brandId}`);
    if (otherBrandId) await api(admin, "DELETE", `/api/brands/${otherBrandId}`);
  }, 30000);

  it("POST audienceType=all → 201 + audienceSegmentId is null", async () => {
    const r = await api<CampaignRow>(admin, "POST", "/api/marketing/campaigns", {
      brandId,
      name: `t265-all-${stamp}`,
      audienceType: "all",
    });
    expect(r.status).toBe(201);
    expect(r.body.audienceType).toBe("all");
    expect(r.body.audienceSegmentId).toBeNull();
    campaignIds.push(r.body.id);
  });

  it("POST audienceType=segment without segmentId → 400, nothing created", async () => {
    const before = await api<CampaignRow[]>(admin, "GET",
      `/api/marketing/campaigns?brandId=${brandId}`);
    expect(before.status).toBe(200);
    const beforeCount = before.body.length;

    const r = await api(admin, "POST", "/api/marketing/campaigns", {
      brandId,
      name: `t265-seg-missing-${stamp}`,
      audienceType: "segment",
      // audienceSegmentId intentionally omitted
    });
    expect(r.status).toBe(400);

    const after = await api<CampaignRow[]>(admin, "GET",
      `/api/marketing/campaigns?brandId=${brandId}`);
    expect(after.status).toBe(200);
    expect(after.body.length).toBe(beforeCount);
    expect(after.body.find((c) => c.name === `t265-seg-missing-${stamp}`)).toBeUndefined();
  });

  it("POST audienceType=segment with a segment from a different brand → 400", async () => {
    const r = await api(admin, "POST", "/api/marketing/campaigns", {
      brandId,
      name: `t265-cross-brand-${stamp}`,
      audienceType: "segment",
      audienceSegmentId: otherBrandSegmentId,
    });
    expect(r.status).toBe(400);

    const list = await api<CampaignRow[]>(admin, "GET",
      `/api/marketing/campaigns?brandId=${brandId}`);
    expect(list.status).toBe(200);
    expect(list.body.find((c) => c.name === `t265-cross-brand-${stamp}`)).toBeUndefined();
  });

  it("POST audienceType=segment with valid same-brand segment → 201", async () => {
    const r = await api<CampaignRow>(admin, "POST", "/api/marketing/campaigns", {
      brandId,
      name: `t265-seg-ok-${stamp}`,
      audienceType: "segment",
      audienceSegmentId: segmentId,
    });
    expect(r.status).toBe(201);
    expect(r.body.audienceType).toBe("segment");
    expect(r.body.audienceSegmentId).toBe(segmentId);
    campaignIds.push(r.body.id);
  });

  it("PATCH switching from segment back to all clears audience_segment_id", async () => {
    // Seed a fresh segment campaign so this test is independent.
    const created = await api<CampaignRow>(admin, "POST", "/api/marketing/campaigns", {
      brandId,
      name: `t265-toggle-${stamp}`,
      audienceType: "segment",
      audienceSegmentId: segmentId,
    });
    expect(created.status).toBe(201);
    campaignIds.push(created.body.id);

    const patched = await api<CampaignRow>(
      admin, "PATCH", `/api/marketing/campaigns/${created.body.id}`,
      { audienceType: "all" },
    );
    expect(patched.status).toBe(200);
    expect(patched.body.audienceType).toBe("all");
    expect(patched.body.audienceSegmentId).toBeNull();

    // Re-fetch via GET to confirm persistence (defense against the route
    // returning a hand-crafted shape that diverges from the stored row).
    const refetched = await api<CampaignRow>(
      admin, "GET", `/api/marketing/campaigns/${created.body.id}`,
    );
    expect(refetched.status).toBe(200);
    expect(refetched.body.audienceType).toBe("all");
    expect(refetched.body.audienceSegmentId).toBeNull();
  });

  it("PATCH switching to segment without supplying a segmentId → 400", async () => {
    const created = await api<CampaignRow>(admin, "POST", "/api/marketing/campaigns", {
      brandId,
      name: `t265-patch-missing-${stamp}`,
      audienceType: "all",
    });
    expect(created.status).toBe(201);
    campaignIds.push(created.body.id);

    const r = await api(admin, "PATCH", `/api/marketing/campaigns/${created.body.id}`, {
      audienceType: "segment",
    });
    expect(r.status).toBe(400);

    const refetched = await api<CampaignRow>(
      admin, "GET", `/api/marketing/campaigns/${created.body.id}`,
    );
    expect(refetched.status).toBe(200);
    expect(refetched.body.audienceType).toBe("all");
    expect(refetched.body.audienceSegmentId).toBeNull();
  });

  it("PATCH audienceSegmentId pointing at another brand's segment → 400", async () => {
    const created = await api<CampaignRow>(admin, "POST", "/api/marketing/campaigns", {
      brandId,
      name: `t265-patch-cross-${stamp}`,
      audienceType: "segment",
      audienceSegmentId: segmentId,
    });
    expect(created.status).toBe(201);
    campaignIds.push(created.body.id);

    const r = await api(admin, "PATCH", `/api/marketing/campaigns/${created.body.id}`, {
      audienceSegmentId: otherBrandSegmentId,
    });
    expect(r.status).toBe(400);

    const refetched = await api<CampaignRow>(
      admin, "GET", `/api/marketing/campaigns/${created.body.id}`,
    );
    expect(refetched.status).toBe(200);
    // The original segment must be untouched.
    expect(refetched.body.audienceSegmentId).toBe(segmentId);
  });
});
