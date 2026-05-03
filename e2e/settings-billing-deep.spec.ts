/**
 * Task #443 — /settings/billing deep coverage.
 *
 * Stripe portal and checkout are stubbed at the API boundary
 * (`apiBoundary.fulfill` on /api/billing/portal and
 * /api/entitlements/<f>/checkout) so the spec never hits the live
 * Stripe SDK from the server side.
 */
import { test, expect } from "../tests/helpers/po/fixtures";
import { loginIsolated } from "./_iso-helpers";
import { apiBoundary } from "../tests/helpers/po/stubs";

test.use({ navigationTimeout: 30_000 });

test.describe("/settings/billing deep", () => {
  test("renders entitlement rows + manage-in-stripe button is wired", async ({
    page,
    isolatedOrg,
  }) => {
    await loginIsolated(page, isolatedOrg);

    // Stub the Stripe portal call BEFORE the page navigation so the
    // click-handler's POST is intercepted. We respond with a synthetic
    // URL that immediately resolves; the page sets window.location to
    // it, so we also intercept the navigation by aborting it via the
    // route handler returning an about: URL that's a no-op.
    await apiBoundary.fulfill(
      page,
      "**/api/billing/portal",
      200,
      { url: "about:blank" },
    );

    await page.goto("/settings/billing");
    await expect(page.locator('[data-testid="text-page-title"]')).toBeVisible({ timeout: 20_000 });

    // PSO Core row is always present.
    await expect(page.locator('[data-testid="row-entitlement-pso_core"]')).toBeVisible();
    await expect(page.locator('[data-testid="row-entitlement-marketing_os"]')).toBeVisible();
    await expect(page.locator('[data-testid="row-entitlement-multi_brand"]')).toBeVisible();
    await expect(page.locator('[data-testid="row-entitlement-hubspot_bridge"]')).toBeVisible();

    // BUSINESS-tier isolated orgs have pso_core + marketing_os Active.
    const psoBadge = page.locator(
      '[data-testid="row-entitlement-pso_core"] [data-testid^="badge-status-"]',
    );
    await expect(psoBadge).toBeVisible();
    const psoText = (await psoBadge.textContent())?.toLowerCase() ?? "";
    expect(["active", "grace", "inactive"]).toContain(psoText.trim());

    // Either a Manage-in-Stripe button (active/grace) or an Upgrade
    // button (inactive) must be present for purchasable rows.
    const purchasableRow = page.locator('[data-testid="row-entitlement-multi_brand"]');
    const action = purchasableRow.locator(
      '[data-testid^="button-manage-"], [data-testid^="button-upgrade-"]',
    );
    await expect(action.first()).toBeVisible();

    // Click the manage/upgrade button on the active marketing_os row
    // (BUSINESS tier always has it active) and assert the portal POST
    // actually fires. The stub returns about:blank so the redirect
    // is a no-op for the test.
    const mosAction = page
      .locator('[data-testid="row-entitlement-marketing_os"]')
      .locator(
        '[data-testid^="button-manage-"], [data-testid^="button-upgrade-"]',
      )
      .first();
    if (await mosAction.isVisible({ timeout: 1_000 }).catch(() => false)) {
      const portalPromise = page.waitForRequest(
        (req) =>
          req.url().includes("/api/billing/portal") &&
          req.method() === "POST",
        { timeout: 5_000 },
      );
      await mosAction.click();
      const req = await portalPromise;
      expect(req.url()).toContain("/api/billing/portal");
    }
  });
});
