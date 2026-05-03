import { test, expect } from "../tests/helpers/po/fixtures";
import { loginIsolated } from "./_iso-helpers";

test.use({ navigationTimeout: 30_000 });

test.describe("/notifications deep", () => {
  test("page renders header, filter, refresh, and an empty/cards body", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);
    await page.goto("/notifications");

    await expect(page.locator('[data-testid="text-notifications-title"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="select-type-filter"]')).toBeVisible();
    await expect(page.locator('[data-testid="button-refresh-notifications"]')).toBeVisible();

    const refreshPromise = page.waitForResponse(
      (r) => /\/api\/notifications(\?|$)/.test(r.url()),
      { timeout: 8_000 },
    );
    await page.locator('[data-testid="button-refresh-notifications"]').click();
    const refreshRes = await refreshPromise;
    expect(refreshRes.status()).toBe(200);
  });

  test("type filter (System) issues ?type=system to /api/notifications", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);
    await page.goto("/notifications");
    await expect(page.locator('[data-testid="select-type-filter"]')).toBeVisible({ timeout: 20_000 });

    const filterPromise = page.waitForRequest(
      (req) => /\/api\/notifications/.test(req.url()) && /[?&]type=/.test(req.url()),
      { timeout: 8_000 },
    );
    await page.locator('[data-testid="select-type-filter"]').click();
    await page.locator('[role="option"]', { hasText: "System" }).click();
    const req = await filterPromise;
    expect(req.url()).toMatch(/[?&]type=system/i);
  });

  test("seeded notification: card renders, mark-read fires POST /read, delete fires DELETE", async ({ page, isolatedOrg }) => {
    const title = `E2E ${Date.now()}`;
    const seed = await isolatedOrg.request.post("/api/notifications/send", {
      data: { type: "system", title, message: "e2e seeded" },
      headers: { "X-CSRF-Token": isolatedOrg.csrf },
    });
    expect(seed.status()).toBe(200);
    const { notification } = await seed.json();
    expect(notification?.id).toBeTruthy();

    await loginIsolated(page, isolatedOrg);
    await page.goto("/notifications");
    const card = page.locator(`[data-testid="card-notification-${notification.id}"]`);
    await expect(card).toBeVisible({ timeout: 15_000 });

    const readPromise = page.waitForResponse(
      (r) => r.url().includes(`/api/notifications/${notification.id}/read`) && r.request().method() === "POST",
      { timeout: 10_000 },
    );
    await page.locator(`[data-testid="button-mark-read-${notification.id}"]`).click();
    const readRes = await readPromise;
    expect(readRes.status()).toBeLessThan(400);

    const delPromise = page.waitForResponse(
      (r) => r.url().includes(`/api/notifications/${notification.id}`) && r.request().method() === "DELETE",
      { timeout: 10_000 },
    );
    await page.locator(`[data-testid="button-delete-${notification.id}"]`).click();
    const delRes = await delPromise;
    expect(delRes.status()).toBeLessThan(400);
    await expect(card).toHaveCount(0, { timeout: 10_000 });
  });
});
