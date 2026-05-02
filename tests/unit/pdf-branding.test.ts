import { describe, it, expect } from "vitest";
import { generateInvoicePdf } from "../../server/pdf";
import type { OrgBranding } from "../../server/pdf";

const mockInvoice = {
  id: "inv-1",
  number: "INV-0001",
  status: "SENT",
  issuedDate: "2026-01-15",
  dueDate: "2026-02-14",
  subtotal: "1000.00",
  discountType: "NONE",
  discountValue: "0",
  discountAmount: "0",
  taxRate: "0",
  taxAmount: "0",
  total: "1000.00",
  paidAmount: "0",
  notes: null,
  clientName: "Test Client",
  clientEmail: "client@test.com",
  lines: [
    { id: "l1", invoiceId: "inv-1", description: "Consulting", quantity: "10", unitRate: "100.00", amount: "1000.00" },
  ],
};

const mockOrg: OrgBranding = {
  name: "CherryWorks Pro",
  address: "222 Commerce Street, Suite 400, Dallas TX 75201",
  phone: "(214) 555-0142",
  email: "billing@cherrystconsulting.com",
  website: "https://cherrystconsulting.com",
};

describe("PDF Branding", () => {
  it("generates a valid PDF buffer with org branding", async () => {
    const buf = await generateInvoicePdf(mockInvoice, mockOrg);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("generates PDF without org (fallback to CherryWorks Pro)", async () => {
    const buf = await generateInvoicePdf(mockInvoice);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(500);
  });

  it("generates PDF for PAID status", async () => {
    const paidInvoice = { ...mockInvoice, status: "PAID", paidAmount: "1000.00" };
    const buf = await generateInvoicePdf(paidInvoice, mockOrg);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(500);
  });

  it("generates PDF for VOID status", async () => {
    const voidInvoice = { ...mockInvoice, status: "VOID" };
    const buf = await generateInvoicePdf(voidInvoice, mockOrg);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(500);
  });

  it("generates PDF for SENT status (no watermark)", async () => {
    const buf = await generateInvoicePdf(mockInvoice, mockOrg);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(500);
  });

  it("handles invoices with discount and tax", async () => {
    const discountInvoice = {
      ...mockInvoice,
      discountType: "PERCENT",
      discountValue: "10",
      discountAmount: "100.00",
      taxRate: "8.25",
      taxAmount: "74.25",
      total: "974.25",
    };
    const buf = await generateInvoicePdf(discountInvoice, mockOrg);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(500);
  });

  it("handles invoices with partial payment (balance due)", async () => {
    const partialInvoice = { ...mockInvoice, paidAmount: "500.00" };
    const buf = await generateInvoicePdf(partialInvoice, mockOrg);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(500);
  });

  it("handles invoices with notes", async () => {
    const notesInvoice = { ...mockInvoice, notes: "Please pay within 30 days" };
    const buf = await generateInvoicePdf(notesInvoice, mockOrg);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(500);
  });

  it("handles invoices with many line items", async () => {
    const manyLines = Array.from({ length: 50 }, (_, i) => ({
      id: `l${i}`,
      invoiceId: "inv-1",
      description: `Service item ${i + 1}`,
      quantity: "2",
      unitRate: "50.00",
      amount: "100.00",
    }));
    const bigInvoice = { ...mockInvoice, lines: manyLines, subtotal: "5000.00", total: "5000.00" };
    const buf = await generateInvoicePdf(bigInvoice, mockOrg);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(1000);
  });
});
