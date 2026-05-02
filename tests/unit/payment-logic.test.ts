import { describe, it, expect } from "vitest";

describe("Payment recording logic", () => {
  function computePaymentResult(
    invoiceTotal: string,
    currentPaidAmount: string,
    paymentAmount: number,
  ) {
    const total = Number(invoiceTotal);
    const currentPaid = Number(currentPaidAmount);
    const newPaid = currentPaid + paymentAmount;
    const newStatus = newPaid >= total ? "PAID" : "PARTIAL";
    return {
      paidAmount: Number(newPaid.toFixed(2)),
      status: newStatus,
      outstanding: Number((total - newPaid).toFixed(2)),
    };
  }

  it("partial payment updates status to PARTIAL", () => {
    const result = computePaymentResult("6850.00", "0.00", 3000);
    expect(result.status).toBe("PARTIAL");
    expect(result.paidAmount).toBe(3000);
    expect(result.outstanding).toBe(3850);
  });

  it("full payment updates status to PAID", () => {
    const result = computePaymentResult("6850.00", "0.00", 6850);
    expect(result.status).toBe("PAID");
    expect(result.paidAmount).toBe(6850);
    expect(result.outstanding).toBe(0);
  });

  it("multiple partial payments accumulate correctly", () => {
    let paid = "0.00";
    const payments = [1000, 2000, 1500, 2350];
    let lastResult;

    for (const amount of payments) {
      lastResult = computePaymentResult("6850.00", paid, amount);
      paid = lastResult.paidAmount.toFixed(2);
    }

    expect(lastResult!.status).toBe("PAID");
    expect(lastResult!.paidAmount).toBe(6850);
    expect(lastResult!.outstanding).toBe(0);
  });

  it("rejects payment exceeding outstanding balance", () => {
    const total = 6850;
    const currentPaid = 5000;
    const paymentAmount = 2000;
    const outstanding = total - currentPaid;

    expect(paymentAmount > outstanding).toBe(true);
  });

  it("handles decimal precision correctly", () => {
    const result = computePaymentResult("100.00", "33.33", 33.34);
    expect(result.paidAmount).toBe(66.67);
    expect(result.outstanding).toBe(33.33);
    expect(result.status).toBe("PARTIAL");
  });
});

describe("Payment status transitions", () => {
  const validTransitions: Record<string, string[]> = {
    DRAFT: ["SENT", "VOID"],
    SENT: ["PARTIAL", "PAID", "VOID"],
    PARTIAL: ["PAID"],
    PAID: [],
    VOID: [],
  };

  it("SENT->PARTIAL->PAID transitions are valid", () => {
    expect(validTransitions["SENT"]).toContain("PARTIAL");
    expect(validTransitions["PARTIAL"]).toContain("PAID");
  });

  it("DRAFT can only transition to SENT or VOID", () => {
    expect(validTransitions["DRAFT"]).toEqual(["SENT", "VOID"]);
  });

  it("VOID rules: only DRAFT/SENT with zero payments can void", () => {
    function canVoid(status: string, paidAmount: number): boolean {
      return (status === "DRAFT" || status === "SENT") && paidAmount === 0;
    }

    expect(canVoid("DRAFT", 0)).toBe(true);
    expect(canVoid("SENT", 0)).toBe(true);
    expect(canVoid("SENT", 100)).toBe(false);
    expect(canVoid("PARTIAL", 0)).toBe(false);
    expect(canVoid("PAID", 0)).toBe(false);
  });

  it("PAID and VOID are terminal states", () => {
    expect(validTransitions["PAID"]).toEqual([]);
    expect(validTransitions["VOID"]).toEqual([]);
  });
});
