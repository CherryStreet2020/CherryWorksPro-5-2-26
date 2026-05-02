/**
 * Task #318 — Unit coverage for the "should we email admins about a
 * silent telemetry cleanup sweep" decision logic.
 *
 * The pure `shouldEmailTelemetryCleanupSilence` function is what the
 * cleanup tick consults before paging admins. These tests pin every
 * branch of the decision matrix:
 *   - "ok" health never alerts
 *   - "overdue" alerts only past the configured silence threshold
 *   - "missing" alerts immediately (no run on record + backlog of
 *     expired rows is itself evidence the scheduler has been silent
 *     for at least the retention window)
 *   - dedupe: a prior alert suppresses the next tick's alert until a
 *     fresh successful cleanup run resets the state
 *   - malformed last-run timestamp (ageMs=null) on an "overdue"
 *     branch must NOT silently page admins
 *
 * Plus a smoke test on `buildTelemetryCleanupSilenceEmail` to make
 * sure the subject/html/text contain the operator-facing details a
 * paged admin needs to act.
 */
import { describe, it, expect } from "vitest";
import {
  buildTelemetryCleanupSilenceEmail,
  shouldEmailTelemetryCleanupSilence,
} from "../../server/notifications/marketing-os-telemetry-cleanup-silence";
import type { MarketingOsTelemetryCleanupHealth } from "../../server/routes/marketing-os-telemetry-routes";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const SILENCE_THRESHOLD_MS = 3 * DAY;

function health(
  status: "ok" | "overdue" | "missing",
  ageMs: number | null,
): MarketingOsTelemetryCleanupHealth {
  return {
    status,
    intervalMs: DAY,
    thresholdMs: 2 * DAY,
    ageMs,
    hasEventsOlderThanRetention: status === "missing",
  };
}

describe("shouldEmailTelemetryCleanupSilence", () => {
  it("never alerts when health is ok", () => {
    expect(
      shouldEmailTelemetryCleanupSilence({
        health: health("ok", 12 * HOUR),
        silenceThresholdMs: SILENCE_THRESHOLD_MS,
        lastAlertSentAtMs: null,
        lastRunRanAtMs: Date.now() - 12 * HOUR,
      }),
    ).toBe(false);
  });

  it("does not alert when overdue but still under the silence threshold", () => {
    // Banner is already 'overdue' at 49h, but we don't page admins
    // until they've been silent for the configured several days.
    expect(
      shouldEmailTelemetryCleanupSilence({
        health: health("overdue", 50 * HOUR),
        silenceThresholdMs: SILENCE_THRESHOLD_MS,
        lastAlertSentAtMs: null,
        lastRunRanAtMs: Date.now() - 50 * HOUR,
      }),
    ).toBe(false);
  });

  it("alerts when overdue at exactly the silence threshold", () => {
    expect(
      shouldEmailTelemetryCleanupSilence({
        health: health("overdue", SILENCE_THRESHOLD_MS),
        silenceThresholdMs: SILENCE_THRESHOLD_MS,
        lastAlertSentAtMs: null,
        lastRunRanAtMs: Date.now() - SILENCE_THRESHOLD_MS,
      }),
    ).toBe(true);
  });

  it("alerts when overdue well past the silence threshold", () => {
    expect(
      shouldEmailTelemetryCleanupSilence({
        health: health("overdue", 5 * DAY),
        silenceThresholdMs: SILENCE_THRESHOLD_MS,
        lastAlertSentAtMs: null,
        lastRunRanAtMs: Date.now() - 5 * DAY,
      }),
    ).toBe(true);
  });

  it("alerts immediately on missing (no run + backlog of expired rows)", () => {
    // The very fact that no run has ever fired AND there are already
    // expired rows is itself evidence the scheduler has been silent
    // for at least the retention window. Don't let ageMs=null
    // silently suppress.
    expect(
      shouldEmailTelemetryCleanupSilence({
        health: health("missing", null),
        silenceThresholdMs: SILENCE_THRESHOLD_MS,
        lastAlertSentAtMs: null,
        lastRunRanAtMs: null,
      }),
    ).toBe(true);
  });

  it("does NOT alert on overdue with a malformed last-run timestamp (ageMs=null)", () => {
    // Banner treats malformed timestamps as overdue, but we have no
    // real age to compare against the threshold; better to wait for
    // the next tick than to cry wolf.
    expect(
      shouldEmailTelemetryCleanupSilence({
        health: health("overdue", null),
        silenceThresholdMs: SILENCE_THRESHOLD_MS,
        lastAlertSentAtMs: null,
        lastRunRanAtMs: null,
      }),
    ).toBe(false);
  });

  it("dedupes: does not re-alert when a prior alert exists and no fresh run has happened since", () => {
    const lastAlert = Date.now() - 1 * HOUR;
    expect(
      shouldEmailTelemetryCleanupSilence({
        health: health("overdue", 5 * DAY),
        silenceThresholdMs: SILENCE_THRESHOLD_MS,
        lastAlertSentAtMs: lastAlert,
        // Last run is older than the alert — scheduler has stayed
        // silent since we last emailed. One alert per breakage.
        lastRunRanAtMs: lastAlert - 4 * DAY,
      }),
    ).toBe(false);
  });

  it("re-alerts on a fresh breakage after a successful cleanup run resets the dedupe", () => {
    const lastAlert = Date.now() - 10 * DAY;
    // A successful run happened after the prior alert (implicit
    // reset), then the scheduler went silent again.
    const lastRun = lastAlert + 2 * DAY;
    expect(
      shouldEmailTelemetryCleanupSilence({
        health: health("overdue", 5 * DAY),
        silenceThresholdMs: SILENCE_THRESHOLD_MS,
        lastAlertSentAtMs: lastAlert,
        lastRunRanAtMs: lastRun,
      }),
    ).toBe(true);
  });

  it("dedupes 'missing' the same way as 'overdue'", () => {
    const lastAlert = Date.now() - 6 * HOUR;
    expect(
      shouldEmailTelemetryCleanupSilence({
        health: health("missing", null),
        silenceThresholdMs: SILENCE_THRESHOLD_MS,
        lastAlertSentAtMs: lastAlert,
        lastRunRanAtMs: null,
      }),
    ).toBe(false);
  });
});

describe("buildTelemetryCleanupSilenceEmail", () => {
  it("includes the silence duration and interval in an overdue alert", () => {
    const out = buildTelemetryCleanupSilenceEmail({
      status: "overdue",
      ageMs: 5 * DAY,
      intervalMs: DAY,
    });
    expect(out.subject).toContain("5 days");
    expect(out.html).toContain("5 days");
    expect(out.html).toContain("24h");
    expect(out.text).toContain("5 days");
    expect(out.text).toContain("24h");
  });

  it("renders the missing variant differently from overdue", () => {
    const out = buildTelemetryCleanupSilenceEmail({
      status: "missing",
      ageMs: null,
      intervalMs: DAY,
    });
    expect(out.subject.toLowerCase()).toContain("never");
    expect(out.html.toLowerCase()).toContain("never");
    expect(out.text.toLowerCase()).toContain("never");
  });
});
