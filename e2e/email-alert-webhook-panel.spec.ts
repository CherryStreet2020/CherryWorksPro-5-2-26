/**
 * E2E coverage for the Email Alert Webhook panel rendered in
 * Settings → Accounting & Email.
 *
 * Asserts:
 *   1. Admin can save a webhook URL in Settings, see the value persist
 *      across a reload, and clear it via the Clear button.
 *   2. A non-admin user does not see the panel (Settings is admin-only;
 *      the panel must never appear in the DOM for them).
 */
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

const ADMIN_EMAIL = "admin.test@cwpro.dev";
const ADMIN_PASS = "admin123";
const NON_ADMIN_EMAIL = "team.test@cwpro.dev";
const NON_ADMIN_PASS = "team123";

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

test.describe("Email alert webhook panel — admin view", () => {
  test("admin can save, persist, and clear the webhook from Settings", async ({
    page,
    request,
  }) => {
    // Start from a clean slate so prior runs don't influence the panel.
    const { csrf } = await loginViaApi(request, ADMIN_EMAIL, ADMIN_PASS);
    const preClear = await request.delete("/api/admin/email-alert-webhook", {
      headers: { "x-csrf-token": csrf },
    });
    expect([200, 204]).toContain(preClear.status());

    await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASS);
    await openAccountingEmailTab(page);

    const panel = page.locator('[data-testid="panel-email-alert-webhook"]');
    await expect(panel).toBeVisible({ timeout: 15_000 });

    const urlInput = page.locator('[data-testid="input-email-alert-webhook-url"]');
    const cooldownInput = page.locator(
      '[data-testid="input-email-alert-webhook-cooldown"]',
    );
    const saveBtn = page.locator('[data-testid="button-save-email-alert-webhook"]');

    // Clean state: no Clear button is rendered when nothing is configured.
    await expect(urlInput).toHaveValue("");
    await expect(
      page.locator('[data-testid="button-clear-email-alert-webhook"]'),
    ).toHaveCount(0);

    // Save a new webhook URL and a custom cooldown.
    const TEST_URL = "https://hooks.slack.com/services/T000/B000/test-webhook-xyz";
    await urlInput.fill(TEST_URL);
    await cooldownInput.fill("30");
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();

    // After saving, the Clear button appears (panel re-renders from the
    // refreshed query) — that's our signal that persistence succeeded.
    const clearBtn = page.locator('[data-testid="button-clear-email-alert-webhook"]');
    await expect(clearBtn).toBeVisible({ timeout: 10_000 });

    // Reload the whole page and re-open the tab; the saved value must
    // round-trip from the database back into the form.
    await page.reload();
    await openAccountingEmailTab(page);
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(urlInput).toHaveValue(TEST_URL);
    await expect(cooldownInput).toHaveValue("30");
    await expect(clearBtn).toBeVisible();

    // Belt-and-suspenders: the GET endpoint reflects the same persisted
    // configuration that the form is showing.
    const getRes = await request.get("/api/admin/email-alert-webhook");
    expect(getRes.status()).toBe(200);
    const getBody = await getRes.json();
    expect(getBody.configured).toBe(true);
    expect(getBody.webhookUrl).toBe(TEST_URL);
    expect(getBody.cooldownMs).toBe(30 * 60 * 1000);

    // Click Clear and confirm the form empties out and the Clear button
    // disappears (it only renders when `configured` is true).
    await clearBtn.click();
    await expect(
      page.locator('[data-testid="button-clear-email-alert-webhook"]'),
    ).toHaveCount(0, { timeout: 10_000 });
    await expect(urlInput).toHaveValue("");
    await expect(cooldownInput).toHaveValue("");

    // Reload one more time to prove the cleared state is also persisted,
    // not just held in the local React state.
    await page.reload();
    await openAccountingEmailTab(page);
    await expect(urlInput).toHaveValue("");
    await expect(
      page.locator('[data-testid="button-clear-email-alert-webhook"]'),
    ).toHaveCount(0);

    const getRes2 = await request.get("/api/admin/email-alert-webhook");
    expect(getRes2.status()).toBe(200);
    const getBody2 = await getRes2.json();
    expect(getBody2.configured).toBe(false);
    expect(getBody2.webhookUrl).toBeNull();
  });
});

test.describe("Email alert webhook panel — recent tests history", () => {
  test("admin sees multiple rows in 'Show recent tests' after several attempts", async ({
    page,
    request,
  }) => {
    const { csrf } = await loginViaApi(request, ADMIN_EMAIL, ADMIN_PASS);

    // Make sure we start with a clean webhook config + history.
    const preClear = await request.delete("/api/admin/email-alert-webhook", {
      headers: { "x-csrf-token": csrf },
    });
    expect([200, 204]).toContain(preClear.status());

    // Configure a webhook URL — the test endpoint requires one and will
    // record a row in email_alert_webhook_tests for every attempt
    // (succeeded or failed).
    const TEST_URL =
      "https://hooks.slack.com/services/T000/B000/recent-tests-history-xyz";
    const putRes = await request.put("/api/admin/email-alert-webhook", {
      headers: { "x-csrf-token": csrf, "content-type": "application/json" },
      data: { webhookUrl: TEST_URL, cooldownMs: null },
    });
    expect(putRes.status()).toBe(200);

    // Trigger several test attempts. We don't care whether Slack accepts
    // the payload — failures still produce a recentTests row, which is
    // exactly what the panel renders.
    const ATTEMPTS = 3;
    for (let i = 0; i < ATTEMPTS; i++) {
      const r = await request.post("/api/admin/email-alert-webhook/test", {
        headers: { "x-csrf-token": csrf },
      });
      // 200 on delivery, 502 on Slack rejection — both are persisted.
      expect([200, 502]).toContain(r.status());
    }

    // Confirm the GET payload shape includes the recentTests array with
    // the rows we just produced. This is the contract the UI depends on.
    const getRes = await request.get("/api/admin/email-alert-webhook");
    expect(getRes.status()).toBe(200);
    const getBody = await getRes.json();
    expect(Array.isArray(getBody.recentTests)).toBe(true);
    expect(getBody.recentTests.length).toBeGreaterThanOrEqual(ATTEMPTS);
    for (const t of getBody.recentTests.slice(0, ATTEMPTS)) {
      expect(typeof t.testedAt).toBe("string");
      expect(typeof t.ok).toBe("boolean");
    }

    // Now open the panel in the UI and verify the toggle + list render.
    await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASS);
    await openAccountingEmailTab(page);

    const panel = page.locator('[data-testid="panel-email-alert-webhook"]');
    await expect(panel).toBeVisible({ timeout: 15_000 });

    const toggle = page.locator(
      '[data-testid="button-toggle-email-alert-webhook-recent-tests"]',
    );
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    // The toggle's label includes the count, e.g. "Show recent tests (3)".
    await expect(toggle).toContainText("Show recent tests");
    await expect(toggle).toContainText(`(${getBody.recentTests.length})`);

    // List should not be rendered until the toggle is clicked.
    await expect(
      page.locator('[data-testid="list-email-alert-webhook-recent-tests"]'),
    ).toHaveCount(0);

    await toggle.click();

    const list = page.locator(
      '[data-testid="list-email-alert-webhook-recent-tests"]',
    );
    await expect(list).toBeVisible({ timeout: 10_000 });
    await expect(toggle).toContainText("Hide recent tests");

    // Multiple rows should render — one per attempt — and each row should
    // show one of the expected status texts.
    const rows = list.locator(
      '[data-testid^="row-email-alert-webhook-recent-test-"]',
    );
    await expect(rows).toHaveCount(getBody.recentTests.length);
    expect(await rows.count()).toBeGreaterThanOrEqual(ATTEMPTS);

    for (let i = 0; i < ATTEMPTS; i++) {
      const row = page.locator(
        `[data-testid="row-email-alert-webhook-recent-test-${i}"]`,
      );
      await expect(row).toBeVisible();
      const text = (await row.innerText()).toLowerCase();
      expect(text).toMatch(/delivered|failed/);
    }

    // Toggling again hides the list (collapses back to a summary).
    await toggle.click();
    await expect(toggle).toContainText("Show recent tests");
    await expect(
      page.locator('[data-testid="list-email-alert-webhook-recent-tests"]'),
    ).toHaveCount(0);

    // Cleanup so subsequent runs of the suite start clean.
    const postClear = await request.delete("/api/admin/email-alert-webhook", {
      headers: { "x-csrf-token": csrf },
    });
    expect([200, 204]).toContain(postClear.status());
  });
});

test.describe("Email alert webhook panel — non-admin view", () => {
  test("non-admin does not see the panel and the API rejects them", async ({
    page,
    request,
  }) => {
    await loginViaUi(page, NON_ADMIN_EMAIL, NON_ADMIN_PASS);

    // /settings is wrapped in AdminRoute, so a non-admin will be redirected
    // away and the panel must never render. We still wait for the SPA to
    // settle and then assert no part of the panel surface exists.
    await page.goto("/settings#accounting-email");
    await page.waitForLoadState("networkidle");

    await expect(
      page.locator('[data-testid="panel-email-alert-webhook"]'),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-testid="input-email-alert-webhook-url"]'),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-testid="button-save-email-alert-webhook"]'),
    ).toHaveCount(0);

    // Belt-and-suspenders: the underlying admin endpoint must also refuse
    // non-admin sessions so webhook configuration never leaks.
    const apiLogin = await request.post("/api/auth/login", {
      data: { email: NON_ADMIN_EMAIL, password: NON_ADMIN_PASS },
    });
    expect(apiLogin.status()).toBe(200);
    const r = await request.get("/api/admin/email-alert-webhook");
    expect(r.status()).toBe(403);
  });
});
