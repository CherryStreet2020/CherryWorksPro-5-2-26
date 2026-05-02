import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SmtpConfig } from "../../server/email";

interface CapturedMail {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
}

let captured: CapturedMail | null = null;

vi.mock("nodemailer", () => {
  const sendMail = vi.fn(async (mailOptions: CapturedMail) => {
    captured = mailOptions;
    return { messageId: "test-message-id" };
  });
  const createTransport = vi.fn(() => ({ sendMail }));
  const getTestMessageUrl = vi.fn(() => false);
  const createTestAccount = vi.fn(async () => ({ user: "test", pass: "test" }));
  return {
    default: { createTransport, getTestMessageUrl, createTestAccount },
  };
});

const SMTP: SmtpConfig = {
  host: "smtp.example.com",
  port: 587,
  user: "noreply@example.com",
  pass: "secret",
  fromName: "Acme Co",
  fromEmail: "noreply@example.com",
};

async function loadEmail() {
  return await import("../../server/email");
}

beforeEach(() => {
  captured = null;
});

describe("sendInviteEmail rendered HTML", () => {
  it("includes greeting, org, credentials, and CTA", async () => {
    const { sendInviteEmail } = await loadEmail();
    await sendInviteEmail(
      "newuser@example.com",
      "Jane Doe",
      "Acme Co",
      "TempPass!234",
      "https://app.example.com/login",
      SMTP,
    );
    expect(captured).not.toBeNull();
    const mailOptions = captured!;
    expect(mailOptions.to).toBe("newuser@example.com");
    expect(mailOptions.subject).toBe(
      "You've been invited to Acme Co on CherryWorks Pro",
    );
    const html: string = mailOptions.html;
    expect(html).toContain("You're invited");
    expect(html).toContain("Hi Jane Doe,");
    expect(html).toContain("Acme Co");
    expect(html).toContain("newuser@example.com");
    expect(html).toContain("TempPass!234");
    expect(html).toContain("Log In to CherryWorks Pro");
    expect(html).toContain("https://app.example.com/login");
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("matches snapshot of rendered HTML", async () => {
    const { sendInviteEmail } = await loadEmail();
    await sendInviteEmail(
      "snapshot@example.com",
      "Snapshot User",
      "Snapshot Org",
      "Snap-Pass-123",
      "https://app.example.com/login",
      SMTP,
    );
    expect(captured!.html).toMatchSnapshot();
  });
});

describe("sendPasswordResetEmail rendered HTML", () => {
  it("includes headline, expiry copy, CTA and reset URL", async () => {
    const { sendPasswordResetEmail } = await loadEmail();
    await sendPasswordResetEmail(
      "reset@example.com",
      "https://app.example.com/reset?token=abc123",
      SMTP,
    );
    const mailOptions = captured!;
    expect(mailOptions.to).toBe("reset@example.com");
    expect(mailOptions.subject).toBe("Reset your CherryWorks Pro password");
    const html: string = mailOptions.html;
    expect(html).toContain("Password Reset");
    expect(html).toContain("expire in 1 hour");
    expect(html).toContain("Reset Password");
    expect(html).toContain(
      "https://app.example.com/reset?token=abc123",
    );
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("matches snapshot of rendered HTML", async () => {
    const { sendPasswordResetEmail } = await loadEmail();
    await sendPasswordResetEmail(
      "snapshot@example.com",
      "https://app.example.com/reset?token=snapshot-token",
      SMTP,
    );
    expect(captured!.html).toMatchSnapshot();
  });
});

describe("sendRejectionEmail rendered HTML", () => {
  it("includes recipient, entity, reviewer, and reason", async () => {
    const { sendRejectionEmail } = await loadEmail();
    await sendRejectionEmail(
      "submitter@example.com",
      "Bob Builder",
      "timesheet",
      "Week of 2026-04-13",
      "Hours on Tuesday look duplicated.",
      "Alice Approver",
      SMTP,
    );
    const mailOptions = captured!;
    expect(mailOptions.to).toBe("submitter@example.com");
    expect(mailOptions.subject).toBe(
      "Your timesheet has been returned — Week of 2026-04-13",
    );
    const html: string = mailOptions.html;
    expect(html).toContain("Timesheet Returned");
    expect(html).toContain("Hi Bob Builder,");
    expect(html).toContain("Week of 2026-04-13");
    expect(html).toContain("Alice Approver");
    expect(html).toContain("Hours on Tuesday look duplicated.");
    expect(html).toContain("Reason:");
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("capitalizes entity type in headline for expense report", async () => {
    const { sendRejectionEmail } = await loadEmail();
    await sendRejectionEmail(
      "submitter@example.com",
      "",
      "expense report",
      "ER-2026-0001",
      "Missing receipts",
      "Alice Approver",
      SMTP,
    );
    const html: string = captured!.html;
    expect(html).toContain("Expense report Returned");
    expect(html).toContain("Hi there,");
  });

  it("matches snapshot of rendered HTML", async () => {
    const { sendRejectionEmail } = await loadEmail();
    await sendRejectionEmail(
      "snapshot@example.com",
      "Snapshot User",
      "expense",
      "EXP-0001",
      "Snapshot reason text.",
      "Snapshot Reviewer",
      SMTP,
    );
    expect(captured!.html).toMatchSnapshot();
  });
});

describe("sendTimesheetApprovedEmail rendered HTML", () => {
  it("uses the approved subject line and includes greeting, week, and approver", async () => {
    const { sendTimesheetApprovedEmail } = await loadEmail();
    await sendTimesheetApprovedEmail(
      "rep@example.com",
      "Bob Builder",
      "2026-04-13",
      "Alice Approver",
      SMTP,
    );
    const mailOptions = captured!;
    expect(mailOptions.to).toBe("rep@example.com");
    expect(mailOptions.subject).toBe(
      "Your week of 2026-04-13 was approved",
    );
    const html: string = mailOptions.html;
    expect(html).toContain("Timesheet Approved");
    expect(html).toContain("Hi Bob Builder,");
    expect(html).toContain("week of 2026-04-13");
    expect(html).toContain("Alice Approver");
    expect(html).toContain("No further action is needed");
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("falls back gracefully when names are missing", async () => {
    const { sendTimesheetApprovedEmail } = await loadEmail();
    await sendTimesheetApprovedEmail(
      "rep@example.com",
      "",
      "2026-04-13",
      "",
      SMTP,
    );
    const html: string = captured!.html;
    expect(html).toContain("Hi there,");
    expect(html).toContain("an administrator");
  });

  it("matches snapshot of rendered HTML", async () => {
    const { sendTimesheetApprovedEmail } = await loadEmail();
    await sendTimesheetApprovedEmail(
      "snapshot@example.com",
      "Snapshot User",
      "2026-04-13",
      "Snapshot Approver",
      SMTP,
    );
    expect(captured!.html).toMatchSnapshot();
  });
});

describe("sendExpenseApprovedEmail rendered HTML", () => {
  it("uses the approved subject line and includes the expense label and approver", async () => {
    const { sendExpenseApprovedEmail } = await loadEmail();
    await sendExpenseApprovedEmail(
      "rep@example.com",
      "Bob Builder",
      "Office supplies",
      "Alice Approver",
      SMTP,
    );
    const mailOptions = captured!;
    expect(mailOptions.to).toBe("rep@example.com");
    expect(mailOptions.subject).toBe(
      "Your expense was approved — Office supplies",
    );
    const html: string = mailOptions.html;
    expect(html).toContain("Expense Approved");
    expect(html).toContain("Hi Bob Builder,");
    expect(html).toContain("Office supplies");
    expect(html).toContain("Alice Approver");
    expect(html).toContain("No further action is needed");
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("falls back gracefully when names are missing", async () => {
    const { sendExpenseApprovedEmail } = await loadEmail();
    await sendExpenseApprovedEmail(
      "rep@example.com",
      "",
      "$42.00",
      "",
      SMTP,
    );
    const html: string = captured!.html;
    expect(html).toContain("Hi there,");
    expect(html).toContain("an administrator");
    expect(html).toContain("$42.00");
  });

  it("escapes HTML in the expense label to prevent injection", async () => {
    const { sendExpenseApprovedEmail } = await loadEmail();
    await sendExpenseApprovedEmail(
      "rep@example.com",
      "Bob",
      "<script>alert('xss')</script>",
      "Alice",
      SMTP,
    );
    const html: string = captured!.html;
    expect(html).not.toContain("<script>alert('xss')</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("sendExpenseReportApprovedEmail rendered HTML", () => {
  it("uses the approved subject line and includes the report title and approver", async () => {
    const { sendExpenseReportApprovedEmail } = await loadEmail();
    await sendExpenseReportApprovedEmail(
      "rep@example.com",
      "Bob Builder",
      "ER-2026-0001",
      "Alice Approver",
      SMTP,
    );
    const mailOptions = captured!;
    expect(mailOptions.to).toBe("rep@example.com");
    expect(mailOptions.subject).toBe(
      "Your expense report was approved — ER-2026-0001",
    );
    const html: string = mailOptions.html;
    expect(html).toContain("Expense Report Approved");
    expect(html).toContain("Hi Bob Builder,");
    expect(html).toContain("ER-2026-0001");
    expect(html).toContain("Alice Approver");
    expect(html).toContain("No further action is needed");
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("falls back gracefully when names are missing", async () => {
    const { sendExpenseReportApprovedEmail } = await loadEmail();
    await sendExpenseReportApprovedEmail(
      "rep@example.com",
      "",
      "Expense Report",
      "",
      SMTP,
    );
    const html: string = captured!.html;
    expect(html).toContain("Hi there,");
    expect(html).toContain("an administrator");
  });
});

describe("sendExpenseReportReopenedEmail rendered HTML", () => {
  it("uses the re-opened subject line and shows the admin's note", async () => {
    const { sendExpenseReportReopenedEmail } = await loadEmail();
    await sendExpenseReportReopenedEmail(
      "rep@example.com",
      "Bob Builder",
      "ER-2026-0001",
      "Alice Approver",
      "Please add the missing receipts.",
      SMTP,
    );
    const mailOptions = captured!;
    expect(mailOptions.to).toBe("rep@example.com");
    expect(mailOptions.subject).toBe(
      "Your expense report was re-opened — ER-2026-0001",
    );
    const html: string = mailOptions.html;
    expect(html).toContain("Expense Report Re-opened");
    expect(html).toContain("Hi Bob Builder,");
    expect(html).toContain("ER-2026-0001");
    expect(html).toContain("Alice Approver");
    expect(html).toContain("Please add the missing receipts.");
    expect(html).toContain("Note from Alice Approver");
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("escapes HTML in the reason note to prevent injection", async () => {
    const { sendExpenseReportReopenedEmail } = await loadEmail();
    await sendExpenseReportReopenedEmail(
      "rep@example.com",
      "Bob Builder",
      "ER-2026-0001",
      "Alice Approver",
      "<script>alert('xss')</script>",
      SMTP,
    );
    const html: string = captured!.html;
    expect(html).not.toContain("<script>alert('xss')</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("omits the note block when no reason is provided", async () => {
    const { sendExpenseReportReopenedEmail } = await loadEmail();
    await sendExpenseReportReopenedEmail(
      "rep@example.com",
      "Bob Builder",
      "ER-2026-0001",
      "Alice Approver",
      null,
      SMTP,
    );
    const html: string = captured!.html;
    expect(html).not.toContain("Note from Alice Approver");
  });
});

describe("sendTimesheetReopenedEmail rendered HTML", () => {
  it("uses the re-opened subject line and shows the admin's note", async () => {
    const { sendTimesheetReopenedEmail } = await loadEmail();
    await sendTimesheetReopenedEmail(
      "rep@example.com",
      "Bob Builder",
      "2026-04-13",
      "Alice Approver",
      "Add the Friday client meeting hours.",
      SMTP,
    );
    const mailOptions = captured!;
    expect(mailOptions.to).toBe("rep@example.com");
    expect(mailOptions.subject).toBe(
      "Your week of 2026-04-13 was re-opened",
    );
    const html: string = mailOptions.html;
    expect(html).toContain("Timesheet Re-opened");
    expect(html).toContain("Hi Bob Builder,");
    expect(html).toContain("week of 2026-04-13");
    expect(html).toContain("Alice Approver");
    expect(html).toContain("Add the Friday client meeting hours.");
    expect(html).toContain("Note from Alice Approver");
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("escapes HTML in the reason note to prevent injection", async () => {
    const { sendTimesheetReopenedEmail } = await loadEmail();
    await sendTimesheetReopenedEmail(
      "rep@example.com",
      "Bob Builder",
      "2026-04-13",
      "Alice Approver",
      "<script>alert('xss')</script>",
      SMTP,
    );
    const html: string = captured!.html;
    expect(html).not.toContain("<script>alert('xss')</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("matches snapshot of rendered HTML", async () => {
    const { sendTimesheetReopenedEmail } = await loadEmail();
    await sendTimesheetReopenedEmail(
      "snapshot@example.com",
      "Snapshot User",
      "2026-04-13",
      "Snapshot Reopener",
      "Snapshot reason text.",
      SMTP,
    );
    expect(captured!.html).toMatchSnapshot();
  });
});
