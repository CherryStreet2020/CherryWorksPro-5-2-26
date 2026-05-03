/**
 * Error surfaces — REAL trigger paths (Task #444, audit §3.5).
 *
 * The pre-existing `error-pages.spec.ts` only validates that each
 * surface paints when navigated to directly. The audit specifically
 * called out the gap: "no spec asserts each is reached for the right
 * reason." This spec closes that gap with organic flows:
 *
 *   - 403  → a TEAM_MEMBER inside an isolated org tries to load
 *            `/admin/data`. `AdminRoute` (App.tsx) inlines `<Error403/>`
 *            for non-admins, exactly the production code path that
 *            would render the 403 surface to a real user.
 *   - 404  → an authed user navigates to a path that does not match
 *            any registered route. `<Switch>`'s catch-all renders the
 *            `NotFound` page.
 *   - 500  → the routable `/500` path itself is the production
 *            redirect target for fatal server-side failures (it is the
 *            only sanctioned organic entry to `Error500`). The
 *            `ErrorBoundary` shell uses the same `text-error-title`
 *            anchor with "Something Went Wrong" copy when a child
 *            throws — verified separately in `error-pages.spec.ts`.
 *
 * Every check pins the page-level `text-error-title` test id with the
 * specific copy belonging to that surface so a regression that swaps
 * one page for another (e.g. AdminRoute accidentally rendering
 * `NotFound` for a non-admin) fails loudly instead of passing on the
 * weaker "any error title" matcher used by the smoke spec.
 */
import { test, expect } from "../tests/helpers/po/fixtures";
import { addUserToIsolatedOrg } from "../tests/helpers/po/isolation";
import { loginIsolated, gotoWithRetry } from "./_iso-helpers";
import { request as pwRequest } from "@playwright/test";

test.use({ navigationTimeout: 30_000 });

const BASE = `http://localhost:${process.env.PORT || 5000}`;

async function loginAs(page: import("@playwright/test").Page, email: string, password: string) {
  const sourceIp = `198.51.100.${Math.floor(Math.random() * 254) + 1}`;
  const ctx = await pwRequest.newContext({
    baseURL: BASE,
    extraHTTPHeaders: { "X-Forwarded-For": sourceIp },
  });
  try {
    const res = await ctx.post(`${BASE}/api/auth/login`, { data: { email, password } });
    if (res.status() !== 200) throw new Error(`login as ${email} failed: ${res.status()}`);
    const state = await ctx.storageState();
    if (state.cookies.length > 0) await page.context().addCookies(state.cookies);
  } finally {
    await ctx.dispose();
  }
}

test.describe("Error surfaces — organic trigger paths", () => {
  test("TEAM_MEMBER hitting an admin-only route renders the 403 surface (Access Denied)", async ({
    page,
    isolatedOrg,
  }) => {
    const tm = await addUserToIsolatedOrg(isolatedOrg.orgId, "TEAM_MEMBER");
    await loginAs(page, tm.email, tm.password);
    // /admin/data is wrapped in <AdminRoute>. For non-ADMIN sessions
    // AdminRoute returns <Error403/> inline (App.tsx) — the same code
    // path a production user would traverse.
    await gotoWithRetry(page, "/admin/data");
    const title = page.locator('[data-testid="text-error-title"]');
    await expect(title).toBeVisible({ timeout: 20_000 });
    await expect(title).toHaveText(/Access Denied/i);
    await expect(page.locator('[data-testid="link-back-to-dashboard"]')).toBeVisible();
  });

  test("authed user hitting an unknown route renders the 404 surface (Page Not Found)", async ({
    page,
    isolatedOrg,
  }) => {
    await loginIsolated(page, isolatedOrg);
    await gotoWithRetry(page, `/totally-bogus-${Date.now()}`);
    const title = page.locator('[data-testid="text-error-title"]');
    await expect(title).toBeVisible({ timeout: 20_000 });
    await expect(title).toHaveText(/Page Not Found/i);
  });

  test("/500 surface renders Something Went Wrong (rendering check, not an organic trigger)", async ({
    page,
    isolatedOrg,
  }) => {
    await loginIsolated(page, isolatedOrg);
    // Scope note: this is a rendering smoke check ONLY. There is no
    // in-app code path that organically navigates a user to `/500` —
    // the route exists as a registered redirect target so a future
    // server-side handler can send users here, but no such handler
    // currently exercises it. Audit §3.5's "right reason" guarantee
    // therefore does NOT apply to this case; the assertion is
    // narrowed to "the route still resolves to the Error500 surface
    // with the expected anchor" so an accidental router rewire
    // (e.g. swapping Error500 for NotFound) still trips the suite.
    await gotoWithRetry(page, "/500");
    const title = page.locator('[data-testid="text-error-title"]');
    await expect(title).toBeVisible({ timeout: 20_000 });
    await expect(title).toHaveText(/Something Went Wrong/i);
  });
});
