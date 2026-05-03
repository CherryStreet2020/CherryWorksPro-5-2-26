import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { isEmailOauthEnabled } from "./email/feature-flag";
import {
  SmtpTransport,
  createEnvTransporter,
  clearSmtpTransporterCache,
} from "./email/smtp-transport";
import { selectTransport, type OrgForTransport } from "./email/transport-selector";
import { trackSelection } from "./email/failure-tracker";
import type { EmailTransport, SendableMessage, SendableAttachment } from "./email/types";

// Re-exports for legacy callers (settings/go-live routes that still need a
// raw nodemailer transporter for one-off env-SMTP sends).
export const createTransporter = createEnvTransporter;
export const clearTransporterCache = clearSmtpTransporterCache;

const SMTP_ENCRYPTION_KEY = process.env.SMTP_ENCRYPTION_KEY;
if (!SMTP_ENCRYPTION_KEY) {
  console.warn("[email] WARNING: SMTP_ENCRYPTION_KEY is not set — SMTP passwords will be stored unencrypted. Set this variable to enable encryption.");
}

const LEGACY_SMTP_SALT = "cherryworks-smtp-salt";

function deriveSmtpKey(secret: string, salt: string): Buffer {
  return scryptSync(secret, salt, 32);
}

export function encryptSmtpPassword(plaintext: string): string {
  if (!SMTP_ENCRYPTION_KEY) {
    console.warn("[email] SMTP_ENCRYPTION_KEY not set — storing SMTP password without encryption");
    return plaintext;
  }
  const salt = randomBytes(16);
  const key = deriveSmtpKey(SMTP_ENCRYPTION_KEY, salt.toString("hex"));
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return "v2:" + salt.toString("hex") + ":" + iv.toString("hex") + ":" + tag.toString("hex") + ":" + encrypted.toString("hex");
}

export function decryptSmtpPassword(ciphertext: string): string {
  if (ciphertext.startsWith("v2:")) {
    if (!SMTP_ENCRYPTION_KEY) throw new Error("SMTP_ENCRYPTION_KEY is required to decrypt SMTP passwords");
    const parts = ciphertext.split(":");
    if (parts.length !== 5) throw new Error("Invalid v2 encrypted format");
    const salt = parts[1];
    const iv = Buffer.from(parts[2], "hex");
    const tag = Buffer.from(parts[3], "hex");
    const encrypted = Buffer.from(parts[4], "hex");
    const key = deriveSmtpKey(SMTP_ENCRYPTION_KEY, salt);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted) + decipher.final("utf8");
  }

  if (ciphertext.includes(":")) {
    if (!SMTP_ENCRYPTION_KEY) throw new Error("SMTP_ENCRYPTION_KEY is required to decrypt SMTP passwords");
    const key = deriveSmtpKey(SMTP_ENCRYPTION_KEY, LEGACY_SMTP_SALT);
    const parts = ciphertext.split(":");
    if (parts.length !== 3) throw new Error("Invalid encrypted format");
    const iv = Buffer.from(parts[0], "hex");
    const tag = Buffer.from(parts[1], "hex");
    const encrypted = Buffer.from(parts[2], "hex");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted) + decipher.final("utf8");
  }

  return ciphertext;
}

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  fromName?: string | null;
  fromEmail?: string | null;
  replyTo?: string | null;
}

const HEADER_INJECTION_RE = /[\r\n\f\v\0]/;

function checkHeaderInjection(value: string, fieldName: string): void {
  if (HEADER_INJECTION_RE.test(value)) {
    throw new Error(`Invalid ${fieldName}: contains prohibited control characters`);
  }
}

const EMAIL_RE = /^[^\s@\r\n\f\v\0]+@[^\s@\r\n\f\v\0]+\.[^\s@\r\n\f\v\0]{2,}$/;

export function validateEmailAddress(email: string): boolean {
  if (!email || email.length > 254) return false;
  return EMAIL_RE.test(email);
}

function requireValidEmail(email: string, fieldName: string): void {
  if (!validateEmailAddress(email)) {
    throw new Error(`Invalid ${fieldName}: "${email}" is not a valid email address`);
  }
}

/**
 * Pick the right transport for a sender call.
 *
 * Precedence:
 *   1. If org is provided → `selectTransport(org)`. The selector itself
 *      enforces byte-identical SMTP behavior when EMAIL_OAUTH_ENABLED=false
 *      (it returns SmtpTransport(getSmtpConfigFromOrg(org))), and routes to
 *      Graph/Gmail when the flag is on and the org is configured for OAuth.
 *   2. Otherwise → SmtpTransport(smtpConfig ?? null). This preserves the
 *      legacy env-SMTP / Ethereal fallback for callers that don't load an
 *      org row (e.g., the reminder cron before this change, or any future
 *      org-less sender).
 *
 * Emits a one-line forensic trace on every send for rollback / audit.
 */
class FileCaptureTransport implements EmailTransport {
  readonly kind = "noop" as const;
  constructor(private readonly dir: string) {}
  async send(message: SendableMessage) {
    const fs = await import("fs/promises");
    const path = await import("path");
    const crypto = await import("crypto");
    await fs.mkdir(this.dir, { recursive: true });
    const id = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const file = path.join(this.dir, `${id}.json`);
    await fs.writeFile(
      file,
      JSON.stringify(
        {
          id,
          capturedAt: new Date().toISOString(),
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text ?? null,
          cc: message.cc ?? null,
          replyTo: message.replyTo ?? null,
          fromName: message.fromName ?? null,
          fromEmail: message.fromEmail ?? null,
        },
        null,
        2,
      ),
      "utf8",
    );
    return { ok: true, messageId: `capture:${id}`, transport: "noop" as const };
  }
}

async function pickTransport(
  org: OrgForTransport | null | undefined,
  smtpConfig: SmtpConfig | null | undefined,
): Promise<EmailTransport> {
  // E2E capture transport. Hard-blocked in production so a stray env var
  // can never divert real customer mail to disk.
  const captureDir = process.env.EMAIL_CAPTURE_DIR;
  if (captureDir && captureDir.length > 0) {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        `[email] EMAIL_CAPTURE_DIR is set in production; ignoring and using real transport. ` +
          `If you need a capture transport in production, set NODE_ENV != "production".`,
      );
    } else {
      console.log(`[email] capture-mode dir=${captureDir} org=${org?.id ?? "none"}`);
      return new FileCaptureTransport(captureDir);
    }
  }

  const flagOn = isEmailOauthEnabled();
  const transport: EmailTransport = await trackSelection(org?.id, async () =>
    org ? await selectTransport(org) : new SmtpTransport(smtpConfig ?? null),
  );

  console.log(
    `[email] flag=${flagOn}, org=${org?.id ?? "none"}, transport=${transport.kind}`,
  );
  return transport;
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/td>/gi, " | ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function sendInvoiceEmail(
  to: string,
  subject: string,
  htmlBody: string,
  pdfBuffer?: Buffer,
  smtpConfig?: SmtpConfig | null,
  cc?: string[],
  org?: OrgForTransport | null,
): Promise<{ messageId: string; previewUrl?: string }> {
  const transport = await pickTransport(org, smtpConfig);

  const attachments: SendableAttachment[] = pdfBuffer
    ? [{ filename: "invoice.pdf", content: pdfBuffer, contentType: "application/pdf" }]
    : [];

  const message: SendableMessage = {
    to,
    subject,
    html: htmlBody,
    text: htmlToPlainText(htmlBody),
    cc,
    replyTo: smtpConfig?.replyTo ?? null,
    fromName: smtpConfig?.fromName ?? null,
    fromEmail: smtpConfig?.fromEmail ?? null,
    attachments,
  };

  const result = await transport.send(message);
  return { messageId: result.messageId, previewUrl: result.previewUrl };
}

const FONT_STACK = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const BG_OUTER = "#f8f9fa";
const BG_CARD = "#ffffff";
const ACCENT = "#1a1a2e";
const ACCENT_BTN = "#1a1a2e";
const ACCENT_LIGHT = "#e8e8ee";
const TEXT_PRIMARY = "#1a1a2e";
const TEXT_SECONDARY = "#555770";
const TEXT_MUTED = "#8b8da3";
const BORDER = "#e5e5ec";
const CHERRY = "#cf3339";

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function wrapEmailLayout(innerHtml: string, opts?: { orgName?: string; preheader?: string }): string {
  const orgName = opts?.orgName || "CherryWorks Pro";
  const preheader = opts?.preheader || "";
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${escapeHtml(orgName)}</title>
  <!--[if mso]><style>body,table,td{font-family:Arial,Helvetica,sans-serif!important}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:${BG_OUTER};-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${BG_OUTER};">${preheader}</div>` : ""}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BG_OUTER};">
    <tr><td align="center" style="padding:40px 16px 32px;">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

        <tr><td align="center" style="padding-bottom:32px;">
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding-right:10px;vertical-align:middle;">
                <div style="width:32px;height:32px;border-radius:8px;background:${ACCENT};text-align:center;line-height:32px;">
                  <span style="color:#fff;font-size:14px;font-weight:700;font-family:${FONT_STACK};">C</span>
                </div>
              </td>
              <td style="vertical-align:middle;">
                <span style="font-family:${FONT_STACK};font-size:18px;font-weight:700;color:${ACCENT};letter-spacing:-0.3px;">Cherry<span style="font-weight:400;">Works</span></span>
              </td>
            </tr>
          </table>
        </td></tr>

        <tr><td>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BG_CARD};border-radius:12px;border:1px solid ${BORDER};overflow:hidden;">
            <tr><td style="padding:40px 40px 36px;font-family:${FONT_STACK};">
              ${innerHtml}
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:24px 0 0;text-align:center;">
          <p style="font-family:${FONT_STACK};font-size:12px;color:${TEXT_MUTED};margin:0;line-height:1.5;">
            Sent by ${escapeHtml(orgName)} via <span style="color:${ACCENT};font-weight:600;">CherryWorks Pro</span>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function emailButton(text: string, href: string, opts?: { secondary?: boolean }): string {
  const safeHref = href.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (opts?.secondary) {
    return `<a href="${safeHref}" style="display:inline-block;font-family:${FONT_STACK};font-size:14px;font-weight:600;color:${ACCENT_BTN};background:${BG_CARD};border:1.5px solid ${BORDER};padding:10px 24px;border-radius:8px;text-decoration:none;transition:none;">${text}</a>`;
  }
  return `<a href="${safeHref}" style="display:inline-block;font-family:${FONT_STACK};font-size:14px;font-weight:600;color:#ffffff;background:${ACCENT_BTN};padding:12px 28px;border-radius:8px;text-decoration:none;transition:none;">${text}</a>`;
}

export function emailDivider(): string {
  return `<hr style="border:none;border-top:1px solid ${BORDER};margin:28px 0;">`;
}

export function emailKeyValue(label: string, value: string): string {
  return `<tr>
    <td style="padding:6px 0;color:${TEXT_MUTED};font-size:13px;font-family:${FONT_STACK};white-space:nowrap;vertical-align:top;width:120px;">${label}</td>
    <td style="padding:6px 0 6px 12px;color:${TEXT_PRIMARY};font-size:14px;font-weight:600;font-family:${FONT_STACK};">${value}</td>
  </tr>`;
}

export function emailDetailCard(rows: string, title?: string): string {
  const heading = title
    ? `<h2 style="font-family:${FONT_STACK};font-size:20px;font-weight:700;color:${TEXT_PRIMARY};margin:0 0 12px;letter-spacing:-0.2px;">${escapeHtml(title)}</h2>`
    : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG_OUTER};border-radius:8px;margin:24px 0;">
    <tr><td style="padding:20px 24px;">
      ${heading}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        ${rows}
      </table>
    </td></tr>
  </table>`;
}

export async function sendInviteEmail(
  to: string,
  teamMemberName: string,
  orgName: string,
  tempPassword: string,
  loginUrl: string,
  smtpConfig?: SmtpConfig | null,
  org?: OrgForTransport | null,
): Promise<{ messageId: string; previewUrl?: string }> {
  const transport = await pickTransport(org, smtpConfig);
  const subject = `You've been invited to ${orgName} on CherryWorks Pro`;

  const innerHtml = `
    <p style="font-size:20px;font-weight:700;color:${TEXT_PRIMARY};margin:0 0 4px;">You're invited</p>
    <p style="font-size:14px;color:${TEXT_MUTED};margin:0 0 28px;">Join ${escapeHtml(orgName)} on CherryWorks Pro</p>

    <p style="font-size:15px;color:${TEXT_SECONDARY};line-height:1.7;margin:0 0 8px;">
      Hi ${escapeHtml(teamMemberName)},
    </p>
    <p style="font-size:15px;color:${TEXT_SECONDARY};line-height:1.7;margin:0 0 24px;">
      <strong style="color:${TEXT_PRIMARY};">${escapeHtml(orgName)}</strong> has invited you to CherryWorks Pro. An account has been created for you with the credentials below.
    </p>

    ${emailDetailCard(
      emailKeyValue("Email", to) +
      emailKeyValue("Password", `<code style="font-family:'Inter',system-ui,sans-serif;font-size:13px;background:${ACCENT_LIGHT};padding:3px 10px;border-radius:4px;color:${ACCENT};">${tempPassword}</code>`)
    )}

    <p style="font-size:13px;color:${TEXT_MUTED};line-height:1.6;margin:0 0 28px;">
      You'll be asked to set a new password on first login, then complete a quick profile setup.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center">${emailButton("Log In to CherryWorks Pro", loginUrl)}</td></tr>
    </table>

    ${emailDivider()}

    <p style="font-size:12px;color:${TEXT_MUTED};margin:0;text-align:center;">
      If you didn't expect this invitation, please contact your administrator.
    </p>
  `;

  const html = wrapEmailLayout(innerHtml, { orgName, preheader: `You've been invited to ${orgName}` });

  const message: SendableMessage = {
    to,
    subject,
    html,
    text: `Hi ${teamMemberName},\n\nYou've been invited to ${orgName} on CherryWorks Pro.\n\nEmail: ${to}\nTemporary Password: ${tempPassword}\n\nLog in at: ${loginUrl}\n\nYou'll be asked to set a new password on first login.`,
    replyTo: smtpConfig?.replyTo ?? null,
    fromName: smtpConfig?.fromName ?? null,
    fromEmail: smtpConfig?.fromEmail ?? null,
  };

  const result = await transport.send(message);
  return { messageId: result.messageId, previewUrl: result.previewUrl };
}

export async function sendWelcomeEmail(
  to: string,
  recipientName: string,
  firmName: string,
  loginUrl: string,
  smtpConfig?: SmtpConfig | null,
  org?: OrgForTransport | null,
): Promise<{ messageId: string; previewUrl?: string }> {
  const transport = await pickTransport(org, smtpConfig);
  const subject = `Welcome to CherryWorks Pro, ${firmName}`;

  const safeName = escapeHtml(recipientName || "there");
  const safeFirm = escapeHtml(firmName);

  const innerHtml = `
    <p style="font-size:20px;font-weight:700;color:${TEXT_PRIMARY};margin:0 0 4px;">Welcome, ${safeName}</p>
    <p style="font-size:14px;color:${TEXT_MUTED};margin:0 0 28px;">Your ${safeFirm} workspace is ready</p>

    <p style="font-size:15px;color:${TEXT_SECONDARY};line-height:1.7;margin:0 0 24px;">
      Thanks for starting your free trial. Sign in any time to invite your team, set up billing, and start running ${safeFirm} on CherryWorks Pro.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center">${emailButton("Open your workspace", loginUrl)}</td></tr>
    </table>

    ${emailDivider()}

    <p style="font-size:12px;color:${TEXT_MUTED};margin:0;text-align:center;">
      Need help getting started? Just reply to this email.
    </p>
  `;

  const html = wrapEmailLayout(innerHtml, { orgName: firmName, preheader: `Your ${firmName} workspace is ready` });

  const message: SendableMessage = {
    to,
    subject,
    html,
    text: `Welcome, ${recipientName || "there"}\n\nYour ${firmName} workspace on CherryWorks Pro is ready.\n\nSign in any time: ${loginUrl}\n\nNeed help getting started? Just reply to this email.`,
    replyTo: smtpConfig?.replyTo ?? null,
    fromName: smtpConfig?.fromName ?? null,
    fromEmail: smtpConfig?.fromEmail ?? null,
  };

  const result = await transport.send(message);
  return { messageId: result.messageId, previewUrl: result.previewUrl };
}

export async function sendPasswordResetEmail(
  to: string,
  resetUrl: string,
  smtpConfig?: SmtpConfig | null,
  org?: OrgForTransport | null,
): Promise<{ messageId: string; previewUrl?: string }> {
  const transport = await pickTransport(org, smtpConfig);
  const subject = "Reset your CherryWorks Pro password";

  const innerHtml = `
    <p style="font-size:20px;font-weight:700;color:${TEXT_PRIMARY};margin:0 0 4px;">Password Reset</p>
    <p style="font-size:14px;color:${TEXT_MUTED};margin:0 0 28px;">We received a request to reset your password</p>

    <p style="font-size:15px;color:${TEXT_SECONDARY};line-height:1.7;margin:0 0 24px;">
      Click the button below to set a new password. This link will expire in 1 hour.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center">${emailButton("Reset Password", resetUrl)}</td></tr>
    </table>

    ${emailDivider()}

    <p style="font-size:12px;color:${TEXT_MUTED};margin:0;text-align:center;">
      If you didn't request a password reset, you can safely ignore this email.
    </p>
  `;

  const html = wrapEmailLayout(innerHtml, { preheader: "Reset your CherryWorks Pro password" });

  const message: SendableMessage = {
    to,
    subject,
    html,
    text: `Password Reset\n\nWe received a request to reset your CherryWorks Pro password.\n\nClick the link below to set a new password (expires in 1 hour):\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email.`,
    replyTo: smtpConfig?.replyTo ?? null,
    fromName: smtpConfig?.fromName ?? null,
    fromEmail: smtpConfig?.fromEmail ?? null,
  };

  const result = await transport.send(message);
  return { messageId: result.messageId, previewUrl: result.previewUrl };
}

export async function sendRejectionEmail(
  to: string,
  recipientName: string,
  entityType: "timesheet" | "expense" | "expense report",
  entityLabel: string,
  reason: string,
  reviewerName: string,
  smtpConfig?: SmtpConfig | null,
  org?: OrgForTransport | null,
): Promise<{ messageId: string; previewUrl?: string }> {
  const transport = await pickTransport(org, smtpConfig);
  const typeCapitalized = entityType.charAt(0).toUpperCase() + entityType.slice(1);
  const subject = `Your ${entityType} has been returned — ${entityLabel}`;

  const innerHtml = `
    <p style="font-size:20px;font-weight:700;color:${TEXT_PRIMARY};margin:0 0 4px;">${typeCapitalized} Returned</p>
    <p style="font-size:14px;color:${TEXT_MUTED};margin:0 0 28px;">Action required — please review and resubmit</p>

    <p style="font-size:15px;color:${TEXT_SECONDARY};line-height:1.7;margin:0 0 16px;">
      Hi ${recipientName || "there"},
    </p>
    <p style="font-size:15px;color:${TEXT_SECONDARY};line-height:1.7;margin:0 0 16px;">
      Your ${entityType} <strong style="color:${TEXT_PRIMARY};">${entityLabel}</strong> has been rejected by ${reviewerName}.
    </p>

    <div style="background:#fef2f2;border-left:4px solid #ef4444;padding:12px 16px;border-radius:4px;margin:0 0 24px;">
      <p style="font-size:13px;font-weight:600;color:#991b1b;margin:0 0 4px;">Reason:</p>
      <p style="font-size:14px;color:#991b1b;margin:0;line-height:1.6;">${reason}</p>
    </div>

    <p style="font-size:15px;color:${TEXT_SECONDARY};line-height:1.7;margin:0 0 24px;">
      Please review the feedback, make the necessary changes, and resubmit.
    </p>

    ${emailDivider()}

    <p style="font-size:12px;color:${TEXT_MUTED};margin:0;text-align:center;">
      This is an automated notification from CherryWorks Pro.
    </p>
  `;

  const html = wrapEmailLayout(innerHtml, { preheader: `Your ${entityType} ${entityLabel} needs revision` });

  const message: SendableMessage = {
    to,
    subject,
    html,
    text: `${typeCapitalized} Returned\n\nHi ${recipientName || "there"},\n\nYour ${entityType} "${entityLabel}" has been rejected by ${reviewerName}.\n\nReason: ${reason}\n\nPlease review the feedback, make the necessary changes, and resubmit.`,
    replyTo: smtpConfig?.replyTo ?? null,
    fromName: smtpConfig?.fromName ?? null,
    fromEmail: smtpConfig?.fromEmail ?? null,
  };

  const result = await transport.send(message);
  return { messageId: result.messageId, previewUrl: result.previewUrl };
}

interface ApprovedEmailContent {
  headlineTitle: string;       // e.g. "Timesheet Approved"
  headlineSubtitle: string;    // e.g. "Your week is now locked in"
  bodySentenceHtml: string;    // already-escaped HTML sentence
  bodySentenceText: string;    // plain-text equivalent
  successCalloutText: string;  // text inside the green callout box
  preheader: string;
  subject: string;
}

function renderApprovedEmail(
  to: string,
  recipientName: string,
  content: ApprovedEmailContent,
  smtpConfig?: SmtpConfig | null,
): SendableMessage {
  const safeName = escapeHtml(recipientName || "there");
  const safeCallout = escapeHtml(content.successCalloutText);

  const innerHtml = `
    <p style="font-size:20px;font-weight:700;color:${TEXT_PRIMARY};margin:0 0 4px;">${escapeHtml(content.headlineTitle)}</p>
    <p style="font-size:14px;color:${TEXT_MUTED};margin:0 0 28px;">${escapeHtml(content.headlineSubtitle)}</p>

    <p style="font-size:15px;color:${TEXT_SECONDARY};line-height:1.7;margin:0 0 16px;">
      Hi ${safeName},
    </p>
    <p style="font-size:15px;color:${TEXT_SECONDARY};line-height:1.7;margin:0 0 16px;">
      ${content.bodySentenceHtml}
    </p>

    <div style="background:#ecfdf5;border-left:4px solid #10b981;padding:12px 16px;border-radius:4px;margin:0 0 24px;">
      <p style="font-size:14px;color:#065f46;margin:0;line-height:1.6;">${safeCallout}</p>
    </div>

    ${emailDivider()}

    <p style="font-size:12px;color:${TEXT_MUTED};margin:0;text-align:center;">
      This is an automated notification from CherryWorks Pro.
    </p>
  `;

  return {
    to,
    subject: content.subject,
    html: wrapEmailLayout(innerHtml, { preheader: content.preheader }),
    text: `${content.headlineTitle}\n\nHi ${recipientName || "there"},\n\n${content.bodySentenceText}\n\n${content.successCalloutText}`,
    replyTo: smtpConfig?.replyTo ?? null,
    fromName: smtpConfig?.fromName ?? null,
    fromEmail: smtpConfig?.fromEmail ?? null,
  };
}

interface ReopenedEmailContent {
  headlineTitle: string;       // e.g. "Timesheet Re-opened"
  headlineSubtitle: string;    // e.g. "Your week is editable again"
  bodySentenceHtml: string;    // already-escaped HTML sentence
  bodySentenceText: string;    // plain-text equivalent
  preheader: string;
  subject: string;
}

function renderReopenedEmail(
  to: string,
  recipientName: string,
  reopenedByName: string,
  reason: string | null | undefined,
  content: ReopenedEmailContent,
  smtpConfig?: SmtpConfig | null,
): SendableMessage {
  const safeName = escapeHtml(recipientName || "there");
  const safeReopener = escapeHtml(reopenedByName || "an administrator");

  const reasonBlock = reason && reason.trim()
    ? `<div style="background:#fffbeb;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:4px;margin:0 0 24px;">
         <p style="font-size:13px;font-weight:600;color:#92400e;margin:0 0 4px;">Note from ${safeReopener}:</p>
         <p style="font-size:14px;color:#92400e;margin:0;line-height:1.6;">${escapeHtml(reason)}</p>
       </div>`
    : "";

  const innerHtml = `
    <p style="font-size:20px;font-weight:700;color:${TEXT_PRIMARY};margin:0 0 4px;">${escapeHtml(content.headlineTitle)}</p>
    <p style="font-size:14px;color:${TEXT_MUTED};margin:0 0 28px;">${escapeHtml(content.headlineSubtitle)}</p>

    <p style="font-size:15px;color:${TEXT_SECONDARY};line-height:1.7;margin:0 0 16px;">
      Hi ${safeName},
    </p>
    <p style="font-size:15px;color:${TEXT_SECONDARY};line-height:1.7;margin:0 0 16px;">
      ${content.bodySentenceHtml}
    </p>

    ${reasonBlock}

    ${emailDivider()}

    <p style="font-size:12px;color:${TEXT_MUTED};margin:0;text-align:center;">
      This is an automated notification from CherryWorks Pro.
    </p>
  `;

  const reasonText = reason && reason.trim()
    ? `\n\nNote from ${reopenedByName || "an administrator"}: ${reason}`
    : "";

  return {
    to,
    subject: content.subject,
    html: wrapEmailLayout(innerHtml, { preheader: content.preheader }),
    text: `${content.headlineTitle}\n\nHi ${recipientName || "there"},\n\n${content.bodySentenceText}${reasonText}`,
    replyTo: smtpConfig?.replyTo ?? null,
    fromName: smtpConfig?.fromName ?? null,
    fromEmail: smtpConfig?.fromEmail ?? null,
  };
}

export async function sendTimesheetApprovedEmail(
  to: string,
  recipientName: string,
  weekStartDate: string,
  approverName: string,
  smtpConfig?: SmtpConfig | null,
  org?: OrgForTransport | null,
): Promise<{ messageId: string; previewUrl?: string }> {
  const transport = await pickTransport(org, smtpConfig);
  const safeWeek = escapeHtml(weekStartDate);
  const safeApprover = escapeHtml(approverName || "an administrator");

  const message = renderApprovedEmail(to, recipientName, {
    headlineTitle: "Timesheet Approved",
    headlineSubtitle: "Your week is now locked in",
    bodySentenceHtml: `Your timesheet for the <strong style="color:${TEXT_PRIMARY};">week of ${safeWeek}</strong> has been approved by ${safeApprover}.`,
    bodySentenceText: `Your timesheet for the week of ${weekStartDate} has been approved by ${approverName || "an administrator"}.`,
    successCalloutText: "No further action is needed on your part. Thanks for getting your hours in.",
    preheader: `Your week of ${weekStartDate} was approved`,
    subject: `Your week of ${weekStartDate} was approved`,
  }, smtpConfig);

  const result = await transport.send(message);
  return { messageId: result.messageId, previewUrl: result.previewUrl };
}

export async function sendTimesheetReopenedEmail(
  to: string,
  recipientName: string,
  weekStartDate: string,
  reopenedByName: string,
  reason: string | null | undefined,
  smtpConfig?: SmtpConfig | null,
  org?: OrgForTransport | null,
): Promise<{ messageId: string; previewUrl?: string }> {
  const transport = await pickTransport(org, smtpConfig);
  const safeWeek = escapeHtml(weekStartDate);
  const safeReopener = escapeHtml(reopenedByName || "an administrator");

  const message = renderReopenedEmail(to, recipientName, reopenedByName, reason, {
    headlineTitle: "Timesheet Re-opened",
    headlineSubtitle: "Your week is editable again",
    bodySentenceHtml: `Your timesheet for the <strong style="color:${TEXT_PRIMARY};">week of ${safeWeek}</strong> has been re-opened by ${safeReopener}. You can now make changes and resubmit it for approval.`,
    bodySentenceText: `Your timesheet for the week of ${weekStartDate} has been re-opened by ${reopenedByName || "an administrator"}. You can now make changes and resubmit it for approval.`,
    preheader: `Your week of ${weekStartDate} was re-opened`,
    subject: `Your week of ${weekStartDate} was re-opened`,
  }, smtpConfig);

  const result = await transport.send(message);
  return { messageId: result.messageId, previewUrl: result.previewUrl };
}

export async function sendExpenseApprovedEmail(
  to: string,
  recipientName: string,
  expenseLabel: string,
  approverName: string,
  smtpConfig?: SmtpConfig | null,
  org?: OrgForTransport | null,
): Promise<{ messageId: string; previewUrl?: string }> {
  const transport = await pickTransport(org, smtpConfig);
  const safeLabel = escapeHtml(expenseLabel);
  const safeApprover = escapeHtml(approverName || "an administrator");

  const message = renderApprovedEmail(to, recipientName, {
    headlineTitle: "Expense Approved",
    headlineSubtitle: "Your expense is approved",
    bodySentenceHtml: `Your expense <strong style="color:${TEXT_PRIMARY};">${safeLabel}</strong> has been approved by ${safeApprover}.`,
    bodySentenceText: `Your expense "${expenseLabel}" has been approved by ${approverName || "an administrator"}.`,
    successCalloutText: "No further action is needed on your part. If it's reimbursable, you'll see the payout once it's processed.",
    preheader: escapeHtml(`Your expense ${expenseLabel} was approved`),
    subject: `Your expense was approved — ${expenseLabel}`,
  }, smtpConfig);

  const result = await transport.send(message);
  return { messageId: result.messageId, previewUrl: result.previewUrl };
}

export async function sendExpenseReportApprovedEmail(
  to: string,
  recipientName: string,
  reportLabel: string,
  approverName: string,
  smtpConfig?: SmtpConfig | null,
  org?: OrgForTransport | null,
): Promise<{ messageId: string; previewUrl?: string }> {
  const transport = await pickTransport(org, smtpConfig);
  const safeLabel = escapeHtml(reportLabel);
  const safeApprover = escapeHtml(approverName || "an administrator");

  const message = renderApprovedEmail(to, recipientName, {
    headlineTitle: "Expense Report Approved",
    headlineSubtitle: "Your report is now locked in",
    bodySentenceHtml: `Your expense report <strong style="color:${TEXT_PRIMARY};">${safeLabel}</strong> has been approved by ${safeApprover}.`,
    bodySentenceText: `Your expense report "${reportLabel}" has been approved by ${approverName || "an administrator"}.`,
    successCalloutText: "No further action is needed on your part. Reimbursable expenses will be paid out per your org's process.",
    preheader: escapeHtml(`Your expense report ${reportLabel} was approved`),
    subject: `Your expense report was approved — ${reportLabel}`,
  }, smtpConfig);

  const result = await transport.send(message);
  return { messageId: result.messageId, previewUrl: result.previewUrl };
}

export async function sendExpenseReportReopenedEmail(
  to: string,
  recipientName: string,
  reportLabel: string,
  reopenedByName: string,
  reason: string | null | undefined,
  smtpConfig?: SmtpConfig | null,
  org?: OrgForTransport | null,
): Promise<{ messageId: string; previewUrl?: string }> {
  const transport = await pickTransport(org, smtpConfig);
  const safeLabel = escapeHtml(reportLabel);
  const safeReopener = escapeHtml(reopenedByName || "an administrator");

  const message = renderReopenedEmail(to, recipientName, reopenedByName, reason, {
    headlineTitle: "Expense Report Re-opened",
    headlineSubtitle: "Your report is editable again",
    bodySentenceHtml: `Your expense report <strong style="color:${TEXT_PRIMARY};">${safeLabel}</strong> has been re-opened by ${safeReopener}. You can now make changes and resubmit it for approval.`,
    bodySentenceText: `Your expense report "${reportLabel}" has been re-opened by ${reopenedByName || "an administrator"}. You can now make changes and resubmit it for approval.`,
    preheader: escapeHtml(`Your expense report ${reportLabel} was re-opened`),
    subject: `Your expense report was re-opened — ${reportLabel}`,
  }, smtpConfig);

  const result = await transport.send(message);
  return { messageId: result.messageId, previewUrl: result.previewUrl };
}

export function getSmtpConfigFromOrg(org: any): SmtpConfig | null {
  if (!org?.smtpHost || !org?.smtpPort || !org?.smtpUser || !org?.smtpPass) return null;
  try {
    return {
      host: org.smtpHost,
      port: org.smtpPort,
      user: org.smtpUser,
      pass: decryptSmtpPassword(org.smtpPass),
      fromName: org.smtpFromName || null,
      fromEmail: org.smtpFromEmail || null,
      replyTo: org.smtpReplyTo || null,
    };
  } catch {
    console.error("[email] Failed to decrypt SMTP password for org", org.id);
    return null;
  }
}
