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
import * as cases from "./support-cases";
import { inboundEmails, orgs, supportCases } from "@shared/schema";
import { refreshGraphAccessToken } from "./email/graph-transport";
import { processInboundEmail, extractCaseKey } from "./inbound-email";
import { createAttachment, MAX_ATTACHMENT_BYTES } from "./support-attachments";
import { randomUUID } from "crypto";

const GRAPH = "https://graph.microsoft.com/v1.0";
/** 50 messages × 20 pages = the newest 1000 unread messages are scanned each pass. */
const MAX_PAGES = 20;
/** Targeted support-address search: 100 × 10 pages of recipient matches (read and unread). */
const MAX_SEARCH_PAGES = 10;
/** A claim older than this is not an in-flight pass any more (passes run every 2 min, bounded by page cap). */
const CLAIM_IN_FLIGHT_MS = 10 * 60 * 1000;
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
  isRead?: boolean;
  from?: { emailAddress?: { address?: string; name?: string } };
  toRecipients?: { emailAddress?: { address?: string; name?: string } }[];
  ccRecipients?: { emailAddress?: { address?: string; name?: string } }[];
  body?: { contentType?: string; content?: string };
  bodyPreview?: string;
  internetMessageHeaders?: { name?: string; value?: string }[];
}

/**
 * Did the receiving mailbox authenticate the sender for the address it claims?
 *
 * Ingestion contract (Exchange Online, the only mailbox provider CWP reads):
 *  - EXO stamps its own `Authentication-Results` on every message it accepts. Its
 *    value starts directly with a method (`spf=… smtp.mailfrom=…; dkim=… header.d=…;
 *    dmarc=… header.from=…; compauth=…`) — there is NO authserv-id prefix, whereas a
 *    foreign header carries one (`mx.google.com; dkim=pass …`). Foreign headers are
 *    not removed by EXO, so provenance is decided by SHAPE, not position.
 *  - EXO also stamps `X-MS-Exchange-Organization-AuthSource` on mail it processed;
 *    organization headers are stripped from anything arriving from outside, so their
 *    presence proves the message went through this tenant's EXO.
 * Fail closed: no AuthSource header, or anything other than EXACTLY ONE EXO-shaped
 * Authentication-Results (a second one means the sender injected a look-alike, or the
 * mail hopped through another tenant — provenance is ambiguous either way) → false.
 * Then, from the EXO header only, the sender is authenticated for the claimed From:
 * domain when dmarc=pass carries header.from= aligned with it, or dkim=pass has
 * header.d= aligned, or spf=pass has smtp.mailfrom= aligned. A pass for an unrelated
 * domain is ignored; compauth alone never counts.
 */
export function senderAuthenticatedFromHeaders(headers: { name?: string; value?: string }[] | undefined, fromAddress: string | null | undefined): boolean {
  if (!headers || !fromAddress) return false;
  const at = fromAddress.lastIndexOf("@");
  const fromDomain = at < 0 ? "" : fromAddress.slice(at + 1).trim().toLowerCase().replace(/>.*$/, "");
  if (!fromDomain) return false;
  const lower = (n?: string) => (n || "").toLowerCase();
  if (!headers.some(h => lower(h.name) === "x-ms-exchange-organization-authsource" && (h.value || "").trim())) return false;
  // Provenance: EXO writes exactly one header of its own shape. A message that carries
  // two (one injected by the sender, or a hop through another tenant) is ambiguous and
  // fails closed — syntax alone cannot tell the receiver's verdict from a forged one.
  const exoShaped = headers.filter(h => lower(h.name) === "authentication-results" && /^\s*(spf|dkim|dmarc|compauth)=/i.test(h.value || ""));
  if (exoShaped.length !== 1) return false;
  const exo = exoShaped[0];
  const aligned = (d: string) => !!d && (d === fromDomain || fromDomain.endsWith("." + d) || d.endsWith("." + fromDomain));
  // Structured parse: one clause per method, split on ';', properties as key=value.
  for (const clause of (exo.value || "").split(";")) {
    const m = clause.trim().toLowerCase().match(/^(spf|dkim|dmarc)=(\w+)/);
    if (!m || m[2] !== "pass") continue;
    const prop = (k: string) => clause.toLowerCase().match(new RegExp(`\\b${k}=(?:[^\\s@;]+@)?([a-z0-9.-]+)`))?.[1] ?? "";
    if (m[1] === "dmarc" && aligned(prop("header.from"))) return true;
    if (m[1] === "dkim" && aligned(prop("header.d"))) return true;
    if (m[1] === "spf" && aligned(prop("smtp.mailfrom"))) return true;
  }
  return false;
}

/** `path` is relative to GRAPH, or an absolute Graph URL (e.g. an @odata.nextLink). */
async function graphGet<T>(token: string, path: string, extraHeaders: Record<string, string> = {}): Promise<T> {
  const url = path.startsWith("https://") ? path : `${GRAPH}${path}`;
  if (!url.startsWith(GRAPH)) throw new Error("Refusing non-Graph URL");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...extraHeaders } });
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

/**
 * Messages the poller should pick up: addressed to the support address, or
 * carrying the EXACT key of one of the org's existing cases. A merely
 * prefix-shaped subject on ordinary mailbox traffic is not enough: it would
 * otherwise reach the "open a new case" path (Codex P2 on #52).
 */
export function isRelevant(msg: GraphMessage, supportAddress: string, orgCaseKeys: Set<string>): boolean {
  const addr = supportAddress.toLowerCase();
  const rcpts = [...(msg.toRecipients || []), ...(msg.ccRecipients || [])].map(r => (r.emailAddress?.address || "").toLowerCase());
  if (rcpts.includes(addr)) return true;
  const key = extractCaseKey(msg.subject);
  return !!key && orgCaseKeys.has(key);
}

export interface GraphPollResult { orgId: string; scanned: number; processed: number; skipped: number; outcomes: Record<string, number>; error?: string }

export async function pollOrg(org: { id: string; supportInboundAddress: string; emailOauthScopes: string | null; emailOauthRefreshToken: string | null; emailProviderType: string; emailOauthStatus?: string | null }): Promise<GraphPollResult> {
  const result: GraphPollResult = { orgId: org.id, scanned: 0, processed: 0, skipped: 0, outcomes: {} };
  if (!hasReadScope(org.emailOauthScopes)) { result.error = `mailbox needs reconnect for ${INBOUND_REQUIRED_SCOPE}`; return result; }
  const token = await refreshGraphAccessToken(org as any);
  const caseKeys = new Set((await db.select({ k: supportCases.caseKey }).from(supportCases).where(eq(supportCases.orgId, org.id))).map(r => r.k));

  // Unrelated unread mail stays unread, so a fixed first page would show the
  // same old messages every pass and never reach newer support mail. Walk the
  // unread set newest-first through @odata.nextLink, bounded by MAX_PAGES.
  const relevant: GraphMessage[] = [];
  let next: string | null = `/me/mailFolders/inbox/messages?$filter=isRead eq false&$top=50&$orderby=receivedDateTime desc&$select=id,subject,internetMessageId,receivedDateTime,hasAttachments,from,toRecipients,ccRecipients,body,bodyPreview,internetMessageHeaders`;
  for (let pages = 0; next && pages < MAX_PAGES; pages++) {
    const page: { value?: GraphMessage[]; "@odata.nextLink"?: string } = await graphGet(token, next);
    for (const msg of page.value || []) {
      result.scanned++;
      if (isRelevant(msg, org.supportInboundAddress, caseKeys)) relevant.push(msg); else result.skipped++;
    }
    const link = page["@odata.nextLink"];
    next = link || null;
  }
  // Beyond the page cap a large unread backlog could hide older support mail
  // forever (no cursor is kept, unrelated mail stays unread). A second,
  // targeted query asks Graph for mail sent to the support address itself,
  // independent of how much newer unrelated mail sits above it.
  try {
    const seen = new Set(relevant.map(m => m.id));
    const search = encodeURIComponent(`"recipients:${org.supportInboundAddress}"`);
    // $search needs ConsistencyLevel: eventual, cannot be combined with $filter,
    // and returns read mail too; so page through it (bounded) and keep the unread.
    let next: string | null = `/me/messages?$search=${search}&$top=100&$select=id,subject,internetMessageId,receivedDateTime,hasAttachments,isRead,from,toRecipients,ccRecipients,body,bodyPreview,internetMessageHeaders`;
    for (let pages = 0; next && pages < MAX_SEARCH_PAGES; pages++) {
      const targeted: { value?: GraphMessage[]; "@odata.nextLink"?: string } = await graphGet(token, next, { ConsistencyLevel: "eventual" });
      for (const msg of targeted.value || []) {
        if (msg.isRead !== false || seen.has(msg.id)) continue;
        if (isRelevant(msg, org.supportInboundAddress, caseKeys)) { relevant.push(msg); seen.add(msg.id); }
      }
      const link = targeted["@odata.nextLink"];
      next = link || null;
    }
  } catch (err) {
    console.warn("[support-inbound-graph] targeted search failed", (err as Error).message);
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
      headers: { source: "m365-graph", graphId: msg.id, receivedDateTime: msg.receivedDateTime ?? null, senderAuthenticated: senderAuthenticatedFromHeaders(msg.internetMessageHeaders, msg.from?.emailAddress?.address) }, resendMessageId: messageId,
    }).onConflictDoNothing({ target: inboundEmails.resendMessageId, where: sql`resend_message_id IS NOT NULL` }).returning({ id: inboundEmails.id });
    if (claimed.length === 0) {
      // Lost the claim. A pass still in flight marks the mail read itself (and
      // drops its row on failure, so the mail is retried). A row older than the
      // in-flight window is a finished claim whose isRead PATCH failed: mark it
      // read now so it stops occupying the unread window.
      result.skipped++;
      const [prior] = await db.select({ createdAt: inboundEmails.createdAt }).from(inboundEmails).where(eq(inboundEmails.resendMessageId, messageId)).limit(1);
      if (prior && Date.now() - prior.createdAt.getTime() > CLAIM_IN_FLIGHT_MS) await graphPatch(token, `/me/messages/${msg.id}`, { isRead: true }).catch(() => {});
      continue;
    }

    let outcome: Awaited<ReturnType<typeof processInboundEmail>>;
    try {
      outcome = await processInboundEmail({ from, to, subject: msg.subject ?? null, text, html: null, messageId, orgId: org.id, senderAuthenticated: senderAuthenticatedFromHeaders(msg.internetMessageHeaders, msg.from?.emailAddress?.address) });
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
          // Stored under the sender's authority: a customer whose access was revoked between the
          // message and its files gets the files refused (an agent-created case from a new mail has none to check).
          await createAttachment({
            orgId: org.id, caseId: outcome.caseId, filename: full.name || a.name || "attachment", mimeType: full.contentType || a.contentType || "application/octet-stream",
            bytes: Buffer.from(full.contentBytes, "base64"), source: "EMAIL", externalRef: `M365:${msg.id}:${a.id}`, uploadedByContactId: outcome.contactId ?? null,
            authorize: outcome.contactId ? (tx) => cases.customerCanAccessCase(tx, org.id, outcome.caseId!, outcome.contactId!, { lock: true }) : undefined,
          }).catch(err => console.warn("[support-inbound-graph] attachment failed", (err as Error).message));
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
