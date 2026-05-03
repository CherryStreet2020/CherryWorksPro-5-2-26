/**
 * /forgot-password flow (Task #431, audit §3.1 "Password reset → No E2E").
 *
 * Asserts:
 *  - The form renders and validates a missing email
 *  - Submitting a real-looking email shows the success acknowledgement
 *    state (the server intentionally returns 200 to prevent enumeration,
 *    so we verify the UI ack regardless of whether the address exists)
 */
import { test, expect } from "@playwright/test";

test.describe("/forgot-password", () => {
  test("renders, validates, and acknowledges submission", async ({ page }) => {
    await page.goto("/forgot-password");
    await expect(
      page.locator('[data-testid="heading-reset-password"]'),
    ).toBeVisible({ timeout: 15000 });

    const submit = page.locator('[data-testid="button-send-reset"]');
    await expect(submit).toBeVisible();

    // Empty email → button is disabled or HTML5 validation blocks submit;
    // either way no acknowledgement appears.
    await submit.click().catch(() => undefined);
    await expect(
      page.locator('[data-testid="text-reset-sent"]'),
    ).toHaveCount(0);

    // Fill a syntactically valid email and submit.
    await page.fill(
      '[data-testid="input-forgot-email"]',
      `qa-forgot-${Date.now()}@example.com`,
    );
    await submit.click();

    // Server is intentionally indistinguishable for known/unknown addresses.
    await expect(
      page.locator('[data-testid="text-reset-sent"]'),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.locator('[data-testid="link-back-to-login"]'),
    ).toBeVisible();
  });
});
