import { describe, it, expect } from "vitest";

function computeRevenueChange(thisMonthRevenue: number, lastMonthSamePeriodRevenue: number): { change: number | null; label: string } {
  if (lastMonthSamePeriodRevenue === 0) {
    return { change: null, label: "— no data for same period last month" };
  }
  const change = Math.round(((thisMonthRevenue - lastMonthSamePeriodRevenue) / lastMonthSamePeriodRevenue) * 10000) / 100;
  return { change, label: `vs same period last month` };
}

function getSameDayLastMonth(now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
  return d.toISOString().split("T")[0];
}

describe("revenue comparison — same period last month", () => {
  it("compares Apr 1-6 with Mar 1-6 (not full March)", () => {
    const now = new Date(2026, 3, 6);
    const sameDayLast = getSameDayLastMonth(now);
    expect(sameDayLast).toBe("2026-03-06");
  });

  it("returns em-dash when prior period revenue is zero", () => {
    const result = computeRevenueChange(93.19, 0);
    expect(result.change).toBeNull();
    expect(result.label).toContain("no data");
  });

  it("computes positive change correctly", () => {
    const result = computeRevenueChange(200, 100);
    expect(result.change).toBe(100);
    expect(result.label).toContain("same period");
  });

  it("computes negative change correctly", () => {
    const result = computeRevenueChange(50, 200);
    expect(result.change).toBe(-75);
    expect(result.label).toContain("same period");
  });

  it("returns 0 change when both are equal", () => {
    const result = computeRevenueChange(100, 100);
    expect(result.change).toBe(0);
  });

  it("handles Jan by wrapping to Dec of previous year", () => {
    const now = new Date(2026, 0, 15);
    const sameDayLast = getSameDayLastMonth(now);
    expect(sameDayLast).toBe("2025-12-15");
  });
});
