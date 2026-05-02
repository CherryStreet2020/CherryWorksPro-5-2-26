/**
 * Task #239 — Unit tests for `resolveDailyRange` (Task #215 helper).
 *
 * The helper drives the daily-trend chart on the Marketing OS upgrade
 * card. It accepts either a `days=N` rolling window or an explicit
 * `from`/`to` ISO-date pair, and validates several edge cases that are
 * otherwise only enforced at the route boundary. Each branch is pinned
 * here so a regression in either the helper or the wiring surfaces
 * immediately instead of via manual QA.
 */
import { describe, it, expect } from "vitest";
import { resolveDailyRange } from "../../server/routes/marketing-os-telemetry-routes";

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

describe("resolveDailyRange (Task #215)", () => {
  it("falls back to the default 30-day rolling window when no params are given", () => {
    const { since, days } = resolveDailyRange({});
    expect(days).toBe(30);
    // `since` is start-of-UTC-today minus (days - 1).
    const expectedSince = new Date();
    expectedSince.setUTCHours(0, 0, 0, 0);
    expectedSince.setUTCDate(expectedSince.getUTCDate() - 29);
    expect(isoDay(since)).toBe(isoDay(expectedSince));
    expect(since.getUTCHours()).toBe(0);
    expect(since.getUTCMinutes()).toBe(0);
  });

  it("honours a valid numeric `days` preset", () => {
    const { days } = resolveDailyRange({ days: "7" });
    expect(days).toBe(7);
  });

  it("clamps invalid `days` (negative, zero, > 90, NaN) back to 30", () => {
    expect(resolveDailyRange({ days: "0" }).days).toBe(30);
    expect(resolveDailyRange({ days: "-5" }).days).toBe(30);
    expect(resolveDailyRange({ days: "999" }).days).toBe(30);
    expect(resolveDailyRange({ days: "not-a-number" }).days).toBe(30);
  });

  it("accepts a valid inclusive `from`/`to` custom range", () => {
    const { since, days } = resolveDailyRange({
      from: "2026-04-01",
      to: "2026-04-10",
    });
    // Inclusive: Apr 1..Apr 10 = 10 days.
    expect(days).toBe(10);
    expect(isoDay(since)).toBe("2026-04-01");
    expect(since.getUTCHours()).toBe(0);
  });

  it("treats a `from`/`to` of the same day as a 1-day window", () => {
    const { days } = resolveDailyRange({
      from: "2026-04-05",
      to: "2026-04-05",
    });
    expect(days).toBe(1);
  });

  it("rejects a reversed range (`to` before `from`)", () => {
    expect(() =>
      resolveDailyRange({ from: "2026-04-10", to: "2026-04-01" }),
    ).toThrow(/to must be on or after from/i);
  });

  it("rejects a custom range that exceeds 90 days", () => {
    // 2026-01-01..2026-04-30 = 120 days inclusive — well over the cap.
    expect(() =>
      resolveDailyRange({ from: "2026-01-01", to: "2026-04-30" }),
    ).toThrow(/cannot exceed 90 days/i);
  });

  it("allows exactly 90 days inclusive (boundary stays valid)", () => {
    // 2026-01-01..2026-03-31 = 90 days inclusive in a non-leap-year-ish
    // window: Jan(31) + Feb(28) + Mar(31) = 90.
    const { days } = resolveDailyRange({
      from: "2026-01-01",
      to: "2026-03-31",
    });
    expect(days).toBe(90);
  });

  it("rejects a custom range with only `from` provided", () => {
    expect(() => resolveDailyRange({ from: "2026-04-01" })).toThrow(
      /Both from and to are required/i,
    );
  });

  it("rejects a custom range with only `to` provided", () => {
    expect(() => resolveDailyRange({ to: "2026-04-10" })).toThrow(
      /Both from and to are required/i,
    );
  });

  it("rejects malformed ISO dates", () => {
    expect(() =>
      resolveDailyRange({ from: "04/01/2026", to: "2026-04-10" }),
    ).toThrow(/Invalid from date/i);
    expect(() =>
      resolveDailyRange({ from: "2026-04-01", to: "2026-13-40" }),
    ).toThrow(/Invalid to date/i);
  });
});
