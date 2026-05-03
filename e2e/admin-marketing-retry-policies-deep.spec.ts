/**
 * Task #443 — /admin/marketing-retry-policies cross-org.
 *
 * Same operator-gate model as m365-rescope: tenant admins see the
 * operator-required card. The settings page surfaces the link only
 * for operators; here we navigate directly and assert the gate.
 */
import { test, expect } from "../tests/helpers/po/fixtures";
import { loginIsolated } from "./_iso-helpers";

test.use({ navigationTimeout: 30_000 });

test.describe("/admin/marketing-retry-policies", () => {
  test("non-operator admin sees operator-required gate", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);
    await page.goto("/admin/marketing-retry-policies");
    await expect(page.locator('[data-testid="card-operator-required"]'))
      .toBeVisible({ timeout: 20_000 });
  });
});
