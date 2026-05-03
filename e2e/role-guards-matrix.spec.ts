/**
 * Role-guard matrix (Task #436): every AdminRoute, ManagerRoute, and
 * a representative slice of LazyRoute (auth-only, no role gate) usages
 * in App.tsx, table-driven across ADMIN / MANAGER / TEAM_MEMBER. Uses
 * the per-role page fixtures from #435 so every test logs in once
 * per worker.
 *
 * Success/forbidden distinction:
 *   - `text-error-title` is shared by 403, 404, and 500 pages — we
 *     verify the error component is absent AND the URL stayed at
 *     the requested route. This catches both "guard wrongly let
 *     them through" (403 absent but 404 fired) and "page silently
 *     redirected" (URL changed).
 */
import { test, expect } from "../tests/helpers/po/fixtures";
import type { Page } from "@playwright/test";

// Mirrors the AdminRoute/ManagerRoute usages in client/src/App.tsx.
// Param routes use a placeholder id — guards fire before the page
// fetches so the 200/403 distinction is all that matters here.
const ADMIN_ROUTES = [
  "/payouts",
  "/admin/data",
  "/admin/data/users",
  "/admin/data/users/abc",
  "/settings/brands",
  "/settings/billing",
  "/settings",
  "/api-integrations",
  "/system",
  "/banking",
];

const MANAGER_ROUTES = [
  "/invoices",
  "/invoices/recurring",
  "/invoices/00000000-0000-0000-0000-000000000000",
  "/payments",
  "/reports",
  "/estimates",
  "/activity",
  "/approvals",
  "/team",
  "/import",
  "/admin/rate-matrix/00000000-0000-0000-0000-000000000000",
  "/marketing/contacts",
  "/marketing/companies",
  "/marketing/tags",
  "/marketing/segments",
  "/marketing/campaigns",
  "/marketing/sequences",
  "/marketing/activity",
  "/services",
  "/accounting",
  "/billing",
  "/management",
  "/gl/accounts",
  "/gl/ledger",
  "/gl/journal-entries",
  "/gl/trial-balance",
  "/close-periods",
];

const ERROR_TITLE = '[data-testid="text-error-title"]';

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function expectForbidden(page: Page, route: string): Promise<void> {
  await page.goto(route);
  await expect(page.locator(ERROR_TITLE)).toHaveText("Access Denied", {
    timeout: 15000,
  });
}

/**
 * Success = no 403/404/500 error component AND URL stayed at the
 * requested route (didn't silently redirect to /login or elsewhere).
 */
async function expectAccessGranted(page: Page, route: string): Promise<void> {
  await page.goto(route);
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await expect(page.locator(ERROR_TITLE)).toHaveCount(0, { timeout: 5000 });
  await page.waitForTimeout(300);
  await expect(page.locator(ERROR_TITLE)).toHaveCount(0);
  // URL must still be the requested route (param-id placeholder included).
  await expect(page).toHaveURL(new RegExp(escapeRegex(route) + "(\\?|$|/)"));
}

test.describe("Role guards — AdminRoute", () => {
  for (const route of ADMIN_ROUTES) {
    test(`ADMIN can reach ${route}`, async ({ seedRoleAdminPage }) => {
      await expectAccessGranted(seedRoleAdminPage, route);
    });
    test(`MANAGER 403 on ${route}`, async ({ seedManagerPage }) => {
      await expectForbidden(seedManagerPage, route);
    });
    test(`TEAM_MEMBER 403 on ${route}`, async ({ seedTeamMemberPage }) => {
      await expectForbidden(seedTeamMemberPage, route);
    });
  }
});

test.describe("Role guards — ManagerRoute", () => {
  for (const route of MANAGER_ROUTES) {
    test(`ADMIN can reach ${route}`, async ({ seedRoleAdminPage }) => {
      await expectAccessGranted(seedRoleAdminPage, route);
    });
    test(`MANAGER can reach ${route}`, async ({ seedManagerPage }) => {
      await expectAccessGranted(seedManagerPage, route);
    });
    test(`TEAM_MEMBER 403 on ${route}`, async ({ seedTeamMemberPage }) => {
      await expectForbidden(seedTeamMemberPage, route);
    });
  }
});

// LazyRoute pages are auth-only (no role gate at the route level).
// Every authenticated role must reach all of them. Mirrors every
// `<LazyRoute …>` usage in client/src/App.tsx that lives inside
// the authenticated `<Switch>` block (lines 277-304); marketing /
// public LazyRoute pages (/features, /pricing, /signup, …) are
// intentionally excluded because they're served unauthenticated.
const LAZY_AUTH_ROUTES = [
  "/",
  "/dashboard",
  "/home",
  "/clients",
  "/clients/00000000-0000-0000-0000-000000000000",
  "/projects",
  "/projects/00000000-0000-0000-0000-000000000000",
  "/time",
  "/expenses",
  "/expense-reports",
  "/notifications",
  "/profile",
  "/change-password",
  "/onboarding",
  "/admin/m365-rescope",
  "/admin/marketing-retry-policies",
];

test.describe("Role guards — LazyRoute (auth-only)", () => {
  for (const route of LAZY_AUTH_ROUTES) {
    test(`ADMIN can reach ${route}`, async ({ seedRoleAdminPage }) => {
      await expectAccessGranted(seedRoleAdminPage, route);
    });
    test(`MANAGER can reach ${route}`, async ({ seedManagerPage }) => {
      await expectAccessGranted(seedManagerPage, route);
    });
    test(`TEAM_MEMBER can reach ${route}`, async ({ seedTeamMemberPage }) => {
      await expectAccessGranted(seedTeamMemberPage, route);
    });
  }
});
