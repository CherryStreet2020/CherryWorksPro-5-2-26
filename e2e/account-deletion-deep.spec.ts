import { test, expect } from "../tests/helpers/po/fixtures";
import { loginIsolated } from "./_iso-helpers";

test.use({ navigationTimeout: 30_000 });

test.describe("Account deletion deep", () => {
  test("submit gates on password+confirm, then POSTs /api/account/delete-request", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);
    await page.goto("/profile");

    const deleteBtn = page.locator('[data-testid="button-delete-account"]');
    await expect(deleteBtn).toBeVisible({ timeout: 20_000 });
    await deleteBtn.click();

    const passwordInput = page.locator('[data-testid="input-delete-password"]');
    const confirmCb = page.locator('[data-testid="checkbox-delete-confirm"]');
    const submit = page.locator('[data-testid="button-confirm-delete"]');
    await expect(passwordInput).toBeVisible({ timeout: 5_000 });
    await expect(submit).toBeDisabled();

    await passwordInput.fill(isolatedOrg.password);
    await expect(submit).toBeDisabled();
    await confirmCb.check();
    await expect(submit).toBeEnabled();

    const delPromise = page.waitForResponse(
      (r) => r.url().includes("/api/account/delete-request") && r.request().method() === "POST",
      { timeout: 15_000 },
    );
    await submit.click();
    const delRes = await delPromise;
    expect(delRes.status()).toBeGreaterThanOrEqual(200);
    expect(delRes.status()).toBeLessThan(300);
    const body = await delRes.json();
    expect(body.message).toBeTruthy();
  });

  test("scheduledDeletion=false branch: stubbed response logs the user out (subsequent /api/auth/me → 401)", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);
    await page.route("**/api/account/delete-request", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ scheduledDeletion: false, message: "Account deleted" }),
      }),
    );

    await page.goto("/profile");
    await page.locator('[data-testid="button-delete-account"]').click();
    await page.locator('[data-testid="input-delete-password"]').fill(isolatedOrg.password);
    await page.locator('[data-testid="checkbox-delete-confirm"]').check();
    await page.locator('[data-testid="button-confirm-delete"]').click();

    await expect.poll(async () => {
      const me = await page.request.get("/api/auth/me");
      return me.status();
    }, { timeout: 10_000 }).toBe(401);
  });

  test("scheduledDeletion=true branch: stubbed grace-period response keeps the session alive", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);
    await page.route("**/api/account/delete-request", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          scheduledDeletion: true,
          message: "Deletion scheduled in 30 days. You remain signed in.",
        }),
      }),
    );

    await page.goto("/profile");
    await page.locator('[data-testid="button-delete-account"]').click();
    await page.locator('[data-testid="input-delete-password"]').fill(isolatedOrg.password);
    await page.locator('[data-testid="checkbox-delete-confirm"]').check();
    await page.locator('[data-testid="button-confirm-delete"]').click();

    // Session stays alive — /api/auth/me must still be 200 after the response.
    await page.waitForTimeout(500);
    const me = await page.request.get("/api/auth/me");
    expect(me.status()).toBe(200);
  });

  test("submit is disabled when only the checkbox is checked (no password)", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);
    await page.goto("/profile");
    await page.locator('[data-testid="button-delete-account"]').click();
    await page.locator('[data-testid="checkbox-delete-confirm"]').check();
    await expect(page.locator('[data-testid="button-confirm-delete"]')).toBeDisabled();
  });

  test("cancel closes the dialog without scheduling deletion", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);
    await page.goto("/profile");
    await page.locator('[data-testid="button-delete-account"]').click();
    const cancel = page.locator('[data-testid="button-cancel-delete"]');
    await expect(cancel).toBeVisible({ timeout: 5_000 });
    await cancel.click();
    await expect(page.locator('[data-testid="input-delete-password"]')).toHaveCount(0, { timeout: 5_000 });
    await expect(page.locator('[data-testid="button-delete-account"]')).toBeVisible();
  });
});
