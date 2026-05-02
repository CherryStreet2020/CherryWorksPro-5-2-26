/**
 * Task #419 — Route-level test for the wire-up between the expense
 * approve / report-approve / report-unlock endpoints and the new
 * transactional email helpers added in Task #414.
 *
 * Mounts `registerExpenseRoutes` on a fresh Express app with stubbed
 * session, storage, db, and email modules so we can assert that:
 *   - POST /api/expenses/:id/approve fires sendExpenseApprovedEmail
 *     with the expense submitter, an expense label, and the approver
 *     name; still 200s when the rep has no email on file.
 *   - POST /api/expense-reports/:id/approve fires
 *     sendExpenseReportApprovedEmail with the report title and the
 *     approver.
 *   - POST /api/expense-reports/:id/unlock fires
 *     sendExpenseReportReopenedEmail for both APPROVED and SUBMITTED
 *     prior statuses, including the admin's reason; rejects the
 *     unlock when the report is already DRAFT or REJECTED.
 *
 * Mirrors tests/integration/timesheet-approval-emails-route.test.ts.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import http, { type Server } from "http";
import { AddressInfo } from "net";

const ADMIN_USER_ID = "admin-1";
const REP_USER_ID = "rep-1";
const ORG_ID = "org-1";
const EXPENSE_ID = "exp-1";
const REPORT_ID = "rpt-1";

interface UserRow {
  id: string;
  email: string | null;
  name: string;
  role: string;
  isActive: boolean;
}

const users: Record<string, UserRow> = {
  [ADMIN_USER_ID]: {
    id: ADMIN_USER_ID,
    email: "alice@example.com",
    name: "Alice Approver",
    role: "ADMIN",
    isActive: true,
  },
  [REP_USER_ID]: {
    id: REP_USER_ID,
    email: "bob@example.com",
    name: "Bob Builder",
    role: "TEAM_MEMBER",
    isActive: true,
  },
};

const orgRow = {
  id: ORG_ID,
  name: "Acme Co",
  planTier: "PROFESSIONAL",
  smtpHost: null,
  smtpPort: null,
  smtpUser: null,
  smtpPass: null,
  autoPostJournalEntries: false,
};

interface ApprovedExpense {
  id: string;
  orgId: string;
  userId: string;
  amount: number;
  vendor: string | null;
  description: string | null;
  date: string;
  reimbursable: boolean;
  categoryId: string | null;
}

let approvedExpense: ApprovedExpense = {
  id: EXPENSE_ID,
  orgId: ORG_ID,
  userId: REP_USER_ID,
  amount: 42.5,
  vendor: "Office Depot",
  description: "Printer paper",
  date: "2026-04-20",
  reimbursable: false,
  categoryId: null,
};

interface ApprovedReport {
  id: string;
  orgId: string;
  userId: string;
  title: string;
  totalAmount: number;
}

let approvedReport: ApprovedReport = {
  id: REPORT_ID,
  orgId: ORG_ID,
  userId: REP_USER_ID,
  title: "March Travel",
  totalAmount: 1234.56,
};

let reopenPreviousStatus: "SUBMITTED" | "APPROVED" = "APPROVED";
let reopenShouldThrow: { status: "DRAFT" | "REJECTED" } | null = null;

const getUserById = vi.fn(async (id: string) => users[id] ?? null);
const getOrg = vi.fn(async (_id: string) => orgRow);
const createAuditLog = vi.fn(async () => undefined);
const approveExpense = vi.fn(async (_id: string, _orgId: string, _approverId: string) => approvedExpense);
const approveExpenseReport = vi.fn(async (_id: string, _orgId: string, _approverId: string) => approvedReport);
const reopenExpenseReport = vi.fn(async (_id: string, _orgId: string, _reopenerId: string) => {
  if (reopenShouldThrow) {
    throw new Error(
      `Cannot re-open: expense report is ${reopenShouldThrow.status}. Only submitted or approved reports can be re-opened.`,
    );
  }
  return { ...approvedReport, previousStatus: reopenPreviousStatus };
});

vi.mock("../../server/storage", () => ({
  storage: {
    getUserById: (id: string) => getUserById(id),
    getOrg: (id: string) => getOrg(id),
    createAuditLog: (...a: any[]) => createAuditLog(...a),
    approveExpense: (id: string, orgId: string, approverId: string) =>
      approveExpense(id, orgId, approverId),
    approveExpenseReport: (id: string, orgId: string, approverId: string) =>
      approveExpenseReport(id, orgId, approverId),
    reopenExpenseReport: (id: string, orgId: string, reopenerId: string) =>
      reopenExpenseReport(id, orgId, reopenerId),
  },
}));

// The expense routes import db at module load. We don't exercise any
// db.* calls in the approve/unlock paths under test (autoPostJournalEntries
// is false and reimbursable is false), but we still stub it so the import
// doesn't reach for a real connection.
vi.mock("../../server/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => [] }) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    transaction: async (cb: (tx: any) => Promise<any>) => cb({}),
  },
  pool: { query: vi.fn() },
}));

const sendExpenseApprovedEmail = vi.fn(async () => ({ messageId: "m-exp-approve" }));
const sendExpenseReportApprovedEmail = vi.fn(async () => ({ messageId: "m-rpt-approve" }));
const sendExpenseReportReopenedEmail = vi.fn(async () => ({ messageId: "m-rpt-reopen" }));
const sendRejectionEmail = vi.fn(async () => ({ messageId: "m-reject" }));

vi.mock("../../server/email", () => ({
  sendExpenseApprovedEmail: (...a: any[]) => sendExpenseApprovedEmail(...(a as [])),
  sendExpenseReportApprovedEmail: (...a: any[]) => sendExpenseReportApprovedEmail(...(a as [])),
  sendExpenseReportReopenedEmail: (...a: any[]) => sendExpenseReportReopenedEmail(...(a as [])),
  sendRejectionEmail: (...a: any[]) => sendRejectionEmail(...(a as [])),
  getSmtpConfigFromOrg: () => null,
}));

// The middleware module pulls in createAutoJournalEntry; we don't exercise
// it (autoPostJournalEntries = false in the org row), but stubbing the
// middleware module isn't safe because we need the real auth gates. Leave
// the real middleware in place — it only calls storage.getUserById /
// storage.getOrg, both of which we mocked above.

import { registerExpenseRoutes } from "../../server/routes/expense-routes";

let server: Server;
let baseUrl: string;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = {
      userId: ADMIN_USER_ID,
      orgId: ORG_ID,
      role: "ADMIN",
      destroy: (cb: () => void) => cb(),
    };
    next();
  });
  registerExpenseRoutes(app);
  return app;
}

beforeEach(async () => {
  getUserById.mockClear();
  getOrg.mockClear();
  createAuditLog.mockClear();
  approveExpense.mockClear();
  approveExpenseReport.mockClear();
  reopenExpenseReport.mockClear();
  sendExpenseApprovedEmail.mockClear();
  sendExpenseReportApprovedEmail.mockClear();
  sendExpenseReportReopenedEmail.mockClear();
  sendRejectionEmail.mockClear();

  approvedExpense = {
    id: EXPENSE_ID,
    orgId: ORG_ID,
    userId: REP_USER_ID,
    amount: 42.5,
    vendor: "Office Depot",
    description: "Printer paper",
    date: "2026-04-20",
    reimbursable: false,
    categoryId: null,
  };
  approvedReport = {
    id: REPORT_ID,
    orgId: ORG_ID,
    userId: REP_USER_ID,
    title: "March Travel",
    totalAmount: 1234.56,
  };
  reopenPreviousStatus = "APPROVED";
  reopenShouldThrow = null;
  users[REP_USER_ID].email = "bob@example.com";

  if (server) await new Promise<void>((r) => server.close(() => r()));
  const app = buildApp();
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, () => r()));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
});

async function flushMicrotasks() {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

describe("Task #419 — POST /api/expenses/:id/approve fires the approval email", () => {
  it("emails the rep with their name, an expense label, and the approver", async () => {
    const r = await fetch(`${baseUrl}/api/expenses/${EXPENSE_ID}/approve`, { method: "POST" });
    expect(r.status).toBe(200);
    await flushMicrotasks();

    expect(sendExpenseApprovedEmail).toHaveBeenCalledTimes(1);
    const args = sendExpenseApprovedEmail.mock.calls[0];
    expect(args[0]).toBe("bob@example.com"); // to
    expect(args[1]).toBe("Bob Builder"); // recipient name
    // Label should prefer description over vendor when both are present.
    expect(args[2]).toBe("Printer paper");
    expect(args[3]).toBe("Alice Approver"); // approver name
    expect(sendExpenseReportApprovedEmail).not.toHaveBeenCalled();
    expect(sendExpenseReportReopenedEmail).not.toHaveBeenCalled();
  });

  it("falls back to the vendor when the expense has no description", async () => {
    approvedExpense.description = null;
    const r = await fetch(`${baseUrl}/api/expenses/${EXPENSE_ID}/approve`, { method: "POST" });
    expect(r.status).toBe(200);
    await flushMicrotasks();

    expect(sendExpenseApprovedEmail).toHaveBeenCalledTimes(1);
    const args = sendExpenseApprovedEmail.mock.calls[0];
    expect(args[2]).toBe("Office Depot");
  });

  it("still 200s and skips the email when the rep has no email on file", async () => {
    users[REP_USER_ID].email = null;
    const r = await fetch(`${baseUrl}/api/expenses/${EXPENSE_ID}/approve`, { method: "POST" });
    expect(r.status).toBe(200);
    await flushMicrotasks();
    expect(sendExpenseApprovedEmail).not.toHaveBeenCalled();
  });
});

describe("Task #419 — POST /api/expense-reports/:id/approve fires the approval email", () => {
  it("emails the rep with the report title and the approver", async () => {
    const r = await fetch(`${baseUrl}/api/expense-reports/${REPORT_ID}/approve`, { method: "POST" });
    expect(r.status).toBe(200);
    await flushMicrotasks();

    expect(sendExpenseReportApprovedEmail).toHaveBeenCalledTimes(1);
    const args = sendExpenseReportApprovedEmail.mock.calls[0];
    expect(args[0]).toBe("bob@example.com");
    expect(args[1]).toBe("Bob Builder");
    expect(args[2]).toBe("March Travel"); // report title
    expect(args[3]).toBe("Alice Approver");
    expect(sendExpenseApprovedEmail).not.toHaveBeenCalled();
    expect(sendExpenseReportReopenedEmail).not.toHaveBeenCalled();
  });

  it("still 200s and skips the email when the rep has no email on file", async () => {
    users[REP_USER_ID].email = null;
    const r = await fetch(`${baseUrl}/api/expense-reports/${REPORT_ID}/approve`, { method: "POST" });
    expect(r.status).toBe(200);
    await flushMicrotasks();
    expect(sendExpenseReportApprovedEmail).not.toHaveBeenCalled();
  });
});

describe("Task #419 — POST /api/expense-reports/:id/unlock fires the re-open email", () => {
  it("emails the rep when the prior status was APPROVED, including the admin's reason", async () => {
    reopenPreviousStatus = "APPROVED";
    const r = await fetch(`${baseUrl}/api/expense-reports/${REPORT_ID}/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Missing the rental car receipt." }),
    });
    expect(r.status).toBe(200);
    await flushMicrotasks();

    expect(sendExpenseReportReopenedEmail).toHaveBeenCalledTimes(1);
    const args = sendExpenseReportReopenedEmail.mock.calls[0];
    expect(args[0]).toBe("bob@example.com");
    expect(args[1]).toBe("Bob Builder");
    expect(args[2]).toBe("March Travel");
    expect(args[3]).toBe("Alice Approver"); // re-opener name
    expect(args[4]).toBe("Missing the rental car receipt."); // reason
    expect(sendExpenseReportApprovedEmail).not.toHaveBeenCalled();
  });

  it("emails the rep when the prior status was SUBMITTED, including the reason", async () => {
    reopenPreviousStatus = "SUBMITTED";
    const r = await fetch(`${baseUrl}/api/expense-reports/${REPORT_ID}/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Add the cab fare line." }),
    });
    expect(r.status).toBe(200);
    await flushMicrotasks();

    expect(sendExpenseReportReopenedEmail).toHaveBeenCalledTimes(1);
    const args = sendExpenseReportReopenedEmail.mock.calls[0];
    expect(args[4]).toBe("Add the cab fare line.");
  });

  it("rejects the unlock with 400 when the report is already DRAFT and sends no email", async () => {
    reopenShouldThrow = { status: "DRAFT" };
    const r = await fetch(`${baseUrl}/api/expense-reports/${REPORT_ID}/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "no-op" }),
    });
    expect(r.status).toBe(400);
    await flushMicrotasks();
    expect(sendExpenseReportReopenedEmail).not.toHaveBeenCalled();
  });

  it("rejects the unlock with 400 when the report is already REJECTED and sends no email", async () => {
    reopenShouldThrow = { status: "REJECTED" };
    const r = await fetch(`${baseUrl}/api/expense-reports/${REPORT_ID}/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "no-op" }),
    });
    expect(r.status).toBe(400);
    await flushMicrotasks();
    expect(sendExpenseReportReopenedEmail).not.toHaveBeenCalled();
  });
});
