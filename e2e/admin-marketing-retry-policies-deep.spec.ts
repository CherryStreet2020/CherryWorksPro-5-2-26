import { test, expect } from "../tests/helpers/po/fixtures";
import { loginIsolated } from "./_iso-helpers";

test.use({ navigationTimeout: 30_000 });

test.describe("/admin/marketing-retry-policies", () => {
  test("non-operator admin sees the operator-required gate (no policy table)", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);
    await page.goto("/admin/marketing-retry-policies");
    await expect(page.locator('[data-testid="card-operator-required"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="page-marketing-retry-policies"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="text-default-max-attempts"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="badge-policy-count"]')).toHaveCount(0);
  });
});
