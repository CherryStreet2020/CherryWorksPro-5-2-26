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

const HEADER_INJECTION_RE = /[\r\n\f\v\0]/;
const EMAIL_RE = /^[^\s@\r\n\f\v\0]+@[^\s@\r\n\f\v\0]+\.[^\s@\r\n\f\v\0]{2,}$/;

export const GMAIL_SEND_URL =
  "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "openid",
  "email",
];

function checkHeader(value: string, field: string): void {
  if (HEADER_INJECTION_RE.test(value)) {
    throw new EmailTransportError("gmail", `Invalid ${field}: control characters not allowed`);
  }
}

function validateEmail(email: string): boolean {
  if (!email || email.length > 254) return false;
  return EMAIL_RE.test(email);
}

function fetchOverride(): typeof fetch {
  return (global as any).__emailTestFetch || fetch;
}

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function refreshGoogleAccessToken(org: OrgForTransport): Promise<string> {
  if (!org.id) throw new EmailTransportError("gmail", "org.id required for token refresh");
  if (!org.emailOauthRefreshToken) throw new MissingMailboxError("google", org.id);

  const cacheKey = `google:${org.id}`;
  const cached = getCachedAccessToken(cacheKey);
  if (cached) return cached;

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new EmailTransportError(
      "gmail",
      "GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET not configured.",
    );
  }

  let refreshToken: string;
  try {
    refreshToken = decryptSmtpPassword(org.emailOauthRefreshToken);
  } catch (e) {
    throw new EmailTransportError("gmail", "Failed to decrypt refresh token", e);
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const res = await fetchOverride()(GOOGLE_TOKEN_URL, {
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
        providerType: "google",
        errorMessage: detail,
      }).catch((e) => console.error("[email] markMailboxNeedsReconnect failed:", e));
    }
    throw new EmailTransportError("gmail", detail);
  }

  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    throw new EmailTransportError("gmail", "Token refresh response missing access_token");
  }

  setCachedAccessToken(cacheKey, json.access_token, json.expires_in ?? 3600);
  return json.access_token;
}

/**
 * Build an RFC 822 message with optional multipart/mixed for attachments,
 * then base64url-encode the whole thing for Gmail's `raw` field.
 */
export function buildGmailRawMessage(message: SendableMessage): string {
  const fromHeader = message.fromName && message.fromEmail
    ? `"${message.fromName}" <${message.fromEmail}>`
    : message.fromEmail || "";

  const headers: string[] = [];
  if (fromHeader) headers.push(`From: ${fromHeader}`);
  headers.push(`To: ${message.to}`);
  if (message.cc && message.cc.length > 0) headers.push(`Cc: ${message.cc.join(", ")}`);
  if (message.replyTo) headers.push(`Reply-To: ${message.replyTo}`);
  headers.push(`Subject: ${message.subject}`);
  headers.push(`MIME-Version: 1.0`);

  const attachments = message.attachments ?? [];
  let body: string;

  if (attachments.length === 0) {
    headers.push(`Content-Type: text/html; charset="UTF-8"`);
    headers.push(`Content-Transfer-Encoding: base64`);
    body = Buffer.from(message.html, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  } else {
    const boundary = `cw_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);

    const parts: string[] = [];
    parts.push(`--${boundary}`);
    parts.push(`Content-Type: text/html; charset="UTF-8"`);
    parts.push(`Content-Transfer-Encoding: base64`);
    parts.push("");
    parts.push(Buffer.from(message.html, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n"));

    for (const att of attachments) {
      parts.push(`--${boundary}`);
      parts.push(`Content-Type: ${att.contentType || "application/octet-stream"}; name="${att.filename}"`);
      parts.push(`Content-Disposition: attachment; filename="${att.filename}"`);
      parts.push(`Content-Transfer-Encoding: base64`);
      parts.push("");
      parts.push(att.content.toString("base64").replace(/(.{76})/g, "$1\r\n"));
    }

    parts.push(`--${boundary}--`);
    body = parts.join("\r\n");
  }

  const rfc822 = headers.join("\r\n") + "\r\n\r\n" + body;
  return b64url(Buffer.from(rfc822, "utf8"));
}

export class GmailTransport implements EmailTransport {
  readonly kind = "gmail" as const;
  constructor(private readonly org: OrgForTransport) {}

  async send(message: SendableMessage): Promise<SendResult> {
    if (!validateEmail(message.to)) {
      throw new EmailTransportError("gmail", `Invalid to address: "${message.to}"`);
    }
    checkHeader(message.to, "to");
    checkHeader(message.subject, "subject");
    if (message.cc) message.cc.forEach((c) => checkHeader(c, "cc"));
    if (message.replyTo) checkHeader(message.replyTo, "replyTo");

    const cacheKey = `google:${this.org.id}`;
    const raw = buildGmailRawMessage(message);

    let accessToken = await refreshGoogleAccessToken(this.org);
    let res = await fetchOverride()(GMAIL_SEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    });

    if (res.status === 401) {
      invalidateCachedAccessToken(cacheKey);
      accessToken = await refreshGoogleAccessToken(this.org);
      res = await fetchOverride()(GMAIL_SEND_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw }),
      });
    }

    if (res.ok) {
      const json = (await res.json().catch(() => ({}))) as { id?: string };
      const messageId = json.id || `gmail-${Date.now()}`;
      console.log(
        `[email] Gmail send OK to=${message.to} org=${this.org.id} messageId=${messageId}`,
      );
      return { ok: true, messageId, transport: "gmail" };
    }

    const errBody = await res.text().catch(() => "");
    const detail = `Gmail send failed (${res.status}): ${errBody.slice(0, 300)}`;
    if (this.org.id && (res.status === 401 || res.status === 403 || isOauthAuthError(errBody))) {
      await markMailboxNeedsReconnect({
        orgId: this.org.id,
        providerType: "google",
        errorMessage: detail,
      }).catch((e) => console.error("[email] markMailboxNeedsReconnect failed:", e));
    }
    throw new EmailTransportError("gmail", detail);
  }
}
