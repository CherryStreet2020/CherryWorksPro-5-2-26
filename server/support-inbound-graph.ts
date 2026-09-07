/**
 * Email → Support Cases through Microsoft 365 (Graph).
 *
 * Every two minutes, for each org whose connected mailbox is Microsoft 365
 * and whose support address is set, read the unread inbox messages that were
 * sent to the support address (or that carry one of the org's case keys in the
 * subject), hand each to the same processor the webhook uses, copy its file
 * attachments onto the case, and mark the message read. A message is never
 * processed twice: the ledger is the `inbound_emails` row keyed by the
 * internet message id.
 *
 * Reading mail needs the Mail.ReadWrite scope. Orgs connected before that
 * scope existed keep sending fine; the settings page tells them to reconnect
 * once, and this poller simply skips them until they do.
 */
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "./db";
import { inboundEmails, orgs, supportCases } from "@shared/schema";
import { refreshGraphAccessToken } from "./email/graph-transport";
import { processInboundEmail, extractCaseKey } from "./routes/resend-inbound-routes";
import { createAttachment, MAX_ATTACHMENT_BYTES } from "./support-attachments";
import { randomUUID } from "crypto";

const GRAPH = "https://graph.microsoft.com/v1.0";
/** 50 messages × 20 pages = the newest 1000 unread messages are scanned each pass. */
const MAX_PAGES = 20;
export const INBOUND_REQUIRED_SCOPE = "Mail.ReadWrite";

export function hasReadScope(scopes: string | null | undefined): boolean {
  const tokens = (scopes || "").toLowerCase().split(/[\s,]+/).map(t => t.replace(/^https:\/\/graph\.microsoft\.com\//, ""));
  return tokens.includes("mail.readwrite");
}

interface GraphMessage {
  id: string;
  subject?: string;
  internetMessageId?: string;
  receivedDateTime?: string;
  hasAttachments?: boolean;
  from?: { emailAddress?: { address?: string; name?: string } };
  toRecipients?: { emailAddress?: { address?: string; name?: string } }[];
  ccRecipients?: { emailAddress?: { address?: string; name?: string } }[];
  body?: { contentType?: string; content?: string };
  bodyPreview?: string;
}

async function graphGet<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${GRAPH}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  if (!res.ok) throw new Error(`Graph ${res.status} on ${path.split("?")[0]}`);
  return res.json() as Promise<T>;
}

async function graphPatch(token: string, path: string, body: unknown): Promise<void> {
  const res = await fetch(`${GRAPH}${path}`, { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Graph ${res.status} on ${path}`);
}

export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h[1-6])>/gi, "\n\n")
    .replace(/<\/(div|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Messages the poller should pick up: addressed to the support address, or carrying one of the org's case keys. */
export function isRelevant(msg: GraphMessage, supportAddress: string, orgPrefixes: Set<string>): boolean {
  const addr = supportAddress.toLowerCase();
  const rcpts = [...(msg.toRecipients || []), ...(msg.ccRecipients || [])].map(r => (r.emailAddress?.address || "").toLowerCase());
  if (rcpts.includes(addr)) return true;
  const key = extractCaseKey(msg.subject);
  return !!key && orgPrefixes.has(key.split("-")[0]);
}

export interface GraphPollResult { orgId: string; scanned: number; processed: number; skipped: number; outcomes: Record<string, number>; error?: string }

export async function pollOrg(org: { id: string; supportInboundAddress: string; emailOauthScopes: string | null; emailOauthRefreshToken: string | null; emailProviderType: string; emailOauthStatus?: string | null }): Promise<GraphPollResult> {
  const result: GraphPollResult = { orgId: org.id, scanned: 0, processed: 0, skipped: 0, outcomes: {} };
  if (!hasReadScope(org.emailOauthScopes)) { result.error = `mailbox needs reconnect for ${INBOUND_REQUIRED_SCOPE}`; return result; }
  const token = await refreshGraphAccessToken(org as any);
  const prefixes = new Set((await db.select({ k: supportCases.caseKey }).from(supportCases).where(eq(supportCases.orgId, org.id))).map(r => r.k.split("-")[0]));

  // Unrelated unread mail stays unread, so a fixed first page would show the
  // same old messages every pass and never reach newer support mail. Walk the
  // unread set newest-first through @odata.nextLink, bounded by MAX_PAGES.
  const relevant: GraphMessage[] = [];
  let next: string | null = `/me/mailFolders/inbox/messages?$filter=isRead eq false&$top=50&$orderby=receivedDateTime desc&$select=id,subject,internetMessageId,receivedDateTime,hasAttachments,from,toRecipients,ccRecipients,body,bodyPreview`;
  for (let pages = 0; next && pages < MAX_PAGES; pages++) {
    const page: { value?: GraphMessage[]; "@odata.nextLink"?: string } = await graphGet(token, next);
    for (const msg of page.value || []) {
      result.scanned++;
      if (isRelevant(msg, org.supportInboundAddress, prefixes)) relevant.push(msg); else result.skipped++;
    }
    const link = page["@odata.nextLink"];
    next = link ? link.replace(GRAPH, "") : null;
  }
  // Oldest first so a thread's replies land in order.
  relevant.sort((a, b) => (a.receivedDateTime || "").localeCompare(b.receivedDateTime || ""));

  for (const msg of relevant) {
    const messageId = msg.internetMessageId || `graph:${msg.id}`;

    const text = msg.body?.contentType?.toLowerCase() === "html" ? htmlToText(msg.body.content || "") : (msg.body?.content || msg.bodyPreview || "");
    const from = msg.from?.emailAddress?.address ? `${msg.from.emailAddress.name || ""} <${msg.from.emailAddress.address}>` : "unknown";
    const to = (msg.toRecipients || []).map(r => r.emailAddress?.address || "").filter(Boolean);

    // Claim the message: the unique index on the ledger makes this the single
    // point where two overlapping passes are serialised. Loser skips.
    const emailId = randomUUID();
    const claimed = await db.insert(inboundEmails).values({
      id: emailId, from, to: JSON.stringify(to), subject: msg.subject || null, bodyText: text || null,
      bodyHtml: msg.body?.contentType?.toLowerCase() === "html" ? (msg.body.content || null) : null,
      headers: { source: "m365-graph", graphId: msg.id, receivedDateTime: msg.receivedDateTime ?? null }, resendMessageId: messageId,
    }).onConflictDoNothing({ target: inboundEmails.resendMessageId, where: sql`resend_message_id IS NOT NULL` }).returning({ id: inboundEmails.id });
    if (claimed.length === 0) { result.skipped++; await graphPatch(token, `/me/messages/${msg.id}`, { isRead: true }).catch(() => {}); continue; }

    let outcome: Awaited<ReturnType<typeof processInboundEmail>>;
    try {
      outcome = await processInboundEmail({ from, to, subject: msg.subject ?? null, text, html: null, messageId, orgId: org.id });
    } catch (err) {
      // Leave the mail unread and drop the ledger row so the next pass can retry it.
      await db.delete(inboundEmails).where(eq(inboundEmails.id, emailId)).catch(() => {});
      throw err;
    }
    result.outcomes[outcome.outcome] = (result.outcomes[outcome.outcome] || 0) + 1;
    result.processed++;

    if (outcome.caseId && msg.hasAttachments) {
      try {
        const atts = await graphGet<{ value: any[] }>(token, `/me/messages/${msg.id}/attachments?$select=id,name,contentType,size,isInline,@odata.type`);
        for (const a of atts.value || []) {
          if (a["@odata.type"] !== "#microsoft.graph.fileAttachment" || (a.size ?? 0) > MAX_ATTACHMENT_BYTES) continue;
          const full = await graphGet<{ contentBytes?: string; name?: string; contentType?: string }>(token, `/me/messages/${msg.id}/attachments/${a.id}`);
          if (!full.contentBytes) continue;
          await createAttachment({ orgId: org.id, caseId: outcome.caseId, filename: full.name || a.name || "attachment", mimeType: full.contentType || a.contentType || "application/octet-stream", bytes: Buffer.from(full.contentBytes, "base64"), source: "EMAIL", externalRef: `M365:${msg.id}:${a.id}` }).catch(err => console.warn("[support-inbound-graph] attachment failed", (err as Error).message));
        }
      } catch (err) {
        console.warn("[support-inbound-graph] attachments failed", (err as Error).message);
      }
    }
    await graphPatch(token, `/me/messages/${msg.id}`, { isRead: true }).catch(() => {});
  }
  return result;
}

/** One pass over every org that has a Microsoft 365 mailbox and a support address. */
export async function runInboundGraphPass(): Promise<GraphPollResult[]> {
  const rows = await db.select({
    id: orgs.id, supportInboundAddress: orgs.supportInboundAddress, emailOauthScopes: orgs.emailOauthScopes,
    emailOauthRefreshToken: orgs.emailOauthRefreshToken, emailProviderType: orgs.emailProviderType, emailOauthStatus: orgs.emailOauthStatus,
  }).from(orgs).where(and(eq(orgs.emailProviderType, "m365"), isNotNull(orgs.supportInboundAddress), isNotNull(orgs.emailOauthRefreshToken), sql`${orgs.emailOauthStatus} = 'ok'`));
  const out: GraphPollResult[] = [];
  for (const org of rows) {
    if (!org.supportInboundAddress) continue;
    try {
      const r = await pollOrg({ ...org, supportInboundAddress: org.supportInboundAddress });
      if (r.processed > 0 || r.error) console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", event: "SUPPORT_INBOUND_GRAPH", ...r }));
      out.push(r);
    } catch (err) {
      console.warn(JSON.stringify({ ts: new Date().toISOString(), level: "warn", event: "SUPPORT_INBOUND_GRAPH_FAILED", orgId: org.id, error: (err as Error).message }));
      out.push({ orgId: org.id, scanned: 0, processed: 0, skipped: 0, outcomes: {}, error: (err as Error).message });
    }
  }
  return out;
}

let interval: NodeJS.Timeout | null = null;
export function startInboundGraphProcessor(): void {
  if (interval) return;
  interval = setInterval(() => { void runInboundGraphPass(); }, 2 * 60 * 1000);
  console.log("[support-inbound-graph] Microsoft 365 inbox reader started (2min interval)");
}
export function stopInboundGraphProcessor(): void {
  if (interval) { clearInterval(interval); interval = null; }
}
