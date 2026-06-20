import { db } from "./db";
import { timeEntries, invoiceLines, invoices, projects, users, services } from "@shared/schema";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

// Display-only: groups a sent invoice's time entries into day/entry/week
// rows per line. Money totals come from invoice_lines. Queries are org-scoped.

export interface DetailDayHeader {
  kind: "day";
  date: string;        // ISO date YYYY-MM-DD
  weekday: string;     // e.g. "TUESDAY, APR 28"
  totalHours: number;  // sum of entries on this day, decimal
}

export interface DetailEntryRow {
  kind: "entry";
  id: string;
  startTime: string | null;  // HH:MM
  endTime: string | null;    // HH:MM
  project: string;
  ticket: string | null;     // e.g. "ABS-150" parsed from notes prefix
  description: string;       // notes minus the ticket prefix; "" if none
  hours: number;             // decimal
  billable: boolean;
}

export interface DetailWeekFooter {
  kind: "week";
  weekStart: string;         // ISO date of the Monday
  billableHours: number;
  internalHours: number;
  totalHours: number;
}

export type DetailItem = DetailDayHeader | DetailEntryRow | DetailWeekFooter;

// Parses a leading "ABS-150" ticket ref out of notes.
// Separator order: " - " before ": " before whitespace.
export function extractTicketRef(notes: string | null | undefined): {
  ticket: string | null;
  description: string;
} {
  if (!notes) return { ticket: null, description: "" };
  const trimmed = notes.trim();
  if (!trimmed) return { ticket: null, description: "" };
  const m = trimmed.match(/^([A-Z]{2,10}-\d+)(?:\s*-\s+|:\s*|\s+)?(.*)$/s);
  if (!m) return { ticket: null, description: trimmed };
  return { ticket: m[1], description: (m[2] || "").trim() };
}

const WEEKDAY_LABELS = [
  "SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY",
  "THURSDAY", "FRIDAY", "SATURDAY",
];
const MONTH_LABELS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

function formatWeekday(isoDate: string): string {
  // UTC so output is timezone-independent.
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (isNaN(d.getTime())) return isoDate;
  const dow = WEEKDAY_LABELS[d.getUTCDay()];
  const mon = MONTH_LABELS[d.getUTCMonth()];
  const day = d.getUTCDate();
  return `${dow}, ${mon} ${day}`;
}

// ISO date of the Monday of the week containing `isoDate`.
export function isoWeekStart(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (isNaN(d.getTime())) return isoDate;
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export interface JoinedEntry {
  id: string;
  date: string;
  minutes: number;
  billable: boolean;
  notes: string | null;
  startTime: string | null;
  endTime: string | null;
  invoiceLineId: string | null;
  projectName: string;
  userName: string;
  serviceName: string | null;
}

// Returns Map<lineId, DetailItem[]> for this invoice's own lines.
//
// Only entries linked to one of THIS invoice's lines via
// time_entries.invoice_line_id are returned — the worklog detail is the
// breakdown behind each billed line. It does NOT include the client's other
// unbilled time (that previously leaked unrelated/non-billable entries onto the
// customer-facing invoice and drifted after send). A manually-created invoice
// with no time-linked lines returns an empty map.
export async function getInvoiceTimeEntryDetails(
  invoiceId: string,
  orgId: string,
): Promise<Map<string, DetailItem[]>> {
  const [invoice] = await db
    .select({ id: invoices.id, clientId: invoices.clientId })
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.orgId, orgId)));
  if (!invoice) return new Map();

  const lines = await db
    .select({ id: invoiceLines.id })
    .from(invoiceLines)
    .where(and(eq(invoiceLines.invoiceId, invoiceId), eq(invoiceLines.orgId, orgId)));

  const lineIds = lines.map(l => l.id);
  const lineIdSet = new Set(lineIds);

  // Build the entry filter: ONLY entries linked to THIS invoice's own lines
  // (time_entries.invoice_line_id IN this invoice's lines). The worklog detail
  // is the breakdown behind each billed line. It deliberately does NOT surface
  // the client's other unbilled time: doing so leaked unrelated and non-billable
  // (internal) entries onto the customer-facing invoice, drifted as new time was
  // logged after send, and was unbounded. A manually-created invoice with no
  // time-linked lines therefore shows no time breakdown, which is correct.
  const linkedClause = lineIds.length > 0
    ? inArray(timeEntries.invoiceLineId, lineIds)
    : sql`false`;

  const rows = await db
    .select({
      id: timeEntries.id,
      date: timeEntries.date,
      minutes: timeEntries.minutes,
      billable: timeEntries.billable,
      notes: timeEntries.notes,
      startTime: timeEntries.startTime,
      endTime: timeEntries.endTime,
      invoiceLineId: timeEntries.invoiceLineId,
      projectName: projects.name,
      projectClientId: projects.clientId,
      userName: users.name,
      serviceName: services.name,
    })
    .from(timeEntries)
    // leftJoin so deleted projects/users don't drop entries; fallback labels below.
    // Note: projects join is org-scoped only (no clientId predicate) so the
    // unallocatedClause can filter on projects.clientId without dropping rows.
    .leftJoin(
      projects,
      and(eq(timeEntries.projectId, projects.id), eq(projects.orgId, orgId)),
    )
    .leftJoin(
      users,
      and(eq(timeEntries.userId, users.id), eq(users.orgId, orgId)),
    )
    .leftJoin(
      services,
      and(eq(timeEntries.serviceId, services.id), eq(services.orgId, orgId)),
    )
    .where(and(
      eq(timeEntries.orgId, orgId),
      linkedClause,
    ))
    .orderBy(asc(timeEntries.date), asc(timeEntries.startTime));

  const byBucket = new Map<string, JoinedEntry[]>();
  for (const r of rows) {
    let bucket: string;
    if (r.invoiceLineId && lineIdSet.has(r.invoiceLineId)) {
      bucket = r.invoiceLineId;
    } else {
      continue;
    }
    const list = byBucket.get(bucket) || [];
    list.push({
      id: r.id,
      date: r.date,
      minutes: r.minutes,
      billable: r.billable,
      notes: r.notes,
      startTime: r.startTime,
      endTime: r.endTime,
      invoiceLineId: r.invoiceLineId,
      projectName: r.projectName ?? "(deleted project)",
      userName: r.userName ?? "(deleted user)",
      serviceName: r.serviceName,
    });
    byBucket.set(bucket, list);
  }

  const out = new Map<string, DetailItem[]>();
  for (const [bucket, entries] of byBucket.entries()) {
    out.set(bucket, buildDetailItems(entries));
  }
  return out;
}

// Turns a date-asc list of joined entries into the day/entry/week item stream.
export function buildDetailItems(entries: JoinedEntry[]): DetailItem[] {
  const items: DetailItem[] = [];
  let currentDay: string | null = null;
  let currentWeek: string | null = null;
  let weekBillable = 0;
  let weekInternal = 0;
  let dayHeaderIndex = -1;
  let dayMinutes = 0;

  const flushDayTotal = () => {
    if (dayHeaderIndex >= 0) {
      const hdr = items[dayHeaderIndex] as DetailDayHeader;
      hdr.totalHours = dayMinutes / 60;
    }
  };

  const flushWeek = () => {
    if (currentWeek === null) return;
    items.push({
      kind: "week",
      weekStart: currentWeek,
      billableHours: weekBillable / 60,
      internalHours: weekInternal / 60,
      totalHours: (weekBillable + weekInternal) / 60,
    });
    weekBillable = 0;
    weekInternal = 0;
  };

  for (const e of entries) {
    const wk = isoWeekStart(e.date);
    if (currentWeek !== null && wk !== currentWeek) {
      flushDayTotal();
      flushWeek();
      currentDay = null;
      dayHeaderIndex = -1;
      dayMinutes = 0;
    }
    currentWeek = wk;

    if (e.date !== currentDay) {
      flushDayTotal();
      currentDay = e.date;
      dayMinutes = 0;
      items.push({
        kind: "day",
        date: e.date,
        weekday: formatWeekday(e.date),
        totalHours: 0,
      });
      dayHeaderIndex = items.length - 1;
    }

    const { ticket, description } = extractTicketRef(e.notes);
    items.push({
      kind: "entry",
      id: e.id,
      startTime: e.startTime,
      endTime: e.endTime,
      project: e.projectName,
      ticket,
      description,
      hours: e.minutes / 60,
      billable: e.billable,
    });
    dayMinutes += e.minutes;
    if (e.billable) weekBillable += e.minutes;
    else weekInternal += e.minutes;
  }

  flushDayTotal();
  flushWeek();
  return items;
}

export function formatHM(hours: number): string {
  const total = Math.round(Math.abs(hours) * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${hours < 0 ? "-" : ""}${h}:${m.toString().padStart(2, "0")}`;
}

export function resolveShowTimeEntryDetails(
  invoiceOverride: boolean | null | undefined,
  orgDefault: boolean | null | undefined,
): boolean {
  if (invoiceOverride === true || invoiceOverride === false) return invoiceOverride;
  return !!orgDefault;
}
