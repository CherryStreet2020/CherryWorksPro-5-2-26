/**
 * Regression coverage for the "Recent email failure alerts" dashboard panel.
 *
 * A previous bug had `server/routes/email-deliverability-routes.ts` returning
 * the unawaited Promise from `listFailureAlerts` as the `alerts` field. That
 * shape mismatch crashed the admin dashboard rendering pipeline (the upgrade
 * interest widget alongside it could not render at all, the whole route blew
 * up under the Vite runtime-error overlay). The fix was a missing `await`,
 * but nothing prevented a similar regression. This spec asserts:
 *
 *   1. `GET /api/admin/email/failure-alerts` returns `alerts` as an array
 *      (not a Promise / not undefined / not an object).
 *   2. Loading `/dashboard` as an admin renders without the Vite runtime
 *      error overlay or the React error boundary fallback, and the email
 *      failure alerts card mounts on the page.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";

const ADMIN_EMAIL = "admin.test@cwpro.dev";
const ADMIN_PASS = "admin123";

async function loginViaApi(
  api: APIRequestContext,
  email: string,
  password: string,
): Promise<void> {
  const r = await api.post("/api/auth/login", { data: { email, password } });
  expect(r.status(), `login as ${email} should succeed`).toBe(200);
}

async function loginViaUi(
  page: import("@playwright/test").Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto("/login");
  await page.waitForSelector('[data-testid="input-email"]', { timeout: 15_000 });
  await page.fill('[data-testid="input-email"]', email);
  await page.fill('[data-testid="input-password"]', password);
  await page.click('[data-testid="button-login"]');
  await page.waitForURL("**/", { timeout: 15_000 });
}

test.describe("Recent email failure alerts panel — regression", () => {
  test("API returns alerts as an array and dashboard renders without crashing", async ({
    page,
    request,
  }) => {
    await loginViaApi(request, ADMIN_EMAIL, ADMIN_PASS);

    // 1. API shape contract: `alerts` must be a real array.
    const apiRes = await request.get(
      "/api/admin/email/failure-alerts?limit=5&offset=0",
    );
    expect(apiRes.status()).toBe(200);
    const body = await apiRes.json();
    expect(
      Array.isArray(body.alerts),
      "alerts must be a real array, not a Promise or other shape",
    ).toBe(true);
    expect(typeof body.total).toBe("number");
    expect(typeof body.thresholdPerHour).toBe("number");

    // 2. Dashboard renders end-to-end without surfacing the Vite runtime
    // overlay or the global error boundary fallback.
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => {
      pageErrors.push(err.message);
    });

    await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASS);
    await page.goto("/dashboard");

    // The card should mount (proves the dashboard didn't bail out before
    // rendering the admin-only widgets).
    await expect(
      page.locator('[data-testid="card-email-failure-alerts"]'),
    ).toBeVisible({ timeout: 15_000 });

    // No Vite runtime error overlay (the bug surfaced here).
    await expect(page.locator("vite-error-overlay")).toHaveCount(0);
    await expect(page.locator("#vite-error-overlay")).toHaveCount(0);

    // No "Something Went Wrong" boundary fallback.
    await expect(
      page.getByText(/Something Went Wrong/i),
    ).toHaveCount(0);

    // The card itself must not be in its error fallback state.
    await expect(
      page.locator('[data-testid="email-failure-alerts-error"]'),
    ).toHaveCount(0);

    expect(
      pageErrors,
      `unexpected page errors on /dashboard: ${pageErrors.join(" | ")}`,
    ).toEqual([]);
  });
});
