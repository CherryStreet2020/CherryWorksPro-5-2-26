/**
 * Inbound email → Support Cases. Fed by the Microsoft 365 inbox reader
 * (server/support-inbound-graph.ts). The former Resend/Svix webhook was
 * removed 2026-09-07 ("we are ditching Resend").
 *
 * Inbound email (Resend → webhook) → Support Cases.
 *
 * 1. Verify the Svix signature when RESEND_WEBHOOK_SECRET is set (it always
 *    is in production; the check is skipped only when the secret is absent
 *    AND NODE_ENV is not production).
 * 2. Resolve the org from the recipient: an org whose
 *    support_inbound_address matches one of the `to` addresses. No match →
 *    store the raw email and stop. Never guess an org.
 * 3. If the subject carries a case key ([ABS-158] / ABS-158) that belongs
 *    to that org, append the email as a customer message on that case. The
 *    sender must be the case's requester or a Customer Admin of the case's
 *    client — the same rule the Help Center applies. A colleague who is a
 *    plain member cannot append to (or reopen) someone else's case by mail.
 * 4. Otherwise, if the sender is a known contact of the org, open a case.
 * 5. Anything else is stored for triage only.
 *
 * "Known contact" needs two things: the address is on a live, verified contact
 * (a Help Center placeholder whose link was never used does not count) AND the
 * receiving mailbox authenticated the sender (`senderAuthenticated`, from the
 * Authentication-Results header: dkim=pass or spf=pass). Without that evidence
 * a From: header is just text, so the mail is stored for triage — it never opens,
 * appends to, or reopens a case.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { inboundEmails, orgs, supportCases } from "@shared/schema";
import * as cases from "./support-cases";
import { findPortalContact, isPortalBlocked } from "./portal-auth";

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
  /** The receiving system verified the sender (SPF/DKIM pass). Unset/false = the From: header is untrusted. */
  senderAuthenticated?: boolean;
}): Promise<{ outcome: "no_org" | "appended" | "created" | "stored"; caseId?: string; caseKey?: string; orgId?: string; /** the verified sender's contact — attachments are stored under their authority */ contactId?: string }> {
  const recipients = allAddresses(input.to);
  const sender = parseAddress(input.from);
  if (!sender || (!input.orgId && recipients.length === 0)) return { outcome: "stored" };

  const [org] = await db.select({ id: orgs.id, name: orgs.name, address: orgs.supportInboundAddress }).from(orgs)
    .where(input.orgId ? eq(orgs.id, input.orgId) : sql`lower(${orgs.supportInboundAddress}) IN (${sql.join(recipients.map(r => sql`${r}`), sql`, `)})`);
  if (!org) return { outcome: "no_org" };

  const body = stripQuotedReply(input.text || "") || (input.html ? input.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "") || "(no text)";
  const found = await findPortalContact(org.id, sender.email);
  const blocked = found ? await isPortalBlocked(org.id, sender.email) : false;
  // A contact for mail purposes = verified (link used), authenticated sender, not shut out.
  const contact = input.senderAuthenticated && found && !found.portalPendingAt && !blocked ? found : undefined;
  const authorName = contact ? `${contact.firstName} ${contact.lastName}`.trim() : (sender.name || sender.email);

  const key = extractCaseKey(input.subject);
  if (key) {
    const [row] = await db.select().from(supportCases).where(and(eq(supportCases.orgId, org.id), eq(supportCases.caseKey, key)));
    if (row) {
      // Same rule as the Help Center: a verified, authenticated contact OF THIS CASE'S
      // CLIENT who is the requester or a Customer Admin. A bare address match is not
      // enough (an imported case may carry the address of someone at another client).
      // Same rule as the Help Center (cases.customerCanAccess): requester by id — by address ONLY
      // when the case has no linked requester — a Customer Admin, or a watcher; and the authority
      // is re-evaluated INSIDE addMessage under the case row lock, so a colleague removed while
      // this mail was in flight is still refused.
      const sameClient = !!contact && !!contact.clientId && contact.clientId === row.clientId;
      const access = sameClient ? await cases.customerCanAccess(db, org.id, row, contact!.id) : { ok: false, role: null };
      if (!access.ok) {
        // Denied: keep it for triage. Never fall through and open a second case.
        return { outcome: "stored", orgId: org.id };
      }
      try {
        const result = await cases.addMessage(org.id, row.id, {
          body, visibility: "CUSTOMER",
          author: { contactId: contact!.id, name: authorName },
          emailMessageId: input.messageId,
          authorize: (tx, c) => cases.customerCanAccess(tx, org.id, c, contact!.id, { lock: true }).then(r => r.ok),
        });
        if (result) {
          // addMessage() already notifies the assignee / managers.
          return { outcome: "appended", caseId: row.id, caseKey: row.caseKey, orgId: org.id, contactId: contact!.id };
        }
      } catch (err) {
        if (err instanceof cases.CaseAccessError) return { outcome: "stored", orgId: org.id };
        throw err;
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
