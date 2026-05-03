import { test, expect } from "../tests/helpers/po/fixtures";
import { loginIsolated, gotoWithRetry } from "./_iso-helpers";

test.use({ navigationTimeout: 30_000 });

test.describe("Help panel — persistence", () => {
  test.fixme(
    "auto-closes after at least three in-app navigations",
    async ({ page, isolatedOrg }) => {
      await loginIsolated(page, isolatedOrg);
      await gotoWithRetry(page, "/dashboard");
      await page.locator('[data-testid="button-help"]').click();
      const panel = page.locator('[data-testid="help-panel"]');
      await expect(panel).toBeVisible({ timeout: 10_000 });

      for (const path of ["/clients", "/invoices", "/expenses"]) {
        await gotoWithRetry(page, path);
      }
      await expect(panel).toHaveCount(0, { timeout: 10_000 });
    },
  );

  test("the help FAB is reachable on every authed route", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);
    for (const path of ["/dashboard", "/clients", "/invoices", "/expenses"]) {
      await gotoWithRetry(page, path);
      await expect(page.locator('[data-testid="button-help"]').first()).toBeVisible({
        timeout: 15_000,
      });
    }
  });
});
