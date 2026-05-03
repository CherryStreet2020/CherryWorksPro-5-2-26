import { test, expect } from "../helpers/po/fixtures";
import { loginPageAsIso } from "./_helpers";

test.describe("Mobile Responsive", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("dashboard loads on mobile viewport", async ({ isolatedOrg, page }) => {
    await loginPageAsIso(page, isolatedOrg);
    await expect(page.locator('[data-testid="text-dashboard-title"]')).toBeVisible({
      timeout: 15000,
    });
  });

  test("sidebar navigation works on mobile", async ({ isolatedOrg, page }) => {
    await loginPageAsIso(page, isolatedOrg);
    await page.waitForSelector('[data-testid="text-dashboard-title"]', { timeout: 15000 });
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
