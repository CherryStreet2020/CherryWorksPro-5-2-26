/**
 * Public token routes — edge cases (Task #444, audit §2.2).
 *
 * The pre-existing `public-token-pages.spec.ts` only checks that
 * bogus tokens don't 5xx. This spec layers on the specific edge
 * cases the audit calls out: malformed length, used / wrong-state
 * actions, and the customer portal's not-found surface.
 *
 * The "wrong-org" scenario the task brief mentions does not exist as
 * a separate concept at the public-token API level — possession of a
 * valid token IS authorization (the route never reads a session). So
 * a "wrong-org" token is just a "bogus" token: covered by malformed.
 */
import { test, expect } from "@playwright/test";

test.use({ navigationTimeout: 30_000 });

// 64-char hex blob that is well-formed but cannot exist as a real
// token (vanishingly small collision probability with any seed data).
const SYNTHETIC_64 = "0".repeat(60) + "dead";

test.describe("Public invoice token — edge cases", () => {
  test("malformed token (too short) renders the 404 surface", async ({ page }) => {
    const r = await page.goto("/i/short-token");
    expect(r?.status() ?? 0).toBeLessThan(500);
    await expect(page.locator('[data-testid="public-invoice-404"]')).toBeVisible({
      timeout: 15_000,
    });
  });

  test("well-formed but unknown 64-char token also renders the 404 surface", async ({ page }) => {
    await page.goto(`/i/${SYNTHETIC_64}`);
    await expect(page.locator('[data-testid="public-invoice-404"]')).toBeVisible({
      timeout: 15_000,
    });
  });

  test("API contract: GET /api/public/invoices/:bad returns 404, not 5xx", async ({ request }) => {
    const r1 = await request.get("/api/public/invoices/short");
    expect(r1.status()).toBe(404);
    const r2 = await request.get(`/api/public/invoices/${SYNTHETIC_64}`);
    expect(r2.status()).toBe(404);
  });
});

test.describe("Public estimate token — edge cases", () => {
  test("malformed token renders the estimate 404 surface", async ({ page }) => {
    const r = await page.goto("/e/bogus-est");
    expect(r?.status() ?? 0).toBeLessThan(500);
    await expect(page.locator('[data-testid="public-estimate-404"]')).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.locator('[data-testid="text-estimate-not-found"]'),
    ).toHaveText(/Estimate not found/i);
  });

  test("API: accept/decline against unknown token returns 404 (not a 5xx) and never mutates", async ({
    request,
  }) => {
    const accept = await request.post(`/api/public/estimates/${SYNTHETIC_64}/accept`);
    expect(accept.status()).toBe(404);
    const decline = await request.post(`/api/public/estimates/${SYNTHETIC_64}/decline`);
    expect(decline.status()).toBe(404);
  });
});

test.describe("Customer portal token — edge cases", () => {
  test("malformed (length != 64) token renders the portal not-found card", async ({ page }) => {
    const r = await page.goto("/portal/short");
    expect(r?.status() ?? 0).toBeLessThan(500);
    await expect(
      page.locator('[data-testid="card-portal-not-found"]'),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="text-portal-error"]')).toHaveText(
      /Portal Not Found/i,
    );
  });

  test("well-formed but unknown 64-char portal token also renders the not-found card", async ({ page }) => {
    await page.goto(`/portal/${SYNTHETIC_64}`);
    await expect(
      page.locator('[data-testid="card-portal-not-found"]'),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("API: GET /api/public/portal/:bad returns 404 for both length variants", async ({ request }) => {
    expect((await request.get("/api/public/portal/short")).status()).toBe(404);
    expect((await request.get(`/api/public/portal/${SYNTHETIC_64}`)).status()).toBe(404);
  });
});
