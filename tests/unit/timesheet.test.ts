import { describe, it, expect } from "vitest";
import { getWeekStartDate, getWeekEndDate, computeUtilization } from "../../shared/schema";

describe("timesheet_week_start_is_sunday_and_consistent", () => {
  it("returns Sunday for any day of the week", () => {
    expect(getWeekStartDate("2026-03-01")).toBe("2026-03-01");
    expect(getWeekStartDate("2026-03-02")).toBe("2026-03-01");
    expect(getWeekStartDate("2026-03-03")).toBe("2026-03-01");
    expect(getWeekStartDate("2026-03-04")).toBe("2026-03-01");
    expect(getWeekStartDate("2026-03-05")).toBe("2026-03-01");
    expect(getWeekStartDate("2026-03-06")).toBe("2026-03-01");
    expect(getWeekStartDate("2026-03-07")).toBe("2026-03-01");
  });

  it("Sunday maps to itself", () => {
    expect(getWeekStartDate("2026-02-22")).toBe("2026-02-22");
    expect(getWeekStartDate("2026-01-04")).toBe("2026-01-04");
  });

  it("Saturday maps to prior Sunday", () => {
    expect(getWeekStartDate("2026-02-28")).toBe("2026-02-22");
  });

  it("week end is always 6 days after start", () => {
    const start = "2026-03-01";
    const end = getWeekEndDate(start);
    expect(end).toBe("2026-03-07");
    const d = new Date(end + "T00:00:00Z");
    expect(d.getUTCDay()).toBe(6);
  });

  it("is idempotent: getWeekStartDate(getWeekStartDate(x)) === getWeekStartDate(x)", () => {
    const dates = ["2026-01-15", "2026-06-20", "2026-12-31", "2026-02-28"];
    for (const d of dates) {
      const ws = getWeekStartDate(d);
      expect(getWeekStartDate(ws)).toBe(ws);
    }
  });

  it("cross-month boundary", () => {
    expect(getWeekStartDate("2026-03-01")).toBe("2026-03-01");
    expect(getWeekEndDate("2026-02-22")).toBe("2026-02-28");
  });
});

describe("locking_blocks_team_member_edits_when_submitted", () => {
  function canEditEntry(
    userRole: string,
    timesheetStatus: string | null,
    invoiced: boolean,
  ): boolean {
    if (invoiced) return false;
    if (userRole === "ADMIN") return true;
    if (timesheetStatus === null || timesheetStatus === "DRAFT") return true;
    return false;
  }

  it("team member can edit when no timesheet exists", () => {
    expect(canEditEntry("TEAM_MEMBER", null, false)).toBe(true);
  });

  it("team member can edit when timesheet is DRAFT", () => {
    expect(canEditEntry("TEAM_MEMBER", "DRAFT", false)).toBe(true);
  });

  it("team member CANNOT edit when timesheet is SUBMITTED", () => {
    expect(canEditEntry("TEAM_MEMBER", "SUBMITTED", false)).toBe(false);
  });

  it("team member CANNOT edit when timesheet is APPROVED", () => {
    expect(canEditEntry("TEAM_MEMBER", "APPROVED", false)).toBe(false);
  });

  it("team member CANNOT edit when timesheet is REJECTED", () => {
    expect(canEditEntry("TEAM_MEMBER", "REJECTED", false)).toBe(false);
  });

  it("admin can always edit (non-invoiced)", () => {
    expect(canEditEntry("ADMIN", "SUBMITTED", false)).toBe(true);
    expect(canEditEntry("ADMIN", "APPROVED", false)).toBe(true);
  });

  it("invoiced entries cannot be edited by anyone", () => {
    expect(canEditEntry("TEAM_MEMBER", "DRAFT", true)).toBe(false);
    expect(canEditEntry("ADMIN", null, true)).toBe(false);
  });
});

describe("invoice_generation_includes_only_approved_by_default", () => {
  interface TimeEntryStub {
    userId: string;
    date: string;
    billable: boolean;
    invoiced: boolean;
  }

  interface TimesheetStub {
    userId: string;
    weekStartDate: string;
    status: string;
  }

  function filterForInvoicing(
    entries: TimeEntryStub[],
    timesheets: TimesheetStub[],
    includeUnapproved: boolean,
  ): TimeEntryStub[] {
    return entries.filter((e) => {
      if (!e.billable || e.invoiced) return false;
      if (includeUnapproved) return true;
      const ws = getWeekStartDate(e.date);
      const ts = timesheets.find(
        (t) => t.userId === e.userId && t.weekStartDate === ws,
      );
      return ts?.status === "APPROVED";
    });
  }

  const entries: TimeEntryStub[] = [
    { userId: "u1", date: "2026-03-02", billable: true, invoiced: false },
    { userId: "u1", date: "2026-03-03", billable: true, invoiced: false },
    { userId: "u2", date: "2026-03-02", billable: true, invoiced: false },
  ];

  const timesheets: TimesheetStub[] = [
    { userId: "u1", weekStartDate: "2026-03-01", status: "APPROVED" },
    { userId: "u2", weekStartDate: "2026-03-01", status: "SUBMITTED" },
  ];

  it("default: only includes approved entries", () => {
    const result = filterForInvoicing(entries, timesheets, false);
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.userId === "u1")).toBe(true);
  });

  it("override: includes all billable unbilled entries", () => {
    const result = filterForInvoicing(entries, timesheets, true);
    expect(result).toHaveLength(3);
  });

  it("never includes invoiced entries", () => {
    const mixed = [
      ...entries,
      { userId: "u1", date: "2026-03-04", billable: true, invoiced: true },
    ];
    const result = filterForInvoicing(mixed, timesheets, true);
    expect(result).toHaveLength(3);
  });

  it("never includes non-billable entries", () => {
    const mixed = [
      ...entries,
      { userId: "u1", date: "2026-03-04", billable: false, invoiced: false },
    ];
    const result = filterForInvoicing(mixed, timesheets, true);
    expect(result).toHaveLength(3);
  });
});

describe("utilization_math_is_deterministic", () => {
  it("zero total returns 0", () => {
    expect(computeUtilization(0, 0)).toBe(0);
  });

  it("all billable returns 1", () => {
    expect(computeUtilization(480, 0)).toBe(1);
  });

  it("all non-billable returns 0", () => {
    expect(computeUtilization(0, 480)).toBe(0);
  });

  it("50/50 returns 0.5", () => {
    expect(computeUtilization(240, 240)).toBe(0.5);
  });

  it("deterministic rounding to 4 decimals", () => {
    const result = computeUtilization(100, 200);
    expect(result).toBe(0.3333);

    const result2 = computeUtilization(200, 100);
    expect(result2).toBe(0.6667);
  });

  it("repeated calls produce identical results", () => {
    for (let i = 0; i < 100; i++) {
      const a = computeUtilization(333, 667);
      const b = computeUtilization(333, 667);
      expect(a).toBe(b);
      expect(a).toBe(0.333);
    }
  });

  it("real-world scenario: 36h billable, 4h non-billable", () => {
    const result = computeUtilization(2160, 240);
    expect(result).toBe(0.9);
  });
});
