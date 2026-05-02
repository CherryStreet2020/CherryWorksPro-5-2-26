/**
 * E2E coverage for the per-org "Marketing Send Retries" controls in
 * Settings → Accounting & Email (Task #271).
 *
 * Asserts:
 *   1. An admin can change Max attempts + Base backoff (minutes), save them,
 *      reload the page, and see the new values reflected on the form and on
 *      the underlying GET /api/org/settings payload (round-trip).
 *   2. The PATCH /api/org/settings validator rejects out-of-range values
 *      rather than silently persisting them — both for max attempts (1..20)
 *      and for the base backoff (1..1440 minutes / capped at 24h).
 *   3. The saved settings are restored to a sane default at the end so the
 *      test is idempotent and doesn't leak state into other suites.
 */
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

const ADMIN_EMAIL = "admin.test@cwpro.dev";
const ADMIN_PASS = "admin123";

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_RETRY_BASE_MS = 5 * 60 * 1000;

async function loginViaApi(
  api: APIRequestContext,
  email: string,
  password: string,
): Promise<{ csrf: string }> {
  const r = await api.post("/api/auth/login", { data: { email, password } });
  expect(r.status(), `login as ${email} should succeed`).toBe(200);
  const tok = await api.get("/api/csrf-token");
  expect(tok.status()).toBe(200);
  const body = await tok.json();
  const csrf = (body.token ?? body.csrfToken) as string;
  expect(csrf, "csrf token should be returned").toBeTruthy();
  return { csrf };
}

async function loginViaUi(
  page: Page,
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

async function openAccountingEmailTab(page: Page): Promise<void> {
  await page.goto("/settings#accounting-email");
  await page.waitForSelector('[data-testid="tab-accounting-email"]', {
    timeout: 15_000,
  });
  await page.click('[data-testid="tab-accounting-email"]');
}

async function patchSettings(
  api: APIRequestContext,
  csrf: string,
  data: Record<string, unknown>,
) {
  return api.patch("/api/org/settings", {
    headers: { "x-csrf-token": csrf, "content-type": "application/json" },
    data,
  });
}

test.describe("Settings → Marketing Send Retries (Task #271)", () => {
  test("admin can change attempts + base backoff, save, and have them persist across reload", async ({
    page,
    request,
  }) => {
    const { csrf } = await loginViaApi(request, ADMIN_EMAIL, ADMIN_PASS);

    // Reset to documented defaults so the test starts from a known shape and
    // we can prove the save actually changed them.
    const reset = await patchSettings(request, csrf, {
      marketingSendMaxAttempts: DEFAULT_MAX_ATTEMPTS,
      marketingSendRetryBaseMs: DEFAULT_RETRY_BASE_MS,
    });
    expect(reset.status()).toBe(200);

    try {
      await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASS);
      await openAccountingEmailTab(page);

      const attemptsInput = page.locator(
        '[data-testid="input-marketing-max-attempts"]',
      );
      const baseInput = page.locator(
        '[data-testid="input-marketing-retry-base"]',
      );
      const saveBtn = page.locator('[data-testid="button-save-settings"]').first();

      await expect(attemptsInput).toBeVisible({ timeout: 15_000 });
      await expect(baseInput).toBeVisible();

      // Defaults render as the documented 5 / 5.
      await expect(attemptsInput).toHaveValue(String(DEFAULT_MAX_ATTEMPTS));
      await expect(baseInput).toHaveValue(
        String(DEFAULT_RETRY_BASE_MS / 60_000),
      );

      // Change to non-default values inside the valid range.
      const NEW_ATTEMPTS = "2";
      const NEW_BASE_MIN = "10";
      await attemptsInput.fill(NEW_ATTEMPTS);
      await baseInput.fill(NEW_BASE_MIN);

      // The Save button toggles to the dirty label once the form differs.
      await expect(saveBtn).toContainText(/Save Settings/i);
      await expect(saveBtn).toBeEnabled();
      await saveBtn.click();

      // After a successful save the button collapses back to the clean label.
      await expect(saveBtn).toContainText(/Settings Saved/i, { timeout: 10_000 });

      // Belt-and-suspenders: GET reflects the persisted values immediately.
      const after = await request.get("/api/org/settings");
      expect(after.status()).toBe(200);
      const afterBody = await after.json();
      expect(afterBody.marketingSendMaxAttempts).toBe(Number(NEW_ATTEMPTS));
      expect(afterBody.marketingSendRetryBaseMs).toBe(
        Number(NEW_BASE_MIN) * 60_000,
      );

      // Hard reload and re-open the tab — values must round-trip from the DB
      // back into the form, not just live in local React state.
      await page.reload();
      await openAccountingEmailTab(page);
      await expect(attemptsInput).toHaveValue(NEW_ATTEMPTS, { timeout: 15_000 });
      await expect(baseInput).toHaveValue(NEW_BASE_MIN);

      // UI-driven clamp: typing an out-of-range max-attempts (above the
      // documented 20-cap) and saving must result in the persisted value
      // being clamped down to 20 — never silently saved as 999. This proves
      // the form-layer clamp wired in client/src/pages/settings.tsx is
      // active end-to-end, not just the API validator.
      await attemptsInput.fill("999");
      await expect(saveBtn).toContainText(/Save Settings/i);
      await saveBtn.click();
      await expect(saveBtn).toContainText(/Settings Saved/i, { timeout: 10_000 });

      const clamped = await request.get("/api/org/settings");
      expect(clamped.status()).toBe(200);
      const clampedBody = await clamped.json();
      expect(clampedBody.marketingSendMaxAttempts).toBe(20);

      await page.reload();
      await openAccountingEmailTab(page);
      await expect(attemptsInput).toHaveValue("20", { timeout: 15_000 });
    } finally {
      // Always restore documented defaults so a mid-test failure can't leak
      // mutated org settings into other suites.
      const restore = await patchSettings(request, csrf, {
        marketingSendMaxAttempts: DEFAULT_MAX_ATTEMPTS,
        marketingSendRetryBaseMs: DEFAULT_RETRY_BASE_MS,
      });
      expect(restore.status()).toBe(200);
    }
  });

  test("PATCH /api/org/settings rejects out-of-range marketing retry values", async ({
    request,
  }) => {
    const { csrf } = await loginViaApi(request, ADMIN_EMAIL, ADMIN_PASS);

    // Snapshot the current values so the rejected requests cannot have
    // silently mutated the org settings even if the validator regressed.
    const before = await request.get("/api/org/settings");
    expect(before.status()).toBe(200);
    const beforeBody = await before.json();
    const beforeAttempts = beforeBody.marketingSendMaxAttempts;
    const beforeBaseMs = beforeBody.marketingSendRetryBaseMs;
    expect(typeof beforeAttempts).toBe("number");
    expect(typeof beforeBaseMs).toBe("number");

    // 0 attempts is below the documented minimum (1).
    const tooFewAttempts = await patchSettings(request, csrf, {
      marketingSendMaxAttempts: 0,
    });
    expect(tooFewAttempts.status()).toBe(400);

    // 21 attempts is above the documented maximum (20).
    const tooManyAttempts = await patchSettings(request, csrf, {
      marketingSendMaxAttempts: 21,
    });
    expect(tooManyAttempts.status()).toBe(400);

    // Base backoff below 1 second (the schema's lower bound) must reject.
    const tooSmallBase = await patchSettings(request, csrf, {
      marketingSendRetryBaseMs: 500,
    });
    expect(tooSmallBase.status()).toBe(400);

    // Base backoff above the 24h cap must reject.
    const tooLargeBase = await patchSettings(request, csrf, {
      marketingSendRetryBaseMs: 24 * 60 * 60 * 1000 + 1,
    });
    expect(tooLargeBase.status()).toBe(400);

    // Non-integer attempts (the schema requires .int()) must reject — guards
    // against a future loosening of the validator that would let UI typos
    // through.
    const fractionalAttempts = await patchSettings(request, csrf, {
      marketingSendMaxAttempts: 2.5,
    });
    expect(fractionalAttempts.status()).toBe(400);

    // Confirm none of the rejected requests mutated the persisted values.
    const after = await request.get("/api/org/settings");
    expect(after.status()).toBe(200);
    const afterBody = await after.json();
    expect(afterBody.marketingSendMaxAttempts).toBe(beforeAttempts);
    expect(afterBody.marketingSendRetryBaseMs).toBe(beforeBaseMs);
  });
});
