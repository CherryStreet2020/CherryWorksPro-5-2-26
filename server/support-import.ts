/**
 * Jira Service Management → Support Cases import.
 *
 * Input is a plain JSON export (one object per issue: fields, comments,
 * status transitions) produced from Jira's REST API. The import keeps the
 * original keys and dates, maps statuses/priorities/request types, resolves
 * reporters to client contacts (creating missing ones when an email is
 * present), resolves assignees to team members by email then name, writes
 * comments as messages (public → CUSTOMER, internal → INTERNAL) and status
 * transitions as events, then bumps the client's counter past the highest
 * imported number. Re-running skips keys that already exist. Optionally
 * re-links time entries whose notes start with the key.
 */
import { and, eq, ilike, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import {
  clientContacts, clients, projects, supportCaseEvents, supportCaseMessages, supportCaseTypes, supportCases, timeEntries, users,
} from "@shared/schema";
import { ensureDefaultTypes, ensureUniquePrefix } from "./support-cases";
import { createAttachment, existingExternalRefs, MAX_ATTACHMENT_BYTES } from "./support-attachments";

export interface JiraExportComment { author: string | null; email?: string | null; agent?: boolean; public: boolean; created: string; body: string }
export interface JiraExportTransition { from?: string | null; to: string | null; at: string; by?: string | null }
export interface JiraExportAttachment { id: string; filename: string; mimeType?: string | null; size?: number | null; contentUrl: string; created?: string | null }
export interface JiraExportIssue {
  key: string;
  summary: string;
  description?: string | null;
  status: string;
  statusCategory?: string | null;
  priority?: string | null;
  requestType?: string | null;
  issueType?: string | null;
  components?: string[];
  reporterName?: string | null;
  reporterEmail?: string | null;
  reporterIsAgent?: boolean;
  assigneeName?: string | null;
  assigneeEmail?: string | null;
  created: string;
  updated?: string | null;
  resolved?: string | null;
  comments?: JiraExportComment[];
  transitions?: JiraExportTransition[];
  attachments?: JiraExportAttachment[];
}

export interface ImportOptions {
  orgId: string;
  clientId: string;
  projectId?: string | null;
  items: JiraExportIssue[];
  relinkTime?: boolean;
  dryRun?: boolean;
  /** Fetches attachment bytes (Basic-auth Jira download). Absent → attachments are skipped. */
  downloadAttachment?: (att: JiraExportAttachment) => Promise<Buffer>;
  /** Also pull attachments onto cases that already exist: open ones, all, or none (default open). */
  attachmentsForExisting?: "open" | "all" | "none";
}

export interface ImportReport {
  imported: number;
  skipped: string[];
  contactsCreated: number;
  unmatchedAssignees: string[];
  unmatchedTypes: string[];
  timeEntriesLinked: number;
  attachmentsImported: number;
  attachmentErrors: { key: string; filename: string; error: string }[];
  nextCaseNumber: number;
  errors: { key: string; error: string }[];
}

export function mapStatus(name: string | null | undefined, category?: string | null): string {
  const n = (name || "").trim().toLowerCase();
  if (/waiting for customer|awaiting customer|pending customer/.test(n)) return "WAITING_ON_CUSTOMER";
  if (/waiting for support|open|to do|new/.test(n)) return "WAITING_ON_SUPPORT";
  if (/in progress|work in progress|escalated|under investigation/.test(n)) return "IN_PROGRESS";
  if (/resolved/.test(n)) return "RESOLVED";
  if (/closed|done|cancel|declined|won't/.test(n)) return "CLOSED";
  if (category === "done") return "CLOSED";
  if (category === "indeterminate") return "IN_PROGRESS";
  return "WAITING_ON_SUPPORT";
}

export function mapPriority(name: string | null | undefined): string {
  const n = (name || "").trim().toLowerCase();
  if (/lowest|low|minor|trivial/.test(n)) return "LOW";
  if (/highest|urgent|critical|blocker/.test(n)) return "URGENT";
  if (/high|major/.test(n)) return "HIGH";
  return "MEDIUM";
}

function norm(s: string | null | undefined): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/s\b/g, "").trim();
}

function parseKey(key: string): { prefix: string; number: number } | null {
  const m = key.match(/^([A-Z][A-Z0-9]{1,9})-(\d+)$/);
  return m ? { prefix: m[1], number: Number(m[2]) } : null;
}

export async function importJiraIssues(opts: ImportOptions): Promise<ImportReport> {
  const report: ImportReport = { imported: 0, skipped: [], contactsCreated: 0, unmatchedAssignees: [], unmatchedTypes: [], timeEntriesLinked: 0, attachmentsImported: 0, attachmentErrors: [], nextCaseNumber: 0, errors: [] };
  const [client] = await db.select().from(clients).where(and(eq(clients.id, opts.clientId), eq(clients.orgId, opts.orgId)));
  if (!client) throw new Error("Client not found");
  if (opts.projectId) {
    const [p] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, opts.projectId), eq(projects.orgId, opts.orgId), eq(projects.clientId, opts.clientId)));
    if (!p) throw new Error("Project does not belong to this client");
  }

  const types = await ensureDefaultTypes(opts.orgId);
  const typeByNorm = new Map(types.map(t => [norm(t.name), t.id]));
  const team = await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(and(eq(users.orgId, opts.orgId), eq(users.isActive, true)));
  const userByEmail = new Map(team.map(u => [u.email.toLowerCase(), u.id]));
  const userByName = new Map(team.map(u => [norm(u.name), u.id]));
  const existingContacts = await db.select({ id: clientContacts.id, email: clientContacts.email, firstName: clientContacts.firstName, lastName: clientContacts.lastName })
    .from(clientContacts).where(and(eq(clientContacts.orgId, opts.orgId), eq(clientContacts.clientId, opts.clientId)));
  const contactByEmail = new Map(existingContacts.filter(c => c.email).map(c => [c.email!.toLowerCase(), c.id]));

  const existingRows = await db.select({ id: supportCases.id, k: supportCases.caseKey, status: supportCases.status }).from(supportCases).where(eq(supportCases.orgId, opts.orgId));
  const existingKeys = new Set(existingRows.map(r => r.k));
  const existingByKey = new Map(existingRows.map(r => [r.k, r]));
  const attachmentsMode = opts.attachmentsForExisting ?? "open";
  const knownRefs = opts.downloadAttachment ? await existingExternalRefs(opts.orgId, existingRows.map(r => r.id)) : new Set<string>();

  /** On re-run, bring existing imported cases' text up to date (e.g. media markers that now carry filenames). */
  const refreshImportedText = async (caseId: string, item: JiraExportIssue) => {
    if (opts.dryRun) return;
    const [row] = await db.select({ description: supportCases.description, source: supportCases.source }).from(supportCases).where(eq(supportCases.id, caseId));
    if (!row || row.source !== "IMPORT") return;
    const desc = item.description || null;
    if (desc !== row.description) await db.update(supportCases).set({ description: desc }).where(eq(supportCases.id, caseId));
    const msgs = await db.select({ id: supportCaseMessages.id, authorName: supportCaseMessages.authorName, body: supportCaseMessages.body, createdAt: supportCaseMessages.createdAt })
      .from(supportCaseMessages).where(eq(supportCaseMessages.caseId, caseId));
    for (const c of item.comments || []) {
      const at = new Date(c.created).getTime();
      const match = msgs.find(m => Math.abs(m.createdAt.getTime() - at) < 2000 && m.authorName === (c.author || (c.agent ? "Team" : "Customer")));
      const body = c.body || "(empty)";
      if (match && match.body !== body) await db.update(supportCaseMessages).set({ body }).where(eq(supportCaseMessages.id, match.id));
    }
  };

  const importAttachments = async (caseId: string, item: JiraExportIssue) => {
    if (!opts.downloadAttachment || opts.dryRun) return;
    for (const att of item.attachments || []) {
      const ref = `JIRA:${att.id}`;
      if (knownRefs.has(ref)) continue;
      if ((att.size ?? 0) > MAX_ATTACHMENT_BYTES) { report.attachmentErrors.push({ key: item.key, filename: att.filename, error: "larger than 15 MB" }); continue; }
      try {
        const bytes = await opts.downloadAttachment(att);
        await createAttachment({ orgId: opts.orgId, caseId, filename: att.filename, mimeType: att.mimeType || "application/octet-stream", bytes, source: "IMPORT", externalRef: ref });
        knownRefs.add(ref);
        report.attachmentsImported++;
      } catch (err) {
        report.attachmentErrors.push({ key: item.key, filename: att.filename, error: (err as Error).message });
      }
    }
  };

  // Prefix: take it from the export keys; make sure this client owns it.
  const prefixes = new Set(opts.items.map(i => parseKey(i.key)?.prefix).filter(Boolean) as string[]);
  if (prefixes.size !== 1) throw new Error(`Export must contain exactly one key prefix (found ${[...prefixes].join(", ") || "none"})`);
  const prefix = [...prefixes][0];
  const unique = await ensureUniquePrefix(opts.orgId, opts.clientId, prefix);
  if (unique !== prefix) throw new Error(`Prefix ${prefix} is already used by another client`);

  let maxNumber = 0;
  const keyToId = new Map<string, string>();

  for (const item of [...opts.items].sort((a, b) => (parseKey(a.key)?.number ?? 0) - (parseKey(b.key)?.number ?? 0))) {
    const parsed = parseKey(item.key);
    if (!parsed) { report.errors.push({ key: item.key, error: "Unrecognised key" }); continue; }
    maxNumber = Math.max(maxNumber, parsed.number);
    if (existingKeys.has(item.key)) {
      report.skipped.push(item.key);
      const ex = existingByKey.get(item.key)!;
      const isOpen = ["NEW", "WAITING_ON_SUPPORT", "IN_PROGRESS", "WAITING_ON_CUSTOMER"].includes(ex.status);
      await refreshImportedText(ex.id, item);
      if (attachmentsMode === "all" || (attachmentsMode === "open" && isOpen)) await importAttachments(ex.id, item);
      continue;
    }

    try {
      const typeId = item.requestType ? typeByNorm.get(norm(item.requestType)) ?? null : null;
      if (item.requestType && !typeId && !report.unmatchedTypes.includes(item.requestType)) report.unmatchedTypes.push(item.requestType);

      let assigneeUserId: string | null = null;
      if (item.assigneeEmail && userByEmail.has(item.assigneeEmail.toLowerCase())) assigneeUserId = userByEmail.get(item.assigneeEmail.toLowerCase())!;
      else if (item.assigneeName && userByName.has(norm(item.assigneeName))) assigneeUserId = userByName.get(norm(item.assigneeName))!;
      else if (item.assigneeName) {
        // first-name match as a last resort ("David" → "David Caldwell")
        const first = norm(item.assigneeName).split(" ")[0];
        const hit = team.find(u => norm(u.name).split(" ")[0] === first);
        if (hit) assigneeUserId = hit.id;
        else if (!report.unmatchedAssignees.includes(item.assigneeName)) report.unmatchedAssignees.push(item.assigneeName);
      }

      let requesterContactId: string | null = null;
      const reporterEmail = item.reporterEmail?.toLowerCase() || null;
      if (reporterEmail && !item.reporterIsAgent) {
        requesterContactId = contactByEmail.get(reporterEmail) ?? null;
        if (!requesterContactId && !opts.dryRun) {
          const [first, ...rest] = (item.reporterName || reporterEmail.split("@")[0]).split(" ");
          const [c] = await db.insert(clientContacts).values({
            orgId: opts.orgId, clientId: opts.clientId, firstName: first || "Contact", lastName: rest.join(" ") || "", email: reporterEmail, source: "import",
          }).returning({ id: clientContacts.id });
          requesterContactId = c.id;
          contactByEmail.set(reporterEmail, c.id);
          report.contactsCreated++;
        }
      }

      const status = mapStatus(item.status, item.statusCategory);
      const createdAt = new Date(item.created);
      const updatedAt = item.updated ? new Date(item.updated) : createdAt;
      const resolvedAt = item.resolved ? new Date(item.resolved) : (status === "RESOLVED" || status === "CLOSED" ? updatedAt : null);
      const publicAgentComments = (item.comments || []).filter(c => c.agent && c.public).map(c => new Date(c.created).getTime());
      const firstResponseAt = publicAgentComments.length ? new Date(Math.min(...publicAgentComments)) : null;
      const customerComments = (item.comments || []).filter(c => !c.agent).map(c => new Date(c.created).getTime());
      const agentComments = (item.comments || []).filter(c => c.agent && c.public).map(c => new Date(c.created).getTime());

      if (opts.dryRun) { report.imported++; continue; }

      const [row] = await db.insert(supportCases).values({
        orgId: opts.orgId, clientId: opts.clientId, projectId: opts.projectId ?? null, typeId,
        caseKey: item.key, caseNumber: parsed.number,
        subject: item.summary || "(no subject)", description: item.description || null,
        status, priority: mapPriority(item.priority), source: "IMPORT",
        requesterContactId, requesterName: item.reporterName || null, requesterEmail: reporterEmail,
        assigneeUserId, createdByUserId: null,
        firstResponseAt,
        lastCustomerMessageAt: customerComments.length ? new Date(Math.max(...customerComments)) : null,
        lastAgentMessageAt: agentComments.length ? new Date(Math.max(...agentComments)) : null,
        resolvedAt, closedAt: status === "CLOSED" ? resolvedAt : null,
        externalRef: `JIRA:${item.key}`,
        createdAt, updatedAt,
      }).returning({ id: supportCases.id });
      keyToId.set(item.key, row.id);
      await importAttachments(row.id, item);

      await db.insert(supportCaseEvents).values({ orgId: opts.orgId, caseId: row.id, kind: "created", fromValue: null, toValue: "NEW", actorName: item.reporterName || null, createdAt });
      for (const t of item.transitions || []) {
        await db.insert(supportCaseEvents).values({ orgId: opts.orgId, caseId: row.id, kind: "status", fromValue: mapStatus(t.from), toValue: mapStatus(t.to), actorName: t.by || null, createdAt: new Date(t.at) });
      }
      for (const c of item.comments || []) {
        const authorEmail = c.email?.toLowerCase() || null;
        const authorUserId = c.agent && authorEmail ? userByEmail.get(authorEmail) ?? null : null;
        const authorContactId = !c.agent && authorEmail ? contactByEmail.get(authorEmail) ?? null : null;
        await db.insert(supportCaseMessages).values({
          orgId: opts.orgId, caseId: row.id, authorUserId, authorContactId, authorName: c.author || (c.agent ? "Team" : "Customer"),
          visibility: c.public ? "CUSTOMER" : "INTERNAL", body: c.body || "(empty)", createdAt: new Date(c.created),
        });
      }
      report.imported++;
    } catch (err) {
      report.errors.push({ key: item.key, error: (err as Error).message });
    }
  }

  const next = maxNumber + 1;
  report.nextCaseNumber = Math.max(next, client.nextCaseNumber);
  if (!opts.dryRun) {
    await db.update(clients).set({ caseKeyPrefix: prefix, nextCaseNumber: report.nextCaseNumber }).where(eq(clients.id, opts.clientId));
  }

  if (opts.relinkTime && !opts.dryRun) {
    report.timeEntriesLinked = await relinkTimeEntries(opts.orgId, opts.clientId, prefix);
  }
  return report;
}

/** time_entries whose notes start with "<PREFIX>-<n>" get linked to that case (this client's projects only). */
export async function relinkTimeEntries(orgId: string, clientId: string, prefix: string): Promise<number> {
  const caseRows = await db.select({ id: supportCases.id, key: supportCases.caseKey }).from(supportCases)
    .where(and(eq(supportCases.orgId, orgId), eq(supportCases.clientId, clientId), ilike(supportCases.caseKey, `${prefix}-%`)));
  const byKey = new Map(caseRows.map(r => [r.key, r.id]));
  const clientProjects = (await db.select({ id: projects.id }).from(projects).where(and(eq(projects.orgId, orgId), eq(projects.clientId, clientId)))).map(p => p.id);
  if (clientProjects.length === 0 || byKey.size === 0) return 0;
  const entries = await db.select({ id: timeEntries.id, notes: timeEntries.notes, supportCaseId: timeEntries.supportCaseId })
    .from(timeEntries)
    .where(and(eq(timeEntries.orgId, orgId), inArray(timeEntries.projectId, clientProjects), sql`${timeEntries.notes} ~ ${`^${prefix}-[0-9]+`}`));
  let n = 0;
  for (const e of entries) {
    if (e.supportCaseId) continue;
    const m = (e.notes || "").match(/^([A-Z][A-Z0-9]{1,9}-\d+)/);
    const id = m ? byKey.get(m[1]) : undefined;
    if (!id) continue;
    await db.update(timeEntries).set({ supportCaseId: id }).where(eq(timeEntries.id, e.id));
    n++;
  }
  return n;
}
