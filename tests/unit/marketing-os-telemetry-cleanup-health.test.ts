/**
 * Task #290 — Unit coverage for the telemetry cleanup staleness logic.
 *
 * The pure `computeMarketingOsTelemetryCleanupHealth` function powers
 * the warning banner on the admin Marketing OS telemetry card. These
 * tests pin the threshold contract (>2× interval ⇒ overdue), the
 * "missing" branch that fires when no run has ever happened despite a
 * backlog of expired rows, and a couple of edge cases (clock skew,
 * malformed timestamps) so a quiet refactor can't silently disable
 * the alert.
 */
import { describe, it, expect } from "vitest";
import {
  MARKETING_OS_TELEMETRY_CLEANUP_INTERVAL_MS,
  computeMarketingOsTelemetryCleanupHealth,
} from "../../server/routes/marketing-os-telemetry-routes";

const NOW = Date.parse("2026-04-22T12:00:00Z");
const HOUR = 3_600_000;

function lastRunAgo(hoursAgo: number) {
  return {
    ranAt: new Date(NOW - hoursAgo * HOUR).toISOString(),
    deletedCount: 0,
    retentionDays: 180,
    cutoff: new Date(NOW - 180 * 24 * HOUR).toISOString(),
  };
}

describe("computeMarketingOsTelemetryCleanupHealth", () => {
  it("uses the exported scheduler interval as the source of truth", () => {
    expect(MARKETING_OS_TELEMETRY_CLEANUP_INTERVAL_MS).toBe(24 * 60 * 60 * 1000);
    const health = computeMarketingOsTelemetryCleanupHealth({
      lastRun: lastRunAgo(1),
      now: NOW,
      hasEventsOlderThanRetention: false,
    });
    expect(health.intervalMs).toBe(MARKETING_OS_TELEMETRY_CLEANUP_INTERVAL_MS);
    expect(health.thresholdMs).toBe(2 * MARKETING_OS_TELEMETRY_CLEANUP_INTERVAL_MS);
  });

  it("reports ok when the last run is well under 2× the interval", () => {
    const health = computeMarketingOsTelemetryCleanupHealth({
      lastRun: lastRunAgo(12),
      now: NOW,
      hasEventsOlderThanRetention: true,
    });
    expect(health.status).toBe("ok");
    expect(health.ageMs).toBe(12 * HOUR);
  });

  it("reports ok exactly at the 2× boundary (48h with default interval)", () => {
    // Threshold is "more than 2× interval" so the boundary itself is
    // still healthy — pin that so a `>=` regression doesn't start
    // crying wolf at every scheduled tick.
    const health = computeMarketingOsTelemetryCleanupHealth({
      lastRun: lastRunAgo(48),
      now: NOW,
      hasEventsOlderThanRetention: false,
    });
    expect(health.status).toBe("ok");
  });

  it("reports overdue once the last run is older than 2× the interval", () => {
    const health = computeMarketingOsTelemetryCleanupHealth({
      lastRun: lastRunAgo(49),
      now: NOW,
      hasEventsOlderThanRetention: false,
    });
    expect(health.status).toBe("overdue");
    expect(health.ageMs).toBe(49 * HOUR);
  });

  it("honours a custom interval when one is passed (e.g. test scheduler)", () => {
    // 1h interval ⇒ 2h threshold.
    const okHealth = computeMarketingOsTelemetryCleanupHealth({
      lastRun: lastRunAgo(2),
      now: NOW,
      intervalMs: HOUR,
      hasEventsOlderThanRetention: false,
    });
    const overdueHealth = computeMarketingOsTelemetryCleanupHealth({
      lastRun: lastRunAgo(3),
      now: NOW,
      intervalMs: HOUR,
      hasEventsOlderThanRetention: false,
    });
    expect(okHealth.status).toBe("ok");
    expect(overdueHealth.status).toBe("overdue");
    expect(okHealth.thresholdMs).toBe(2 * HOUR);
  });

  it("reports missing when there is no run on record AND a backlog of expired rows", () => {
    const health = computeMarketingOsTelemetryCleanupHealth({
      lastRun: null,
      now: NOW,
      hasEventsOlderThanRetention: true,
    });
    expect(health.status).toBe("missing");
    expect(health.ageMs).toBeNull();
    expect(health.hasEventsOlderThanRetention).toBe(true);
  });

  it("reports ok when there is no run on record but also no expired rows", () => {
    // Fresh install / empty table — nothing to alert on.
    const health = computeMarketingOsTelemetryCleanupHealth({
      lastRun: null,
      now: NOW,
      hasEventsOlderThanRetention: false,
    });
    expect(health.status).toBe("ok");
    expect(health.ageMs).toBeNull();
  });

  it("clamps age at zero when the last run timestamp is in the future (clock skew)", () => {
    const health = computeMarketingOsTelemetryCleanupHealth({
      lastRun: lastRunAgo(-5),
      now: NOW,
      hasEventsOlderThanRetention: false,
    });
    expect(health.status).toBe("ok");
    expect(health.ageMs).toBe(0);
  });

  it("treats a malformed last-run timestamp as overdue rather than silently healthy", () => {
    const health = computeMarketingOsTelemetryCleanupHealth({
      lastRun: {
        ranAt: "not-a-real-date",
        deletedCount: 0,
        retentionDays: 180,
        cutoff: new Date(NOW).toISOString(),
      },
      now: NOW,
      hasEventsOlderThanRetention: false,
    });
    expect(health.status).toBe("overdue");
    expect(health.ageMs).toBeNull();
  });
});
