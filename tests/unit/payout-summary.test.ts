import { describe, it, expect } from "vitest";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface TimeEntry {
  id: string;
  minutes: number;
  projectId: string;
  userId: string;
  billable: boolean;
}

interface PayoutAgg {
  completedTotal: number;
  pendingTotal: number;
  lastDate: string | null;
}

function computePayoutSummary(
  entries: TimeEntry[],
  paidEntryIds: Set<string>,
  costRateByProject: Record<string, number>,
  payoutAgg: PayoutAgg,
) {
  const totalMinutes = entries.reduce((s, e) => s + e.minutes, 0);
  const paidMinutes = entries.filter(e => paidEntryIds.has(e.id)).reduce((s, e) => s + e.minutes, 0);
  const unpaidMinutes = totalMinutes - paidMinutes;

  const unpaidEntries = entries.filter(e => !paidEntryIds.has(e.id));
  let unpaidTimeValue = 0;
  for (const e of unpaidEntries) {
    const rate = costRateByProject[e.projectId] || 0;
    unpaidTimeValue += (e.minutes / 60) * rate;
  }

  return {
    totalHours: round2(totalMinutes / 60),
    paidHours: round2(paidMinutes / 60),
    unpaidHours: round2(unpaidMinutes / 60),
    unpaidTimeValue: round2(unpaidTimeValue),
    pendingPayoutAmount: round2(payoutAgg.pendingTotal),
    amountOwed: round2(unpaidTimeValue + payoutAgg.pendingTotal),
    totalPaidOut: payoutAgg.completedTotal,
  };
}

describe("payout summary math", () => {
  it("separates unpaid time value from pending payouts correctly", () => {
    const entries: TimeEntry[] = [
      { id: "te-1", minutes: 60, projectId: "p1", userId: "u1", billable: true },
      { id: "te-2", minutes: 60, projectId: "p1", userId: "u1", billable: true },
      { id: "te-3", minutes: 60, projectId: "p1", userId: "u1", billable: true },
      { id: "te-4", minutes: 60, projectId: "p1", userId: "u1", billable: true },
    ];
    const paidEntryIds = new Set<string>();
    const costRateByProject = { p1: 50 };
    const payoutAgg: PayoutAgg = { completedTotal: 500, pendingTotal: 1000, lastDate: "2026-01-01" };

    const result = computePayoutSummary(entries, paidEntryIds, costRateByProject, payoutAgg);

    expect(result.unpaidHours).toBe(4);
    expect(result.unpaidTimeValue).toBe(200);
    expect(result.pendingPayoutAmount).toBe(1000);
    expect(result.amountOwed).toBe(1200);
    expect(result.totalPaidOut).toBe(500);
  });

  it("excludes paid entries from unpaid time value", () => {
    const entries: TimeEntry[] = [
      { id: "te-1", minutes: 120, projectId: "p1", userId: "u1", billable: true },
      { id: "te-2", minutes: 60, projectId: "p1", userId: "u1", billable: true },
    ];
    const paidEntryIds = new Set(["te-1"]);
    const costRateByProject = { p1: 75 };
    const payoutAgg: PayoutAgg = { completedTotal: 150, pendingTotal: 0, lastDate: null };

    const result = computePayoutSummary(entries, paidEntryIds, costRateByProject, payoutAgg);

    expect(result.unpaidHours).toBe(1);
    expect(result.unpaidTimeValue).toBe(75);
    expect(result.pendingPayoutAmount).toBe(0);
    expect(result.amountOwed).toBe(75);
    expect(result.paidHours).toBe(2);
  });

  it("handles zero entries with pending payouts", () => {
    const entries: TimeEntry[] = [];
    const paidEntryIds = new Set<string>();
    const costRateByProject = {};
    const payoutAgg: PayoutAgg = { completedTotal: 0, pendingTotal: 500, lastDate: null };

    const result = computePayoutSummary(entries, paidEntryIds, costRateByProject, payoutAgg);

    expect(result.unpaidHours).toBe(0);
    expect(result.unpaidTimeValue).toBe(0);
    expect(result.pendingPayoutAmount).toBe(500);
    expect(result.amountOwed).toBe(500);
  });

  it("handles entries with no cost rate (0 owed for unlinked projects)", () => {
    const entries: TimeEntry[] = [
      { id: "te-1", minutes: 60, projectId: "p-unknown", userId: "u1", billable: true },
    ];
    const paidEntryIds = new Set<string>();
    const costRateByProject = {};
    const payoutAgg: PayoutAgg = { completedTotal: 0, pendingTotal: 0, lastDate: null };

    const result = computePayoutSummary(entries, paidEntryIds, costRateByProject, payoutAgg);

    expect(result.unpaidHours).toBe(1);
    expect(result.unpaidTimeValue).toBe(0);
    expect(result.amountOwed).toBe(0);
  });

  it("aggregates across multiple teamMembers correctly", () => {
    const summaries = [
      computePayoutSummary(
        [{ id: "te-1", minutes: 240, projectId: "p1", userId: "u1", billable: true }],
        new Set<string>(),
        { p1: 50 },
        { completedTotal: 0, pendingTotal: 1000, lastDate: null },
      ),
      computePayoutSummary(
        [{ id: "te-2", minutes: 120, projectId: "p2", userId: "u2", billable: true }],
        new Set<string>(),
        { p2: 100 },
        { completedTotal: 300, pendingTotal: 0, lastDate: "2026-01-01" },
      ),
    ];

    const totalUnpaidTimeValue = summaries.reduce((s, c) => s + c.unpaidTimeValue, 0);
    const totalPendingPayoutAmount = summaries.reduce((s, c) => s + c.pendingPayoutAmount, 0);
    const totalOwed = totalUnpaidTimeValue + totalPendingPayoutAmount;

    expect(totalUnpaidTimeValue).toBe(400);
    expect(totalPendingPayoutAmount).toBe(1000);
    expect(totalOwed).toBe(1400);
  });
});
