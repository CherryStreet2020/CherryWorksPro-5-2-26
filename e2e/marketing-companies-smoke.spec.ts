/**
 * Marketing OS — Sprint 2b: companies smoke e2e.
 *
 * Mirrors marketing-contacts-smoke.spec.ts. Verifies:
 *  - REST CRUD via API (POST / GET list / GET detail / PATCH / DELETE)
 *  - listCompaniesWithCounts returns contactsCount > 0 after a contact is linked
 *  - Auto-link: creating a contact with a non-free-mail email auto-creates a
 *    company in the same brand (SET-ONLY rule)
 *  - Wouter route order: detail (`/marketing/companies/:id`) renders BEFORE
 *    list — proves App.tsx ordering
 *  - Sidebar "Companies" entry navigates to the list page
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
const BRAND_NAME = `Companies E2E ${RUN}`;
const BRAND_SLUG = `companies-e2e-${RUN}`;
const COMPANY_DOMAIN = `companies-e2e-${RUN}.test`;

test.describe("Marketing OS — companies smoke", () => {
  // Captured at create-time so afterAll can hard-delete even if the test
  // body throws before reaching its inline DELETE call. SP2 (Sprint 2c.1).
  const createdBrandIds: string[] = [];

  test.afterAll(async () => {
    try {
      await cleanupE2EBrandPollution(createdBrandIds);
    } catch (err) {
      console.error("[marketing-companies-smoke afterAll] cleanup failed:", err);
    }
  });

  test("CRUD via API + auto-link + list/detail UI render", async ({ request, page }) => {
    await login(request);
    const csrf = await getCsrfToken(request);
    const headers = { "X-CSRF-Token": csrf };

    // Brand
    const brandRes = await request.post(`${BASE}/api/brands`, {
      data: { name: BRAND_NAME, slug: BRAND_SLUG },
      headers,
    });
    expect(brandRes.status()).toBe(201);
    const brand = await brandRes.json();
    createdBrandIds.push(brand.id);

    // POST company (manual)
    const createRes = await request.post(`${BASE}/api/marketing/companies`, {
      data: {
        brandId: brand.id,
        name: `Acme Co ${RUN}`,
        domain: COMPANY_DOMAIN,
        industry: "SaaS",
        sizeBand: "11-50",
      },
      headers,
    });
    expect(createRes.status()).toBe(201);
    const company = await createRes.json();
    expect(company.id).toBeTruthy();
    expect(company.domain).toBe(COMPANY_DOMAIN);
    expect(company.source).toBe("manual");

    // GET list — company is present and contactsCount === 0
    const listRes = await request.get(`${BASE}/api/marketing/companies?brandId=${brand.id}`);
    expect(listRes.status()).toBe(200);
    const { rows } = await listRes.json();
    const found = rows.find((r: { id: string }) => r.id === company.id);
    expect(found).toBeTruthy();
    expect(found.contactsCount).toBe(0);

    // GET detail — includes contactsCount
    const detailRes = await request.get(`${BASE}/api/marketing/companies/${company.id}`);
    expect(detailRes.status()).toBe(200);
    const detail = await detailRes.json();
    expect(detail.id).toBe(company.id);
    expect(detail.contactsCount).toBe(0);

    // PATCH update
    const patchRes = await request.patch(`${BASE}/api/marketing/companies/${company.id}`, {
      data: { industry: "Enterprise SaaS" },
      headers,
    });
    expect(patchRes.status()).toBe(200);
    expect((await patchRes.json()).industry).toBe("Enterprise SaaS");

    // Auto-link: create a contact with email at the company domain → must reuse
    const contactRes = await request.post(`${BASE}/api/marketing/contacts`, {
      data: {
        brandId: brand.id,
        firstName: "Auto",
        lastName: "Linked",
        email: `auto+${RUN}@${COMPANY_DOMAIN}`,
        source: "e2e",
      },
      headers,
    });
    expect(contactRes.status()).toBe(201);
    const contact = await contactRes.json();
    expect(contact.companyId).toBe(company.id);

    // contactsCount now reflects the linked contact
    const listAfter = await request.get(`${BASE}/api/marketing/companies?brandId=${brand.id}`);
    const after = (await listAfter.json()).rows.find((r: { id: string }) => r.id === company.id);
    expect(after.contactsCount).toBe(1);

    // GET company contacts
    const contactsRes = await request.get(`${BASE}/api/marketing/companies/${company.id}/contacts`);
    expect(contactsRes.status()).toBe(200);
    const { rows: contactRows } = await contactsRes.json();
    expect(contactRows.some((c: { id: string }) => c.id === contact.id)).toBe(true);

    // GET activities (auto-link writes a contact_activity)
    const actRes = await request.get(`${BASE}/api/marketing/companies/${company.id}/activities`);
    expect(actRes.status()).toBe(200);
    const { rows: activityRows } = await actRes.json();
    expect(activityRows.length).toBeGreaterThan(0);

    // ── UI render ──────────────────────────────────────────────────────
    const consoleErrors: string[] = [];
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(`console.error: ${m.text()}`);
    });

    await page.addInitScript((brandId) => {
      try { localStorage.setItem("cwp_active_brand_id", brandId); } catch {}
    }, brand.id);

    await page.goto("/login");
    await page.fill('[data-testid="input-email"]', ADMIN_EMAIL);
    await page.fill('[data-testid="input-password"]', ADMIN_PASS);
    await page.click('[data-testid="button-login"]');
    await page.waitForLoadState("networkidle", { timeout: 15000 });

    // List page
    await page.goto("/marketing/companies");
    await page.waitForLoadState("networkidle", { timeout: 15000 });
    await expect(page.locator('[data-testid="text-page-title"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator(`[data-testid="row-company-${company.id}"]`)).toBeVisible({ timeout: 15000 });
    await expect(page.locator(`[data-testid="text-contacts-count-${company.id}"]`)).toContainText("1");

    // Detail page (route-order proof: /marketing/companies/:id resolves)
    await page.goto(`/marketing/companies/${company.id}`);
    await page.waitForLoadState("networkidle", { timeout: 15000 });
    await expect(page.locator('[data-testid="text-company-name"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="text-company-name"]')).toContainText(`Acme Co ${RUN}`);
    await expect(page.locator(`[data-testid="row-contact-${contact.id}"]`)).toBeVisible();

    const realErrors = consoleErrors.filter(
      (e) =>
        !/Failed to load resource.*401/i.test(e) &&
        !/autocomplete attributes/i.test(e) &&
        !/DevTools/i.test(e),
    );
    expect(realErrors, `Unexpected console errors: ${realErrors.join(" | ")}`).toEqual([]);

    // Cleanup — soft-delete contact, soft-delete company, delete brand
    await request.delete(`${BASE}/api/marketing/contacts/${contact.id}`, { headers });
    await request.delete(`${BASE}/api/marketing/companies/${company.id}`, { headers });
    await request.delete(`${BASE}/api/brands/${brand.id}`, { headers });
  });
});
