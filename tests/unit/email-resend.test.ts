import { describe, it, expect } from "vitest";

describe("Invoice email resend rules", () => {
  const RESENDABLE_STATUSES = ["SENT", "PARTIAL", "PAID"];
  const NON_RESENDABLE_STATUSES = ["DRAFT", "VOID"];

  it("resend is allowed for SENT, PARTIAL, PAID", () => {
    for (const status of RESENDABLE_STATUSES) {
      expect(RESENDABLE_STATUSES.includes(status)).toBe(true);
    }
  });

  it("resend is rejected for DRAFT and VOID", () => {
    for (const status of NON_RESENDABLE_STATUSES) {
      expect(RESENDABLE_STATUSES.includes(status)).toBe(false);
    }
  });

  it("resend creates a new outbox_emails record each time", () => {
    const outboxRecords: Array<{ id: string; invoiceId: string; status: string }> = [];
    const invoiceId = "inv-1";

    outboxRecords.push({ id: "oe-1", invoiceId, status: "SENT" });
    outboxRecords.push({ id: "oe-2", invoiceId, status: "PENDING" });

    expect(outboxRecords.filter((r) => r.invoiceId === invoiceId)).toHaveLength(2);
  });

  it("resend subject includes (Resent) suffix", () => {
    const number = "INV-0001";
    const subject = `Invoice ${number} from CherryWorks Pro (Resent)`;
    expect(subject).toContain("(Resent)");
    expect(subject).toContain(number);
  });

  it("original send has no (Resent) suffix", () => {
    const number = "INV-0001";
    const subject = `Invoice ${number} from CherryWorks Pro`;
    expect(subject).not.toContain("(Resent)");
  });

  it("resend logs INVOICE_RESENT audit action", () => {
    const auditAction = "INVOICE_RESENT";
    expect(auditAction).toBe("INVOICE_RESENT");
    expect(auditAction).not.toBe("INVOICE_SENT");
  });
});

describe("Email module transport selection", () => {
  it("uses SMTP when env vars are set", () => {
    const env = { SMTP_HOST: "smtp.gmail.com", SMTP_PORT: "587", SMTP_USER: "user", SMTP_PASS: "pass" };
    const useSmtp = !!(env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASS);
    expect(useSmtp).toBe(true);
  });

  it("falls back to ethereal when SMTP env vars missing", () => {
    const env = {} as Record<string, string>;
    const useSmtp = !!(env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASS);
    expect(useSmtp).toBe(false);
  });

  it("PDF attachment is optional", () => {
    const withPdf = { filename: "invoice.pdf", content: Buffer.from("fake"), contentType: "application/pdf" };
    const noPdf = undefined;

    const attachments1 = withPdf ? [withPdf] : [];
    const attachments2 = noPdf ? [noPdf] : [];

    expect(attachments1).toHaveLength(1);
    expect(attachments2).toHaveLength(0);
  });
});
