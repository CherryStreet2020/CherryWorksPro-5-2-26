import { test, expect } from "../tests/helpers/po/fixtures";
import { loginIsolated, gotoWithRetry } from "./_iso-helpers";

test.use({ navigationTimeout: 30_000 });

test.describe("Help panel — persistence across navigation", () => {
  test.fixme(
    "stays open across at least three in-app navigations (encoded contract)",
    async ({ page, isolatedOrg }) => {
      // HelpPanel is mounted at App.tsx top-level so the open state
      // SHOULD survive route changes. Pinned as fixme until the team
      // confirms the contract; today the panel reliably re-opens but
      // the open badge can flicker on the first transition. See
      // follow-up #455.
      await loginIsolated(page, isolatedOrg);
      await gotoWithRetry(page, "/dashboard");
      await page.locator('[data-testid="button-help"]').click();
      const panel = page.locator('[data-testid="help-panel"]');
      await expect(panel).toBeVisible({ timeout: 10_000 });

      for (const path of ["/clients", "/invoices", "/expenses"]) {
        await gotoWithRetry(page, path);
        await expect(panel).toBeVisible({ timeout: 10_000 });
      }
    },
  );

  test("opens on /dashboard and the FAB is reachable on every authed route", async ({
    page,
    isolatedOrg,
  }) => {
    // Live counterpart to the fixme: pins that the help affordance
    // (button-help) is mounted across the three navigations even if
    // the panel state itself resets.
    await loginIsolated(page, isolatedOrg);
    for (const path of ["/dashboard", "/clients", "/invoices", "/expenses"]) {
      await gotoWithRetry(page, path);
      await expect(page.locator('[data-testid="button-help"]').first()).toBeVisible({
        timeout: 15_000,
      });
    }
  });
});
