import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

interface NotifyArgs {
  orgId: string;
  webhookUrl: string;
  consecutiveFailureCount: number;
  lastError: string | null;
}
const notifyMock = vi.fn<(args: NotifyArgs) => Promise<{ notified: number }>>(
  async () => ({ notified: 1 }),
);
vi.mock("../notifications/webhook-health-failure", () => ({
  notifyAdminsOfWebhookHealthBreakage: (args: NotifyArgs) => notifyMock(args),
}));

import { pool } from "../db";
import {
  setFailureWebhookFetcherForTests,
  resetFailureTrackerForTests,
} from "./failure-tracker";
import { runWebhookHealthCheckTick } from "./webhook-health-check";

const TEST_ORG_PREFIX = "wh-health-test-";

async function ensureTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS org_email_alert_webhooks (
      org_id VARCHAR(36) PRIMARY KEY,
      webhook_url TEXT NOT NULL,
      cooldown_ms INTEGER,
      updated_by VARCHAR(36),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      last_tested_at TIMESTAMP,
      last_test_ok BOOLEAN,
      last_test_error TEXT,
      consecutive_failure_count INTEGER NOT NULL DEFAULT 0,
      failure_alert_sent_at TIMESTAMP
    )
  `);
  // Ensure columns exist on a pre-existing table (older test DBs).
  await pool.query(`
    ALTER TABLE org_email_alert_webhooks
      ADD COLUMN IF NOT EXISTS consecutive_failure_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS failure_alert_sent_at TIMESTAMP
  `);
}

async function clearTestRows(): Promise<void> {
  // Cascade through orgs so the FK on org_email_alert_webhooks does not
  // leave orphaned rows around between tests.
  await pool.query(`DELETE FROM orgs WHERE id LIKE $1`, [
    `${TEST_ORG_PREFIX}%`,
  ]);
}

async function insertRow(
  orgId: string,
  url: string,
  lastTestedAt: Date | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO orgs (id, name, slug)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [orgId, `Test ${orgId}`, orgId],
  );
  await pool.query(
    `INSERT INTO org_email_alert_webhooks
       (org_id, webhook_url, last_tested_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (org_id) DO UPDATE
       SET webhook_url = EXCLUDED.webhook_url,
           last_tested_at = EXCLUDED.last_tested_at,
           last_test_ok = NULL,
           last_test_error = NULL`,
    [orgId, url, lastTestedAt],
  );
}

async function readRow(orgId: string) {
  const { rows } = await pool.query<{
    last_tested_at: Date | null;
    last_test_ok: boolean | null;
    last_test_error: string | null;
    consecutive_failure_count: number;
    failure_alert_sent_at: Date | null;
  }>(
    `SELECT last_tested_at, last_test_ok, last_test_error,
            consecutive_failure_count, failure_alert_sent_at
       FROM org_email_alert_webhooks WHERE org_id = $1`,
    [orgId],
  );
  return rows[0] ?? null;
}

describe("runWebhookHealthCheckTick", () => {
  beforeEach(async () => {
    await ensureTable();
    await clearTestRows();
    await resetFailureTrackerForTests();
    notifyMock.mockClear();
  });

  afterEach(async () => {
    setFailureWebhookFetcherForTests(null);
    await clearTestRows();
    delete process.env.EMAIL_WEBHOOK_HEALTH_CHECK_STALE_MS;
    delete process.env.EMAIL_WEBHOOK_HEALTH_CHECK_FAILURE_ALERT_THRESHOLD;
  });

  it("tests never-tested rows and persists ok=true on success", async () => {
    process.env.EMAIL_WEBHOOK_HEALTH_CHECK_STALE_MS = String(60 * 60 * 1000);
    const orgId = `${TEST_ORG_PREFIX}fresh`;
    await insertRow(orgId, "https://hooks.example.test/ok", null);
    const calls: string[] = [];
    setFailureWebhookFetcherForTests(async (url) => {
      calls.push(url);
    });

    const stats = await runWebhookHealthCheckTick();
    expect(stats.tested).toBe(1);
    expect(stats.ok).toBe(1);
    expect(stats.failed).toBe(0);
    expect(calls).toEqual(["https://hooks.example.test/ok"]);

    const row = await readRow(orgId);
    expect(row?.last_test_ok).toBe(true);
    expect(row?.last_test_error).toBeNull();
    expect(row?.last_tested_at).not.toBeNull();
  });

  it("records the failure message when delivery throws", async () => {
    process.env.EMAIL_WEBHOOK_HEALTH_CHECK_STALE_MS = String(60 * 60 * 1000);
    const orgId = `${TEST_ORG_PREFIX}broken`;
    await insertRow(orgId, "https://hooks.example.test/broken", null);
    setFailureWebhookFetcherForTests(async () => {
      throw new Error("Webhook responded with HTTP 404");
    });

    const stats = await runWebhookHealthCheckTick();
    expect(stats.failed).toBe(1);
    expect(stats.ok).toBe(0);

    const row = await readRow(orgId);
    expect(row?.last_test_ok).toBe(false);
    expect(row?.last_test_error).toContain("404");
  });

  it("skips rows whose last_tested_at is within the stale window", async () => {
    process.env.EMAIL_WEBHOOK_HEALTH_CHECK_STALE_MS = String(60 * 60 * 1000);
    const orgId = `${TEST_ORG_PREFIX}fresh-recent`;
    const recent = new Date(Date.now() - 5 * 60 * 1000);
    await insertRow(orgId, "https://hooks.example.test/recent", recent);
    const fetcher = vi.fn(async () => {});
    setFailureWebhookFetcherForTests(fetcher);

    const stats = await runWebhookHealthCheckTick();
    expect(stats.considered).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("re-tests rows whose last_tested_at is older than the stale window", async () => {
    process.env.EMAIL_WEBHOOK_HEALTH_CHECK_STALE_MS = String(60 * 60 * 1000);
    const orgId = `${TEST_ORG_PREFIX}stale`;
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await insertRow(orgId, "https://hooks.example.test/stale", old);
    const fetcher = vi.fn(async () => {});
    setFailureWebhookFetcherForTests(fetcher);

    const stats = await runWebhookHealthCheckTick();
    expect(stats.tested).toBe(1);
    expect(stats.ok).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(1);

    const row = await readRow(orgId);
    expect(row?.last_tested_at).not.toBeNull();
    expect(row!.last_tested_at!.getTime()).toBeGreaterThan(old.getTime());
  });

  it("isolates per-row failures so a bad webhook does not block others", async () => {
    process.env.EMAIL_WEBHOOK_HEALTH_CHECK_STALE_MS = String(60 * 60 * 1000);
    const okOrg = `${TEST_ORG_PREFIX}ok`;
    const badOrg = `${TEST_ORG_PREFIX}bad`;
    await insertRow(okOrg, "https://hooks.example.test/a", null);
    await insertRow(badOrg, "https://hooks.example.test/b", null);
    setFailureWebhookFetcherForTests(async (url) => {
      if (url.endsWith("/b")) throw new Error("boom");
    });

    const stats = await runWebhookHealthCheckTick();
    expect(stats.tested).toBe(2);
    expect(stats.ok).toBe(1);
    expect(stats.failed).toBe(1);

    const a = await readRow(okOrg);
    const b = await readRow(badOrg);
    expect(a?.last_test_ok).toBe(true);
    expect(b?.last_test_ok).toBe(false);
    expect(b?.last_test_error).toContain("boom");
  });

  it("increments consecutive_failure_count on failure and resets it on success", async () => {
    process.env.EMAIL_WEBHOOK_HEALTH_CHECK_STALE_MS = String(60 * 60 * 1000);
    process.env.EMAIL_WEBHOOK_HEALTH_CHECK_FAILURE_ALERT_THRESHOLD = "99";
    const orgId = `${TEST_ORG_PREFIX}streak`;
    await insertRow(orgId, "https://hooks.example.test/streak", null);
    let shouldFail = true;
    setFailureWebhookFetcherForTests(async () => {
      if (shouldFail) throw new Error("nope");
    });

    // Force the row to be re-considered each tick by clearing its
    // last_tested_at between calls. The schedule-based stale window is
    // exercised by other tests; here we just need consecutive ticks.
    await runWebhookHealthCheckTick();
    let row = await readRow(orgId);
    expect(row?.consecutive_failure_count).toBe(1);
    expect(row?.failure_alert_sent_at).toBeNull();

    await pool.query(
      `UPDATE org_email_alert_webhooks SET last_tested_at = NULL WHERE org_id = $1`,
      [orgId],
    );
    await runWebhookHealthCheckTick();
    row = await readRow(orgId);
    expect(row?.consecutive_failure_count).toBe(2);

    shouldFail = false;
    await pool.query(
      `UPDATE org_email_alert_webhooks SET last_tested_at = NULL WHERE org_id = $1`,
      [orgId],
    );
    await runWebhookHealthCheckTick();
    row = await readRow(orgId);
    expect(row?.consecutive_failure_count).toBe(0);
    expect(row?.failure_alert_sent_at).toBeNull();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  async function reTickFor(orgId: string): Promise<void> {
    await pool.query(
      `UPDATE org_email_alert_webhooks SET last_tested_at = NULL WHERE org_id = $1`,
      [orgId],
    );
    await runWebhookHealthCheckTick();
  }

  it("notifies admins exactly once when the streak first crosses the threshold", async () => {
    process.env.EMAIL_WEBHOOK_HEALTH_CHECK_STALE_MS = String(60 * 60 * 1000);
    process.env.EMAIL_WEBHOOK_HEALTH_CHECK_FAILURE_ALERT_THRESHOLD = "3";
    const orgId = `${TEST_ORG_PREFIX}alert`;
    await insertRow(orgId, "https://hooks.example.test/alert", null);
    setFailureWebhookFetcherForTests(async () => {
      throw new Error("HTTP 500");
    });

    await runWebhookHealthCheckTick();
    expect(notifyMock).not.toHaveBeenCalled();
    await reTickFor(orgId);
    expect(notifyMock).not.toHaveBeenCalled();

    await reTickFor(orgId);
    expect(notifyMock).toHaveBeenCalledTimes(1);
    const call = notifyMock.mock.calls[0][0];
    expect(call.orgId).toBe(orgId);
    expect(call.consecutiveFailureCount).toBe(3);
    expect(call.webhookUrl).toBe("https://hooks.example.test/alert");
    expect(call.lastError).toContain("500");

    let row = await readRow(orgId);
    expect(row?.consecutive_failure_count).toBe(3);
    expect(row?.failure_alert_sent_at).not.toBeNull();
    const firstStamp = row!.failure_alert_sent_at!.getTime();

    // Subsequent failed ticks must not re-fire the alert.
    await reTickFor(orgId);
    await reTickFor(orgId);
    expect(notifyMock).toHaveBeenCalledTimes(1);
    row = await readRow(orgId);
    expect(row?.consecutive_failure_count).toBe(5);
    expect(row?.failure_alert_sent_at!.getTime()).toBe(firstStamp);
  });

  it("clears failure_alert_sent_at after a success so the next breakage can re-alert", async () => {
    process.env.EMAIL_WEBHOOK_HEALTH_CHECK_STALE_MS = String(60 * 60 * 1000);
    process.env.EMAIL_WEBHOOK_HEALTH_CHECK_FAILURE_ALERT_THRESHOLD = "1";
    const orgId = `${TEST_ORG_PREFIX}recover`;
    await insertRow(orgId, "https://hooks.example.test/recover", null);
    let shouldFail = true;
    setFailureWebhookFetcherForTests(async () => {
      if (shouldFail) throw new Error("down");
    });

    await runWebhookHealthCheckTick();
    expect(notifyMock).toHaveBeenCalledTimes(1);
    let row = await readRow(orgId);
    expect(row?.failure_alert_sent_at).not.toBeNull();

    shouldFail = false;
    await reTickFor(orgId);
    row = await readRow(orgId);
    expect(row?.consecutive_failure_count).toBe(0);
    expect(row?.failure_alert_sent_at).toBeNull();

    shouldFail = true;
    await reTickFor(orgId);
    expect(notifyMock).toHaveBeenCalledTimes(2);
  });

  it("retries the alert on the next tick if the notifier fails or has no recipients", async () => {
    process.env.EMAIL_WEBHOOK_HEALTH_CHECK_STALE_MS = String(60 * 60 * 1000);
    process.env.EMAIL_WEBHOOK_HEALTH_CHECK_FAILURE_ALERT_THRESHOLD = "1";
    const orgId = `${TEST_ORG_PREFIX}retry`;
    await insertRow(orgId, "https://hooks.example.test/retry", null);
    setFailureWebhookFetcherForTests(async () => {
      throw new Error("still down");
    });

    // First tick: notifier fails outright.
    notifyMock.mockRejectedValueOnce(new Error("smtp down"));
    await runWebhookHealthCheckTick();
    expect(notifyMock).toHaveBeenCalledTimes(1);
    let row = await readRow(orgId);
    expect(row?.failure_alert_sent_at).toBeNull();

    // Second tick: notifier reports zero recipients (e.g. no opted-in admins).
    notifyMock.mockResolvedValueOnce({ notified: 0 });
    await reTickFor(orgId);
    expect(notifyMock).toHaveBeenCalledTimes(2);
    row = await readRow(orgId);
    expect(row?.failure_alert_sent_at).toBeNull();

    // Third tick: notifier finally succeeds — only now do we stamp.
    await reTickFor(orgId);
    expect(notifyMock).toHaveBeenCalledTimes(3);
    row = await readRow(orgId);
    expect(row?.failure_alert_sent_at).not.toBeNull();

    // Now that it's stamped, further failed ticks must not re-fire.
    await reTickFor(orgId);
    expect(notifyMock).toHaveBeenCalledTimes(3);
  });
});
