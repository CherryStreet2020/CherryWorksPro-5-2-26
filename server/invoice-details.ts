import { db } from "./db";
import { timeEntries, invoiceLines, projects, users, services } from "@shared/schema";
import { and, asc, eq, inArray } from "drizzle-orm";

/**
 * Task #465 — server-side helper that, given an invoice id, returns the
 * underlying time-entry breakdown grouped by line and by day, with a
 * weekly subtotal at every ISO-week boundary.
 *
 * This data is *display-only*. It is never used to recompute money totals
 * — `subtotal`, `tax`, and `total` stay driven exclusively by
 * `invoice_lines`. The same shape is consumed by `server/pdf.ts` and the
 * public/in-app web previews so PDF and web stay byte-equivalent.
 *
 * Multi-tenant isolation: every query is scoped by `orgId`.
 */

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

/**
 * Pull the leading ticket reference (e.g. "ABS-150 fixed login bug") from a
 * notes string. The remainder is returned as `description`.
 *
 * Conservative regex: 2-10 uppercase letters, dash, 1+ digits, anchored at
 * start of string. If no match — or notes is null/empty — the ticket is
 * null and the entire notes string falls into `description`.
 */
export function extractTicketRef(notes: string | null | undefined): {
  ticket: string | null;
  description: string;
} {
  if (!notes) return { ticket: null, description: "" };
  const trimmed = notes.trim();
  if (!trimmed) return { ticket: null, description: "" };
  // Separator alternatives are ordered "most specific first" so a
  // dash separator (" - ") wins over a plain space, otherwise the
  // greedy `\s+` would consume the space and leave a stray "-" in
  // the description.
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
  // Construct in UTC so date strings render the same regardless of server
  // timezone. `time_entries.date` is a `date` (no TZ) column.
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (isNaN(d.getTime())) return isoDate;
  const dow = WEEKDAY_LABELS[d.getUTCDay()];
  const mon = MONTH_LABELS[d.getUTCMonth()];
  const day = d.getUTCDate();
  return `${dow}, ${mon} ${day}`;
}

/**
 * Returns the ISO date (YYYY-MM-DD) of the Monday of the week
 * containing `isoDate`. Used to bucket entries into weeks for the
 * "This week: ..." subtotal row.
 */
export function isoWeekStart(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (isNaN(d.getTime())) return isoDate;
  // getUTCDay: Sun=0..Sat=6. We want Mon=0..Sun=6 so we shift.
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

interface JoinedEntry {
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

/**
 * Fetch all time entries that were aggregated into this invoice's lines,
 * scoped by `orgId`, and return them grouped per line as an ordered list
 * of detail items (day headers, entry rows, weekly subtotals).
 *
 * Returns an empty `Map` when the invoice has no lines with attached
 * time entries — callers should treat that as "no detail block".
 */
export async function getInvoiceTimeEntryDetails(
  invoiceId: string,
  orgId: string,
): Promise<Map<string, DetailItem[]>> {
  // 1. Pull every line on this invoice (org-scoped) so we know the
  //    line ids we're grouping under.
  const lines = await db
    .select({ id: invoiceLines.id })
    .from(invoiceLines)
    .where(and(eq(invoiceLines.invoiceId, invoiceId), eq(invoiceLines.orgId, orgId)));

  const lineIds = lines.map(l => l.id);
  if (lineIds.length === 0) return new Map();

  // 2. Pull every time entry attached to any of those lines, joined
  //    with project/user/service for display labels. We org-scope the
  //    join on time_entries to defend against any stale cross-tenant
  //    line→entry pointer.
  // Filter on the actual line-id set in SQL (not in JS) so the query
  // stays O(entries on this invoice) rather than O(all org invoiced
  // entries). Critical for orgs with thousands of historical entries.
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
      userName: users.name,
      serviceName: services.name,
    })
    .from(timeEntries)
    .innerJoin(projects, eq(timeEntries.projectId, projects.id))
    .innerJoin(users, eq(timeEntries.userId, users.id))
    .leftJoin(services, eq(timeEntries.serviceId, services.id))
    .where(and(
      eq(timeEntries.orgId, orgId),
      eq(timeEntries.invoiced, true),
      inArray(timeEntries.invoiceLineId, lineIds),
    ))
    .orderBy(asc(timeEntries.date), asc(timeEntries.startTime));

  // Bucket by lineId. The SQL filter already guarantees membership;
  // a defensive null/membership check is kept to harden against
  // upstream query changes.
  const lineIdSet = new Set(lineIds);
  const byLine = new Map<string, JoinedEntry[]>();
  for (const r of rows) {
    if (!r.invoiceLineId || !lineIdSet.has(r.invoiceLineId)) continue;
    const list = byLine.get(r.invoiceLineId) || [];
    list.push(r as JoinedEntry);
    byLine.set(r.invoiceLineId, list);
  }

  const out = new Map<string, DetailItem[]>();
  for (const [lineId, entries] of byLine.entries()) {
    out.set(lineId, buildDetailItems(entries));
  }
  return out;
}

/**
 * Convert a flat ordered list of joined entries (already sorted by
 * date asc, startTime asc) into the rendering item stream. Pure
 * function — exported for unit testing.
 */
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

/**
 * Format a decimal-hour value as H:MM. Used by both PDF and web
 * renderers for the day/week subtotals and per-entry hours columns.
 */
export function formatHM(hours: number): string {
  const total = Math.round(Math.abs(hours) * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${hours < 0 ? "-" : ""}${h}:${m.toString().padStart(2, "0")}`;
}

/**
 * Resolve the effective per-invoice "show details" flag. Returns the
 * org-level default when the invoice does not have an explicit override.
 * Centralised so PDF/web/in-app preview never disagree.
 */
export function resolveShowTimeEntryDetails(
  invoiceOverride: boolean | null | undefined,
  orgDefault: boolean | null | undefined,
): boolean {
  if (invoiceOverride === true || invoiceOverride === false) return invoiceOverride;
  return !!orgDefault;
}
