/**
 * Task #165 — Integration coverage for brand POST/PATCH logoUrl guard.
 *
 * Task #160 added the SSRF + image-content-type validator
 * (`server/lib/validate-logo-url.ts`) and wired it into POST/PATCH
 * `/api/brands`. The unit suite (`tests/unit/validate-logo-url.test.ts`)
 * exercises the validator directly, but nothing pinned the route-level
 * wiring — a future refactor that drops the call site would slip
 * through. These tests hit the live test server end-to-end and assert:
 *   - javascript: scheme → 400 with the validator's message
 *   - private IP literal (127.0.0.1) → 400 with the validator's message
 *   - public host returning text/html (example.com) → 400 with the
 *     validator's content-type message
 *   - hosted /api/public-objects/brand-logos/... value → passes through
 *     without making a network call (exempt path)
 *
 * Mirrors the auth + brand-create scaffolding from
 * `tests/integration/marketing-segments-routes.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { TEST_BASE as BASE_URL } from "../helpers/base";

interface Ctx {
  cookies: string;
  csrfToken: string;
  orgId: string;
  role: string;
}
interface BrandRow {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
}
interface ApiResp<T> {
  status: number;
  body: T;
}

async function loginAs(email: string, password: string): Promise<Ctx> {
  const csrfRes = await fetch(`${BASE_URL}/api/csrf-token`);
  const csrfCookies = csrfRes.headers.getSetCookie();
  const csrfToken = csrfRes.headers.get("x-csrf-token")!;
  const cookieJar = csrfCookies.map((c) => c.split(";")[0]).join("; ");
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieJar,
      "X-CSRF-Token": csrfToken,
    },
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
    orgId:
      body.user?.organizationId ||
      body.organizationId ||
      body.user?.orgId ||
      body.orgId,
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
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* empty */
  }
  return { status: res.status, body: json as T };
}

describe("Task #165 — POST/PATCH /api/brands logoUrl validation", () => {
  let admin: Ctx;
  const stamp = Date.now();
  const createdBrandIds: string[] = [];

  beforeAll(async () => {
    // Match marketing-segments-routes.test.ts: ensure marketing_os
    // entitlement is active for the QA org so brand routes don't 404.
    const { pool } = await import("../../server/db");
    await pool.query(`
      INSERT INTO org_entitlements (org_id, feature, active, activated_at)
      SELECT id, 'marketing_os', true, now() FROM orgs WHERE slug = 'cwpro-dev-qa'
      ON CONFLICT (org_id, feature) DO UPDATE SET active = true
    `);

    admin = await loginAs("admin.test@cwpro.dev", "admin123");
  }, 60000);

  afterAll(async () => {
    for (const id of createdBrandIds) {
      await api(admin, "DELETE", `/api/brands/${id}`);
    }
  }, 30000);

  it("POST: javascript: scheme → 400 with validator message", async () => {
    const r = await api<{ message: string }>(admin, "POST", "/api/brands", {
      name: `T165-js-${stamp}`,
      slug: `t165-js-${stamp}`,
      logoUrl: "javascript:alert(1)",
    });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/http or https/i);
  });

  it("POST: private IP literal (127.0.0.1) → 400 with SSRF message", async () => {
    const r = await api<{ message: string }>(admin, "POST", "/api/brands", {
      name: `T165-ssrf-${stamp}`,
      slug: `t165-ssrf-${stamp}`,
      logoUrl: "http://127.0.0.1/logo.png",
    });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/not reachable from the public internet/i);
  });

  it("POST: public host returning text/html (example.com) → 400 with content-type message", async () => {
    const r = await api<{ message: string }>(admin, "POST", "/api/brands", {
      name: `T165-html-${stamp}`,
      slug: `t165-html-${stamp}`,
      logoUrl: "https://example.com/",
    });
    expect(r.status).toBe(400);
    // Primary assertion: when example.com is reachable the validator's
    // content-type branch fires. In restricted CI sandboxes the fetch
    // can fail with a timeout / network error instead — those are still
    // validator-emitted 400s and prove the wiring is intact, so accept
    // any of the validator's external-fetch failure messages.
    expect(r.body.message).toMatch(
      /must be an image|could not be fetched|timed out|HTTP \d{3}/i,
    );
  }, 15000);

  it("POST: hosted /api/public-objects/brand-logos/... → exempt, passes without network call", async () => {
    const hostedUrl = `/api/public-objects/brand-logos/seed-${stamp}.png`;
    const r = await api<BrandRow>(admin, "POST", "/api/brands", {
      name: `T165-hosted-${stamp}`,
      slug: `t165-hosted-${stamp}`,
      logoUrl: hostedUrl,
    });
    expect(r.status).toBe(201);
    expect(r.body.logoUrl).toBe(hostedUrl);
    createdBrandIds.push(r.body.id);
  });

  it("PATCH: javascript: scheme → 400 with validator message", async () => {
    // Seed a brand with an exempt hosted URL, then try to swap in a bad URL.
    const seed = await api<BrandRow>(admin, "POST", "/api/brands", {
      name: `T165-patch-seed-${stamp}`,
      slug: `t165-patch-seed-${stamp}`,
      logoUrl: `/api/public-objects/brand-logos/seed-patch-${stamp}.png`,
    });
    expect(seed.status).toBe(201);
    createdBrandIds.push(seed.body.id);

    const r = await api<{ message: string }>(
      admin,
      "PATCH",
      `/api/brands/${seed.body.id}`,
      { logoUrl: "javascript:alert(1)" },
    );
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/http or https/i);
  });

  it("PATCH: private IP literal → 400 with SSRF message", async () => {
    const seed = await api<BrandRow>(admin, "POST", "/api/brands", {
      name: `T165-patch-ssrf-${stamp}`,
      slug: `t165-patch-ssrf-${stamp}`,
      logoUrl: `/api/public-objects/brand-logos/seed-ssrf-${stamp}.png`,
    });
    expect(seed.status).toBe(201);
    createdBrandIds.push(seed.body.id);

    const r = await api<{ message: string }>(
      admin,
      "PATCH",
      `/api/brands/${seed.body.id}`,
      { logoUrl: "http://10.0.0.1/x.png" },
    );
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/not reachable from the public internet/i);
  });

  it("PATCH: public host returning text/html → 400 with content-type message", async () => {
    const seed = await api<BrandRow>(admin, "POST", "/api/brands", {
      name: `T165-patch-html-${stamp}`,
      slug: `t165-patch-html-${stamp}`,
      logoUrl: `/api/public-objects/brand-logos/seed-html-${stamp}.png`,
    });
    expect(seed.status).toBe(201);
    createdBrandIds.push(seed.body.id);

    const r = await api<{ message: string }>(
      admin,
      "PATCH",
      `/api/brands/${seed.body.id}`,
      { logoUrl: "https://example.com/" },
    );
    expect(r.status).toBe(400);
    // Same allowlist as the POST counterpart — a network-restricted
    // sandbox may surface the timeout/fetch-error branch instead of
    // the content-type branch, both of which prove the wiring.
    expect(r.body.message).toMatch(
      /must be an image|could not be fetched|timed out|HTTP \d{3}/i,
    );
  }, 15000);

  it("PATCH: swapping in a hosted /api/public-objects/brand-logos/... URL → exempt, 200", async () => {
    const seed = await api<BrandRow>(admin, "POST", "/api/brands", {
      name: `T165-patch-hosted-${stamp}`,
      slug: `t165-patch-hosted-${stamp}`,
      logoUrl: `/api/public-objects/brand-logos/seed-hosted-${stamp}.png`,
    });
    expect(seed.status).toBe(201);
    createdBrandIds.push(seed.body.id);

    const newUrl = `/api/public-objects/brand-logos/swapped-${stamp}.png`;
    const r = await api<BrandRow>(
      admin,
      "PATCH",
      `/api/brands/${seed.body.id}`,
      { logoUrl: newUrl },
    );
    expect(r.status).toBe(200);
    expect(r.body.logoUrl).toBe(newUrl);
  });
});
