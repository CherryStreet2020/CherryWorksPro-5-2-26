/**
 * Task #319 — End-to-end coverage for the cleanup overdue/missing warning
 * banner on the Marketing OS telemetry admin card.
 *
 * Task #290 added a derived `health` field to
 * `GET /api/telemetry/marketing-os/cleanup/last` that the card uses to
 * render one of two warning banners:
 *
 *   - alert-marketing-os-telemetry-cleanup-overdue: last run is older
 *     than 2× the configured cleanup interval (24h → threshold 48h).
 *   - alert-marketing-os-telemetry-cleanup-missing: no run on record at
 *     all, and the events table already contains rows older than the
 *     retention window.
 *
 * The threshold logic is unit-tested but the wired-through flow
 * (server health field → React Query payload → banner DOM) had no e2e
 * coverage, so a regression that dropped the `health` field from the
 * API response would only surface when an admin happened to load the
 * page during an outage. This spec exercises both warning paths plus
 * the happy path (no banner when the latest run is fresh).
 *
 * State management: the `marketing_os_telemetry_cleanup_runs` and
 * `marketing_os_telemetry_events` tables are global, so each test
 * snapshots the rows it touches and restores them in afterEach. The
 * Playwright config runs with workers: 1 / fullyParallel: false, so
 * concurrent test interference is not a concern.
 */
import { test, expect, type Page } from "@playwright/test";
import { pool } from "../server/db";

const QA_ADMIN_EMAIL = "admin.test@cwpro.dev";
const QA_ADMIN_PASS = "admin123";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

async function loginViaUi(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.waitForSelector('[data-testid="input-email"]', { timeout: 15_000 });
  await page.fill('[data-testid="input-email"]', email);
  await page.fill('[data-testid="input-password"]', password);
  await page.click('[data-testid="button-login"]');
  await page.waitForURL("**/", { timeout: 15_000 });
}

type CleanupRunRow = {
  id: string;
  ran_at: Date;
  deleted_count: number;
  retention_days: number;
  cutoff: Date;
};

async function snapshotCleanupRuns(): Promise<CleanupRunRow[]> {
  const r = await pool.query<CleanupRunRow>(
    `SELECT id, ran_at, deleted_count, retention_days, cutoff
       FROM marketing_os_telemetry_cleanup_runs`,
  );
  return r.rows;
}

async function restoreCleanupRuns(rows: CleanupRunRow[]): Promise<void> {
  await pool.query(`DELETE FROM marketing_os_telemetry_cleanup_runs`);
  for (const r of rows) {
    await pool.query(
      `INSERT INTO marketing_os_telemetry_cleanup_runs
         (id, ran_at, deleted_count, retention_days, cutoff)
       VALUES ($1, $2, $3, $4, $5)`,
      [r.id, r.ran_at, r.deleted_count, r.retention_days, r.cutoff],
    );
  }
}

test.describe("Marketing OS telemetry — cleanup warning banner (#319)", () => {
  let cleanupBackup: CleanupRunRow[] = [];

  test.beforeEach(async () => {
    cleanupBackup = await snapshotCleanupRuns();
    await pool.query(`DELETE FROM marketing_os_telemetry_cleanup_runs`);
  });

  test.afterEach(async () => {
    await restoreCleanupRuns(cleanupBackup);
  });

  test("renders the 'overdue' banner when the last sweep is older than 2× the interval", async ({
    page,
  }) => {
    // The default interval is 24h, so the threshold is 48h. A run from
    // five days ago is unambiguously past that threshold.
    const stale = new Date(Date.now() - 5 * ONE_DAY_MS);
    await pool.query(
      `INSERT INTO marketing_os_telemetry_cleanup_runs
         (ran_at, deleted_count, retention_days, cutoff)
       VALUES ($1, $2, $3, $4)`,
      [stale, 0, 180, stale],
    );

    await loginViaUi(page, QA_ADMIN_EMAIL, QA_ADMIN_PASS);
    await page.goto("/");

    const card = page.locator('[data-testid="card-marketing-os-telemetry"]');
    await expect(card).toBeVisible({ timeout: 15_000 });

    const overdue = page.locator(
      '[data-testid="alert-marketing-os-telemetry-cleanup-overdue"]',
    );
    await expect(overdue).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator(
        '[data-testid="text-marketing-os-telemetry-cleanup-warning-title"]',
      ),
    ).toHaveText("Cleanup is overdue");
    // Body mentions the 48h threshold derived from the default 24h
    // interval — guards against a regression that would let the card
    // render the banner with no actionable detail.
    await expect(
      page.locator(
        '[data-testid="text-marketing-os-telemetry-cleanup-warning-body"]',
      ),
    ).toContainText("48h");

    // The 'missing' variant must not also be present (mutually
    // exclusive — only one health status at a time).
    await expect(
      page.locator(
        '[data-testid="alert-marketing-os-telemetry-cleanup-missing"]',
      ),
    ).toHaveCount(0);
  });

  test("renders the 'missing' banner when no run exists but expired events do", async ({
    page,
  }) => {
    // Log in through the UI first so the page's request context has the
    // session cookie; then resolve the QA admin's orgId via /me so the
    // seeded event is owned by an org the existence probe will see.
    await loginViaUi(page, QA_ADMIN_EMAIL, QA_ADMIN_PASS);
    const me = await (await page.request.get("/api/auth/me")).json();
    const orgId = me.orgId as string;
    expect(orgId, "QA admin /me must include orgId").toBeTruthy();

    // Default retention is 180 days (MARKETING_OS_TELEMETRY_RETENTION_
    // DAYS_DEFAULT in shared/schema.ts). Insert one event 200 days ago
    // so the existence probe returns true and health flips to
    // "missing" given the empty cleanup_runs table.
    const ancient = new Date(Date.now() - 200 * ONE_DAY_MS);
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO marketing_os_telemetry_events
         (org_id, event_type, created_at)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [orgId, "section_shown", ancient],
    );
    const insertedId = inserted.rows[0].id;

    try {
      await page.goto("/");

      const card = page.locator('[data-testid="card-marketing-os-telemetry"]');
      await expect(card).toBeVisible({ timeout: 15_000 });

      const missing = page.locator(
        '[data-testid="alert-marketing-os-telemetry-cleanup-missing"]',
      );
      await expect(missing).toBeVisible({ timeout: 10_000 });
      await expect(
        page.locator(
          '[data-testid="text-marketing-os-telemetry-cleanup-warning-title"]',
        ),
      ).toHaveText("Cleanup hasn't run yet");

      // The 'overdue' variant must not also fire.
      await expect(
        page.locator(
          '[data-testid="alert-marketing-os-telemetry-cleanup-overdue"]',
        ),
      ).toHaveCount(0);

      // The "Last cleanup" line should still render its empty state
      // (the row really is absent), proving the banner is driven by
      // the new health field rather than a coincidental fallback.
      await expect(
        page.locator(
          '[data-testid="text-marketing-os-telemetry-last-cleanup-empty"]',
        ),
      ).toBeVisible();
    } finally {
      await pool.query(
        `DELETE FROM marketing_os_telemetry_events WHERE id = $1`,
        [insertedId],
      );
    }
  });

  test("renders no banner when the latest run is recent", async ({ page }) => {
    // A run from one minute ago is well inside the 48h threshold, so
    // health should be "ok" and neither banner should render.
    const fresh = new Date(Date.now() - 60_000);
    await pool.query(
      `INSERT INTO marketing_os_telemetry_cleanup_runs
         (ran_at, deleted_count, retention_days, cutoff)
       VALUES ($1, $2, $3, $4)`,
      [fresh, 0, 180, fresh],
    );

    await loginViaUi(page, QA_ADMIN_EMAIL, QA_ADMIN_PASS);
    await page.goto("/");

    const card = page.locator('[data-testid="card-marketing-os-telemetry"]');
    await expect(card).toBeVisible({ timeout: 15_000 });

    // Wait for the cleanup query to settle (populated row visible)
    // before asserting absence — otherwise we'd be racing the fetch.
    await expect(
      page.locator('[data-testid="text-marketing-os-telemetry-last-cleanup"]'),
    ).toBeVisible({ timeout: 10_000 });
    // Relative time renders something like "just now" or "Xm ago" —
    // either is fine; what matters is that the line is populated (so
    // the cleanup query has actually settled before we assert the
    // banner's absence below) and the empty-state placeholder is gone.
    await expect(
      page.locator(
        '[data-testid="text-marketing-os-telemetry-last-cleanup-empty"]',
      ),
    ).toHaveCount(0);

    await expect(
      page.locator(
        '[data-testid="alert-marketing-os-telemetry-cleanup-overdue"]',
      ),
    ).toHaveCount(0);
    await expect(
      page.locator(
        '[data-testid="alert-marketing-os-telemetry-cleanup-missing"]',
      ),
    ).toHaveCount(0);
  });
});
