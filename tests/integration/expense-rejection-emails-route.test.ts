/**
 * Task #422 — Route-level test for the wire-up between the expense
 * reject / report-reject endpoints and the `sendRejectionEmail` helper.
 *
 * Mounts `registerExpenseRoutes` on a fresh Express app with stubbed
 * session, storage, db, and email modules so we can assert that:
 *   - POST /api/expenses/:id/reject fires sendRejectionEmail with the
 *     expense submitter, an "expense" label, the rejection reason, and
 *     the reviewer name; 400s when no reason is provided; still 200s
 *     when the rep has no email on file.
 *   - POST /api/expense-reports/:id/reject fires sendRejectionEmail
 *     with the report title, an "expense report" label, the reason,
 *     and the reviewer; 400s when no reason is provided.
 *
 * Mirrors tests/integration/expense-approval-emails-route.test.ts.
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

interface RejectedExpense {
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

let rejectedExpense: RejectedExpense = {
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

interface RejectedReport {
  id: string;
  orgId: string;
  userId: string;
  title: string;
  totalAmount: number;
}

let rejectedReport: RejectedReport = {
  id: REPORT_ID,
  orgId: ORG_ID,
  userId: REP_USER_ID,
  title: "March Travel",
  totalAmount: 1234.56,
};

const getUserById = vi.fn(async (id: string) => users[id] ?? null);
const getOrg = vi.fn(async (_id: string) => orgRow);
const createAuditLog = vi.fn(async () => undefined);
const rejectExpense = vi.fn(
  async (_id: string, _orgId: string, _reviewerId: string, _reason: string) => rejectedExpense,
);
const rejectExpenseReport = vi.fn(
  async (_id: string, _orgId: string, _reviewerId: string, _reason: string) => rejectedReport,
);

vi.mock("../../server/storage", () => ({
  storage: {
    getUserById: (id: string) => getUserById(id),
    getOrg: (id: string) => getOrg(id),
    createAuditLog: (...a: any[]) => createAuditLog(...a),
    rejectExpense: (id: string, orgId: string, reviewerId: string, reason: string) =>
      rejectExpense(id, orgId, reviewerId, reason),
    rejectExpenseReport: (id: string, orgId: string, reviewerId: string, reason: string) =>
      rejectExpenseReport(id, orgId, reviewerId, reason),
  },
}));

// The expense routes import db at module load. We don't exercise any
// db.* calls in the reject paths under test, but we still stub it so
// the import doesn't reach for a real connection.
vi.mock("../../server/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => [] }) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    transaction: async (cb: (tx: any) => Promise<any>) => cb({}),
  },
  pool: { query: vi.fn() },
}));

const sendRejectionEmail = vi.fn(async () => ({ messageId: "m-reject" }));
const sendExpenseApprovedEmail = vi.fn(async () => ({ messageId: "m-exp-approve" }));
const sendExpenseReportApprovedEmail = vi.fn(async () => ({ messageId: "m-rpt-approve" }));
const sendExpenseReportReopenedEmail = vi.fn(async () => ({ messageId: "m-rpt-reopen" }));

vi.mock("../../server/email", () => ({
  sendRejectionEmail: (...a: any[]) => sendRejectionEmail(...(a as [])),
  sendExpenseApprovedEmail: (...a: any[]) => sendExpenseApprovedEmail(...(a as [])),
  sendExpenseReportApprovedEmail: (...a: any[]) => sendExpenseReportApprovedEmail(...(a as [])),
  sendExpenseReportReopenedEmail: (...a: any[]) => sendExpenseReportReopenedEmail(...(a as [])),
  getSmtpConfigFromOrg: () => null,
}));

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
  rejectExpense.mockClear();
  rejectExpenseReport.mockClear();
  sendRejectionEmail.mockClear();
  sendExpenseApprovedEmail.mockClear();
  sendExpenseReportApprovedEmail.mockClear();
  sendExpenseReportReopenedEmail.mockClear();

  rejectedExpense = {
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
  rejectedReport = {
    id: REPORT_ID,
    orgId: ORG_ID,
    userId: REP_USER_ID,
    title: "March Travel",
    totalAmount: 1234.56,
  };
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

describe("Task #422 — POST /api/expenses/:id/reject fires the rejection email", () => {
  it("emails the rep with their name, an expense label, the reason, and the reviewer", async () => {
    const r = await fetch(`${baseUrl}/api/expenses/${EXPENSE_ID}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Missing receipt." }),
    });
    expect(r.status).toBe(200);
    await flushMicrotasks();

    expect(rejectExpense).toHaveBeenCalledTimes(1);
    expect(rejectExpense.mock.calls[0]).toEqual([
      EXPENSE_ID,
      ORG_ID,
      ADMIN_USER_ID,
      "Missing receipt.",
    ]);

    expect(sendRejectionEmail).toHaveBeenCalledTimes(1);
    const args = sendRejectionEmail.mock.calls[0];
    expect(args[0]).toBe("bob@example.com"); // to
    expect(args[1]).toBe("Bob Builder"); // recipient name
    expect(args[2]).toBe("expense"); // label/kind
    // Label should prefer description over vendor when both are present.
    expect(args[3]).toBe("Printer paper");
    expect(args[4]).toBe("Missing receipt."); // reason
    expect(args[5]).toBe("Alice Approver"); // reviewer name
    expect(sendExpenseApprovedEmail).not.toHaveBeenCalled();
  });

  it("falls back to the vendor when the expense has no description", async () => {
    rejectedExpense.description = null;
    const r = await fetch(`${baseUrl}/api/expenses/${EXPENSE_ID}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Wrong category." }),
    });
    expect(r.status).toBe(200);
    await flushMicrotasks();

    expect(sendRejectionEmail).toHaveBeenCalledTimes(1);
    expect(sendRejectionEmail.mock.calls[0][3]).toBe("Office Depot");
  });

  it("falls back to the dollar amount when the expense has no description or vendor", async () => {
    rejectedExpense.description = null;
    rejectedExpense.vendor = null;
    const r = await fetch(`${baseUrl}/api/expenses/${EXPENSE_ID}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "No detail provided." }),
    });
    expect(r.status).toBe(200);
    await flushMicrotasks();

    expect(sendRejectionEmail).toHaveBeenCalledTimes(1);
    expect(sendRejectionEmail.mock.calls[0][3]).toBe("$42.50");
  });

  it("400s and never calls storage or the email helper when no reason is provided", async () => {
    const r = await fetch(`${baseUrl}/api/expenses/${EXPENSE_ID}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.message).toMatch(/reason/i);
    await flushMicrotasks();

    expect(rejectExpense).not.toHaveBeenCalled();
    expect(sendRejectionEmail).not.toHaveBeenCalled();
  });

  it("still 200s and skips the email when the rep has no email on file", async () => {
    users[REP_USER_ID].email = null;
    const r = await fetch(`${baseUrl}/api/expenses/${EXPENSE_ID}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Missing receipt." }),
    });
    expect(r.status).toBe(200);
    await flushMicrotasks();

    expect(rejectExpense).toHaveBeenCalledTimes(1);
    expect(sendRejectionEmail).not.toHaveBeenCalled();
  });
});

describe("Task #422 — POST /api/expense-reports/:id/reject fires the rejection email", () => {
  it("emails the rep with the report title, an expense report label, the reason, and the reviewer", async () => {
    const r = await fetch(`${baseUrl}/api/expense-reports/${REPORT_ID}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Please re-categorize the lodging line." }),
    });
    expect(r.status).toBe(200);
    await flushMicrotasks();

    expect(rejectExpenseReport).toHaveBeenCalledTimes(1);
    expect(rejectExpenseReport.mock.calls[0]).toEqual([
      REPORT_ID,
      ORG_ID,
      ADMIN_USER_ID,
      "Please re-categorize the lodging line.",
    ]);

    expect(sendRejectionEmail).toHaveBeenCalledTimes(1);
    const args = sendRejectionEmail.mock.calls[0];
    expect(args[0]).toBe("bob@example.com");
    expect(args[1]).toBe("Bob Builder");
    expect(args[2]).toBe("expense report");
    expect(args[3]).toBe("March Travel"); // report title
    expect(args[4]).toBe("Please re-categorize the lodging line.");
    expect(args[5]).toBe("Alice Approver");
    expect(sendExpenseReportApprovedEmail).not.toHaveBeenCalled();
    expect(sendExpenseReportReopenedEmail).not.toHaveBeenCalled();
  });

  it("400s and never calls storage or the email helper when no reason is provided", async () => {
    const r = await fetch(`${baseUrl}/api/expense-reports/${REPORT_ID}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.message).toMatch(/reason/i);
    await flushMicrotasks();

    expect(rejectExpenseReport).not.toHaveBeenCalled();
    expect(sendRejectionEmail).not.toHaveBeenCalled();
  });
});
