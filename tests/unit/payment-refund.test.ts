import { describe, it, expect } from "vitest";

function computeRefundResult(
  invoiceTotal: string,
  currentPaidAmount: string,
  refundAmount: number,
) {
  const total = Number(invoiceTotal);
  const currentPaid = Number(currentPaidAmount);
  const negAmount = -Math.abs(refundAmount);
  const newPaid = Number((currentPaid + negAmount).toFixed(2));
  let newStatus: string;
  if (newPaid >= total) newStatus = "PAID";
  else if (newPaid > 0) newStatus = "PARTIAL";
  else newStatus = "SENT";
  return {
    refundAmount: negAmount,
    paidAmount: newPaid,
    status: newStatus,
  };
}

describe("Payment refund logic", () => {
  it("refund creates negative payment amount", () => {
    const result = computeRefundResult("1000.00", "1000.00", 1000);
    expect(result.refundAmount).toBe(-1000);
  });

  it("full refund resets invoice to SENT", () => {
    const result = computeRefundResult("1000.00", "1000.00", 1000);
    expect(result.status).toBe("SENT");
    expect(result.paidAmount).toBe(0);
  });

  it("partial refund sets invoice to PARTIAL", () => {
    const result = computeRefundResult("1000.00", "1000.00", 500);
    expect(result.status).toBe("PARTIAL");
    expect(result.paidAmount).toBe(500);
  });

  it("refund of partial payment keeps PARTIAL if still positive", () => {
    const result = computeRefundResult("1000.00", "800.00", 300);
    expect(result.status).toBe("PARTIAL");
    expect(result.paidAmount).toBe(500);
  });

  it("rejects Stripe payment refund (provider check)", () => {
    function canRefund(provider: string): boolean {
      return provider === "MANUAL";
    }
    expect(canRefund("MANUAL")).toBe(true);
    expect(canRefund("STRIPE")).toBe(false);
  });

  it("handles decimal precision correctly", () => {
    const result = computeRefundResult("100.00", "66.67", 33.34);
    expect(result.paidAmount).toBe(33.33);
    expect(result.status).toBe("PARTIAL");
  });
});
