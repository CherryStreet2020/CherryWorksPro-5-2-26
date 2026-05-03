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
import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const BASE = `http://localhost:${process.env.PORT || 5000}`;
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
  if (r.status() >= 400 && password === PRIMARY_ADMIN_PASS) {
    r = await request.post(`${BASE}/api/auth/login`, {
      data: { email, password: FALLBACK_ADMIN_PASS },
    });
  }
  expect(r.status(), `login as ${email} failed`).toBe(200);
  return password;
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
