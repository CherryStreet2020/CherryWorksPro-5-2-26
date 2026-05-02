import { test, expect } from "@playwright/test";

test.describe("Approvals Page", () => {
  test("shows filter tabs with counts", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="input-email"]', { timeout: 10000 });
    await page.fill('[data-testid="input-email"]', "dean@cherrystconsulting.com");
    await page.fill('[data-testid="input-password"]', "admin123");
    await page.click('[data-testid="button-login"]');
    await page.waitForSelector('[data-testid="text-dashboard-title"]', { timeout: 10000 });
    await page.goto("/approvals");
    await page.waitForSelector('[data-testid="text-approvals-title"]', { timeout: 10000 });
    await expect(page.locator('[data-testid="filter-tabs"]')).toBeVisible();
    await expect(page.locator('[data-testid="filter-tab-all"]')).toBeVisible();
    await expect(page.locator('[data-testid="filter-tab-submitted"]')).toBeVisible();
    await expect(page.locator('[data-testid="filter-tab-approved"]')).toBeVisible();
    await expect(page.locator('[data-testid="filter-tab-rejected"]')).toBeVisible();
  });

  test("search and team member filter are available", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="input-email"]', { timeout: 10000 });
    await page.fill('[data-testid="input-email"]', "dean@cherrystconsulting.com");
    await page.fill('[data-testid="input-password"]', "admin123");
    await page.click('[data-testid="button-login"]');
    await page.waitForSelector('[data-testid="text-dashboard-title"]', { timeout: 10000 });
    await page.goto("/approvals");
    await page.waitForSelector('[data-testid="text-approvals-title"]', { timeout: 10000 });
    await expect(page.locator('[data-testid="input-search-timesheets"]')).toBeVisible();
    await expect(page.locator('[data-testid="select-team-member-filter"]')).toBeVisible();
  });
});
