/**
 * Role-guard matrix (Task #436, audit §1.2 + §3.1).
 *
 * Walks a representative slice of the protected route surface for
 * every role and asserts the App.tsx guard contract:
 *
 *   - `AdminRoute`   — ADMIN: 200 page; MANAGER & TEAM_MEMBER: 403.
 *   - `ManagerRoute` — ADMIN & MANAGER: 200; TEAM_MEMBER: 403.
 *
 * The "200 page" assertion uses `text-error-title` having count 0 —
 * we can't always assert on the exact page heading because lazy
 * routes can stay on the LazyFallback for a beat, but we CAN assert
 * that the 403 surface is NOT what rendered.
 *
 * The 403 page renders `data-testid="text-error-title"` reading
 * "Access Denied" (see client/src/pages/error-403.tsx).
 *
 * The matrix reuses the per-worker `seedRoleAdminPage`,
 * `seedManagerPage`, and `seedTeamMemberPage` fixtures from Task #435
 * so we never log in inside the test body. The role-seed org has its
 * firm profile pre-populated so AdminSetupGate passes through.
 *
 * Extending the matrix: add a row to ADMIN_ROUTES or MANAGER_ROUTES
 * below. The parametric loop generates one test per (route, role)
 * pair so the report shows exactly which guard broke.
 */
import { test, expect } from "../tests/helpers/po/fixtures";
import type { Page } from "@playwright/test";

const ADMIN_ROUTES = [
  "/settings/brands",
  "/settings/billing",
  "/settings",
  "/api-integrations",
  "/system",
  "/admin/data",
];

const MANAGER_ROUTES = [
  "/team",
  "/approvals",
  "/estimates",
  "/import",
  "/accounting",
  "/billing",
  "/management",
];

const ACCESS_DENIED = '[data-testid="text-error-title"]';

async function expectForbidden(page: Page, route: string): Promise<void> {
  await page.goto(route);
  // Either the 403 surface renders, or wouter swaps to it after the
  // guard short-circuits — give it a beat.
  await expect(page.locator(ACCESS_DENIED)).toHaveText("Access Denied", {
    timeout: 15000,
  });
}

async function expectNotForbidden(page: Page, route: string): Promise<void> {
  await page.goto(route);
  // Wait for the route's page chrome to settle (load + a beat for
  // wouter/lazy guards to swap the tree). Then poll: the 403 surface
  // must stay absent for a sustained window. A hardcoded
  // `waitForTimeout` would race slow guards on CI; a single
  // `toHaveCount(0)` would race fast guards that transition AFTER
  // assertion. The doubled poll catches both cases.
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await expect(page.locator(ACCESS_DENIED)).toHaveCount(0, { timeout: 5000 });
  await page.waitForTimeout(300);
  await expect(page.locator(ACCESS_DENIED)).toHaveCount(0);
}

test.describe("Role guards — AdminRoute", () => {
  for (const route of ADMIN_ROUTES) {
    test(`ADMIN can reach ${route}`, async ({ seedRoleAdminPage }) => {
      await expectNotForbidden(seedRoleAdminPage, route);
    });

    test(`MANAGER is 403 on ${route}`, async ({ seedManagerPage }) => {
      await expectForbidden(seedManagerPage, route);
    });

    test(`TEAM_MEMBER is 403 on ${route}`, async ({ seedTeamMemberPage }) => {
      await expectForbidden(seedTeamMemberPage, route);
    });
  }
});

test.describe("Role guards — ManagerRoute", () => {
  for (const route of MANAGER_ROUTES) {
    test(`ADMIN can reach ${route}`, async ({ seedRoleAdminPage }) => {
      await expectNotForbidden(seedRoleAdminPage, route);
    });

    test(`MANAGER can reach ${route}`, async ({ seedManagerPage }) => {
      await expectNotForbidden(seedManagerPage, route);
    });

    test(`TEAM_MEMBER is 403 on ${route}`, async ({ seedTeamMemberPage }) => {
      await expectForbidden(seedTeamMemberPage, route);
    });
  }
});
