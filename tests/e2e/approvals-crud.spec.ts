import { test, expect } from "../helpers/po/fixtures";
import { loginPageAsIso } from "./_helpers";

test.describe("Approvals Page", () => {
  test("shows filter tabs with counts", async ({ isolatedOrg, page }) => {
    await loginPageAsIso(page, isolatedOrg);
    await page.waitForSelector('[data-testid="text-dashboard-title"]', { timeout: 15000 });
    await page.goto("/approvals");
    await page.waitForSelector('[data-testid="text-approvals-title"]', { timeout: 15000 });
    await expect(page.locator('[data-testid="filter-tabs"]')).toBeVisible();
    await expect(page.locator('[data-testid="filter-tab-all"]')).toBeVisible();
    await expect(page.locator('[data-testid="filter-tab-submitted"]')).toBeVisible();
    await expect(page.locator('[data-testid="filter-tab-approved"]')).toBeVisible();
    await expect(page.locator('[data-testid="filter-tab-rejected"]')).toBeVisible();
  });

  test("search and team member filter are available", async ({ isolatedOrg, page }) => {
    await loginPageAsIso(page, isolatedOrg);
    await page.waitForSelector('[data-testid="text-dashboard-title"]', { timeout: 15000 });
    await page.goto("/approvals");
    await page.waitForSelector('[data-testid="text-approvals-title"]', { timeout: 15000 });
    await expect(page.locator('[data-testid="input-search-timesheets"]')).toBeVisible();
    await expect(page.locator('[data-testid="select-team-member-filter"]')).toBeVisible();
  });
});
