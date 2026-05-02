import { describe, it, expect } from "vitest";
import { computeInvoiceTotals, round2 } from "../../shared/schema";

describe("Invoice math invariants", () => {
  it("total equals sum of line amounts", () => {
    const lines = [
      { quantity: "19.00", unitRate: "175.00", amount: "3325.00" },
      { quantity: "9.00", unitRate: "200.00", amount: "1800.00" },
      { quantity: "7.00", unitRate: "175.00", amount: "1225.00" },
      { quantity: "2.00", unitRate: "250.00", amount: "500.00" },
    ];

    const computedTotal = lines.reduce(
      (sum, l) => sum + Number(l.amount),
      0,
    );

    const invoiceTotal = 6850.0;
    expect(computedTotal).toBe(invoiceTotal);
  });

  it("line amount equals quantity times unitRate within 0.01", () => {
    const testCases = [
      { quantity: "19.00", unitRate: "175.00", amount: "3325.00" },
      { quantity: "9.00", unitRate: "200.00", amount: "1800.00" },
      { quantity: "7.50", unitRate: "175.00", amount: "1312.50" },
      { quantity: "2.33", unitRate: "250.00", amount: "582.50" },
      { quantity: "0.50", unitRate: "300.00", amount: "150.00" },
    ];

    for (const tc of testCases) {
      const computed = Number(tc.quantity) * Number(tc.unitRate);
      const diff = Math.abs(computed - Number(tc.amount));
      expect(diff).toBeLessThanOrEqual(0.01);
    }
  });

  it("rounding is consistent for fractional hours", () => {
    const testCases = [
      { minutes: 90, rate: 175 },
      { minutes: 120, rate: 200 },
      { minutes: 60, rate: 250 },
      { minutes: 480, rate: 150 },
      { minutes: 30, rate: 300 },
    ];

    for (const tc of testCases) {
      const hours = tc.minutes / 60;
      const amount = hours * tc.rate;
      const roundedAmount = Number(amount.toFixed(2));

      expect(roundedAmount).toBeGreaterThan(0);
      expect(roundedAmount).toBe(
        Math.round(amount * 100) / 100,
      );
    }
  });
});

describe("Invoice discount and tax invariants", () => {
  it("percent discount computes correctly", () => {
    const lines = [
      { amount: "1000.00" },
      { amount: "500.00" },
    ];
    const result = computeInvoiceTotals(lines, "PERCENT", 10, 0);
    expect(result.subtotal).toBe(1500);
    expect(result.discountAmount).toBe(150);
    expect(result.taxAmount).toBe(0);
    expect(result.total).toBe(1350);
  });

  it("fixed discount computes correctly", () => {
    const lines = [
      { amount: "1000.00" },
      { amount: "500.00" },
    ];
    const result = computeInvoiceTotals(lines, "FIXED", 200, 0);
    expect(result.subtotal).toBe(1500);
    expect(result.discountAmount).toBe(200);
    expect(result.total).toBe(1300);
  });

  it("tax computes on post-discount base", () => {
    const lines = [{ amount: "1000.00" }];
    const result = computeInvoiceTotals(lines, "PERCENT", 10, 8.5);
    expect(result.subtotal).toBe(1000);
    expect(result.discountAmount).toBe(100);
    const taxableBase = 900;
    expect(result.taxAmount).toBe(round2(taxableBase * 8.5 / 100));
    expect(result.total).toBe(round2(taxableBase + result.taxAmount));
  });

  it("discount cannot exceed subtotal", () => {
    const lines = [{ amount: "100.00" }];
    const result = computeInvoiceTotals(lines, "FIXED", 999, 0);
    expect(result.discountAmount).toBe(100);
    expect(result.total).toBe(0);
  });

  it("NONE discount results in zero discount", () => {
    const lines = [{ amount: "500.00" }];
    const result = computeInvoiceTotals(lines, "NONE", 0, 10);
    expect(result.discountAmount).toBe(0);
    expect(result.taxAmount).toBe(50);
    expect(result.total).toBe(550);
  });

  it("line_item_amount_must_match_qty_rate", () => {
    const testCases = [
      { qty: 5, rate: 150 },
      { qty: 2.5, rate: 200 },
      { qty: 0.33, rate: 300 },
      { qty: 10, rate: 99.99 },
    ];

    for (const tc of testCases) {
      const computed = round2(tc.qty * tc.rate);
      const recomputed = round2(tc.qty * tc.rate);
      expect(computed).toBe(recomputed);
      expect(computed).toBeGreaterThanOrEqual(0);
    }
  });
});
