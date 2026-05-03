/**
 * /login failure surface (Task #431, audit §3.1).
 *
 * Asserts:
 *  - Bad credentials surface the inline error and do NOT navigate away
 *  - The "Forgot password" link routes to /forgot-password
 */
import { test, expect } from "@playwright/test";

test.describe("/login — failure surface", () => {
  test("bad credentials show inline error and stay on /login", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.fill(
      '[data-testid="input-email"]',
      `nope-${Date.now()}@example.com`,
    );
    await page.fill('[data-testid="input-password"]', "WrongPassword1!");
    await page.click('[data-testid="button-login"]');

    const err = page.locator('[data-testid="text-login-error"]').first();
    await expect(err).toBeVisible({ timeout: 15000 });
    expect(page.url()).toContain("/login");
  });

  test("Forgot password link navigates to /forgot-password", async ({
    page,
  }) => {
    await page.goto("/login");
    await Promise.all([
      page.waitForURL(/\/forgot-password/, { timeout: 10000 }),
      page.click('[data-testid="link-forgot-password"]'),
    ]);
    await expect(
      page.locator('[data-testid="heading-reset-password"]'),
    ).toBeVisible({ timeout: 15000 });
  });
});
