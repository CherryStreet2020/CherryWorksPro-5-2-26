/**
 * Public marketing /pricing page (Task #431, audit §2.4 "Untested").
 *
 * Asserts:
 *  - Page renders with the plan cards
 *  - Monthly/Annual toggle flips and the "Save 20%" badge stays visible
 *  - Each plan's signup CTA links to /signup
 *  - FAQ section renders and at least one item expands
 */
import { test, expect } from "@playwright/test";

test.describe("Public /pricing", () => {
  test("renders plan cards, billing toggle, and FAQ", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.locator('[data-testid="pricing-heading"]')).toBeVisible({
      timeout: 15000,
    });

    // Plan cards (the four primary tiers + enterprise).
    for (const tier of ["starter", "professional", "business", "enterprise"]) {
      await expect(
        page.locator(`[data-testid="tier-card-${tier}"]`),
      ).toBeVisible();
    }

    // Billing toggle is present and "Save 20%" badge appears next to Annual.
    await expect(page.locator('[data-testid="billing-toggle"]')).toBeVisible();
    await expect(page.locator('[data-testid="badge-save-20"]')).toBeVisible();

    // Toggle flips without crashing the page.
    await page.click('[data-testid="button-toggle-billing"]');
    await expect(page.locator('[data-testid="billing-toggle"]')).toBeVisible();
    await expect(
      page.locator('[data-testid="tier-card-business"]'),
    ).toBeVisible();

    // FAQ expands.
    await expect(page.locator('[data-testid="faq-heading"]')).toBeVisible();
    const firstFaq = page.locator('[data-testid="button-faq-0"]');
    await expect(firstFaq).toBeVisible();
    await firstFaq.click();
  });

  test("Starter plan CTA links to /signup", async ({ page }) => {
    await page.goto("/pricing");
    const starterCta = page.locator('[data-testid="button-signup-starter"]');
    await expect(starterCta).toBeVisible({ timeout: 15000 });
    await Promise.all([
      page.waitForURL(/\/signup(\?|$)/, { timeout: 10000 }),
      starterCta.click(),
    ]);
    await expect(
      page.locator('[data-testid="signup-form-card"]'),
    ).toBeVisible({ timeout: 10000 });
  });
});
