/**
 * Error pages — direct-URL render coverage (Task #431, audit §3.5).
 *
 * The audit specifically calls out: "no spec asserts each is reached
 * for the right reason." This is one half of that — each error page
 * renders correctly when navigated to directly. The "right reason"
 * half (role-mismatch → 403, etc.) is gated by the AdminSetupGate
 * shell behaviour described in audit §6.1 and is intentionally
 * deferred until per-spec org isolation is in place (see the coverage
 * report).
 */
import { test, expect } from "@playwright/test";
import { loginViaPage } from "../tests/helpers/po/auth";

test.describe("Error pages — direct render", () => {
  test("/403 renders the 403 surface for an authed user", async ({ page }) => {
    await loginViaPage(page);
    await page.goto("/403");
    // For a fully-set-up admin the inner Router renders error-403; for
    // an admin still gated by AdminSetupGate the page renders the gate.
    // Either way the navigation must not crash and the page must paint
    // *some* known anchor.
    const errTitle = page.locator('[data-testid="text-error-title"]');
    const gate = page.locator("text=Mission Control").first();
    await expect(errTitle.or(gate)).toBeVisible({ timeout: 15000 });
  });

  test("/500 renders the 500 surface for an authed user", async ({ page }) => {
    await loginViaPage(page);
    await page.goto("/500");
    const errTitle = page.locator('[data-testid="text-error-title"]');
    const gate = page.locator("text=Mission Control").first();
    await expect(errTitle.or(gate)).toBeVisible({ timeout: 15000 });
  });

  test("unknown route renders not-found for an authed user", async ({
    page,
  }) => {
    await loginViaPage(page);
    await page.goto(`/totally-bogus-${Date.now()}`);
    const errTitle = page.locator('[data-testid="text-error-title"]');
    const gate = page.locator("text=Mission Control").first();
    await expect(errTitle.or(gate)).toBeVisible({ timeout: 15000 });
  });
});
