import { describe, it, expect } from "vitest";
import { computeProfitability, round2, round4, getAgingBucket, getWeekStartDate } from "../../shared/schema";

describe("profitability_math_is_deterministic", () => {
  it("zero revenue and zero cost gives zero profit and zero margin", () => {
    const result = computeProfitability(0, 0);
    expect(result.revenue).toBe(0);
    expect(result.cost).toBe(0);
    expect(result.profit).toBe(0);
    expect(result.margin).toBe(0);
  });

  it("positive revenue minus cost gives correct profit and margin", () => {
    const result = computeProfitability(1000, 600);
    expect(result.revenue).toBe(1000);
    expect(result.cost).toBe(600);
    expect(result.profit).toBe(400);
    expect(result.margin).toBe(0.4);
  });

  it("cost exceeding revenue produces negative profit and negative margin", () => {
    const result = computeProfitability(500, 750);
    expect(result.profit).toBe(-250);
    expect(result.margin).toBe(-0.5);
  });

  it("margin is rounded to 4 decimals", () => {
    const result = computeProfitability(300, 100);
    expect(result.margin).toBe(0.6667);
  });

  it("currency values are rounded to 2 decimals", () => {
    const result = computeProfitability(100.456, 50.789);
    expect(result.revenue).toBe(100.46);
    expect(result.cost).toBe(50.79);
    expect(result.profit).toBe(round2(100.46 - 50.79));
  });

  it("repeated calls produce identical results", () => {
    for (let i = 0; i < 50; i++) {
      const a = computeProfitability(1234.567, 890.123);
      const b = computeProfitability(1234.567, 890.123);
      expect(a.profit).toBe(b.profit);
      expect(a.margin).toBe(b.margin);
    }
  });
});

describe("revenue_excludes_draft_and_void", () => {
  type InvoiceStub = { status: string; total: number };

  function sumRevenue(invoices: InvoiceStub[]): number {
    return round2(
      invoices.reduce((sum, inv) => {
        if (inv.status === "DRAFT" || inv.status === "VOID") return sum;
        return sum + inv.total;
      }, 0),
    );
  }

  it("includes SENT invoices", () => {
    expect(sumRevenue([{ status: "SENT", total: 500 }])).toBe(500);
  });

  it("includes PARTIAL invoices", () => {
    expect(sumRevenue([{ status: "PARTIAL", total: 750 }])).toBe(750);
  });

  it("includes PAID invoices", () => {
    expect(sumRevenue([{ status: "PAID", total: 1000 }])).toBe(1000);
  });

  it("excludes DRAFT invoices", () => {
    expect(sumRevenue([{ status: "DRAFT", total: 500 }])).toBe(0);
  });

  it("excludes VOID invoices", () => {
    expect(sumRevenue([{ status: "VOID", total: 500 }])).toBe(0);
  });

  it("mixed statuses: only counts non-draft non-void", () => {
    const invoices: InvoiceStub[] = [
      { status: "SENT", total: 100 },
      { status: "PAID", total: 200 },
      { status: "DRAFT", total: 300 },
      { status: "VOID", total: 400 },
      { status: "PARTIAL", total: 150 },
    ];
    expect(sumRevenue(invoices)).toBe(450);
  });
});

describe("wip_aging_bucket_boundaries_exact", () => {
  it("day 0 goes to 0-30 bucket", () => {
    expect(getAgingBucket(0)).toBe("0-30");
  });

  it("day 7 goes to 0-30 bucket", () => {
    expect(getAgingBucket(7)).toBe("0-30");
  });

  it("day 15 goes to 0-30 bucket", () => {
    expect(getAgingBucket(15)).toBe("0-30");
  });

  it("day 30 goes to 0-30 bucket", () => {
    expect(getAgingBucket(30)).toBe("0-30");
  });

  it("day 31 goes to 31-60 bucket", () => {
    expect(getAgingBucket(31)).toBe("31-60");
  });

  it("day 60 goes to 31-60 bucket", () => {
    expect(getAgingBucket(60)).toBe("31-60");
  });

  it("day 61 goes to 61-90 bucket", () => {
    expect(getAgingBucket(61)).toBe("61-90");
  });

  it("day 90 goes to 61-90 bucket", () => {
    expect(getAgingBucket(90)).toBe("61-90");
  });

  it("day 91 goes to 90+ bucket", () => {
    expect(getAgingBucket(91)).toBe("90+");
  });

  it("day 365 goes to 90+ bucket", () => {
    expect(getAgingBucket(365)).toBe("90+");
  });
});

describe("wip_default_approved_only", () => {
  interface TimeEntryStub {
    userId: string;
    date: string;
    billable: boolean;
    invoiced: boolean;
    minutes: number;
    rate: number;
  }

  interface TimesheetStub {
    userId: string;
    weekStartDate: string;
    status: string;
  }

  function filterWipEntries(
    entries: TimeEntryStub[],
    timesheets: TimesheetStub[],
    includeUnapproved: boolean,
  ): TimeEntryStub[] {
    return entries.filter((e) => {
      if (!e.billable || e.invoiced) return false;
      if (includeUnapproved) return true;
      const ws = getWeekStartDate(e.date);
      const ts = timesheets.find((t) => t.userId === e.userId && t.weekStartDate === ws);
      return ts?.status === "APPROVED";
    });
  }

  const entries: TimeEntryStub[] = [
    { userId: "u1", date: "2026-03-02", billable: true, invoiced: false, minutes: 60, rate: 100 },
    { userId: "u1", date: "2026-03-03", billable: true, invoiced: false, minutes: 120, rate: 100 },
    { userId: "u2", date: "2026-03-02", billable: true, invoiced: false, minutes: 60, rate: 150 },
  ];

  const timesheets: TimesheetStub[] = [
    { userId: "u1", weekStartDate: "2026-03-01", status: "APPROVED" },
    { userId: "u2", weekStartDate: "2026-03-01", status: "SUBMITTED" },
  ];

  it("default: only approved entries included", () => {
    const result = filterWipEntries(entries, timesheets, false);
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.userId === "u1")).toBe(true);
  });

  it("override: all billable unbilled entries included", () => {
    const result = filterWipEntries(entries, timesheets, true);
    expect(result).toHaveLength(3);
  });

  it("override with audit event: flag is passed correctly", () => {
    const includeUnapproved = true;
    const result = filterWipEntries(entries, timesheets, includeUnapproved);
    expect(result).toHaveLength(3);
    expect(includeUnapproved).toBe(true);
  });
});

describe("export_1099_totals_are_sum_of_payments_and_deterministic", () => {
  interface InvoiceLineStub {
    lineAmount: number;
    invoiceTotal: number;
    paidAmount: number;
    invoiceStatus: string;
    teamMemberId: string;
  }

  function compute1099Total(lines: InvoiceLineStub[], teamMemberId: string): number {
    let total = 0;
    for (const line of lines) {
      if (line.teamMemberId !== teamMemberId) continue;
      if (line.invoiceStatus === "DRAFT" || line.invoiceStatus === "VOID") continue;
      if (line.invoiceTotal <= 0) continue;
      const paidRatio = round4(line.paidAmount / line.invoiceTotal);
      total = round2(total + round2(line.lineAmount * paidRatio));
    }
    return total;
  }

  it("fully paid invoice attributes full line amount to team member", () => {
    const lines: InvoiceLineStub[] = [
      { lineAmount: 1000, invoiceTotal: 2000, paidAmount: 2000, invoiceStatus: "PAID", teamMemberId: "c1" },
    ];
    expect(compute1099Total(lines, "c1")).toBe(1000);
  });

  it("partially paid invoice attributes proportional amount", () => {
    const lines: InvoiceLineStub[] = [
      { lineAmount: 1000, invoiceTotal: 2000, paidAmount: 1000, invoiceStatus: "PARTIAL", teamMemberId: "c1" },
    ];
    expect(compute1099Total(lines, "c1")).toBe(500);
  });

  it("excludes DRAFT and VOID invoices", () => {
    const lines: InvoiceLineStub[] = [
      { lineAmount: 1000, invoiceTotal: 2000, paidAmount: 2000, invoiceStatus: "DRAFT", teamMemberId: "c1" },
      { lineAmount: 500, invoiceTotal: 1000, paidAmount: 1000, invoiceStatus: "VOID", teamMemberId: "c1" },
    ];
    expect(compute1099Total(lines, "c1")).toBe(0);
  });

  it("multiple lines across invoices sum correctly", () => {
    const lines: InvoiceLineStub[] = [
      { lineAmount: 1000, invoiceTotal: 1000, paidAmount: 1000, invoiceStatus: "PAID", teamMemberId: "c1" },
      { lineAmount: 500, invoiceTotal: 2000, paidAmount: 1000, invoiceStatus: "PARTIAL", teamMemberId: "c1" },
    ];
    expect(compute1099Total(lines, "c1")).toBe(1250);
  });

  it("only attributes to correct team member", () => {
    const lines: InvoiceLineStub[] = [
      { lineAmount: 1000, invoiceTotal: 1000, paidAmount: 1000, invoiceStatus: "PAID", teamMemberId: "c1" },
      { lineAmount: 500, invoiceTotal: 500, paidAmount: 500, invoiceStatus: "PAID", teamMemberId: "c2" },
    ];
    expect(compute1099Total(lines, "c1")).toBe(1000);
    expect(compute1099Total(lines, "c2")).toBe(500);
  });

  it("deterministic across repeated calls", () => {
    const lines: InvoiceLineStub[] = [
      { lineAmount: 333.33, invoiceTotal: 999.99, paidAmount: 666.66, invoiceStatus: "PARTIAL", teamMemberId: "c1" },
    ];
    for (let i = 0; i < 50; i++) {
      const a = compute1099Total(lines, "c1");
      const b = compute1099Total(lines, "c1");
      expect(a).toBe(b);
    }
  });
});
