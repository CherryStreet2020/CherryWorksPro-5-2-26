/**
 * Public token routes — edge cases (Task #444, audit §2.2).
 *
 * Covers the malformed / unknown / wrong-org branches for
 * /i/:token, /e/:token, /portal/:token at both the UI and the API.
 *
 * "Wrong-org" reduces to "unknown token" at the API layer because
 * possession of the token IS authorization (no session is read on
 * the public routes). To prove that contract we mint a real token
 * inside org A and assert that an API request from a fresh, totally
 * separate browser context still reaches the data — and that a
 * synthetic 64-char "wrong-org" token still 404s.
 *
 * "Used / expired" for invoice/portal does not exist as a server
 * concept (tokens have no expiry / single-use guard), so the
 * assertion is the inverse: re-fetching the same token continues
 * to return the data, never 410/Gone.
 */
import { test, expect, request as pwRequest } from "@playwright/test";
import { test as orgTest } from "../tests/helpers/po/fixtures";

test.use({ navigationTimeout: 30_000 });

const SYNTHETIC_64 = "0".repeat(60) + "dead";

test.describe("Public invoice token — UI 404 surface", () => {
  test("malformed token (length != 64)", async ({ page }) => {
    const r = await page.goto("/i/short-token");
    expect(r?.status() ?? 0).toBeLessThan(500);
    await expect(page.locator('[data-testid="public-invoice-404"]')).toBeVisible({
      timeout: 15_000,
    });
  });

  test("well-formed but unknown token", async ({ page }) => {
    await page.goto(`/i/${SYNTHETIC_64}`);
    await expect(page.locator('[data-testid="public-invoice-404"]')).toBeVisible({
      timeout: 15_000,
    });
  });
});

test.describe("Public invoice token — API contract", () => {
  test("malformed and unknown both return 404 (never 5xx)", async ({ request }) => {
    expect((await request.get("/api/public/invoices/short")).status()).toBe(404);
    expect((await request.get(`/api/public/invoices/${SYNTHETIC_64}`)).status()).toBe(404);
  });
});

test.describe("Public estimate token — UI 404 surface", () => {
  test("malformed token", async ({ page }) => {
    const r = await page.goto("/e/bogus-est");
    expect(r?.status() ?? 0).toBeLessThan(500);
    await expect(page.locator('[data-testid="public-estimate-404"]')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('[data-testid="text-estimate-not-found"]')).toHaveText(
      /Estimate not found/i,
    );
  });

  test("API: unknown-token accept and decline both return 404", async ({ request }) => {
    expect((await request.post(`/api/public/estimates/${SYNTHETIC_64}/accept`)).status()).toBe(404);
    expect((await request.post(`/api/public/estimates/${SYNTHETIC_64}/decline`)).status()).toBe(404);
  });
});

test.describe("Customer portal token — UI 404 surface", () => {
  test("malformed token", async ({ page }) => {
    const r = await page.goto("/portal/short");
    expect(r?.status() ?? 0).toBeLessThan(500);
    await expect(page.locator('[data-testid="card-portal-not-found"]')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('[data-testid="text-portal-error"]')).toHaveText(
      /Portal Not Found/i,
    );
  });

  test("well-formed unknown token also surfaces not-found card", async ({ page }) => {
    await page.goto(`/portal/${SYNTHETIC_64}`);
    await expect(page.locator('[data-testid="card-portal-not-found"]')).toBeVisible({
      timeout: 15_000,
    });
  });

  test("API: malformed and unknown both return 404", async ({ request }) => {
    expect((await request.get("/api/public/portal/short")).status()).toBe(404);
    expect((await request.get(`/api/public/portal/${SYNTHETIC_64}`)).status()).toBe(404);
  });
});

orgTest.describe("Cross-org token semantics (possession = auth)", () => {
  orgTest("a real portal token works from a fresh anon context; a synthetic 'wrong-org' token does not", async ({
    isolatedOrg,
  }) => {
    const tag = Date.now().toString(36);
    const create = await isolatedOrg.request.post("/api/clients", {
      data: { name: `Cross-Org ${tag}` },
      headers: { "X-CSRF-Token": isolatedOrg.csrf },
    });
    expect(create.ok(), `client create: ${create.status()}`).toBe(true);
    const client = await create.json();
    expect(client.portalToken).toMatch(/^[0-9a-f]{64}$/);

    const anon = await pwRequest.newContext();
    try {
      const real = await anon.get(`/api/public/portal/${client.portalToken}`);
      expect(real.status()).toBe(200);
      const wrongOrg = await anon.get(`/api/public/portal/${SYNTHETIC_64}`);
      expect(wrongOrg.status()).toBe(404);
      // Re-fetching the same valid token still works (no single-use semantics).
      const reuse = await anon.get(`/api/public/portal/${client.portalToken}`);
      expect(reuse.status()).toBe(200);
    } finally {
      await anon.dispose();
    }
  });
});
