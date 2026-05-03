import { test, expect } from "../tests/helpers/po/fixtures";
import { loginIsolated, gotoWithRetry } from "./_iso-helpers";

test.use({ navigationTimeout: 30_000 });

test.describe("Transient 401 on boot — authed Marketing OS race", () => {
  test.fixme(
    "silent retry: one-shot 401 on /api/auth/me does not blow away an already-valid session (follow-up #453)",
    async ({ page, isolatedOrg }) => {
      await loginIsolated(page, isolatedOrg);
      let meHits = 0;
      await page.route("**/api/auth/me", async (route) => {
        meHits++;
        if (meHits === 1) {
          return route.fulfill({
            status: 401,
            contentType: "application/json",
            body: JSON.stringify({ message: "Unauthorized" }),
          });
        }
        return route.continue();
      });
      await gotoWithRetry(page, "/dashboard");
      await expect(page.locator('[data-testid="kpi-revenue"]')).toBeVisible({
        timeout: 15_000,
      });
      expect(meHits).toBeGreaterThanOrEqual(2);
    },
  );

  test.fixme(
    "silent retry: one-shot 401 on /api/csrf-token does not break the next mutation (follow-up #453)",
    async ({ page, isolatedOrg }) => {
      await loginIsolated(page, isolatedOrg);
      let csrfHits = 0;
      await page.route("**/api/csrf-token", async (route) => {
        csrfHits++;
        if (csrfHits === 1) {
          return route.fulfill({
            status: 401,
            contentType: "application/json",
            body: JSON.stringify({ message: "Unauthorized" }),
          });
        }
        return route.continue();
      });
      await gotoWithRetry(page, "/dashboard");
      await expect(page.locator('[data-testid="kpi-revenue"]')).toBeVisible({
        timeout: 15_000,
      });
      expect(csrfHits).toBeGreaterThanOrEqual(2);
    },
  );

  test.fixme(
    "silent retry: one-shot 401 on /api/marketing/brand-info does not crash the marketing-OS surface (follow-up #453)",
    async ({ page, isolatedOrg }) => {
      await loginIsolated(page, isolatedOrg);
      let hits = 0;
      await page.route("**/api/marketing/brand-info**", async (route) => {
        hits++;
        if (hits === 1) {
          return route.fulfill({
            status: 401,
            contentType: "application/json",
            body: JSON.stringify({ message: "Unauthorized" }),
          });
        }
        return route.continue();
      });
      await gotoWithRetry(page, "/marketing/brands");
      await expect(page.locator('[data-testid="kpi-revenue"]')).toHaveCount(0);
      expect(hits).toBeGreaterThanOrEqual(2);
    },
  );

  test("regression baseline: today the boot 401 surfaces immediately (no silent retry)", async ({
    page,
    isolatedOrg,
  }) => {
    await loginIsolated(page, isolatedOrg);
    let meHits = 0;
    await page.route("**/api/auth/me", async (route) => {
      meHits++;
      if (meHits === 1) {
        return route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ message: "Unauthorized" }),
        });
      }
      return route.continue();
    });
    await gotoWithRetry(page, "/dashboard");
    await expect(page.locator('[data-testid="kpi-revenue"]')).toHaveCount(0, {
      timeout: 8_000,
    });
    expect(meHits).toBe(1);
  });
});
