/**
 * /reset-password/:token invalid-token state
 * (Task #431, audit §2.1 "/reset-password — Untested").
 *
 * Asserts:
 *  - Visiting the route with an obviously-bogus token renders the
 *    "invalid / expired" surface, not a JS crash or a generic 404.
 */
import { test, expect } from "@playwright/test";

test.describe("/reset-password/:token — invalid token", () => {
  test("renders the expired/invalid state for a bogus token", async ({
    page,
  }) => {
    await page.goto(`/reset-password/${"deadbeef".repeat(8)}`);
    // The page either shows the invalid notice OR shows the form first
    // and only flips to "invalid" after the user submits. Some routes
    // surface the invalid state on a server-side check at mount; in
    // either case one of these testids must eventually appear.
    const invalid = page.locator('[data-testid="text-reset-invalid"]');
    const form = page.locator('[data-testid="input-new-password"]');
    await expect(invalid.or(form)).toBeVisible({ timeout: 15000 });

    if (await form.isVisible().catch(() => false)) {
      // Try to submit a strong password against the invalid token.
      await page.fill('[data-testid="input-new-password"]', "StrongPass1!");
      await page.fill(
        '[data-testid="input-confirm-password"]',
        "StrongPass1!",
      );
      await page.click('[data-testid="button-reset-password"]');
      // Either the explicit invalid view OR the inline error must surface.
      const inlineError = page.locator('[data-testid="text-reset-error"]');
      await expect(invalid.or(inlineError)).toBeVisible({ timeout: 15000 });
    }
  });
});
