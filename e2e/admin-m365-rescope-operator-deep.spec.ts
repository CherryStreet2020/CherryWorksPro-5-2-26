import { test, expect } from "../tests/helpers/po/fixtures";
import { loginIsolated } from "./_iso-helpers";

test.use({ navigationTimeout: 30_000 });

/**
 * Operator-mode coverage for /admin/m365-rescope.
 *
 * The page is gated by `/api/auth/me/platform-operator` returning
 * `{ isPlatformOperator: true }`, which on a real deployment requires the
 * signed-in user's email to be in the PLATFORM_OPERATOR_EMAILS env var.
 * Mutating that env var at test time would race with other workers, so we
 * stub the operator probe + scan/notify endpoints to deterministically
 * exercise the affected-orgs table, the confirm dialog, the notify mutation
 * and the post-success "last notify run" card.
 */
test.describe("/admin/m365-rescope (operator stubbed)", () => {
  const affectedOrg = {
    id: "org-deep-1",
    name: "Stubbed Org A",
    scopes: "openid email User.Read offline_access",
    connectedAt: "2025-01-15T10:00:00.000Z",
  };

  test.beforeEach(async ({ page }) => {
    await page.route("**/api/auth/me/platform-operator", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ isPlatformOperator: true }),
      }),
    );
    await page.route("**/api/admin/email/m365-rescope/scan", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          scanned: 1,
          affected: [affectedOrg],
          notified: [],
          dryRun: true,
        }),
      }),
    );
  });

  test("operator sees scan table, confirm dialog, notify POST, and last-notify card", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);

    let notifyCalls = 0;
    await page.route("**/api/admin/email/m365-rescope/notify", (route) => {
      notifyCalls += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          scanned: 1,
          affected: [affectedOrg],
          notified: [{ orgId: affectedOrg.id, orgName: affectedOrg.name, adminsEmailed: 3 }],
          dryRun: false,
        }),
      });
    });

    await page.goto("/admin/m365-rescope");

    await expect(page.locator('[data-testid="page-m365-rescope"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="badge-affected-count"]')).toHaveText("1");
    await expect(page.locator(`[data-testid="row-affected-${affectedOrg.id}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="text-org-name-${affectedOrg.id}"]`)).toHaveText(affectedOrg.name);

    await page.locator('[data-testid="button-notify-affected"]').click();
    await expect(page.locator('[data-testid="button-confirm-notify"]')).toBeVisible({ timeout: 5_000 });
    await page.locator('[data-testid="button-confirm-notify"]').click();

    await expect(page.locator('[data-testid="card-last-notify"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(`[data-testid="text-admins-emailed-${affectedOrg.id}"]`)).toHaveText("3");
    expect(notifyCalls).toBe(1);
  });

  test("cancel in confirm dialog does NOT call /notify", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);

    let notifyCalls = 0;
    await page.route("**/api/admin/email/m365-rescope/notify", (route) => {
      notifyCalls += 1;
      return route.fulfill({ status: 500, body: "should-not-be-called" });
    });

    await page.goto("/admin/m365-rescope");
    await expect(page.locator('[data-testid="page-m365-rescope"]')).toBeVisible({ timeout: 20_000 });

    await page.locator('[data-testid="button-notify-affected"]').click();
    await page.locator('[data-testid="button-cancel-notify"]').click();

    await page.waitForTimeout(400);
    expect(notifyCalls).toBe(0);
    await expect(page.locator('[data-testid="card-last-notify"]')).toHaveCount(0);
  });

  test("rescan button refetches /scan", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);
    await page.goto("/admin/m365-rescope");
    await expect(page.locator('[data-testid="page-m365-rescope"]')).toBeVisible({ timeout: 20_000 });

    const refetch = page.waitForResponse(
      (r) => r.url().includes("/api/admin/email/m365-rescope/scan"),
      { timeout: 10_000 },
    );
    await page.locator('[data-testid="button-rescan"]').click();
    const res = await refetch;
    expect(res.status()).toBe(200);
  });
});
