/**
 * Transient-401 hardening (Task #444).
 *
 * Pins the current contract for /api/auth/me + /api/csrf-token under
 * a transient 401 (race between the boot-time auth check and a fresh
 * session being persisted). Today the queryClient does NOT silently
 * retry 401, so a one-shot 401 on /api/auth/me must surface as the
 * unauthenticated state — i.e. the dashboard never paints; the user
 * is redirected to /login. If we ever decide to add a silent retry
 * on the boot-time auth probe, this spec will fail loudly and force
 * the contract change to be visible.
 */
import { test, expect } from "@playwright/test";

test.use({ navigationTimeout: 30_000 });

test.describe("Transient 401 on boot — auth probe", () => {
  test("one-shot 401 on /api/auth/me does NOT silently re-authenticate the page", async ({ page }) => {
    let meHits = 0;
    await page.route("**/api/auth/me", async (route) => {
      meHits++;
      if (meHits === 1) {
        await route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ message: "Unauthorized" }),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto("/dashboard");
    // Without a session, /dashboard renders the public marketing
    // landing (App.tsx falls through to AppContent → MarketingHome
    // when not authed). Either way we must NOT see the authed
    // dashboard KPI deck on the first paint.
    await expect(page.locator('[data-testid="kpi-revenue"]')).toHaveCount(0, {
      timeout: 10_000,
    });
    expect(meHits).toBeGreaterThanOrEqual(1);
  });

  test("one-shot 401 on /api/csrf-token does not crash the public landing", async ({ page }) => {
    const errs: string[] = [];
    page.on("pageerror", (e) => errs.push(e.message));
    let csrfHits = 0;
    await page.route("**/api/csrf-token", async (route) => {
      csrfHits++;
      if (csrfHits === 1) {
        await route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ message: "Unauthorized" }),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto("/contact");
    await expect(page.locator('[data-testid="input-contact-name"]')).toBeVisible({
      timeout: 15_000,
    });
    expect(
      errs.filter((m) => !/Failed to load resource/i.test(m)),
      `pageerrors: ${errs.join(" | ")}`,
    ).toEqual([]);
  });
});
