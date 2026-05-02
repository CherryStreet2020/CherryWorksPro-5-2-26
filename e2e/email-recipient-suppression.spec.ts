/**
 * E2E coverage for the masked-recipient suppression flow in the Outgoing
 * Email Health drill-down.
 *
 * Walks the full admin journey:
 *   1. Seed failures for two recipients via /api/test/email/seed-failures.
 *   2. Open Settings → Accounting & Email, expand the failure drill-down,
 *      and switch to the Top recipients tab.
 *   3. Click Suppress on the heaviest hitter; the row should swap to a
 *      "Suppressed" badge.
 *   4. Switch to the Suppressed tab and confirm the masked entry is listed.
 *   5. Click Unsuppress and confirm the list empties (and the Top recipients
 *      row offers Suppress again).
 */
import { test, expect, type APIRequestContext } from "@playwright/test";

const ADMIN_EMAIL = "admin.test@cwpro.dev";
const ADMIN_PASS = "admin123";

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

test.describe("Masked-recipient suppression — admin drilldown", () => {
  test("suppress from Top recipients, see it on Suppressed tab, then unsuppress", async ({
    page,
    request,
  }) => {
    const { csrf } = await loginViaApi(request, ADMIN_EMAIL, ADMIN_PASS);

    // Clear any prior in-memory suppressions for this admin's org so the
    // suppressed list starts empty regardless of test order.
    const existing = await request.get("/api/admin/email/masked-suppressions");
    expect(existing.status()).toBe(200);
    const existingBody = await existing.json();
    for (const entry of (existingBody.entries ?? []) as Array<{ hash: string }>) {
      const del = await request.delete(
        `/api/admin/email/masked-suppressions/${encodeURIComponent(entry.hash)}`,
        { headers: { "x-csrf-token": csrf } },
      );
      expect(del.status()).toBe(200);
    }

    // Reset transport-failure tracker, then seed two distinct recipients
    // (bob = 6 across two transports, carol = 2) so the Top recipients tab
    // has a deterministic ordering: bob first, carol second.
    await request.post("/api/test/email/seed-failures", {
      data: { reset: true, failures: [] },
      headers: { "x-csrf-token": csrf },
    });
    const seedRes = await request.post("/api/test/email/seed-failures", {
      data: {
        failures: [
          { transport: "smtp", count: 4, errorCode: "SMTP_550", recipient: "bob@example.com" },
          { transport: "graph", count: 2, errorCode: "HTTP_ERROR_500", recipient: "bob@example.com" },
          { transport: "smtp", count: 2, errorCode: "SMTP_421", recipient: "carol@example.com" },
        ],
      },
      headers: { "x-csrf-token": csrf },
    });
    expect(seedRes.status()).toBe(200);

    await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASS);
    await openAccountingEmailTab(page);

    const panel = page.locator('[data-testid="panel-email-transport-health"]');
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await page.click('[data-testid="button-email-health-refresh"]');

    // Open drill-down via the badge, then switch to Top recipients.
    await page.click('[data-testid="badge-email-health-status"]');
    const drilldown = page.locator('[data-testid="panel-email-failure-drilldown"]');
    await expect(drilldown).toBeVisible();
    await page.click('[data-testid="tab-failure-drilldown-top"]');

    const topRows = page.locator('[data-testid^="row-top-recipient-"]');
    await expect(topRows.first()).toBeVisible();
    expect(await topRows.count()).toBe(2);

    // Heaviest hitter should be bob (count 6) and stay masked.
    const topAddr0 = await page
      .locator('[data-testid="text-top-recipient-address-0"]')
      .innerText();
    expect(topAddr0).toMatch(/^b\*\*\*@e\*\*\*\.com \(#[0-9a-f]{4}\)$/);
    const bobHashMatch = topAddr0.match(/#([0-9a-f]{4})/);
    expect(bobHashMatch, "masked address must include a 4-char hash").not.toBeNull();
    const bobHash = bobHashMatch![1];

    // Click Suppress on the top row. The row should immediately swap to a
    // "Suppressed" badge (button-suppress goes away, badge-top-recipient-
    // suppressed appears).
    const suppressBtn0 = page.locator('[data-testid="button-suppress-recipient-0"]');
    await expect(suppressBtn0).toBeVisible();
    await suppressBtn0.click();
    await expect(
      page.locator('[data-testid="badge-top-recipient-suppressed-0"]'),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator('[data-testid="button-suppress-recipient-0"]'),
    ).toHaveCount(0);

    // The Suppressed tab label should now reflect the new entry count.
    const suppressedTab = page.locator('[data-testid="tab-failure-drilldown-suppressed"]');
    await expect(suppressedTab).toContainText(/\(1\)/);
    await suppressedTab.click();

    const suppressedList = page.locator('[data-testid="list-failure-drilldown-suppressed"]');
    await expect(suppressedList).toBeVisible();
    const suppressedAddr0 = await page
      .locator('[data-testid="text-suppressed-recipient-address-0"]')
      .innerText();
    expect(suppressedAddr0).toContain(`(#${bobHash})`);
    expect(suppressedAddr0).not.toMatch(/bob/i);

    // Unsuppress and verify the list goes back to the empty state.
    await page.click('[data-testid="button-unsuppress-recipient-0"]');
    await expect(
      page.locator('[data-testid="text-failure-drilldown-suppressed-empty"]'),
    ).toBeVisible({ timeout: 10_000 });
    await expect(suppressedTab).not.toContainText(/\(1\)/);

    // Back on Top recipients the Suppress button should be available again.
    await page.click('[data-testid="tab-failure-drilldown-top"]');
    await expect(
      page.locator('[data-testid="button-suppress-recipient-0"]'),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator('[data-testid="badge-top-recipient-suppressed-0"]'),
    ).toHaveCount(0);

    // Cleanup: clear seeded failures so we don't leak into subsequent tests.
    await request.post("/api/test/email/seed-failures", {
      data: { reset: true, failures: [] },
      headers: { "x-csrf-token": csrf },
    });
  });
});
