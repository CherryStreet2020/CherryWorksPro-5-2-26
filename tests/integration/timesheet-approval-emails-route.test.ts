/**
 * Task #411 — Route-level test for the wire-up between the timesheet
 * approve / unlock endpoints and the new transactional email helpers.
 *
 * Mounts `registerTimeRoutes` on a fresh Express app with stubbed
 * session, storage, db.transaction, webhooks, and email modules so we
 * can assert that:
 *   - POST /api/timesheets/:id/approve fires sendTimesheetApprovedEmail
 *   - POST /api/timesheets/:id/unlock fires sendTimesheetReopenedEmail
 *     when the prior status was APPROVED or SUBMITTED
 *   - POST /api/timesheets/:id/unlock does NOT fire the re-open email
 *     when the prior status was DRAFT (no rep-visible state change)
 *   - approval succeeds even when the rep has no email on file
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import http, { type Server } from "http";
import { AddressInfo } from "net";

const ADMIN_USER_ID = "admin-1";
const REP_USER_ID = "rep-1";
const ORG_ID = "org-1";
const TS_ID = "ts-1";
const WEEK_START = "2026-04-13";

interface UserRow {
  id: string;
  email: string | null;
  name: string;
  role: string;
  isActive: boolean;
}

interface TimesheetRow {
  id: string;
  orgId: string;
  userId: string;
  weekStartDate: string;
  status: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";
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

let lockedTimesheet: TimesheetRow = {
  id: TS_ID,
  orgId: ORG_ID,
  userId: REP_USER_ID,
  weekStartDate: WEEK_START,
  status: "SUBMITTED",
};

const orgRow = {
  id: ORG_ID,
  name: "Acme Co",
  planTier: "PROFESSIONAL",
  smtpHost: null,
  smtpPort: null,
  smtpUser: null,
  smtpPass: null,
};

const getUserById = vi.fn(async (id: string) => users[id] ?? null);
const getOrg = vi.fn(async (_id: string) => orgRow);
const getTimesheetById = vi.fn(async (_id: string, _orgId: string) => lockedTimesheet);
const getTimeEntriesForWeek = vi.fn(async () => [] as any[]);
const createAuditLog = vi.fn(async () => undefined);

vi.mock("../../server/storage", () => ({
  storage: {
    getUserById: (id: string) => getUserById(id),
    getOrg: (id: string) => getOrg(id),
    getTimesheetById: (id: string, orgId: string) => getTimesheetById(id, orgId),
    getTimeEntriesForWeek: (...a: any[]) => getTimeEntriesForWeek(...a),
    createAuditLog: (...a: any[]) => createAuditLog(...a),
  },
}));

const fireWebhookEvent = vi.fn(() => undefined);
vi.mock("../../server/webhooks", () => ({
  fireWebhookEvent: (...a: any[]) => fireWebhookEvent(...a),
}));

vi.mock("../../server/services/rate-resolver", () => ({
  resolveRates: vi.fn(async () => ({})),
}));

// Drizzle's chainable builder is a thenable that resolves to the rows.
// For our purposes we only need select(...).for("update") to return the
// locked timesheet, and update(...).set(...).where(...) to be awaitable.
function makeTx() {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          for: async () => [lockedTimesheet],
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => undefined,
      }),
    }),
  };
}

vi.mock("../../server/db", () => ({
  db: {
    transaction: async (cb: (tx: any) => Promise<any>) => cb(makeTx()),
  },
  pool: { query: vi.fn() },
}));

const sendTimesheetApprovedEmail = vi.fn(async () => ({ messageId: "m-approve" }));
const sendTimesheetReopenedEmail = vi.fn(async () => ({ messageId: "m-reopen" }));
const sendRejectionEmail = vi.fn(async () => ({ messageId: "m-reject" }));

vi.mock("../../server/email", () => ({
  sendTimesheetApprovedEmail: (...a: any[]) => sendTimesheetApprovedEmail(...(a as [])),
  sendTimesheetReopenedEmail: (...a: any[]) => sendTimesheetReopenedEmail(...(a as [])),
  sendRejectionEmail: (...a: any[]) => sendRejectionEmail(...(a as [])),
  getSmtpConfigFromOrg: () => null,
}));

import { registerTimeRoutes } from "../../server/routes/time-routes";

let server: Server;
let baseUrl: string;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = {
      userId: ADMIN_USER_ID,
      orgId: ORG_ID,
      destroy: (cb: () => void) => cb(),
    };
    next();
  });
  registerTimeRoutes(app);
  return app;
}

beforeEach(async () => {
  getUserById.mockClear();
  getOrg.mockClear();
  getTimesheetById.mockClear();
  getTimeEntriesForWeek.mockClear();
  createAuditLog.mockClear();
  fireWebhookEvent.mockClear();
  sendTimesheetApprovedEmail.mockClear();
  sendTimesheetReopenedEmail.mockClear();
  sendRejectionEmail.mockClear();

  lockedTimesheet = {
    id: TS_ID,
    orgId: ORG_ID,
    userId: REP_USER_ID,
    weekStartDate: WEEK_START,
    status: "SUBMITTED",
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

describe("Task #411 — POST /api/timesheets/:id/approve fires the approval email", () => {
  it("emails the rep with their name, the week, and the approver", async () => {
    const r = await fetch(`${baseUrl}/api/timesheets/${TS_ID}/approve`, { method: "POST" });
    expect(r.status).toBe(200);
    await flushMicrotasks();

    expect(sendTimesheetApprovedEmail).toHaveBeenCalledTimes(1);
    const args = sendTimesheetApprovedEmail.mock.calls[0];
    expect(args[0]).toBe("bob@example.com"); // to
    expect(args[1]).toBe("Bob Builder"); // recipient name
    expect(args[2]).toBe(WEEK_START);
    expect(args[3]).toBe("Alice Approver"); // approver name
    expect(sendTimesheetReopenedEmail).not.toHaveBeenCalled();
  });

  it("still 200s and skips the email when the rep has no email on file", async () => {
    users[REP_USER_ID].email = null;
    const r = await fetch(`${baseUrl}/api/timesheets/${TS_ID}/approve`, { method: "POST" });
    expect(r.status).toBe(200);
    await flushMicrotasks();
    expect(sendTimesheetApprovedEmail).not.toHaveBeenCalled();
  });
});

describe("Task #411 — POST /api/timesheets/:id/unlock fires the re-open email", () => {
  it("emails the rep when the prior status was APPROVED, including the admin's reason", async () => {
    lockedTimesheet.status = "APPROVED";
    const r = await fetch(`${baseUrl}/api/timesheets/${TS_ID}/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Add the Friday client meeting hours." }),
    });
    expect(r.status).toBe(200);
    await flushMicrotasks();

    expect(sendTimesheetReopenedEmail).toHaveBeenCalledTimes(1);
    const args = sendTimesheetReopenedEmail.mock.calls[0];
    expect(args[0]).toBe("bob@example.com");
    expect(args[1]).toBe("Bob Builder");
    expect(args[2]).toBe(WEEK_START);
    expect(args[3]).toBe("Alice Approver");
    expect(args[4]).toBe("Add the Friday client meeting hours.");
    expect(sendTimesheetApprovedEmail).not.toHaveBeenCalled();
  });

  it("emails the rep when the prior status was SUBMITTED", async () => {
    lockedTimesheet.status = "SUBMITTED";
    const r = await fetch(`${baseUrl}/api/timesheets/${TS_ID}/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Needs another line." }),
    });
    expect(r.status).toBe(200);
    await flushMicrotasks();
    expect(sendTimesheetReopenedEmail).toHaveBeenCalledTimes(1);
  });

  it("does NOT email the rep when the prior status was DRAFT", async () => {
    lockedTimesheet.status = "DRAFT";
    const r = await fetch(`${baseUrl}/api/timesheets/${TS_ID}/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "no-op unlock" }),
    });
    expect(r.status).toBe(200);
    await flushMicrotasks();
    expect(sendTimesheetReopenedEmail).not.toHaveBeenCalled();
  });
});
