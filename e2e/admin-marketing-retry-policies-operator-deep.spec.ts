import { test, expect } from "../tests/helpers/po/fixtures";
import { loginIsolated } from "./_iso-helpers";

test.use({ navigationTimeout: 30_000 });

/**
 * Operator-mode coverage for /admin/marketing-retry-policies. Operator
 * gating requires PLATFORM_OPERATOR_EMAILS, which we cannot mutate per-test
 * without racing parallel workers. Stub the operator probe + policies feed
 * to pin the platform-defaults card, the deviating-orgs table, and the
 * delta-formatting helpers.
 */
test.describe("/admin/marketing-retry-policies (operator stubbed)", () => {
  test("renders defaults card, off-default rows, and signed deltas", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);

    await page.route("**/api/auth/me/platform-operator", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ isPlatformOperator: true }),
      }),
    );
    await page.route("**/api/admin/marketing/retry-policies", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          defaults: { maxAttempts: 5, retryBaseMs: 60_000 },
          orgs: [
            { orgId: "org-aggressive", orgName: "Aggressive Co", maxAttempts: 12, retryBaseMs: 5_000, attemptsDelta: 7, retryBaseMsDelta: -55_000 },
            { orgId: "org-conservative", orgName: "Conservative LLC", maxAttempts: 3, retryBaseMs: 120_000, attemptsDelta: -2, retryBaseMsDelta: 60_000 },
          ],
        }),
      }),
    );

    await page.goto("/admin/marketing-retry-policies");
    await expect(page.locator('[data-testid="page-marketing-retry-policies"]')).toBeVisible({ timeout: 20_000 });

    await expect(page.locator('[data-testid="text-default-max-attempts"]')).toHaveText("5");
    await expect(page.locator('[data-testid="text-default-retry-base"]')).toHaveText("1 min");
    await expect(page.locator('[data-testid="badge-policy-count"]')).toHaveText("2");

    await expect(page.locator('[data-testid="text-max-attempts-org-aggressive"]')).toHaveText("12");
    await expect(page.locator('[data-testid="text-attempts-delta-org-aggressive"]')).toHaveText("+7");
    await expect(page.locator('[data-testid="text-retry-base-org-aggressive"]')).toHaveText("5.0s");
    // Unicode minus sign for negative deltas.
    await expect(page.locator('[data-testid="text-retry-base-delta-org-aggressive"]')).toHaveText("\u221255.0s");

    await expect(page.locator('[data-testid="text-attempts-delta-org-conservative"]')).toHaveText("\u22122");
    await expect(page.locator('[data-testid="text-retry-base-delta-org-conservative"]')).toHaveText("+1 min");
  });

  test("empty policies → renders no-overrides text + zero badge", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);

    await page.route("**/api/auth/me/platform-operator", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ isPlatformOperator: true }),
      }),
    );
    await page.route("**/api/admin/marketing/retry-policies", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ defaults: { maxAttempts: 5, retryBaseMs: 60_000 }, orgs: [] }),
      }),
    );

    await page.goto("/admin/marketing-retry-policies");
    await expect(page.locator('[data-testid="page-marketing-retry-policies"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="badge-policy-count"]')).toHaveText("0");
    await expect(page.locator('[data-testid="text-no-overrides"]')).toBeVisible();
  });
});
