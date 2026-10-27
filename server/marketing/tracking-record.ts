/**
 * Recording side of first-party open/click tracking (see ./tracking.ts).
 *
 * Each hit runs in one transaction that locks the link row and the
 * recipient's prospect row. The prospect lock serializes recording with
 * unsubscribe / bounce / soft-delete (all UPDATEs of that row), so a hit that
 * arrives after an opt-out commits never records. The link-row lock
 * serializes concurrent hits on the same email, so the first open yields
 * exactly one timeline activity. Counters and activity commit or roll back
 * together; errors are logged and swallowed — the recipient still gets the
 * pixel or the redirect.
 *
 * All tracking database work (the click lookup, recording, and the link
 * row written at send time) is bounded so a held row lock or a busy pool
 * cannot stall a response or a send: each transaction sets a lock and
 * statement timeout, and the caller stops waiting after DEADLINE_MS, which
 * also covers waiting for a pool connection. Public hits are also capped at
 * MAX_IN_FLIGHT at once so they cannot drain the shared pool. A hit past
 * those bounds is served (pixel) or asked to retry (click) without being
 * counted; a send past them goes out untracked.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { emailTrackingLinks } from "@shared/schema";
import { storage } from "../storage";
import { isTrackingToken } from "./tracking";

/** Click activities written per email; later clicks only count. */
export const MAX_CLICK_ACTIVITIES = 10;
/** Concurrent tracking operations; the pool has 20 connections shared with the app. */
export const MAX_IN_FLIGHT = 5;
/** How long a request waits on tracking database work, connection checkout included. */
export const DEADLINE_MS = 2_500;
const LOCK_TIMEOUT = "1s";
const STATEMENT_TIMEOUT = "2s";

/** Tracking database work was skipped: too many in flight, past the deadline, or failed. */
export class TrackingUnavailableError extends Error {}

type Exec = typeof db;

let inFlight = 0;

/**
 * Run one tracking transaction within the bounds above, or throw
 * TrackingUnavailableError. `capped` counts it against MAX_IN_FLIGHT (public
 * hits); send-time writes are not capped, so a flood of hits cannot switch
 * tracking off for sends — the scheduler runs them one at a time anyway.
 */
async function bounded<T>(label: string, work: (tx: Exec) => Promise<T>, capped = true): Promise<T> {
  if (capped && inFlight >= MAX_IN_FLIGHT) throw new TrackingUnavailableError(`${label}: too many in flight`);
  if (capped) inFlight++;
  const run = db.transaction(async (t) => {
    const tx = t as unknown as Exec;
    await tx.execute(sql.raw(
      `SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'; SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`,
    ));
    return work(tx);
  }).finally(() => { if (capped) inFlight--; });
  // A capped transaction keeps its slot until it settles, even after the caller gave up.
  run.catch(() => undefined);
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TrackingUnavailableError(`${label}: past ${DEADLINE_MS}ms`)), DEADLINE_MS);
  });
  try {
    return await Promise.race([run, deadline]);
  } catch (err) {
    if (err instanceof TrackingUnavailableError) throw err;
    throw new TrackingUnavailableError(`${label}: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Record within the bounds; false when skipped or failed (logged). */
function recording(label: string, work: (tx: Exec) => Promise<boolean>): Promise<boolean> {
  return bounded(label, work).catch((err) => {
    console.error(`[marketing-tracking] ${label} not recorded:`, err instanceof Error ? err.message : err);
    return false;
  });
}

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  return (result as { rows?: Array<Record<string, unknown>> }).rows
    ?? (result as Array<Record<string, unknown>>);
}

/**
 * The ordered destinations stored for `token`, or null for an unknown token.
 * Throws TrackingUnavailableError when the lookup could not run in time.
 */
export async function findTrackedLinks(token: string): Promise<string[] | null> {
  if (!isTrackingToken(token)) return null;
  return bounded("lookup", async (tx) => {
    const [row] = await tx
      .select({ links: emailTrackingLinks.links })
      .from(emailTrackingLinks)
      .where(eq(emailTrackingLinks.token, token));
    if (!row || !Array.isArray(row.links)) return null;
    return row.links;
  });
}

/**
 * Store the link row for one send. Throws TrackingUnavailableError when it
 * cannot commit within the bounds (e.g. its foreign-key check waits on a
 * prospect row a recording holds); the caller then sends untracked. A write
 * that commits after the caller gave up leaves an unused row: harmless,
 * since the delivered email carries no tracked links for it.
 */
export async function saveTrackingLinks(values: typeof emailTrackingLinks.$inferInsert): Promise<void> {
  await bounded("save", async (tx) => {
    await tx.insert(emailTrackingLinks).values(values);
  }, false);
}

/** Drop the link row of a send that never went out; best-effort within the same bounds. */
export async function dropTrackingLinks(token: string): Promise<void> {
  await bounded("drop", async (tx) => {
    await tx.delete(emailTrackingLinks).where(eq(emailTrackingLinks.token, token));
  }, false).catch(() => undefined);
}

interface LockedTarget {
  orgId: string;
  brandId: string | null;
  prospectId: string;
  attemptId: string;
  campaignId: string | null;
  campaignName: string | null;
}

/**
 * Lock the link + prospect rows and return the recording target, or null
 * when this hit must not be recorded (the attempt failed, or the recipient is
 * unsubscribed / bounced / deleted). A missing attempt row is recorded: the
 * link row is written before delivery and the attempt row after it, so a
 * pixel fetched while the send is still in flight would otherwise be lost.
 * Metrics only count link rows joined to a `success` attempt, so a send that
 * ends up failing never shows engagement.
 */
async function lockTarget(tx: Exec, token: string): Promise<LockedTarget | null> {
  const [row] = rowsOf(await tx.execute(sql`
    SELECT l.org_id, l.attempt_id, l.campaign_id, p.id AS prospect_id, p.brand_id,
           p.deleted_at, p.unsubscribed_at, p.bounced_at,
           l.kind AS link_kind, a.id AS found_attempt_id, a.status, a.kind,
           c.name AS campaign_name
      FROM email_tracking_links l
 LEFT JOIN email_send_attempts a ON a.id = l.attempt_id
      JOIN marketing_prospects p ON p.id = l.prospect_id AND p.org_id = l.org_id
      LEFT JOIN marketing_campaigns c ON c.id = l.campaign_id
     WHERE l.token = ${token}
       FOR UPDATE OF l, p
  `));
  if (!row) return null;
  if (row.link_kind !== "campaign") return null;
  if (row.found_attempt_id && (row.status !== "success" || row.kind !== "campaign")) return null;
  if (row.deleted_at || row.unsubscribed_at || row.bounced_at) return null;
  return {
    orgId: String(row.org_id),
    brandId: (row.brand_id as string | null) ?? null,
    prospectId: String(row.prospect_id),
    attemptId: String(row.attempt_id),
    campaignId: (row.campaign_id as string | null) ?? null,
    campaignName: (row.campaign_name as string | null) ?? null,
  };
}

/** Returns true when the open was recorded. */
export async function recordOpen(token: string): Promise<boolean> {
  if (!isTrackingToken(token)) return false;
  return recording("open", async (tx) => {
    const target = await lockTarget(tx, token);
    if (!target) return false;
    const [updated] = rowsOf(await tx.execute(sql`
      UPDATE email_tracking_links
         SET open_count = open_count + 1, opened_at = COALESCE(opened_at, now())
       WHERE token = ${token}
   RETURNING open_count
    `));
    if (Number(updated?.open_count) === 1) {
      await storage.createActivity({
        orgId: target.orgId,
        brandId: target.brandId,
        prospectId: target.prospectId,
        type: "email_opened",
        payload: {
          campaign_id: target.campaignId,
          campaign_name: target.campaignName,
          attempt_id: target.attemptId,
        },
        actorId: null,
      } as any, { tx });
    }
    return true;
  });
}

/** Returns true when the click was recorded. `url` is the stored destination. */
export async function recordClick(token: string, url: string): Promise<boolean> {
  if (!isTrackingToken(token)) return false;
  return recording("click", async (tx) => {
    const target = await lockTarget(tx, token);
    if (!target) return false;
    // A click proves an open even when the client blocked the pixel.
    const [updated] = rowsOf(await tx.execute(sql`
      UPDATE email_tracking_links
         SET click_count = click_count + 1,
             clicked_at = COALESCE(clicked_at, now()),
             opened_at = COALESCE(opened_at, now())
       WHERE token = ${token}
   RETURNING click_count
    `));
    if (Number(updated?.click_count) <= MAX_CLICK_ACTIVITIES) {
      await storage.createActivity({
        orgId: target.orgId,
        brandId: target.brandId,
        prospectId: target.prospectId,
        type: "email_clicked",
        payload: {
          campaign_id: target.campaignId,
          campaign_name: target.campaignName,
          attempt_id: target.attemptId,
          url,
        },
        actorId: null,
      } as any, { tx });
    }
    return true;
  });
}
