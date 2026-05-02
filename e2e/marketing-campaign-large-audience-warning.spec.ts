/**
 * Task #321 — End-to-end coverage for the campaign large-audience warning.
 *
 * Task #294 added a soft amber warning (`warning-audience-large`) to the
 * campaign editor when /api/marketing/campaigns/audience-preview returns
 * `isLarge: true`. There is no automated test pinning this behavior, so
 * a future refactor of the editor or the preview endpoint could silently
 * re-enable accidental large blasts.
 *
 * Strategy:
 *   Seeding 1,000+ contacts per run would be slow and noisy. Instead we
 *   stub the audience-preview response with Playwright's route
 *   interception, so this spec exercises the editor's rendering path
 *   without depending on the threshold's exact value or seed scale.
 *
 * Assertions:
 *   - Large case (isLarge=true, count=1500): the warning is visible and
 *     `text-warning-large-count` shows the count formatted as "1,500".
 *   - Small case (isLarge=false, count=12): the warning is hidden and
 *     the preview line shows the small recipient count instead.
 */
process.env.MARKETING_OS_ENABLED = "true";
process.env.VITE_MARKETING_OS_ENABLED = "true";

import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { cleanupE2EBrandPollution } from "../scripts/cleanup-e2e-brand-pollution";
import { pool } from "../server/db";

const BASE = `http://localhost:${process.env.PORT || 5000}`;
const ADMIN_EMAIL = "admin.test@cwpro.dev";
const ADMIN_PASS = "admin123";
const ADMIN_ORG_SLUG = "cwpro-dev-qa";

async function login(request: APIRequestContext) {
  const first = await request.post(`${BASE}/api/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASS },
  });
  expect(first.status()).toBe(200);
  const body = await first.json();
  if (body?.needsOrgPick && Array.isArray(body.orgs) && body.orgs.length > 0) {
    const preferred = body.orgs.find((o: { slug: string }) => o.slug === ADMIN_ORG_SLUG)
      ?? body.orgs[0];
    const second = await request.post(`${BASE}/api/auth/login`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASS, orgSlug: preferred.slug },
    });
    expect(second.status()).toBe(200);
  }
}

async function getCsrfToken(request: APIRequestContext): Promise<string> {
  const r = await request.get(`${BASE}/api/csrf-token`);
  expect(r.status()).toBe(200);
  return r.headers()["x-csrf-token"] || "";
}

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const BRAND_NAME = `Large Audience Warn E2E ${RUN}`;
const BRAND_SLUG = `large-audience-warn-e2e-${RUN}`;

async function openCampaignEditor(page: Page, brandId: string) {
  await page.addInitScript((id) => {
    try {
      localStorage.setItem("cwp_active_brand_id", id);
    } catch {
      /* swallow */
    }
  }, brandId);

  await page.goto("/");
  await page.waitForResponse(
    (r) => r.url().includes("/api/auth/me") && r.status() === 200,
    { timeout: 15_000 },
  );
  await page.waitForResponse(
    (r) => r.url().includes("/api/me/entitlements") && r.status() === 200,
    { timeout: 15_000 },
  );

  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/me/entitlements") && r.status() === 200,
      { timeout: 20_000 },
    ),
    page.goto("/marketing/campaigns"),
  ]);
  await page.waitForLoadState("networkidle", { timeout: 15_000 });
  await expect(page.locator('[data-testid="text-page-title"]'))
    .toBeVisible({ timeout: 20_000 });

  await page.click('[data-testid="button-new-campaign"]');
  await expect(page.locator('[data-testid="form-create-campaign"]')).toBeVisible();
}

test.describe("Marketing OS — campaign large-audience warning (Task #321)", () => {
  const createdBrandIds: string[] = [];
  let brandId: string;

  test.beforeAll(async () => {
    // Marketing OS feature gate must be ON for the editor to render.
    await pool.query(
      `INSERT INTO org_entitlements (org_id, feature, active, activated_at)
         SELECT id, 'marketing_os', true, now() FROM orgs WHERE slug = $1
       ON CONFLICT (org_id, feature) DO UPDATE SET active = true`,
      [ADMIN_ORG_SLUG],
    );
  });

  test.afterAll(async () => {
    try {
      await cleanupE2EBrandPollution(createdBrandIds);
    } catch (err) {
      console.error("[marketing-campaign-large-audience-warning afterAll] cleanup failed:", err);
    }
  });

  test("shows warning with formatted count when audience-preview reports isLarge=true", async ({ page }) => {
    test.setTimeout(120_000);

    const request = page.context().request;
    await login(request);
    const csrf = await getCsrfToken(request);
    const headers = { "X-CSRF-Token": csrf };

    // Provision a brand so the campaigns page can load with an active brand.
    if (!brandId) {
      const brandRes = await request.post(`${BASE}/api/brands`, {
        data: { name: BRAND_NAME, slug: BRAND_SLUG },
        headers,
      });
      expect(brandRes.status()).toBe(201);
      const brand = await brandRes.json();
      brandId = brand.id;
      createdBrandIds.push(brandId);
    }

    // Stub the audience-preview endpoint to return a large count BEFORE
    // navigation so the very first preview the editor sees is "large".
    await page.route("**/api/marketing/campaigns/audience-preview*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ count: 1500, threshold: 1000, isLarge: true }),
      });
    });

    await openCampaignEditor(page, brandId);

    const warning = page.locator('[data-testid="warning-audience-large"]');
    await expect(warning).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="text-warning-large-count"]'))
      .toHaveText("1,500", { timeout: 5_000 });
    // The preview line itself should reflect the same count.
    await expect(page.locator('[data-testid="text-audience-preview"]'))
      .toHaveText("≈ 1,500 recipients", { timeout: 5_000 });
  });

  test("hides warning when audience-preview reports isLarge=false", async ({ page }) => {
    test.setTimeout(120_000);

    const request = page.context().request;
    await login(request);
    const csrf = await getCsrfToken(request);
    const headers = { "X-CSRF-Token": csrf };

    // Reuse the brand from the first test if it ran; otherwise create one.
    if (!brandId) {
      const brandRes = await request.post(`${BASE}/api/brands`, {
        data: { name: BRAND_NAME, slug: BRAND_SLUG },
        headers,
      });
      expect(brandRes.status()).toBe(201);
      const brand = await brandRes.json();
      brandId = brand.id;
      createdBrandIds.push(brandId);
    }

    await page.route("**/api/marketing/campaigns/audience-preview*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ count: 12, threshold: 1000, isLarge: false }),
      });
    });

    await openCampaignEditor(page, brandId);

    // Wait for the preview line to settle on the small count, then assert
    // that the warning never rendered.
    await expect(page.locator('[data-testid="text-audience-preview"]'))
      .toHaveText("≈ 12 recipients", { timeout: 10_000 });
    await expect(page.locator('[data-testid="warning-audience-large"]')).toHaveCount(0);
  });
});
