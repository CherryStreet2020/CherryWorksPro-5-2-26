/**
 * Service levels for Support Cases.
 *
 * A policy says how many hours the team has to first respond and to resolve,
 * optionally counted in business hours (weekdays, start..end hour, in the
 * policy's timezone). Due timestamps are stamped when a case is created; the
 * clocks pause while the case waits on the customer and resume shifted by the
 * paused duration. A processor alerts the assignee shortly before and at
 * breach.
 */
import { and, eq, isNull, or, sql, inArray } from "drizzle-orm";
import { db } from "./db";
import { supportCases, supportSlaPolicies, type SupportSlaPolicy, SUPPORT_CASE_OPEN_STATUSES, SUPPORT_CASE_CLOCK_RUNNING_STATUSES } from "@shared/schema";

export interface SlaPolicyInput {
  firstResponseHours: number;
  resolutionHours: number;
  businessHoursOnly: boolean;
  businessStartHour: number;
  businessEndHour: number;
  timezone: string;
}

export const DEFAULT_POLICY: SlaPolicyInput = {
  firstResponseHours: 8,
  resolutionHours: 24,
  businessHoursOnly: true,
  businessStartHour: 9,
  businessEndHour: 17,
  timezone: "America/New_York",
};

// ── Business-hours arithmetic (pure, timezone-aware via Intl) ───────────────
function partsIn(tz: string, d: Date): { y: number; m: number; day: number; hour: number; minute: number; weekday: number } {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" });
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(d)) p[part.type] = part.value;
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { y: Number(p.year), m: Number(p.month), day: Number(p.day), hour: Number(p.hour) % 24, minute: Number(p.minute), weekday: wd };
}

/** UTC offset (minutes) of `tz` at instant `d`. */
function offsetMinutes(tz: string, d: Date): number {
  const p = partsIn(tz, d);
  const asUtc = Date.UTC(p.y, p.m - 1, p.day, p.hour, p.minute, 0, 0);
  return Math.round((asUtc - d.getTime()) / 60000);
}

/** The instant of local wall-clock (y, m, day, hour, minute) in `tz`. */
function zonedToInstant(tz: string, y: number, m: number, day: number, hour: number, minute: number): Date {
  const guess = new Date(Date.UTC(y, m - 1, day, hour, minute, 0, 0));
  const off1 = offsetMinutes(tz, guess);
  const d1 = new Date(guess.getTime() - off1 * 60000);
  const off2 = offsetMinutes(tz, d1);
  return off2 === off1 ? d1 : new Date(guess.getTime() - off2 * 60000);
}

function isBusinessDay(weekday: number): boolean {
  return weekday >= 1 && weekday <= 5;
}

/**
 * Adds `hours` of business time to `from`. Time outside the business window
 * (evenings, weekends) does not count. If `from` is outside the window, the
 * clock starts at the next window open.
 */
export function addBusinessHours(from: Date, hours: number, policy: Pick<SlaPolicyInput, "businessStartHour" | "businessEndHour" | "timezone">): Date {
  let remainingMs = Math.max(0, hours) * 3600000;
  let cursor = new Date(from.getTime());
  for (let guard = 0; guard < 400; guard++) {
    const p = partsIn(policy.timezone, cursor);
    const dayOpen = zonedToInstant(policy.timezone, p.y, p.m, p.day, policy.businessStartHour, 0);
    const dayClose = zonedToInstant(policy.timezone, p.y, p.m, p.day, policy.businessEndHour, 0);
    if (!isBusinessDay(p.weekday) || cursor.getTime() >= dayClose.getTime()) {
      // jump to next day's open
      const next = new Date(dayOpen.getTime() + 24 * 3600000);
      const np = partsIn(policy.timezone, next);
      cursor = zonedToInstant(policy.timezone, np.y, np.m, np.day, policy.businessStartHour, 0);
      continue;
    }
    if (cursor.getTime() < dayOpen.getTime()) cursor = dayOpen;
    const available = dayClose.getTime() - cursor.getTime();
    if (remainingMs <= available) return new Date(cursor.getTime() + remainingMs);
    remainingMs -= available;
    cursor = dayClose;
  }
  return cursor;
}

export function addHours(from: Date, hours: number, policy: SlaPolicyInput): Date {
  return policy.businessHoursOnly ? addBusinessHours(from, hours, policy) : new Date(from.getTime() + hours * 3600000);
}

export function computeDueDates(from: Date, policy: SlaPolicyInput): { firstResponseDueAt: Date; resolutionDueAt: Date } {
  return {
    firstResponseDueAt: addHours(from, policy.firstResponseHours, policy),
    resolutionDueAt: addHours(from, policy.resolutionHours, policy),
  };
}

export type SlaState = "none" | "ok" | "warning" | "breached" | "paused" | "met";

/** Read-side summary for a case row. `warning` = under 25% of the window left (or under 1 hour). */
export function slaStateFor(row: {
  status: string; createdAt: Date | string; firstResponseAt: Date | string | null; firstResponseDueAt: Date | string | null;
  resolutionDueAt: Date | string | null; resolvedAt: Date | string | null; slaPausedAt: Date | string | null;
}, now = new Date()): { firstResponse: SlaState; resolution: SlaState; nextDueAt: string | null; label: string } {
  const t = (v: Date | string | null) => (v ? new Date(v).getTime() : null);
  const open = (SUPPORT_CASE_OPEN_STATUSES as readonly string[]).includes(row.status);
  const judge = (dueAt: number | null, doneAt: number | null): SlaState => {
    if (!dueAt) return "none";
    if (doneAt) return doneAt <= dueAt ? "met" : "breached";
    if (!open) return "met";
    if (row.slaPausedAt) return "paused";
    if (now.getTime() > dueAt) return "breached";
    // Warning inside the last hour before the target.
    return dueAt - now.getTime() < 3600000 ? "warning" : "ok";
  };
  const fr = judge(t(row.firstResponseDueAt), t(row.firstResponseAt));
  const rs = judge(t(row.resolutionDueAt), t(row.resolvedAt));
  const nextDue = !row.firstResponseAt ? t(row.firstResponseDueAt) : t(row.resolutionDueAt);
  let label = "";
  const active = !row.firstResponseAt ? fr : rs;
  if (!open) label = "";
  else if (active === "paused") label = "Paused (waiting on customer)";
  else if (active === "breached") label = `${!row.firstResponseAt ? "Response" : "Resolution"} overdue`;
  else if (nextDue) {
    const mins = Math.round((nextDue - now.getTime()) / 60000);
    const h = Math.floor(mins / 60), m = mins % 60;
    label = `${!row.firstResponseAt ? "Reply" : "Resolve"} in ${h > 0 ? `${h}h ${m}m` : `${m}m`}`;
  }
  return { firstResponse: fr, resolution: rs, nextDueAt: nextDue ? new Date(nextDue).toISOString() : null, label };
}

// ── Policy resolution and persistence ──────────────────────────────────────
function toInput(p: SupportSlaPolicy): SlaPolicyInput {
  return {
    firstResponseHours: Number(p.firstResponseHours), resolutionHours: Number(p.resolutionHours),
    businessHoursOnly: p.businessHoursOnly, businessStartHour: p.businessStartHour, businessEndHour: p.businessEndHour, timezone: p.timezone,
  };
}

export async function getPolicyRow(orgId: string, clientId: string | null): Promise<SupportSlaPolicy | undefined> {
  const [row] = await db.select().from(supportSlaPolicies)
    .where(and(eq(supportSlaPolicies.orgId, orgId), clientId ? eq(supportSlaPolicies.clientId, clientId) : isNull(supportSlaPolicies.clientId)));
  return row;
}

/** The effective policy for a client: its override, else the org default, else DEFAULT_POLICY. */
export async function resolvePolicy(orgId: string, clientId: string | null): Promise<{ policy: SlaPolicyInput; source: "client" | "org" | "default" }> {
  if (clientId) {
    const c = await getPolicyRow(orgId, clientId);
    if (c) return { policy: toInput(c), source: "client" };
  }
  const o = await getPolicyRow(orgId, null);
  if (o) return { policy: toInput(o), source: "org" };
  return { policy: DEFAULT_POLICY, source: "default" };
}

export async function upsertPolicy(orgId: string, clientId: string | null, input: SlaPolicyInput): Promise<SupportSlaPolicy> {
  const existing = await getPolicyRow(orgId, clientId);
  const values = {
    firstResponseHours: String(input.firstResponseHours), resolutionHours: String(input.resolutionHours),
    businessHoursOnly: input.businessHoursOnly, businessStartHour: input.businessStartHour, businessEndHour: input.businessEndHour, timezone: input.timezone,
    updatedAt: new Date(),
  };
  if (existing) {
    const [row] = await db.update(supportSlaPolicies).set(values).where(eq(supportSlaPolicies.id, existing.id)).returning();
    return row;
  }
  const [row] = await db.insert(supportSlaPolicies).values({ orgId, clientId, ...values }).returning();
  return row;
}

export async function deleteClientPolicy(orgId: string, clientId: string): Promise<boolean> {
  const rows = await db.delete(supportSlaPolicies).where(and(eq(supportSlaPolicies.orgId, orgId), eq(supportSlaPolicies.clientId, clientId))).returning({ id: supportSlaPolicies.id });
  return rows.length > 0;
}

// ── Case hooks ─────────────────────────────────────────────────────────────
export async function dueDatesForNewCase(orgId: string, clientId: string, createdAt: Date) {
  const { policy } = await resolvePolicy(orgId, clientId);
  return computeDueDates(createdAt, policy);
}

/**
 * Status transition side effects on the clocks:
 *  → WAITING_ON_CUSTOMER: pause (stamp slaPausedAt)
 *  leaving it: resume, shifting the unmet due dates by the paused duration
 */
export function clockPatchForStatus(existing: { status: string; slaPausedAt: Date | null; firstResponseAt: Date | null; firstResponseDueAt: Date | null; resolutionDueAt: Date | null }, nextStatus: string, now = new Date()) {
  const patch: Record<string, Date | null> = {};
  if (nextStatus === "WAITING_ON_CUSTOMER" && existing.status !== "WAITING_ON_CUSTOMER") {
    patch.slaPausedAt = now;
  } else if (existing.status === "WAITING_ON_CUSTOMER" && nextStatus !== "WAITING_ON_CUSTOMER" && existing.slaPausedAt) {
    const paused = now.getTime() - new Date(existing.slaPausedAt).getTime();
    patch.slaPausedAt = null;
    if (!existing.firstResponseAt && existing.firstResponseDueAt) patch.firstResponseDueAt = new Date(new Date(existing.firstResponseDueAt).getTime() + paused);
    if (existing.resolutionDueAt) patch.resolutionDueAt = new Date(new Date(existing.resolutionDueAt).getTime() + paused);
  }
  return patch;
}

// ── Alert processor ────────────────────────────────────────────────────────
export interface SlaAlert { caseId: string; kind: "first_response" | "resolution"; overdue: boolean; dueAt: Date }

/** Cases whose next clock is inside the warning window or overdue and not yet alerted. */
/** "2026-09-07 03:36:31.455" — timestamps are stored UTC-naive; compare with explicit UTC strings. */
function utcNaive(d: Date): string {
  return d.toISOString().replace("T", " ").replace("Z", "");
}

export async function findCasesNeedingAlert(now = new Date()): Promise<Array<{ row: typeof supportCases.$inferSelect; alert: SlaAlert }>> {
  const soon = new Date(now.getTime() + 3600000);
  const soonSql = utcNaive(soon);
  const rows = await db.select().from(supportCases).where(and(
    inArray(supportCases.status, [...SUPPORT_CASE_CLOCK_RUNNING_STATUSES]),
    isNull(supportCases.slaPausedAt),
    or(
      and(isNull(supportCases.firstResponseAt), isNull(supportCases.firstResponseAlertedAt), sql`${supportCases.firstResponseDueAt} < ${soonSql}::timestamp`),
      and(isNull(supportCases.resolutionAlertedAt), sql`${supportCases.resolutionDueAt} < ${soonSql}::timestamp`),
    ),
  )).limit(200);
  const out: Array<{ row: typeof supportCases.$inferSelect; alert: SlaAlert }> = [];
  for (const row of rows) {
    if (!row.firstResponseAt && !row.firstResponseAlertedAt && row.firstResponseDueAt && row.firstResponseDueAt < soon) {
      out.push({ row, alert: { caseId: row.id, kind: "first_response", overdue: row.firstResponseDueAt < now, dueAt: row.firstResponseDueAt } });
    } else if (!row.resolutionAlertedAt && row.resolutionDueAt && row.resolutionDueAt < soon) {
      out.push({ row, alert: { caseId: row.id, kind: "resolution", overdue: row.resolutionDueAt < now, dueAt: row.resolutionDueAt } });
    }
  }
  return out;
}

export async function markAlerted(caseId: string, kind: SlaAlert["kind"], at = new Date()) {
  await db.update(supportCases)
    .set(kind === "first_response" ? { firstResponseAlertedAt: at } : { resolutionAlertedAt: at })
    .where(eq(supportCases.id, caseId));
}

let slaInterval: NodeJS.Timeout | null = null;

export function startSupportSlaProcessor(tick: () => Promise<void>): void {
  if (slaInterval) return;
  slaInterval = setInterval(() => { void tick().catch(err => console.error("[support-sla] tick failed", err)); }, 5 * 60 * 1000);
  console.log("[support-sla] SLA alert processor started (5min interval)");
}

export function stopSupportSlaProcessor(): void {
  if (slaInterval) { clearInterval(slaInterval); slaInterval = null; }
}
