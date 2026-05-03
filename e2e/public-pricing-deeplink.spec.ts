/**
 * Public /pricing — plan-card → /signup deep-link verification
 * (Task #442 step 3).
 *
 * The marketing pricing card links to `/signup?plan=<tier>` (with
 * `&annual=true` when the annual toggle is active). Stripe Checkout
 * itself happens after signup → covered by the Stripe lifecycle
 * spec (#439). This spec asserts the marketing-side contract: the
 * right plan + billing period reach /signup as URL params.
 */
import { test, expect } from "@playwright/test";

test.use({ navigationTimeout: 30_000 });

const TIERS = ["starter", "professional", "business"] as const;

test.describe("Public /pricing — plan-card deep-links", () => {
  test("monthly toggle: each tier CTA links to /signup?plan=<tier>", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.locator('[data-testid="pricing-heading"]')).toBeVisible({ timeout: 15000 });

    for (const tier of TIERS) {
      const cta = page.locator(`[data-testid="button-signup-${tier}"]`);
      await expect(cta).toBeVisible();
      // Anchor href is stable; assert without navigating between tiers.
      const href = await cta.locator("xpath=ancestor::a[1]").getAttribute("href");
      expect(href, `${tier} CTA href`).toBe(`/signup?plan=${tier}`);
    }
  });

  test("annual toggle: each tier CTA appends &annual=true", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.locator('[data-testid="pricing-heading"]')).toBeVisible({ timeout: 15000 });

    await page.click('[data-testid="button-toggle-billing"]');
    // Sanity: toggle still mounted after flip
    await expect(page.locator('[data-testid="billing-toggle"]')).toBeVisible();

    for (const tier of TIERS) {
      const cta = page.locator(`[data-testid="button-signup-${tier}"]`);
      const href = await cta.locator("xpath=ancestor::a[1]").getAttribute("href");
      expect(href, `${tier} annual CTA href`).toBe(`/signup?plan=${tier}&annual=true`);
    }
  });

  test("clicking a plan CTA lands on /signup with the expected query", async ({ page }) => {
    await page.goto("/pricing");
    await page.click('[data-testid="button-toggle-billing"]');
    const cta = page.locator('[data-testid="button-signup-business"]');
    await expect(cta).toBeVisible();
    await Promise.all([
      page.waitForURL(/\/signup\?plan=business&annual=true/, { timeout: 15000 }),
      cta.click(),
    ]);
    await expect(page.locator('[data-testid="signup-form-card"]')).toBeVisible({ timeout: 15000 });
  });

  test("Enterprise tier routes to /contact", async ({ page }) => {
    await page.goto("/pricing");
    const enterprise = page.locator('[data-testid="tier-card-enterprise"]');
    await enterprise.scrollIntoViewIfNeeded();
    await expect(enterprise).toBeVisible();
    const link = enterprise.getByRole("link").first();
    await Promise.all([
      page.waitForURL(/\/contact(\?|$)/, { timeout: 15000 }),
      link.click(),
    ]);
    await expect(page.locator('[data-testid="input-contact-name"]')).toBeVisible({ timeout: 15000 });
  });
});
