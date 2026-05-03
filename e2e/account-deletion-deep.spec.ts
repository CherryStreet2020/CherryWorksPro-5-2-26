import { test, expect } from "../tests/helpers/po/fixtures";
import { loginIsolated } from "./_iso-helpers";

test.use({ navigationTimeout: 30_000 });

test.describe("Account deletion deep", () => {
  test("dialog gates submit on password+confirm, then POSTs /api/account/delete-request", async ({ page, isolatedOrg }) => {
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

    // Server returns either { scheduledDeletion: true } (last-admin
    // grace period — user stays signed in) or { scheduledDeletion: false }
    // (immediate logout). Pin both branches deterministically.
    if (body.scheduledDeletion === false) {
      await expect.poll(async () => {
        const me = await page.request.get("/api/auth/me");
        return me.status();
      }, { timeout: 8_000 }).toBe(401);
    } else {
      const billing = await isolatedOrg.request.get("/api/billing/status");
      expect(billing.status()).toBeLessThan(500);
    }
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
