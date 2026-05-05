import { describe, expect, it } from "vitest";
import {
  buildDetailItems,
  extractTicketRef,
  formatHM,
  isoWeekStart,
  resolveShowTimeEntryDetails,
  type DetailDayHeader,
  type DetailEntryRow,
  type DetailWeekFooter,
  type JoinedEntry,
} from "../../server/invoice-details";

// Unit tests for the pure helpers in server/invoice-details.ts.
// SQL/integration coverage lives in the Playwright e2e.

describe("extractTicketRef", () => {
  it("returns null ticket and empty description for null/empty notes", () => {
    expect(extractTicketRef(null)).toEqual({ ticket: null, description: "" });
    expect(extractTicketRef(undefined)).toEqual({ ticket: null, description: "" });
    expect(extractTicketRef("")).toEqual({ ticket: null, description: "" });
    expect(extractTicketRef("   ")).toEqual({ ticket: null, description: "" });
  });

  it("parses uppercase project code prefix with dash separator", () => {
    expect(extractTicketRef("ABS-150 fixed login bug")).toEqual({
      ticket: "ABS-150",
      description: "fixed login bug",
    });
  });

  it("parses prefix with colon separator", () => {
    expect(extractTicketRef("PROJ-9: rebuilt the report")).toEqual({
      ticket: "PROJ-9",
      description: "rebuilt the report",
    });
  });

  it("parses prefix with dash-spaces separator", () => {
    expect(extractTicketRef("AB-1 - paired with Sam")).toEqual({
      ticket: "AB-1",
      description: "paired with Sam",
    });
  });

  it("returns null ticket when prefix is lowercase or malformed", () => {
    expect(extractTicketRef("abs-150 nope")).toEqual({ ticket: null, description: "abs-150 nope" });
    expect(extractTicketRef("X-1 nope (only 1 letter)")).toEqual({ ticket: null, description: "X-1 nope (only 1 letter)" });
    expect(extractTicketRef("ABS150 missing dash")).toEqual({ ticket: null, description: "ABS150 missing dash" });
  });

  it("handles ticket-only notes (no description)", () => {
    expect(extractTicketRef("ABS-7")).toEqual({ ticket: "ABS-7", description: "" });
  });
});

describe("isoWeekStart", () => {
  it("snaps any weekday to the Monday of its ISO week", () => {
    // 2026-04-29 is a Wednesday; Monday is 2026-04-27.
    expect(isoWeekStart("2026-04-29")).toBe("2026-04-27");
    expect(isoWeekStart("2026-04-27")).toBe("2026-04-27");
    // Sunday should map back to the prior Monday.
    expect(isoWeekStart("2026-05-03")).toBe("2026-04-27");
  });

  it("returns the input unchanged for malformed dates", () => {
    expect(isoWeekStart("not-a-date")).toBe("not-a-date");
  });
});

describe("formatHM", () => {
  it("renders decimal hours as H:MM, padding minutes", () => {
    expect(formatHM(0)).toBe("0:00");
    expect(formatHM(1)).toBe("1:00");
    expect(formatHM(1.5)).toBe("1:30");
    expect(formatHM(2.25)).toBe("2:15");
    expect(formatHM(0.1)).toBe("0:06");
  });

  it("preserves negative sign", () => {
    expect(formatHM(-1.5)).toBe("-1:30");
  });
});

describe("resolveShowTimeEntryDetails", () => {
  it("falls back to org default when invoice override is null/undefined", () => {
    expect(resolveShowTimeEntryDetails(null, true)).toBe(true);
    expect(resolveShowTimeEntryDetails(undefined, true)).toBe(true);
    expect(resolveShowTimeEntryDetails(null, false)).toBe(false);
    expect(resolveShowTimeEntryDetails(null, null)).toBe(false);
  });

  it("respects an explicit invoice override regardless of org default", () => {
    expect(resolveShowTimeEntryDetails(true, false)).toBe(true);
    expect(resolveShowTimeEntryDetails(false, true)).toBe(false);
  });
});

describe("buildDetailItems", () => {
  // Builds a fully-typed JoinedEntry from a partial override.
  const e = (over: Partial<JoinedEntry> & Pick<JoinedEntry, "date" | "minutes">): JoinedEntry => ({
    id: over.id ?? `e-${Math.random().toString(36).slice(2, 8)}`,
    date: over.date,
    minutes: over.minutes,
    billable: over.billable ?? true,
    notes: over.notes ?? null,
    startTime: over.startTime ?? null,
    endTime: over.endTime ?? null,
    invoiceLineId: over.invoiceLineId ?? "line-1",
    projectName: over.projectName ?? "Acme",
    userName: over.userName ?? "Dean",
    serviceName: over.serviceName ?? null,
  });

  it("returns empty array when given no entries", () => {
    expect(buildDetailItems([])).toEqual([]);
  });

  it("groups entries into day headers with the day total", () => {
    const items = buildDetailItems([
      e({ date: "2026-04-28", minutes: 60, startTime: "09:00", endTime: "10:00", notes: "ABS-1 task A" }),
      e({ date: "2026-04-28", minutes: 90, startTime: "10:00", endTime: "11:30", notes: "ABS-2 task B" }),
    ]);
    // Expected: [day(2.5h), entry, entry, week(2.5 billable + 0 unbilled = 2.5)]
    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({ kind: "day", date: "2026-04-28", totalHours: 2.5 });
    expect(items[1]).toMatchObject({ kind: "entry", ticket: "ABS-1", hours: 1 });
    expect(items[2]).toMatchObject({ kind: "entry", ticket: "ABS-2", hours: 1.5 });
    expect(items[3]).toMatchObject({ kind: "week", billableHours: 2.5, internalHours: 0, totalHours: 2.5 });
  });

  it("emits a separate day header for each distinct date", () => {
    const items = buildDetailItems([
      e({ date: "2026-04-28", minutes: 60 }),
      e({ date: "2026-04-29", minutes: 30 }),
    ]);
    const days = items.filter((i): i is DetailDayHeader => i.kind === "day");
    expect(days).toHaveLength(2);
    expect(days[0].date).toBe("2026-04-28");
    expect(days[1].date).toBe("2026-04-29");
  });

  it("flushes a weekly subtotal at every ISO-week boundary", () => {
    // Mon 2026-04-27 (week 1) → Mon 2026-05-04 (week 2)
    const items = buildDetailItems([
      e({ date: "2026-04-28", minutes: 60, billable: true }),
      e({ date: "2026-05-05", minutes: 120, billable: false }),
    ]);
    const weeks = items.filter((i): i is DetailWeekFooter => i.kind === "week");
    expect(weeks).toHaveLength(2);
    expect(weeks[0]).toMatchObject({ weekStart: "2026-04-27", billableHours: 1, internalHours: 0, totalHours: 1 });
    expect(weeks[1]).toMatchObject({ weekStart: "2026-05-04", billableHours: 0, internalHours: 2, totalHours: 2 });
  });

  it("splits billable vs unbilled in the week subtotal", () => {
    const items = buildDetailItems([
      e({ date: "2026-04-28", minutes: 60, billable: true }),
      e({ date: "2026-04-29", minutes: 30, billable: false }),
    ]);
    const week = items.find((i): i is DetailWeekFooter => i.kind === "week");
    expect(week).toMatchObject({ billableHours: 1, internalHours: 0.5, totalHours: 1.5 });
  });

  it("yields an empty description when notes are empty (project stays in its own field)", () => {
    const items = buildDetailItems([
      e({ date: "2026-04-28", minutes: 60, notes: null, projectName: "Acme Refactor" }),
    ]);
    const entry = items.find((i): i is DetailEntryRow => i.kind === "entry");
    expect(entry).toBeDefined();
    expect(entry!.ticket).toBeNull();
    expect(entry!.description).toBe("");
    // The project name MUST stay in `project`, never leak into `description`.
    expect(entry!.project).toBe("Acme Refactor");
  });
});
