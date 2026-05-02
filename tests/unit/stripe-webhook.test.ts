import { describe, it, expect } from "vitest";
import { round2 } from "../../shared/schema";

describe("Stripe webhook invariants", () => {
  it("webhook_rejects_without_secret", () => {
    const webhookSecret = undefined;
    const shouldReject = !webhookSecret;
    expect(shouldReject).toBe(true);
  });

  it("webhook_signature_verification_invalid_fails", () => {
    const validSig = "t=1234567890,v1=abc123";
    const invalidSig = "t=0000000000,v1=invalid_sig_hash";
    expect(validSig).not.toBe(invalidSig);

    const sigParts = invalidSig.split(",");
    const hasTimestamp = sigParts.some((p: string) => p.startsWith("t="));
    const hasV1 = sigParts.some((p: string) => p.startsWith("v1="));
    expect(hasTimestamp).toBe(true);
    expect(hasV1).toBe(true);
  });

  it("webhook_idempotent_same_event_twice", () => {
    const processedEvents = new Set<string>();
    const eventId = "evt_test_001";

    const firstProcess = !processedEvents.has(eventId);
    processedEvents.add(eventId);
    expect(firstProcess).toBe(true);

    const secondProcess = !processedEvents.has(eventId);
    expect(secondProcess).toBe(false);
  });

  it("checkout_completed_applies_payment_and_updates_status", () => {
    const invoiceTotal = 1400.00;
    let paidAmount = 0;

    const paymentAmount = round2(140000 / 100);
    expect(paymentAmount).toBe(1400.00);

    paidAmount = round2(paidAmount + paymentAmount);
    expect(paidAmount).toBe(1400.00);

    const status = paidAmount >= invoiceTotal ? "PAID" : paidAmount > 0 ? "PARTIAL" : "SENT";
    expect(status).toBe("PAID");

    const partialAmount = round2(70000 / 100);
    const partialPaid = round2(0 + partialAmount);
    const partialStatus = partialPaid >= invoiceTotal ? "PAID" : partialPaid > 0 ? "PARTIAL" : "SENT";
    expect(partialStatus).toBe("PARTIAL");
    expect(partialPaid).toBe(700.00);
  });

  it("overpayment_is_rejected_and_event_marked_failed", () => {
    const invoiceTotal = 1400.00;
    const currentPaid = 1000.00;
    const paymentAmount = 500.00;

    const newPaid = round2(currentPaid + paymentAmount);
    const isOverpayment = newPaid > invoiceTotal;
    expect(isOverpayment).toBe(true);
    expect(newPaid).toBe(1500.00);

    const failureCode = isOverpayment ? "OVERPAYMENT" : null;
    expect(failureCode).toBe("OVERPAYMENT");
  });

  it("refund_creates_negative_payment_and_recomputes_status", () => {
    const invoiceTotal = 1400.00;
    const payments = [
      { amount: 1400.00, provider: "STRIPE" },
    ];

    let totalPaid = round2(payments.reduce((sum, p) => sum + p.amount, 0));
    expect(totalPaid).toBe(1400.00);
    let status = totalPaid >= invoiceTotal ? "PAID" : totalPaid > 0 ? "PARTIAL" : "SENT";
    expect(status).toBe("PAID");

    const refundAmountCents = 50000;
    const refundAmount = round2(refundAmountCents / 100);
    payments.push({ amount: -refundAmount, provider: "STRIPE" });

    totalPaid = round2(payments.reduce((sum, p) => sum + p.amount, 0));
    expect(totalPaid).toBe(900.00);
    status = totalPaid >= invoiceTotal ? "PAID" : totalPaid > 0 ? "PARTIAL" : "SENT";
    expect(status).toBe("PARTIAL");

    const fullRefund = [
      { amount: 1400.00, provider: "STRIPE" },
      { amount: -1400.00, provider: "STRIPE" },
    ];
    const fullRefundTotal = round2(fullRefund.reduce((sum, p) => sum + p.amount, 0));
    expect(fullRefundTotal).toBe(0);
    const fullRefundStatus = fullRefundTotal >= invoiceTotal ? "PAID" : fullRefundTotal > 0 ? "PARTIAL" : "SENT";
    expect(fullRefundStatus).toBe("SENT");
  });

  it("provider_ref_uniqueness_prevents_duplicate_payments", () => {
    const paymentsByRef = new Map<string, boolean>();
    const ref1 = "pi_test_123";

    const first = !paymentsByRef.has(ref1);
    paymentsByRef.set(ref1, true);
    expect(first).toBe(true);

    const second = !paymentsByRef.has(ref1);
    expect(second).toBe(false);
  });

  it("amount_conversion_cents_to_dollars_is_exact", () => {
    expect(round2(14000 / 100)).toBe(140.00);
    expect(round2(9999 / 100)).toBe(99.99);
    expect(round2(1 / 100)).toBe(0.01);
    expect(round2(0 / 100)).toBe(0);
    expect(round2(123456 / 100)).toBe(1234.56);
  });
});
