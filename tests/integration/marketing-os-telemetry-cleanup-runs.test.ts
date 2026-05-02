/**
 * Task #243 — Persist + surface a record of each telemetry cleanup run.
 *
 * Verifies that:
 *  - `runMarketingOsTelemetryCleanupOnce` writes one row to
 *    `marketing_os_telemetry_cleanup_runs` per successful run.
 *  - `getLastMarketingOsTelemetryCleanupRun` returns the freshest row,
 *    serialized to ISO strings for the API.
 *  - The history is capped at the documented limit so the table can't
 *    grow without bound.
 */
process.env.MARKETING_OS_ENABLED = "true";

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { desc } from "drizzle-orm";
import { db } from "../../server/db";
import {
  getLastMarketingOsTelemetryCleanupRun,
  getMarketingOsTelemetryCleanupHistory,
  runMarketingOsTelemetryCleanupOnce,
} from "../../server/routes/marketing-os-telemetry-routes";
import {
  MARKETING_OS_TELEMETRY_CLEANUP_RUN_HISTORY_LIMIT,
  marketingOsTelemetryCleanupRuns,
} from "@shared/schema";

// Test-scoped lock key so this doesn't fight the production scheduler if
// it happens to be running inside the same process.
const TEST_LOCK_KEY = 220_998;

async function clearRuns() {
  await db.delete(marketingOsTelemetryCleanupRuns);
}

beforeEach(async () => {
  await clearRuns();
});

afterAll(async () => {
  await clearRuns();
});

describe("marketing-os telemetry cleanup run history (#243)", () => {
  it("persists one row per successful run and returns it as the last run", async () => {
    const result = await runMarketingOsTelemetryCleanupOnce(TEST_LOCK_KEY);
    expect(result.ran).toBe(true);

    const rows = await db
      .select()
      .from(marketingOsTelemetryCleanupRuns)
      .orderBy(desc(marketingOsTelemetryCleanupRuns.ranAt));
    expect(rows).toHaveLength(1);
    expect(rows[0].deletedCount).toBeGreaterThanOrEqual(0);
    expect(rows[0].retentionDays).toBeGreaterThanOrEqual(1);
    expect(rows[0].cutoff).toBeInstanceOf(Date);

    const last = await getLastMarketingOsTelemetryCleanupRun();
    expect(last).not.toBeNull();
    expect(last!.deletedCount).toBe(rows[0].deletedCount);
    expect(last!.retentionDays).toBe(rows[0].retentionDays);
    // ISO-serialized for the wire.
    expect(typeof last!.ranAt).toBe("string");
    expect(typeof last!.cutoff).toBe("string");
    expect(new Date(last!.ranAt).getTime()).toBe(rows[0].ranAt.getTime());
  });

  it("returns null when there is no recorded run yet", async () => {
    const last = await getLastMarketingOsTelemetryCleanupRun();
    expect(last).toBeNull();
  });

  it("trims history to the documented limit", async () => {
    const limit = MARKETING_OS_TELEMETRY_CLEANUP_RUN_HISTORY_LIMIT;
    // Pre-seed limit+5 historical rows directly so we don't have to call
    // the sweep that many times.
    const baseTime = Date.now() - 60 * 60 * 1000;
    for (let i = 0; i < limit + 5; i++) {
      await db.insert(marketingOsTelemetryCleanupRuns).values({
        ranAt: new Date(baseTime + i * 1000),
        cutoff: new Date(baseTime + i * 1000),
        deletedCount: i,
        retentionDays: 180,
      });
    }
    // One real sweep triggers the trim.
    const result = await runMarketingOsTelemetryCleanupOnce(TEST_LOCK_KEY);
    expect(result.ran).toBe(true);

    const rows = await db.select().from(marketingOsTelemetryCleanupRuns);
    expect(rows.length).toBeLessThanOrEqual(limit);
  });

  // Task #267 — full history listing endpoint
  it("returns history rows in descending ranAt order", async () => {
    const baseTime = Date.now() - 60 * 60 * 1000;
    const seeded = [3, 1, 2, 0, 4]; // intentionally not pre-sorted
    for (const offset of seeded) {
      await db.insert(marketingOsTelemetryCleanupRuns).values({
        ranAt: new Date(baseTime + offset * 60_000),
        cutoff: new Date(baseTime + offset * 60_000),
        deletedCount: offset,
        retentionDays: 30,
      });
    }

    const history = await getMarketingOsTelemetryCleanupHistory();
    expect(history).toHaveLength(seeded.length);
    for (let i = 0; i < history.length - 1; i++) {
      expect(
        new Date(history[i].ranAt).getTime() >=
          new Date(history[i + 1].ranAt).getTime(),
      ).toBe(true);
    }
    // Newest first should be the largest offset we seeded.
    expect(history[0].deletedCount).toBe(Math.max(...seeded));
  });

  it("caps history at the documented limit even when asked for more", async () => {
    const limit = MARKETING_OS_TELEMETRY_CLEANUP_RUN_HISTORY_LIMIT;
    const baseTime = Date.now() - 60 * 60 * 1000;
    for (let i = 0; i < limit + 10; i++) {
      await db.insert(marketingOsTelemetryCleanupRuns).values({
        ranAt: new Date(baseTime + i * 1000),
        cutoff: new Date(baseTime + i * 1000),
        deletedCount: i,
        retentionDays: 30,
      });
    }
    const history = await getMarketingOsTelemetryCleanupHistory(limit + 100);
    expect(history.length).toBeLessThanOrEqual(limit);
  });

  it("respects a smaller caller-supplied limit", async () => {
    const baseTime = Date.now() - 60 * 60 * 1000;
    for (let i = 0; i < 7; i++) {
      await db.insert(marketingOsTelemetryCleanupRuns).values({
        ranAt: new Date(baseTime + i * 1000),
        cutoff: new Date(baseTime + i * 1000),
        deletedCount: i,
        retentionDays: 30,
      });
    }
    const history = await getMarketingOsTelemetryCleanupHistory(3);
    expect(history).toHaveLength(3);
  });
});
