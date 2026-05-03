/**
 * /payouts page render (Task #431, audit §2.1 "Untested").
 * AdminRoute. Verifies the page paints and the "New payout" CTA opens
 * the payout form. Real Stripe Connect interaction is deferred.
 */
import { test, expect } from "@playwright/test";
import { loginViaPage } from "../tests/helpers/po/auth";

test.describe("/payouts (admin)", () => {
  test("renders and opens the new-payout dialog", async ({ page }) => {
    await loginViaPage(page);
    await page.goto("/payouts");

    const newBtn = page.locator('[data-testid="button-new-payout"]');
    const gate = page.locator("text=Mission Control").first();
    await expect(newBtn.or(gate)).toBeVisible({ timeout: 15000 });
    if (await gate.isVisible().catch(() => false)) {
      test.skip(true, "AdminSetupGate active; see audit §6.1");
      return;
    }

    await newBtn.click();
    // Either there are eligible team members (dropdown) OR the empty
    // state ("No team members") renders. Both are valid outcomes; the
    // important contract is that the dialog opened without crashing.
    const select = page.locator('[data-testid="select-payout-team-member"]');
    const empty = page.locator('[data-testid="text-no-team-members"]');
    await expect(select.or(empty)).toBeVisible({ timeout: 10000 });
  });
});
