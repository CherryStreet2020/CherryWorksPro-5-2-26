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
import { listAttachments, deleteBytes } from "./support-attachments";
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
  SUPPORT_CASE_OPEN_STATUSES,
  type SupportCase,
  type SupportCaseStatus,
} from "@shared/schema";

export type CaseView = "open" | "mine" | "unassigned" | "waiting" | "breaching" | "resolved" | "all";

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
  userId: string;
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
      where.push(inArray(supportCases.status, ["NEW", "WAITING_ON_SUPPORT", "IN_PROGRESS"]));
      where.push(isNull(supportCases.slaPausedAt));
      where.push(or(
        and(isNull(supportCases.firstResponseAt), sql`${supportCases.firstResponseDueAt} < ${soon}::timestamp`),
        sql`${supportCases.resolutionDueAt} < ${soon}::timestamp`,
      )!);
      break;
    }
    case "resolved": where.push(inArray(supportCases.status, ["RESOLVED", "CLOSED"])); break;
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
  const [row] = await db
    .select({
      open: sql<number>`COUNT(*) FILTER (WHERE ${supportCases.status} IN ('NEW','WAITING_ON_SUPPORT','IN_PROGRESS','WAITING_ON_CUSTOMER'))`,
      mine: sql<number>`COUNT(*) FILTER (WHERE ${supportCases.status} IN ('NEW','WAITING_ON_SUPPORT','IN_PROGRESS','WAITING_ON_CUSTOMER') AND ${supportCases.assigneeUserId} = ${userId})`,
      unassigned: sql<number>`COUNT(*) FILTER (WHERE ${supportCases.status} IN ('NEW','WAITING_ON_SUPPORT','IN_PROGRESS','WAITING_ON_CUSTOMER') AND ${supportCases.assigneeUserId} IS NULL)`,
      waiting: sql<number>`COUNT(*) FILTER (WHERE ${supportCases.status} = 'WAITING_ON_CUSTOMER')`,
      resolved: sql<number>`COUNT(*) FILTER (WHERE ${supportCases.status} IN ('RESOLVED','CLOSED'))`,
      breaching: sql<number>`COUNT(*) FILTER (WHERE ${supportCases.status} IN ('NEW','WAITING_ON_SUPPORT','IN_PROGRESS') AND ${supportCases.slaPausedAt} IS NULL AND ((${supportCases.firstResponseAt} IS NULL AND ${supportCases.firstResponseDueAt} < ${soon}::timestamp) OR ${supportCases.resolutionDueAt} < ${soon}::timestamp))`,
      all: sql<number>`COUNT(*)`,
    })
    .from(supportCases)
    .where(eq(supportCases.orgId, orgId));
  return {
    open: Number(row?.open ?? 0),
    mine: Number(row?.mine ?? 0),
    unassigned: Number(row?.unassigned ?? 0),
    waiting: Number(row?.waiting ?? 0),
    resolved: Number(row?.resolved ?? 0),
    breaching: Number(row?.breaching ?? 0),
    all: Number(row?.all ?? 0),
  };
}

export async function getCase(orgId: string, id: string) {
  const [row] = await db
    .select({ ...caseListSelect, description: supportCases.description, requesterContactId: supportCases.requesterContactId, createdByUserId: supportCases.createdByUserId, externalRef: supportCases.externalRef })
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

async function writeEvent(orgId: string, caseId: string, kind: string, from: string | null, to: string | null, actor: Actor | null) {
  await db.insert(supportCaseEvents).values({
    orgId, caseId, kind, fromValue: from, toValue: to,
    actorUserId: actor?.userId ?? null, actorName: actor?.name ?? null,
  });
}

async function writeActivity(orgId: string, clientId: string, actor: Actor | null, type: string, title: string, description: string | null, caseId: string, metadata: Record<string, unknown> = {}) {
  await db.insert(clientActivities).values({
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
  const [row] = await db.insert(supportCases).values({
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
  }).returning();

  await writeEvent(orgId, row.id, "created", null, row.status, actor);
  if (row.assigneeUserId) await writeEvent(orgId, row.id, "assignee", null, row.assigneeUserId, actor);
  await writeActivity(orgId, row.clientId, actor, "SUPPORT_CASE_OPENED", `${caseKey} opened`, row.subject, row.id, { caseKey });
  void notifyCaseCreated(row).catch(err => console.warn("[support] notifyCaseCreated failed", (err as Error)?.message));
  return row;
}

export interface UpdateCaseInput {
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
  const existing = await getCaseRaw(orgId, id);
  if (!existing) return undefined;

  if (input.projectId) {
    const [p] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, input.projectId), eq(projects.orgId, orgId), eq(projects.clientId, existing.clientId)));
    if (!p) throw new Error("Project does not belong to this client");
  }
  if (input.typeId) {
    const [t] = await db.select({ id: supportCaseTypes.id }).from(supportCaseTypes).where(and(eq(supportCaseTypes.id, input.typeId), eq(supportCaseTypes.orgId, orgId)));
    if (!t) throw new Error("Case type not found");
  }
  if (input.assigneeUserId) {
    const [u] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, input.assigneeUserId), eq(users.orgId, orgId)));
    if (!u) throw new Error("Assignee not found");
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
    Object.assign(patch, clockPatchForStatus(existing, input.status, now));
  }

  const [row] = await db.update(supportCases).set(patch).where(and(eq(supportCases.id, id), eq(supportCases.orgId, orgId))).returning();
  void notifyCaseUpdated(existing, row, actor).catch(err => console.warn("[support] notifyCaseUpdated failed", (err as Error)?.message));

  if (patch.status && patch.status !== existing.status) {
    await writeEvent(orgId, id, "status", existing.status, patch.status, actor);
    await writeActivity(orgId, row.clientId, actor, "SUPPORT_CASE_STATUS", `${row.caseKey} ${labelStatus(patch.status)}`, row.subject, id, { caseKey: row.caseKey, status: patch.status });
  }
  if (input.assigneeUserId !== undefined && input.assigneeUserId !== existing.assigneeUserId) {
    await writeEvent(orgId, id, "assignee", existing.assigneeUserId, input.assigneeUserId ?? null, actor);
  }
  if (input.priority !== undefined && input.priority !== existing.priority) {
    await writeEvent(orgId, id, "priority", existing.priority, input.priority, actor);
  }
  if (input.typeId !== undefined && input.typeId !== existing.typeId) {
    await writeEvent(orgId, id, "type", existing.typeId, input.typeId ?? null, actor);
  }
  if (input.projectId !== undefined && input.projectId !== existing.projectId) {
    await writeEvent(orgId, id, "project", existing.projectId, input.projectId ?? null, actor);
  }
  return row;
}

export function labelStatus(s: string): string {
  switch (s) {
    case "NEW": return "opened";
    case "WAITING_ON_SUPPORT": return "waiting on support";
    case "IN_PROGRESS": return "in progress";
    case "WAITING_ON_CUSTOMER": return "waiting on customer";
    case "RESOLVED": return "resolved";
    case "CLOSED": return "closed";
    default: return s.toLowerCase();
  }
}

export interface AddMessageInput {
  body: string;
  visibility: "CUSTOMER" | "INTERNAL";
  author: { userId?: string | null; contactId?: string | null; name: string };
  emailMessageId?: string | null;
}

/**
 * Appends a message. An agent's first customer-visible reply stamps
 * first_response_at (the SLA clock); a customer message re-opens a case that
 * was waiting on them. Internal notes never touch the customer-facing clocks.
 */
export async function addMessage(orgId: string, caseId: string, input: AddMessageInput) {
  const existing = await getCaseRaw(orgId, caseId);
  if (!existing) return undefined;
  const isAgent = !!input.author.userId;
  const [msg] = await db.insert(supportCaseMessages).values({
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
  const [row] = await db.update(supportCases).set(patch).where(eq(supportCases.id, caseId)).returning();
  if (patch.status && patch.status !== existing.status) {
    await writeEvent(orgId, caseId, "status", existing.status, patch.status, isAgent ? { userId: input.author.userId!, name: input.author.name } : null);
  }
  void notifyCaseMessage(row, { authorUserId: input.author.userId ?? null, authorName: input.author.name, body: input.body, visibility: input.visibility })
    .catch(err => console.warn("[support] notifyCaseMessage failed", (err as Error)?.message));
  if (input.visibility === "CUSTOMER") {
    await writeActivity(orgId, row.clientId, isAgent ? { userId: input.author.userId!, name: input.author.name } : null,
      isAgent ? "SUPPORT_CASE_REPLY" : "SUPPORT_CASE_CUSTOMER_MESSAGE",
      `${row.caseKey} ${isAgent ? "reply from" : "message from"} ${input.author.name}`,
      input.body.length > 200 ? input.body.slice(0, 200) + "…" : input.body, caseId, { caseKey: row.caseKey });
  }
  return { message: msg, case: row };
}

export async function deleteCase(orgId: string, id: string) {
  const existing = await getCaseRaw(orgId, id);
  if (!existing) return false;
  // Time stays on the books; it just loses the case link.
  await db.update(timeEntries).set({ supportCaseId: null }).where(and(eq(timeEntries.orgId, orgId), eq(timeEntries.supportCaseId, id)));
  // The rows cascade with the case; the bytes in object storage do not. If a
  // blob cannot be removed, keep the case (and its rows, which hold the storage
  // keys) so the delete can be retried instead of orphaning the file.
  const failed: string[] = [];
  for (const a of await listAttachments(orgId, id)) {
    try { await deleteBytes(a.storageKey); } catch (err) { failed.push(a.filename); console.warn("[support-cases] attachment blob not removed", a.id, (err as Error).message); }
  }
  if (failed.length) throw new Error(`Could not remove ${failed.length} attachment file(s) (${failed.slice(0, 3).join(", ")}); try again`);
  await db.delete(supportCases).where(and(eq(supportCases.id, id), eq(supportCases.orgId, orgId)));
  return true;
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
