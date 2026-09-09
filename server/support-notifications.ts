/**
 * Who hears about what on a Support Case, and how.
 *
 * Every hook here is fire-and-forget: a failed email or notification must
 * never fail the action that triggered it. Recipients:
 *  - the requester (email only) — case opened, agent reply, waiting on you,
 *    resolved
 *  - the assignee (in-app + email) — assigned, customer message, SLA
 *  - when there is no assignee, every active admin/manager gets the
 *    "new case" and "customer message" alerts so nothing sits unseen.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "./db";
import { orgs, users, clientContacts, supportCaseWatchers, portalBlockedEmails, type SupportCase } from "@shared/schema";
import { storage } from "./storage";
import { sendCaseEmail } from "./email";
import { createNotification } from "./routes/notification-center-routes";
import { portalBaseUrl } from "./portal-auth";
import type { SlaAlert } from "./support-sla";

const log = (event: string, extra: Record<string, unknown>) => console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", event, ...extra }));
const warn = (event: string, extra: Record<string, unknown>) => console.warn(JSON.stringify({ ts: new Date().toISOString(), level: "warn", event, ...extra }));

async function orgContext(orgId: string) {
  const org = await storage.getOrg(orgId);
  if (!org) return null;
  const base = portalBaseUrl();
  return {
    org,
    agentUrl: (caseId: string) => `${base}/support/cases/${caseId}`,
    // Customers read and answer cases in the Help Center (support only; never money).
    portalUrl: (caseId: string) => `${base}/help/${org.slug}/cases/${caseId}`,
  };
}

async function agentEmails(orgId: string, userIds: string[]): Promise<Array<{ id: string; email: string; name: string }>> {
  if (userIds.length === 0) return [];
  return db.select({ id: users.id, email: users.email, name: users.name }).from(users)
    .where(and(eq(users.orgId, orgId), eq(users.isActive, true), inArray(users.id, userIds)));
}

async function managers(orgId: string): Promise<Array<{ id: string; email: string; name: string }>> {
  return db.select({ id: users.id, email: users.email, name: users.name }).from(users)
    .where(and(eq(users.orgId, orgId), eq(users.isActive, true), inArray(users.role, ["ADMIN", "MANAGER"])));
}

/**
 * Everyone on the customer side who should hear about this case, resolved AT SEND TIME from live
 * rows — never from addresses copied onto the case earlier:
 *  - the requester: with a linked contact → that contact's CURRENT email, only while the contact
 *    belongs to the case's org + client, is not deleted and not blocked (a stale requester_email is
 *    never used); with no linked contact (legacy / email-only cases) → requester_email unless blocked;
 *  - every watcher (live, same client, unblocked);
 * deduplicated by address. `exclude` drops the person who caused the mail (no echo).
 */
export type CustomerRecipient = { email: string; name: string | null; contactId: string | null; role: "requester" | "watcher" | "reviewer" };
export async function customerRecipients(c: Pick<SupportCase, "id" | "orgId" | "clientId" | "requesterContactId" | "requesterEmail">, exclude?: { contactId?: string | null; email?: string | null }): Promise<CustomerRecipient[]> {
  const out = new Map<string, CustomerRecipient>();
  const blocked = new Set((await db.select({ email: portalBlockedEmails.email }).from(portalBlockedEmails).where(eq(portalBlockedEmails.orgId, c.orgId))).map(r => r.email.toLowerCase()));
  const add = (email: string | null | undefined, name: string | null, contactId: string | null, role: CustomerRecipient["role"]) => {
    const e = (email || "").trim().toLowerCase();
    if (!e || blocked.has(e) || out.has(e)) return;
    if (exclude?.contactId && contactId && exclude.contactId === contactId) return;
    if (exclude?.email && exclude.email.trim().toLowerCase() === e) return;
    out.set(e, { email: e, name, contactId, role });
  };
  if (c.requesterContactId) {
    const [r] = await db.select({ id: clientContacts.id, email: clientContacts.email, firstName: clientContacts.firstName, lastName: clientContacts.lastName }).from(clientContacts)
      .where(and(eq(clientContacts.id, c.requesterContactId), eq(clientContacts.orgId, c.orgId), eq(clientContacts.clientId, c.clientId), isNull(clientContacts.deletedAt)));
    if (r) add(r.email, `${r.firstName} ${r.lastName}`.trim() || null, r.id, "requester");
  } else {
    add(c.requesterEmail, null, null, "requester");
  }
  const ws = await db.select({ id: clientContacts.id, email: clientContacts.email, firstName: clientContacts.firstName, lastName: clientContacts.lastName, role: supportCaseWatchers.role }).from(supportCaseWatchers)
    .innerJoin(clientContacts, eq(clientContacts.id, supportCaseWatchers.contactId))
    .where(and(eq(supportCaseWatchers.caseId, c.id), eq(supportCaseWatchers.orgId, c.orgId), eq(clientContacts.clientId, c.clientId), isNull(clientContacts.deletedAt)));
  for (const w of ws) add(w.email, `${w.firstName} ${w.lastName}`.trim() || null, w.id, w.role === "reviewer" ? "reviewer" : "watcher");
  return [...out.values()];
}

/** Reviewers are review only: their mails never invite a reply (an emailed reply would be stored, not added). */
const REVIEWER_FOOTER = "You're reviewing this case (review only). Replies to this email are not added to the case.";
function ctaFor(r: CustomerRecipient, replyText: string) {
  return r.role === "reviewer" ? { ctaText: "View the case", footer: REVIEWER_FOOTER } : { ctaText: replyText };
}

/**
 * Re-checked immediately before each send (one contact, not the whole list): a colleague removed
 * or blocked while an earlier mail went out gets nothing.
 */
async function stillRecipient(c: Parameters<typeof customerRecipients>[0], r: { email: string; contactId: string | null }): Promise<boolean> {
  const [b] = await db.select({ id: portalBlockedEmails.id }).from(portalBlockedEmails).where(and(eq(portalBlockedEmails.orgId, c.orgId), eq(portalBlockedEmails.email, r.email)));
  if (b) return false;
  if (!r.contactId) return !c.requesterContactId && (c.requesterEmail || "").trim().toLowerCase() === r.email; // legacy email-only requester
  const [k] = await db.select({ email: clientContacts.email }).from(clientContacts)
    .where(and(eq(clientContacts.id, r.contactId), eq(clientContacts.orgId, c.orgId), eq(clientContacts.clientId, c.clientId), isNull(clientContacts.deletedAt)));
  if (!k || (k.email || "").trim().toLowerCase() !== r.email) return false;
  if (c.requesterContactId === r.contactId) return true;
  const [w] = await db.select({ id: supportCaseWatchers.id }).from(supportCaseWatchers).where(and(eq(supportCaseWatchers.orgId, c.orgId), eq(supportCaseWatchers.caseId, c.id), eq(supportCaseWatchers.contactId, r.contactId)));
  return !!w;
}

async function safeEmail(label: string, fn: () => Promise<unknown>) {
  try { await fn(); log("SUPPORT_EMAIL_SENT", { label }); }
  catch (err) { warn("SUPPORT_EMAIL_FAILED", { label, error: (err as Error)?.message }); }
}

async function safeNotify(input: Parameters<typeof createNotification>[0]) {
  try { await createNotification(input); }
  catch (err) { warn("SUPPORT_NOTIFY_FAILED", { type: input.type, error: (err as Error)?.message }); }
}

/** A case was opened (by an agent, from the portal, or from an email). */
export async function notifyCaseCreated(c: SupportCase, opts: { openedBy?: { name: string; contactId?: string | null } } = {}): Promise<void> {
  const ctx = await orgContext(c.orgId);
  if (!ctx) return;
  const { org } = ctx;

  if (c.source !== "AGENT") {
    // Requester + watchers, resolved now (a colleague added as a watcher at creation hears too).
    // "On behalf of": the admin who opened it is a watcher and hears as one; the requester is told who did it.
    for (const r of await customerRecipients(c)) {
      if (!(await stillRecipient(c, r))) continue;
      const isRequester = c.requesterContactId ? r.contactId === c.requesterContactId : r.email === (c.requesterEmail || "").toLowerCase();
      const first = (r.name || c.requesterName || "").split(" ")[0];
      await safeEmail(isRequester ? "case.created→requester" : "case.created→watcher", () => sendCaseEmail({
        to: r.email, org, orgName: org.name, caseKey: c.caseKey, subject: c.subject,
        heading: isRequester ? `We've received your request` : `You're following ${c.caseKey}`,
        intro: isRequester
          ? `Thanks${first ? `, ${first}` : ""}. ${opts.openedBy && opts.openedBy.contactId !== c.requesterContactId ? `${opts.openedBy.name} opened this case on your behalf. ` : ""}Your case is ${c.caseKey}. We'll reply here and in the Help Center as soon as someone picks it up.`
          : `${c.requesterName || "A colleague"} opened ${c.caseKey} and added you so you can follow it.`,
        body: c.description, ctaUrl: ctx.portalUrl(c.id), ...ctaFor(r, "View your case"),
      }));
    }
  }

  const targets = c.assigneeUserId ? await agentEmails(c.orgId, [c.assigneeUserId]) : await managers(c.orgId);
  for (const u of targets) {
    await safeNotify({ orgId: c.orgId, userId: u.id, type: "case.new", title: `${c.caseKey} opened`, message: c.subject, link: `/support/cases/${c.id}`, metadata: { caseId: c.id, caseKey: c.caseKey } });
    if (c.source !== "AGENT") {
      await safeEmail("case.created→agent", () => sendCaseEmail({
        to: u.email, org, orgName: org.name, caseKey: c.caseKey, subject: c.subject,
        heading: `New support case from ${c.requesterName || c.requesterEmail || "a customer"}`,
        intro: c.assigneeUserId ? "It's assigned to you." : "It isn't assigned yet.",
        body: c.description, ctaText: "Open the case", ctaUrl: ctx.agentUrl(c.id), footer: "You're receiving this because you're on the support team.",
      }));
    }
  }
}

/** Someone posted a customer-visible message. */
export async function notifyCaseMessage(c: SupportCase, msg: { authorUserId: string | null; authorName: string; body: string; visibility: string }): Promise<void> {
  if (msg.visibility !== "CUSTOMER") return;
  const ctx = await orgContext(c.orgId);
  if (!ctx) return;
  const { org } = ctx;
  const fromAgent = !!msg.authorUserId;

  if (fromAgent) {
    for (const r of await customerRecipients(c)) {
      if (!(await stillRecipient(c, r))) continue;
      await safeEmail("case.reply→customer", () => sendCaseEmail({
        to: r.email, org, orgName: org.name, caseKey: c.caseKey, subject: c.subject,
        heading: `${msg.authorName} replied`, intro: `There's a new reply on case ${c.caseKey}.`,
        body: msg.body, ctaUrl: ctx.portalUrl(c.id), ...ctaFor(r, "Reply in the Help Center"),
      }));
    }
    return;
  }

  const targets = c.assigneeUserId ? await agentEmails(c.orgId, [c.assigneeUserId]) : await managers(c.orgId);
  for (const u of targets) {
    await safeNotify({ orgId: c.orgId, userId: u.id, type: "case.customer_message", title: `${c.caseKey}: ${msg.authorName} replied`, message: msg.body.length > 160 ? msg.body.slice(0, 160) + "…" : msg.body, link: `/support/cases/${c.id}`, metadata: { caseId: c.id, caseKey: c.caseKey } });
    await safeEmail("case.customer_message→agent", () => sendCaseEmail({
      to: u.email, org, orgName: org.name, caseKey: c.caseKey, subject: c.subject,
      heading: `${msg.authorName} replied on ${c.caseKey}`, intro: c.assigneeUserId ? "This case is assigned to you." : "This case isn't assigned yet.",
      body: msg.body, ctaText: "Open the case", ctaUrl: ctx.agentUrl(c.id), footer: "You're receiving this because you're on the support team.",
    }));
  }
}

/** Assignee or status changed. */
export async function notifyCaseUpdated(before: SupportCase, after: SupportCase, actor: { userId: string | null; name: string }): Promise<void> {
  const ctx = await orgContext(after.orgId);
  if (!ctx) return;
  const { org } = ctx;

  // A Customer Admin changed the case from the Help Center: the customer side already
  // knows, so tell the team (assignee, else managers) and skip the requester mails.
  if (!actor.userId) {
    const changes: string[] = [];
    if (after.status !== before.status) changes.push(after.status === "CLOSED" ? "closed" : (before.status === "RESOLVED" || before.status === "CLOSED") ? "reopened" : `moved to ${after.status.toLowerCase().replace(/_/g, " ")}`);
    if (after.priority !== before.priority) changes.push(`set priority to ${after.priority.toLowerCase()}`);
    if (changes.length === 0) return;
    const what = changes.join(" and ");
    const targets = after.assigneeUserId ? await agentEmails(after.orgId, [after.assigneeUserId]) : await managers(after.orgId);
    for (const u of targets) {
      await safeNotify({ orgId: after.orgId, userId: u.id, type: "case.customer_update", title: `${after.caseKey}: ${actor.name} ${what}`, message: after.subject, link: `/support/cases/${after.id}`, metadata: { caseId: after.id, caseKey: after.caseKey, by: actor.name } });
      await safeEmail("case.customer_update→agent", () => sendCaseEmail({
        to: u.email, org, orgName: org.name, caseKey: after.caseKey, subject: after.subject,
        heading: `${actor.name} ${what} on ${after.caseKey}`, intro: after.assigneeUserId ? "This case is assigned to you." : "This case isn't assigned yet.",
        ctaText: "Open the case", ctaUrl: ctx.agentUrl(after.id), footer: "You're receiving this because you're on the support team.",
      }));
    }
    return;
  }

  if (after.assigneeUserId && after.assigneeUserId !== before.assigneeUserId && after.assigneeUserId !== actor.userId) {
    const [u] = await agentEmails(after.orgId, [after.assigneeUserId]);
    if (u) {
      await safeNotify({ orgId: after.orgId, userId: u.id, type: "case.assigned", title: `${after.caseKey} assigned to you`, message: after.subject, link: `/support/cases/${after.id}`, metadata: { caseId: after.id, caseKey: after.caseKey, by: actor.name } });
      await safeEmail("case.assigned→agent", () => sendCaseEmail({
        to: u.email, org, orgName: org.name, caseKey: after.caseKey, subject: after.subject,
        heading: `${actor.name} assigned ${after.caseKey} to you`, intro: after.requesterName ? `Requested by ${after.requesterName}.` : "",
        body: after.description, ctaText: "Open the case", ctaUrl: ctx.agentUrl(after.id), footer: "You're receiving this because the case was assigned to you.",
      }));
    }
  }

  if (after.status !== before.status && (after.status === "RESOLVED" || after.status === "WAITING_ON_CUSTOMER" || after.status === "BLOCKED")) {
    for (const r of await customerRecipients(after)) {
      if (!(await stillRecipient(after, r))) continue;
      const to = r.email;
      if (after.status === "RESOLVED") {
        await safeEmail("case.resolved→customer", () => sendCaseEmail({
          to, org, orgName: org.name, caseKey: after.caseKey, subject: after.subject,
          heading: `${after.caseKey} is resolved`, intro: r.role === "reviewer" ? `${actor.name} marked this case resolved.` : `${actor.name} marked this case resolved. If anything is still wrong, reply and it reopens automatically.`,
          ctaUrl: ctx.portalUrl(after.id), ...ctaFor(r, "View the case"),
        }));
      } else if (after.status === "WAITING_ON_CUSTOMER") {
        await safeEmail("case.waiting→customer", () => sendCaseEmail({
          to, org, orgName: org.name, caseKey: after.caseKey, subject: after.subject,
          heading: r.role === "reviewer" ? `${after.caseKey} is waiting on the requester` : `We need something from you on ${after.caseKey}`, intro: r.role === "reviewer" ? `${actor.name} is waiting on a reply from the requester.` : `${actor.name} is waiting on your reply to keep this moving.`,
          ctaUrl: ctx.portalUrl(after.id), ...ctaFor(r, "Reply in the Help Center"),
        }));
      } else {
        await safeEmail("case.blocked→customer", () => sendCaseEmail({
          to, org, orgName: org.name, caseKey: after.caseKey, subject: after.subject,
          heading: `${after.caseKey} is blocked for now`, intro: `${actor.name} marked this case blocked: we're waiting on something outside the case before work can continue. You'll hear as soon as it moves.`,
          ctaUrl: ctx.portalUrl(after.id), ...ctaFor(r, "View the case"),
        }));
      }
    }
  }
}

/** SLA warning / breach to the assignee (or managers when unassigned). */
export async function notifySlaAlert(c: SupportCase, alert: SlaAlert): Promise<void> {
  const ctx = await orgContext(c.orgId);
  if (!ctx) return;
  const { org } = ctx;
  const what = alert.kind === "first_response" ? "First response" : "Resolution";
  const when = alert.overdue ? "is overdue" : `is due ${alert.dueAt.toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} UTC`;
  const targets = c.assigneeUserId ? await agentEmails(c.orgId, [c.assigneeUserId]) : await managers(c.orgId);
  for (const u of targets) {
    await safeNotify({ orgId: c.orgId, userId: u.id, type: "case.sla", title: `${c.caseKey}: ${what.toLowerCase()} ${alert.overdue ? "overdue" : "due soon"}`, message: c.subject, link: `/support/cases/${c.id}`, metadata: { caseId: c.id, caseKey: c.caseKey, kind: alert.kind, overdue: alert.overdue } });
    await safeEmail("case.sla→agent", () => sendCaseEmail({
      to: u.email, org, orgName: org.name, caseKey: c.caseKey, subject: c.subject,
      heading: `${what} ${alert.overdue ? "overdue" : "due soon"} on ${c.caseKey}`, intro: `${what} ${when}.${c.assigneeUserId ? "" : " The case isn't assigned yet."}`,
      ctaText: "Open the case", ctaUrl: ctx.agentUrl(c.id), footer: "Service-level alert from CherryWorks Pro.",
    }));
  }
}

/** Used by the processor tick; exported so a test can drive one pass. */
export async function runSlaAlertPass(now = new Date()): Promise<number> {
  const { findCasesNeedingAlert, markAlerted } = await import("./support-sla");
  const due = await findCasesNeedingAlert(now);
  for (const { row, alert } of due) {
    await markAlerted(row.id, alert.kind, now);
    await notifySlaAlert(row, alert);
  }
  return due.length;
}

// keep `orgs` referenced for the type-only import consumers
export type { SupportCase };
void orgs;
