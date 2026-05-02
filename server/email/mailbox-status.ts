import { db } from "../db";
import { orgs, users, notificationPreferences } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { createEnvTransporter } from "./smtp-transport";
import { invalidateCachedAccessToken } from "./oauth-token-cache";

/**
 * Minimum time between admin reconnect-needed emails for a single org.
 * Prevents spamming admins when a reconnect attempt immediately re-fails
 * (bad new token, same revoked refresh token re-stored, etc.). Tracked via
 * `orgs.email_oauth_last_error_at`, which is preserved across
 * `clearMailboxStatus` so the cooldown survives a reconnect.
 */
export const RECONNECT_NOTIFY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export type MailboxOauthStatus = "ok" | "needs_reconnect";

export interface MailboxFailureContext {
  orgId: string;
  providerType: "m365" | "google";
  errorMessage: string;
}

/**
 * Heuristic to decide whether a Graph/Gmail error is auth-class (refresh token
 * revoked, consent withdrawn, invalid_grant, repeated 401, etc.) vs a transient
 * network / service error. Auth-class errors require admin reconnection — we
 * mark the mailbox as `needs_reconnect` so the selector short-circuits future
 * sends and so we can show a banner / send a notification email.
 */
export function isOauthAuthError(message: string): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes("invalid_grant") ||
    m.includes("invalid grant") ||
    m.includes("token has been expired") ||
    m.includes("token has been revoked") ||
    m.includes("consent_required") ||
    m.includes("interaction_required") ||
    m.includes("aadsts50173") ||
    m.includes("aadsts70008") ||
    m.includes("aadsts700082") ||
    m.includes("aadsts700084") ||
    m.includes("unauthorized_client") ||
    /\b401\b/.test(m)
  );
}

/**
 * Mark a mailbox as needing reconnection. Idempotent: if the org is already
 * marked needs_reconnect we just bump the counter and keep the original
 * notification timestamp so we don't spam admins on every retry.
 *
 * Returns true when a fresh notification email should be sent (i.e. this is
 * the first failure since the last successful reconnect).
 */
export async function markMailboxNeedsReconnect(
  ctx: MailboxFailureContext,
): Promise<{ firstFailure: boolean; failedSendCount: number }> {
  const [prev] = await db
    .select({
      status: orgs.emailOauthStatus,
      count: orgs.emailOauthFailedSendCount,
      name: orgs.name,
      lastErrorAt: orgs.emailOauthLastErrorAt,
    })
    .from(orgs)
    .where(eq(orgs.id, ctx.orgId));

  const wasOk = !prev || prev.status !== "needs_reconnect";
  const newCount = (prev?.count ?? 0) + 1;
  const now = new Date();

  await db
    .update(orgs)
    .set({
      emailOauthStatus: "needs_reconnect",
      emailOauthLastErrorAt: now,
      emailOauthLastErrorMessage: ctx.errorMessage.slice(0, 500),
      emailOauthFailedSendCount: newCount,
    })
    .where(eq(orgs.id, ctx.orgId));

  // Cooldown: only fire a reconnect-needed notification if it has been at
  // least RECONNECT_NOTIFY_COOLDOWN_MS since the previous error timestamp.
  // `clearMailboxStatus` preserves `emailOauthLastErrorAt`, so this also
  // protects against the "reconnect → immediate re-fail → fresh email"
  // spam scenario.
  const prevLastErrorAt = prev?.lastErrorAt ? new Date(prev.lastErrorAt) : null;
  const cooldownExpired =
    !prevLastErrorAt ||
    now.getTime() - prevLastErrorAt.getTime() >= RECONNECT_NOTIFY_COOLDOWN_MS;

  if (wasOk && cooldownExpired) {
    notifyAdminsAsync(ctx, prev?.name ?? "your organization", newCount);
  } else if (wasOk && !cooldownExpired) {
    console.log(
      `[email] mailbox needs_reconnect for org=${ctx.orgId} but admin notification suppressed (cooldown, last error ${prevLastErrorAt?.toISOString()})`,
    );
  }

  return { firstFailure: wasOk, failedSendCount: newCount };
}

/**
 * Reset mailbox health to OK. Called from the OAuth callback after a fresh
 * refresh_token has been stored — the new credential supersedes the broken
 * one so we clear the banner and the failure counter. Also called by the
 * background recovery probe when a previously-failing refresh starts working
 * again on its own.
 */
export async function clearMailboxStatus(orgId: string): Promise<void> {
  // NOTE: `emailOauthLastErrorAt` is intentionally preserved (not nulled) so
  // the 24h reconnect-notification cooldown survives a reconnect. Without
  // this, an admin reconnecting with another bad token would immediately
  // trigger a fresh notification email on the next failed send. The status
  // flip to "ok" is what the UI / selector keys off; the timestamp is now
  // a cooldown anchor, not a "current error" indicator.
  await db
    .update(orgs)
    .set({
      emailOauthStatus: "ok",
      emailOauthLastErrorMessage: null,
      emailOauthFailedSendCount: 0,
    })
    .where(eq(orgs.id, orgId));
}

function providerLabel(p: "m365" | "google"): string {
  return p === "m365" ? "Microsoft 365" : "Gmail";
}

/**
 * Fire-and-forget notification to all admins of the org that their connected
 * mailbox stopped working. Uses the env-level SMTP fallback (which is
 * independent of the per-org OAuth mailbox that just failed) so the message
 * still goes out. Failures here are logged and swallowed — we do not want a
 * notification problem to mask the original send failure.
 */
function notifyAdminsAsync(
  ctx: MailboxFailureContext,
  orgName: string,
  failedSendCount: number,
): void {
  void (async () => {
    try {
      // Per-admin opt-out: respect notification_preferences.mailbox_alerts.
      // Admins with no row default to receiving the alert (LEFT JOIN +
      // COALESCE true).
      const admins = await db
        .select({
          email: users.email,
          name: users.name,
          mailboxAlerts: notificationPreferences.mailboxAlerts,
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
            eq(users.orgId, ctx.orgId),
            eq(users.role, "ADMIN"),
            eq(users.isActive, true),
            sql`${users.email} IS NOT NULL AND ${users.email} <> ''`,
            sql`COALESCE(${notificationPreferences.mailboxAlerts}, true) = true`,
          ),
        );

      if (admins.length === 0) {
        console.warn(
          `[email] mailbox needs_reconnect for org=${ctx.orgId} but no active opted-in admins to notify`,
        );
        return;
      }

      const transporter = await createEnvTransporter();
      if (!transporter) {
        console.warn(
          `[email] mailbox needs_reconnect for org=${ctx.orgId} but env SMTP fallback not configured — admins not emailed`,
        );
        return;
      }

      const provider = providerLabel(ctx.providerType);
      const subject = `Action needed: reconnect your ${provider} mailbox`;
      const safeMsg = ctx.errorMessage
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      const html = `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1a2e;background:#f8f9fa;padding:24px">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e5ec;border-radius:8px;padding:32px">
<h2 style="margin:0 0 12px;color:#cf3339">${provider} mailbox disconnected</h2>
<p style="margin:0 0 16px;color:#555770">
Hi there — CherryWorks Pro could not send email through the ${provider}
mailbox connected to <strong>${orgName}</strong>. ${failedSendCount === 1
        ? "1 send has failed"
        : `${failedSendCount} sends have failed`} so far. New invoice and
password-reset emails are paused until an admin reconnects the mailbox.
</p>
<p style="margin:0 0 16px;color:#555770">
This usually happens when a mailbox password changed, an admin revoked the
app's access, or the consent expired. To fix it:
</p>
<ol style="margin:0 0 16px 20px;color:#555770;line-height:1.6">
<li>Sign in to CherryWorks Pro as an admin.</li>
<li>Go to <strong>Settings → Email</strong>.</li>
<li>Click <strong>Reconnect ${provider}</strong> and complete the sign-in.</li>
</ol>
<p style="margin:0 0 8px;color:#8b8da3;font-size:12px">Last error from ${provider}:</p>
<pre style="margin:0;padding:12px;background:#f3f3f7;border-radius:4px;color:#1a1a2e;font-size:12px;white-space:pre-wrap;word-break:break-word">${safeMsg}</pre>
</div>
</body></html>`;

      const text = `${provider} mailbox disconnected for ${orgName}.\n\n` +
        `${failedSendCount} send${failedSendCount === 1 ? "" : "s"} have failed.\n\n` +
        `To fix it, sign in to CherryWorks Pro as an admin, go to Settings → Email, ` +
        `and click "Reconnect ${provider}".\n\n` +
        `Last error: ${ctx.errorMessage}`;

      const fromAddr = process.env.SMTP_FROM_EMAIL
        ? `"CherryWorks Pro" <${process.env.SMTP_FROM_EMAIL}>`
        : process.env.SMTP_USER
          ? `"CherryWorks Pro" <${process.env.SMTP_USER}>`
          : '"CherryWorks Pro" <noreply@cherrystconsulting.com>';

      for (const admin of admins) {
        try {
          await transporter.sendMail({
            from: fromAddr,
            to: admin.email,
            subject,
            html,
            text,
          });
          console.log(
            `[email] mailbox-needs-reconnect notification sent to admin=${admin.email} org=${ctx.orgId}`,
          );
        } catch (e) {
          console.error(
            `[email] failed to notify admin=${admin.email} org=${ctx.orgId} of mailbox failure:`,
            e,
          );
        }
      }
    } catch (e) {
      console.error(
        `[email] notifyAdminsAsync failed for org=${ctx.orgId}:`,
        e,
      );
    }
  })();
}

/**
 * Background recovery probe.
 *
 * For every org currently flagged `needs_reconnect`, attempt a lightweight
 * token refresh against the provider (Microsoft Graph or Google). If the
 * refresh succeeds, the underlying issue has resolved itself — a transient
 * 401, a re-granted consent, etc. — so we clear the mailbox status
 * automatically and the admin banner disappears without manual action.
 *
 * Failed refreshes do nothing here: the refresh functions themselves call
 * `markMailboxNeedsReconnect` on auth-class failures, and because the org is
 * already flagged the `firstFailure` check suppresses repeat admin emails.
 *
 * Provider transports are loaded lazily to avoid an import cycle
 * (graph-transport / gmail-transport already import from this file).
 */
export async function probeMailboxRecovery(): Promise<{
  probed: number;
  recovered: number;
}> {
  const candidates = await db
    .select({
      id: orgs.id,
      providerType: orgs.emailProviderType,
      refreshToken: orgs.emailOauthRefreshToken,
      scopes: orgs.emailOauthScopes,
      senderAddress: orgs.emailSenderAddress,
      status: orgs.emailOauthStatus,
    })
    .from(orgs)
    .where(eq(orgs.emailOauthStatus, "needs_reconnect"));

  if (candidates.length === 0) return { probed: 0, recovered: 0 };

  const { refreshGraphAccessToken } = await import("./graph-transport");
  const { refreshGoogleAccessToken } = await import("./gmail-transport");

  let recovered = 0;

  for (const row of candidates) {
    if (!row.refreshToken) continue;
    if (row.providerType !== "m365" && row.providerType !== "google") continue;

    const cacheKey = `${row.providerType === "m365" ? "m365" : "google"}:${row.id}`;
    invalidateCachedAccessToken(cacheKey);

    try {
      if (row.providerType === "m365") {
        await refreshGraphAccessToken({
          id: row.id,
          emailProviderType: "m365",
          emailOauthRefreshToken: row.refreshToken,
          emailOauthScopes: row.scopes,
          emailSenderAddress: row.senderAddress,
          emailOauthStatus: row.status,
        });
      } else {
        await refreshGoogleAccessToken({
          id: row.id,
          emailProviderType: "google",
          emailOauthRefreshToken: row.refreshToken,
          emailOauthScopes: row.scopes,
          emailSenderAddress: row.senderAddress,
          emailOauthStatus: row.status,
        });
      }
      await clearMailboxStatus(row.id);
      recovered++;
      console.log(
        `[email] mailbox auto-recovered: org=${row.id} provider=${row.providerType} — banner cleared`,
      );
    } catch (e: any) {
      // Auth-class errors will have already re-marked the org via the
      // refresh function's own failure path. Transient/network errors are
      // logged and we'll try again next interval.
      const msg = e?.message || String(e);
      if (!isOauthAuthError(msg)) {
        console.warn(
          `[email] recovery probe transient error org=${row.id} provider=${row.providerType}: ${msg.slice(0, 200)}`,
        );
      }
    }
  }

  return { probed: candidates.length, recovered };
}

let recoveryInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the periodic mailbox recovery probe. Runs every 15 minutes.
 * Idempotent — calling twice is a no-op.
 */
export function startMailboxRecoveryProcessor(): void {
  if (recoveryInterval) return;
  const intervalMs = 15 * 60 * 1000;
  // One-shot probe shortly after boot so banners can clear without
  // waiting a full interval if a previously-failing token is already
  // healthy again.
  setTimeout(() => {
    probeMailboxRecovery().catch((e) =>
      console.error("[email] mailbox recovery probe (boot) failed:", e),
    );
  }, 30_000).unref();
  recoveryInterval = setInterval(() => {
    probeMailboxRecovery().catch((e) =>
      console.error("[email] mailbox recovery probe failed:", e),
    );
  }, intervalMs);
  console.log("[email] mailbox recovery probe started (15min interval)");
}

export function stopMailboxRecoveryProcessor(): void {
  if (recoveryInterval) {
    clearInterval(recoveryInterval);
    recoveryInterval = null;
  }
}
