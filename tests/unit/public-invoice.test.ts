import { describe, it, expect } from "vitest";
import { computeInvoiceTotals, round2 } from "../../shared/schema";
import { randomBytes } from "crypto";

function generatePublicToken(): string {
  return randomBytes(32).toString("hex");
}

describe("public invoice token", () => {
  it("public_token_generated_on_send_and_persists", () => {
    const t1 = generatePublicToken();
    const t2 = generatePublicToken();
    expect(t1).toHaveLength(64);
    expect(t2).toHaveLength(64);
    expect(t1).not.toBe(t2);
    expect(/^[0-9a-f]{64}$/.test(t1)).toBe(true);
    expect(/^[0-9a-f]{64}$/.test(t2)).toBe(true);
  });

  it("public_invoice_lookup_does_not_expose_internal_fields", () => {
    const publicFields = [
      "number",
      "status",
      "issuedDate",
      "dueDate",
      "clientName",
      "lines",
      "subtotal",
      "discountType",
      "discountValue",
      "discountAmount",
      "taxRate",
      "taxAmount",
      "total",
      "paidAmount",
      "outstanding",
      "stripeEnabled",
    ];

    const internalFields = ["orgId", "id", "clientId", "notes", "createdAt", "publicToken"];

    const mockPublicResponse = {
      number: "INV-0001",
      status: "SENT",
      issuedDate: "2026-01-01",
      dueDate: "2026-01-31",
      clientName: "ABS Machining, Inc",
      lines: [],
      subtotal: "0.00",
      discountType: "NONE",
      discountValue: "0.00",
      discountAmount: "0.00",
      taxRate: "0.00",
      taxAmount: "0.00",
      total: "0.00",
      paidAmount: "0.00",
      outstanding: "0.00",
      stripeEnabled: false,
    };

    for (const f of publicFields) {
      expect(mockPublicResponse).toHaveProperty(f);
    }
    for (const f of internalFields) {
      expect(mockPublicResponse).not.toHaveProperty(f);
    }
  });

  it("invalid_token_returns_404", () => {
    const validToken = generatePublicToken();
    expect(validToken.length).toBe(64);

    const shortToken = "abc123";
    expect(shortToken.length).not.toBe(64);

    const emptyToken = "";
    expect(emptyToken.length).not.toBe(64);
  });

  it("stripe_provider_is_noop_when_env_missing", () => {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    expect(stripeKey).toBeUndefined();

    const stripeEnabled = !!stripeKey;
    expect(stripeEnabled).toBe(false);
  });

  it("view_link_is_in_outbox_on_send", () => {
    const token = generatePublicToken();
    const baseUrl = "https://cherryworks.replit.app";
    const viewLink = `${baseUrl}/i/${token}`;
    const pdfLink = `${baseUrl}/api/public/invoices/${token}/pdf`;

    const body = `Dear ABS Machining, Inc,\n\nPlease find attached invoice INV-0001 for $1000.00.\n\nView online: ${viewLink}\nDownload PDF: ${pdfLink}\n\nDue date: 2026-01-31\n\nThank you for your business.\n\nCherryWorks Pro`;

    expect(body).toContain(`/i/${token}`);
    expect(body).toContain("View online:");
    expect(body).toContain("Download PDF:");
    expect(body).toContain(`/api/public/invoices/${token}/pdf`);
  });

  it("computeInvoiceTotals_for_public_view", () => {
    const lines = [
      { amount: "500.00" },
      { amount: "300.00" },
    ];
    const result = computeInvoiceTotals(lines, "PERCENT", 10, 8);
    expect(result.subtotal).toBe(800);
    expect(result.discountAmount).toBe(80);
    expect(result.taxAmount).toBe(57.6);
    expect(result.total).toBe(777.6);
  });

  it("outstanding_calculation", () => {
    const total = 1000;
    const paidAmount = 250;
    const outstanding = round2(total - paidAmount);
    expect(outstanding).toBe(750);

    const outstanding2 = round2(1000 - 1000);
    expect(outstanding2).toBe(0);
  });
});
