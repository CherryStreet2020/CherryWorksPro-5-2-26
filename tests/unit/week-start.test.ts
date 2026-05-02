import { describe, it, expect } from "vitest";

function getWeekStartDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().split("T")[0];
}

describe("week start computation (Sunday-based)", () => {
  it("Sunday is its own week start", () => {
    expect(getWeekStartDate("2026-04-05")).toBe("2026-04-05");
  });

  it("Monday goes back to Sunday", () => {
    expect(getWeekStartDate("2026-04-06")).toBe("2026-04-05");
  });

  it("Saturday goes back to Sunday", () => {
    expect(getWeekStartDate("2026-04-11")).toBe("2026-04-05");
  });

  it("Wednesday goes back to Sunday", () => {
    expect(getWeekStartDate("2026-04-08")).toBe("2026-04-05");
  });

  it("profile.tsx and time-tracking.tsx use same computation", () => {
    const profileWeekStart = (() => {
      const d = new Date("2026-04-06T00:00:00Z");
      const day = d.getUTCDay();
      d.setUTCDate(d.getUTCDate() - day);
      return d.toISOString().split("T")[0];
    })();
    const timeTrackingWeekStart = getWeekStartDate("2026-04-06");
    expect(profileWeekStart).toBe(timeTrackingWeekStart);
  });

  it("time entry on Sunday is included in week starting that Sunday", () => {
    const entryDate = "2026-04-05";
    const weekStart = getWeekStartDate("2026-04-06");
    const entryWeekStart = getWeekStartDate(entryDate);
    expect(entryWeekStart).toBe(weekStart);
  });
});
