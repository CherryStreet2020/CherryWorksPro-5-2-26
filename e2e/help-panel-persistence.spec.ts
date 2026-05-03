/**
 * Help panel persistence across navigation (Task #444).
 *
 * Audit gap: opening the Knowledge Base on one route and navigating
 * to another silently closes it. The help panel uses local React
 * state (no URL/query/storage backing), so a route change unmounts
 * the parent layout and resets `open` to false.
 *
 * Marked `test.fixme` — the test encodes the EXPECTED behaviour
 * (panel stays open across nav) so when the bug is fixed the spec
 * starts asserting the contract immediately. See follow-up #455.
 */
import { test, expect } from "../tests/helpers/po/fixtures";
import { loginIsolated, gotoWithRetry } from "./_iso-helpers";

test.use({ navigationTimeout: 30_000 });

test.describe("Help panel — persistence (known regression)", () => {
  test.fixme("stays open across in-app navigation", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);
    await gotoWithRetry(page, "/dashboard");
    await page.locator('[data-testid="button-help"]').click();
    await expect(page.locator('[data-testid="help-panel"]')).toBeVisible({ timeout: 10_000 });

    await page.goto("/clients");
    // Expected (per follow-up): panel still open after a route change.
    await expect(page.locator('[data-testid="help-panel"]')).toBeVisible({ timeout: 10_000 });
  });
});
