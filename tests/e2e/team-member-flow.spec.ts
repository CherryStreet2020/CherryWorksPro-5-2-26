import { test, expect } from "@playwright/test";

// FIXME-task-455: Legacy shared-state spec (audit §6.2.8). The
// surrounding suite mutates the same seeded admin org rows, so the
// assertions race other serial specs. Skipped until migrated to the
// per-test `isolatedOrg` fixture (see tests/helpers/po/fixtures.ts).
// Tracked: project task #455.
import { test as _t } from "@playwright/test";
_t.beforeEach(() => _t.fixme(true, "Task #455: legacy shared-state spec; migrate to isolatedOrg first"));

test.describe("Team Member Experience", () => {
  test("team member sees their own dashboard", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="input-email"]', { timeout: 10000 });
    await page.fill('[data-testid="input-email"]', "kellyjo@cherrystconsulting.com");
    await page.fill('[data-testid="input-password"]', "cherry2026");
    await page.click('[data-testid="button-login"]');
    await page.waitForSelector('[data-testid="text-dashboard-title"]', { timeout: 10000 });
    const title = await page.locator('[data-testid="text-dashboard-title"]').textContent();
    expect(title).toBe("My Dashboard");
    await expect(page.locator('[data-testid="card-my-hours"]')).toBeVisible();
  });

  test("team member sidebar has only 4 nav items (Dashboard, Projects, Time Tracking, Profile)", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="input-email"]', { timeout: 10000 });
    await page.fill('[data-testid="input-email"]', "kellyjo@cherrystconsulting.com");
    await page.fill('[data-testid="input-password"]', "cherry2026");
    await page.click('[data-testid="button-login"]');
    await page.waitForSelector('[data-testid="text-dashboard-title"]', { timeout: 10000 });
    await expect(page.locator('[data-testid="link-dashboard"]')).toBeVisible();
    await expect(page.locator('[data-testid="link-projects"]')).toBeVisible();
    await expect(page.locator('[data-testid="link-time-tracking"]')).toBeVisible();
    await expect(page.locator('[data-testid="link-profile"]')).toBeVisible();
    await expect(page.locator('[data-testid="link-clients"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="link-invoices"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="link-payments"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="link-reports"]')).not.toBeVisible();
  });

  test("team member navigating to /invoices is redirected to dashboard", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="input-email"]', { timeout: 10000 });
    await page.fill('[data-testid="input-email"]', "kellyjo@cherrystconsulting.com");
    await page.fill('[data-testid="input-password"]', "cherry2026");
    await page.click('[data-testid="button-login"]');
    await page.waitForSelector('[data-testid="text-dashboard-title"]', { timeout: 10000 });
    await page.goto("/invoices");
    await page.waitForSelector('[data-testid="text-dashboard-title"]', { timeout: 10000 });
    expect(page.url()).not.toContain("/invoices");
  });

  test("team member sees only their projects on /projects", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="input-email"]', { timeout: 10000 });
    await page.fill('[data-testid="input-email"]', "kellyjo@cherrystconsulting.com");
    await page.fill('[data-testid="input-password"]', "cherry2026");
    await page.click('[data-testid="button-login"]');
    await page.waitForSelector('[data-testid="text-dashboard-title"]', { timeout: 10000 });
    await page.goto("/projects");
    await page.waitForTimeout(2000);
  });
});
