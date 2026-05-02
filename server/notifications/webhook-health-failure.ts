/**
 * Task #285 — Out-of-band notification when an org's email-alert webhook
 * has failed N consecutive auto-tests in a row.
 *
 * The auto-test loop in `webhook-health-check.ts` increments a per-org
 * consecutive_failure_count on every failed tick and resets it on
 * success. Once the streak reaches the configured threshold this module
 * emails opted-in admins so they learn about the breakage even if they
 * never visit the email-health page. `failure_alert_sent_at` is stamped
 * at the same time so we only send one email per breakage instead of
 * every subsequent tick — a fresh success clears it, and the next
 * breakage can alert again.
 *
 * Sends use the env-level SMTP fallback so they still go out when the
 * org's own mailbox is broken (which is exactly the situation a webhook
 * outage often reflects). Failures here are swallowed and logged so a
 * notification problem cannot mask the underlying webhook outage.
 */
import { db } from "../db";
import {
  orgs,
  users,
  notificationPreferences,
} from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
import { createEnvTransporter } from "../email/smtp-transport";

interface AdminRow {
  email: string;
  name: string | null;
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
        eq(users.orgId, orgId),
        eq(users.role, "ADMIN"),
        eq(users.isActive, true),
        sql`${users.email} IS NOT NULL AND ${users.email} <> ''`,
        sql`COALESCE(${notificationPreferences.systemUpdates}, true) = true`,
      ),
    );
  return {
    admins: admins.map((a) => ({ email: a.email!, name: a.name ?? null })),
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

/**
 * Build the subject/html/text tuple for the auto-test failure alert.
 * Pure for testability.
 */
export function buildWebhookFailureAlertEmail(args: {
  orgName: string;
  webhookHost: string;
  consecutiveFailureCount: number;
  lastError: string | null;
}): { subject: string; html: string; text: string } {
  const { orgName, webhookHost, consecutiveFailureCount, lastError } = args;
  const subject = `Email-alert webhook for ${orgName} has failed ${consecutiveFailureCount} auto-tests in a row`;
  const safeErr = escapeHtml(lastError ?? "");
  const html = `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1a2e;background:#f8f9fa;padding:24px">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e5ec;border-radius:8px;padding:32px">
<h2 style="margin:0 0 12px;color:#cf3339">Email alert webhook is broken</h2>
<p style="margin:0 0 16px;color:#555770">
The configured email-alert webhook for <strong>${escapeHtml(orgName)}</strong>
(<code>${escapeHtml(webhookHost)}</code>) has failed
<strong>${consecutiveFailureCount}</strong> automatic health checks in a row.
While it stays broken, real failure alerts will silently never reach you.
</p>
${safeErr
      ? `<p style="margin:0 0 4px;color:#8b8da3;font-size:12px">Last error:</p>
<pre style="margin:0 0 16px;padding:12px;background:#f3f3f7;border-radius:4px;color:#1a1a2e;font-size:12px;white-space:pre-wrap;word-break:break-word">${safeErr}</pre>`
      : ""}
<p style="margin:0;color:#555770">
Open the email-health page in the admin panel to inspect recent test
history, send a manual test, or update the webhook URL.
</p>
</div>
</body></html>`;
  const text =
    `The configured email-alert webhook for ${orgName} (${webhookHost}) has failed ` +
    `${consecutiveFailureCount} automatic health checks in a row. While it stays ` +
    `broken, real failure alerts will silently never reach you.\n\n` +
    (lastError ? `Last error: ${lastError}\n\n` : "") +
    `Open the email-health page in the admin panel to inspect recent test ` +
    `history, send a manual test, or update the webhook URL.`;
  return { subject, html, text };
}

async function sendToAdmins(
  admins: AdminRow[],
  subject: string,
  html: string,
  text: string,
  contextTag: string,
): Promise<number> {
  if (admins.length === 0) return 0;
  const transporter = await createEnvTransporter();
  if (!transporter) {
    console.warn(
      `[webhook-health-notify] env SMTP fallback not configured — ${contextTag} not delivered`,
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
        `[webhook-health-notify] ${contextTag} sent to admin=${admin.email}`,
      );
    } catch (e) {
      console.error(
        `[webhook-health-notify] failed to notify admin=${admin.email} (${contextTag}):`,
        e,
      );
    }
  }
  return sent;
}

/**
 * Notify org admins that the auto-test has failed N consecutive times.
 * Fire-and-forget: returns once the (best-effort) sends are scheduled.
 */
export async function notifyAdminsOfWebhookHealthBreakage(args: {
  orgId: string;
  webhookUrl: string;
  consecutiveFailureCount: number;
  lastError: string | null;
}): Promise<{ notified: number } | null> {
  try {
    const { admins, orgName } = await loadOptedInAdmins(args.orgId);
    if (admins.length === 0) {
      console.warn(
        `[webhook-health-notify] org=${args.orgId} has ` +
          `${args.consecutiveFailureCount} consecutive failures but no opted-in admins`,
      );
      return { notified: 0 };
    }
    let webhookHost = args.webhookUrl;
    try {
      webhookHost = new URL(args.webhookUrl).host;
    } catch {
      // fall through with the raw URL
    }
    const { subject, html, text } = buildWebhookFailureAlertEmail({
      orgName,
      webhookHost,
      consecutiveFailureCount: args.consecutiveFailureCount,
      lastError: args.lastError,
    });
    const notified = await sendToAdmins(
      admins,
      subject,
      html,
      text,
      `webhook-health org=${args.orgId}`,
    );
    return { notified };
  } catch (e) {
    console.error(
      `[webhook-health-notify] notifyAdminsOfWebhookHealthBreakage failed for org=${args.orgId}:`,
      e,
    );
    return null;
  }
}
