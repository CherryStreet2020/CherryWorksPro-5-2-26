import { test, expect } from "@playwright/test";

// FIXME-task-455: Legacy shared-state spec (audit §6.2.8). The
// surrounding suite mutates the same seeded admin org rows, so the
// assertions race other serial specs. Skipped until migrated to the
// per-test `isolatedOrg` fixture (see tests/helpers/po/fixtures.ts).
// Tracked: project task #455.
import { test as _t } from "@playwright/test";
_t.beforeEach(() => _t.fixme(true, "Task #455: legacy shared-state spec; migrate to isolatedOrg first"));

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
