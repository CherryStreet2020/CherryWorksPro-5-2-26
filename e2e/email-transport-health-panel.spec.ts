/**
 * E2E coverage for the Outgoing Email Health panel rendered in
 * Settings → Accounting & Email.
 *
 * Asserts:
 *   1. Admin sees the panel with failures-in-last-hour, per-transport rows
 *      for smtp/graph/gmail, and a healthy/breached badge.
 *   2. Seeding enough simulated transport failures to cross the per-hour
 *      threshold flips the badge to "Threshold breached" and surfaces the
 *      rollback runbook link.
 *   3. A non-admin user does NOT see the panel.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";

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

async function openAccountingEmailTab(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.goto("/settings#accounting-email");
  await page.waitForSelector('[data-testid="tab-accounting-email"]', { timeout: 15_000 });
  await page.click('[data-testid="tab-accounting-email"]');
}

test.describe("Outgoing email health panel — admin view", () => {
  test("renders panel with per-transport rows, flips to breached on threshold", async ({
    page,
    request,
  }) => {
    // Log in via API to seed failures and clear prior state, then sync the
    // browser session by logging in via the UI.
    const { csrf } = await loginViaApi(request, ADMIN_EMAIL, ADMIN_PASS);

    // Reset the in-memory failure tracker so this run starts from "Healthy".
    const resetRes = await request.post("/api/test/email/seed-failures", {
      data: { reset: true, failures: [] },
      headers: { "x-csrf-token": csrf },
    });
    expect(resetRes.status(), "seed endpoint must be wired in non-prod").toBe(200);

    await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASS);
    await openAccountingEmailTab(page);

    const panel = page.locator('[data-testid="panel-email-transport-health"]');
    await expect(panel).toBeVisible({ timeout: 15_000 });

    // Per-transport rows exist for the three known transports.
    await expect(page.locator('[data-testid="row-transport-smtp"]')).toBeVisible();
    await expect(page.locator('[data-testid="row-transport-graph"]')).toBeVisible();
    await expect(page.locator('[data-testid="row-transport-gmail"]')).toBeVisible();

    // Failures-in-last-hour counter is rendered (starts at 0 after reset).
    const windowCount = page.locator('[data-testid="text-email-health-window-count"]');
    await expect(windowCount).toBeVisible();
    await expect(windowCount).toHaveText("0");

    // Initial badge is healthy and runbook link is hidden.
    const badge = page.locator('[data-testid="badge-email-health-status"]');
    await expect(badge).toHaveText(/Healthy/i);
    await expect(
      page.locator('[data-testid="link-email-health-runbook"]'),
    ).toHaveCount(0);

    // Seed enough failures across the three transports to cross the
    // per-hour threshold (10/hr). 4 + 4 + 3 = 11.
    const seedRes = await request.post("/api/test/email/seed-failures", {
      data: {
        failures: [
          { transport: "smtp", count: 4, errorCode: "SMTP_550" },
          { transport: "graph", count: 4, errorCode: "HTTP_ERROR_500" },
          { transport: "gmail", count: 3, errorCode: "TOKEN_REFRESH_FAILED_401" },
        ],
      },
      headers: { "x-csrf-token": csrf },
    });
    expect(seedRes.status()).toBe(200);
    const seedBody = await seedRes.json();
    expect(seedBody.seeded).toBe(11);

    // The panel exposes a manual "Refresh" control so operators (and this
    // test) don't have to wait for the polling interval to flip the badge.
    await page.click('[data-testid="button-email-health-refresh"]');

    await expect(badge).toHaveText(/Threshold breached/i, { timeout: 15_000 });
    await expect(windowCount).toHaveText(/^(1[1-9]|[2-9]\d+)$/);

    const runbookLink = page.locator('[data-testid="link-email-health-runbook"]');
    await expect(runbookLink).toBeVisible();
    const href = await runbookLink.getAttribute("href");
    expect(href, "runbook link should point to the rollback runbook").toMatch(
      /rollback-runbook\.md$/,
    );

    // Per-transport counts reflect what was seeded.
    await expect(
      page.locator('[data-testid="text-transport-smtp-count"]'),
    ).toHaveText(/^[4-9]\d*$/);
    await expect(
      page.locator('[data-testid="text-transport-graph-count"]'),
    ).toHaveText(/^[4-9]\d*$/);
    await expect(
      page.locator('[data-testid="text-transport-gmail-count"]'),
    ).toHaveText(/^[3-9]\d*$/);

    // Drill-down: clicking the badge opens the recent failure samples
    // list (admin can see redacted recipient, transport, error code,
    // and "when" without grepping logs).
    const drilldown = page.locator('[data-testid="panel-email-failure-drilldown"]');
    await expect(drilldown).toHaveCount(0);
    await page.click('[data-testid="badge-email-health-status"]');
    await expect(drilldown).toBeVisible();
    const sampleRows = page.locator('[data-testid^="row-failure-sample-"]');
    await expect(sampleRows.first()).toBeVisible();
    expect(await sampleRows.count()).toBeGreaterThanOrEqual(11);

    // Each row exposes a transport label and an error code cell.
    await expect(
      page.locator('[data-testid="text-failure-sample-error-0"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="text-failure-sample-transport-0"]'),
    ).toBeVisible();

    // Clicking a per-transport row narrows the list to that transport.
    await page.click('[data-testid="row-transport-graph"]');
    await expect(drilldown).toBeVisible();
    const transportCells = page.locator('[data-testid^="text-failure-sample-transport-"]');
    const cellCount = await transportCells.count();
    expect(cellCount).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < cellCount; i++) {
      await expect(transportCells.nth(i)).toHaveText(/Microsoft 365/i);
    }

    // Top recipients tab groups failures by masked recipient and shows
    // count + transports + last error so admins can spot chronic
    // problem addresses to suppress.
    // Reset first (the seed route fires reset asynchronously, so a single
    // call that both resets and seeds would race the seed against the
    // pending reset). Two separate calls keep the order deterministic.
    await request.post("/api/test/email/seed-failures", {
      data: { reset: true, failures: [] },
      headers: { "x-csrf-token": csrf },
    });
    await request.post("/api/test/email/seed-failures", {
      data: {
        failures: [
          { transport: "smtp", count: 5, errorCode: "SMTP_550", recipient: "bob@example.com" },
          { transport: "graph", count: 3, errorCode: "HTTP_ERROR_500", recipient: "bob@example.com" },
          { transport: "smtp", count: 2, errorCode: "SMTP_421", recipient: "carol@example.com" },
        ],
      },
      headers: { "x-csrf-token": csrf },
    });
    await page.click('[data-testid="button-email-health-refresh"]');
    // Reset transport filter from the prior assertion by hiding and
    // re-opening the drilldown via the badge (which clears the filter).
    await page.click('[data-testid="button-failure-drilldown-close"]');
    await expect(drilldown).toHaveCount(0);
    await page.click('[data-testid="badge-email-health-status"]');
    await expect(drilldown).toBeVisible();
    await page.click('[data-testid="tab-failure-drilldown-top"]');
    const topRows = page.locator('[data-testid^="row-top-recipient-"]');
    await expect(topRows.first()).toBeVisible();
    expect(await topRows.count()).toBe(2);
    // Heaviest hitter (bob = 8) should be first; addresses must stay
    // masked (no raw "bob" leaked to the DOM).
    await expect(
      page.locator('[data-testid="text-top-recipient-count-0"]'),
    ).toHaveText("8");
    const topAddr0 = await page
      .locator('[data-testid="text-top-recipient-address-0"]')
      .innerText();
    expect(topAddr0).toMatch(/^b\*\*\*@e\*\*\*\.com \(#[0-9a-f]{4}\)$/);
    expect(topAddr0).not.toMatch(/bob/i);
    await expect(
      page.locator('[data-testid="text-top-recipient-transports-0"]'),
    ).toHaveText(/Microsoft 365.*SMTP|SMTP.*Microsoft 365/);
    await expect(
      page.locator('[data-testid="text-top-recipient-last-error-0"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="text-top-recipient-last-seen-0"]'),
    ).toBeVisible();
    // Switching back to Recent restores the time-ordered sample list.
    await page.click('[data-testid="tab-failure-drilldown-recent"]');
    await expect(
      page.locator('[data-testid="row-failure-sample-0"]'),
    ).toBeVisible();

    // Hide closes the drill-down again.
    await page.click('[data-testid="button-failure-drilldown-close"]');
    await expect(drilldown).toHaveCount(0);

    // Seed one failure with a known recipient and confirm the masked form
    // (first letter + *** + first letter + *** + tld + 4-char hash) is
    // what surfaces in the drill-down — never the raw address.
    await request.post("/api/test/email/seed-failures", {
      data: { reset: true, failures: [] },
      headers: { "x-csrf-token": csrf },
    });
    await request.post("/api/test/email/seed-failures", {
      data: {
        failures: [
          {
            transport: "graph",
            count: 1,
            errorCode: "SEND_FAILED_500",
            recipient: "alice.smith@example.com",
          },
        ],
      },
      headers: { "x-csrf-token": csrf },
    });
    await page.reload();
    await openAccountingEmailTab(page);
    await page.click('[data-testid="badge-email-health-status"]');
    const recipientCell = page.locator('[data-testid="text-failure-sample-recipient-0"]');
    await expect(recipientCell).toBeVisible();
    await expect(recipientCell).toHaveText(/^a\*\*\*@e\*\*\*\.com \(#[0-9a-f]{4}\)$/);
    const recipientText = await recipientCell.innerText();
    expect(recipientText).not.toMatch(/alice/i);
    expect(recipientText).not.toMatch(/smith/i);

    // Cleanup so we don't leak state into subsequent tests.
    await request.post("/api/test/email/seed-failures", {
      data: { reset: true, failures: [] },
      headers: { "x-csrf-token": csrf },
    });
  });
});

test.describe("Outgoing email health panel — non-admin view", () => {
  test("non-admin does not see the panel and the API rejects them", async ({
    page,
    request,
  }) => {
    await loginViaUi(page, NON_ADMIN_EMAIL, NON_ADMIN_PASS);

    // Navigate to settings — non-admins are blocked by AdminRoute and the
    // panel must never render for them. We give the SPA time to settle and
    // then assert no health-panel surface exists in the DOM.
    await page.goto("/settings#accounting-email");
    await page.waitForLoadState("networkidle");

    await expect(
      page.locator('[data-testid="panel-email-transport-health"]'),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-testid="panel-email-transport-health-loading"]'),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-testid="badge-email-health-status"]'),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-testid="link-email-health-runbook"]'),
    ).toHaveCount(0);

    // Belt-and-suspenders: the underlying admin endpoint must also refuse
    // non-admin sessions so operational metadata never leaks.
    const apiLogin = await request.post("/api/auth/login", {
      data: { email: NON_ADMIN_EMAIL, password: NON_ADMIN_PASS },
    });
    expect(apiLogin.status()).toBe(200);
    const r = await request.get("/api/admin/email/transport-errors");
    expect(r.status()).toBe(403);
  });
});
