/**
 * /profile page render + basic interactions
 * (Task #431, audit §2.1 "Untested").
 */
import { test, expect } from "@playwright/test";
import { loginViaPage } from "../tests/helpers/po/auth";

test.describe("/profile", () => {
  test("renders personal info form for an authed user", async ({ page }) => {
    await loginViaPage(page);
    await page.goto("/profile");

    // /profile is one of the few routes the AdminSetupGate does NOT swallow.
    await expect(
      page.locator('[data-testid="input-profile-firstName"]'),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.locator('[data-testid="input-profile-lastName"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="text-profile-email"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="button-save-profile"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="link-change-password"]'),
    ).toBeVisible();
  });
});
