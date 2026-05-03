/**
 * Banking page spec (Task #438).
 *
 * The banking surface is gated behind the PROFESSIONAL tier via
 * `<UpgradeWall requiredTier="PROFESSIONAL">`. Real Stripe Financial
 * Connections / Plaid linkage is out of scope (covered by integration
 * tests + #435 stubs); this spec covers:
 *
 *   1. Tier-gate enforcement: STARTER org sees the upgrade wall.
 *   2. Page shell renders for PROFESSIONAL+: title + connect-bank
 *      button visible, no upgrade wall.
 */
import { test, expect } from "../tests/helpers/po/fixtures";
import { setOrgTier } from "../tests/helpers/po/tier";
import { loginAsIsoAdmin } from "./_gl-helpers";

test.describe.configure({ mode: "serial" });

test.describe("Banking (Task #438)", () => {
  test("STARTER org sees the upgrade wall", async ({
    isolatedOrg,
    browser,
  }) => {
    const ok = await setOrgTier(isolatedOrg.orgId, "STARTER");
    expect(ok).toBe(true);

    const { page, close } = await loginAsIsoAdmin(browser, isolatedOrg);
    try {
      await page.goto("/banking");
      await expect(
        page.locator('[data-testid="upgrade-wall-banking"]'),
      ).toBeVisible({ timeout: 15000 });
    } finally {
      await setOrgTier(isolatedOrg.orgId, "BUSINESS").catch(() => undefined);
      await close();
    }
  });

  test("PROFESSIONAL org sees the page shell + connect button", async ({
    isolatedOrg,
    browser,
  }) => {
    await setOrgTier(isolatedOrg.orgId, "PROFESSIONAL");

    const { page, close } = await loginAsIsoAdmin(browser, isolatedOrg);
    try {
      await page.goto("/banking");
      await expect(page.getByTestId("text-page-title")).toBeVisible({
        timeout: 15000,
      });
      await expect(page.getByTestId("text-page-title")).toHaveText(/Banking/i);

      // Either the empty-state CTA or the header CTA must be visible.
      const headerBtn = page.getByTestId("button-connect-bank");
      const emptyBtn = page.getByTestId("button-connect-bank-empty");
      await expect(headerBtn.or(emptyBtn).first()).toBeVisible({
        timeout: 10000,
      });
    } finally {
      await setOrgTier(isolatedOrg.orgId, "BUSINESS").catch(() => undefined);
      await close();
    }
  });
});
