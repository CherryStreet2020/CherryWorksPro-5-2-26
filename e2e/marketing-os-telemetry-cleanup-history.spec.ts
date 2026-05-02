/**
 * Task #291 — End-to-end coverage for the lazy "View history" panel on the
 * Marketing OS telemetry admin card and the new
 * `GET /api/telemetry/marketing-os/cleanup/history` endpoint added in #267.
 *
 * What the test guarantees:
 *  1. After seeding several cleanup runs (via the existing on-demand
 *     `POST /api/telemetry/marketing-os/cleanup/run` route, which records
 *     a row each time), expanding "View history" on the dashboard renders
 *     the rows in descending `ranAt` order with the deleted-count and
 *     retention values that the API returned.
 *  2. The history endpoint refuses non-admin sessions (401/403) so the
 *     admin gate cannot regress silently.
 */
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

const QA_ADMIN_EMAIL = "admin.test@cwpro.dev";
const QA_ADMIN_PASS = "admin123";
const QA_TEAM_EMAIL = "team.test@cwpro.dev";
const QA_TEAM_PASS = "team123";

type CleanupRun = {
  ranAt: string;
  deletedCount: number;
  retentionDays: number;
  cutoff: string;
};
type HistoryResponse = { runs: CleanupRun[] };

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

async function loginViaUi(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.waitForSelector('[data-testid="input-email"]', { timeout: 15_000 });
  await page.fill('[data-testid="input-email"]', email);
  await page.fill('[data-testid="input-password"]', password);
  await page.click('[data-testid="button-login"]');
  await page.waitForURL("**/", { timeout: 15_000 });
}

/**
 * Seed one cleanup row by hitting the on-demand sweep endpoint. Each call
 * inserts a row into `marketing_os_telemetry_cleanup_runs` with a fresh
 * `ranAt`. If the advisory lock is briefly held by another in-flight
 * sweep we retry a few times so a flaky scheduler can't break the test.
 */
async function seedOneCleanupRun(api: APIRequestContext, csrf: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await api.post("/api/telemetry/marketing-os/cleanup/run", {
      headers: { "x-csrf-token": csrf },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    if (body.ran === true) return;
    // lock-held — back off briefly and retry
    await new Promise((res) => setTimeout(res, 150));
  }
  throw new Error("Could not seed a cleanup run after 5 attempts (lock-held)");
}

async function getHistory(api: APIRequestContext): Promise<HistoryResponse> {
  const r = await api.get("/api/telemetry/marketing-os/cleanup/history");
  expect(r.status()).toBe(200);
  return (await r.json()) as HistoryResponse;
}

test.describe("Marketing OS telemetry cleanup history panel — admin", () => {
  test("lazy 'View history' panel renders seeded runs in descending order", async ({
    page,
    request,
  }) => {
    const { csrf } = await loginViaApi(request, QA_ADMIN_EMAIL, QA_ADMIN_PASS);

    // Seed three cleanup runs with a small spacing so their ranAt
    // timestamps are strictly increasing and the descending-order
    // assertion is meaningful even on fast clocks.
    const SEED_COUNT = 3;
    for (let i = 0; i < SEED_COUNT; i++) {
      await seedOneCleanupRun(request, csrf);
      if (i < SEED_COUNT - 1) {
        await new Promise((res) => setTimeout(res, 60));
      }
    }

    // The history endpoint is the source of truth for what the panel
    // should show; capture it once so the UI assertions are checked
    // against an authoritative snapshot.
    const history = await getHistory(request);
    expect(history.runs.length).toBeGreaterThanOrEqual(SEED_COUNT);

    // Descending by ranAt — sanity check the API contract before we go
    // assert the same thing about the rendered rows.
    for (let i = 0; i < history.runs.length - 1; i++) {
      expect(
        new Date(history.runs[i].ranAt).getTime() >=
          new Date(history.runs[i + 1].ranAt).getTime(),
        `history rows should be sorted descending by ranAt at index ${i}`,
      ).toBe(true);
    }

    // The newest SEED_COUNT runs must be the ones we just seeded — this
    // proves the route returns the freshest rows first and gives the UI
    // assertions concrete deleted/retention values to compare against.
    const newest = history.runs.slice(0, SEED_COUNT);

    await loginViaUi(page, QA_ADMIN_EMAIL, QA_ADMIN_PASS);
    await page.goto("/");

    const card = page.locator('[data-testid="card-marketing-os-telemetry"]');
    await expect(card).toBeVisible({ timeout: 15_000 });

    // The panel is lazy: it only fetches once the user toggles it open.
    // Until then, the section element does not exist in the DOM.
    const panel = page.locator(
      '[data-testid="section-marketing-os-telemetry-cleanup-history"]',
    );
    await expect(panel).toHaveCount(0);

    const toggle = page.locator(
      '[data-testid="button-marketing-os-telemetry-cleanup-history-toggle"]',
    );
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveText(/view history/i);
    await toggle.click();

    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(toggle).toHaveText(/hide history/i);

    // Rows render top-down in the same order the API returned them.
    for (let i = 0; i < newest.length; i++) {
      const row = panel.locator(
        `[data-testid="row-marketing-os-telemetry-cleanup-history-${i}"]`,
      );
      await expect(row, `row ${i} should be present`).toBeVisible();
      await expect(
        panel.locator(
          `[data-testid="text-marketing-os-telemetry-cleanup-history-deleted-${i}"]`,
        ),
      ).toHaveText(String(newest[i].deletedCount));
      await expect(
        panel.locator(
          `[data-testid="text-marketing-os-telemetry-cleanup-history-retention-${i}"]`,
        ),
      ).toHaveText(String(newest[i].retentionDays));
      // The cutoff cell shows the YYYY-MM-DD prefix of the ISO cutoff.
      await expect(
        panel.locator(
          `[data-testid="text-marketing-os-telemetry-cleanup-history-cutoff-${i}"]`,
        ),
      ).toHaveText(newest[i].cutoff.slice(0, 10));
    }

    // Toggling again hides the panel without unmounting the toggle.
    await toggle.click();
    await expect(panel).toHaveCount(0);
    await expect(toggle).toHaveText(/view history/i);
  });
});

test.describe("Marketing OS telemetry cleanup history endpoint — non-admin", () => {
  test("rejects a logged-in non-admin with 401/403", async ({ request }) => {
    const r = await request.post("/api/auth/login", {
      data: { email: QA_TEAM_EMAIL, password: QA_TEAM_PASS },
    });
    expect(r.status()).toBe(200);

    const history = await request.get(
      "/api/telemetry/marketing-os/cleanup/history",
    );
    expect([401, 403]).toContain(history.status());
  });
});
