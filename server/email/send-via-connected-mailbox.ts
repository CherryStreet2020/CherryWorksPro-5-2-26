import { storage } from "../storage";
import { selectTransport, type OrgForTransport } from "./transport-selector";
import { MissingMailboxError, type SendableMessage, type EmailProviderType } from "./types";
import { isRecipientSuppressed, recordSuppressedSend } from "./failure-tracker";

/**
 * Thrown by {@link sendViaConnectedMailbox} when the recipient is on
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

export interface SendViaConnectedMailboxInput {
  orgId: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
  cc?: string[];
  replyTo?: string | null;
}

export interface SendViaConnectedMailboxResult {
  ok: true;
  provider: EmailProviderType;
  transport: "graph" | "gmail" | "smtp" | "noop";
  senderAddress: string | null;
  providerMessageId: string;
  sentAt: string;
}

interface OrgRow extends OrgForTransport {
  name?: string | null;
}

/**
 * Shared helper that loads an org row, picks the right transport via
 * selectTransport(), and sends a message. Used by /api/email/test-send and
 * intended for future callers (campaign sender, password resets, etc.) so
 * provider routing lives in exactly one place.
 *
 * Throws MissingMailboxError / EmailTransportError — callers map to HTTP.
 * Never logs tokens or SMTP passwords.
 */
export async function sendViaConnectedMailbox(
  input: SendViaConnectedMailboxInput,
): Promise<SendViaConnectedMailboxResult> {
  const orgRecord = (await storage.getOrg(input.orgId)) as OrgRow | undefined;
  if (!orgRecord) {
    throw new MissingMailboxError("m365", input.orgId);
  }

  const transport = await selectTransport(orgRecord);

  const suppression = await isRecipientSuppressed(input.orgId, input.to);
  if (suppression) {
    recordSuppressedSend(input.orgId, transport.kind ?? "unknown", input.to);
    throw new RecipientSuppressedError(suppression.hash, suppression.reason);
  }
  const providerType: EmailProviderType =
    (orgRecord.emailProviderType ?? "smtp") as EmailProviderType;
  const senderAddress = orgRecord.emailSenderAddress ?? null;

  const message: SendableMessage = {
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    cc: input.cc,
    replyTo: input.replyTo ?? undefined,
    fromEmail: senderAddress ?? undefined,
    fromName: orgRecord.name ?? undefined,
  };

  const result = await transport.send(message);

  return {
    ok: true,
    provider: providerType,
    transport: result.transport,
    senderAddress,
    providerMessageId: result.messageId,
    sentAt: new Date().toISOString(),
  };
}
