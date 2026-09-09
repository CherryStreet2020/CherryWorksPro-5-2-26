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
import { and, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { orgs, users, type SupportCase } from "@shared/schema";
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

async function safeEmail(label: string, fn: () => Promise<unknown>) {
  try { await fn(); log("SUPPORT_EMAIL_SENT", { label }); }
  catch (err) { warn("SUPPORT_EMAIL_FAILED", { label, error: (err as Error)?.message }); }
}

async function safeNotify(input: Parameters<typeof createNotification>[0]) {
  try { await createNotification(input); }
  catch (err) { warn("SUPPORT_NOTIFY_FAILED", { type: input.type, error: (err as Error)?.message }); }
}

/** A case was opened (by an agent, from the portal, or from an email). */
export async function notifyCaseCreated(c: SupportCase): Promise<void> {
  const ctx = await orgContext(c.orgId);
  if (!ctx) return;
  const { org } = ctx;

  if (c.requesterEmail && c.source !== "AGENT") {
    await safeEmail("case.created→requester", () => sendCaseEmail({
      to: c.requesterEmail!, org, orgName: org.name, caseKey: c.caseKey, subject: c.subject,
      heading: `We've received your request`,
      intro: `Thanks${c.requesterName ? `, ${c.requesterName.split(" ")[0]}` : ""}. Your case is ${c.caseKey}. We'll reply here and in the Help Center as soon as someone picks it up.`,
      body: c.description, ctaText: "View your case", ctaUrl: ctx.portalUrl(c.id),
    }));
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
    if (c.requesterEmail) {
      await safeEmail("case.reply→requester", () => sendCaseEmail({
        to: c.requesterEmail!, org, orgName: org.name, caseKey: c.caseKey, subject: c.subject,
        heading: `${msg.authorName} replied`, intro: `There's a new reply on your case ${c.caseKey}.`,
        body: msg.body, ctaText: "Reply in the Help Center", ctaUrl: ctx.portalUrl(c.id),
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

  if (after.status !== before.status && after.requesterEmail) {
    const to = after.requesterEmail;
    if (after.status === "RESOLVED") {
      await safeEmail("case.resolved→requester", () => sendCaseEmail({
        to, org, orgName: org.name, caseKey: after.caseKey, subject: after.subject,
        heading: `${after.caseKey} is resolved`, intro: `${actor.name} marked your case resolved. If anything is still wrong, reply and it reopens automatically.`,
        ctaText: "View the case", ctaUrl: ctx.portalUrl(after.id),
      }));
    } else if (after.status === "WAITING_ON_CUSTOMER") {
      await safeEmail("case.waiting→requester", () => sendCaseEmail({
        to, org, orgName: org.name, caseKey: after.caseKey, subject: after.subject,
        heading: `We need something from you on ${after.caseKey}`, intro: `${actor.name} is waiting on your reply to keep this moving.`,
        ctaText: "Reply in the Help Center", ctaUrl: ctx.portalUrl(after.id),
      }));
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
