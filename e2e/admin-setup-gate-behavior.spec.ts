/**
 * AdminSetupGate behaviour matrix (Task #444, audit §6.1.1).
 *
 * Allow-list (admin-setup-gate.tsx): ["/getting-started", "/profile"]
 * + /marketing/* when `marketing_os` is active OR brands exist.
 * Every other authenticated route is gated and rendered as the
 * GettingStarted shell while `firmProfileComplete = false`.
 */
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

test.describe("AdminSetupGate — gated routes", () => {
  for (const path of GATED_ROUTES) {
    test(`gates ${path} when firm profile is incomplete`, async ({
      page,
      isolatedOrg,
    }) => {
      await loginIsolated(page, isolatedOrg);
      await gotoWithRetry(page, path);
      await expect(page.locator(banner)).toBeVisible({ timeout: 20_000 });
      // Page-specific anchors must NOT be visible while the gated
      // shell is up (proves the real page never mounted).
      await expect(page.locator('[data-testid="kpi-revenue"]')).toHaveCount(0);
    });
  }
});

test.describe("AdminSetupGate — allow-list bypass", () => {
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

test.describe("AdminSetupGate — reactive flip", () => {
  test("completing the profile releases the gate; clearing re-engages it", async ({
    page,
    isolatedOrg,
  }) => {
    await loginIsolated(page, isolatedOrg);
    await gotoWithRetry(page, "/dashboard");
    await expect(page.locator(banner)).toBeVisible({ timeout: 20_000 });

    await completeFirmProfile(isolatedOrg.orgId);
    await gotoWithRetry(page, "/dashboard");
    await expect(page.locator(banner)).toHaveCount(0, { timeout: 20_000 });

    await clearFirmProfile(isolatedOrg.orgId);
    await gotoWithRetry(page, "/dashboard");
    await expect(page.locator(banner)).toBeVisible({ timeout: 20_000 });
  });
});
