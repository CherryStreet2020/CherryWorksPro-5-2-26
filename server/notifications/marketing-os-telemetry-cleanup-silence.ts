/**
 * Task #318 — Out-of-band notification when the marketing-os telemetry
 * cleanup sweep has gone silent for several consecutive days.
 *
 * Task #290 already surfaces a passive warning banner on the admin
 * Marketing OS telemetry card when the sweep is overdue (>2× the
 * configured interval) or has never run despite a backlog of expired
 * rows. That helps admins who already happen to load the dashboard, but
 * a truly silent scheduler (e.g. crashed cron, stuck advisory lock,
 * env-var typo) won't be noticed until someone opens the page. This
 * module mirrors the email path that already exists for the email-alert
 * webhook auto-test (`webhook-health-failure.ts`): when the
 * cleanup-health status stays "overdue" or "missing" past a configured
 * silence threshold (default 3 days), opted-in admins are emailed and
 * the alert is recorded so we don't re-fire every subsequent tick. A
 * fresh successful cleanup run implicitly resets the dedupe because the
 * decision logic compares the most recent recorded run against the
 * most recent stamped alert.
 *
 * Sends use the env-level SMTP fallback so they still go out when an
 * org's own mailbox is broken. Failures here are swallowed and logged
 * so a notification problem cannot mask the underlying outage.
 */
import { db } from "../db";
import {
  marketingOsTelemetryCleanupSilenceAlerts,
  notificationPreferences,
  users,
} from "@shared/schema";
import type { MarketingOsTelemetryCleanupHealth } from "../routes/marketing-os-telemetry-routes";
import { and, desc, eq, sql } from "drizzle-orm";
import { createEnvTransporter } from "../email/smtp-transport";

const DEFAULT_SILENCE_THRESHOLD_DAYS = 3;

/**
 * Resolve the configured "silence" threshold. The cleanup-health banner
 * already flips to "overdue" at 2× the scheduler interval (48h with the
 * default 24h interval), but for the *email* we want to wait a few more
 * days so admins aren't paged for a single missed tick. Defaults to 3
 * days; override with `MARKETING_OS_TELEMETRY_CLEANUP_SILENCE_ALERT_DAYS`.
 */
export function getTelemetryCleanupSilenceThresholdMs(): number {
  const raw = process.env.MARKETING_OS_TELEMETRY_CLEANUP_SILENCE_ALERT_DAYS;
  const n = Number(raw);
  const days =
    Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_SILENCE_THRESHOLD_DAYS;
  return days * 24 * 60 * 60 * 1000;
}

export interface TelemetryCleanupSilenceDecisionInput {
  health: MarketingOsTelemetryCleanupHealth;
  silenceThresholdMs: number;
  /** Epoch ms of the last alert sent, or null if no alert has ever been sent. */
  lastAlertSentAtMs: number | null;
  /** Epoch ms of the last recorded cleanup run, or null if no run exists. */
  lastRunRanAtMs: number | null;
}

/**
 * Pure decision function — exported so the unit test can pin every
 * branch of the "should we email admins" matrix without standing up a
 * DB or transporter.
 *
 * Returns true iff:
 *   - The health status is "overdue" or "missing" (i.e. the banner is
 *     already crying wolf in the UI), AND
 *   - The cleanup has been silent past the configured silence
 *     threshold. For "overdue" that means `ageMs >= silenceThresholdMs`.
 *     For "missing" we always proceed because the very fact that no run
 *     has ever fired *and* expired rows already exist is itself
 *     evidence the scheduler has been silent for at least the
 *     retention window — re-checking ageMs would always be null and
 *     suppress the alert forever.
 *   - AND no prior alert has been sent OR a successful cleanup run has
 *     happened since the last alert (the implicit reset).
 */
export function shouldEmailTelemetryCleanupSilence(
  input: TelemetryCleanupSilenceDecisionInput,
): boolean {
  const { health, silenceThresholdMs, lastAlertSentAtMs, lastRunRanAtMs } =
    input;

  if (health.status === "ok") return false;

  if (health.status === "overdue") {
    if (health.ageMs === null) {
      // Malformed last-run timestamp — the banner already treats this as
      // overdue, but without a real age we can't say it's been silent
      // past the threshold. Don't email yet; the next tick with a
      // healed timestamp (or a missing-row branch on the row's deletion)
      // will reach the right verdict.
      return false;
    }
    if (health.ageMs < silenceThresholdMs) return false;
  }

  if (lastAlertSentAtMs === null) return true;

  // Implicit reset: a recorded cleanup run that's newer than the last
  // alert means the scheduler woke back up at least once since we
  // emailed; treat the next breakage as a fresh outage and alert again.
  if (lastRunRanAtMs !== null && lastRunRanAtMs > lastAlertSentAtMs) {
    return true;
  }

  return false;
}

interface AdminRow {
  email: string;
  name: string | null;
}

async function loadOptedInAdmins(): Promise<AdminRow[]> {
  // System-wide concern: the telemetry cleanup is a single global sweep
  // (not per-org), so notify every active admin across every org who
  // hasn't opted out of system updates. De-dupe by email (not by
  // (email, name)) so an admin who belongs to multiple orgs — possibly
  // with slightly different display-name spellings — only receives one
  // email per breakage.
  const rows = await db
    .select({ email: users.email, name: users.name })
    .from(users)
    .leftJoin(
      notificationPreferences,
      and(
        eq(notificationPreferences.userId, users.id),
        eq(notificationPreferences.orgId, users.orgId),
      ),
    )
    .where(
      and(
        eq(users.role, "ADMIN"),
        eq(users.isActive, true),
        sql`${users.email} IS NOT NULL AND ${users.email} <> ''`,
        sql`COALESCE(${notificationPreferences.systemUpdates}, true) = true`,
      ),
    );
  const seen = new Set<string>();
  const out: AdminRow[] = [];
  for (const r of rows) {
    const email = r.email;
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ email, name: r.name ?? null });
  }
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fromAddress(): string {
  return process.env.SMTP_FROM_EMAIL
    ? `"CherryWorks Pro" <${process.env.SMTP_FROM_EMAIL}>`
    : process.env.SMTP_USER
      ? `"CherryWorks Pro" <${process.env.SMTP_USER}>`
      : '"CherryWorks Pro" <noreply@cherrystconsulting.com>';
}

function describeAge(ageMs: number | null): string {
  if (ageMs === null) return "an unknown amount of time";
  const hours = Math.round(ageMs / 3_600_000);
  if (hours < 48) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days} days`;
}

/**
 * Build the subject/html/text tuple for the silent-cleanup alert.
 * Pure for testability.
 */
export function buildTelemetryCleanupSilenceEmail(args: {
  status: "overdue" | "missing";
  ageMs: number | null;
  intervalMs: number;
}): { subject: string; html: string; text: string } {
  const { status, ageMs, intervalMs } = args;
  const intervalHours = Math.round(intervalMs / 3_600_000);
  const ageDesc = describeAge(ageMs);
  const subject =
    status === "missing"
      ? "Marketing telemetry cleanup has never run"
      : `Marketing telemetry cleanup has been silent for ${ageDesc}`;
  const lead =
    status === "missing"
      ? `The marketing-os telemetry cleanup sweep has <strong>never</strong> run, ` +
        `even though there are already telemetry rows older than the configured retention ` +
        `window. The scheduler is expected to fire roughly every ${intervalHours}h.`
      : `The marketing-os telemetry cleanup sweep has not run for ${escapeHtml(ageDesc)}, ` +
        `well past the expected ${intervalHours}h cadence. Telemetry rows older than the ` +
        `configured retention window are no longer being deleted.`;
  const leadText =
    status === "missing"
      ? `The marketing-os telemetry cleanup sweep has never run, even though ` +
        `there are already telemetry rows older than the configured retention ` +
        `window. The scheduler is expected to fire roughly every ${intervalHours}h.`
      : `The marketing-os telemetry cleanup sweep has not run for ${ageDesc}, ` +
        `well past the expected ${intervalHours}h cadence. Telemetry rows older ` +
        `than the configured retention window are no longer being deleted.`;
  const html = `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1a2e;background:#f8f9fa;padding:24px">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e5ec;border-radius:8px;padding:32px">
<h2 style="margin:0 0 12px;color:#cf3339">Telemetry cleanup is silent</h2>
<p style="margin:0 0 16px;color:#555770">${lead}</p>
<p style="margin:0;color:#555770">
Open the Marketing OS telemetry card in the admin dashboard to inspect cleanup history,
trigger a manual run, or check for scheduler errors in the server logs.
</p>
</div>
</body></html>`;
  const text =
    `${leadText}\n\n` +
    `Open the Marketing OS telemetry card in the admin dashboard to inspect cleanup ` +
    `history, trigger a manual run, or check for scheduler errors in the server logs.`;
  return { subject, html, text };
}

async function getLastSilenceAlertSentAtMs(): Promise<number | null> {
  const rows = await db
    .select({ sentAt: marketingOsTelemetryCleanupSilenceAlerts.sentAt })
    .from(marketingOsTelemetryCleanupSilenceAlerts)
    .orderBy(desc(marketingOsTelemetryCleanupSilenceAlerts.sentAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return row.sentAt instanceof Date
    ? row.sentAt.getTime()
    : Date.parse(String(row.sentAt));
}

async function recordSilenceAlert(args: {
  status: "overdue" | "missing";
  ageMs: number | null;
  notifiedCount: number;
}): Promise<void> {
  await db.insert(marketingOsTelemetryCleanupSilenceAlerts).values({
    healthStatus: args.status,
    ageMs: args.ageMs,
    notifiedCount: args.notifiedCount,
  });
}

async function sendToAdmins(
  admins: AdminRow[],
  subject: string,
  html: string,
  text: string,
): Promise<number> {
  if (admins.length === 0) return 0;
  const transporter = await createEnvTransporter();
  if (!transporter) {
    console.warn(
      "[telemetry-cleanup-silence] env SMTP fallback not configured — alert not delivered",
    );
    return 0;
  }
  const from = fromAddress();
  let sent = 0;
  for (const admin of admins) {
    try {
      await transporter.sendMail({
        from,
        to: admin.email,
        subject,
        html,
        text,
      });
      sent += 1;
      console.log(
        `[telemetry-cleanup-silence] alert sent to admin=${admin.email}`,
      );
    } catch (e) {
      console.error(
        `[telemetry-cleanup-silence] failed to notify admin=${admin.email}:`,
        e,
      );
    }
  }
  return sent;
}

/**
 * Evaluate the current cleanup-health state and, if the silence
 * decision logic says yes, email opted-in admins and stamp a row in
 * `marketing_os_telemetry_cleanup_silence_alerts` so the next tick
 * doesn't re-alert. Safe to call on every cleanup tick — fast no-ops
 * when the scheduler is healthy.
 *
 * Internal failures are logged and swallowed; this is best-effort and
 * must never crash the cleanup tick that called it.
 */
export async function evaluateAndMaybeNotifyTelemetryCleanupSilence(args: {
  health: MarketingOsTelemetryCleanupHealth;
  lastRunRanAtMs: number | null;
  silenceThresholdMs?: number;
}): Promise<{ alerted: boolean; notified: number } | null> {
  try {
    const silenceThresholdMs =
      args.silenceThresholdMs ?? getTelemetryCleanupSilenceThresholdMs();
    const lastAlertSentAtMs = await getLastSilenceAlertSentAtMs();
    const should = shouldEmailTelemetryCleanupSilence({
      health: args.health,
      silenceThresholdMs,
      lastAlertSentAtMs,
      lastRunRanAtMs: args.lastRunRanAtMs,
    });
    if (!should) return { alerted: false, notified: 0 };

    const status = args.health.status as "overdue" | "missing";
    const admins = await loadOptedInAdmins();
    if (admins.length === 0) {
      // Mirror the webhook-health-failure dedupe pattern: do NOT stamp
      // the alert as sent when nothing actually went out. If a new
      // admin opts in (or is created) during the same outage, the
      // very next tick must be free to email them — stamping here
      // would suppress that until a successful cleanup run resets the
      // dedupe.
      console.warn(
        "[telemetry-cleanup-silence] cleanup is silent but no opted-in admins to notify",
      );
      return { alerted: false, notified: 0 };
    }

    const { subject, html, text } = buildTelemetryCleanupSilenceEmail({
      status,
      ageMs: args.health.ageMs,
      intervalMs: args.health.intervalMs,
    });
    const notified = await sendToAdmins(admins, subject, html, text);
    // Only stamp on a successful delivery. A transient SMTP outage
    // must not permanently suppress retries for this outage.
    if (notified > 0) {
      await recordSilenceAlert({
        status,
        ageMs: args.health.ageMs,
        notifiedCount: notified,
      });
    }
    return { alerted: notified > 0, notified };
  } catch (e) {
    console.error(
      "[telemetry-cleanup-silence] evaluateAndMaybeNotifyTelemetryCleanupSilence failed:",
      e,
    );
    return null;
  }
}
