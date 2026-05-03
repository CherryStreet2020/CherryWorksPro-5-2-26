import { test, expect } from "../tests/helpers/po/fixtures";

test.use({ navigationTimeout: 30_000 });

test.describe("Dashboard role variants", () => {
  test("ADMIN sees executive KPI deck (revenue/collected/outstanding/overdue/net-cash/team)", async ({ seedRoleAdminPage }) => {
    await seedRoleAdminPage.goto("/dashboard");
    await expect(seedRoleAdminPage.locator('[data-testid="kpi-revenue"]')).toBeVisible({ timeout: 20_000 });
    await expect(seedRoleAdminPage.locator('[data-testid="kpi-collected"]')).toBeVisible();
    await expect(seedRoleAdminPage.locator('[data-testid="kpi-outstanding"]')).toBeVisible();
    await expect(seedRoleAdminPage.locator('[data-testid="kpi-overdue"]')).toBeVisible();
    await expect(seedRoleAdminPage.locator('[data-testid="kpi-net-cash"]')).toBeVisible();
    await expect(seedRoleAdminPage.locator('[data-testid="kpi-team"]')).toBeVisible();
    await expect(seedRoleAdminPage.locator('[data-testid="chart-revenue-trend"]')).toBeVisible();
  });

  test("MANAGER inherits the admin executive dashboard surface", async ({ seedManagerPage }) => {
    await seedManagerPage.goto("/dashboard");
    await expect(seedManagerPage.locator('[data-testid="kpi-revenue"]')).toBeVisible({ timeout: 20_000 });
    await expect(seedManagerPage.locator('[data-testid="kpi-collected"]')).toBeVisible();
    await expect(seedManagerPage.locator('[data-testid="kpi-outstanding"]')).toBeVisible();
  });

  test("TEAM_MEMBER sees My Dashboard surface with quick actions", async ({ seedTeamMemberPage }) => {
    await seedTeamMemberPage.goto("/dashboard");
    await expect(seedTeamMemberPage.locator('[data-testid="text-dashboard-title"]')).toBeVisible({ timeout: 20_000 });
    await expect(seedTeamMemberPage.locator('[data-testid="card-quick-actions"]')).toBeVisible();
    await expect(seedTeamMemberPage.locator('[data-testid="button-quick-log-time"]')).toBeVisible();
    await expect(seedTeamMemberPage.locator('[data-testid="button-quick-profile"]')).toBeVisible();
    // The exec KPI deck must NOT render for team members.
    await expect(seedTeamMemberPage.locator('[data-testid="kpi-revenue"]')).toHaveCount(0);
  });

  test("ADMIN KPI drilldown opens dialog with title and closes via Escape", async ({ seedRoleAdminPage }) => {
    const page = seedRoleAdminPage;
    await page.goto("/dashboard");
    await expect(page.locator('[data-testid="kpi-outstanding"]')).toBeVisible({ timeout: 20_000 });

    await page.locator('[data-testid="kpi-outstanding"]').click();
    await expect(page.locator('[data-testid="text-drilldown-title"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="text-drilldown-title"]')).toHaveText(/Outstanding/i);
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-testid="text-drilldown-title"]')).toHaveCount(0, { timeout: 5_000 });
  });
});
