/**
 * Shared E2E auth + CSRF helpers (Task #431).
 *
 * Centralises the boilerplate copy-pasted across ~30 specs in `e2e/`
 * so future specs can author against a stable surface. Mirrors the
 * conventions in `e2e/dashboard-kpi.spec.ts` (the canonical reference
 * spec) — both `CherryWorks2026!` and the seeded admin email are
 * preserved as defaults.
 *
 * Why two passwords float around the repo: `e2e/global-setup.ts` will
 * normalise the seed admin to `admin123`, while the canonical e2e
 * suite uses `CherryWorks2026!`. The seed reset only fires when the
 * env has DATABASE_URL and an explicit drift is detected. To keep
 * specs working under both arrangements we fall back to `admin123`
 * if the primary login attempt 4xxs.
 */
import { expect, request as pwRequest, type APIRequestContext, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";

export const BASE = `http://localhost:${process.env.PORT || 5000}`;

/**
 * Generate a per-test source IP. The Express app runs with
 * `trust proxy = 1`, so `X-Forwarded-For` becomes `req.ip` and is
 * what `express-rate-limit`'s default keyGenerator hashes on.
 * Returning a fresh IP per test isolates per-IP rate limiters
 * (signupLimiter, forgotPasswordLimiter, passwordChangeLimiter,
 * loginLimiter) so the suite runs in a single workflow without
 * spec-to-spec budget pollution.
 */
export function freshIp(): string {
  const b = randomBytes(2);
  return `198.51.${b[0]}.${(b[1] % 254) + 1}`;
}

/**
 * Returns a fresh APIRequestContext that the server sees as
 * coming from a brand-new client IP — bypassing per-IP rate
 * limits without touching the limiter implementation.
 */
export async function freshApiContext(opts: { ip?: string } = {}): Promise<APIRequestContext> {
  const ip = opts.ip ?? freshIp();
  return pwRequest.newContext({
    baseURL: BASE,
    extraHTTPHeaders: { "X-Forwarded-For": ip },
  });
}
export const ADMIN_EMAIL = "dean@cherrystconsulting.com";
export const PRIMARY_ADMIN_PASS = "CherryWorks2026!";
export const FALLBACK_ADMIN_PASS = "admin123";

export async function loginApi(
  request: APIRequestContext,
  email = ADMIN_EMAIL,
  password = PRIMARY_ADMIN_PASS,
): Promise<string> {
  let r = await request.post(`${BASE}/api/auth/login`, {
    data: { email, password },
  });
  let usedPassword = password;
  if (r.status() >= 400 && password === PRIMARY_ADMIN_PASS) {
    r = await request.post(`${BASE}/api/auth/login`, {
      data: { email, password: FALLBACK_ADMIN_PASS },
    });
    usedPassword = FALLBACK_ADMIN_PASS;
  }
  expect(r.status(), `login as ${email} failed`).toBe(200);
  // Task #445: if the user has multiple orgs (e.g. the seeded
  // `dean@cherrystconsulting.com` ends up with both `cherry-st` and
  // `cherry-street-consulting` after enough test runs), the first
  // login returns `{needsOrgPick: true, orgs: [...]}` with HTTP 200
  // but no session is established. Re-POST with the first org's
  // slug to complete the login. Without this every csrf-protected
  // call afterwards 401s.
  try {
    const body = await r.json();
    if (body && body.needsOrgPick && Array.isArray(body.orgs) && body.orgs.length > 0) {
      const orgSlug = body.orgs[0].slug;
      const r2 = await request.post(`${BASE}/api/auth/login`, {
        data: { email, password: usedPassword, orgSlug },
      });
      expect(r2.status(), `org-pick login as ${email}/${orgSlug} failed`).toBe(200);
    }
  } catch {
    // Body wasn't JSON or was empty — single-org login already
    // succeeded; nothing to follow up on.
  }
  return usedPassword;
}

export async function getCsrfToken(
  request: APIRequestContext,
): Promise<string> {
  const r = await request.get(`${BASE}/api/csrf-token`);
  expect(r.status()).toBe(200);
  return r.headers()["x-csrf-token"] || "";
}

export async function loginViaPage(
  page: Page,
  email = ADMIN_EMAIL,
  password = PRIMARY_ADMIN_PASS,
): Promise<void> {
  await page.goto("/login");
  await page.waitForSelector('[data-testid="input-email"]', { timeout: 15000 });
  await page.fill('[data-testid="input-email"]', email);
  await page.fill('[data-testid="input-password"]', password);
  await page.click('[data-testid="button-login"]');
  // Either the dashboard renders or the login error appears.
  try {
    await page.waitForLoadState("networkidle", { timeout: 15000 });
  } catch {
    /* networkidle can be flaky on streaming responses */
  }
  // If the primary creds bounced, try fallback.
  if (
    password === PRIMARY_ADMIN_PASS &&
    (await page.locator('[data-testid="text-login-error"]').isVisible().catch(() => false))
  ) {
    await page.fill('[data-testid="input-password"]', FALLBACK_ADMIN_PASS);
    await page.click('[data-testid="button-login"]');
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
  }
  // Task #445: when the user has multiple orgs the login page renders
  // a workspace picker (`button-org-pick-<slug>`). Wait briefly for it
  // and click the first option so callers always end up signed into
  // a real org. Use `waitFor` (not `isVisible`) so we don't race
  // React paint after the post-login response.
  const orgPick = page.locator('[data-testid^="button-org-pick-"]').first();
  try {
    await orgPick.waitFor({ state: "visible", timeout: 3000 });
    await orgPick.click();
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
  } catch {
    // No picker rendered — single-org user, nothing to do.
  }
}

export async function apiPost(
  request: APIRequestContext,
  csrf: string,
  path: string,
  data?: Record<string, unknown>,
) {
  return request.post(`${BASE}${path}`, {
    data,
    headers: { "X-CSRF-Token": csrf },
  });
}

export async function apiDelete(
  request: APIRequestContext,
  csrf: string,
  path: string,
) {
  return request.delete(`${BASE}${path}`, {
    headers: { "X-CSRF-Token": csrf },
  });
}
