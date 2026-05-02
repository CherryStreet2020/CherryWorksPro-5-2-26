/**
 * Sprint 2p — Minimal Resend transport wrapper.
 *
 * Direct REST call (no `resend` npm pkg installed). Used by the
 * immediate-dispatch "Send Now" path on /api/marketing/campaigns/:id/send-now.
 * Returns the provider message id on success, throws on failure.
 */
const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface SendEmailInput {
  from: string;
  to: string;
  subject: string;
  html: string;
  replyTo?: string | null;
}

export interface SendEmailResult {
  id: string;
}

export class ResendSendError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "ResendSendError";
    this.status = status;
    this.code = code;
  }
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new ResendSendError("RESEND_API_KEY not configured", 500, "missing_api_key");
  }

  const body: Record<string, unknown> = {
    from: input.from,
    to: input.to,
    subject: input.subject,
    html: input.html,
  };
  if (input.replyTo && input.replyTo.trim()) {
    body.reply_to = input.replyTo.trim();
  }

  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let code = `http_${res.status}`;
    let message = `Resend HTTP ${res.status}`;
    try {
      const errBody = (await res.json()) as { name?: string; message?: string };
      if (errBody?.name) code = errBody.name;
      if (errBody?.message) message = errBody.message;
    } catch {
      // ignore JSON parse errors; fall back to HTTP code
    }
    throw new ResendSendError(message, res.status, code);
  }

  const json = (await res.json()) as { id?: string };
  if (!json?.id) {
    throw new ResendSendError("Resend response missing id", 502, "invalid_response");
  }
  return { id: json.id };
}
