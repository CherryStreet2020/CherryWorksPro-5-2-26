import { decryptSmtpPassword } from "../email";
import {
  getCachedAccessToken,
  invalidateCachedAccessToken,
  setCachedAccessToken,
} from "./oauth-token-cache";
import type { EmailTransport, SendableMessage, SendResult } from "./types";
import { EmailTransportError, MissingMailboxError } from "./types";
import type { OrgForTransport } from "./transport-selector";
import { isOauthAuthError, markMailboxNeedsReconnect } from "./mailbox-status";
import { db } from "../db";
import { orgs } from "@shared/schema";
import { eq } from "drizzle-orm";

const HEADER_INJECTION_RE = /[\r\n\f\v\0]/;
const EMAIL_RE = /^[^\s@\r\n\f\v\0]+@[^\s@\r\n\f\v\0]+\.[^\s@\r\n\f\v\0]{2,}$/;

export const MS_GRAPH_SEND_URL = "https://graph.microsoft.com/v1.0/me/sendMail";

/**
 * Test/CI hook: when GRAPH_TRANSPORT_TEST_URL_OVERRIDE is set, route the
 * Graph sendMail call at the override origin so end-to-end specs can
 * validate the transport selector picks Graph without a real M365 tenant.
 * Only sendMail is affected — the upstream token endpoint is untouched and
 * still resolved via getMsTokenUrl(). Used by
 * e2e/email-oauth-happy-path.spec.ts (case E2).
 */
export function getGraphSendUrl(): string {
  return process.env.GRAPH_TRANSPORT_TEST_URL_OVERRIDE || MS_GRAPH_SEND_URL;
}

export function getMsTenant(): string {
  return process.env.MS_OAUTH_TENANT || "common";
}

export function getMsTokenUrl(): string {
  return `https://login.microsoftonline.com/${getMsTenant()}/oauth2/v2.0/token`;
}

export function getMsAuthorizeUrl(): string {
  return `https://login.microsoftonline.com/${getMsTenant()}/oauth2/v2.0/authorize`;
}

export const MS_GRAPH_SCOPES = ["offline_access", "Mail.Send", "openid", "email", "profile"];

function checkHeader(value: string, field: string): void {
  if (HEADER_INJECTION_RE.test(value)) {
    throw new EmailTransportError("graph", `Invalid ${field}: control characters not allowed`);
  }
}

function validateEmail(email: string): boolean {
  if (!email || email.length > 254) return false;
  return EMAIL_RE.test(email);
}

function fetchOverride(): typeof fetch {
  // Allows tests to inject a custom fetch via env-set hook; production uses global fetch.
  return (global as any).__emailTestFetch || fetch;
}

/**
 * Refresh an M365 access token using the org's stored encrypted refresh token.
 * Cached in-process for `expires_in - 60s`.
 */
export async function refreshGraphAccessToken(org: OrgForTransport): Promise<string> {
  if (!org.id) throw new EmailTransportError("graph", "org.id required for token refresh");
  if (!org.emailOauthRefreshToken) throw new MissingMailboxError("m365", org.id);

  const cacheKey = `m365:${org.id}`;
  const cached = getCachedAccessToken(cacheKey);
  if (cached) return cached;

  const clientId = process.env.MS_OAUTH_CLIENT_ID;
  const clientSecret = process.env.MS_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new EmailTransportError(
      "graph",
      "MS_OAUTH_CLIENT_ID / MS_OAUTH_CLIENT_SECRET not configured. Cannot refresh access token.",
    );
  }

  let refreshToken: string;
  try {
    refreshToken = decryptSmtpPassword(org.emailOauthRefreshToken);
  } catch (e) {
    throw new EmailTransportError("graph", "Failed to decrypt refresh token", e);
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope: MS_GRAPH_SCOPES.join(" "),
  });

  const res = await fetchOverride()(getMsTokenUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const detail = `Token refresh failed (${res.status}): ${text.slice(0, 200)}`;
    if (org.id && (res.status === 400 || res.status === 401 || isOauthAuthError(text))) {
      await markMailboxNeedsReconnect({
        orgId: org.id,
        providerType: "m365",
        errorMessage: detail,
      }).catch((e) => console.error("[email] markMailboxNeedsReconnect failed:", e));
    }
    throw new EmailTransportError("graph", detail);
  }

  const json = (await res.json()) as { access_token?: string; expires_in?: number; scope?: string };
  if (!json.access_token) {
    throw new EmailTransportError("graph", "Token refresh response missing access_token");
  }

  setCachedAccessToken(cacheKey, json.access_token, json.expires_in ?? 3600);

  // Sprint 2g.12 follow-up: opportunistically sync the stored scope string
  // with the live grant returned by Azure AD on each successful refresh.
  // Pre-tightening connects still record `User.Read` in `orgs.emailOauthScopes`
  // even after the user re-consents; this brings the column in line with
  // reality without waiting for a manual disconnect/reconnect. Fire-and-forget;
  // a DB hiccup must not break the send path.
  if (json.scope && json.scope !== org.emailOauthScopes) {
    const newScope = json.scope;
    void (async () => {
      try {
        await db.update(orgs).set({ emailOauthScopes: newScope }).where(eq(orgs.id, org.id!));
      } catch (e) {
        console.error(`[email] failed to sync emailOauthScopes for org=${org.id}:`, e);
      }
    })();
  }

  return json.access_token;
}

/**
 * Build the Graph sendMail JSON payload from a SendableMessage.
 */
export function buildGraphPayload(message: SendableMessage): Record<string, any> {
  const recipients = (addresses: string[]) =>
    addresses.map((a) => ({ emailAddress: { address: a } }));

  const attachments = (message.attachments ?? []).map((a) => ({
    "@odata.type": "#microsoft.graph.fileAttachment",
    name: a.filename,
    contentType: a.contentType || "application/octet-stream",
    contentBytes: a.content.toString("base64"),
  }));

  const payload: Record<string, any> = {
    message: {
      subject: message.subject,
      body: { contentType: "HTML", content: message.html },
      toRecipients: recipients([message.to]),
      ...(message.cc && message.cc.length > 0 ? { ccRecipients: recipients(message.cc) } : {}),
      ...(message.replyTo
        ? { replyTo: [{ emailAddress: { address: message.replyTo } }] }
        : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
    },
    saveToSentItems: true,
  };

  if (message.fromEmail) {
    payload.message.from = {
      emailAddress: {
        address: message.fromEmail,
        ...(message.fromName ? { name: message.fromName } : {}),
      },
    };
  }

  return payload;
}

export class GraphTransport implements EmailTransport {
  readonly kind = "graph" as const;
  constructor(private readonly org: OrgForTransport) {}

  async send(message: SendableMessage): Promise<SendResult> {
    if (!validateEmail(message.to)) {
      throw new EmailTransportError("graph", `Invalid to address: "${message.to}"`);
    }
    checkHeader(message.to, "to");
    checkHeader(message.subject, "subject");
    if (message.cc) message.cc.forEach((c) => checkHeader(c, "cc"));
    if (message.replyTo) checkHeader(message.replyTo, "replyTo");

    const payload = buildGraphPayload(message);
    const cacheKey = `m365:${this.org.id}`;

    let accessToken = await refreshGraphAccessToken(this.org);
    const sendUrl = getGraphSendUrl();
    let res = await fetchOverride()(sendUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    // 401 → invalidate cache, refresh once, retry once.
    if (res.status === 401) {
      invalidateCachedAccessToken(cacheKey);
      accessToken = await refreshGraphAccessToken(this.org);
      res = await fetchOverride()(sendUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    }

    // Graph returns 202 Accepted with empty body on success.
    if (res.status === 202) {
      const messageId = res.headers.get("x-ms-request-id") || `graph-${Date.now()}`;
      console.log(
        `[email] Graph sendMail OK to=${message.to} org=${this.org.id} messageId=${messageId}`,
      );
      return { ok: true, messageId, transport: "graph" };
    }

    const errBody = await res.text().catch(() => "");
    const detail = `Graph sendMail failed (${res.status}): ${errBody.slice(0, 300)}`;
    if (this.org.id && (res.status === 401 || res.status === 403 || isOauthAuthError(errBody))) {
      await markMailboxNeedsReconnect({
        orgId: this.org.id,
        providerType: "m365",
        errorMessage: detail,
      }).catch((e) => console.error("[email] markMailboxNeedsReconnect failed:", e));
    }
    throw new EmailTransportError("graph", detail);
  }
}
