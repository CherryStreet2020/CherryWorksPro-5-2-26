/**
 * Marketing OS — Sprint 2f.2 (Task #72): create-dialog brand lock e2e.
 *
 * Verifies that the "Add Contact" and "Add Company" dialogs default-and-lock
 * to the currently active brand instead of letting the user pick a different
 * brand from a dropdown. This prevents the bug where a user viewing brand A
 * silently creates a record under brand B and the record then "disappears"
 * from their current view.
 *
 * Login pattern mirrors e2e/marketing-contacts-smoke.spec.ts.
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
const BRAND_A_NAME = `BrandLock A ${RUN}`;
const BRAND_A_SLUG = `brandlock-a-${RUN}`;
const BRAND_B_NAME = `BrandLock B ${RUN}`;
const BRAND_B_SLUG = `brandlock-b-${RUN}`;

test.describe("Marketing OS — create dialogs lock to active brand", () => {
  const createdBrandIds: string[] = [];

  test.afterAll(async () => {
    try {
      await cleanupE2EBrandPollution(createdBrandIds);
    } catch (err) {
      console.error("[marketing-add-brand-lock afterAll] cleanup failed:", err);
    }
  });

  test("Add Contact + Add Company dialogs lock brand to active brand and create records under it", async ({
    request,
    page,
  }) => {
    await login(request);
    const csrf = await getCsrfToken(request);
    const headers = { "X-CSRF-Token": csrf };

    // Two brands so there's a choice to make and a way to confirm the lock.
    const brandARes = await request.post(`${BASE}/api/brands`, {
      data: { name: BRAND_A_NAME, slug: BRAND_A_SLUG },
      headers,
    });
    expect(brandARes.status()).toBe(201);
    const brandA = await brandARes.json();
    createdBrandIds.push(brandA.id);

    const brandBRes = await request.post(`${BASE}/api/brands`, {
      data: { name: BRAND_B_NAME, slug: BRAND_B_SLUG },
      headers,
    });
    expect(brandBRes.status()).toBe(201);
    const brandB = await brandBRes.json();
    createdBrandIds.push(brandB.id);

    // Make brand A the active brand for the page session.
    await page.addInitScript((brandId) => {
      try { localStorage.setItem('cwp_active_brand_id', brandId); } catch {}
    }, brandA.id);

    await page.goto("/login");
    await page.fill('[data-testid="input-email"]', ADMIN_EMAIL);
    await page.fill('[data-testid="input-password"]', ADMIN_PASS);
    await page.click('[data-testid="button-login"]');
    await page.waitForLoadState("networkidle", { timeout: 15000 });

    // ─── Contacts ────────────────────────────────────────────────────────
    await page.goto("/marketing/contacts");
    await page.waitForLoadState("networkidle", { timeout: 15000 });
    await page.click('[data-testid="button-add-contact"]');
    await expect(page.locator('[data-testid="dialog-add-contact"]')).toBeVisible({ timeout: 10000 });

    // The brand picker should be the read-only display — NOT the editable
    // <Select> — and it should show brand A.
    await expect(page.locator('[data-testid="display-add-brand"]')).toBeVisible();
    await expect(page.locator('[data-testid="display-add-brand"]')).toContainText(BRAND_A_NAME);
    await expect(page.locator('[data-testid="select-add-brand"]')).toHaveCount(0);

    const contactFirst = `Locky${RUN}`;
    await page.fill('[data-testid="input-add-firstName"]', contactFirst);
    await page.fill('[data-testid="input-add-lastName"]', "Tester");
    await page.click('[data-testid="button-submit-add-contact"]');
    await page.waitForLoadState("networkidle", { timeout: 10000 });

    // Confirm the contact landed under brand A (not brand B).
    const contactsARes = await request.get(`${BASE}/api/marketing/contacts?brandId=${brandA.id}`);
    expect(contactsARes.status()).toBe(200);
    const contactsA = await contactsARes.json();
    const created = contactsA.find((c: { firstName: string }) => c.firstName === contactFirst);
    expect(created, "contact should have been created under the active brand A").toBeTruthy();
    expect(created.brandId).toBe(brandA.id);

    const contactsBRes = await request.get(`${BASE}/api/marketing/contacts?brandId=${brandB.id}`);
    const contactsB = await contactsBRes.json();
    expect(
      contactsB.some((c: { firstName: string }) => c.firstName === contactFirst),
      "contact must NOT exist under brand B",
    ).toBe(false);

    // Cleanup contact.
    await request.delete(`${BASE}/api/marketing/contacts/${created.id}`, { headers });

    // ─── Companies ───────────────────────────────────────────────────────
    await page.goto("/marketing/companies");
    await page.waitForLoadState("networkidle", { timeout: 15000 });
    await page.click('[data-testid="button-add-company"]');
    await expect(page.locator('[data-testid="dialog-add-company"]')).toBeVisible({ timeout: 10000 });

    await expect(page.locator('[data-testid="display-add-brand"]')).toBeVisible();
    await expect(page.locator('[data-testid="display-add-brand"]')).toContainText(BRAND_A_NAME);
    await expect(page.locator('[data-testid="select-add-brand"]')).toHaveCount(0);

    const companyName = `LockyCo ${RUN}`;
    await page.fill('[data-testid="input-add-name"]', companyName);
    await page.click('[data-testid="button-submit-add-company"]');
    await page.waitForLoadState("networkidle", { timeout: 10000 });

    const companiesARes = await request.get(`${BASE}/api/marketing/companies?brandId=${brandA.id}`);
    expect(companiesARes.status()).toBe(200);
    const { rows: companiesA = [] } = await companiesARes.json();
    const createdCo = companiesA.find((c: { name: string }) => c.name === companyName);
    expect(createdCo, "company should have been created under the active brand A").toBeTruthy();
    expect(createdCo.brandId).toBe(brandA.id);

    const companiesBRes = await request.get(`${BASE}/api/marketing/companies?brandId=${brandB.id}`);
    const { rows: companiesB = [] } = await companiesBRes.json();
    expect(
      companiesB.some((c: { name: string }) => c.name === companyName),
      "company must NOT exist under brand B",
    ).toBe(false);

    // Cleanup company.
    await request.delete(`${BASE}/api/marketing/companies/${createdCo.id}`, { headers });
  });
});
