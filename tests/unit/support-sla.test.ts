import { describe, it, expect } from "vitest";
import { addBusinessHours, computeDueDates, slaStateFor, clockPatchForStatus, DEFAULT_POLICY } from "../../server/support-sla";

const NY = { businessStartHour: 9, businessEndHour: 17, timezone: "America/New_York" };
// Helper: an instant for a New York wall-clock time (EDT in September = UTC-4).
const ny = (iso: string) => new Date(iso + "-04:00");

describe("addBusinessHours", () => {
  it("adds within the same business day", () => {
    expect(addBusinessHours(ny("2026-09-08T10:00:00"), 2, NY).toISOString()).toBe(ny("2026-09-08T12:00:00").toISOString());
  });
  it("rolls into the next business day when the day runs out", () => {
    // Tue 3pm + 4h → 2h left today, 2h tomorrow → Wed 11am
    expect(addBusinessHours(ny("2026-09-08T15:00:00"), 4, NY).toISOString()).toBe(ny("2026-09-09T11:00:00").toISOString());
  });
  it("skips the weekend", () => {
    // Fri 4pm + 2h → 1h Fri, 1h Mon → Mon 10am
    expect(addBusinessHours(ny("2026-09-11T16:00:00"), 2, NY).toISOString()).toBe(ny("2026-09-14T10:00:00").toISOString());
  });
  it("starts the clock at the next open when created after hours or on a weekend", () => {
    expect(addBusinessHours(ny("2026-09-08T22:30:00"), 1, NY).toISOString()).toBe(ny("2026-09-09T10:00:00").toISOString());
    expect(addBusinessHours(ny("2026-09-12T12:00:00"), 1, NY).toISOString()).toBe(ny("2026-09-14T10:00:00").toISOString()); // Saturday
  });
  it("8 business hours from Tuesday 9am is Tuesday 5pm; 24 is Thursday 5pm", () => {
    const due = computeDueDates(ny("2026-09-08T09:00:00"), DEFAULT_POLICY);
    expect(due.firstResponseDueAt.toISOString()).toBe(ny("2026-09-08T17:00:00").toISOString());
    expect(due.resolutionDueAt.toISOString()).toBe(ny("2026-09-10T17:00:00").toISOString());
  });
  it("calendar hours when business-hours-only is off", () => {
    const due = computeDueDates(ny("2026-09-11T16:00:00"), { ...DEFAULT_POLICY, businessHoursOnly: false });
    expect(due.firstResponseDueAt.toISOString()).toBe(ny("2026-09-12T00:00:00").toISOString());
  });
});

describe("slaStateFor", () => {
  const created = ny("2026-09-08T09:00:00");
  const base = { status: "NEW", createdAt: created, firstResponseAt: null, firstResponseDueAt: ny("2026-09-08T17:00:00"), resolutionDueAt: ny("2026-09-10T17:00:00"), resolvedAt: null, slaPausedAt: null };
  it("is ok with plenty of time, warning inside the last hour, breached after due", () => {
    expect(slaStateFor(base, ny("2026-09-08T10:00:00")).firstResponse).toBe("ok");
    expect(slaStateFor(base, ny("2026-09-08T16:30:00")).firstResponse).toBe("warning");
    expect(slaStateFor(base, ny("2026-09-08T17:30:00")).firstResponse).toBe("breached");
    expect(slaStateFor(base, ny("2026-09-08T17:30:00")).label).toMatch(/overdue/i);
  });
  it("first response met on time stays met; the label moves to resolution", () => {
    const s = slaStateFor({ ...base, status: "IN_PROGRESS", firstResponseAt: ny("2026-09-08T11:00:00") }, ny("2026-09-09T09:00:00"));
    expect(s.firstResponse).toBe("met");
    expect(s.resolution).toBe("ok");
    expect(s.label).toMatch(/^Resolve in/);
  });
  it("paused while waiting on the customer", () => {
    const s = slaStateFor({ ...base, status: "WAITING_ON_CUSTOMER", slaPausedAt: ny("2026-09-08T12:00:00") }, ny("2026-09-09T12:00:00"));
    expect(s.firstResponse).toBe("paused");
    expect(s.label).toMatch(/paused/i);
  });
  it("BLOCKED keeps the clock running: an overdue resolution target is breached, not met or paused", () => {
    const s = slaStateFor({ ...base, status: "BLOCKED", firstResponseAt: ny("2026-09-08T11:00:00") }, ny("2026-09-11T09:00:00"));
    expect(s.resolution).toBe("breached");
    expect(s.firstResponse).toBe("met");
    expect(s.label).toMatch(/overdue/i);
    // Still inside the window: ordinary "ok", never "paused".
    expect(slaStateFor({ ...base, status: "BLOCKED" }, ny("2026-09-08T10:00:00")).firstResponse).toBe("ok");
  });
  it("closed cases carry no live label", () => {
    expect(slaStateFor({ ...base, status: "CLOSED", resolvedAt: ny("2026-09-09T09:00:00") }, ny("2026-09-12T09:00:00")).label).toBe("");
  });
});

describe("clockPatchForStatus", () => {
  const existing = { status: "IN_PROGRESS", slaPausedAt: null as Date | null, firstResponseAt: null as Date | null, firstResponseDueAt: ny("2026-09-08T17:00:00"), resolutionDueAt: ny("2026-09-10T17:00:00") };
  it("pauses on WAITING_ON_CUSTOMER", () => {
    const p = clockPatchForStatus(existing, "WAITING_ON_CUSTOMER", ny("2026-09-08T12:00:00"));
    expect(p.slaPausedAt).toEqual(ny("2026-09-08T12:00:00"));
  });
  it("resumes and shifts the unmet due dates by the paused duration", () => {
    const paused = { ...existing, status: "WAITING_ON_CUSTOMER", slaPausedAt: ny("2026-09-08T12:00:00") };
    const p = clockPatchForStatus(paused, "IN_PROGRESS", ny("2026-09-08T14:00:00"));
    expect(p.slaPausedAt).toBeNull();
    expect(p.firstResponseDueAt).toEqual(ny("2026-09-08T19:00:00"));
    expect(p.resolutionDueAt).toEqual(ny("2026-09-10T19:00:00"));
  });
  it("WAITING_ON_CUSTOMER → BLOCKED resumes the clock and shifts the unmet due dates", () => {
    const paused = { ...existing, status: "WAITING_ON_CUSTOMER", slaPausedAt: ny("2026-09-08T12:00:00") };
    const p = clockPatchForStatus(paused, "BLOCKED", ny("2026-09-08T14:00:00"));
    expect(p.slaPausedAt).toBeNull();
    expect(p.firstResponseDueAt).toEqual(ny("2026-09-08T19:00:00"));
    expect(p.resolutionDueAt).toEqual(ny("2026-09-10T19:00:00"));
    // Entering BLOCKED from a running status never pauses.
    expect(clockPatchForStatus(existing, "BLOCKED", ny("2026-09-08T12:00:00"))).toEqual({});
  });
  it("does not move a first-response target that was already met", () => {
    const paused = { ...existing, status: "WAITING_ON_CUSTOMER", slaPausedAt: ny("2026-09-08T12:00:00"), firstResponseAt: ny("2026-09-08T10:00:00") };
    const p = clockPatchForStatus(paused, "IN_PROGRESS", ny("2026-09-08T14:00:00"));
    expect(p.firstResponseDueAt).toBeUndefined();
    expect(p.resolutionDueAt).toEqual(ny("2026-09-10T19:00:00"));
  });
});
