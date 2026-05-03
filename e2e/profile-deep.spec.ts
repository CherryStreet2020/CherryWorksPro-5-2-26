import { test, expect } from "../tests/helpers/po/fixtures";
import { loginIsolated } from "./_iso-helpers";

test.use({ navigationTimeout: 30_000 });

test.describe("/profile deep", () => {
  test("profile fields save and round-trip via /api/auth/me", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);
    await page.goto("/profile");

    const first = page.locator('[data-testid="input-profile-firstName"]');
    await expect(first).toBeVisible({ timeout: 20_000 });
    await first.fill("Renamed");
    await page.locator('[data-testid="input-profile-lastName"]').fill("Admin");
    await page.locator('[data-testid="input-profile-phone"]').fill("555-0123");

    const savePromise = page.waitForResponse(
      (r) => r.url().includes("/api/auth/me") && r.request().method() === "PATCH",
      { timeout: 10_000 },
    );
    await page.locator('[data-testid="button-save-profile"]').click();
    const saveRes = await savePromise;
    expect(saveRes.status()).toBeLessThan(400);

    await expect.poll(async () => {
      const r = await isolatedOrg.request.get("/api/auth/me");
      const me = await r.json();
      return `${me.firstName ?? ""}/${me.lastName ?? ""}/${me.phone ?? ""}`;
    }, { timeout: 10_000 }).toBe("Renamed/Admin/555-0123");

    await expect(page.locator('[data-testid="input-avatar-file"]')).toBeAttached();
    await expect(page.locator('[data-testid="badge-current-session"]').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="text-profile-email"]')).toContainText(isolatedOrg.email);
    await expect(page.locator('[data-testid="text-profile-role"]')).toContainText(/admin/i);
  });

  test("notification preferences save round-trips via /api/notification-preferences", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);
    await page.goto("/profile");

    const before = await (await isolatedOrg.request.get("/api/notification-preferences")).json();
    const firstKey = Object.keys(before).find((k) => typeof before[k] === "boolean");
    expect(firstKey, "notification-preferences must expose at least one boolean key").toBeTruthy();
    const switchEl = page.locator(`[data-testid="switch-notif-${firstKey}"]`);
    await expect(switchEl).toBeVisible({ timeout: 20_000 });

    const targetValue = !before[firstKey!];
    if ((await switchEl.getAttribute("data-state")) !== (targetValue ? "checked" : "unchecked")) {
      await switchEl.click();
    }

    const putPromise = page.waitForResponse(
      (r) => r.url().includes("/api/notification-preferences") && r.request().method() === "PUT",
      { timeout: 10_000 },
    );
    await page.locator('[data-testid="button-save-notification-prefs"]').click();
    const putRes = await putPromise;
    expect(putRes.status()).toBeLessThan(400);

    await expect.poll(async () => {
      const r = await isolatedOrg.request.get("/api/notification-preferences");
      const j = await r.json();
      return j[firstKey!];
    }, { timeout: 10_000 }).toBe(targetValue);
  });

  test("active-sessions panel renders the current-session badge", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);
    await page.goto("/profile");
    await expect(page.locator('[data-testid="badge-current-session"]').first()).toBeVisible({ timeout: 20_000 });
    const sessionRows = page.locator('[data-testid^="session-row-"]');
    await expect(sessionRows.first()).toBeVisible();
  });
});
