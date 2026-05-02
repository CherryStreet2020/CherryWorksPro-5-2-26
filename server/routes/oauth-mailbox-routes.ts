import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { encryptSmtpPassword } from "../email";
import { isEmailOauthEnabled } from "../email/feature-flag";
import { signOauthState, verifyOauthState } from "../email/oauth-state";
import {
  getMsAuthorizeUrl,
  getMsTokenUrl,
  MS_GRAPH_SCOPES,
} from "../email/graph-transport";
import {
  GOOGLE_AUTHORIZE_URL,
  GOOGLE_TOKEN_URL,
  GMAIL_SCOPES,
} from "../email/gmail-transport";
import { requireAuth, requirePlatformOperator, isPlatformOperatorUserId } from "./middleware";
import { clearMailboxStatus } from "../email/mailbox-status";
import { rescanM365LegacyScopes } from "../email/m365-scope-rescan";
import { timingSafeEqual } from "crypto";

function getRedirectUri(req: Request, provider: "microsoft" | "google"): string {
  const envVar =
    provider === "microsoft"
      ? process.env.MS_OAUTH_REDIRECT_URI
      : process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (envVar) return envVar;
  // Derive from request: protocol + host + canonical path.
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}/api/auth/oauth/${provider}/callback`;
}

function decodeIdTokenClaims(idToken: string): { email?: string; preferred_username?: string } | null {
  try {
    const parts = idToken.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

// Token-endpoint failure bodies do NOT contain access/refresh/id tokens
// (those only appear in 200-OK success responses), so widening the slice
// here cannot leak secrets. The 1500 cap is a sanity bound against
// pathological provider responses; real Google/Microsoft errors are <800 chars.
function formatTokenExchangeError(text: string): string {
  try {
    const j = JSON.parse(text);
    if (j && typeof j.error_description === "string") {
      const prefix = typeof j.error === "string" ? `${j.error}: ` : "";
      return `${prefix}${j.error_description}`.slice(0, 1500);
    }
    if (j && typeof j.error === "string") {
      return j.error.slice(0, 1500);
    }
  } catch {
    // not JSON, fall through
  }
  return text.slice(0, 1500);
}

function renderClosePopupHtml(nonce: string, provider: "m365" | "google", success: boolean, errorMessage?: string): string {
  const status = success ? "success" : "error";
  const safeMsg = (errorMessage || "").replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Mailbox connect</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:32px;text-align:center;color:#1a1a2e">
<h2 style="margin:0 0 12px">${success ? "Mailbox connected" : "Connection failed"}</h2>
<p style="color:#555770;margin:0 0 24px">${success ? "You can close this window." : safeMsg || "Please try again."}</p>
<script nonce="${nonce}">
(function(){
  var msg = {type:"oauth-mailbox-${status}",provider:"${provider}"${errorMessage ? `,error:"${safeMsg}"` : ""}};
  // BroadcastChannel: same-origin, immune to COOP isolation. Primary fast path.
  try {
    if (typeof BroadcastChannel !== "undefined") {
      var bc = new BroadcastChannel("oauth-mailbox");
      bc.postMessage(msg);
      try { bc.close(); } catch(e) {}
    }
  } catch(e) {}
  // postMessage fallback for older browsers; may be silently dropped under COOP.
  try {
    if (window.opener) {
      window.opener.postMessage(msg, "*");
    }
  } catch(e) {}
  setTimeout(function(){ try { window.close(); } catch(e){} }, 800);
})();
</script>
</body></html>`;
}

export function registerOauthMailboxRoutes(app: Express): void {
  // ============================================================
  // Read endpoint: provider status (used by the Settings UI).
  // Never returns the refresh token itself.
  // ============================================================
  app.get("/api/org/email-provider", requireAuth, async (req, res) => {
    try {
      const orgId = req.session.orgId!;
      const org = await storage.getOrg(orgId);
      if (!org) return res.status(404).json({ message: "Org not found" });
      return res.json({
        providerType: (org as any).emailProviderType ?? "smtp",
        senderAddress: (org as any).emailSenderAddress ?? null,
        isConnected: !!(org as any).emailOauthRefreshToken,
        connectedAt: (org as any).emailOauthConnectedAt ?? null,
        scopes: (org as any).emailOauthScopes ?? null,
        oauthFlagEnabled: isEmailOauthEnabled(),
        status: (org as any).emailOauthStatus ?? "ok",
        // When status is "ok" we hide lastErrorAt — the column is preserved
        // across reconnect to anchor the 24h notification cooldown, so it
        // would otherwise read as a stale "current error" in the UI.
        lastErrorAt: ((org as any).emailOauthStatus === "needs_reconnect")
          ? ((org as any).emailOauthLastErrorAt ?? null)
          : null,
        lastErrorMessage: (org as any).emailOauthLastErrorMessage ?? null,
        failedSendCount: (org as any).emailOauthFailedSendCount ?? 0,
      });
    } catch (e: any) {
      return res.status(500).json({ message: e.message ?? "Failed to load email provider" });
    }
  });

  // ============================================================
  // Update endpoint: switch provider type. Does NOT touch tokens.
  // ============================================================
  app.put("/api/org/email-provider", requireAuth, async (req, res) => {
    try {
      const orgId = req.session.orgId!;
      const { providerType } = req.body ?? {};
      if (!["smtp", "m365", "google"].includes(providerType)) {
        return res.status(400).json({ message: "providerType must be one of smtp|m365|google" });
      }
      await storage.updateOrg(orgId, { emailProviderType: providerType } as any);
      return res.json({ ok: true, providerType });
    } catch (e: any) {
      return res.status(500).json({ message: e.message ?? "Failed to update provider" });
    }
  });

  // ============================================================
  // Disconnect: clear refresh token + connected timestamp.
  // ============================================================
  app.delete("/api/org/email-provider/oauth", requireAuth, async (req, res) => {
    try {
      const orgId = req.session.orgId!;
      await storage.updateOrg(orgId, {
        emailOauthRefreshToken: null,
        emailOauthExpiresAt: null,
        emailOauthScopes: null,
        emailOauthConnectedAt: null,
        emailSenderAddress: null,
      } as any);
      // Disconnect intentionally — no banner to show.
      await clearMailboxStatus(orgId);
      return res.json({ ok: true });
    } catch (e: any) {
      return res.status(500).json({ message: e.message ?? "Failed to disconnect" });
    }
  });

  // ============================================================
  // Microsoft OAuth start
  // ============================================================
  app.get("/api/auth/oauth/microsoft/start", requireAuth, (req, res) => {
    if (!isEmailOauthEnabled()) {
      return res.status(404).json({ message: "OAuth mailbox flow disabled (EMAIL_OAUTH_ENABLED)" });
    }
    const clientId = process.env.MS_OAUTH_CLIENT_ID;
    if (!clientId) {
      return res.status(500).json({ message: "MS_OAUTH_CLIENT_ID not configured" });
    }
    const state = signOauthState({
      orgId: req.session.orgId!,
      userId: req.session.userId!,
      provider: "m365",
    });
    const redirectUri = getRedirectUri(req, "microsoft");
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      response_mode: "query",
      scope: MS_GRAPH_SCOPES.join(" "),
      state,
      prompt: "select_account",
    });
    return res.redirect(`${getMsAuthorizeUrl()}?${params.toString()}`);
  });

  // ============================================================
  // Microsoft OAuth callback
  // ============================================================
  app.get("/api/auth/oauth/microsoft/callback", async (req, res) => {
    if (!isEmailOauthEnabled()) {
      return res.status(404).type("html").send(renderClosePopupHtml((res as any).cspNonce, "m365", false, "OAuth disabled"));
    }
    try {
      const { code, state, error, error_description } = req.query;
      if (error) {
        return res.type("html").send(
          renderClosePopupHtml((res as any).cspNonce, "m365", false, String(error_description || error)),
        );
      }
      if (typeof code !== "string" || typeof state !== "string") {
        return res.status(400).type("html").send(renderClosePopupHtml((res as any).cspNonce, "m365", false, "Missing code or state"));
      }
      const payload = verifyOauthState(state);
      if (!payload || payload.provider !== "m365") {
        return res.status(400).type("html").send(renderClosePopupHtml((res as any).cspNonce, "m365", false, "Invalid or expired state"));
      }

      const clientId = process.env.MS_OAUTH_CLIENT_ID;
      const clientSecret = process.env.MS_OAUTH_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        return res.status(500).type("html").send(
          renderClosePopupHtml((res as any).cspNonce, "m365", false, "Server missing MS_OAUTH credentials"),
        );
      }

      const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: getRedirectUri(req, "microsoft"),
        scope: MS_GRAPH_SCOPES.join(" "),
      });

      const tokenRes = await fetch(getMsTokenUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });

      if (!tokenRes.ok) {
        const text = await tokenRes.text().catch(() => "");
        return res.status(502).type("html").send(
          renderClosePopupHtml((res as any).cspNonce, "m365", false, `Token exchange failed: ${formatTokenExchangeError(text)}`),
        );
      }
      const tokenJson = (await tokenRes.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        scope?: string;
        id_token?: string;
      };
      if (!tokenJson.refresh_token) {
        return res.status(502).type("html").send(
          renderClosePopupHtml((res as any).cspNonce, "m365", false, "No refresh_token in token response"),
        );
      }

      // Resolve the connected mailbox address from id_token claims.
      // The OIDC scopes (openid email profile) cause Azure AD to return an
      // id_token alongside the access/refresh tokens; its `email` /
      // `preferred_username` claims identify the user without requiring
      // the broader User.Read Graph permission.
      let senderAddress: string | null = null;
      if (tokenJson.id_token) {
        const claims = decodeIdTokenClaims(tokenJson.id_token);
        if (claims) {
          senderAddress = claims.email || claims.preferred_username || null;
        }
      }

      await storage.updateOrg(payload.orgId, {
        emailProviderType: "m365",
        emailOauthRefreshToken: encryptSmtpPassword(tokenJson.refresh_token),
        emailOauthExpiresAt: new Date(Date.now() + (tokenJson.expires_in ?? 3600) * 1000),
        emailOauthScopes: tokenJson.scope ?? MS_GRAPH_SCOPES.join(" "),
        emailSenderAddress: senderAddress,
        emailOauthConnectedAt: new Date(),
      } as any);
      // Fresh refresh token supersedes any prior failure — clear the banner.
      await clearMailboxStatus(payload.orgId);

      return res.type("html").send(renderClosePopupHtml((res as any).cspNonce, "m365", true));
    } catch (e: any) {
      return res.status(500).type("html").send(
        renderClosePopupHtml((res as any).cspNonce, "m365", false, e?.message ?? "Unexpected error"),
      );
    }
  });

  // ============================================================
  // Google OAuth start
  // ============================================================
  app.get("/api/auth/oauth/google/start", requireAuth, (req, res) => {
    if (!isEmailOauthEnabled()) {
      return res.status(404).json({ message: "OAuth mailbox flow disabled (EMAIL_OAUTH_ENABLED)" });
    }
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    if (!clientId) {
      return res.status(500).json({ message: "GOOGLE_OAUTH_CLIENT_ID not configured" });
    }
    const state = signOauthState({
      orgId: req.session.orgId!,
      userId: req.session.userId!,
      provider: "google",
    });
    const redirectUri = getRedirectUri(req, "google");
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: GMAIL_SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      state,
    });
    return res.redirect(`${GOOGLE_AUTHORIZE_URL}?${params.toString()}`);
  });

  // ============================================================
  // Google OAuth callback
  // ============================================================
  app.get("/api/auth/oauth/google/callback", async (req, res) => {
    if (!isEmailOauthEnabled()) {
      return res.status(404).type("html").send(renderClosePopupHtml((res as any).cspNonce, "google", false, "OAuth disabled"));
    }
    try {
      const { code, state, error } = req.query;
      if (error) {
        return res.type("html").send(renderClosePopupHtml((res as any).cspNonce, "google", false, String(error)));
      }
      if (typeof code !== "string" || typeof state !== "string") {
        return res.status(400).type("html").send(renderClosePopupHtml((res as any).cspNonce, "google", false, "Missing code or state"));
      }
      const payload = verifyOauthState(state);
      if (!payload || payload.provider !== "google") {
        return res.status(400).type("html").send(renderClosePopupHtml((res as any).cspNonce, "google", false, "Invalid or expired state"));
      }

      const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        return res.status(500).type("html").send(
          renderClosePopupHtml((res as any).cspNonce, "google", false, "Server missing GOOGLE_OAUTH credentials"),
        );
      }

      const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: getRedirectUri(req, "google"),
      });

      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });

      if (!tokenRes.ok) {
        const text = await tokenRes.text().catch(() => "");
        return res.status(502).type("html").send(
          renderClosePopupHtml((res as any).cspNonce, "google", false, `Token exchange failed: ${formatTokenExchangeError(text)}`),
        );
      }
      const tokenJson = (await tokenRes.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        scope?: string;
        id_token?: string;
      };
      if (!tokenJson.refresh_token) {
        return res.status(502).type("html").send(
          renderClosePopupHtml(
            (res as any).cspNonce,
            "google",
            false,
            "No refresh_token returned. The user may have already consented; revoke at https://myaccount.google.com/permissions and retry.",
          ),
        );
      }

      // Decode id_token for the email claim (no signature verify needed —
      // we just received it over TLS from Google's token endpoint).
      let senderAddress: string | null = null;
      if (tokenJson.id_token) {
        try {
          const parts = tokenJson.id_token.split(".");
          if (parts.length === 3) {
            const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
            senderAddress = claims.email || null;
          }
        } catch {
          // non-fatal
        }
      }

      await storage.updateOrg(payload.orgId, {
        emailProviderType: "google",
        emailOauthRefreshToken: encryptSmtpPassword(tokenJson.refresh_token),
        emailOauthExpiresAt: new Date(Date.now() + (tokenJson.expires_in ?? 3600) * 1000),
        emailOauthScopes: tokenJson.scope ?? GMAIL_SCOPES.join(" "),
        emailSenderAddress: senderAddress,
        emailOauthConnectedAt: new Date(),
      } as any);
      await clearMailboxStatus(payload.orgId);

      return res.type("html").send(renderClosePopupHtml((res as any).cspNonce, "google", true));
    } catch (e: any) {
      return res.status(500).type("html").send(
        renderClosePopupHtml((res as any).cspNonce, "google", false, e?.message ?? "Unexpected error"),
      );
    }
  });

  // ============================================================
  // One-shot operator maintenance: scan ALL M365 mailboxes whose
  // stored OAuth scopes still include the legacy `User.Read`
  // permission and optionally email those orgs' admins to reconnect.
  //
  // Sprint 2g.12 tightened the scope set; orgs connected before that
  // change still record `User.Read` against `orgs.email_oauth_scopes`
  // until they manually disconnect and reconnect. Background sweep in
  // refreshGraphAccessToken corrects the column once the user actually
  // re-consents; this endpoint is the nudge to make that happen.
  //
  // SECURITY: this endpoint reads cross-tenant org rows and can fire
  // emails into other tenants' admin inboxes, so it is gated to
  // platform operators only via a shared INTERNAL_MAINTENANCE_TOKEN
  // env var (constant-time compared). Tenant-scoped admin role is
  // intentionally NOT sufficient — a regular org admin must not be
  // able to enumerate or notify other orgs. If the env var is not set
  // the endpoint reports 404 so the route does not exist in misconfig.
  //
  // Default is a dry run that returns the affected list. Pass
  // `{ "notify": true }` in the JSON body to actually send the
  // reconnect-needed email to each org's admins.
  // ============================================================
  app.post("/api/admin/email/m365-rescope", async (req, res) => {
    const expected = process.env.INTERNAL_MAINTENANCE_TOKEN;
    if (!expected) {
      return res.status(404).json({ message: "Not found" });
    }
    const provided = (req.headers["x-internal-maintenance-token"] as string | undefined) ?? "";
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    const ok = a.length === b.length && timingSafeEqual(a, b);
    if (!ok) {
      return res.status(404).json({ message: "Not found" });
    }
    try {
      const notify = req.body?.notify === true;
      const result = await rescanM365LegacyScopes({ notify });
      return res.json(result);
    } catch (e: any) {
      console.error("[email] m365-rescope endpoint failed:", e);
      return res.status(500).json({ message: e?.message ?? "Rescan failed" });
    }
  });

  // ============================================================
  // In-app, platform-operator-gated counterparts to the
  // INTERNAL_MAINTENANCE_TOKEN endpoint above. These let an operator
  // run the cross-org dry-run scan and trigger the reconnect-needed
  // notification fan-out from the Replit UI without ever sending the
  // shared maintenance token to the browser.
  //
  // Gating: `requirePlatformOperator` checks the logged-in user's email
  // against the `PLATFORM_OPERATOR_EMAILS` allow-list (env var). When
  // the env var is unset the routes 404, mirroring the token endpoint
  // above so misconfig fails closed. Tenant ADMIN role is intentionally
  // NOT sufficient — these endpoints touch other tenants' rows.
  //
  // Both endpoints write an audit_logs entry under the operator's own
  // org/userId so the action is attributable.
  // ============================================================
  app.get(
    "/api/admin/email/m365-rescope/scan",
    requirePlatformOperator,
    async (req, res) => {
      try {
        const result = await rescanM365LegacyScopes({ notify: false });
        try {
          await storage.createAuditLog({
            orgId: req.session.orgId!,
            userId: req.session.userId!,
            action: "M365_LEGACY_SCOPE_SCAN",
            entityType: "platform_maintenance",
            entityId: "m365-rescope",
            details: { scanned: result.scanned, affectedOrgIds: result.affected.map((a) => a.id) },
          });
        } catch (logErr) {
          console.error("[email] m365-rescope scan audit log failed:", logErr);
        }
        return res.json(result);
      } catch (e: any) {
        console.error("[email] m365-rescope scan failed:", e);
        return res.status(500).json({ message: e?.message ?? "Scan failed" });
      }
    },
  );

  app.post(
    "/api/admin/email/m365-rescope/notify",
    requirePlatformOperator,
    async (req, res) => {
      try {
        const result = await rescanM365LegacyScopes({ notify: true });
        try {
          await storage.createAuditLog({
            orgId: req.session.orgId!,
            userId: req.session.userId!,
            action: "M365_LEGACY_SCOPE_NOTIFY",
            entityType: "platform_maintenance",
            entityId: "m365-rescope",
            details: {
              scanned: result.scanned,
              affectedOrgIds: result.affected.map((a) => a.id),
              notified: result.notified,
            },
          });
        } catch (logErr) {
          console.error("[email] m365-rescope notify audit log failed:", logErr);
        }
        return res.json(result);
      } catch (e: any) {
        console.error("[email] m365-rescope notify failed:", e);
        return res.status(500).json({ message: e?.message ?? "Notify failed" });
      }
    },
  );

  // Lightweight capability probe so the SPA can decide whether to render
  // the operator-only page. Always 200 — returns `{ isPlatformOperator:
  // false }` for non-operators and unauthenticated requests so we don't
  // signal route existence to scanners.
  app.get("/api/auth/me/platform-operator", async (req, res) => {
    const ok = await isPlatformOperatorUserId(req.session?.userId);
    return res.json({ isPlatformOperator: ok });
  });
}
