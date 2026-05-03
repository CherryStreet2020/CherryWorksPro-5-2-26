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

    const empty = page.locator('[data-testid="text-no-notifications"]');
    const card = page.locator('[data-testid^="card-notification-"]').first();
    await expect(empty.or(card)).toBeVisible({ timeout: 10_000 });

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

  test("seeded notification: card renders, mark-read fires PATCH, delete fires DELETE", async ({ page, isolatedOrg }) => {
    const seed = await isolatedOrg.request.post("/api/notifications", {
      data: { type: "system", title: `E2E ${Date.now()}`, message: "e2e" },
      headers: { "X-CSRF-Token": isolatedOrg.csrf },
    });
    if (!seed.ok()) {
      // Some envs gate POST /api/notifications to system seeders only;
      // in that case skip the mutation block but still assert filter
      // routing in the prior test stays meaningful.
      test.skip(true, "POST /api/notifications not available in this env");
      return;
    }
    const notif = await seed.json();

    await loginIsolated(page, isolatedOrg);
    await page.goto("/notifications");
    const card = page.locator(`[data-testid="card-notification-${notif.id}"]`);
    await expect(card).toBeVisible({ timeout: 15_000 });

    const markRead = page.locator(`[data-testid="button-mark-read-${notif.id}"]`);
    if (await markRead.count()) {
      const readPromise = page.waitForResponse(
        (r) => r.url().includes(`/api/notifications/${notif.id}`) && ["PATCH", "POST"].includes(r.request().method()),
        { timeout: 10_000 },
      );
      await markRead.click();
      const readRes = await readPromise;
      expect(readRes.status()).toBeLessThan(400);
    }

    const delPromise = page.waitForResponse(
      (r) => r.url().includes(`/api/notifications/${notif.id}`) && r.request().method() === "DELETE",
      { timeout: 10_000 },
    );
    await page.locator(`[data-testid="button-delete-${notif.id}"]`).click();
    const delRes = await delPromise;
    expect(delRes.status()).toBeLessThan(400);
    await expect(card).toHaveCount(0, { timeout: 10_000 });
  });
});
