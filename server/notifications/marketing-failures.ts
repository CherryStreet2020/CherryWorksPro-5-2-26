/**
 * Task #269 — Admin notifications for marketing campaign / sequence
 * recipients that permanently failed to receive an email.
 *
 * Two entry points:
 *
 *   1. notifyAdminsOfCampaignFailures(campaign)
 *      Fired by the scheduled-send worker right after a campaign is
 *      stamped `sent_at`. Looks up the per-recipient send attempts via
 *      `storage.listCampaignFailedRecipients`, filters down to permanent
 *      failures, and emails opted-in admins a single digest summarising
 *      the count, the first few addresses, and the (redacted) error
 *      codes.
 *
 *   2. notifyAdminsOfSequenceStepPermanentFailure(...)
 *      Fired the moment a per-recipient sequence-step attempt is
 *      classified `permanent_failure` (max attempts hit, or a
 *      non-transient error code). One alert per (enrollment, step) so
 *      admins see exactly which contact dropped out at which step.
 *
 * Both fan-out helpers are fire-and-forget — failures are logged and
 * swallowed so a notification problem cannot mask the original send
 * failure. Both respect `notification_preferences.system_updates`
 * (defaults to true) on a per-admin basis. Sends use the env-level SMTP
 * fallback so they still go out when the org's own mailbox is broken.
 */
import { db, pool } from "../db";
import {
  orgs,
  users,
  notificationPreferences,
  pendingAdminNotifications,
  type MarketingCampaign,
  type MarketingSequence,
} from "@shared/schema";
import { and, eq, lte, sql } from "drizzle-orm";
import { createEnvTransporter } from "../email/smtp-transport";
import { storage } from "../storage";
import {
  isWithinQuietHours,
  nextQuietHoursEnd,
  type QuietHoursPrefs,
} from "./quiet-hours";

/** Maximum number of recipient addresses listed in the digest body. */
export const FAILURE_DIGEST_MAX_ADDRESSES = 5;
/** Maximum number of distinct error codes summarised in the digest. */
export const FAILURE_DIGEST_MAX_ERROR_CODES = 5;

interface AdminRow {
  email: string;
  name: string | null;
  // Quiet-hours prefs may be undefined when the admin has no
  // notification_preferences row (LEFT JOIN). Treated as "disabled".
  quietHoursEnabled?: boolean | null;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
  quietHoursTimezone?: string | null;
}

async function loadOptedInAdmins(orgId: string): Promise<{
  admins: AdminRow[];
  orgName: string;
}> {
  const [orgRow] = await db
    .select({ name: orgs.name })
    .from(orgs)
    .where(eq(orgs.id, orgId));
  const admins = await db
    .select({
      email: users.email,
      name: users.name,
      quietHoursEnabled: notificationPreferences.quietHoursEnabled,
      quietHoursStart: notificationPreferences.quietHoursStart,
      quietHoursEnd: notificationPreferences.quietHoursEnd,
      quietHoursTimezone: notificationPreferences.quietHoursTimezone,
    })
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
        eq(users.orgId, orgId),
        eq(users.role, "ADMIN"),
        eq(users.isActive, true),
        sql`${users.email} IS NOT NULL AND ${users.email} <> ''`,
        sql`COALESCE(${notificationPreferences.systemUpdates}, true) = true`,
      ),
    );
  return {
    admins: admins.map((a) => ({
      email: a.email!,
      name: a.name ?? null,
      quietHoursEnabled: a.quietHoursEnabled ?? null,
      quietHoursStart: a.quietHoursStart ?? null,
      quietHoursEnd: a.quietHoursEnd ?? null,
      quietHoursTimezone: a.quietHoursTimezone ?? null,
    })),
    orgName: orgRow?.name ?? "your organization",
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fromAddress(): string {
  return process.env.SMTP_FROM_EMAIL
    ? `"CherryWorks Pro" <${process.env.SMTP_FROM_EMAIL}>`
    : process.env.SMTP_USER
      ? `"CherryWorks Pro" <${process.env.SMTP_USER}>`
      : '"CherryWorks Pro" <noreply@cherrystconsulting.com>';
}

interface FailureSummary {
  totalCount: number;
  permanentCount: number;
  pendingRetryCount: number;
  sampleAddresses: string[];
  errorCodeCounts: Array<{ code: string; count: number }>;
}

export function summarizeFailures(
  rows: Array<{
    recipientEmail: string | null;
    status: "failed" | "permanent_failure";
    errorCode: string | null;
  }>,
): FailureSummary {
  const permanent = rows.filter((r) => r.status === "permanent_failure");
  const pending = rows.filter((r) => r.status === "failed");
  const seen = new Set<string>();
  const sampleAddresses: string[] = [];
  for (const r of permanent) {
    if (!r.recipientEmail) continue;
    if (seen.has(r.recipientEmail)) continue;
    seen.add(r.recipientEmail);
    sampleAddresses.push(r.recipientEmail);
    if (sampleAddresses.length >= FAILURE_DIGEST_MAX_ADDRESSES) break;
  }
  const codeMap = new Map<string, number>();
  for (const r of permanent) {
    const code = r.errorCode || "UNKNOWN";
    codeMap.set(code, (codeMap.get(code) ?? 0) + 1);
  }
  const errorCodeCounts = Array.from(codeMap.entries())
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, FAILURE_DIGEST_MAX_ERROR_CODES);
  return {
    totalCount: rows.length,
    permanentCount: permanent.length,
    pendingRetryCount: pending.length,
    sampleAddresses,
    errorCodeCounts,
  };
}

/**
 * Build the (subject, html, text) tuple for the campaign digest email.
 * Pure for testability.
 */
export function buildCampaignDigestEmail(args: {
  orgName: string;
  campaignName: string;
  recipientCount: number;
  summary: FailureSummary;
}): { subject: string; html: string; text: string } {
  const { orgName, campaignName, recipientCount, summary } = args;
  const noun = summary.permanentCount === 1 ? "recipient" : "recipients";
  const subject = `Campaign "${campaignName}" — ${summary.permanentCount} ${noun} did not receive`;
  const sampleHtml = summary.sampleAddresses
    .map((e) => `<li>${escapeHtml(e)}</li>`)
    .join("");
  const codesHtml = summary.errorCodeCounts
    .map(
      (c) =>
        `<li><code>${escapeHtml(c.code)}</code> &times; ${c.count}</li>`,
    )
    .join("");
  const html = `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1a2e;background:#f8f9fa;padding:24px">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e5ec;border-radius:8px;padding:32px">
<h2 style="margin:0 0 12px;color:#cf3339">Campaign delivery failures</h2>
<p style="margin:0 0 16px;color:#555770">
The campaign <strong>${escapeHtml(campaignName)}</strong> for
<strong>${escapeHtml(orgName)}</strong> finished with
<strong>${summary.permanentCount}</strong> permanently failed
${noun} out of ${recipientCount} attempted.
</p>
${sampleHtml
      ? `<p style="margin:0 0 4px;color:#8b8da3;font-size:12px">First failed addresses:</p>
<ul style="margin:0 0 16px 20px;color:#555770">${sampleHtml}</ul>`
      : ""}
${codesHtml
      ? `<p style="margin:0 0 4px;color:#8b8da3;font-size:12px">Error codes:</p>
<ul style="margin:0 0 16px 20px;color:#555770">${codesHtml}</ul>`
      : ""}
<p style="margin:0;color:#555770">
Open the campaign's Failures dialog in Marketing OS to retry, suppress, or
investigate individual recipients.
</p>
</div>
</body></html>`;
  const text = `Campaign "${campaignName}" for ${orgName} finished with ` +
    `${summary.permanentCount} permanently failed ${noun} out of ` +
    `${recipientCount} attempted.\n\n` +
    (summary.sampleAddresses.length
      ? `First failed addresses:\n${summary.sampleAddresses
          .map((e) => `  - ${e}`)
          .join("\n")}\n\n`
      : "") +
    (summary.errorCodeCounts.length
      ? `Error codes:\n${summary.errorCodeCounts
          .map((c) => `  - ${c.code} x ${c.count}`)
          .join("\n")}\n\n`
      : "") +
    `Open the campaign's Failures dialog in Marketing OS to retry, ` +
    `suppress, or investigate individual recipients.`;
  return { subject, html, text };
}

/**
 * One queued sequence-step permanent failure waiting to be folded into
 * the next per-sequence digest.
 */
export interface QueuedSequenceFailure {
  stepIndex: number;
  recipientEmail: string;
  errorCode: string | null;
  errorMessage: string | null;
  attemptCount: number;
  occurredAt: Date;
}

/**
 * Build the per-step alert email body. Pure for testability. Retained
 * for backwards-compatibility with callers that want a single-failure
 * email; the production path now goes through the hourly digest.
 */
export function buildSequenceStepAlertEmail(args: {
  orgName: string;
  sequenceName: string;
  stepIndex: number;
  recipientEmail: string;
  errorCode: string | null;
  errorMessage: string | null;
  attemptCount: number;
}): { subject: string; html: string; text: string } {
  const {
    orgName,
    sequenceName,
    stepIndex,
    recipientEmail,
    errorCode,
    errorMessage,
    attemptCount,
  } = args;
  const stepLabel = `Step ${stepIndex + 1}`;
  const subject = `Sequence "${sequenceName}" — ${stepLabel} permanently failed for ${recipientEmail}`;
  const safeMsg = escapeHtml(errorMessage ?? "");
  const html = `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1a2e;background:#f8f9fa;padding:24px">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e5ec;border-radius:8px;padding:32px">
<h2 style="margin:0 0 12px;color:#cf3339">Sequence step failed</h2>
<p style="margin:0 0 16px;color:#555770">
${escapeHtml(stepLabel)} of <strong>${escapeHtml(sequenceName)}</strong>
(${escapeHtml(orgName)}) gave up after ${attemptCount}
attempt${attemptCount === 1 ? "" : "s"} delivering to
<strong>${escapeHtml(recipientEmail)}</strong>.
</p>
<p style="margin:0 0 4px;color:#8b8da3;font-size:12px">Error code:</p>
<p style="margin:0 0 16px"><code>${escapeHtml(errorCode ?? "UNKNOWN")}</code></p>
${safeMsg
      ? `<p style="margin:0 0 4px;color:#8b8da3;font-size:12px">Last error:</p>
<pre style="margin:0;padding:12px;background:#f3f3f7;border-radius:4px;color:#1a1a2e;font-size:12px;white-space:pre-wrap;word-break:break-word">${safeMsg}</pre>`
      : ""}
</div>
</body></html>`;
  const text = `${stepLabel} of "${sequenceName}" (${orgName}) gave up ` +
    `after ${attemptCount} attempt${attemptCount === 1 ? "" : "s"} ` +
    `delivering to ${recipientEmail}.\n\n` +
    `Error code: ${errorCode ?? "UNKNOWN"}\n` +
    (errorMessage ? `Last error: ${errorMessage}\n` : "");
  return { subject, html, text };
}

/**
 * Per-admin classifier used by `sendToAdmins`. Pure-ish (only reads
 * the clock via the injected `now` for testability).
 */
export function classifyAdminDelivery(
  admin: QuietHoursPrefs,
  now: Date,
): { defer: false } | { defer: true; releaseAt: Date } {
  if (!isWithinQuietHours(now, admin)) return { defer: false };
  return { defer: true, releaseAt: nextQuietHoursEnd(now, admin) };
}

async function bufferForQuietHours(args: {
  orgId: string;
  recipientEmail: string;
  subject: string;
  html: string;
  text: string;
  contextTag: string;
  releaseAt: Date;
}): Promise<void> {
  await db.insert(pendingAdminNotifications).values({
    orgId: args.orgId,
    recipientEmail: args.recipientEmail,
    subject: args.subject,
    html: args.html,
    bodyText: args.text,
    contextTag: args.contextTag,
    releaseAt: args.releaseAt,
  });
  console.log(
    `[marketing-failure-notify] ${args.contextTag} buffered for ` +
      `${args.recipientEmail} until ${args.releaseAt.toISOString()} (quiet hours)`,
  );
}

/**
 * Build the hourly per-sequence digest email summarising every
 * permanent failure recorded since the last digest fired. The digest
 * lists every failed recipient (grouped by step) and every distinct
 * error code — no truncation — so admins have a complete record of the
 * window without having to open the Failures dialog. Pure for
 * testability.
 */
export function buildSequenceFailureDigestEmail(args: {
  orgName: string;
  sequenceName: string;
  failures: QueuedSequenceFailure[];
}): { subject: string; html: string; text: string } {
  const { orgName, sequenceName, failures } = args;
  const total = failures.length;
  const noun = total === 1 ? "recipient" : "recipients";
  const subject = `Sequence "${sequenceName}" — ${total} ${noun} permanently failed`;

  // Per-step breakdown — keep insertion order within a step so the
  // earliest failure surfaces first, but sort steps numerically.
  const stepMap = new Map<number, QueuedSequenceFailure[]>();
  for (const f of failures) {
    const list = stepMap.get(f.stepIndex) ?? [];
    list.push(f);
    stepMap.set(f.stepIndex, list);
  }
  const steps = Array.from(stepMap.entries()).sort((a, b) => a[0] - b[0]);

  // Aggregate error codes — every distinct code, sorted by frequency.
  const codeMap = new Map<string, number>();
  for (const f of failures) {
    const code = f.errorCode || "UNKNOWN";
    codeMap.set(code, (codeMap.get(code) ?? 0) + 1);
  }
  const codes = Array.from(codeMap.entries())
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count);

  const stepsHtml = steps
    .map(([stepIndex, fs]) => {
      const items = fs
        .map(
          (f) =>
            `<li>${escapeHtml(f.recipientEmail)} — <code>${escapeHtml(
              f.errorCode ?? "UNKNOWN",
            )}</code></li>`,
        )
        .join("");
      return (
        `<p style="margin:12px 0 4px;color:#1a1a2e"><strong>Step ${stepIndex + 1}</strong> — ${fs.length} failed</p>` +
        `<ul style="margin:0 0 8px 20px;color:#555770">${items}</ul>`
      );
    })
    .join("");
  const codesHtml = codes
    .map(
      (c) => `<li><code>${escapeHtml(c.code)}</code> &times; ${c.count}</li>`,
    )
    .join("");

  const html = `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1a2e;background:#f8f9fa;padding:24px">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e5ec;border-radius:8px;padding:32px">
<h2 style="margin:0 0 12px;color:#cf3339">Sequence delivery failures</h2>
<p style="margin:0 0 16px;color:#555770">
The sequence <strong>${escapeHtml(sequenceName)}</strong> for
<strong>${escapeHtml(orgName)}</strong> recorded
<strong>${total}</strong> permanently failed
${noun} since the last digest.
</p>
${stepsHtml}
${codesHtml
      ? `<p style="margin:12px 0 4px;color:#8b8da3;font-size:12px">Error codes:</p>
<ul style="margin:0 0 16px 20px;color:#555770">${codesHtml}</ul>`
      : ""}
<p style="margin:0;color:#555770">
Open the sequence's Failures dialog in Marketing OS to retry, suppress, or
investigate individual recipients.
</p>
</div>
</body></html>`;

  const stepsText = steps
    .map(([stepIndex, fs]) => {
      const items = fs
        .map((f) => `    - ${f.recipientEmail} (${f.errorCode ?? "UNKNOWN"})`)
        .join("\n");
      return `  Step ${stepIndex + 1} — ${fs.length} failed\n${items}`;
    })
    .join("\n");
  const codesText = codes
    .map((c) => `  - ${c.code} x ${c.count}`)
    .join("\n");
  const text =
    `Sequence "${sequenceName}" for ${orgName} recorded ${total} ` +
    `permanently failed ${noun} since the last digest.\n\n` +
    `${stepsText}\n\n` +
    (codesText ? `Error codes:\n${codesText}\n\n` : "") +
    `Open the sequence's Failures dialog in Marketing OS to retry, ` +
    `suppress, or investigate individual recipients.`;

  return { subject, html, text };
}

async function sendToAdmins(
  orgId: string,
  admins: AdminRow[],
  subject: string,
  html: string,
  text: string,
  contextTag: string,
): Promise<void> {
  if (admins.length === 0) return;
  const now = new Date();

  // Partition admins into "send now" vs "buffer until quiet hours end".
  // Buffering doesn't need an SMTP transporter — the periodic processor
  // will pick the row up and deliver it later. Doing this first means a
  // missing transporter still buffers correctly so admins get the email
  // when SMTP is restored.
  const deferred: Array<{ admin: AdminRow; releaseAt: Date }> = [];
  const immediate: AdminRow[] = [];
  for (const admin of admins) {
    const decision = classifyAdminDelivery(admin, now);
    if (decision.defer) {
      deferred.push({ admin, releaseAt: decision.releaseAt });
    } else {
      immediate.push(admin);
    }
  }

  for (const { admin, releaseAt } of deferred) {
    try {
      await bufferForQuietHours({
        orgId,
        recipientEmail: admin.email,
        subject,
        html,
        text,
        contextTag,
        releaseAt,
      });
    } catch (e) {
      console.error(
        `[marketing-failure-notify] failed to buffer admin=${admin.email} (${contextTag}):`,
        e,
      );
    }
  }

  if (immediate.length === 0) return;

  const transporter = await createEnvTransporter();
  if (!transporter) {
    console.warn(
      `[marketing-failure-notify] env SMTP fallback not configured — ${contextTag} not delivered`,
    );
    return;
  }
  const from = fromAddress();
  for (const admin of immediate) {
    try {
      await transporter.sendMail({
        from,
        to: admin.email,
        subject,
        html,
        text,
      });
      console.log(
        `[marketing-failure-notify] ${contextTag} sent to admin=${admin.email}`,
      );
    } catch (e) {
      console.error(
        `[marketing-failure-notify] failed to notify admin=${admin.email} (${contextTag}):`,
        e,
      );
    }
  }
}

/**
 * Look up failed-recipient rows for the given campaign and, when there
 * is at least one permanent failure, email a digest to opted-in admins.
 * Fire-and-forget: returns once the (best-effort) sends are scheduled.
 */
export async function notifyAdminsOfCampaignFailures(
  campaign: Pick<MarketingCampaign, "id" | "orgId" | "name">,
  recipientCount: number,
): Promise<{ notified: number; permanentCount: number } | null> {
  try {
    const rows = await storage.listCampaignFailedRecipients(
      campaign.orgId,
      campaign.id,
    );
    const summary = summarizeFailures(rows);
    if (summary.permanentCount === 0) return { notified: 0, permanentCount: 0 };
    const { admins, orgName } = await loadOptedInAdmins(campaign.orgId);
    if (admins.length === 0) {
      console.warn(
        `[marketing-failure-notify] campaign=${campaign.id} has ` +
          `${summary.permanentCount} permanent failures but no opted-in admins`,
      );
      return { notified: 0, permanentCount: summary.permanentCount };
    }
    const { subject, html, text } = buildCampaignDigestEmail({
      orgName,
      campaignName: campaign.name,
      recipientCount,
      summary,
    });
    await sendToAdmins(
      campaign.orgId,
      admins,
      subject,
      html,
      text,
      `campaign=${campaign.id}`,
    );
    return { notified: admins.length, permanentCount: summary.permanentCount };
  } catch (e) {
    console.error(
      `[marketing-failure-notify] notifyAdminsOfCampaignFailures failed for campaign=${campaign.id}:`,
      e,
    );
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Task #304 — Sequence failure digest coalescing.
 *
 * Sequence-step permanent failures used to fire one admin email per
 * (enrollment, step). A sequence with hundreds of enrollments hitting a
 * bad SMTP relay would flood admin inboxes. We now record the failures
 * but coalesce email delivery into a single digest per sequence per
 * digest interval (default: hourly, overridable via env).
 *
 * Implementation:
 *   - notifyAdminsOfSequenceStepPermanentFailure() queues the failure in
 *     an in-memory map keyed by sequence id and starts a flush timer.
 *   - flushSequenceFailureDigest(sequenceId) builds the digest and
 *     emails opted-in admins, then clears the queue for that sequence.
 *   - flushAllSequenceFailureDigests() drains every pending sequence
 *     (used by tests and graceful shutdown hooks).
 *   - setSequenceFailureDigestIntervalMs() lets tests / ops override the
 *     interval at runtime.
 *
 * Limitations:
 *   - Queue lives in-process. A crash before the digest fires loses the
 *     pending-digest emails (the underlying email_send_attempts rows
 *     persist, so admins can still see the failures in the Failures
 *     dialog). The previous implementation had the same limitation
 *     between dispatch and SMTP send.
 *   - Single-process deployments only. A fleet would need each instance
 *     to flush its own queue.
 * ------------------------------------------------------------------ */

const DEFAULT_SEQUENCE_DIGEST_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

function parseDigestIntervalEnv(): number {
  const raw = process.env.SEQUENCE_FAILURE_DIGEST_INTERVAL_MS;
  if (raw === undefined || raw === "") return DEFAULT_SEQUENCE_DIGEST_INTERVAL_MS;
  const n = Number(raw);
  // Honor explicit 0 (synchronous-flush mode). Reject NaN / negatives.
  if (!Number.isFinite(n) || n < 0) return DEFAULT_SEQUENCE_DIGEST_INTERVAL_MS;
  return n;
}

let sequenceDigestIntervalMs = parseDigestIntervalEnv();

interface PendingSequenceDigest {
  sequence: Pick<MarketingSequence, "id" | "orgId" | "name">;
  failures: QueuedSequenceFailure[];
  scheduledAt: Date;
  timer: NodeJS.Timeout | null;
}

const pendingSequenceDigests = new Map<string, PendingSequenceDigest>();

/**
 * Override the digest interval at runtime. Returns the previous value.
 * Pass 0 to flush synchronously on every queued failure (useful for
 * tests).
 */
export function setSequenceFailureDigestIntervalMs(ms: number): number {
  const prev = sequenceDigestIntervalMs;
  sequenceDigestIntervalMs = Math.max(0, ms);
  return prev;
}

/** Returns the current digest interval in milliseconds. */
export function getSequenceFailureDigestIntervalMs(): number {
  return sequenceDigestIntervalMs;
}

/** Test / introspection helper — number of sequences with queued failures. */
export function _pendingSequenceDigestCount(): number {
  return pendingSequenceDigests.size;
}

/**
 * Drop every pending digest without sending. Test-only helper so suites
 * don't leak state between cases.
 */
export function _resetSequenceFailureDigests(): void {
  for (const p of pendingSequenceDigests.values()) {
    if (p.timer) clearTimeout(p.timer);
  }
  pendingSequenceDigests.clear();
}

/**
 * Flush the queued digest for one sequence. Returns null if there is
 * nothing queued, or a summary of what was sent.
 *
 * Failure semantics: if loading admins or sending the digest throws,
 * the queued failures are merged back into the pending map so the next
 * flush retries them. The "no opted-in admins" branch is treated as a
 * successful drop (matches the per-failure behavior — there is nobody
 * to notify, no point in keeping the queue around).
 */
export async function flushSequenceFailureDigest(
  sequenceId: string,
): Promise<{ notified: number; failureCount: number } | null> {
  const pending = pendingSequenceDigests.get(sequenceId);
  if (!pending) return null;
  pendingSequenceDigests.delete(sequenceId);
  if (pending.timer) {
    clearTimeout(pending.timer);
    pending.timer = null;
  }

  try {
    const { admins, orgName } = await loadOptedInAdmins(pending.sequence.orgId);
    if (admins.length === 0) {
      console.warn(
        `[marketing-failure-notify] sequence=${pending.sequence.id} digest with ` +
          `${pending.failures.length} failures suppressed — no opted-in admins`,
      );
      return { notified: 0, failureCount: pending.failures.length };
    }
    const { subject, html, text } = buildSequenceFailureDigestEmail({
      orgName,
      sequenceName: pending.sequence.name,
      failures: pending.failures,
    });
    await sendToAdmins(
      pending.sequence.orgId,
      admins,
      subject,
      html,
      text,
      `sequence=${pending.sequence.id} digest(${pending.failures.length})`,
    );
    return { notified: admins.length, failureCount: pending.failures.length };
  } catch (e) {
    console.error(
      `[marketing-failure-notify] flushSequenceFailureDigest failed for sequence=${pending.sequence.id}, ` +
        `re-queueing ${pending.failures.length} failures for the next flush:`,
      e,
    );
    // Merge the failures back so a transient DB / SMTP outage doesn't
    // drop the digest. New arrivals during the flush are preserved.
    const current = pendingSequenceDigests.get(sequenceId);
    if (current) {
      current.failures.unshift(...pending.failures);
    } else {
      pending.failures.sort((a, b) => +a.occurredAt - +b.occurredAt);
      pendingSequenceDigests.set(sequenceId, pending);
      if (sequenceDigestIntervalMs > 0) {
        const timer = setTimeout(() => {
          flushSequenceFailureDigest(sequenceId).catch((err) =>
            console.error(
              `[marketing-failure-notify] retry digest flush failed for sequence=${sequenceId}:`,
              err,
            ),
          );
        }, sequenceDigestIntervalMs);
        if (typeof timer.unref === "function") timer.unref();
        pending.timer = timer;
      }
    }
    return null;
  }
}

/**
 * Flush every pending sequence digest. Useful for graceful shutdown
 * and for tests that want deterministic delivery.
 */
export async function flushAllSequenceFailureDigests(): Promise<void> {
  // Drain sequentially so we don't fan out 100 simultaneous SMTP sends
  // when a wave of sequences all failed in the same hour.
  const ids = Array.from(pendingSequenceDigests.keys());
  for (const id of ids) {
    await flushSequenceFailureDigest(id);
  }
}

/**
 * Record that retries are exhausted for one (enrollment, step) and
 * make sure a digest will be sent within the configured interval.
 *
 * Returns:
 *   - { queued: true, queuedFailures } when the failure was added to a
 *     pending digest (the email will fire later).
 *   - { queued: false, notified, failureCount } when the configured
 *     interval is 0 (synchronous flush mode for tests).
 *   - null on unexpected error.
 */
export async function notifyAdminsOfSequenceStepPermanentFailure(
  sequence: Pick<MarketingSequence, "id" | "orgId" | "name">,
  args: {
    stepIndex: number;
    recipientEmail: string;
    errorCode: string | null;
    errorMessage: string | null;
    attemptCount: number;
  },
): Promise<
  | { queued: true; queuedFailures: number }
  | { queued: false; notified: number; failureCount: number }
  | null
> {
  try {
    const failure: QueuedSequenceFailure = {
      stepIndex: args.stepIndex,
      recipientEmail: args.recipientEmail,
      errorCode: args.errorCode,
      errorMessage: args.errorMessage,
      attemptCount: args.attemptCount,
      occurredAt: new Date(),
    };

    let pending = pendingSequenceDigests.get(sequence.id);
    if (!pending) {
      pending = {
        sequence: { id: sequence.id, orgId: sequence.orgId, name: sequence.name },
        failures: [],
        scheduledAt: new Date(),
        timer: null,
      };
      pendingSequenceDigests.set(sequence.id, pending);
      if (sequenceDigestIntervalMs > 0) {
        pending.timer = setTimeout(() => {
          flushSequenceFailureDigest(sequence.id).catch((e) =>
            console.error(
              `[marketing-failure-notify] scheduled digest flush failed for sequence=${sequence.id}:`,
              e,
            ),
          );
        }, sequenceDigestIntervalMs);
        // Don't keep the event loop alive just to fire a digest.
        if (typeof pending.timer.unref === "function") pending.timer.unref();
      }
    }
    pending.failures.push(failure);

    if (sequenceDigestIntervalMs <= 0) {
      const r = await flushSequenceFailureDigest(sequence.id);
      return {
        queued: false,
        notified: r?.notified ?? 0,
        failureCount: r?.failureCount ?? 0,
      };
    }

    return { queued: true, queuedFailures: pending.failures.length };
  } catch (e) {
    console.error(
      `[marketing-failure-notify] notifyAdminsOfSequenceStepPermanentFailure failed for sequence=${sequence.id}:`,
      e,
    );
    return null;
  }
}

/**
 * Process-wide pg advisory lock key for the quiet-hours flush. Hand-
 * allocated to not collide with other advisory locks in the codebase
 * (e.g. `marketing/scheduled-send.ts` uses 100007).
 */
const FLUSH_ADVISORY_LOCK_KEY = 100303;

/**
 * Task #303 — Periodic flush of `pending_admin_notifications`. Picks up
 * any rows whose `releaseAt` is in the past, attempts delivery via the
 * env SMTP fallback, and deletes them whether or not the send succeeded
 * (a hard SMTP failure here is no different from a hard SMTP failure on
 * the original immediate path — we log and move on rather than risk
 * looping forever on a poisonous row).
 *
 * Wrapped in a session-scoped pg advisory lock so multi-replica
 * deployments don't double-send: only the replica that wins the lock
 * does the flush; others see `null` and skip until the next interval.
 */
export async function flushPendingAdminNotifications(now: Date = new Date()): Promise<{
  attempted: number;
  delivered: number;
} | null> {
  // Session-scoped advisory lock must be acquired and released on the
  // same connection — see `runScheduledSendTick` for the full
  // explanation. We use `pool` here directly; in unit tests `pool` is
  // not exported via the db mock, so callers passing a custom
  // implementation skip the lock by triggering the catch path.
  let client: any;
  try {
    client = await pool.connect();
  } catch {
    // No real pool (typical in unit tests) — fall through and run
    // unlocked. Production always has a real pool.
    return await flushUnlocked(now);
  }
  try {
    const lockResult = await client.query(
      "SELECT pg_try_advisory_lock($1) AS acquired",
      [FLUSH_ADVISORY_LOCK_KEY],
    );
    if (!lockResult.rows[0]?.acquired) {
      // Another replica is flushing; skip until next interval.
      return null;
    }
    try {
      return await flushUnlocked(now);
    } finally {
      await client
        .query("SELECT pg_advisory_unlock($1)", [FLUSH_ADVISORY_LOCK_KEY])
        .catch((e: unknown) =>
          console.error(
            "[marketing-failure-notify] advisory unlock failed:",
            e,
          ),
        );
    }
  } finally {
    try {
      client.release?.();
    } catch (e) {
      console.error("[marketing-failure-notify] client release failed:", e);
    }
  }
}

async function flushUnlocked(now: Date): Promise<{
  attempted: number;
  delivered: number;
}> {
  const due = await db
    .select()
    .from(pendingAdminNotifications)
    .where(lte(pendingAdminNotifications.releaseAt, now));

  if (due.length === 0) return { attempted: 0, delivered: 0 };

  const transporter = await createEnvTransporter();
  if (!transporter) {
    console.warn(
      `[marketing-failure-notify] flush: env SMTP fallback not configured — leaving ${due.length} pending row(s) for next interval`,
    );
    return { attempted: 0, delivered: 0 };
  }

  const from = fromAddress();
  let delivered = 0;
  for (const row of due) {
    try {
      await transporter.sendMail({
        from,
        to: row.recipientEmail,
        subject: row.subject,
        html: row.html,
        text: row.bodyText,
      });
      delivered++;
      console.log(
        `[marketing-failure-notify] flushed buffered ${row.contextTag} → ${row.recipientEmail}`,
      );
    } catch (e) {
      console.error(
        `[marketing-failure-notify] flush failed for admin=${row.recipientEmail} (${row.contextTag}):`,
        e,
      );
    }
    // Always delete: see docstring — we don't loop on poisonous rows.
    try {
      await db
        .delete(pendingAdminNotifications)
        .where(eq(pendingAdminNotifications.id, row.id));
    } catch (e) {
      console.error(
        `[marketing-failure-notify] failed to delete buffered row id=${row.id}:`,
        e,
      );
    }
  }

  return { attempted: due.length, delivered };
}

let pendingFlushInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the periodic quiet-hours flush. Runs every minute so admins
 * receive their buffered digest within ~1 minute of their window
 * ending. Idempotent.
 */
export function startPendingAdminNotificationProcessor(): void {
  if (pendingFlushInterval) return;
  const intervalMs = 60_000;
  pendingFlushInterval = setInterval(() => {
    flushPendingAdminNotifications().catch((e) =>
      console.error("[marketing-failure-notify] flush interval failed:", e),
    );
  }, intervalMs);
  // One-shot flush shortly after boot so a release_at that elapsed
  // while the process was down doesn't wait a full minute.
  setTimeout(() => {
    flushPendingAdminNotifications().catch((e) =>
      console.error("[marketing-failure-notify] flush (boot) failed:", e),
    );
  }, 15_000).unref();
  console.log(
    "[marketing-failure-notify] quiet-hours flush processor started (60s interval)",
  );
}

export function stopPendingAdminNotificationProcessor(): void {
  if (pendingFlushInterval) {
    clearInterval(pendingFlushInterval);
    pendingFlushInterval = null;
  }
}
