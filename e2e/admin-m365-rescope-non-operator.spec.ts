import { test, expect } from "../tests/helpers/po/fixtures";
import { loginIsolated } from "./_iso-helpers";

test.use({ navigationTimeout: 30_000 });

test.describe("/admin/m365-rescope", () => {
  test("non-operator admin sees the operator-required gate (no page body)", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);
    await page.goto("/admin/m365-rescope");
    await expect(page.locator('[data-testid="card-operator-required"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="page-m365-rescope"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="button-rescan"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="button-back-settings"]')).toBeVisible();
  });
});
