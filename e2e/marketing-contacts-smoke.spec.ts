/**
 * Marketing OS — Sprint 2a: contacts smoke e2e.
 * Login pattern mirrors e2e/brands-smoke.spec.ts. Asserts the route order
 * (detail before list) by visiting /marketing/contacts and a synthetic
 * /marketing/contacts/<uuid> path and confirming neither is a fallthrough.
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

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const BRAND_NAME = `Contacts E2E ${RUN}`;
const BRAND_SLUG = `contacts-e2e-${RUN}`;

test.describe("Marketing OS — contacts smoke", () => {
  // Captured at create-time so afterAll can hard-delete even if the test
  // body throws before reaching its inline DELETE call. SP2 (Sprint 2c.1).
  const createdBrandIds: string[] = [];

  test.afterAll(async () => {
    try {
      await cleanupE2EBrandPollution(createdBrandIds);
    } catch (err) {
      console.error("[marketing-contacts-smoke afterAll] cleanup failed:", err);
    }
  });

  test("CRUD via API + /marketing/contacts list + detail route render", async ({
    request,
    page,
  }) => {
    await login(request);
    const csrf = await getCsrfToken(request);
    const headers = { "X-CSRF-Token": csrf };

    // Set up a brand to scope contacts under.
    const brandRes = await request.post(`${BASE}/api/brands`, {
      data: { name: BRAND_NAME, slug: BRAND_SLUG },
      headers,
    });
    expect(brandRes.status()).toBe(201);
    const brand = await brandRes.json();
    createdBrandIds.push(brand.id);

    // POST contact
    const createRes = await request.post(`${BASE}/api/marketing/contacts`, {
      data: {
        brandId: brand.id,
        firstName: "Smoke",
        lastName: "Tester",
        email: `smoke+${RUN}@example.com`,
        lifecycleStage: "lead",
        leadStatus: "new",
        source: "e2e",
      },
      headers,
    });
    expect(createRes.status()).toBe(201);
    const contact = await createRes.json();
    expect(contact.id).toBeTruthy();

    // GET list — contact is present
    const listRes = await request.get(`${BASE}/api/marketing/contacts?brandId=${brand.id}`);
    expect(listRes.status()).toBe(200);
    const list = await listRes.json();
    expect(list.some((c: { id: string }) => c.id === contact.id)).toBe(true);

    // PATCH update
    const patchRes = await request.patch(`${BASE}/api/marketing/contacts/${contact.id}`, {
      data: { lifecycleStage: "mql" },
      headers,
    });
    expect(patchRes.status()).toBe(200);

    // POST activity
    const actRes = await request.post(`${BASE}/api/marketing/contacts/${contact.id}/activities`, {
      data: { type: "note_added", payload: { body: "smoke note" } },
      headers,
    });
    expect(actRes.status()).toBe(201);

    // Sign in via the page so cookies attach.
    const consoleErrors: string[] = [];
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(`console.error: ${m.text()}`);
    });

    // Simulate the BrandSwitcher pick that a real user would do after
    // creating a new brand. Without this, multi-brand orgs land on
    // <empty-state-select-brand> (Priority 3 in BrandContext), which
    // is correct UX behavior — but not what this spec is testing.
    await page.addInitScript((brandId) => {
      try { localStorage.setItem('cwp_active_brand_id', brandId); } catch {}
    }, brand.id);

    await page.goto("/login");
    await page.fill('[data-testid="input-email"]', ADMIN_EMAIL);
    await page.fill('[data-testid="input-password"]', ADMIN_PASS);
    await page.click('[data-testid="button-login"]');
    await page.waitForLoadState("networkidle", { timeout: 15000 });

    // List page renders — proves /marketing/contacts route exists.
    await page.goto("/marketing/contacts");
    await page.waitForLoadState("networkidle", { timeout: 15000 });
    await expect(page.locator('[data-testid="text-page-title"]')).toBeVisible({ timeout: 15000 });

    // Detail route renders BEFORE list — Wouter route-order proof.
    await page.goto(`/marketing/contacts/${contact.id}`);
    await page.waitForLoadState("networkidle", { timeout: 15000 });
    await expect(page.locator('[data-testid="text-contact-name"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="text-contact-name"]')).toContainText("Smoke Tester");

    const realErrors = consoleErrors.filter(
      (e) =>
        !/Failed to load resource.*401/i.test(e) &&
        !/autocomplete attributes/i.test(e) &&
        !/DevTools/i.test(e),
    );
    expect(realErrors, `Unexpected console errors: ${realErrors.join(" | ")}`).toEqual([]);

    // Cleanup
    await request.delete(`${BASE}/api/marketing/contacts/${contact.id}`, { headers });
    await request.delete(`${BASE}/api/brands/${brand.id}`, { headers });
  });
});
