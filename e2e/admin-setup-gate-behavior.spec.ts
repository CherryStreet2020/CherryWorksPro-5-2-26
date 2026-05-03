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
  test("404: gate intercepts unknown routes and renders the GettingStarted shell", async ({
    page,
    isolatedOrg,
  }) => {
    await loginIsolated(page, isolatedOrg);
    await gotoWithRetry(page, `/totally-bogus-${Date.now()}`);
    await expect(page.locator(banner)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="text-error-title"]')).toHaveCount(0);
  });

  test("500: /__e2e_crash is mounted OUTSIDE AppContent and bypasses the gate (ErrorBoundary fires)", async ({
    page,
    isolatedOrg,
  }) => {
    // DevCrashRoute is registered before the AppContent fallback Route
    // (see App.tsx ~L655), so it bypasses AdminSetupGate entirely. The
    // ErrorBoundary fallback always wins for hard render crashes.
    await loginIsolated(page, isolatedOrg);
    await gotoWithRetry(page, "/__e2e_crash");
    await expect(page.locator('[data-testid="text-error-title"]')).toHaveText(
      /Something Went Wrong/i,
      { timeout: 15_000 },
    );
    await expect(page.locator(banner)).toHaveCount(0);
  });
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

test.describe("AdminSetupGate — reactive flip with real page bodies", () => {
  test("completing the profile releases the gate AND the real page body mounts; clearing re-engages", async ({
    page,
    isolatedOrg,
  }) => {
    await loginIsolated(page, isolatedOrg);
    await gotoWithRetry(page, "/dashboard");
    await expect(page.locator(banner)).toBeVisible({ timeout: 20_000 });

    await completeFirmProfile(isolatedOrg.orgId);

    await gotoWithRetry(page, "/dashboard");
    await expect(page.locator(banner)).toHaveCount(0, { timeout: 20_000 });
    await expect(page.locator('[data-testid="kpi-revenue"]').first()).toBeVisible({
      timeout: 20_000,
    });

    await gotoWithRetry(page, "/clients");
    await expect(page.locator(banner)).toHaveCount(0);
    await expect(page.locator('[data-testid="button-add-client"], [data-testid="button-new-client"]').first()).toBeVisible({
      timeout: 15_000,
    });

    await gotoWithRetry(page, "/invoices");
    await expect(page.locator(banner)).toHaveCount(0);
    await expect(page.locator('[data-testid="button-blank-invoice"]').first()).toBeVisible({
      timeout: 15_000,
    });

    await clearFirmProfile(isolatedOrg.orgId);
    await gotoWithRetry(page, "/dashboard");
    await expect(page.locator(banner)).toBeVisible({ timeout: 20_000 });
  });
});
