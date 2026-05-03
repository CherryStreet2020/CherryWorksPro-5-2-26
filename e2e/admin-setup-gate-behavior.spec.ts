import { test, expect } from "../tests/helpers/po/fixtures";
import { loginIsolated, gotoWithRetry } from "./_iso-helpers";
import {
  completeFirmProfile,
  clearFirmProfile,
} from "../tests/helpers/po/setup-gate";
import { setEntitlement } from "../tests/helpers/po/tier";

test.use({ navigationTimeout: 30_000, firmProfileComplete: false });

const GATED_ROUTES = [
  "/dashboard",
  "/invoices",
  "/clients",
  "/expenses",
  "/payments",
  "/projects",
  "/reports",
  "/admin/data",
];

const ALLOW_LIST = ["/getting-started", "/profile"];

const banner = '[data-testid="banner-firm-profile-incomplete"]';

test.describe("AdminSetupGate — gated route matrix", () => {
  for (const path of GATED_ROUTES) {
    test(`gates ${path} when firm profile is incomplete`, async ({
      page,
      isolatedOrg,
    }) => {
      await loginIsolated(page, isolatedOrg);
      await gotoWithRetry(page, path);
      await expect(page.locator(banner)).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('[data-testid="kpi-revenue"]')).toHaveCount(0);
    });
  }
});

test.describe("AdminSetupGate — allow-list bypass matrix", () => {
  for (const path of ALLOW_LIST) {
    test(`bypasses ${path} even with incomplete firm profile`, async ({
      page,
      isolatedOrg,
    }) => {
      await loginIsolated(page, isolatedOrg);
      await gotoWithRetry(page, path);
      await expect(page.locator(banner)).toHaveCount(0, { timeout: 15_000 });
    });
  }
});

test.describe("AdminSetupGate — error-page swallowing (current contract)", () => {
  test("regression baseline: today the gate DOES swallow 404 and renders the GettingStarted shell", async ({
    page,
    isolatedOrg,
  }) => {
    // Pin current behaviour: AdminSetupGate intercepts every non
    // allow-list path while firmProfileComplete=false, so even a
    // bogus URL renders the gated shell instead of NotFound. See
    // follow-up #455 (proposed fix: allow error routes through).
    await loginIsolated(page, isolatedOrg);
    await gotoWithRetry(page, `/totally-bogus-${Date.now()}`);
    await expect(page.locator(banner)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="text-error-title"]')).toHaveCount(0);
  });

  test.fixme(
    "expected: 404 should NOT be swallowed by the gate (NotFound surface should render)",
    async ({ page, isolatedOrg }) => {
      await loginIsolated(page, isolatedOrg);
      await gotoWithRetry(page, `/totally-bogus-${Date.now()}`);
      await expect(page.locator('[data-testid="text-error-title"]')).toHaveText(
        /Page Not Found/i,
        { timeout: 15_000 },
      );
      await expect(page.locator(banner)).toHaveCount(0);
    },
  );

  test.fixme(
    "expected: 500 ErrorBoundary fallback should NOT be swallowed by the gate",
    async ({ page, isolatedOrg }) => {
      await loginIsolated(page, isolatedOrg);
      await gotoWithRetry(page, "/__e2e_crash");
      await expect(page.locator('[data-testid="text-error-title"]')).toHaveText(
        /Something Went Wrong/i,
        { timeout: 15_000 },
      );
      await expect(page.locator(banner)).toHaveCount(0);
    },
  );
});

test.describe("AdminSetupGate — entitlement-aware /marketing/* branch", () => {
  test("/marketing/* bypasses gate once marketing_os entitlement is active", async ({
    page,
    isolatedOrg,
  }) => {
    const affected = await setEntitlement(isolatedOrg.orgId, "marketing_os", true);
    expect(affected).toBeGreaterThan(0);
    await loginIsolated(page, isolatedOrg);
    await gotoWithRetry(page, "/marketing/brands");
    await expect(page.locator(banner)).toHaveCount(0, { timeout: 20_000 });
  });
});

test.describe("AdminSetupGate — reactive flip across the matrix", () => {
  test("completing the profile releases the gate on every gated route; clearing re-engages it", async ({
    page,
    isolatedOrg,
  }) => {
    await loginIsolated(page, isolatedOrg);
    await gotoWithRetry(page, "/dashboard");
    await expect(page.locator(banner)).toBeVisible({ timeout: 20_000 });

    await completeFirmProfile(isolatedOrg.orgId);
    for (const path of ["/dashboard", "/invoices", "/clients"]) {
      await gotoWithRetry(page, path);
      await expect(page.locator(banner)).toHaveCount(0, { timeout: 20_000 });
    }

    await clearFirmProfile(isolatedOrg.orgId);
    await gotoWithRetry(page, "/dashboard");
    await expect(page.locator(banner)).toBeVisible({ timeout: 20_000 });
  });
});
