export interface SendableAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface SendableMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
  cc?: string[];
  replyTo?: string | null;
  fromName?: string | null;
  fromEmail?: string | null;
  attachments?: SendableAttachment[];
  /**
   * Extra top-level headers (e.g. List-Unsubscribe). SMTP and Gmail send them
   * as-is; Graph sendMail only accepts X- headers and drops the rest.
   */
  headers?: Record<string, string>;
}

export interface SendResult {
  ok: boolean;
  messageId: string;
  previewUrl?: string;
  transport: "smtp" | "graph" | "gmail" | "noop" | "acs";
}

export type EmailProviderType = "smtp" | "m365" | "google";

export interface EmailTransport {
  readonly kind: "smtp" | "graph" | "gmail" | "noop" | "acs";
  send(message: SendableMessage): Promise<SendResult>;
}

export class MissingMailboxError extends Error {
  readonly code = "MISSING_MAILBOX";
  constructor(public readonly providerType: "m365" | "google", public readonly orgId?: string) {
    super(
      `Mailbox not connected for provider "${providerType}"${orgId ? ` on org ${orgId}` : ""}. ` +
        `User must complete OAuth consent in Settings.`,
    );
    this.name = "MissingMailboxError";
  }
}

export class EmailTransportError extends Error {
  readonly code = "EMAIL_TRANSPORT_ERROR";
  constructor(
    public readonly transport: string,
    message: string,
    public readonly cause?: unknown,
    /** A stable code chosen by the transport; `redactErrorCode` prefers it over message parsing. */
    public readonly providerCode?: string,
  ) {
    super(message);
    this.name = "EmailTransportError";
  }
}

const HEADER_NAME_RE = /^[A-Za-z0-9-]+$/;
const HEADER_VALUE_UNSAFE_RE = /[\r\n\f\v\0]/;

/** Rejects extra headers whose name or value could inject further headers. */
export function assertSafeHeaders(transport: string, headers: Record<string, string> | undefined): void {
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (!HEADER_NAME_RE.test(name) || HEADER_VALUE_UNSAFE_RE.test(value)) {
      throw new EmailTransportError(transport, `Invalid header "${name}"`);
    }
  }
}

/**
 * Thrown by `sendViaConnectedMailbox` (and the ACS marketing route) when the recipient is on
 * the org's masked-recipient suppression list. Callers can map this to
 * a non-error outcome (e.g. "skipped") rather than treating it as a
 * transport failure — the suppression counter is incremented separately
 * by the failure tracker.
 */
export class RecipientSuppressedError extends Error {
  readonly code = "RECIPIENT_SUPPRESSED";
  readonly recipientHash: string;
  readonly reason: string;
  constructor(recipientHash: string, reason: string) {
    super(`Recipient is on the org suppression list (#${recipientHash})`);
    this.name = "RecipientSuppressedError";
    this.recipientHash = recipientHash;
    this.reason = reason;
  }
}
