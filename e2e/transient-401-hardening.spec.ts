import { test, expect } from "../tests/helpers/po/fixtures";
import { loginIsolated, gotoWithRetry } from "./_iso-helpers";

test.use({ navigationTimeout: 30_000 });

test.describe("Transient 401 on boot — authed Marketing OS race", () => {
  test.fixme(
    "one-shot 401 on /api/auth/me during boot does not blow away an already-valid session",
    async ({ page, isolatedOrg }) => {
      // Establish a real session first (cookies + CSRF), then navigate
      // to the dashboard with a one-shot 401 stub on /api/auth/me to
      // mimic a session-restore race. Today the queryClient does NOT
      // silently retry the boot probe, so the dashboard fails to mount.
      // Pinned as fixme so the contract starts asserting the moment a
      // silent retry is added (see follow-up #455).
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
    "one-shot 401 on /api/csrf-token during boot does not break the next mutation",
    async ({ page, isolatedOrg }) => {
      // Same race for the CSRF probe: a transient 401 should be
      // followed by a silent retry so subsequent mutations have a
      // valid token. Today no retry exists; pinned as fixme.
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
    "one-shot 401 on /api/marketing/brand-info does not crash the marketing-OS surface",
    async ({ page, isolatedOrg }) => {
      // Marketing OS embed bootstrap calls /api/marketing/brand-info.
      // A transient 401 should not propagate to a crashed/empty UI.
      // No retry today → pinned as fixme.
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
    // Live counterpart to the three fixme tests: documents the
    // current behaviour so a future silent-retry change must update
    // BOTH this baseline and flip the fixme tests above.
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
    // The KPI deck does NOT paint on the first boot probe.
    await expect(page.locator('[data-testid="kpi-revenue"]')).toHaveCount(0, {
      timeout: 8_000,
    });
    expect(meHits).toBe(1);
  });
});
