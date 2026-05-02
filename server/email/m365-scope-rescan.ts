import { db } from "../db";
import { orgs, users, notificationPreferences } from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
import { createEnvTransporter } from "./smtp-transport";

/**
 * Sprint 2g.12 follow-up.
 *
 * Find every org currently connected via Microsoft 365 whose stored
 * `emailOauthScopes` still contains `User.Read` — the legacy scope from
 * before we tightened the OAuth request to the OIDC minimum
 * (`offline_access Mail.Send openid email profile`). These orgs were
 * connected before the tightening change; the column is the last record of
 * the consent grant Microsoft sees, and it will read as stale until the
 * admin reconnects.
 *
 * `refreshGraphAccessToken` will quietly bring the column in line with the
 * live grant on the next successful refresh, but only after the user has
 * actually re-consented. Until then we want to nudge the admin in-app and
 * via email so the Microsoft Publisher Verification audit doesn't see a
 * lingering `User.Read` consent.
 */
export interface M365LegacyScopeOrg {
  id: string;
  name: string;
  scopes: string;
  connectedAt: Date | null;
}

export async function findM365OrgsWithLegacyScopes(): Promise<M365LegacyScopeOrg[]> {
  const rows = await db
    .select({
      id: orgs.id,
      name: orgs.name,
      scopes: orgs.emailOauthScopes,
      connectedAt: orgs.emailOauthConnectedAt,
      refreshToken: orgs.emailOauthRefreshToken,
    })
    .from(orgs)
    .where(
      and(
        eq(orgs.emailProviderType, "m365"),
        sql`${orgs.emailOauthScopes} ILIKE '%user.read%'`,
      ),
    );

  return rows
    .filter((r) => !!r.refreshToken && !!r.scopes)
    .map((r) => ({
      id: r.id,
      name: r.name,
      scopes: r.scopes!,
      connectedAt: r.connectedAt,
    }));
}

/**
 * Send a "please reconnect" nudge email to every active admin of `orgId`
 * who hasn't opted out of mailbox alerts. Uses the env-level SMTP fallback
 * — the org's own M365 mailbox is the thing we want changed, so we cannot
 * rely on it to deliver this message.
 *
 * Returns the count of admins emailed (0 if none were eligible or no env
 * SMTP transport is configured).
 */
export async function notifyOrgAdminsOfLegacyScope(
  org: M365LegacyScopeOrg,
): Promise<number> {
  const admins = await db
    .select({
      email: users.email,
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
        eq(users.orgId, org.id),
        eq(users.role, "ADMIN"),
        eq(users.isActive, true),
        sql`${users.email} IS NOT NULL AND ${users.email} <> ''`,
        sql`COALESCE(${notificationPreferences.mailboxAlerts}, true) = true`,
      ),
    );

  if (admins.length === 0) {
    console.warn(
      `[email] m365 legacy-scope nudge: no eligible admins for org=${org.id}`,
    );
    return 0;
  }

  const transporter = await createEnvTransporter();
  if (!transporter) {
    console.warn(
      `[email] m365 legacy-scope nudge: env SMTP fallback not configured — skipping org=${org.id}`,
    );
    return 0;
  }

  const subject = `Action needed: reconnect your Microsoft 365 mailbox`;
  const safeOrg = org.name
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const html = `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1a2e;background:#f8f9fa;padding:24px">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e5ec;border-radius:8px;padding:32px">
<h2 style="margin:0 0 12px;color:#1a1a2e">Reconnect your Microsoft 365 mailbox</h2>
<p style="margin:0 0 16px;color:#555770">
We tightened our Microsoft permissions request and no longer need
<strong>User.Read</strong> on your <strong>${safeOrg}</strong> mailbox.
The original consent for that permission is still on file with Microsoft
until an admin reconnects, which drops it.
</p>
<p style="margin:0 0 16px;color:#555770">Email sending will keep working
in the meantime — this is a one-time cleanup so the consent record matches
the permissions we actually use.</p>
<ol style="margin:0 0 16px 20px;color:#555770;line-height:1.6">
<li>Sign in to CherryWorks Pro as an admin.</li>
<li>Go to <strong>Settings → Email</strong>.</li>
<li>Click <strong>Reconnect Microsoft 365</strong> and complete the sign-in.</li>
</ol>
</div>
</body></html>`;

  const text =
    `We tightened our Microsoft permissions request and no longer need ` +
    `User.Read on your ${org.name} mailbox. The original consent is still ` +
    `on file with Microsoft until an admin reconnects, which drops it.\n\n` +
    `Email sending will keep working in the meantime — this is a one-time ` +
    `cleanup so the consent record matches what we actually use.\n\n` +
    `To fix it: sign in to CherryWorks Pro as an admin, go to Settings → ` +
    `Email, and click "Reconnect Microsoft 365".`;

  const fromAddr = process.env.SMTP_FROM_EMAIL
    ? `"CherryWorks Pro" <${process.env.SMTP_FROM_EMAIL}>`
    : process.env.SMTP_USER
      ? `"CherryWorks Pro" <${process.env.SMTP_USER}>`
      : '"CherryWorks Pro" <noreply@cherrystconsulting.com>';

  let sent = 0;
  for (const admin of admins) {
    try {
      await transporter.sendMail({ from: fromAddr, to: admin.email, subject, html, text });
      sent++;
      console.log(
        `[email] m365 legacy-scope nudge sent to admin=${admin.email} org=${org.id}`,
      );
    } catch (e) {
      console.error(
        `[email] m365 legacy-scope nudge failed for admin=${admin.email} org=${org.id}:`,
        e,
      );
    }
  }
  return sent;
}

export interface RescanResult {
  scanned: number;
  affected: M365LegacyScopeOrg[];
  notified: { orgId: string; orgName: string; adminsEmailed: number }[];
  dryRun: boolean;
}

/**
 * One-shot maintenance entry point. Pass `notify: true` to actually send
 * emails; otherwise returns the list of affected orgs without side effects.
 */
export async function rescanM365LegacyScopes(
  opts: { notify?: boolean } = {},
): Promise<RescanResult> {
  const affected = await findM365OrgsWithLegacyScopes();
  const notified: RescanResult["notified"] = [];

  if (opts.notify) {
    for (const org of affected) {
      const count = await notifyOrgAdminsOfLegacyScope(org);
      notified.push({ orgId: org.id, orgName: org.name, adminsEmailed: count });
    }
  }

  return {
    scanned: affected.length,
    affected,
    notified,
    dryRun: !opts.notify,
  };
}
