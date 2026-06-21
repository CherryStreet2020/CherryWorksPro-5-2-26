/**
 * Security regression: the orphaned `/api/portal/*` customer-portal routes
 * (server/routes/customer-portal-routes.ts) were a duplicate of the real,
 * shipped portal (`/api/public/portal/:token`, reached from the `/portal/:token`
 * page) and carried two CRITICAL auth bypasses:
 *
 *   - POST /api/portal/magic-link/verify resolved a client by `clientId` ALONE
 *     and returned that client's stable `portal_token` — never checking the
 *     supplied `token` and never scoping by org. A non-secret client UUID
 *     therefore yielded full cross-tenant portal access.
 *   - POST /api/portal/magic-link returned the magicToken/magicTokenHash +
 *     clientId/orgId in the HTTP response instead of emailing a one-time link.
 *
 * The fix removed the entire orphaned module (the shipped UI never called any
 * `/api/portal/*` endpoint — it uses `/api/public/portal/:token`). This spec
 * pins that removal: the magic-link endpoints must no longer hand back any
 * token, and the real portal must remain mounted and behave.
 */
import { test, expect } from "@playwright/test";

const SYNTHETIC_64 = "0".repeat(60) + "dead";

// Removed endpoints: must not be functional. After route removal Express
// returns 404; an unmatched mutating /api path may also surface 403 (CSRF) or
// 429 (rate limit). The security invariant is simply: never 200, and never a
// token in the body.
const REMOVED_OK = [403, 404, 405, 429];

function assertNoToken(body: unknown) {
  const s = typeof body === "string" ? body : JSON.stringify(body ?? "");
  expect(s).not.toContain("portalToken");
  expect(s).not.toContain("portal_token");
  expect(s).not.toContain("magicToken");
  expect(s).not.toContain("magicTokenHash");
}

test.describe("orphaned customer-portal routes removed (CRITICAL #2/#3)", () => {
  test("POST /api/portal/magic-link no longer returns secret material", async ({ request }) => {
    const resp = await request.post("/api/portal/magic-link", {
      data: { email: "anyone@example.com", orgSlug: "any-org" },
      failOnStatusCode: false,
    });
    expect(resp.status()).not.toBe(200);
    expect(REMOVED_OK).toContain(resp.status());
    assertNoToken(await resp.text());
  });

  test("POST /api/portal/magic-link/verify no longer yields a portal token from a clientId", async ({ request }) => {
    const resp = await request.post("/api/portal/magic-link/verify", {
      data: { clientId: SYNTHETIC_64, token: "anything" },
      failOnStatusCode: false,
    });
    expect(resp.status()).not.toBe(200);
    expect(REMOVED_OK).toContain(resp.status());
    assertNoToken(await resp.text());
  });

  test("orphaned GET /api/portal/:token/* read endpoints are gone", async ({ request }) => {
    for (const path of [
      `/api/portal/${SYNTHETIC_64}/summary`,
      `/api/portal/${SYNTHETIC_64}/invoices`,
      `/api/portal/${SYNTHETIC_64}/payments`,
    ]) {
      const resp = await request.get(path, { failOnStatusCode: false });
      expect(resp.status()).not.toBe(200);
      expect(REMOVED_OK).toContain(resp.status());
    }
  });

  test("real portal /api/public/portal/:token is still mounted and behaves", async ({ request }) => {
    // Unknown but well-formed token → not found (proves the genuine portal
    // endpoint is intact and still requires the full 64-hex bearer token).
    const resp = await request.get(`/api/public/portal/${SYNTHETIC_64}`, { failOnStatusCode: false });
    expect([404, 429]).toContain(resp.status());
  });
});
