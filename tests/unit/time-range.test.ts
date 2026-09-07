import { describe, it, expect } from "vitest";
import { timeEntriesInRange, timeRangeCutoff } from "../../client/src/lib/time-range";

// Fixed "now" so the test is stable: Sunday 2026-09-06 07:45 local.
const NOW = new Date(2026, 8, 6, 7, 45, 0);

const entries = [
  { id: "a", date: "2026-09-04", minutes: 75 },
  { id: "b", date: "2026-08-31", minutes: 20 },
  { id: "c", date: "2026-08-14", minutes: 120 },
  { id: "d", date: "2026-08-03", minutes: 180 },
  { id: "e", date: "2026-07-30", minutes: 270 },
  { id: "f", date: "2026-06-01", minutes: 105 },
  { id: "g", date: "not-a-date", minutes: 999 },
];

describe("timeRangeCutoff", () => {
  it("returns null for all and for unknown keys", () => {
    expect(timeRangeCutoff("all", NOW)).toBeNull();
    expect(timeRangeCutoff("whatever", NOW)).toBeNull();
  });
  it("month starts on the first of the current month at local midnight", () => {
    const c = timeRangeCutoff("month", NOW)!;
    expect([c.getFullYear(), c.getMonth(), c.getDate(), c.getHours()]).toEqual([2026, 8, 1, 0]);
  });
});

describe("timeEntriesInRange", () => {
  it("all keeps every entry, including ones with unparseable dates", () => {
    expect(timeEntriesInRange(entries, "all", NOW).map(e => e.id)).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
  });
  it("7d keeps only the last week", () => {
    expect(timeEntriesInRange(entries, "7d", NOW).map(e => e.id)).toEqual(["a", "b"]);
  });
  it("30d reaches back into early August", () => {
    expect(timeEntriesInRange(entries, "30d", NOW).map(e => e.id)).toEqual(["a", "b", "c"]);
  });
  it("90d reaches back into June but not to June 1", () => {
    expect(timeEntriesInRange(entries, "90d", NOW).map(e => e.id)).toEqual(["a", "b", "c", "d", "e"]);
  });
  it("month keeps only September", () => {
    expect(timeEntriesInRange(entries, "month", NOW).map(e => e.id)).toEqual(["a"]);
  });
  it("drops malformed dates whenever a cutoff applies", () => {
    expect(timeEntriesInRange(entries, "90d", NOW).some(e => e.id === "g")).toBe(false);
  });
  it("sums the full history, not a ten-row sample", () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ id: String(i), date: "2026-08-15", minutes: 60 }));
    const total = timeEntriesInRange(many, "all", NOW).reduce((s, e) => s + e.minutes, 0);
    expect(total).toBe(25 * 60);
  });
});
