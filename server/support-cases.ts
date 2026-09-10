/**
 * Support Cases — service layer.
 *
 * A Support Case is a client request the team works on. Everything here is
 * org-scoped; every query takes the orgId from the session, never from the
 * body. Keys are per client ("ABS-158") and minted atomically from
 * clients.next_case_number so two agents creating cases at once never collide.
 */
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { db } from "./db";
import { listAttachmentsForCleanup, deleteBytes } from "./support-attachments";
import { dueDatesForNewCase, clockPatchForStatus, slaStateFor } from "./support-sla";
import { notifyCaseCreated, notifyCaseMessage, notifyCaseUpdated } from "./support-notifications";
import {
  clientActivities,
  clientContacts,
  clients,
  projects,
  services,
  supportCaseEvents,
  supportCaseMessages,
  supportCaseTypes,
  supportCases,
  timeEntries,
  users,
  supportCaseWatchers,
  portalBlockedEmails,
  SUPPORT_CASE_OPEN_STATUSES,
  SUPPORT_CASE_CLOCK_RUNNING_STATUSES,
  type SupportCase,
  type SupportCaseStatus,
  type SupportCaseIntake,
} from "@shared/schema";

export type CaseView = "open" | "mine" | "unassigned" | "waiting" | "blocked" | "breaching" | "resolved" | "all";

export interface ListCasesFilter {
  view?: CaseView;
  userId?: string;
  clientId?: string;
  status?: SupportCaseStatus;
  assigneeUserId?: string;
  q?: string;
  limit?: number;
}

export interface Actor {
  /** null when the actor is a customer (Customer Admin acting from the Help Center). */
  userId: string | null;
  /** Set when the actor is a portal contact. */
  contactId?: string | null;
  name: string;
}

export const CASE_KEY_PREFIX_RE = /^[A-Z][A-Z0-9]{1,9}$/;

/** Uppercase, alphanumeric, starts with a letter, 2–10 chars; "CASE" when nothing usable remains. */
function normalizePrefix(raw: string): string {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^[0-9]+/, "").slice(0, 10);
  return CASE_KEY_PREFIX_RE.test(cleaned) ? cleaned : "CASE";
}

/** "ABS Machining, Inc" → "ABS"; "Cherry Street Consulting" → "CSC"; "Acme" → "ACM"; "7-Eleven" → "ELE"; "X" → "CASE". */
export function deriveCaseKeyPrefix(clientName: string): string {
  const words = clientName
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "CASE";
  const first = words[0];
  if (/^[A-Z0-9]{2,6}$/.test(first) && /^[A-Z]/.test(first)) return normalizePrefix(first);
  if (words.length >= 2) {
    const initials = words.slice(0, 4).map(w => w[0]).join("");
    const norm = normalizePrefix(initials);
    if (norm !== "CASE") return norm;
  }
  return normalizePrefix(first.replace(/^[0-9]+/, "").slice(0, 3) || first.slice(0, 3));
}

/**
 * Keys are unique per ORG (so "ABS-158" means one thing everywhere in the
 * firm), which means prefixes must be unique per org too. A derived prefix
 * that another client already uses gets a numeric suffix: ACM, ACM2, ACM3…
 */
export async function ensureUniquePrefix(orgId: string, clientId: string, candidate: string): Promise<string> {
  const taken = new Set(
    (await db.select({ prefix: clients.caseKeyPrefix }).from(clients)
      .where(and(eq(clients.orgId, orgId), ne(clients.id, clientId), isNotNull(clients.caseKeyPrefix))))
      .map(r => r.prefix!),
  );
  if (!taken.has(candidate)) return candidate;
  const base = candidate.slice(0, 8);
  for (let n = 2; n < 100; n++) {
    const next = `${base}${n}`;
    if (!taken.has(next)) return next;
  }
  throw new Error("Could not allocate a unique case key prefix");
}

/**
 * Atomically takes the next number for the client and returns the key.
 * The counter is bumped in a single UPDATE … RETURNING so concurrent inserts
 * get distinct numbers without an explicit lock.
 */
export async function mintCaseKey(orgId: string, clientId: string): Promise<{ caseKey: string; caseNumber: number }> {
  const [row] = await db
    .update(clients)
    .set({ nextCaseNumber: sql`${clients.nextCaseNumber} + 1` })
    .where(and(eq(clients.id, clientId), eq(clients.orgId, orgId)))
    .returning({ prefix: clients.caseKeyPrefix, next: clients.nextCaseNumber, name: clients.name });
  if (!row) throw new Error("Client not found");
  const caseNumber = row.next - 1;
  let prefix = row.prefix;
  if (!prefix) {
    prefix = await ensureUniquePrefix(orgId, clientId, deriveCaseKeyPrefix(row.name));
    await db.update(clients).set({ caseKeyPrefix: prefix }).where(eq(clients.id, clientId));
  }
  return { caseKey: `${prefix}-${caseNumber}`, caseNumber };
}

const hoursSubquery = (caseIdCol: SQL | typeof supportCases.id) =>
  sql<number>`COALESCE((SELECT SUM(te.minutes) FROM time_entries te WHERE te.support_case_id = ${caseIdCol}), 0)`;

const caseListSelect = {
  id: supportCases.id,
  caseKey: supportCases.caseKey,
  caseNumber: supportCases.caseNumber,
  subject: supportCases.subject,
  status: supportCases.status,
  priority: supportCases.priority,
  source: supportCases.source,
  clientId: supportCases.clientId,
  clientName: clients.name,
  projectId: supportCases.projectId,
  projectName: projects.name,
  typeId: supportCases.typeId,
  typeName: supportCaseTypes.name,
  requesterName: supportCases.requesterName,
  requesterEmail: supportCases.requesterEmail,
  assigneeUserId: supportCases.assigneeUserId,
  assigneeName: users.name,
  firstResponseDueAt: supportCases.firstResponseDueAt,
  resolutionDueAt: supportCases.resolutionDueAt,
  firstResponseAt: supportCases.firstResponseAt,
  lastCustomerMessageAt: supportCases.lastCustomerMessageAt,
  lastAgentMessageAt: supportCases.lastAgentMessageAt,
  resolvedAt: supportCases.resolvedAt,
  closedAt: supportCases.closedAt,
  slaPausedAt: supportCases.slaPausedAt,
  createdAt: supportCases.createdAt,
  updatedAt: supportCases.updatedAt,
  minutesLogged: hoursSubquery(supportCases.id),
};

/** Attach the computed SLA state to a case row for the API. */
export function withSla<T extends { status: string; createdAt: Date; firstResponseAt: Date | null; firstResponseDueAt: Date | null; resolutionDueAt: Date | null; resolvedAt: Date | null; slaPausedAt: Date | null }>(row: T) {
  return { ...row, sla: slaStateFor(row) };
}

export async function listCases(orgId: string, f: ListCasesFilter) {
  const where: SQL[] = [eq(supportCases.orgId, orgId)];
  switch (f.view) {
    case "open": where.push(inArray(supportCases.status, [...SUPPORT_CASE_OPEN_STATUSES])); break;
    case "mine":
      where.push(inArray(supportCases.status, [...SUPPORT_CASE_OPEN_STATUSES]));
      if (f.userId) where.push(eq(supportCases.assigneeUserId, f.userId));
      break;
    case "unassigned":
      where.push(inArray(supportCases.status, [...SUPPORT_CASE_OPEN_STATUSES]));
      where.push(isNull(supportCases.assigneeUserId));
      break;
    case "waiting": where.push(eq(supportCases.status, "WAITING_ON_CUSTOMER")); break;
    case "breaching": {
      // Timestamps are stored UTC-naive; compare against an explicit UTC string so
      // the driver never re-interprets a Date in the server's local zone.
      const soon = utcNaive(new Date(Date.now() + 3600000));
      where.push(inArray(supportCases.status, [...SUPPORT_CASE_CLOCK_RUNNING_STATUSES]));
      where.push(isNull(supportCases.slaPausedAt));
      where.push(or(
        and(isNull(supportCases.firstResponseAt), sql`${supportCases.firstResponseDueAt} < ${soon}::timestamp`),
        sql`${supportCases.resolutionDueAt} < ${soon}::timestamp`,
      )!);
      break;
    }
    case "resolved": where.push(inArray(supportCases.status, ["RESOLVED", "CLOSED"])); break;
    case "blocked": where.push(eq(supportCases.status, "BLOCKED")); break;
    case "all":
    default: break;
  }
  if (f.clientId) where.push(eq(supportCases.clientId, f.clientId));
  if (f.status) where.push(eq(supportCases.status, f.status));
  if (f.assigneeUserId) where.push(eq(supportCases.assigneeUserId, f.assigneeUserId));
  if (f.q && f.q.trim()) {
    const term = `%${f.q.trim()}%`;
    where.push(or(ilike(supportCases.subject, term), ilike(supportCases.caseKey, term), ilike(clients.name, term), ilike(supportCases.requesterName, term))!);
  }
  return db
    .select(caseListSelect)
    .from(supportCases)
    .innerJoin(clients, and(eq(supportCases.clientId, clients.id), eq(clients.orgId, orgId)))
    .leftJoin(projects, and(eq(supportCases.projectId, projects.id), eq(projects.orgId, orgId)))
    .leftJoin(supportCaseTypes, and(eq(supportCases.typeId, supportCaseTypes.id), eq(supportCaseTypes.orgId, orgId)))
    .leftJoin(users, and(eq(supportCases.assigneeUserId, users.id), eq(users.orgId, orgId)))
    .where(and(...where))
    .orderBy(desc(supportCases.updatedAt))
    .limit(Math.min(Math.max(f.limit ?? 200, 1), 500));
}

/** "2026-09-07 03:36:31.455" — the UTC wall clock, no zone, as timestamps are stored. */
export function utcNaive(d: Date): string {
  return d.toISOString().replace("T", " ").replace("Z", "");
}

export async function summary(orgId: string, userId: string) {
  const soon = utcNaive(new Date(Date.now() + 3600000));
  // Status sets come from the shared constants so a new status can never drop out of a count.
  const openIn = sql`${supportCases.status} IN (${sql.join(SUPPORT_CASE_OPEN_STATUSES.map(x => sql`${x}`), sql`, `)})`;
  const runningIn = sql`${supportCases.status} IN (${sql.join(SUPPORT_CASE_CLOCK_RUNNING_STATUSES.map(x => sql`${x}`), sql`, `)})`;
  const [row] = await db
    .select({
      open: sql<number>`COUNT(*) FILTER (WHERE ${openIn})`,
      mine: sql<number>`COUNT(*) FILTER (WHERE ${openIn} AND ${supportCases.assigneeUserId} = ${userId})`,
      unassigned: sql<number>`COUNT(*) FILTER (WHERE ${openIn} AND ${supportCases.assigneeUserId} IS NULL)`,
      waiting: sql<number>`COUNT(*) FILTER (WHERE ${supportCases.status} = 'WAITING_ON_CUSTOMER')`,
      blocked: sql<number>`COUNT(*) FILTER (WHERE ${supportCases.status} = 'BLOCKED')`,
      resolved: sql<number>`COUNT(*) FILTER (WHERE ${supportCases.status} IN ('RESOLVED','CLOSED'))`,
      breaching: sql<number>`COUNT(*) FILTER (WHERE ${runningIn} AND ${supportCases.slaPausedAt} IS NULL AND ((${supportCases.firstResponseAt} IS NULL AND ${supportCases.firstResponseDueAt} < ${soon}::timestamp) OR ${supportCases.resolutionDueAt} < ${soon}::timestamp))`,
      all: sql<number>`COUNT(*)`,
    })
    .from(supportCases)
    .where(eq(supportCases.orgId, orgId));
  return {
    open: Number(row?.open ?? 0),
    mine: Number(row?.mine ?? 0),
    unassigned: Number(row?.unassigned ?? 0),
    waiting: Number(row?.waiting ?? 0),
    blocked: Number(row?.blocked ?? 0),
    resolved: Number(row?.resolved ?? 0),
    breaching: Number(row?.breaching ?? 0),
    all: Number(row?.all ?? 0),
  };
}

export async function getCase(orgId: string, id: string) {
  const [row] = await db
    .select({ ...caseListSelect, description: supportCases.description, requesterContactId: supportCases.requesterContactId, createdByUserId: supportCases.createdByUserId, externalRef: supportCases.externalRef, intake: supportCases.intake })
    .from(supportCases)
    .innerJoin(clients, and(eq(supportCases.clientId, clients.id), eq(clients.orgId, orgId)))
    .leftJoin(projects, and(eq(supportCases.projectId, projects.id), eq(projects.orgId, orgId)))
    .leftJoin(supportCaseTypes, and(eq(supportCases.typeId, supportCaseTypes.id), eq(supportCaseTypes.orgId, orgId)))
    .leftJoin(users, and(eq(supportCases.assigneeUserId, users.id), eq(users.orgId, orgId)))
    .where(and(eq(supportCases.id, id), eq(supportCases.orgId, orgId)));
  return row;
}

export async function getCaseRaw(orgId: string, id: string): Promise<SupportCase | undefined> {
  const [row] = await db.select().from(supportCases).where(and(eq(supportCases.id, id), eq(supportCases.orgId, orgId)));
  return row;
}

export async function listMessages(orgId: string, caseId: string, includeInternal: boolean) {
  const where: SQL[] = [eq(supportCaseMessages.orgId, orgId), eq(supportCaseMessages.caseId, caseId)];
  if (!includeInternal) where.push(eq(supportCaseMessages.visibility, "CUSTOMER"));
  return db.select().from(supportCaseMessages).where(and(...where)).orderBy(asc(supportCaseMessages.createdAt));
}

export async function listEvents(orgId: string, caseId: string) {
  return db
    .select()
    .from(supportCaseEvents)
    .where(and(eq(supportCaseEvents.orgId, orgId), eq(supportCaseEvents.caseId, caseId)))
    .orderBy(asc(supportCaseEvents.createdAt));
}

export async function listCaseTime(orgId: string, caseId: string) {
  const rows = await db
    .select({
      id: timeEntries.id,
      date: timeEntries.date,
      minutes: timeEntries.minutes,
      billable: timeEntries.billable,
      invoiced: timeEntries.invoiced,
      notes: timeEntries.notes,
      startTime: timeEntries.startTime,
      endTime: timeEntries.endTime,
      rate: timeEntries.rate,
      userId: timeEntries.userId,
      userName: users.name,
      projectId: timeEntries.projectId,
      projectName: projects.name,
      serviceName: services.name,
    })
    .from(timeEntries)
    .innerJoin(users, and(eq(timeEntries.userId, users.id), eq(users.orgId, orgId)))
    .innerJoin(projects, and(eq(timeEntries.projectId, projects.id), eq(projects.orgId, orgId)))
    .leftJoin(services, and(eq(timeEntries.serviceId, services.id), eq(services.orgId, orgId)))
    .where(and(eq(timeEntries.orgId, orgId), eq(timeEntries.supportCaseId, caseId)))
    .orderBy(desc(timeEntries.date), desc(timeEntries.startTime));
  const totals = rows.reduce(
    (t, r) => {
      t.minutes += r.minutes;
      if (r.billable) t.billableMinutes += r.minutes;
      if (r.billable && !r.invoiced) t.unbilledMinutes += r.minutes;
      if (r.invoiced) t.invoicedMinutes += r.minutes;
      return t;
    },
    { minutes: 0, billableMinutes: 0, unbilledMinutes: 0, invoicedMinutes: 0 },
  );
  return { entries: rows, totals };
}

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

async function writeEvent(orgId: string, caseId: string, kind: string, from: string | null, to: string | null, actor: Actor | null, tx: DbOrTx = db) {
  await tx.insert(supportCaseEvents).values({
    orgId, caseId, kind, fromValue: from, toValue: to,
    actorUserId: actor?.userId ?? null, actorName: actor?.name ?? null,
  });
}

async function writeActivity(orgId: string, clientId: string, actor: Actor | null, type: string, title: string, description: string | null, caseId: string, metadata: Record<string, unknown> = {}, tx: DbOrTx = db) {
  await tx.insert(clientActivities).values({
    orgId, clientId, userId: actor?.userId ?? null, type, title, description,
    linkUrl: `/support/cases/${caseId}`, metadata: { caseId, ...metadata },
  });
}

export interface CreateCaseInput {
  clientId: string;
  projectId?: string | null;
  typeId?: string | null;
  subject: string;
  description?: string | null;
  priority?: string;
  status?: string;
  assigneeUserId?: string | null;
  requesterContactId?: string | null;
  requesterName?: string | null;
  requesterEmail?: string | null;
  source?: "AGENT" | "PORTAL" | "EMAIL" | "IMPORT";
  externalRef?: string | null;
  /** Help Center form: the customer's structured statement. */
  intake?: SupportCaseIntake | null;
  /** Display name of the person who submitted (for "opened on your behalf" mail). */
  openedByName?: string | null;
  /**
   * Help Center submission: the AUTHENTICATED contact (immutable) + a per-form key. Watchers are
   * colleagues of the same client added at creation. Everything is validated again INSIDE the
   * transaction under the contact row locks (global order: case row → contacts ascending →
   * watcher rows), so a demotion, block or deletion that lands while the form is in flight is seen.
   */
  portal?: {
    submitterContactId: string;
    submissionKey?: string | null;
    watcherContactIds?: string[];
    reviewerContactIds?: string[];
  };
  /** Caller sends the creation notification itself (after the form's files are stored) via `notifyCreated`. */
  deferNotify?: boolean;
}

export class CaseAccessError extends Error {}
/** Thrown when a Help Center submission replays an already-committed one; carries the existing row. */
export class CaseReplay extends Error {
  constructor(public row: SupportCase | null, public readonly key: { orgId: string; submitterContactId: string; submissionKey: string }) { super("replay"); }
  /** The committed winner of the race (read after our own transaction rolled back). */
  async resolve(): Promise<SupportCase | undefined> {
    if (this.row) return this.row;
    return findSubmission(this.key.orgId, this.key.submitterContactId, this.key.submissionKey);
  }
}

async function assertNotBlocked(tx: DbOrTx, orgId: string, email: string | null | undefined) {
  const e = (email || "").trim().toLowerCase();
  if (!e) return;
  const [b] = await tx.select({ id: portalBlockedEmails.id }).from(portalBlockedEmails).where(and(eq(portalBlockedEmails.orgId, orgId), sql`lower(${portalBlockedEmails.email}) = ${e}`));
  if (b) throw new CaseAccessError("That colleague cannot be added");
}

export async function createCase(orgId: string, input: CreateCaseInput, actor: Actor | null) {
  const [client] = await db.select({ id: clients.id, name: clients.name }).from(clients).where(and(eq(clients.id, input.clientId), eq(clients.orgId, orgId)));
  if (!client) throw new Error("Client not found");
  if (input.projectId) {
    const [p] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, input.projectId), eq(projects.orgId, orgId), eq(projects.clientId, input.clientId)));
    if (!p) throw new Error("Project does not belong to this client");
  }
  let priority = input.priority;
  if (input.typeId) {
    const [t] = await db.select().from(supportCaseTypes).where(and(eq(supportCaseTypes.id, input.typeId), eq(supportCaseTypes.orgId, orgId)));
    if (!t) throw new Error("Case type not found");
    if (!priority) priority = t.defaultPriority;
  }
  if (input.assigneeUserId) {
    const [u] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, input.assigneeUserId), eq(users.orgId, orgId)));
    if (!u) throw new Error("Assignee not found");
  }
  let requesterName = input.requesterName ?? null;
  let requesterEmail = input.requesterEmail ?? null;
  if (input.requesterContactId) {
    const [c] = await db.select().from(clientContacts).where(and(eq(clientContacts.id, input.requesterContactId), eq(clientContacts.orgId, orgId)));
    if (!c) throw new Error("Contact not found");
    requesterName = requesterName || `${c.firstName} ${c.lastName}`.trim();
    requesterEmail = requesterEmail || c.email || null;
  }

  const { caseKey, caseNumber } = await mintCaseKey(orgId, input.clientId);
  const createdAt = new Date();
  const due = await dueDatesForNewCase(orgId, input.clientId, createdAt);
  const portal = input.portal;
  const watcherEvents: Array<{ contactId: string; name: string }> = [];
  const row = await db.transaction(async (tx) => {
  let inserted: SupportCase;
  try {
    [inserted] = await tx.insert(supportCases).values({
    createdAt,
    firstResponseDueAt: due.firstResponseDueAt,
    resolutionDueAt: due.resolutionDueAt,
    orgId,
    clientId: input.clientId,
    projectId: input.projectId ?? null,
    typeId: input.typeId ?? null,
    caseKey,
    caseNumber,
    subject: input.subject,
    description: input.description ?? null,
    status: input.status ?? "NEW",
    priority: priority ?? "MEDIUM",
    source: input.source ?? "AGENT",
    requesterContactId: input.requesterContactId ?? null,
    requesterName,
    requesterEmail,
    assigneeUserId: input.assigneeUserId ?? null,
    createdByUserId: actor?.userId ?? null,
    externalRef: input.externalRef ?? null,
    intake: input.intake ?? null,
    submittedByContactId: portal?.submitterContactId ?? null,
    submissionKey: portal?.submissionKey ?? null,
  }).returning();
  } catch (err: any) {
    // Two first submissions with the same key raced: the other one is the case.
    const e = err?.cause ?? err;
    if (portal?.submissionKey && e?.code === "23505" && String(e?.constraint || "").includes("ux_support_cases_submission")) {
      // The insert failed, so this transaction is aborted: the winner is read on a fresh connection after rollback.
      throw new CaseReplay(null, { orgId, submitterContactId: portal.submitterContactId, submissionKey: portal.submissionKey });
    }
    throw err;
  }
  const row = inserted;

  if (portal) {
    // Contacts re-read FOR UPDATE, ascending, after the case row: submitter, requester, watchers.
    const ids = [...new Set([portal.submitterContactId, ...(input.requesterContactId ? [input.requesterContactId] : []), ...(portal.watcherContactIds ?? []), ...(portal.reviewerContactIds ?? [])])].sort();
    const locked = await tx.select().from(clientContacts)
      .where(and(eq(clientContacts.orgId, orgId), inArray(clientContacts.id, ids))).orderBy(asc(clientContacts.id)).for("update");
    const byId = new Map(locked.map(c => [c.id, c]));
    for (const id of ids) {
      const c = byId.get(id);
      if (!c || c.deletedAt || c.clientId !== input.clientId) throw new CaseAccessError(id === portal.submitterContactId ? "Your access to this Help Center has changed. Sign in again." : "That colleague is not part of your company");
      await assertNotBlocked(tx, orgId, c.email);
    }
    const submitter = byId.get(portal.submitterContactId)!;
    const onBehalf = !!input.requesterContactId && input.requesterContactId !== portal.submitterContactId;
    if (onBehalf && submitter.portalRole !== "admin") throw new CaseAccessError("Only a Customer Admin can open a case for a colleague");
    const watcherIds = new Set(portal.watcherContactIds ?? []);
    if (onBehalf) watcherIds.add(portal.submitterContactId); // the admin keeps seeing what they opened
    watcherIds.delete(input.requesterContactId ?? "");
    const reviewerIds = new Set((portal.reviewerContactIds ?? []).filter(id => !watcherIds.has(id) && id !== input.requesterContactId));
    for (const [wid, role] of [...[...watcherIds].map(id => [id, "watcher"] as const), ...[...reviewerIds].map(id => [id, "reviewer"] as const)]) {
      const c = byId.get(wid)!;
      await tx.insert(supportCaseWatchers).values({ orgId, caseId: row.id, contactId: wid, role, addedByContactId: portal.submitterContactId }).onConflictDoNothing();
      const name = `${c.firstName} ${c.lastName}`.trim() || c.email || "colleague";
      watcherEvents.push({ contactId: wid, name: role === "reviewer" ? `${name} (review only)` : name });
    }
  }

  await writeEvent(orgId, row.id, "created", null, row.status, actor, tx);
  if (row.assigneeUserId) await writeEvent(orgId, row.id, "assignee", null, row.assigneeUserId, actor, tx);
  const watcherActor: Actor | null = portal ? { userId: null, contactId: portal.submitterContactId, name: input.openedByName || input.requesterName || "Customer" } : actor;
  for (const w of watcherEvents) await writeEvent(orgId, row.id, "watcher", "added", w.name, watcherActor, tx);
  await writeActivity(orgId, row.clientId, actor, "SUPPORT_CASE_OPENED", `${caseKey} opened`, row.subject, row.id, { caseKey }, tx);
  return row;
  });
  const openedBy = portal && input.requesterContactId && input.requesterContactId !== portal.submitterContactId
    ? { name: input.openedByName || "A colleague", contactId: portal.submitterContactId } : undefined;
  if (!input.deferNotify) notifyCreated(row, openedBy);
  return row;
}

/** Fire-and-forget creation notification (used directly by callers that store attachments first). */
export function notifyCreated(row: SupportCase, openedBy?: { name: string; contactId?: string | null }) {
  void notifyCaseCreated(row, { openedBy }).catch(err => console.warn("[support] notifyCaseCreated failed", (err as Error)?.message));
}

/** A Help Center replay: the same authenticated contact submitted the same key before. */
export async function findSubmission(orgId: string, submitterContactId: string, submissionKey: string): Promise<SupportCase | undefined> {
  const [row] = await db.select().from(supportCases).where(and(eq(supportCases.orgId, orgId), eq(supportCases.submittedByContactId, submitterContactId), eq(supportCases.submissionKey, submissionKey)));
  return row;
}

// ── Customer authority + watchers ──────────────────────────────────────────

/**
 * May this contact act on this case from the customer side? Requester (by id; by address ONLY
 * when the case has no linked requester), Customer Admin of the same client, or a watcher — and
 * the contact must be live, of the case's client, and not blocked. Evaluated on `conn` so callers
 * can run it INSIDE a transaction under the case row lock (revocation while a write is in flight).
 */
export async function customerCanAccess(conn: DbOrTx, orgId: string, c: Pick<SupportCase, "id" | "clientId" | "requesterContactId" | "requesterEmail">, contactId: string, opts: { lock?: boolean } = {}): Promise<{ ok: boolean; role: "requester" | "admin" | "watcher" | "reviewer" | null }> {
  // Write paths lock the contact row (global order: case → contact): a block or deletion holding
  // that lock finishes first and its revocation is what this check then sees.
  const q = conn.select().from(clientContacts).where(and(eq(clientContacts.id, contactId), eq(clientContacts.orgId, orgId)));
  const [k] = opts.lock ? await q.for("update") : await q;
  if (!k || k.deletedAt || k.clientId !== c.clientId) return { ok: false, role: null };
  const email = (k.email || "").trim().toLowerCase();
  if (email) {
    const [b] = await conn.select({ id: portalBlockedEmails.id }).from(portalBlockedEmails).where(and(eq(portalBlockedEmails.orgId, orgId), sql`lower(${portalBlockedEmails.email}) = ${email}`));
    if (b) return { ok: false, role: null };
  }
  const isRequester = c.requesterContactId ? c.requesterContactId === k.id : (!!email && !!c.requesterEmail && c.requesterEmail.trim().toLowerCase() === email);
  if (isRequester) return { ok: true, role: "requester" };
  if (k.portalRole === "admin") return { ok: true, role: "admin" };
  const [w] = await conn.select({ id: supportCaseWatchers.id, role: supportCaseWatchers.role }).from(supportCaseWatchers).where(and(eq(supportCaseWatchers.orgId, orgId), eq(supportCaseWatchers.caseId, c.id), eq(supportCaseWatchers.contactId, k.id)));
  return w ? { ok: true, role: w.role === "reviewer" ? "reviewer" : "watcher" } : { ok: false, role: null };
}

/** Same check, loading the case row on the given connection (for callers that only hold the id). */
export async function customerCanAccessCase(conn: DbOrTx, orgId: string, caseId: string, contactId: string, opts: { lock?: boolean; write?: boolean } = {}): Promise<boolean> {
  const [c] = await conn.select({ id: supportCases.id, clientId: supportCases.clientId, requesterContactId: supportCases.requesterContactId, requesterEmail: supportCases.requesterEmail })
    .from(supportCases).where(and(eq(supportCases.id, caseId), eq(supportCases.orgId, orgId)));
  if (!c) return false;
  const r = await customerCanAccess(conn, orgId, c, contactId, opts);
  return r.ok && !(opts.write && r.role === "reviewer"); // reviewers are review only
}

export async function listWatchers(orgId: string, caseId: string) {
  return db.select({ id: supportCaseWatchers.id, contactId: clientContacts.id, firstName: clientContacts.firstName, lastName: clientContacts.lastName, email: clientContacts.email, role: supportCaseWatchers.role, addedAt: supportCaseWatchers.createdAt })
    .from(supportCaseWatchers).innerJoin(clientContacts, eq(clientContacts.id, supportCaseWatchers.contactId))
    .where(and(eq(supportCaseWatchers.orgId, orgId), eq(supportCaseWatchers.caseId, caseId), isNull(clientContacts.deletedAt)))
    .orderBy(asc(supportCaseWatchers.createdAt));
}

/** Live, verified (not pending), unblocked contacts of a client — the people who can be watchers. */
export async function listColleagues(orgId: string, clientId: string, opts: { excludeContactIds?: string[]; excludeCaseId?: string } = {}) {
  const rows = await db.select({ id: clientContacts.id, firstName: clientContacts.firstName, lastName: clientContacts.lastName, email: clientContacts.email })
    .from(clientContacts)
    .where(and(eq(clientContacts.orgId, orgId), eq(clientContacts.clientId, clientId), isNull(clientContacts.deletedAt), isNull(clientContacts.portalPendingAt), isNotNull(clientContacts.email),
      sql`NOT EXISTS (SELECT 1 FROM ${portalBlockedEmails} b WHERE b.org_id = ${orgId} AND lower(b.email) = lower(${clientContacts.email}))`,
      ...(opts.excludeCaseId ? [sql`NOT EXISTS (SELECT 1 FROM ${supportCaseWatchers} w WHERE w.case_id = ${opts.excludeCaseId} AND w.contact_id = ${clientContacts.id})`] : []),
    ))
    .orderBy(asc(clientContacts.firstName), asc(clientContacts.lastName));
  const ex = new Set(opts.excludeContactIds ?? []);
  return rows.filter(r => !ex.has(r.id));
}

export interface WatcherActor { userId?: string | null; contactId?: string | null; name: string }

/**
 * Adds a watcher. Runs under the case row lock, then the contact rows (ascending); the caller's
 * authority is re-evaluated under those locks by `authorize` (customer callers) — an agent caller
 * (`actor.userId`) is trusted by the route. Returns the watcher list after the change.
 */
export async function addWatcher(orgId: string, caseId: string, contactId: string, actor: WatcherActor, authorize?: (tx: DbOrTx, c: SupportCase) => Promise<boolean>, role: "watcher" | "reviewer" = "watcher", authorizeRoleChange?: (tx: DbOrTx, c: SupportCase) => Promise<boolean>) {
  const changed = await db.transaction(async (tx) => {
    const [c] = await tx.select().from(supportCases).where(and(eq(supportCases.id, caseId), eq(supportCases.orgId, orgId))).for("update");
    if (!c) throw new CaseAccessError("Support case not found");
    const ids = [...new Set([contactId, ...(actor.contactId ? [actor.contactId] : [])])].sort();
    const locked = await tx.select().from(clientContacts).where(and(eq(clientContacts.orgId, orgId), inArray(clientContacts.id, ids))).orderBy(asc(clientContacts.id)).for("update");
    if (authorize && !(await authorize(tx, c))) throw new CaseAccessError("Support case not found");
    const target = locked.find(x => x.id === contactId);
    if (!target || target.deletedAt || target.clientId !== c.clientId) throw new CaseAccessError("That colleague is not part of this customer");
    await assertNotBlocked(tx, orgId, target.email);
    // The requester already follows their own case — by linked id, or by address on a legacy
    // email-only case (a watcher row there would outlive a later requester reassignment).
    const isRequester = c.requesterContactId ? c.requesterContactId === contactId
      : (!!target.email && !!c.requesterEmail && c.requesterEmail.trim().toLowerCase() === target.email.trim().toLowerCase());
    if (isRequester) return false;
    // Already following with the same role → nothing to do; with a different role → the role changes
    // (a reviewer promoted to watcher, or the reverse); otherwise a new row.
    const [existing] = await tx.select({ id: supportCaseWatchers.id, role: supportCaseWatchers.role }).from(supportCaseWatchers)
      .where(and(eq(supportCaseWatchers.orgId, orgId), eq(supportCaseWatchers.caseId, caseId), eq(supportCaseWatchers.contactId, contactId))).for("update");
    if (existing && existing.role === role) return false;
    // Changing an EXISTING follower's role is a permission change, not an invitation: it needs the
    // same authority as removing them (requester / Customer Admin), never a fellow watcher's.
    if (existing && authorizeRoleChange && !(await authorizeRoleChange(tx, c))) throw new CaseAccessError("Support case not found");
    if (existing) await tx.update(supportCaseWatchers).set({ role }).where(eq(supportCaseWatchers.id, existing.id));
    else await tx.insert(supportCaseWatchers).values({ orgId, caseId, contactId, role, addedByContactId: actor.contactId ?? null, addedByUserId: actor.userId ?? null }).onConflictDoNothing();
    const name = `${target.firstName} ${target.lastName}`.trim() || target.email || "colleague";
    await writeEvent(orgId, caseId, "watcher", "added", role === "reviewer" ? `${name} (review only)` : name, { userId: actor.userId ?? null, contactId: actor.contactId ?? null, name: actor.name }, tx);
    return true;
  });
  return { changed, watchers: await listWatchers(orgId, caseId) };
}

export async function removeWatcher(orgId: string, caseId: string, contactId: string, actor: WatcherActor, authorize?: (tx: DbOrTx, c: SupportCase) => Promise<boolean>) {
  const changed = await db.transaction(async (tx) => {
    const [c] = await tx.select().from(supportCases).where(and(eq(supportCases.id, caseId), eq(supportCases.orgId, orgId))).for("update");
    if (!c) throw new CaseAccessError("Support case not found");
    const ids = [...new Set([contactId, ...(actor.contactId ? [actor.contactId] : [])])].sort();
    const locked = await tx.select().from(clientContacts).where(and(eq(clientContacts.orgId, orgId), inArray(clientContacts.id, ids))).orderBy(asc(clientContacts.id)).for("update");
    if (authorize && !(await authorize(tx, c))) throw new CaseAccessError("Support case not found");
    const [gone] = await tx.delete(supportCaseWatchers).where(and(eq(supportCaseWatchers.orgId, orgId), eq(supportCaseWatchers.caseId, caseId), eq(supportCaseWatchers.contactId, contactId))).returning();
    if (!gone) return false;
    const target = locked.find(x => x.id === contactId);
    await writeEvent(orgId, caseId, "watcher", "removed", target ? (`${target.firstName} ${target.lastName}`.trim() || target.email || "colleague") : "colleague", { userId: actor.userId ?? null, contactId: actor.contactId ?? null, name: actor.name }, tx);
    return true;
  });
  return { changed, watchers: await listWatchers(orgId, caseId) };
}

export class CaseTransitionError extends Error {}

export interface UpdateCaseInput {
  /** Help Center (Customer Admin) intent, resolved against the LOCKED row inside the transaction. */
  customerAction?: "close" | "reopen";
  projectId?: string | null;
  typeId?: string | null;
  subject?: string;
  description?: string | null;
  priority?: string;
  status?: string;
  assigneeUserId?: string | null;
  requesterContactId?: string | null;
  requesterName?: string | null;
  requesterEmail?: string | null;
}

export async function updateCase(orgId: string, id: string, input: UpdateCaseInput, actor: Actor) {
  // One transaction: the case row is locked (FOR UPDATE) so concurrent transitions
  // serialise and the "existing" snapshot is the truth the events are written against;
  // the update, its events and the client activity commit together or not at all.
  // Notifications go out only after commit.
  const committed = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(supportCases).where(and(eq(supportCases.id, id), eq(supportCases.orgId, orgId))).for("update");
    if (!existing) return undefined;

    if (input.projectId) {
      const [p] = await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.id, input.projectId), eq(projects.orgId, orgId), eq(projects.clientId, existing.clientId)));
      if (!p) throw new Error("Project does not belong to this client");
    }
    if (input.typeId) {
      const [t] = await tx.select({ id: supportCaseTypes.id }).from(supportCaseTypes).where(and(eq(supportCaseTypes.id, input.typeId), eq(supportCaseTypes.orgId, orgId)));
      if (!t) throw new Error("Case type not found");
    }
    if (input.assigneeUserId) {
      const [u] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, input.assigneeUserId), eq(users.orgId, orgId)));
      if (!u) throw new Error("Assignee not found");
    }
    if (input.requesterContactId) {
      // The requester must be a live contact of THIS case's client (the column has no FK).
      const [k] = await tx.select({ id: clientContacts.id }).from(clientContacts)
        .where(and(eq(clientContacts.id, input.requesterContactId), eq(clientContacts.orgId, orgId), eq(clientContacts.clientId, existing.clientId), isNull(clientContacts.deletedAt)));
      if (!k) throw new Error("Requester must be a contact of this case's client");
    }

    if (input.customerAction === "close") {
      if (existing.status === "CLOSED") throw new CaseTransitionError("This case is already closed");
      input = { ...input, status: "CLOSED" };
    } else if (input.customerAction === "reopen") {
      if (existing.status !== "RESOLVED" && existing.status !== "CLOSED") throw new CaseTransitionError("Only a resolved or closed case can be reopened");
      input = { ...input, status: "WAITING_ON_SUPPORT" };
    }

    const patch: Partial<SupportCase> = { updatedAt: new Date() };
    const now = new Date();
    for (const k of ["projectId", "typeId", "subject", "description", "priority", "requesterContactId", "requesterName", "requesterEmail"] as const) {
      if (input[k] !== undefined) (patch as any)[k] = input[k];
    }
    if (input.assigneeUserId !== undefined) patch.assigneeUserId = input.assigneeUserId;
    if (input.status !== undefined && input.status !== existing.status) {
      patch.status = input.status;
      if (input.status === "RESOLVED") { patch.resolvedAt = now; patch.closedAt = null; }
      else if (input.status === "CLOSED") { patch.closedAt = now; if (!existing.resolvedAt) patch.resolvedAt = now; }
      else { patch.resolvedAt = null; patch.closedAt = null; }
      if (!actor.userId && (existing.status === "RESOLVED" || existing.status === "CLOSED")) patch.lastCustomerMessageAt = now;
      Object.assign(patch, clockPatchForStatus(existing, input.status, now));
    }

    const [row] = await tx.update(supportCases).set(patch).where(and(eq(supportCases.id, id), eq(supportCases.orgId, orgId))).returning();

    if (patch.status && patch.status !== existing.status) {
      await writeEvent(orgId, id, "status", existing.status, patch.status, actor, tx);
      await writeActivity(orgId, row.clientId, actor, "SUPPORT_CASE_STATUS", `${row.caseKey} ${labelStatus(patch.status)}`, row.subject, id, { caseKey: row.caseKey, status: patch.status, by: actor.name }, tx);
    }
    if (input.assigneeUserId !== undefined && input.assigneeUserId !== existing.assigneeUserId) {
      await writeEvent(orgId, id, "assignee", existing.assigneeUserId, input.assigneeUserId ?? null, actor, tx);
    }
    if (input.priority !== undefined && input.priority !== existing.priority) {
      await writeEvent(orgId, id, "priority", existing.priority, input.priority, actor, tx);
    }
    if (input.typeId !== undefined && input.typeId !== existing.typeId) {
      await writeEvent(orgId, id, "type", existing.typeId, input.typeId ?? null, actor, tx);
    }
    if (input.projectId !== undefined && input.projectId !== existing.projectId) {
      await writeEvent(orgId, id, "project", existing.projectId, input.projectId ?? null, actor, tx);
    }
    return { existing, row };
  });
  if (!committed) return undefined;
  void notifyCaseUpdated(committed.existing, committed.row, actor).catch(err => console.warn("[support] notifyCaseUpdated failed", (err as Error)?.message));
  return committed.row;
}

export function labelStatus(s: string): string {
  switch (s) {
    case "NEW": return "opened";
    case "WAITING_ON_SUPPORT": return "waiting on support";
    case "IN_PROGRESS": return "in progress";
    case "WAITING_ON_CUSTOMER": return "waiting on customer";
    case "BLOCKED": return "blocked";
    case "RESOLVED": return "resolved";
    case "CLOSED": return "closed";
    default: return s.toLowerCase();
  }
}

export interface AddMessageInput {
  body: string;
  visibility: "CUSTOMER" | "INTERNAL";
  author: { userId?: string | null; contactId?: string | null; name: string };
  /** Customer callers: re-evaluated under the case row lock (access revoked while the reply was in flight → refused). */
  authorize?: (tx: DbOrTx, c: SupportCase) => Promise<boolean>;
  emailMessageId?: string | null;
}

/**
 * Appends a message. An agent's first customer-visible reply stamps
 * first_response_at (the SLA clock); a customer message re-opens a case that
 * was waiting on them. Internal notes never touch the customer-facing clocks.
 */
export async function addMessage(orgId: string, caseId: string, input: AddMessageInput) {
  const isAgent = !!input.author.userId;
  // Same discipline as updateCase: lock the row, derive the transition from the locked
  // truth, and commit message + case + event + activity together. A customer reply that
  // races an admin close therefore sees CLOSED and leaves the status alone.
  const committed = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(supportCases).where(and(eq(supportCases.id, caseId), eq(supportCases.orgId, orgId))).for("update");
    if (!existing) return undefined;
    if (input.authorize && !(await input.authorize(tx, existing))) throw new CaseAccessError("Support case not found");
    const [msg] = await tx.insert(supportCaseMessages).values({
      orgId, caseId,
      authorUserId: input.author.userId ?? null,
      authorContactId: input.author.contactId ?? null,
      authorName: input.author.name,
      visibility: input.visibility,
      body: input.body,
      emailMessageId: input.emailMessageId ?? null,
    }).returning();

    const patch: Partial<SupportCase> = { updatedAt: new Date() };
    const now = new Date();
    if (isAgent && input.visibility === "CUSTOMER") {
      patch.lastAgentMessageAt = now;
      if (!existing.firstResponseAt) patch.firstResponseAt = now;
      if (existing.status === "NEW" || existing.status === "WAITING_ON_SUPPORT") patch.status = "IN_PROGRESS";
    } else if (!isAgent) {
      patch.lastCustomerMessageAt = now;
      if (existing.status === "WAITING_ON_CUSTOMER" || existing.status === "RESOLVED") patch.status = "WAITING_ON_SUPPORT";
      if (existing.status === "RESOLVED") { patch.resolvedAt = null; }
    }
    if (patch.status && patch.status !== existing.status) Object.assign(patch, clockPatchForStatus(existing, patch.status, now));
    const [row] = await tx.update(supportCases).set(patch).where(eq(supportCases.id, caseId)).returning();
    const actor: Actor | null = isAgent ? { userId: input.author.userId!, name: input.author.name } : null;
    if (patch.status && patch.status !== existing.status) {
      await writeEvent(orgId, caseId, "status", existing.status, patch.status, actor, tx);
    }
    if (input.visibility === "CUSTOMER") {
      await writeActivity(orgId, row.clientId, actor,
        isAgent ? "SUPPORT_CASE_REPLY" : "SUPPORT_CASE_CUSTOMER_MESSAGE",
        `${row.caseKey} ${isAgent ? "reply from" : "message from"} ${input.author.name}`,
        input.body.length > 200 ? input.body.slice(0, 200) + "…" : input.body, caseId, { caseKey: row.caseKey }, tx);
    }
    return { msg, row };
  });
  if (!committed) return undefined;
  void notifyCaseMessage(committed.row, { authorUserId: input.author.userId ?? null, authorContactId: input.author.contactId ?? null, authorName: input.author.name, body: input.body, visibility: input.visibility })
    .catch(err => console.warn("[support] notifyCaseMessage failed", (err as Error)?.message));
  return { message: committed.msg, case: committed.row };
}

export async function deleteCase(orgId: string, id: string) {
  // Under the case row lock: an upload in flight (which also locks the case) either finished
  // before — its row is enumerated below, pending or not — or waits and then fails on the
  // missing case, so no blob is ever left without a row that names it.
  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: supportCases.id }).from(supportCases).where(and(eq(supportCases.id, id), eq(supportCases.orgId, orgId))).for("update");
    if (!existing) return false;
    // The rows cascade with the case; the bytes in object storage do not. If a
    // blob cannot be removed, keep the case (and its rows, which hold the storage
    // keys) so the delete can be retried instead of orphaning the file.
    const failed: string[] = [];
    for (const a of await listAttachmentsForCleanup(orgId, id, tx)) {
      try { await deleteBytes(a.storageKey); } catch (err) { failed.push(a.filename); console.warn("[support-cases] attachment blob not removed", a.id, (err as Error).message); }
    }
    if (failed.length) throw new Error(`Could not remove ${failed.length} attachment file(s) (${failed.slice(0, 3).join(", ")}); try again`);
    // Time stays on the books; it just loses the case link. Only once the delete is certain.
    await tx.update(timeEntries).set({ supportCaseId: null }).where(and(eq(timeEntries.orgId, orgId), eq(timeEntries.supportCaseId, id)));
    await tx.delete(supportCases).where(and(eq(supportCases.id, id), eq(supportCases.orgId, orgId)));
    return true;
  });
}

/**
 * A time entry may link to a case only when the case belongs to the same org
 * AND the entry's project belongs to the case's client. Returns the case row.
 */
export async function assertCaseUsableForTimeEntry(orgId: string, caseId: string, projectId: string) {
  const c = await getCaseRaw(orgId, caseId);
  if (!c) throw new Error("Support case not found");
  const [p] = await db.select({ clientId: projects.clientId }).from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)));
  if (!p) throw new Error("Project not found");
  if (p.clientId !== c.clientId) throw new Error(`${c.caseKey} belongs to a different client than this project`);
  return c;
}

// ── Case types ──────────────────────────────────────────────────────────────
export async function listTypes(orgId: string, includeInactive = false) {
  const where: SQL[] = [eq(supportCaseTypes.orgId, orgId)];
  if (!includeInactive) where.push(eq(supportCaseTypes.isActive, true));
  return db.select().from(supportCaseTypes).where(and(...where)).orderBy(asc(supportCaseTypes.sortOrder), asc(supportCaseTypes.name));
}

export async function createType(orgId: string, input: { name: string; description?: string | null; defaultPriority?: string; defaultServiceId?: string | null; sortOrder?: number; isActive?: boolean }) {
  const [row] = await db.insert(supportCaseTypes).values({
    orgId, name: input.name, description: input.description ?? null,
    defaultPriority: input.defaultPriority ?? "MEDIUM", defaultServiceId: input.defaultServiceId ?? null,
    sortOrder: input.sortOrder ?? 0, isActive: input.isActive ?? true,
  }).returning();
  return row;
}

export async function updateType(orgId: string, id: string, input: Partial<{ name: string; description: string | null; defaultPriority: string; defaultServiceId: string | null; sortOrder: number; isActive: boolean }>) {
  const [row] = await db.update(supportCaseTypes).set({ ...input, updatedAt: new Date() }).where(and(eq(supportCaseTypes.id, id), eq(supportCaseTypes.orgId, orgId))).returning();
  return row;
}

/** The four request types ABS uses today; seeded once per org on first visit. */
export const DEFAULT_CASE_TYPES = [
  { name: "ERP Support Request", description: "Technical issues encountered while using ERP modules — from login problems to system errors and performance." , sortOrder: 1 },
  { name: "Customization Request", description: "A screen, report, dashboard, or system customization.", sortOrder: 2 },
  { name: "Master Files", description: "Issues related to master files only.", sortOrder: 3 },
  { name: "Training Request", description: "Training for any ERP module.", sortOrder: 4 },
];

export async function ensureDefaultTypes(orgId: string) {
  const existing = await listTypes(orgId, true);
  if (existing.length > 0) return existing;
  for (const t of DEFAULT_CASE_TYPES) await createType(orgId, t);
  return listTypes(orgId, true);
}

// ── Client key settings ─────────────────────────────────────────────────────
export async function getClientCaseSettings(orgId: string, clientId: string) {
  const [row] = await db.select({ id: clients.id, name: clients.name, caseKeyPrefix: clients.caseKeyPrefix, nextCaseNumber: clients.nextCaseNumber, portalShowHours: clients.portalShowHours })
    .from(clients).where(and(eq(clients.id, clientId), eq(clients.orgId, orgId)));
  if (!row) return undefined;
  return { ...row, effectivePrefix: row.caseKeyPrefix ?? deriveCaseKeyPrefix(row.name) };
}

export async function updateClientCaseSettings(orgId: string, clientId: string, input: { caseKeyPrefix?: string; nextCaseNumber?: number; portalShowHours?: boolean }) {
  const patch: Record<string, unknown> = {};
  if (input.portalShowHours !== undefined) patch.portalShowHours = input.portalShowHours;
  if (input.caseKeyPrefix !== undefined) {
    const unique = await ensureUniquePrefix(orgId, clientId, input.caseKeyPrefix);
    if (unique !== input.caseKeyPrefix) throw new Error(`Prefix ${input.caseKeyPrefix} is already used by another client`);
    patch.caseKeyPrefix = input.caseKeyPrefix;
  }
  if (input.nextCaseNumber !== undefined) patch.nextCaseNumber = input.nextCaseNumber;
  if (Object.keys(patch).length === 0) return getClientCaseSettings(orgId, clientId);
  await db.update(clients).set(patch).where(and(eq(clients.id, clientId), eq(clients.orgId, orgId)));
  return getClientCaseSettings(orgId, clientId);
}

// ── Pickers (any authenticated user; the manager-only /api/team and
// /api/clients lists are too narrow for agents who are team members) ──────
export async function listAgents(orgId: string) {
  return db.select({ id: users.id, name: users.name, email: users.email, role: users.role })
    .from(users).where(and(eq(users.orgId, orgId), eq(users.isActive, true))).orderBy(asc(users.name));
}

export async function listClientsForPicker(orgId: string) {
  return db.select({ id: clients.id, name: clients.name, caseKeyPrefix: clients.caseKeyPrefix })
    .from(clients).where(eq(clients.orgId, orgId)).orderBy(asc(clients.name));
}

export async function listClientProjectsForPicker(orgId: string, clientId: string) {
  return db.select({ id: projects.id, name: projects.name, status: projects.status })
    .from(projects).where(and(eq(projects.orgId, orgId), eq(projects.clientId, clientId), eq(projects.status, "ACTIVE"))).orderBy(asc(projects.name));
}
