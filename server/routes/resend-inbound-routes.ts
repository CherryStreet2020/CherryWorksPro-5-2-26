/**
 * Inbound email (Resend → webhook) → Support Cases.
 *
 * 1. Verify the Svix signature when RESEND_WEBHOOK_SECRET is set (it always
 *    is in production; the check is skipped only when the secret is absent
 *    AND NODE_ENV is not production).
 * 2. Resolve the org from the recipient: an org whose
 *    support_inbound_address matches one of the `to` addresses. No match →
 *    store the raw email and stop. Never guess an org.
 * 3. If the subject carries a case key ([ABS-158] / ABS-158) that belongs
 *    to that org, append the email as a customer message on that case
 *    (the sender must be the requester or a contact of the case's client).
 * 4. Otherwise, if the sender is a known contact of the org, open a case.
 * 5. Anything else is stored for triage only.
 */
import type { Express, Request, Response } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { inboundEmails, orgs, supportCases } from "@shared/schema";
import { randomUUID } from "crypto";
import * as cases from "../support-cases";
import { findPortalContact } from "../portal-auth";

const CASE_KEY_RE = /\b([A-Z][A-Z0-9]{1,9}-\d{1,7})\b/;

export function extractCaseKey(subject: string | null | undefined): string | null {
  if (!subject) return null;
  const m = subject.match(CASE_KEY_RE);
  return m ? m[1] : null;
}

export function parseAddress(value: unknown): { email: string; name: string | null } | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  if (typeof raw === "object" && raw && "email" in (raw as any)) {
    const o = raw as { email?: string; name?: string };
    return o.email ? { email: o.email.toLowerCase(), name: o.name ?? null } : null;
  }
  if (typeof raw !== "string") return null;
  const m = raw.match(/^\s*(?:"?([^"<]*)"?\s*)?<([^>]+)>\s*$/);
  if (m) return { email: m[2].trim().toLowerCase(), name: (m[1] || "").trim() || null };
  const plain = raw.trim();
  return plain.includes("@") ? { email: plain.toLowerCase(), name: null } : null;
}

export function allAddresses(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list.map(v => parseAddress(v)?.email).filter((x): x is string => !!x);
}

/** Svix-style signature: v1,<base64 HMAC-SHA256 of "<id>.<timestamp>.<rawBody>">. */
export function verifySvixSignature(secret: string, headers: Record<string, string | undefined>, rawBody: Buffer | string): boolean {
  const id = headers["svix-id"];
  const ts = headers["svix-timestamp"];
  const sig = headers["svix-signature"];
  if (!id || !ts || !sig) return false;
  const skew = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(skew) || skew > 5 * 60) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${ts}.`).update(rawBody).digest("base64");
  return sig.split(" ").some(part => {
    const [, value] = part.split(",");
    if (!value) return false;
    const a = Buffer.from(value); const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

/** Strips a quoted reply ("On … wrote:" and everything below) from a plain-text body. */
export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (/^On .{5,200} wrote:\s*$/.test(line) || /^-{2,}\s*Original Message\s*-{2,}/i.test(line) || /^From: .+/.test(line) && out.length > 0) break;
    if (/^>/.test(line)) continue;
    out.push(line);
  }
  return out.join("\n").trim();
}

export async function processInboundEmail(input: {
  from: unknown; to: unknown; subject: string | null; text: string | null; html: string | null; messageId: string | null;
  /** Set by the Microsoft 365 poller: the mailbox already belongs to this org, so a reply carrying a case key routes there even when it was not sent to the support address. */
  orgId?: string;
}): Promise<{ outcome: "no_org" | "appended" | "created" | "stored"; caseId?: string; caseKey?: string; orgId?: string }> {
  const recipients = allAddresses(input.to);
  const sender = parseAddress(input.from);
  if (!sender || (!input.orgId && recipients.length === 0)) return { outcome: "stored" };

  const [org] = await db.select({ id: orgs.id, name: orgs.name, address: orgs.supportInboundAddress }).from(orgs)
    .where(input.orgId ? eq(orgs.id, input.orgId) : sql`lower(${orgs.supportInboundAddress}) IN (${sql.join(recipients.map(r => sql`${r}`), sql`, `)})`);
  if (!org) return { outcome: "no_org" };

  const body = stripQuotedReply(input.text || "") || (input.html ? input.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "") || "(no text)";
  const contact = await findPortalContact(org.id, sender.email);
  const authorName = contact ? `${contact.firstName} ${contact.lastName}`.trim() : (sender.name || sender.email);

  const key = extractCaseKey(input.subject);
  if (key) {
    const [row] = await db.select().from(supportCases).where(and(eq(supportCases.orgId, org.id), eq(supportCases.caseKey, key)));
    if (row) {
      const isRequester = !!row.requesterEmail && row.requesterEmail.toLowerCase() === sender.email;
      const isClientContact = !!contact && contact.clientId === row.clientId;
      if (isRequester || isClientContact) {
        const result = await cases.addMessage(org.id, row.id, {
          body, visibility: "CUSTOMER",
          author: { contactId: contact?.id ?? null, name: authorName },
          emailMessageId: input.messageId,
        });
        if (result) {
          // addMessage() already notifies the assignee / managers.
          return { outcome: "appended", caseId: row.id, caseKey: row.caseKey, orgId: org.id };
        }
      }
    }
  }

  if (contact && contact.clientId) {
    const created = await cases.createCase(org.id, {
      clientId: contact.clientId,
      subject: (input.subject || "").replace(CASE_KEY_RE, "").replace(/^\s*(re|fwd?):\s*/i, "").trim() || "(no subject)",
      description: body,
      requesterContactId: contact.id,
      requesterName: authorName,
      requesterEmail: sender.email,
      source: "EMAIL",
    }, null);
    // createCase() already emails the requester and alerts the team.
    return { outcome: "created", caseId: created.id, caseKey: created.caseKey, orgId: org.id };
  }

  return { outcome: "stored", orgId: org.id };
}

export function registerResendInboundRoutes(app: Express) {
  app.post("/api/webhooks/resend/inbound", async (req: Request, res: Response) => {
    try {
      const secret = process.env.RESEND_WEBHOOK_SECRET;
      if (secret) {
        const raw = (req as any).rawBody as Buffer | undefined;
        const ok = raw ? verifySvixSignature(secret, req.headers as Record<string, string | undefined>, raw) : false;
        if (!ok) return res.status(401).json({ message: "Invalid webhook signature" });
      } else if (process.env.NODE_ENV === "production") {
        console.error("[resend-inbound] RESEND_WEBHOOK_SECRET not configured; refusing inbound mail");
        return res.status(500).json({ message: "Webhook not configured" });
      }

      const body = req.body;
      if (!body || !body.type) return res.status(400).json({ message: "Invalid webhook payload" });
      if (body.type !== "email.received") return res.status(200).json({ message: "Event type ignored", type: body.type });

      const data = body.data || {};
      const emailId = randomUUID();
      const claimed = await db.insert(inboundEmails).values({
        id: emailId,
        from: typeof data.from === "string" ? data.from : JSON.stringify(data.from ?? "unknown"),
        to: typeof data.to === "string" ? data.to : JSON.stringify(data.to ?? "unknown"),
        subject: data.subject || null,
        bodyText: data.text || null,
        bodyHtml: data.html || null,
        headers: data.headers || null,
        resendMessageId: data.message_id || data.id || null,
      }).onConflictDoNothing({ target: inboundEmails.resendMessageId, where: sql`resend_message_id IS NOT NULL` }).returning({ id: inboundEmails.id });
      if (claimed.length === 0) {
        console.log(`[resend-inbound] duplicate delivery of ${data.message_id || data.id} ignored`);
        return res.status(200).json({ success: true, duplicate: true });
      }

      const result = await processInboundEmail({
        from: data.from, to: data.to, subject: data.subject ?? null, text: data.text ?? null, html: data.html ?? null,
        messageId: data.message_id || data.id || null,
      });
      console.log(`[resend-inbound] ${emailId} → ${result.outcome}${result.caseKey ? ` ${result.caseKey}` : ""}`);
      return res.status(200).json({ success: true, emailId, ...result });
    } catch (err: any) {
      console.error("[resend-inbound] Error processing webhook:", err.message);
      return res.status(500).json({ message: "Internal server error" });
    }
  });
}
