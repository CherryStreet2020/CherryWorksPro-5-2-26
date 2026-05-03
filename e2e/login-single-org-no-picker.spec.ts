/**
 * Task #458 — Single-org admin never sees the workspace picker.
 *
 * Task #457 removed the duplicate `cherry-street-consulting` org so the
 * seeded admin `dean@cherrystconsulting.com` lives on exactly one
 * workspace. This spec pins the user-facing outcome: from the moment
 * the user clicks "Sign in", no workspace-picker UI may appear before
 * the dashboard renders. Pairs with `tests/unit/auth-login-single-org.test.ts`,
 * which holds the API-layer contract.
 */
import { test, expect } from "@playwright/test";
import {
  ADMIN_EMAIL,
  PRIMARY_ADMIN_PASS,
  FALLBACK_ADMIN_PASS,
} from "../tests/helpers/po/auth";

test.describe("Login — single-org admin", () => {
  test("workspace picker never renders for the seeded admin", async ({ page, context }) => {
    test.setTimeout(45_000);

    // Defensive: clear any saved last-org hint so the auto-pick branch
    // (which is a different code path) can't be the reason the picker
    // is absent.
    await page.goto("/login");
    await page.evaluate(() => {
      try { localStorage.removeItem("lastOrgSlug"); } catch {}
    });
    await context.clearCookies();
    await page.goto("/login");

    // Sentinel listener: if /api/auth/login ever responds with the
    // org-pick payload, that's the failure mode we're guarding against.
    let observedNeedsOrgPick = false;
    page.on("response", async (res) => {
      if (
        res.url().endsWith("/api/auth/login") &&
        res.request().method() === "POST"
      ) {
        try {
          const body = await res.json();
          if (body?.needsOrgPick) observedNeedsOrgPick = true;
        } catch {
          /* non-JSON body — ignore */
        }
      }
    });

    await page.fill('[data-testid="input-email"]', ADMIN_EMAIL);
    await page.fill('[data-testid="input-password"]', PRIMARY_ADMIN_PASS);
    await page.click('[data-testid="button-login"]');

    // Mirror the password fallback in `tests/helpers/po/auth.ts`
    // (`loginViaPage`): if the seeded admin password has been reset
    // to `admin123` by a previous run, retry with the fallback before
    // the picker assertions below.
    if (
      await page
        .locator('[data-testid="text-login-error"]')
        .isVisible()
        .catch(() => false)
    ) {
      await page.fill('[data-testid="input-password"]', FALLBACK_ADMIN_PASS);
      await page.click('[data-testid="button-login"]');
    }

    // The user should land off /login without ever passing through the
    // picker UI.
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 20_000,
    });

    expect(
      observedNeedsOrgPick,
      "single-org admin login must finalize in one round trip (no needsOrgPick)",
    ).toBe(false);

    // Belt-and-braces: neither the manual picker nor the auto-pick
    // intermediate panel should have rendered.
    await expect(page.locator('[data-testid^="button-org-pick-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="state-auto-pick"]')).toHaveCount(0);
  });
});
