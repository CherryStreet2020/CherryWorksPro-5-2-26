/**
 * AdminSetupGate behaviour (Task #444, audit §6.1.1).
 *
 * `AdminSetupGate` (client/src/components/admin-setup-gate.tsx) is the
 * silent shell that hijacks every admin route until the firm profile
 * is filled in. It exposes three branches:
 *
 *   1. firmProfileComplete = true → children render unchanged.
 *   2. firmProfileComplete = false AND location ∉ allow-list AND not
 *      an unlocked /marketing/* route → render the GettingStarted
 *      shell with `banner-firm-profile-incomplete` pinned to the
 *      bottom and `state-admin-setup-gate-loading` shown while the
 *      `/api/implementation-status` query is in flight.
 *   3. firmProfileComplete = false AND location IS on the allow-list
 *      (`/getting-started`, `/profile`) → children render unchanged.
 *
 * This spec pins each branch with an isolated org so the assertions
 * cannot be blurred by another worker's mutations.
 */
import { test, expect } from "../tests/helpers/po/fixtures";
import { loginIsolated, gotoWithRetry } from "./_iso-helpers";
import { completeFirmProfile, clearFirmProfile } from "../tests/helpers/po/setup-gate";

test.use({ navigationTimeout: 30_000, firmProfileComplete: false });

test.describe("AdminSetupGate — gated branches", () => {
  test("admin on a non-allow-listed route is hijacked to the GettingStarted shell with banner", async ({
    page,
    isolatedOrg,
  }) => {
    await loginIsolated(page, isolatedOrg);
    await gotoWithRetry(page, "/dashboard");

    // The gated shell renders GettingStarted as <main>, the firm-
    // profile incomplete banner along the bottom, and crucially
    // does NOT render the dashboard's KPI deck.
    await expect(
      page.locator('[data-testid="banner-firm-profile-incomplete"]'),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="kpi-revenue"]')).toHaveCount(0);
  });

  test("/getting-started bypasses the gate even when firm profile is incomplete", async ({
    page,
    isolatedOrg,
  }) => {
    await loginIsolated(page, isolatedOrg);
    await gotoWithRetry(page, "/getting-started");

    // We're on the allow-list, so the gate is inert. The banner only
    // appears as part of the gated shell — its absence here proves
    // the shell did not engage.
    await expect(
      page.locator('[data-testid="banner-firm-profile-incomplete"]'),
    ).toHaveCount(0, { timeout: 15_000 });
  });

  test("/profile bypasses the gate even when firm profile is incomplete", async ({
    page,
    isolatedOrg,
  }) => {
    await loginIsolated(page, isolatedOrg);
    await gotoWithRetry(page, "/profile");
    await expect(
      page.locator('[data-testid="banner-firm-profile-incomplete"]'),
    ).toHaveCount(0, { timeout: 15_000 });
  });

  test("completing the firm profile releases the gate; clearing it re-engages on next nav", async ({
    page,
    isolatedOrg,
  }) => {
    await loginIsolated(page, isolatedOrg);
    await gotoWithRetry(page, "/dashboard");
    await expect(
      page.locator('[data-testid="banner-firm-profile-incomplete"]'),
    ).toBeVisible({ timeout: 20_000 });

    // Flip the DB-side predicate and reload — gate must release.
    await completeFirmProfile(isolatedOrg.orgId);
    await gotoWithRetry(page, "/dashboard");
    await expect(
      page.locator('[data-testid="banner-firm-profile-incomplete"]'),
    ).toHaveCount(0, { timeout: 20_000 });

    // Strip every field that satisfied the predicate and reload —
    // gate must engage again. This proves the shell is reactive to
    // server state, not a one-shot decision baked in at first paint.
    await clearFirmProfile(isolatedOrg.orgId);
    await gotoWithRetry(page, "/dashboard");
    await expect(
      page.locator('[data-testid="banner-firm-profile-incomplete"]'),
    ).toBeVisible({ timeout: 20_000 });
  });
});
