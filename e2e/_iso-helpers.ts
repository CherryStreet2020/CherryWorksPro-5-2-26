import type { Page, Response as PWResponse } from "@playwright/test";
import type { IsolatedOrgFixture } from "../tests/helpers/po/fixtures";

/**
 * Dev-server 502 retry helper.
 *
 * Vite's dev middleware occasionally surfaces a transient 502 on the
 * very first hit to a freshly-cold-compiled route — most often when
 * several Playwright workers race for the same SSR boundary at suite
 * startup. The 502 is not a real bug; it goes away on a re-fetch a few
 * hundred ms later.
 *
 * `gotoWithRetry` wraps `page.goto` with a small bounded retry loop so
 * specs that hit dev-only routes don't fail their first navigation
 * just because Vite needed another round trip. Retries are scoped to
 * 502/503/504 (gateway / service-unavailable / gateway-timeout) — every
 * other response is returned untouched so real 4xx/5xx surfaces still
 * fail loudly.
 */
export async function gotoWithRetry(
  page: Page,
  url: string,
  opts: {
    /** How many extra attempts after the first. Default 2 → up to 3 navigations total. */
    retries?: number;
    /** Backoff floor in ms. Default 250. */
    backoffMs?: number;
    /** Forwarded to page.goto. */
    timeout?: number;
    waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
  } = {},
): Promise<PWResponse | null> {
  const retries = opts.retries ?? 2;
  const backoffMs = opts.backoffMs ?? 250;
  const isTransient = (s: number) => s === 502 || s === 503 || s === 504;
  let last: PWResponse | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    last = await page.goto(url, {
      timeout: opts.timeout,
      waitUntil: opts.waitUntil,
    });
    const s = last?.status() ?? 0;
    if (!isTransient(s)) return last;
    if (attempt < retries) {
      await page.waitForTimeout(backoffMs * (attempt + 1));
    }
  }
  return last;
}

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
