import type { Express, Request, Response } from "express";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db, pool } from "../db";
import {
  MARKETING_OS_TELEMETRY_CLEANUP_RUN_HISTORY_LIMIT,
  MARKETING_OS_TELEMETRY_RETENTION_DAYS_DEFAULT,
  marketingOsTelemetryCleanupRuns,
  marketingOsTelemetryEvents,
  type MarketingOsTelemetryDailyBucket,
  type MarketingOsTelemetryDailySeries,
  type MarketingOsTelemetryEventType,
  type MarketingOsTelemetryLastCleanup,
  type MarketingOsTelemetrySummary,
  type MarketingOsTelemetrySummaryWindow,
} from "@shared/schema";
import { requireAdmin, requireAdminOrManager } from "./middleware";
import { evaluateAndMaybeNotifyTelemetryCleanupSilence } from "../notifications/marketing-os-telemetry-cleanup-silence";

/**
 * Task 203 — Resolve the configured retention window for
 * `marketing_os_telemetry_events`. Falls back to the documented default if
 * the env var is missing, non-numeric, or non-positive so a typo can never
 * silently disable the sweep or, worse, delete every row.
 */
export function resolveMarketingOsTelemetryRetentionDays(): number {
  const raw = process.env.MARKETING_OS_TELEMETRY_RETENTION_DAYS;
  if (raw === undefined || raw === "") {
    return MARKETING_OS_TELEMETRY_RETENTION_DAYS_DEFAULT;
  }
  const parsed = Number(raw);
  // Floor first, then enforce >= 1 so fractional values like 0.5 don't slip
  // past the positivity check, floor to 0, and silently delete the entire
  // table on the next sweep.
  const days = Math.floor(parsed);
  if (!Number.isFinite(parsed) || days < 1) {
    console.warn(
      `[telemetry] Ignoring invalid MARKETING_OS_TELEMETRY_RETENTION_DAYS=${raw}; using default ${MARKETING_OS_TELEMETRY_RETENTION_DAYS_DEFAULT}`,
    );
    return MARKETING_OS_TELEMETRY_RETENTION_DAYS_DEFAULT;
  }
  return days;
}

/**
 * Task 203 — Delete marketing-os telemetry rows older than the retention
 * window. The admin dashboard only ever reads the last 30 days, so anything
 * older is dead weight. Returns the number of rows removed so the caller can
 * log the result.
 */
export async function cleanupOldMarketingOsTelemetryEvents(
  retentionDays: number = resolveMarketingOsTelemetryRetentionDays(),
): Promise<{ deleted: number; retentionDays: number; cutoff: Date }> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(marketingOsTelemetryEvents)
    .where(lt(marketingOsTelemetryEvents.createdAt, cutoff))
    .returning({ id: marketingOsTelemetryEvents.id });
  return { deleted: deleted.length, retentionDays, cutoff };
}

/**
 * Task 220 — Recurring scheduler for the telemetry retention sweep.
 *
 * Wraps `cleanupOldMarketingOsTelemetryEvents` in a Postgres advisory lock
 * (`pg_try_advisory_lock`) so that when this app is deployed with more than
 * one server replica only the leader actually issues the DELETE. The other
 * replicas attempt the lock, fail to acquire it, and skip silently. This is
 * the same pattern used by `webhooks.ts` for the retry processor.
 *
 * Lock key 220_001 is reserved for this scheduler. Using a stable, named
 * integer keeps the lock predictable across restarts and avoids collisions
 * with the other schedulers in this codebase (100001 webhooks, 200001
 * invoices, etc.).
 */
const MARKETING_OS_TELEMETRY_CLEANUP_LOCK_KEY = 220_001;
/**
 * Task #290 — Exported so the staleness banner on the admin telemetry
 * card can derive its threshold (2× this value) from the same source of
 * truth the scheduler uses, instead of hard-coding 48h on both sides.
 */
export const MARKETING_OS_TELEMETRY_CLEANUP_INTERVAL_MS =
  24 * 60 * 60 * 1000;
const DEFAULT_CLEANUP_INTERVAL_MS = MARKETING_OS_TELEMETRY_CLEANUP_INTERVAL_MS;

/**
 * Task #290 — Health status for the telemetry cleanup sweep so admins
 * are warned proactively when the scheduler has gone silent (lock
 * stuck, env var typo, app crash on every cron tick).
 *
 *   - "ok"        — last run is recent enough, or no run on record but
 *                   there's also nothing past retention waiting to be
 *                   swept (e.g. fresh install, empty table).
 *   - "overdue"   — last run is older than 2× the configured interval.
 *   - "missing"   — no run on record at all, but the events table
 *                   already contains rows older than the retention
 *                   cutoff (i.e. the sweep has *never* fired and there
 *                   is real work it should have done by now).
 */
export type MarketingOsTelemetryCleanupHealthStatus =
  | "ok"
  | "overdue"
  | "missing";

export interface MarketingOsTelemetryCleanupHealth {
  status: MarketingOsTelemetryCleanupHealthStatus;
  intervalMs: number;
  thresholdMs: number;
  ageMs: number | null;
  hasEventsOlderThanRetention: boolean;
}

export function computeMarketingOsTelemetryCleanupHealth(input: {
  lastRun: MarketingOsTelemetryLastCleanup | null;
  now: number;
  intervalMs?: number;
  hasEventsOlderThanRetention: boolean;
}): MarketingOsTelemetryCleanupHealth {
  const intervalMs = Math.max(
    1,
    input.intervalMs ?? MARKETING_OS_TELEMETRY_CLEANUP_INTERVAL_MS,
  );
  const thresholdMs = intervalMs * 2;
  if (!input.lastRun) {
    return {
      status: input.hasEventsOlderThanRetention ? "missing" : "ok",
      intervalMs,
      thresholdMs,
      ageMs: null,
      hasEventsOlderThanRetention: input.hasEventsOlderThanRetention,
    };
  }
  const ranAtMs = Date.parse(input.lastRun.ranAt);
  // A bad timestamp shouldn't silently mask a real outage. Treat it as
  // overdue — the admin will see the banner, click through to history,
  // and notice the malformed row.
  if (Number.isNaN(ranAtMs)) {
    return {
      status: "overdue",
      intervalMs,
      thresholdMs,
      ageMs: null,
      hasEventsOlderThanRetention: input.hasEventsOlderThanRetention,
    };
  }
  const ageMs = Math.max(0, input.now - ranAtMs);
  return {
    status: ageMs > thresholdMs ? "overdue" : "ok",
    intervalMs,
    thresholdMs,
    ageMs,
    hasEventsOlderThanRetention: input.hasEventsOlderThanRetention,
  };
}

/**
 * Task #290 — Cheap existence probe: are there any telemetry rows
 * already older than the current retention window? Used to distinguish
 * "no run on record because the table is empty/young" (fine) from "no
 * run on record despite a backlog of expired rows" (alert-worthy).
 */
export async function hasMarketingOsTelemetryEventsOlderThanRetention(
  retentionDays: number = resolveMarketingOsTelemetryRetentionDays(),
): Promise<boolean> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ id: marketingOsTelemetryEvents.id })
    .from(marketingOsTelemetryEvents)
    .where(lt(marketingOsTelemetryEvents.createdAt, cutoff))
    .limit(1);
  return rows.length > 0;
}

export type MarketingOsTelemetryCleanupRunResult =
  | { ran: true; stats: Awaited<ReturnType<typeof cleanupOldMarketingOsTelemetryEvents>> }
  | { ran: false; reason: "lock-held" | "error"; error?: unknown };

export interface MarketingOsTelemetryCleanupSchedulerHandle {
  /**
   * Resolves once the boot run has completed (whether it acquired the
   * advisory lock or not). Tests await this to assert the scheduler
   * actually invoked the cleanup at startup.
   */
  initialRun: Promise<MarketingOsTelemetryCleanupRunResult>;
  stop: () => void;
}

/**
 * Task #318 — After every cleanup tick (whether or not we held the
 * lock or actually deleted anything), evaluate the cleanup-health
 * status and email opted-in admins if the sweep has been silent past
 * the configured threshold. The notifier dedupes internally so this
 * is safe to call on every tick.
 *
 * Best-effort: failures are logged inside the notifier and never
 * propagate, so an alert problem cannot mask the underlying outage.
 */
async function evaluateCleanupSilenceForTick(): Promise<void> {
  try {
    const lastRun = await getLastMarketingOsTelemetryCleanupRun();
    const hasOld = await hasMarketingOsTelemetryEventsOlderThanRetention();
    const health = computeMarketingOsTelemetryCleanupHealth({
      lastRun,
      now: Date.now(),
      hasEventsOlderThanRetention: hasOld,
    });
    const lastRunRanAtMs = lastRun ? Date.parse(lastRun.ranAt) : null;
    await evaluateAndMaybeNotifyTelemetryCleanupSilence({
      health,
      lastRunRanAtMs: Number.isNaN(lastRunRanAtMs ?? NaN)
        ? null
        : lastRunRanAtMs,
    });
  } catch (err) {
    console.error(
      "[marketing-os-telemetry-cleanup] silence-evaluation failed:",
      err,
    );
  }
}

export async function runMarketingOsTelemetryCleanupOnce(
  lockKey: number = MARKETING_OS_TELEMETRY_CLEANUP_LOCK_KEY,
): Promise<MarketingOsTelemetryCleanupRunResult> {
  const result = await runMarketingOsTelemetryCleanupOnceInner(lockKey);
  // Task #318 — Evaluate cleanup health and email opted-in admins if
  // the sweep has been silent past the configured threshold. Only run
  // this on the replica that actually held the advisory lock for this
  // tick, so multiple replicas can't simultaneously read "no prior
  // alert" and each fire a duplicate email before any of them stamps
  // the dedupe row. The other replicas skipped silently because they
  // couldn't acquire the lock; this one is the elected leader for
  // this tick and is the right place to do the alert evaluation.
  // (When `result.ran === false && reason === "error"` we still held
  // the lock — the cleanup itself crashed — so silence-eval still
  // runs; only `reason === "lock-held"` skips.)
  const heldLock =
    result.ran === true ||
    (result.ran === false && result.reason === "error");
  if (heldLock) {
    await evaluateCleanupSilenceForTick();
  }
  return result;
}

async function runMarketingOsTelemetryCleanupOnceInner(
  lockKey: number,
): Promise<MarketingOsTelemetryCleanupRunResult> {
  // Postgres advisory locks are session-scoped, so the LOCK and UNLOCK
  // statements MUST execute on the same connection. Acquiring via
  // `pool.query` would risk landing the unlock on a different pooled
  // client and leaving the lock stranded on the original session until
  // that connection is closed — permanently blocking other replicas
  // from ever running the sweep. Pin a dedicated client for the whole
  // critical section instead.
  const client = await pool.connect();
  let acquired = false;
  try {
    const lockResult = await client.query(
      "SELECT pg_try_advisory_lock($1) AS acquired",
      [lockKey],
    );
    acquired = Boolean(lockResult.rows[0]?.acquired);
    if (!acquired) {
      // Another replica is running the sweep right now. Skip silently.
      return { ran: false, reason: "lock-held" };
    }
    const stats = await cleanupOldMarketingOsTelemetryEvents();
    if (stats.deleted > 0) {
      console.log(
        `[marketing-os-telemetry-cleanup] deleted=${stats.deleted} retentionDays=${stats.retentionDays} cutoff=${stats.cutoff.toISOString()}`,
      );
    }
    // Task #243 — Persist a record of this run so admins can confirm
    // the sweep is firing without grepping logs. Trim to the configured
    // history limit so the table stays small.
    try {
      await recordMarketingOsTelemetryCleanupRun(stats);
    } catch (err) {
      console.error(
        "[marketing-os-telemetry-cleanup] Failed to record run:",
        err,
      );
    }
    return { ran: true, stats };
  } catch (error) {
    console.error("[marketing-os-telemetry-cleanup] Sweep failed:", error);
    return { ran: false, reason: "error", error };
  } finally {
    if (acquired) {
      await client
        .query("SELECT pg_advisory_unlock($1)", [lockKey])
        .catch((err) => {
          console.error(
            "[marketing-os-telemetry-cleanup] Failed to release advisory lock:",
            err,
          );
        });
    }
    client.release();
  }
}

/**
 * Task #243 — Persist a single cleanup run and trim history to the
 * configured limit so the table never grows without bound.
 */
async function recordMarketingOsTelemetryCleanupRun(stats: {
  deleted: number;
  retentionDays: number;
  cutoff: Date;
}): Promise<void> {
  await db.insert(marketingOsTelemetryCleanupRuns).values({
    deletedCount: stats.deleted,
    retentionDays: stats.retentionDays,
    cutoff: stats.cutoff,
  });
  // Trim: keep only the most recent N rows. Delete anything older than the
  // Nth-newest `ran_at`. Cheap because the table is capped anyway.
  await db.execute(sql`
    DELETE FROM ${marketingOsTelemetryCleanupRuns}
    WHERE id IN (
      SELECT id FROM ${marketingOsTelemetryCleanupRuns}
      ORDER BY ran_at DESC
      OFFSET ${MARKETING_OS_TELEMETRY_CLEANUP_RUN_HISTORY_LIMIT}
    )
  `);
}

export async function getLastMarketingOsTelemetryCleanupRun(): Promise<MarketingOsTelemetryLastCleanup | null> {
  const rows = await db
    .select()
    .from(marketingOsTelemetryCleanupRuns)
    .orderBy(desc(marketingOsTelemetryCleanupRuns.ranAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    ranAt: row.ranAt.toISOString(),
    deletedCount: row.deletedCount,
    retentionDays: row.retentionDays,
    cutoff: row.cutoff.toISOString(),
  };
}

/**
 * Task #267 — List recent telemetry cleanup runs in descending order so
 * admins can spot anomalies (sudden jump in deleted rows, long stretch of
 * 0-row sweeps, gaps between runs) without grepping logs. The cap is
 * clamped to the on-disk history limit so we never promise more than
 * `recordMarketingOsTelemetryCleanupRun` actually keeps.
 */
export async function getMarketingOsTelemetryCleanupHistory(
  limit: number = MARKETING_OS_TELEMETRY_CLEANUP_RUN_HISTORY_LIMIT,
): Promise<MarketingOsTelemetryLastCleanup[]> {
  const safeLimit = Math.max(
    1,
    Math.min(
      Math.floor(Number.isFinite(limit) ? limit : 0) ||
        MARKETING_OS_TELEMETRY_CLEANUP_RUN_HISTORY_LIMIT,
      MARKETING_OS_TELEMETRY_CLEANUP_RUN_HISTORY_LIMIT,
    ),
  );
  const rows = await db
    .select()
    .from(marketingOsTelemetryCleanupRuns)
    .orderBy(desc(marketingOsTelemetryCleanupRuns.ranAt))
    .limit(safeLimit);
  return rows.map((row) => ({
    ranAt: row.ranAt.toISOString(),
    deletedCount: row.deletedCount,
    retentionDays: row.retentionDays,
    cutoff: row.cutoff.toISOString(),
  }));
}

let cleanupInterval: ReturnType<typeof setInterval> | null = null;

export function startMarketingOsTelemetryCleanupScheduler(opts?: {
  intervalMs?: number;
  runImmediately?: boolean;
  lockKey?: number;
}): MarketingOsTelemetryCleanupSchedulerHandle {
  const intervalMs = opts?.intervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS;
  const runImmediately = opts?.runImmediately ?? true;
  const lockKey = opts?.lockKey ?? MARKETING_OS_TELEMETRY_CLEANUP_LOCK_KEY;

  const initialRun: Promise<MarketingOsTelemetryCleanupRunResult> =
    runImmediately
      ? runMarketingOsTelemetryCleanupOnce(lockKey)
      : Promise.resolve({ ran: false, reason: "lock-held" as const });

  if (cleanupInterval) {
    clearInterval(cleanupInterval);
  }
  cleanupInterval = setInterval(() => {
    runMarketingOsTelemetryCleanupOnce(lockKey).catch((err) => {
      console.error(
        "[marketing-os-telemetry-cleanup] Interval sweep crashed:",
        err,
      );
    });
  }, intervalMs);
  // Don't keep the event loop alive solely for this timer (matches the
  // semantics other interval-driven jobs in this codebase rely on for
  // graceful shutdown).
  cleanupInterval.unref?.();

  return {
    initialRun,
    stop: () => stopMarketingOsTelemetryCleanupScheduler(),
  };
}

export function stopMarketingOsTelemetryCleanupScheduler(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

/**
 * Task 147 + Task 181 — Marketing OS discovery telemetry.
 *
 * Original Sprint 2k surface emits three events; Task 181 persists each event
 * into `marketing_os_telemetry_events` so admins can see an in-app funnel
 * (shown -> modal_opened -> checkout_clicked) without grepping log files.
 *
 * Wire-format event names accepted from the client are unchanged for
 * backwards compatibility:
 *   - marketing_os.discovery.section_shown
 *   - marketing_os.discovery.modal_opened     (props: source)
 *   - marketing_os.discovery.checkout_clicked
 */

const EVENT_WIRE_TO_DB: Record<string, MarketingOsTelemetryEventType> = {
  "marketing_os.discovery.section_shown": "section_shown",
  "marketing_os.discovery.modal_opened": "modal_opened",
  "marketing_os.discovery.checkout_clicked": "checkout_clicked",
};

function safeRate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 1000;
}

async function summarizeWindow(
  orgId: string,
  days: number,
): Promise<MarketingOsTelemetrySummaryWindow> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      eventType: marketingOsTelemetryEvents.eventType,
      count: sql<number>`count(*)::int`,
    })
    .from(marketingOsTelemetryEvents)
    .where(
      and(
        eq(marketingOsTelemetryEvents.orgId, orgId),
        gte(marketingOsTelemetryEvents.createdAt, since),
      ),
    )
    .groupBy(marketingOsTelemetryEvents.eventType);

  let sectionShown = 0;
  let modalOpened = 0;
  let checkoutClicked = 0;
  for (const row of rows) {
    if (row.eventType === "section_shown") sectionShown = Number(row.count);
    else if (row.eventType === "modal_opened") modalOpened = Number(row.count);
    else if (row.eventType === "checkout_clicked")
      checkoutClicked = Number(row.count);
  }

  return {
    days,
    sectionShown,
    modalOpened,
    checkoutClicked,
    shownToModalRate: safeRate(modalOpened, sectionShown),
    modalToCheckoutRate: safeRate(checkoutClicked, modalOpened),
    shownToCheckoutRate: safeRate(checkoutClicked, sectionShown),
  };
}

const MAX_DAILY_RANGE_DAYS = 90;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDateUtc(value: string, label: string): Date {
  if (!ISO_DATE_RE.test(value)) {
    throw new Error(`Invalid ${label} date; expected YYYY-MM-DD`);
  }
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    Number.isNaN(dt.getTime()) ||
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    throw new Error(`Invalid ${label} date; expected YYYY-MM-DD`);
  }
  return dt;
}

/**
 * Task 215 — Resolve the daily-trend window from query params. Accepts
 * either `days=N` (1..90, default 30) for the rolling window the widget
 * has always used, or an explicit `from`/`to` pair (inclusive ISO dates)
 * so admins can zoom into a specific experiment window. Throws with a
 * human-readable message on invalid input so the route can surface a 400.
 */
export function resolveDailyRange(query: Record<string, unknown>): {
  since: Date;
  days: number;
} {
  const fromRaw = typeof query.from === "string" ? query.from : undefined;
  const toRaw = typeof query.to === "string" ? query.to : undefined;

  if (fromRaw || toRaw) {
    if (!fromRaw || !toRaw) {
      throw new Error("Both from and to are required for a custom range");
    }
    const from = parseIsoDateUtc(fromRaw, "from");
    const to = parseIsoDateUtc(toRaw, "to");
    if (to.getTime() < from.getTime()) {
      throw new Error("to must be on or after from");
    }
    const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
    if (days > MAX_DAILY_RANGE_DAYS) {
      throw new Error(
        `Custom range cannot exceed ${MAX_DAILY_RANGE_DAYS} days`,
      );
    }
    return { since: from, days };
  }

  const rawDays = Number(query.days);
  const days =
    Number.isFinite(rawDays) && rawDays > 0 && rawDays <= MAX_DAILY_RANGE_DAYS
      ? Math.floor(rawDays)
      : 30;
  const todayUtc = new Date();
  todayUtc.setUTCHours(0, 0, 0, 0);
  const since = new Date(todayUtc);
  since.setUTCDate(since.getUTCDate() - (days - 1));
  return { since, days };
}

async function dailySeries(
  orgId: string,
  range: { since: Date; days: number },
): Promise<MarketingOsTelemetryDailySeries> {
  const { since, days } = range;
  // Exclusive upper bound = day after the last requested bucket. Without
  // this the DB scans every event newer than `since`, which for a
  // historical custom window could be the entire table.
  const until = new Date(since);
  until.setUTCDate(since.getUTCDate() + days);

  // Bucket on the same UTC-normalized expression in both SELECT and
  // GROUP BY so day boundaries are deterministic regardless of the DB
  // session's TimeZone setting.
  const dayExpr = sql<string>`to_char((${marketingOsTelemetryEvents.createdAt} at time zone 'UTC')::date, 'YYYY-MM-DD')`;
  const rows = await db
    .select({
      day: dayExpr,
      eventType: marketingOsTelemetryEvents.eventType,
      count: sql<number>`count(*)::int`,
    })
    .from(marketingOsTelemetryEvents)
    .where(
      and(
        eq(marketingOsTelemetryEvents.orgId, orgId),
        gte(marketingOsTelemetryEvents.createdAt, since),
        lt(marketingOsTelemetryEvents.createdAt, until),
      ),
    )
    .groupBy(dayExpr, marketingOsTelemetryEvents.eventType);

  const byDay = new Map<string, MarketingOsTelemetryDailyBucket>();
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setUTCDate(since.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    byDay.set(key, {
      date: key,
      sectionShown: 0,
      modalOpened: 0,
      checkoutClicked: 0,
    });
  }

  for (const row of rows) {
    const bucket = byDay.get(row.day);
    if (!bucket) continue;
    const n = Number(row.count);
    if (row.eventType === "section_shown") bucket.sectionShown = n;
    else if (row.eventType === "modal_opened") bucket.modalOpened = n;
    else if (row.eventType === "checkout_clicked") bucket.checkoutClicked = n;
  }

  return { days, buckets: Array.from(byDay.values()) };
}

export function registerMarketingOsTelemetryRoutes(app: Express) {
  app.post(
    "/api/telemetry/marketing-os",
    requireAdminOrManager,
    async (req: Request, res: Response) => {
      const { event, props } = (req.body ?? {}) as {
        event?: string;
        props?: Record<string, unknown>;
      };

      const dbEventType =
        typeof event === "string" ? EVENT_WIRE_TO_DB[event] : undefined;
      if (!dbEventType) {
        return res.status(400).json({ message: "unknown event" });
      }

      const safeProps =
        props && typeof props === "object" && !Array.isArray(props)
          ? props
          : {};

      const orgId = req.session.orgId;
      const userId = req.session.userId;
      if (!orgId) {
        return res.status(400).json({ message: "missing org context" });
      }

      const source =
        typeof safeProps.source === "string"
          ? (safeProps.source as string).slice(0, 64)
          : null;

      const line = {
        event,
        userId,
        orgId,
        role: req.session.role,
        ...safeProps,
      };
      console.log(`[telemetry] ${event} ${JSON.stringify(line)}`);

      try {
        await db.insert(marketingOsTelemetryEvents).values({
          orgId,
          userId: userId ?? null,
          eventType: dbEventType,
          source,
        });
      } catch (err) {
        console.error(
          `[telemetry] failed to persist marketing-os event ${event}:`,
          (err as Error).message,
        );
        // Persistence failure must not break the client surface; we still
        // logged the line above so the data is recoverable from logs.
      }

      return res.status(204).end();
    },
  );

  app.get(
    "/api/telemetry/marketing-os/summary",
    requireAdminOrManager,
    async (req: Request, res: Response) => {
      const orgId = req.session.orgId;
      if (!orgId) {
        return res.status(400).json({ message: "missing org context" });
      }
      try {
        const [last7Days, last30Days] = await Promise.all([
          summarizeWindow(orgId, 7),
          summarizeWindow(orgId, 30),
        ]);
        const summary: MarketingOsTelemetrySummary = { last7Days, last30Days };
        return res.json(summary);
      } catch (err) {
        console.error(
          "[telemetry] failed to summarize marketing-os events:",
          (err as Error).message,
        );
        return res
          .status(500)
          .json({ message: "Failed to load telemetry summary" });
      }
    },
  );

  // Task #396 — Telemetry CLEANUP endpoints stay strict ADMIN-only.
  // They invoke a global, cross-org DELETE on `marketing_os_telemetry_events`
  // (not org-scoped) and surface platform-operational health (last run,
  // run history) for the same admin telemetry card as feature-flags /
  // webhook-dashboard. The /api/marketing/* manager broadening from
  // Task #396 explicitly excluded operational admin surfaces.
  app.post(
    "/api/telemetry/marketing-os/cleanup/run",
    requireAdmin,
    async (_req: Request, res: Response) => {
      try {
        const result = await runMarketingOsTelemetryCleanupOnce();
        if (result.ran) {
          // Return the freshly recorded run so the client can refresh the
          // "Last cleanup" line without a follow-up GET round-trip.
          const lastRun = await getLastMarketingOsTelemetryCleanupRun();
          return res.json({ ran: true, lastRun });
        }
        if (result.reason === "lock-held") {
          // Another replica is sweeping right now. Surface a 200 with a
          // structured `skipped` flag so the client can render a friendly
          // "try again" message without the mutation failing.
          return res.json({ ran: false, skipped: true, reason: "lock-held" });
        }
        return res
          .status(500)
          .json({ message: "Cleanup failed. Check server logs." });
      } catch (err) {
        console.error(
          "[telemetry] failed to run marketing-os cleanup on demand:",
          (err as Error).message,
        );
        return res
          .status(500)
          .json({ message: "Cleanup failed. Check server logs." });
      }
    },
  );

  app.get(
    "/api/telemetry/marketing-os/cleanup/last",
    requireAdmin,
    async (_req: Request, res: Response) => {
      try {
        // Task #290 — Surface a derived health status alongside the raw
        // run so the admin telemetry card can flip into a warning state
        // without re-deriving the threshold on the client.
        const [last, hasOldEvents] = await Promise.all([
          getLastMarketingOsTelemetryCleanupRun(),
          hasMarketingOsTelemetryEventsOlderThanRetention().catch((err) => {
            console.error(
              "[telemetry] failed to probe for marketing-os events past retention:",
              (err as Error).message,
            );
            return false;
          }),
        ]);
        const health = computeMarketingOsTelemetryCleanupHealth({
          lastRun: last,
          now: Date.now(),
          hasEventsOlderThanRetention: hasOldEvents,
        });
        return res.json({ lastRun: last, health });
      } catch (err) {
        console.error(
          "[telemetry] failed to load last marketing-os cleanup run:",
          (err as Error).message,
        );
        return res
          .status(500)
          .json({ message: "Failed to load last cleanup run" });
      }
    },
  );

  app.get(
    "/api/telemetry/marketing-os/cleanup/history",
    requireAdmin,
    async (req: Request, res: Response) => {
      const rawLimit =
        typeof req.query.limit === "string" ? Number(req.query.limit) : NaN;
      const limit = Number.isFinite(rawLimit) && rawLimit > 0
        ? rawLimit
        : MARKETING_OS_TELEMETRY_CLEANUP_RUN_HISTORY_LIMIT;
      try {
        const runs = await getMarketingOsTelemetryCleanupHistory(limit);
        return res.json({ runs });
      } catch (err) {
        console.error(
          "[telemetry] failed to load marketing-os cleanup history:",
          (err as Error).message,
        );
        return res
          .status(500)
          .json({ message: "Failed to load cleanup history" });
      }
    },
  );

  app.get(
    "/api/telemetry/marketing-os/daily",
    requireAdminOrManager,
    async (req: Request, res: Response) => {
      const orgId = req.session.orgId;
      if (!orgId) {
        return res.status(400).json({ message: "missing org context" });
      }
      let range: { since: Date; days: number };
      try {
        range = resolveDailyRange(req.query);
      } catch (err) {
        return res.status(400).json({ message: (err as Error).message });
      }
      try {
        const series = await dailySeries(orgId, range);
        return res.json(series);
      } catch (err) {
        console.error(
          "[telemetry] failed to bucket marketing-os events by day:",
          (err as Error).message,
        );
        return res
          .status(500)
          .json({ message: "Failed to load telemetry trend" });
      }
    },
  );
}
