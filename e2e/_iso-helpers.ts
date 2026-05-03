import type { Page } from "@playwright/test";
import type { IsolatedOrgFixture } from "../tests/helpers/po/fixtures";

/**
 * Hydrate the page's browser context with the cookies from the
 * isolated-org's APIRequestContext (Task #440).
 *
 * The fixture's `iso.request` was already authed via `/api/auth/login`,
 * so we transfer those cookies directly instead of hitting `/login`
 * a second time. The auth-route rate limiter rejects the second login
 * with 429 once we run more than a handful of tests in a row.
 */
export async function loginIsolated(
  page: Page,
  iso: Pick<IsolatedOrgFixture, "request">,
): Promise<void> {
  const state = await iso.request.storageState();
  if (state.cookies.length > 0) {
    await page.context().addCookies(state.cookies);
  }
}
