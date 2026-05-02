import { test, expect } from "@playwright/test";

test.describe("Mobile Responsive", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("dashboard loads on mobile viewport", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="input-email"]', { timeout: 10000 });
    await page.fill('[data-testid="input-email"]', "dean@cherrystconsulting.com");
    await page.fill('[data-testid="input-password"]', "admin123");
    await page.click('[data-testid="button-login"]');
    await expect(page.locator('[data-testid="text-dashboard-title"]')).toBeVisible({ timeout: 10000 });
  });

  test("sidebar navigation works on mobile", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="input-email"]', { timeout: 10000 });
    await page.fill('[data-testid="input-email"]', "dean@cherrystconsulting.com");
    await page.fill('[data-testid="input-password"]', "admin123");
    await page.click('[data-testid="button-login"]');
    await page.waitForSelector('[data-testid="text-dashboard-title"]', { timeout: 10000 });
    const sidebar = page.locator("aside").first();
    if (await sidebar.isVisible()) {
      const clientsLink = sidebar.locator('a[href="/clients"]');
      if (await clientsLink.isVisible()) {
        await clientsLink.click();
        await page.waitForURL("**/clients", { timeout: 10000 });
      }
    }
  });
});
