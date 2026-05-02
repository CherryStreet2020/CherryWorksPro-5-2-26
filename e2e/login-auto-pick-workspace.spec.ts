/**
 * Task #268 — Auto-pick last workspace flow.
 *
 * Verifies the client-side memory of the last-used workspace (Task #246)
 * end-to-end so a regression (e.g. localStorage key rename, picker UI
 * change) can't silently bring back the manual picker click for multi-org
 * admins on subsequent logins.
 *
 * Scenarios:
 *   1. First login → manual picker is shown; picking an org persists the
 *      slug in localStorage under `lastOrgSlug` and lands the user in the
 *      app.
 *   2. Second login (same browser, fresh session cookie) → the picker is
 *      auto-picked from `lastOrgSlug`, the auto-pick UI flashes, and the
 *      user lands in the app without ever clicking an org button.
 *   3. Third login → with the org-pick API call held open, the user can
 *      click "Switch workspace", which clears `lastOrgSlug` and returns
 *      them to the manual picker.
 *
 * Relies on the seeded multi-org admin `dean@cherrystconsulting.com`,
 * which is the same fixture used by other e2e specs (see
 * marketing-campaign-sequence-editors.spec.ts).
 */
import { test, expect, type Page, type BrowserContext } from "@playwright/test";

const ADMIN_EMAIL = "dean@cherrystconsulting.com";
const ADMIN_PASS = "CherryWorks2026!";
const PRIMARY_ORG_SLUG = "cherry-street-consulting";

async function fillCredentials(page: Page) {
  await page.fill('[data-testid="input-email"]', ADMIN_EMAIL);
  await page.fill('[data-testid="input-password"]', ADMIN_PASS);
  await page.click('[data-testid="button-login"]');
}

/**
 * Fail fast with a clear message if the seeded admin credentials have
 * drifted (the inline "Invalid credentials" error renders on the same
 * /login screen, which would otherwise show up as a generic locator
 * timeout further down the test).
 */
async function assertNoLoginError(page: Page) {
  const err = page.locator('[data-testid="text-login-error"]');
  if (await err.count()) {
    const msg = await err.first().textContent();
    throw new Error(
      `Login failed for fixture user ${ADMIN_EMAIL}: "${msg?.trim()}". ` +
        `The seeded password may have drifted from the e2e convention.`,
    );
  }
}

async function clearSession(context: BrowserContext) {
  await context.clearCookies();
}

test.describe("Login — auto-pick last workspace", () => {
  test("multi-org admin auto-picks on second login and Switch workspace forgets the saved slug", async ({ browser }) => {
    test.setTimeout(60_000);

    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      // ── Scenario 1: First login uses the manual picker ───────────────
      await page.goto("/login");
      await fillCredentials(page);

      // Multi-org admin should see the manual picker (no localStorage hint yet).
      const manualPickButton = page.locator(
        `[data-testid="button-org-pick-${PRIMARY_ORG_SLUG}"]`,
      );
      try {
        await manualPickButton.waitFor({ state: "visible", timeout: 15_000 });
      } catch (err) {
        // Surface a clearer diagnostic if the inline login error is what
        // actually rendered (i.e. the seeded password drifted).
        await assertNoLoginError(page);
        throw err;
      }
      await expect(manualPickButton).toBeVisible();
      // Ensure auto-pick UI did NOT render on first login.
      await expect(page.locator('[data-testid="state-auto-pick"]')).toHaveCount(0);

      await manualPickButton.click();

      await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
        timeout: 15_000,
      });

      // The chosen slug should now be remembered in localStorage.
      const savedSlug = await page.evaluate(() =>
        window.localStorage.getItem("lastOrgSlug"),
      );
      expect(savedSlug).toBe(PRIMARY_ORG_SLUG);

      // ── Scenario 2: Second login auto-picks the saved workspace ──────
      await clearSession(context);
      await page.goto("/login");

      // Track every org-pick login call so we can later assert no user
      // click was needed for the second login.
      let observedAutoPick = false;
      page.on("request", (req) => {
        if (
          req.url().endsWith("/api/auth/login") &&
          req.method() === "POST"
        ) {
          try {
            const body = req.postDataJSON();
            if (body?.orgSlug === PRIMARY_ORG_SLUG) {
              observedAutoPick = true;
            }
          } catch {
            /* non-JSON body — ignore */
          }
        }
      });

      await fillCredentials(page);

      // The auto-pick state should appear (proves the saved slug took
      // effect) and the user should land in the app without any manual
      // org-pick click.
      await expect(page.locator('[data-testid="state-auto-pick"]')).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.locator('[data-testid="text-auto-pick-name"]')).toBeVisible();

      await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
        timeout: 15_000,
      });

      expect(observedAutoPick).toBe(true);

      // localStorage key should still hold the same slug after auto-pick.
      const stillSaved = await page.evaluate(() =>
        window.localStorage.getItem("lastOrgSlug"),
      );
      expect(stillSaved).toBe(PRIMARY_ORG_SLUG);

      // ── Scenario 3: Switch workspace forgets the saved slug ─────────
      await clearSession(context);

      // Hold the org-pick login response open so the auto-pick UI stays
      // visible long enough to click "Switch workspace" before login
      // would otherwise complete. Capture the route so we can later
      // resolve it ourselves and prove the resolved response is ignored.
      let heldOrgPickRoute: import("@playwright/test").Route | null = null;
      await page.route("**/api/auth/login", async (route) => {
        const req = route.request();
        let isOrgPick = false;
        try {
          const body = req.postDataJSON();
          isOrgPick = !!body?.orgSlug;
        } catch {
          /* ignore */
        }
        if (isOrgPick && !heldOrgPickRoute) {
          // Capture the first auto-pick request and hold it open.
          heldOrgPickRoute = route;
          return;
        }
        await route.continue();
      });

      await page.goto("/login");
      await fillCredentials(page);

      // Auto-pick state appears because lastOrgSlug is still set.
      await expect(page.locator('[data-testid="state-auto-pick"]')).toBeVisible({
        timeout: 10_000,
      });

      // Wait until the held auto-pick request is actually in flight so we
      // know the abort path will exercise a real pending request.
      await expect.poll(() => heldOrgPickRoute !== null, { timeout: 10_000 }).toBe(true);

      // Click Switch workspace to abandon the auto-pick.
      await page.click('[data-testid="button-switch-workspace"]');

      // The manual picker should re-render…
      await expect(
        page.locator(`[data-testid="button-org-pick-${PRIMARY_ORG_SLUG}"]`),
      ).toBeVisible({ timeout: 10_000 });
      // …and the auto-pick UI should be gone.
      await expect(page.locator('[data-testid="state-auto-pick"]')).toHaveCount(0);

      // The saved slug should be cleared so future logins go back to the
      // manual picker by default.
      const clearedSlug = await page.evaluate(() =>
        window.localStorage.getItem("lastOrgSlug"),
      );
      expect(clearedSlug).toBeNull();

      // Now resolve the held auto-pick request with a successful login
      // payload. Even though the server "succeeded", the client must
      // ignore the result because the user opted out via Switch
      // workspace — otherwise they would be silently dropped back into
      // the auto-picked workspace.
      if (heldOrgPickRoute) {
        try {
          await (heldOrgPickRoute as import("@playwright/test").Route).fulfill({
            status: 200,
            contentType: "application/json",
            headers: { "x-csrf-token": "test-csrf-after-cancel" },
            body: JSON.stringify({
              id: "auto-pick-ignored-user",
              email: ADMIN_EMAIL,
              orgSlug: PRIMARY_ORG_SLUG,
            }),
          });
        } catch {
          /* route may already be released if browser cancelled it */
        }
      }

      // Give the client a moment to (incorrectly) act on the resolved
      // response if the abort path is broken.
      await page.waitForTimeout(750);

      // The user must still be on the manual picker, not silently
      // dropped back into the previously-saved workspace.
      await expect(page).toHaveURL(/\/login(\?|$)/);
      await expect(
        page.locator(`[data-testid="button-org-pick-${PRIMARY_ORG_SLUG}"]`),
      ).toBeVisible();
      await expect(page.locator('[data-testid="state-auto-pick"]')).toHaveCount(0);

      await page.unroute("**/api/auth/login");
    } finally {
      await context.close();
    }
  });
});
