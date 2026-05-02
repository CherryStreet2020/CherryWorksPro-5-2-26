/**
 * Task #251 — Periodic auto-test of configured per-org email alert
 * webhooks.
 *
 * Admins previously only learned a webhook was broken by manually
 * clicking "Send test alert" or by suffering a real failure burst.
 * This job iterates every row in `org_email_alert_webhooks`, runs the
 * same `sendFailureWebhookTest` path the manual button uses, and
 * writes the outcome back to `last_tested_at` / `last_test_ok` /
 * `last_test_error` so the admin panel can warn when delivery breaks.
 *
 * Multi-instance safety: a process-wide pg advisory lock guards the
 * tick so a deployment with multiple replicas only runs the checks
 * once per interval. Webhook fetches are serialized inside the lock
 * to keep load on remote endpoints predictable.
 *
 * Tunables (env):
 *   EMAIL_WEBHOOK_HEALTH_CHECK_TICK_MS   (default 6h)
 *   EMAIL_WEBHOOK_HEALTH_CHECK_STALE_MS  (default 24h)
 *   EMAIL_WEBHOOK_HEALTH_CHECK_FAILURE_ALERT_THRESHOLD (default 3)
 *
 * Task #285: every failed tick increments
 * `consecutive_failure_count`; success resets it. When the streak first
 * reaches the configured threshold, opted-in org admins are emailed via
 * `notifyAdminsOfWebhookHealthBreakage` and `failure_alert_sent_at` is
 * stamped so we don't re-alert every subsequent tick. A single
 * successful test clears both counters so the next breakage can alert
 * again.
 */
import { pool } from "../db";
import { sendFailureWebhookTest } from "./failure-tracker";
import { sanitizeErrorMessage } from "../routes/middleware";
import { structuredLog } from "../lib/logging";
import { notifyAdminsOfWebhookHealthBreakage } from "../notifications/webhook-health-failure";

const ADVISORY_LOCK_KEY = 100029;
const DEFAULT_TICK_MS = 6 * 60 * 60 * 1000; // 6h
const DEFAULT_STALE_MS = 24 * 60 * 60 * 1000; // 24h
const DEFAULT_FAILURE_ALERT_THRESHOLD = 3;

export function getWebhookHealthFailureAlertThreshold(): number {
  const raw = process.env.EMAIL_WEBHOOK_HEALTH_CHECK_FAILURE_ALERT_THRESHOLD;
  if (!raw) return DEFAULT_FAILURE_ALERT_THRESHOLD;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0
    ? Math.floor(n)
    : DEFAULT_FAILURE_ALERT_THRESHOLD;
}

export function getWebhookHealthCheckTickMs(): number {
  const raw = process.env.EMAIL_WEBHOOK_HEALTH_CHECK_TICK_MS;
  if (!raw) return DEFAULT_TICK_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TICK_MS;
}

export function getWebhookHealthCheckStaleMs(): number {
  const raw = process.env.EMAIL_WEBHOOK_HEALTH_CHECK_STALE_MS;
  if (!raw) return DEFAULT_STALE_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_STALE_MS;
}

export interface WebhookHealthCheckStats {
  considered: number;
  tested: number;
  ok: number;
  failed: number;
  skipped: number;
}

/**
 * Run one pass of the health check. Selects every configured org
 * webhook whose `last_tested_at` is null or older than the stale
 * threshold and sends a test payload, persisting the outcome.
 *
 * Failures (network, non-2xx) are caught per-row so one bad webhook
 * never blocks the rest. Returns a stats summary so callers (and
 * tests) can assert on what happened.
 */
export async function runWebhookHealthCheckTick(
  now: number = Date.now(),
): Promise<WebhookHealthCheckStats> {
  const stats: WebhookHealthCheckStats = {
    considered: 0,
    tested: 0,
    ok: 0,
    failed: 0,
    skipped: 0,
  };

  const lockRes = await pool
    .query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [ADVISORY_LOCK_KEY],
    )
    .catch(() => null);
  const locked = lockRes?.rows?.[0]?.locked === true;
  if (!locked) return stats;

  try {
    const staleMs = getWebhookHealthCheckStaleMs();
    const cutoff = new Date(now - staleMs);

    let rows: Array<{
      org_id: string;
      webhook_url: string;
      last_tested_at: Date | null;
      consecutive_failure_count: number;
      failure_alert_sent_at: Date | null;
    }> = [];
    try {
      const result = await pool.query<{
        org_id: string;
        webhook_url: string;
        last_tested_at: Date | null;
        consecutive_failure_count: number;
        failure_alert_sent_at: Date | null;
      }>(
        `SELECT org_id, webhook_url, last_tested_at,
                consecutive_failure_count, failure_alert_sent_at
           FROM org_email_alert_webhooks
          WHERE last_tested_at IS NULL OR last_tested_at < $1`,
        [cutoff],
      );
      rows = result.rows;
    } catch (err: any) {
      structuredLog({
        level: "error",
        event: "EMAIL_WEBHOOK_HEALTH_CHECK_READ_FAILED",
        errorCode: err?.code ?? "UNKNOWN",
      });
      return stats;
    }

    stats.considered = rows.length;
    for (const row of rows) {
      stats.tested += 1;
      let ok = false;
      let errorMessage: string | null = null;
      try {
        await sendFailureWebhookTest(row.webhook_url, {
          kind: "org",
          orgId: row.org_id,
        });
        ok = true;
      } catch (err: any) {
        errorMessage = sanitizeErrorMessage(err);
      }

      const previousStreak = Number(row.consecutive_failure_count ?? 0);
      const previousAlertSentAt = row.failure_alert_sent_at;
      const newStreak = ok ? 0 : previousStreak + 1;
      const threshold = getWebhookHealthFailureAlertThreshold();
      const shouldAlert =
        !ok && newStreak >= threshold && previousAlertSentAt === null;
      // Important: do NOT stamp failure_alert_sent_at here. We only
      // mark a breakage as "notified" once the notifier actually
      // succeeds, so a transient SMTP/recipient-lookup failure does not
      // permanently suppress retries for this outage.
      const nextAlertSentAt = ok ? null : previousAlertSentAt;

      try {
        await pool.query(
          `UPDATE org_email_alert_webhooks
              SET last_tested_at = NOW(),
                  last_test_ok = $2,
                  last_test_error = $3,
                  consecutive_failure_count = $4,
                  failure_alert_sent_at = $5
            WHERE org_id = $1`,
          [
            row.org_id,
            ok,
            ok ? null : errorMessage,
            newStreak,
            nextAlertSentAt,
          ],
        );
      } catch (err: any) {
        structuredLog({
          level: "error",
          event: "EMAIL_WEBHOOK_HEALTH_CHECK_PERSIST_FAILED",
          orgId: row.org_id,
          errorCode: err?.code ?? "UNKNOWN",
        });
        stats.skipped += 1;
        continue;
      }

      if (ok) stats.ok += 1;
      else stats.failed += 1;

      structuredLog({
        level: ok ? "info" : "warn",
        event: "EMAIL_WEBHOOK_HEALTH_CHECK_RESULT",
        orgId: row.org_id,
        ok,
        consecutiveFailures: newStreak,
      });

      if (shouldAlert) {
        structuredLog({
          level: "warn",
          event: "EMAIL_WEBHOOK_HEALTH_CHECK_ALERT_FIRED",
          orgId: row.org_id,
          consecutiveFailures: newStreak,
          threshold,
        });
        let alertSent = false;
        try {
          const result = await notifyAdminsOfWebhookHealthBreakage({
            orgId: row.org_id,
            webhookUrl: row.webhook_url,
            consecutiveFailureCount: newStreak,
            lastError: errorMessage,
          });
          // The notifier returns null on internal failure and
          // { notified: 0 } when there are no opted-in admins. In both
          // cases nothing actually went out, so leave the stamp null
          // and let a future tick try again. Only a positive notified
          // count counts as a real out-of-band alert.
          alertSent = !!result && result.notified > 0;
        } catch (e) {
          // notifier is itself fire-and-forget, but belt-and-braces:
          // never let an alert problem mask the underlying outage.
          structuredLog({
            level: "error",
            event: "EMAIL_WEBHOOK_HEALTH_CHECK_ALERT_FAILED",
            orgId: row.org_id,
          });
        }

        if (alertSent) {
          try {
            await pool.query(
              `UPDATE org_email_alert_webhooks
                  SET failure_alert_sent_at = NOW()
                WHERE org_id = $1`,
              [row.org_id],
            );
          } catch (err: any) {
            // Worst case: the notifier sent successfully but we can't
            // record that, so the next tick may re-alert. Better to
            // double-notify than to permanently suppress.
            structuredLog({
              level: "error",
              event: "EMAIL_WEBHOOK_HEALTH_CHECK_ALERT_STAMP_FAILED",
              orgId: row.org_id,
              errorCode: err?.code ?? "UNKNOWN",
            });
          }
        }
      }
    }
  } finally {
    await pool
      .query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY])
      .catch(() => {});
  }

  return stats;
}

let interval: ReturnType<typeof setInterval> | null = null;

export function startWebhookHealthCheckProcessor(): void {
  if (interval) return;
  // Fire once on boot so any webhook that broke during downtime is
  // flagged on the next admin page-load.
  runWebhookHealthCheckTick().catch((e) =>
    console.error("[email-webhook-health] boot tick failed:", e),
  );
  const tickMs = getWebhookHealthCheckTickMs();
  interval = setInterval(() => {
    runWebhookHealthCheckTick().catch((e) =>
      console.error("[email-webhook-health] tick failed:", e),
    );
  }, tickMs);
  if (typeof interval.unref === "function") interval.unref();
  console.log(
    `[email-webhook-health] processor started (tick=${tickMs}ms, stale=${getWebhookHealthCheckStaleMs()}ms)`,
  );
}

export function stopWebhookHealthCheckProcessor(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
