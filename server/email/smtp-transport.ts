import type { Transporter } from "nodemailer";
import type { SmtpConfig } from "../email";
import type { EmailTransport, SendableMessage, SendResult } from "./types";
import { EmailTransportError } from "./types";

const HEADER_INJECTION_RE = /[\r\n\f\v\0]/;
const EMAIL_RE = /^[^\s@\r\n\f\v\0]+@[^\s@\r\n\f\v\0]+\.[^\s@\r\n\f\v\0]{2,}$/;

function checkHeaderInjection(value: string, fieldName: string): void {
  if (HEADER_INJECTION_RE.test(value)) {
    throw new EmailTransportError(
      "smtp",
      `Invalid ${fieldName}: contains prohibited control characters`,
    );
  }
}

function validateEmail(email: string): boolean {
  if (!email || email.length > 254) return false;
  return EMAIL_RE.test(email);
}

function buildFromAddress(message: SendableMessage, smtpUser?: string | null): string {
  if (message.fromName && message.fromEmail) {
    return `"${message.fromName}" <${message.fromEmail}>`;
  }
  if (message.fromEmail) return message.fromEmail;
  if (smtpUser) return `"CherryWorks Pro" <${smtpUser}>`;
  if (process.env.SMTP_USER) return `"CherryWorks Pro" <${process.env.SMTP_USER}>`;
  return '"CherryWorks Pro" <noreply@cherrystconsulting.com>';
}

// Module-private nodemailer transporter cache. Shared between the per-org
// path (`createTransporterForOrg`) and the env path (`createEnvTransporter`)
// so that switching between them invalidates correctly via distinct keys.
let cachedTransporter: Transporter | null = null;
let cachedTransporterKey: string | null = null;

/**
 * Build a nodemailer transporter for an org's SMTP credentials, falling back
 * to the env-level SMTP transporter when the per-org config is absent.
 *
 * Private to the SMTP transport path — callers must use `SmtpTransport.send`
 * via `selectTransport(org)` rather than calling nodemailer directly. The
 * legacy env-level helper is re-exported as `createTransporter` from
 * `server/email.ts` for the few callsites that still need a raw transporter
 * (e.g. signup confirmation in settings/go-live routes).
 */
async function createTransporterForOrg(
  config?: SmtpConfig | null,
): Promise<Transporter | null> {
  const nodemailer = await import("nodemailer");

  if (config?.host && config?.port && config?.user && config?.pass) {
    const key = `${config.host}:${config.port}:${config.user}`;
    if (cachedTransporter && cachedTransporterKey === key) return cachedTransporter;

    cachedTransporter = nodemailer.default.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: { user: config.user, pass: config.pass },
      tls: { minVersion: "TLSv1.2" },
    });
    cachedTransporterKey = key;
    console.log("[email] Org SMTP configured:", config.host, "as", config.user);
    return cachedTransporter;
  }

  return createEnvTransporter();
}

export async function createEnvTransporter(): Promise<Transporter | null> {
  const nodemailer = await import("nodemailer");

  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = process.env.SMTP_PORT;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (smtpHost && smtpPort && smtpUser && smtpPass) {
    const key = `env:${smtpHost}:${smtpPort}:${smtpUser}`;
    if (cachedTransporter && cachedTransporterKey === key) return cachedTransporter;

    cachedTransporter = nodemailer.default.createTransport({
      host: smtpHost,
      port: Number(smtpPort),
      secure: Number(smtpPort) === 465,
      auth: { user: smtpUser, pass: smtpPass },
      tls: { minVersion: "TLSv1.2" },
    });
    cachedTransporterKey = key;
    console.log("[email] SMTP configured:", smtpHost, "as", smtpUser);
    return cachedTransporter;
  }

  if (process.env.NODE_ENV === "production") {
    console.warn("[email] WARNING: SMTP not configured in production — emails will not be sent.");
    return null;
  }

  console.warn("[email] WARNING: SMTP not configured! Falling back to Ethereal test inbox.");

  const testAccount = await nodemailer.default.createTestAccount();
  cachedTransporter = nodemailer.default.createTransport({
    host: "smtp.ethereal.email",
    port: 587,
    secure: false,
    auth: { user: testAccount.user, pass: testAccount.pass },
  });
  cachedTransporterKey = "ethereal";

  console.log("[email] Using Ethereal test account:", testAccount.user);
  return cachedTransporter;
}

export function clearSmtpTransporterCache(): void {
  cachedTransporter = null;
  cachedTransporterKey = null;
}

/**
 * SMTP transport — wraps the nodemailer per-org / env transporter cache so
 * all transports present a uniform `EmailTransport` interface.
 *
 * Behavior is byte-identical to the pre-Sprint-2g code path: same cache,
 * same crypto, same Ethereal fallback.
 */
export class SmtpTransport implements EmailTransport {
  readonly kind = "smtp" as const;

  constructor(private readonly smtpConfig?: SmtpConfig | null) {}

  async send(message: SendableMessage): Promise<SendResult> {
    if (!validateEmail(message.to)) {
      throw new EmailTransportError("smtp", `Invalid to address: "${message.to}"`);
    }
    checkHeaderInjection(message.to, "to");
    checkHeaderInjection(message.subject, "subject");

    const nodemailer = await import("nodemailer");
    const transporter = await createTransporterForOrg(this.smtpConfig);

    if (!transporter) {
      console.warn(
        `[email] No SMTP configured — skipping email to ${message.to}: ${message.subject}`,
      );
      return { ok: false, messageId: "not-sent-no-smtp", transport: "noop" };
    }

    const fromAddr = buildFromAddress(message, this.smtpConfig?.user);
    checkHeaderInjection(fromAddr, "from");

    const mailOptions: any = {
      from: fromAddr,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      attachments: (message.attachments ?? []).map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    };

    if (message.cc && message.cc.length > 0) {
      const safeCc = message.cc.filter(
        (v) => v && !HEADER_INJECTION_RE.test(v) && validateEmail(v),
      );
      if (safeCc.length > 0) mailOptions.cc = safeCc.join(", ");
    }

    const replyTo = message.replyTo ?? this.smtpConfig?.replyTo;
    if (replyTo) {
      checkHeaderInjection(replyTo, "replyTo");
      if (!validateEmail(replyTo)) {
        throw new EmailTransportError("smtp", `Invalid replyTo: "${replyTo}"`);
      }
      mailOptions.replyTo = replyTo;
    }

    const info = await transporter.sendMail(mailOptions);
    const preview = nodemailer.default.getTestMessageUrl(info) || undefined;
    if (preview) console.log("[email] Preview URL:", preview);
    console.log("[email] Email sent to:", message.to, "messageId:", info.messageId);

    return {
      ok: true,
      messageId: info.messageId,
      previewUrl: typeof preview === "string" ? preview : undefined,
      transport: "smtp",
    };
  }
}
