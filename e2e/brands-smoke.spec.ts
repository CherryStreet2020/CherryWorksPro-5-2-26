/**
 * Marketing OS — Sprint 1: brands smoke e2e.
 *
 * Login pattern mirrors e2e/dashboard-kpi.spec.ts lines 7-12 exactly.
 * Requires MARKETING_OS_ENABLED=true and VITE_MARKETING_OS_ENABLED=true
 * to be present in the dev server's env when this test runs (the test
 * itself only sets them for its own process so the API client side is
 * gated correctly; the dev server is started separately by the user
 * with the same env vars). The route-existence assertion at step 5
 * proves the Wouter route order — if /settings/brands is registered
 * AFTER /settings, this assertion will fail with a 404-style render.
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

async function getCsrfToken(request: APIRequestContext): Promise<string> {
  const r = await request.get(`${BASE}/api/csrf-token`);
  expect(r.status()).toBe(200);
  return r.headers()["x-csrf-token"] || "";
}

const RUN_TAG = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const TEST_BRAND_NAME = `Test Brand ${RUN_TAG}`;
const TEST_BRAND_SLUG = `test-brand-${RUN_TAG}`;

test.describe("Marketing OS — brands smoke", () => {
  // Captured at create-time so afterAll can hard-delete even if the test
  // body throws before reaching its inline DELETE call. SP2 (Sprint 2c.1).
  const createdBrandIds: string[] = [];

  test.afterAll(async () => {
    try {
      await cleanupE2EBrandPollution(createdBrandIds);
    } catch (err) {
      // Never let teardown failures mask a real test failure.
      console.error("[brands-smoke afterAll] cleanup failed:", err);
    }
  });

  test("CRUD via API + /settings/brands renders + /invoices regression", async ({
    request,
    page,
  }) => {
    // 1+2: login + csrf
    await login(request);
    const csrf = await getCsrfToken(request);

    // 3: POST /api/brands → assert 201
    const createRes = await request.post(`${BASE}/api/brands`, {
      data: { name: TEST_BRAND_NAME, slug: TEST_BRAND_SLUG },
      headers: { "X-CSRF-Token": csrf },
    });
    expect(createRes.status()).toBe(201);
    const created = await createRes.json();
    expect(created.id).toBeTruthy();
    createdBrandIds.push(created.id);
    expect(created.name).toBe(TEST_BRAND_NAME);
    expect(created.slug).toBe(TEST_BRAND_SLUG);

    // 4: GET /api/brands → assert array contains the new brand
    const listRes = await request.get(`${BASE}/api/brands`);
    expect(listRes.status()).toBe(200);
    const list = await listRes.json();
    expect(Array.isArray(list)).toBe(true);
    expect(list.some((b: { id: string }) => b.id === created.id)).toBe(true);

    // Capture browser console errors for the page navigations below.
    const consoleErrors: string[] = [];
    page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(`console.error: ${msg.text()}`);
    });

    // Sign in via the page so the cookie is on the page context too.
    await page.goto("/login");
    await page.fill('[data-testid="input-email"]', ADMIN_EMAIL);
    await page.fill('[data-testid="input-password"]', ADMIN_PASS);
    await page.click('[data-testid="button-login"]');
    await page.waitForLoadState("networkidle", { timeout: 15000 });

    // 5: /settings/brands renders the Brands h1 — WOUTER ROUTE ORDER PROOF.
    // If the route is registered AFTER /settings, Wouter will match /settings
    // first and this h1 will never appear.
    await page.goto("/settings/brands");
    await page.waitForLoadState("networkidle", { timeout: 15000 });
    const h1 = page.locator('[data-testid="text-page-title"]');
    await expect(h1).toBeVisible({ timeout: 15000 });
    await expect(h1).toHaveText("Brands");

    // 6: /invoices regression — page renders, no console errors.
    await page.goto("/invoices");
    await page.waitForLoadState("networkidle", { timeout: 15000 });
    // Common invoice-page anchors; whichever exists should be visible.
    const invoiceAnchor = page
      .locator('[data-testid="page-invoices"], [data-testid="text-invoices-title"], h1:has-text("Invoices")')
      .first();
    await expect(invoiceAnchor).toBeVisible({ timeout: 15000 });

    // Filter out unrelated noise (auth probes, browser deprecations).
    const realErrors = consoleErrors.filter((e) =>
      !/Failed to load resource.*401/i.test(e) &&
      !/autocomplete attributes/i.test(e) &&
      !/DevTools/i.test(e),
    );
    expect(realErrors, `Unexpected console errors: ${realErrors.join(" | ")}`).toEqual([]);

    // Cleanup — archive the test brand.
    const delRes = await request.delete(`${BASE}/api/brands/${created.id}`, {
      headers: { "X-CSRF-Token": csrf },
    });
    expect([200, 204]).toContain(delRes.status());
  });
});
