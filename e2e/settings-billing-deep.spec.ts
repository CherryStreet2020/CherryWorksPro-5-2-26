import { test, expect } from "../tests/helpers/po/fixtures";
import { loginIsolated } from "./_iso-helpers";
import { apiBoundary } from "../tests/helpers/po/stubs";

test.use({ navigationTimeout: 30_000 });

test.describe("/settings/billing deep", () => {
  test("renders four entitlement rows with status badges", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);
    await page.goto("/settings/billing");
    await expect(page.locator('[data-testid="text-page-title"]')).toBeVisible({ timeout: 20_000 });

    for (const k of ["pso_core", "marketing_os", "multi_brand", "hubspot_bridge"]) {
      const row = page.locator(`[data-testid="row-entitlement-${k}"]`);
      await expect(row, `row-entitlement-${k}`).toBeVisible();
      const badge = row.locator('[data-testid^="badge-status-"]');
      await expect(badge).toBeVisible();
      const txt = (await badge.textContent())?.toLowerCase().trim() ?? "";
      expect(["active", "grace", "inactive"]).toContain(txt);
    }
  });

  test("inactive multi_brand row Upgrade POSTs /api/entitlements/multi_brand/checkout (stubbed details)", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);
    await apiBoundary.fulfill(page, "**/api/entitlements/multi_brand/checkout", 200, { url: "about:blank" });
    // Pin entitlement state so multi_brand is deterministically inactive
    // (and thus the Upgrade → checkout path is exercised regardless of the
    // org's seeded plan tier).
    await page.route("**/api/me/entitlements/details", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          pso_core: { active: true, gracePeriodEndsAt: null, tierDerived: true },
          marketing_os: { active: true, gracePeriodEndsAt: null, tierDerived: true },
          multi_brand: { active: false, gracePeriodEndsAt: null, tierDerived: false },
          hubspot_bridge: { active: false, gracePeriodEndsAt: null, tierDerived: false },
        }),
      });
    });

    await page.goto("/settings/billing");
    const mbRow = page.locator('[data-testid="row-entitlement-multi_brand"]');
    await expect(mbRow).toBeVisible({ timeout: 20_000 });
    await expect(mbRow.locator('[data-testid="badge-status-inactive"]')).toBeVisible();

    const upgrade = mbRow.locator('[data-testid="button-upgrade-multi_brand"]');
    await expect(upgrade).toBeVisible();
    const checkoutPromise = page.waitForRequest(
      (r) => r.url().includes("/api/entitlements/multi_brand/checkout") && r.method() === "POST",
      { timeout: 8_000 },
    );
    await upgrade.click();
    const req = await checkoutPromise;
    expect(req.url()).toContain("/api/entitlements/multi_brand/checkout");
  });

  test("active multi_brand row Manage POSTs /api/billing/portal (stubbed details)", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);
    await apiBoundary.fulfill(page, "**/api/billing/portal", 200, { url: "about:blank" });
    await page.route("**/api/me/entitlements/details", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          pso_core: { active: true, gracePeriodEndsAt: null, tierDerived: true },
          marketing_os: { active: true, gracePeriodEndsAt: null, tierDerived: true },
          multi_brand: { active: true, gracePeriodEndsAt: null, tierDerived: false },
          hubspot_bridge: { active: false, gracePeriodEndsAt: null, tierDerived: false },
        }),
      });
    });

    await page.goto("/settings/billing");
    const mbRow = page.locator('[data-testid="row-entitlement-multi_brand"]');
    await expect(mbRow).toBeVisible({ timeout: 20_000 });
    await expect(mbRow.locator('[data-testid="badge-status-active"]')).toBeVisible();

    const manage = mbRow.locator('[data-testid="button-manage-multi_brand"]');
    await expect(manage).toBeVisible();
    const portalPromise = page.waitForRequest(
      (r) => r.url().includes("/api/billing/portal") && r.method() === "POST",
      { timeout: 8_000 },
    );
    await manage.click();
    const req = await portalPromise;
    expect(req.url()).toContain("/api/billing/portal");
  });

  test("upgrade-plan-marketing_os button is wired and POSTs portal when shown", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);
    await apiBoundary.fulfill(page, "**/api/billing/portal", 200, { url: "about:blank" });

    await page.goto("/settings/billing");
    await expect(page.locator('[data-testid="text-page-title"]')).toBeVisible({ timeout: 20_000 });

    const upgradePlan = page.locator('[data-testid="button-upgrade-plan-marketing_os"]');
    const cnt = await upgradePlan.count();
    if (cnt === 1) {
      const portalPromise = page.waitForRequest(
        (r) => r.url().includes("/api/billing/portal") && r.method() === "POST",
        { timeout: 8_000 },
      );
      await upgradePlan.click();
      const req = await portalPromise;
      expect(req.url()).toContain("/api/billing/portal");
    } else {
      const mosBadge = page.locator('[data-testid="row-entitlement-marketing_os"] [data-testid^="badge-status-"]');
      await expect(mosBadge).toContainText(/active|grace/i);
    }
  });
});
