import { getSmtpConfigFromOrg } from "../email";
import { isEmailOauthEnabled } from "./feature-flag";
import { SmtpTransport } from "./smtp-transport";
import type { EmailTransport, EmailProviderType } from "./types";
import { MissingMailboxError } from "./types";

/**
 * Minimal shape of an `orgs` row that the selector needs. We accept `any` at
 * the boundary (existing routes load org rows with various column subsets)
 * and only read the fields we know exist post-Sprint-2g.1.
 */
export interface OrgForTransport {
  id?: string;
  emailProviderType?: EmailProviderType | null;
  emailOauthRefreshToken?: string | null;
  emailOauthExpiresAt?: Date | string | null;
  emailOauthScopes?: string | null;
  emailSenderAddress?: string | null;
  emailOauthStatus?: string | null;
  // SMTP config is read via getSmtpConfigFromOrg(org)
}

export interface SelectTransportOptions {
  /**
   * When set, overrides the org-row provider choice. Used by route handlers
   * during the OAuth callback test flow before the row has been updated.
   */
  forceProvider?: EmailProviderType;
}

/**
 * Pick the right transport for an org. Honors the EMAIL_OAUTH_ENABLED feature
 * flag: when off, every org resolves to SMTP (current pre-2g behavior).
 *
 * Throws MissingMailboxError when an OAuth provider is selected but the org
 * has no refresh token. Callers (settings UI / send routes) are expected to
 * surface this as a user-actionable "Connect mailbox" message.
 */
export async function selectTransport(
  org: OrgForTransport | null | undefined,
  opts?: SelectTransportOptions,
): Promise<EmailTransport> {
  const flagOn = isEmailOauthEnabled();
  const providerFromOrg = (org?.emailProviderType ?? "smtp") as EmailProviderType;
  const provider: EmailProviderType = opts?.forceProvider ?? providerFromOrg;

  // Flag off → always SMTP, regardless of stored provider. This is the
  // rollback path: flip EMAIL_OAUTH_ENABLED=false and behavior reverts.
  if (!flagOn) {
    return new SmtpTransport(getSmtpConfigFromOrg(org));
  }

  if (provider === "smtp") {
    return new SmtpTransport(getSmtpConfigFromOrg(org));
  }

  if (provider === "m365") {
    if (!org?.emailOauthRefreshToken) {
      throw new MissingMailboxError("m365", org?.id);
    }
    // Note: a stale `emailOauthStatus === "needs_reconnect"` is intentionally
    // NOT short-circuited here (Sprint 2g.10 hot-patch). Send-level 401/403
    // can mark the flag from a single transient failure on a healthy
    // credential; we now attempt the send and let refreshGraphAccessToken /
    // GraphTransport.send() throw if the credential is actually dead. The
    // 15-min mailbox recovery probe is the source of truth for clearing.
    const { GraphTransport } = await import("./graph-transport");
    return new GraphTransport(org);
  }

  if (provider === "google") {
    if (!org?.emailOauthRefreshToken) {
      throw new MissingMailboxError("google", org?.id);
    }
    // See m365 branch — same rationale.
    const { GmailTransport } = await import("./gmail-transport");
    return new GmailTransport(org);
  }

  // Defensive default: unknown provider → SMTP fallback.
  return new SmtpTransport(getSmtpConfigFromOrg(org));
}
