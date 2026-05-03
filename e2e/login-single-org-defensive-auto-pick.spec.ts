/**
 * Task #459 — Defensive single-workspace auto-pick safety net.
 *
 * Task #458 added a client-side guard in `client/src/pages/login.tsx`:
 * if `POST /api/auth/login` ever returns a `{needsOrgPick: true,
 * orgs:[only]}` payload (i.e. a one-button picker), the client
 * auto-picks instead of rendering the picker. Today the server
 * finalises single-org logins inline, so the existing happy-path
 * coverage (`tests/unit/auth-login-single-org.test.ts` and
 * `e2e/login-single-org-no-picker.spec.ts`) never exercises this
 * branch.
 *
 * This spec stubs `/api/auth/login` to force the one-org `needsOrgPick`
 * payload and pins the safety net so a future refactor can't quietly
 * bring back a one-button picker.
 */
import { test, expect, type Route } from "@playwright/test";

declare global {
  interface Window {
    __recordPickClick?: () => void;
  }
}

interface LoginPostBody {
  orgSlug?: string;
  email?: string;
  password?: string;
}

const ONLY_ORG = { slug: "only-workspace", name: "Only Workspace" };
const FAKE_EMAIL = "defensive-auto-pick@example.com";
const FAKE_PASS = "doesnt-matter";

test.describe("Login — defensive single-workspace auto-pick", () => {
  test("a one-org needsOrgPick payload is auto-picked, never rendered as a button", async ({ page, context }) => {
    test.setTimeout(30_000);

    await context.clearCookies();

    // Sentinel: the user must never click an org-pick button.
    let pickClicked = false;
    await page.exposeFunction("__recordPickClick", () => {
      pickClicked = true;
    });

    let firstCallSeen = false;
    let autoPickCallSeen = false;
    // Hold the auto-pick response open until we've observed the
    // intermediate `state-auto-pick` UI. Without this the stubbed
    // success could race the assertion and fulfill before React
    // ever paints the auto-pick panel, making the test flaky.
    let releaseAutoPick: (() => void) | null = null;
    const autoPickReleased = new Promise<void>((resolve) => {
      releaseAutoPick = resolve;
    });

    await page.route("**/api/auth/login", async (route: Route) => {
      const req = route.request();
      let body: LoginPostBody = {};
      try {
        const parsed = req.postDataJSON();
        if (parsed && typeof parsed === "object") {
          body = parsed as LoginPostBody;
        }
      } catch {
        /* non-JSON body — ignore */
      }

      // Second call is the auto-pick: includes orgSlug. Hold the
      // response until the test has confirmed the auto-pick UI was
      // visible, then return a minimal session payload so the app
      // routes off /login.
      if (body.orgSlug === ONLY_ORG.slug) {
        autoPickCallSeen = true;
        await autoPickReleased;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "x-csrf-token": "test-csrf-defensive-auto-pick" },
          body: JSON.stringify({
            id: "defensive-auto-pick-user",
            email: FAKE_EMAIL,
            name: "Defensive Auto Pick",
            role: "TEAM_MEMBER",
            orgSlug: ONLY_ORG.slug,
            onboardingComplete: true,
            tempPassword: false,
          }),
        });
        return;
      }

      // First call (no orgSlug): force the one-org needsOrgPick payload
      // that the server should never actually emit today.
      firstCallSeen = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          needsOrgPick: true,
          orgs: [ONLY_ORG],
        }),
      });
    });

    await page.goto("/login");

    // Tag any future org-pick button click as a user interaction so the
    // assertion below would fail if the manual picker rendered and the
    // user clicked through it. We attach the listener at the document
    // level so it fires for buttons mounted later in the React tree.
    await page.evaluate(() => {
      document.addEventListener(
        "click",
        (e) => {
          const target = e.target as Element | null;
          const btn = target?.closest?.('[data-testid^="button-org-pick-"]');
          if (btn) {
            window.__recordPickClick?.();
          }
        },
        true,
      );
    });

    await page.fill('[data-testid="input-email"]', FAKE_EMAIL);
    await page.fill('[data-testid="input-password"]', FAKE_PASS);
    await page.click('[data-testid="button-login"]');

    // The auto-pick state must flash, identifying the only workspace
    // by name (proves the defensive branch in handleSubmit ran).
    // The auto-pick request is held open above so this assertion
    // always sees the intermediate UI deterministically.
    await expect(page.locator('[data-testid="state-auto-pick"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid="text-auto-pick-name"]')).toHaveText(
      ONLY_ORG.name,
    );

    // Now let the held auto-pick response complete so the app can
    // finalize the session and navigate off /login.
    releaseAutoPick?.();

    // The page must leave /login on its own — no user click required.
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 15_000,
    });

    expect(firstCallSeen, "first /api/auth/login should have been stubbed").toBe(true);
    expect(autoPickCallSeen, "client must have followed up with the auto-pick orgSlug call").toBe(true);
    expect(pickClicked, "no org-pick button may be clicked by the user in the defensive branch").toBe(false);

    await page.unroute("**/api/auth/login");
  });
});
