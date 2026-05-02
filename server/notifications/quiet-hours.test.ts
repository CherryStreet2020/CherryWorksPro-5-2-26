import { describe, it, expect } from "vitest";
import {
  parseHHMM,
  isWithinQuietHours,
  nextQuietHoursEnd,
  tzOffsetMs,
} from "./quiet-hours";

describe("parseHHMM", () => {
  it("parses valid times", () => {
    expect(parseHHMM("00:00")).toBe(0);
    expect(parseHHMM("9:30")).toBe(9 * 60 + 30);
    expect(parseHHMM("22:00")).toBe(22 * 60);
    expect(parseHHMM("23:59")).toBe(23 * 60 + 59);
  });
  it("rejects malformed values", () => {
    expect(parseHHMM(null)).toBeNull();
    expect(parseHHMM("")).toBeNull();
    expect(parseHHMM("24:00")).toBeNull();
    expect(parseHHMM("12:60")).toBeNull();
    expect(parseHHMM("noon")).toBeNull();
  });
});

describe("tzOffsetMs", () => {
  it("returns zero for UTC", () => {
    expect(tzOffsetMs(new Date("2026-01-15T12:00:00Z"), "UTC")).toBe(0);
  });
  it("returns negative offset for west-of-UTC zones (PST)", () => {
    // 2026-01-15 12:00Z is 04:00 in Los Angeles (PST = UTC-8)
    expect(
      tzOffsetMs(new Date("2026-01-15T12:00:00Z"), "America/Los_Angeles"),
    ).toBe(-8 * 60 * 60_000);
  });
  it("falls back to 0 for unknown zones", () => {
    expect(tzOffsetMs(new Date(), "Not/AReal_Zone")).toBe(0);
  });
});

describe("isWithinQuietHours", () => {
  const enabled = {
    quietHoursEnabled: true,
    quietHoursStart: "22:00",
    quietHoursEnd: "07:00",
    quietHoursTimezone: "UTC",
  };

  it("returns false when disabled", () => {
    const at3am = new Date("2026-01-15T03:00:00Z");
    expect(isWithinQuietHours(at3am, { ...enabled, quietHoursEnabled: false })).toBe(false);
  });

  it("returns false outside the window", () => {
    const noon = new Date("2026-01-15T12:00:00Z");
    expect(isWithinQuietHours(noon, enabled)).toBe(false);
  });

  it("handles wrap-around windows (3am UTC is inside 22:00-07:00)", () => {
    const at3am = new Date("2026-01-15T03:00:00Z");
    expect(isWithinQuietHours(at3am, enabled)).toBe(true);
  });

  it("handles wrap-around windows (23:00 UTC is inside 22:00-07:00)", () => {
    const at11pm = new Date("2026-01-15T23:00:00Z");
    expect(isWithinQuietHours(at11pm, enabled)).toBe(true);
  });

  it("respects the configured timezone", () => {
    // 06:00Z is 22:00 in Los Angeles (the day before, PST). Window starts
    // at 22:00 LA so the recipient should be in quiet hours.
    const at6amUtc = new Date("2026-01-15T06:00:00Z");
    expect(
      isWithinQuietHours(at6amUtc, {
        ...enabled,
        quietHoursTimezone: "America/Los_Angeles",
      }),
    ).toBe(true);
    // 18:00Z is 10:00 LA — outside the window.
    const at6pmUtc = new Date("2026-01-15T18:00:00Z");
    expect(
      isWithinQuietHours(at6pmUtc, {
        ...enabled,
        quietHoursTimezone: "America/Los_Angeles",
      }),
    ).toBe(false);
  });

  it("handles non-wrap windows", () => {
    const prefs = { ...enabled, quietHoursStart: "09:00", quietHoursEnd: "17:00" };
    expect(isWithinQuietHours(new Date("2026-01-15T12:00:00Z"), prefs)).toBe(true);
    expect(isWithinQuietHours(new Date("2026-01-15T08:59:00Z"), prefs)).toBe(false);
    // End time itself is excluded.
    expect(isWithinQuietHours(new Date("2026-01-15T17:00:00Z"), prefs)).toBe(false);
  });

  it("treats start === end as 'always quiet'", () => {
    const prefs = { ...enabled, quietHoursStart: "08:00", quietHoursEnd: "08:00" };
    expect(isWithinQuietHours(new Date("2026-01-15T03:00:00Z"), prefs)).toBe(true);
    expect(isWithinQuietHours(new Date("2026-01-15T12:00:00Z"), prefs)).toBe(true);
  });

  it("fails open on malformed config", () => {
    expect(
      isWithinQuietHours(new Date(), {
        quietHoursEnabled: true,
        quietHoursStart: "bad",
        quietHoursEnd: "07:00",
        quietHoursTimezone: "UTC",
      }),
    ).toBe(false);
  });
});

describe("nextQuietHoursEnd", () => {
  const window = {
    quietHoursEnabled: true,
    quietHoursStart: "22:00",
    quietHoursEnd: "07:00",
    quietHoursTimezone: "UTC",
  };

  it("returns the same-day end when we're past midnight in tz", () => {
    const at3am = new Date("2026-01-15T03:00:00Z");
    const r = nextQuietHoursEnd(at3am, window);
    expect(r.toISOString()).toBe("2026-01-15T07:00:00.000Z");
  });

  it("returns next-day end when we're after start (before midnight) in tz", () => {
    const at11pm = new Date("2026-01-15T23:00:00Z");
    const r = nextQuietHoursEnd(at11pm, window);
    expect(r.toISOString()).toBe("2026-01-16T07:00:00.000Z");
  });

  it("returns later-today end for non-wrap windows", () => {
    const prefs = { ...window, quietHoursStart: "09:00", quietHoursEnd: "17:00" };
    const r = nextQuietHoursEnd(new Date("2026-01-15T12:00:00Z"), prefs);
    expect(r.toISOString()).toBe("2026-01-15T17:00:00.000Z");
  });

  it("respects timezone — 07:00 LA is 15:00Z in winter", () => {
    const prefs = { ...window, quietHoursTimezone: "America/Los_Angeles" };
    // 06:00Z = 22:00 LA on 14th → release at 07:00 LA on 15th = 15:00Z
    const r = nextQuietHoursEnd(new Date("2026-01-15T06:00:00Z"), prefs);
    expect(r.toISOString()).toBe("2026-01-15T15:00:00.000Z");
  });

  it("for always-quiet windows returns within 24h so the buffer drains", () => {
    const prefs = { ...window, quietHoursStart: "08:00", quietHoursEnd: "08:00" };
    const now = new Date("2026-01-15T10:00:00Z");
    const r = nextQuietHoursEnd(now, prefs);
    const diff = r.getTime() - now.getTime();
    expect(diff).toBeGreaterThan(0);
    expect(diff).toBeLessThanOrEqual(24 * 60 * 60_000);
  });
});
