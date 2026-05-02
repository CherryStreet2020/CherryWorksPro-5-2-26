/**
 * Task #220 — Integration test for the marketing-os telemetry cleanup
 * scheduler.
 *
 * Task #203 added `cleanupOldMarketingOsTelemetryEvents` and Task #214 added
 * an integration test for the actual delete. This test pins the *scheduler*
 * contract added in Task #220:
 *  - Calling `startMarketingOsTelemetryCleanupScheduler` invokes the cleanup
 *    at least once on boot (the `initialRun` promise resolves with `ran:
 *    true` and the seeded old row is gone).
 *  - The advisory lock is honoured: a second concurrent invocation while the
 *    first holds the lock returns `ran: false, reason: "lock-held"` instead
 *    of double-deleting.
 */
process.env.MARKETING_OS_ENABLED = "true";

import {
  describe,
  it,
  expect,
  afterAll,
  beforeAll,
  afterEach,
} from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "../../server/db";
import {
  runMarketingOsTelemetryCleanupOnce,
  startMarketingOsTelemetryCleanupScheduler,
  stopMarketingOsTelemetryCleanupScheduler,
} from "../../server/routes/marketing-os-telemetry-routes";
import { marketingOsTelemetryEvents, orgs } from "@shared/schema";

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ORG_ID = randomUUID();
const DAY_MS = 24 * 60 * 60 * 1000;

// Use a test-scoped lock key so we don't collide with the production
// scheduler (220_001) that may be running inside the same process if the
// dev server happened to start up under vitest.
const TEST_LOCK_KEY = 220_999;

async function insertEventAt(createdAt: Date): Promise<string> {
  const id = randomUUID();
  await db.insert(marketingOsTelemetryEvents).values({
    id,
    orgId: ORG_ID,
    userId: null,
    eventType: "section_shown",
    source: null,
    createdAt,
  });
  return id;
}

beforeAll(async () => {
  await db.insert(orgs).values({
    id: ORG_ID,
    name: `t220 ${RUN}`,
    slug: `t220-${RUN}`,
  });
});

afterAll(async () => {
  stopMarketingOsTelemetryCleanupScheduler();
  await db
    .delete(marketingOsTelemetryEvents)
    .where(eq(marketingOsTelemetryEvents.orgId, ORG_ID));
  await db.delete(orgs).where(eq(orgs.id, ORG_ID));
});

afterEach(async () => {
  stopMarketingOsTelemetryCleanupScheduler();
  await db
    .delete(marketingOsTelemetryEvents)
    .where(eq(marketingOsTelemetryEvents.orgId, ORG_ID));
  // Defensively release the test lock in case a prior test errored before
  // its `finally` could run.
  await pool
    .query("SELECT pg_advisory_unlock($1)", [TEST_LOCK_KEY])
    .catch(() => {});
});

describe("startMarketingOsTelemetryCleanupScheduler", () => {
  it("invokes the cleanup at least once during boot", async () => {
    // Seed a row well past the default retention window so the boot sweep
    // will delete it.
    const oldId = await insertEventAt(new Date(Date.now() - 365 * DAY_MS));

    const handle = startMarketingOsTelemetryCleanupScheduler({
      // Long interval — we only care about the boot run for this assertion.
      // The unref() inside the scheduler keeps it from blocking process exit.
      intervalMs: 60 * 60 * 1000,
      runImmediately: true,
      lockKey: TEST_LOCK_KEY,
    });

    const result = await handle.initialRun;

    expect(result.ran).toBe(true);
    if (result.ran) {
      expect(result.stats.deleted).toBeGreaterThanOrEqual(1);
      expect(result.stats.retentionDays).toBeGreaterThan(0);
    }

    // The seeded row must be gone.
    const remaining = await db
      .select({ id: marketingOsTelemetryEvents.id })
      .from(marketingOsTelemetryEvents)
      .where(eq(marketingOsTelemetryEvents.id, oldId));
    expect(remaining).toHaveLength(0);

    handle.stop();
  });

  it("skips when another replica is holding the advisory lock", async () => {
    // Simulate a peer replica that's mid-sweep by grabbing the lock on a
    // dedicated client. Advisory locks are per-session, so we must hold
    // the same connection for the duration — `pool.query` may hand a
    // different connection to subsequent calls and release the lock
    // prematurely.
    const peer = await pool.connect();
    try {
      const acq = await peer.query(
        "SELECT pg_try_advisory_lock($1) AS acquired",
        [TEST_LOCK_KEY],
      );
      expect(acq.rows[0]?.acquired).toBe(true);

      const result = await runMarketingOsTelemetryCleanupOnce(TEST_LOCK_KEY);
      expect(result.ran).toBe(false);
      if (!result.ran) {
        expect(result.reason).toBe("lock-held");
      }

      await peer.query("SELECT pg_advisory_unlock($1)", [TEST_LOCK_KEY]);
    } finally {
      peer.release();
    }

    // After the peer releases, a follow-up call should succeed again.
    const followup = await runMarketingOsTelemetryCleanupOnce(TEST_LOCK_KEY);
    expect(followup.ran).toBe(true);
  });

  it("releases its advisory lock after every run", async () => {
    // Run the cleanup. Then from a *separate* dedicated client, try to
    // acquire the same key. If the scheduler had stranded the lock on
    // its pooled connection, this would return acquired=false and we
    // would have a permanent lockout in production.
    const result = await runMarketingOsTelemetryCleanupOnce(TEST_LOCK_KEY);
    expect(result.ran).toBe(true);

    const probe = await pool.connect();
    try {
      const acq = await probe.query(
        "SELECT pg_try_advisory_lock($1) AS acquired",
        [TEST_LOCK_KEY],
      );
      expect(acq.rows[0]?.acquired).toBe(true);
      await probe.query("SELECT pg_advisory_unlock($1)", [TEST_LOCK_KEY]);
    } finally {
      probe.release();
    }
  });
});
