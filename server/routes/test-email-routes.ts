import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth } from "./middleware";
import { isEmailOauthEnabled } from "../email/feature-flag";
import { sendViaConnectedMailbox } from "../email/send-via-connected-mailbox";
import {
  MissingMailboxError,
  EmailTransportError,
  type EmailProviderType,
} from "../email/types";
import type { OrgForTransport } from "../email/transport-selector";
import { structuredLog } from "../lib/logging";

const TestSendBody = z.object({
  to: z.string().email(),
});

type TestSendOutcome =
  | "ok"
  | "invalid_recipient"
  | "no_mailbox"
  | "oauth_disabled"
  | "rate_limited"
  | "token_expired"
  | "provider_error";

interface OrgRow extends OrgForTransport {
  name?: string | null;
}

// Fixed-window per-org cap: 10 sends/hour. Single-process; resets on
// redeploy. Postgres-backed counter is the upgrade path for multi-replica
// (tracked in Sprint 2g.10 follow-up #97).
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const buckets = new Map<string, { count: number; windowStart: number }>();

function checkRateLimit(orgId: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const b = buckets.get(orgId);
  if (!b || now - b.windowStart >= RATE_LIMIT_WINDOW_MS) {
    buckets.set(orgId, { count: 1, windowStart: now });
    return { allowed: true, retryAfterSec: 0 };
  }
  if (b.count >= RATE_LIMIT_MAX) {
    const retryAfterSec = Math.ceil(
      (RATE_LIMIT_WINDOW_MS - (now - b.windowStart)) / 1000,
    );
    return { allowed: false, retryAfterSec };
  }
  b.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}

export function __resetTestEmailRateLimit(): void {
  buckets.clear();
}

function logTestEmail(fields: {
  orgId: string;
  userId: string;
  provider: EmailProviderType | "unknown";
  recipient: string | null;
  outcome: TestSendOutcome;
  requestId?: string;
  providerStatus?: number;
}): void {
  structuredLog({ scope: "test-email", ...fields });
}

function buildBody(orgName: string, senderAddress: string | null): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `CherryWorks Pro — Test email from ${orgName}`;
  const sender = senderAddress || "your connected mailbox";
  const ts = new Date().toUTCString();
  const html = `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1a2e;background:#f8f9fa;padding:24px">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e5ec;border-radius:8px;padding:32px">
<h2 style="margin:0 0 12px;color:#1a1a2e">Test email from ${orgName}</h2>
<p style="margin:0 0 12px;color:#555770">Hi there,</p>
<p style="margin:0 0 12px;color:#555770">This is a connection test sent through CherryWorks Pro.</p>
<p style="margin:0 0 12px;color:#555770">Sender mailbox: <strong>${sender}</strong><br>Sent at: <strong>${ts}</strong></p>
<p style="margin:0;color:#555770">If you received this, your CherryWorks email connection is healthy.</p>
</div></body></html>`;
  const text = `Test email from ${orgName}\n\nThis is a connection test sent through CherryWorks Pro.\nSender mailbox: ${sender}\nSent at: ${ts}\n\nIf you received this, your CherryWorks email connection is healthy.`;
  return { subject, html, text };
}

export function registerTestEmailRoutes(app: Express): void {
  app.post("/api/email/test-send", requireAuth, async (req: Request, res: Response) => {
    const orgId = req.session.orgId!;
    const userId = req.session.userId!;
    const requestId = req.requestId;

    const parsed = TestSendBody.safeParse(req.body);
    if (!parsed.success) {
      logTestEmail({
        orgId,
        userId,
        provider: "unknown",
        recipient: typeof req.body?.to === "string" ? req.body.to : null,
        outcome: "invalid_recipient",
        requestId,
      });
      return res.status(400).json({
        ok: false,
        code: "invalid_recipient",
        error: "Recipient must be a valid email address.",
      });
    }
    const { to } = parsed.data;

    const orgRecord = (await storage.getOrg(orgId)) as OrgRow | undefined;
    if (!orgRecord) {
      logTestEmail({
        orgId,
        userId,
        provider: "unknown",
        recipient: to,
        outcome: "no_mailbox",
        requestId,
      });
      return res
        .status(404)
        .json({ ok: false, code: "no_mailbox", error: "Org not found." });
    }
    const providerType: EmailProviderType =
      (orgRecord.emailProviderType ?? "smtp") as EmailProviderType;

    if (
      !isEmailOauthEnabled() &&
      (providerType === "m365" || providerType === "google")
    ) {
      logTestEmail({
        orgId,
        userId,
        provider: providerType,
        recipient: to,
        outcome: "oauth_disabled",
        requestId,
      });
      return res.status(503).json({
        ok: false,
        code: "oauth_disabled",
        error: "OAuth mail disabled by admin.",
      });
    }

    const rl = checkRateLimit(orgId);
    if (!rl.allowed) {
      res.setHeader("Retry-After", String(rl.retryAfterSec));
      logTestEmail({
        orgId,
        userId,
        provider: providerType,
        recipient: to,
        outcome: "rate_limited",
        requestId,
      });
      return res.status(429).json({
        ok: false,
        code: "rate_limited",
        error: `Test send limit reached (${RATE_LIMIT_MAX} per hour). Try again in ${Math.ceil(
          rl.retryAfterSec / 60,
        )} min.`,
      });
    }

    const orgName = orgRecord.name || "your organization";
    const senderAddress = orgRecord.emailSenderAddress ?? null;
    const { subject, html, text } = buildBody(orgName, senderAddress);

    try {
      const result = await sendViaConnectedMailbox({
        orgId,
        to,
        subject,
        html,
        text,
      });
      logTestEmail({
        orgId,
        userId,
        provider: result.provider,
        recipient: to,
        outcome: "ok",
        requestId,
      });
      return res.json({
        ok: true,
        sentAt: result.sentAt,
        providerMessageId: result.providerMessageId,
        provider: result.provider,
      });
    } catch (e: unknown) {
      if (e instanceof MissingMailboxError) {
        logTestEmail({
          orgId,
          userId,
          provider: providerType,
          recipient: to,
          outcome: "no_mailbox",
          requestId,
        });
        return res.status(409).json({
          ok: false,
          code: "no_mailbox",
          error:
            "No mailbox is connected. Connect Microsoft 365 or Google Workspace in Settings → Email.",
        });
      }
      const transportErr = e instanceof EmailTransportError ? e : null;
      const rawMsg = transportErr
        ? transportErr.message
        : e instanceof Error
          ? e.message
          : "Provider send failed";
      const isAuth =
        transportErr !== null &&
        /token|401|invalid_grant|unauthorized|expired|revoked/i.test(rawMsg);
      const code: TestSendOutcome = isAuth ? "token_expired" : "provider_error";
      // Never include raw provider body or e.message in the response or logs —
      // it can carry refresh-token fragments, SMTP passwords from connection
      // strings, or recipient PII. Only stable codes are logged/returned.
      logTestEmail({
        orgId,
        userId,
        provider: providerType,
        recipient: to,
        outcome: code,
        requestId,
      });
      return res.status(502).json({
        ok: false,
        code,
        error: isAuth
          ? "Mailbox token expired or revoked. Click Reconnect and try again."
          : "The mail provider rejected the send. Please retry or check Settings → Email.",
        requestId,
      });
    }
  });
}
