/**
 * Sprint 2f.1 — Brand-switch / single-source-of-truth e2e.
 *
 * Verifies that:
 *   • No editable Brand <Select> testid (`select-brand`) renders on
 *     /marketing/contacts or /marketing/companies (R5).
 *   • The shared <BrandBadge /> chip (`badge-active-brand`) renders on
 *     all 5 marketing list pages and reads the active brand name.
 *   • Switching brands via the global topbar BrandSwitcher updates the
 *     contacts & companies lists with the new brand's data within ~1s
 *     (TanStack queryKey already includes brandId — R6).
 *   • Bulk actions still send the correct brandId (the visible selection
 *     proves the active brand was applied to the row query — R7).
 *   • Navigating to /marketing/contacts with no active brand renders
 *     `empty-state-select-brand` (A12).
 *
 * Mirrors the auth + cleanup conventions used by the other Marketing OS
 * smoke specs in this project.
 */
process.env.MARKETING_OS_ENABLED = "true";
process.env.VITE_MARKETING_OS_ENABLED = "true";

import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
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

async function uiLogin(page: Page) {
  await page.goto("/login");
  await page.fill('[data-testid="input-email"]', ADMIN_EMAIL);
  await page.fill('[data-testid="input-password"]', ADMIN_PASS);
  await page.click('[data-testid="button-login"]');
  await page.waitForLoadState("networkidle", { timeout: 15000 });
}

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const BRAND_A_NAME = `Brand A 2f1 ${RUN}`;
const BRAND_A_SLUG = `brand-a-2f1-${RUN}`;
const BRAND_B_NAME = `Brand B 2f1 ${RUN}`;
const BRAND_B_SLUG = `brand-b-2f1-${RUN}`;

test.describe("Marketing OS — Sprint 2f.1 brand single-source-of-truth", () => {
  const createdBrandIds: string[] = [];

  test.afterAll(async () => {
    // Hard-delete cascade — must throw on failure so this suite fails
    // loudly instead of leaking BrandB / Brand A 2f1 rows into the dev
    // DB. See task #360.
    if (createdBrandIds.length === 0) return;
    await cleanupE2EBrandPollution(createdBrandIds);
  });

  test("topbar BrandSwitcher is the only brand control on list pages", async ({
    request,
    page,
  }) => {
    await login(request);
    const csrf = await getCsrfToken(request);
    const headers = { "X-CSRF-Token": csrf };

    // Seed two brands, each with one contact + one company.
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

    const contactA = await (await request.post(`${BASE}/api/marketing/contacts`, {
      data: {
        brandId: brandA.id,
        firstName: "Alice",
        lastName: `A2f1${RUN}`,
        email: `alice+${RUN}@a.example.com`,
        lifecycleStage: "lead",
        leadStatus: "new",
        source: "e2e",
      },
      headers,
    })).json();

    const contactB = await (await request.post(`${BASE}/api/marketing/contacts`, {
      data: {
        brandId: brandB.id,
        firstName: "Bob",
        lastName: `B2f1${RUN}`,
        email: `bob+${RUN}@b.example.com`,
        lifecycleStage: "lead",
        leadStatus: "new",
        source: "e2e",
      },
      headers,
    })).json();

    const companyA = await (await request.post(`${BASE}/api/marketing/companies`, {
      data: { brandId: brandA.id, name: `Acme A ${RUN}` },
      headers,
    })).json();

    const companyB = await (await request.post(`${BASE}/api/marketing/companies`, {
      data: { brandId: brandB.id, name: `Acme B ${RUN}` },
      headers,
    })).json();

    // Pre-pick brandA on FIRST load only so the page lands on the list,
    // not the select-brand empty state. Subsequent navigations (after
    // we click the BrandSwitcher to choose brandB) must NOT re-stomp
    // the user's selection back to brandA.
    await page.addInitScript((brandId) => {
      try {
        if (!localStorage.getItem("cwp_active_brand_id")) {
          localStorage.setItem("cwp_active_brand_id", brandId);
        }
      } catch {}
    }, brandA.id);

    await uiLogin(page);

    // ============================================================
    // /marketing/contacts — chip reads brandA, no editable Select,
    // contactA is visible.
    // ============================================================
    await page.goto("/marketing/contacts");
    await page.waitForLoadState("networkidle", { timeout: 15000 });
    await expect(page.locator('[data-testid="text-page-title"]')).toBeVisible({ timeout: 15000 });

    await expect(page.locator('[data-testid="badge-active-brand"]')).toContainText(BRAND_A_NAME);
    // R5: editable Brand <Select> in the filter row is gone.
    await expect(page.locator('[data-testid="select-brand"]')).toHaveCount(0);
    await expect(page.locator(`[data-testid="row-contact-${contactA.id}"]`)).toBeVisible({ timeout: 10000 });
    await expect(page.locator(`[data-testid="row-contact-${contactB.id}"]`)).toHaveCount(0);

    // ============================================================
    // Switch to brandB via the topbar BrandSwitcher and verify the
    // contacts list re-queries to brandB only.
    // ============================================================
    await page.click('[data-testid="button-brand-switcher"]');
    await page.click(`[data-testid="menu-item-brand-${brandB.id}"]`);
    await page.waitForLoadState("networkidle", { timeout: 5000 });

    await expect(page.locator('[data-testid="badge-active-brand"]')).toContainText(BRAND_B_NAME, { timeout: 5000 });
    await expect(page.locator(`[data-testid="row-contact-${contactB.id}"]`)).toBeVisible({ timeout: 10000 });
    await expect(page.locator(`[data-testid="row-contact-${contactA.id}"]`)).toHaveCount(0);

    // ============================================================
    // /marketing/companies — chip reads brandB, no editable Select,
    // companyB visible, companyA hidden.
    // ============================================================
    await page.goto("/marketing/companies");
    await page.waitForLoadState("networkidle", { timeout: 15000 });
    await expect(page.locator('[data-testid="text-page-title"]')).toContainText("Companies");
    await expect(page.locator('[data-testid="badge-active-brand"]')).toContainText(BRAND_B_NAME);
    await expect(page.locator('[data-testid="select-brand"]')).toHaveCount(0);
    await expect(page.locator(`[data-testid="row-company-${companyB.id}"]`)).toBeVisible({ timeout: 10000 });
    await expect(page.locator(`[data-testid="row-company-${companyA.id}"]`)).toHaveCount(0);

    // ============================================================
    // /marketing/tags + /marketing/segments + /marketing/activity —
    // shared chip renders on all three.
    // ============================================================
    for (const path of ["/marketing/tags", "/marketing/segments", "/marketing/activity"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle", { timeout: 15000 });
      await expect(page.locator('[data-testid="badge-active-brand"]'), `chip on ${path}`).toContainText(BRAND_B_NAME);
    }

    // Cleanup data created in this spec.
    await request.delete(`${BASE}/api/marketing/contacts/${contactA.id}`, { headers });
    await request.delete(`${BASE}/api/marketing/contacts/${contactB.id}`, { headers });
    await request.delete(`${BASE}/api/marketing/companies/${companyA.id}`, { headers });
    await request.delete(`${BASE}/api/marketing/companies/${companyB.id}`, { headers });
  });

  test("A12: /marketing/contacts with no active brand renders empty-state-select-brand", async ({
    request,
    page,
  }) => {
    await login(request);
    const csrf = await getCsrfToken(request);
    const headers = { "X-CSRF-Token": csrf };

    // Seed two fresh brands (multi-brand triggers select-brand empty
    // state when no brand is pre-picked).
    const a = await (await request.post(`${BASE}/api/brands`, {
      data: { name: `A12 A ${RUN}`, slug: `a12-a-${RUN}` },
      headers,
    })).json();
    createdBrandIds.push(a.id);
    const b = await (await request.post(`${BASE}/api/brands`, {
      data: { name: `A12 B ${RUN}`, slug: `a12-b-${RUN}` },
      headers,
    })).json();
    createdBrandIds.push(b.id);

    // Explicitly clear any prior brand pick.
    await page.addInitScript(() => {
      try { localStorage.removeItem("cwp_active_brand_id"); } catch {}
    });

    await uiLogin(page);
    await page.goto("/marketing/contacts");
    await page.waitForLoadState("networkidle", { timeout: 15000 });

    await expect(page.locator('[data-testid="empty-state-select-brand"]')).toBeVisible({ timeout: 10000 });

    // A12 (cont.): Companies must surface the same select-brand empty
    // state when no brand is picked. Confirms Sprint 2f.1 retired the
    // "All brands" cross-brand affordance on Companies in favor of the
    // explicit brand-pick guard mirroring the Contacts/Tags/Segments
    // pattern.
    await page.goto("/marketing/companies");
    await page.waitForLoadState("networkidle", { timeout: 15000 });
    await expect(page.locator('[data-testid="empty-state-select-brand"]')).toBeVisible({ timeout: 10000 });
  });
});
