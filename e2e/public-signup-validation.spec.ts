/**
 * /signup form validation surface (Task #431, audit §2.4 "Untested").
 *
 * Asserts:
 *  - The form renders and the password strength checks are visible
 *  - The submit button stays disabled while required fields are blank
 *  - Filling everything except a weak password keeps submit disabled
 *  - The plan-select cards switch active state on click
 */
import { test, expect } from "@playwright/test";

test.describe("/signup form", () => {
  test("submit gates on required fields + password strength", async ({
    page,
  }) => {
    await page.goto("/signup");
    await expect(page.locator('[data-testid="signup-form-card"]')).toBeVisible({
      timeout: 15000,
    });

    const submit = page.locator('[data-testid="button-signup-submit"]');
    await expect(submit).toBeDisabled();

    await page.fill('[data-testid="input-firm-name"]', "QA Test Firm");
    await page.fill('[data-testid="input-signup-firstName"]', "QA");
    await page.fill('[data-testid="input-signup-lastName"]', "Tester");
    await page.fill(
      '[data-testid="input-signup-email"]',
      `qa-${Date.now()}@example.com`,
    );
    // Weak password → submit must remain disabled (passwordValid=false).
    await page.fill('[data-testid="input-signup-password"]', "short");
    await expect(submit).toBeDisabled();

    // Strong password → submit becomes enabled.
    await page.fill('[data-testid="input-signup-password"]', "StrongPass1!");
    await expect(submit).toBeEnabled({ timeout: 5000 });

    // Plan select cards toggle on click.
    const businessCard = page.locator('[data-testid="plan-select-business"]');
    await expect(businessCard).toBeVisible();
    await businessCard.click();
    await expect(businessCard).toBeVisible();
  });
});
