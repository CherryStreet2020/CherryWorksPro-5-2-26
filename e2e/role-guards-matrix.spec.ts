/**
 * Role-guard matrix (Task #436): every AdminRoute and ManagerRoute in
 * App.tsx, table-driven across ADMIN / MANAGER / TEAM_MEMBER. Uses
 * the per-role page fixtures from #435 so every test logs in once
 * per worker.
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

const ACCESS_DENIED = '[data-testid="text-error-title"]';

async function expectForbidden(page: Page, route: string): Promise<void> {
  await page.goto(route);
  await expect(page.locator(ACCESS_DENIED)).toHaveText("Access Denied", {
    timeout: 15000,
  });
}

async function expectNotForbidden(page: Page, route: string): Promise<void> {
  await page.goto(route);
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
      await expectNotForbidden(seedRoleAdminPage, route);
    });
    test(`MANAGER can reach ${route}`, async ({ seedManagerPage }) => {
      await expectNotForbidden(seedManagerPage, route);
    });
    test(`TEAM_MEMBER 403 on ${route}`, async ({ seedTeamMemberPage }) => {
      await expectForbidden(seedTeamMemberPage, route);
    });
  }
});
