/**
 * Task #424 — Route-level test for the wire-up between the timesheet
 * bulk-approve endpoint and the `sendTimesheetApprovedEmail` helper.
 *
 * Mounts `registerTimeRoutes` on a fresh Express app with stubbed
 * session, storage, db.transaction, webhooks, and email modules so we
 * can assert that:
 *   - POST /api/timesheets/bulk-approve fans out one
 *     sendTimesheetApprovedEmail call per affected timesheet with the
 *     submitter, week, and approver-name arguments matching the
 *     single-approve route.
 *   - Skipped rows (not_found, skipped_not_pending) get no email.
 *   - Submitters with no email on file are silently skipped without
 *     500-ing the request.
 *
 * Mirrors tests/integration/timesheet-rejection-emails-route.test.ts
 * and tests/integration/timesheet-approval-emails-route.test.ts.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import http, { type Server } from "http";
import { AddressInfo } from "net";

const ADMIN_USER_ID = "admin-1";
const REP_USER_ID = "rep-1";
const REP2_USER_ID = "rep-2";
const ORG_ID = "org-1";
const TS_ID = "ts-1";
const TS2_ID = "ts-2";
const TS3_ID = "ts-3";
const MISSING_TS_ID = "ts-missing";
const WEEK_START = "2026-04-13";
const WEEK_START_2 = "2026-04-20";
const WEEK_START_3 = "2026-04-27";

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
  [REP2_USER_ID]: {
    id: REP2_USER_ID,
    email: "carol@example.com",
    name: "Carol Coder",
    role: "TEAM_MEMBER",
    isActive: true,
  },
};

const timesheets: Record<string, TimesheetRow> = {
  [TS_ID]: {
    id: TS_ID,
    orgId: ORG_ID,
    userId: REP_USER_ID,
    weekStartDate: WEEK_START,
    status: "SUBMITTED",
  },
  [TS2_ID]: {
    id: TS2_ID,
    orgId: ORG_ID,
    userId: REP2_USER_ID,
    weekStartDate: WEEK_START_2,
    status: "SUBMITTED",
  },
  [TS3_ID]: {
    id: TS3_ID,
    orgId: ORG_ID,
    userId: REP_USER_ID,
    weekStartDate: WEEK_START_3,
    status: "DRAFT",
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
};

const getUserById = vi.fn(async (id: string) => users[id] ?? null);
const getOrg = vi.fn(async (_id: string) => orgRow);
const getTimesheetById = vi.fn(async (id: string, _orgId: string) => timesheets[id] ?? null);
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

// The bulk-approve path uses a db.transaction with raw drizzle update
// chains. We stub the transaction so it just hands the callback a tiny
// chainable that no-ops the writes; the test asserts the
// storage-level + email-level wire-up rather than the SQL itself.
function makeTx() {
  return {
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

const sendRejectionEmail = vi.fn(async () => ({ messageId: "m-reject" }));
const sendTimesheetApprovedEmail = vi.fn(async () => ({ messageId: "m-approve" }));
const sendTimesheetReopenedEmail = vi.fn(async () => ({ messageId: "m-reopen" }));

vi.mock("../../server/email", () => ({
  sendRejectionEmail: (...a: any[]) => sendRejectionEmail(...(a as [])),
  sendTimesheetApprovedEmail: (...a: any[]) => sendTimesheetApprovedEmail(...(a as [])),
  sendTimesheetReopenedEmail: (...a: any[]) => sendTimesheetReopenedEmail(...(a as [])),
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
  sendRejectionEmail.mockClear();
  sendTimesheetApprovedEmail.mockClear();
  sendTimesheetReopenedEmail.mockClear();

  timesheets[TS_ID] = {
    id: TS_ID,
    orgId: ORG_ID,
    userId: REP_USER_ID,
    weekStartDate: WEEK_START,
    status: "SUBMITTED",
  };
  timesheets[TS2_ID] = {
    id: TS2_ID,
    orgId: ORG_ID,
    userId: REP2_USER_ID,
    weekStartDate: WEEK_START_2,
    status: "SUBMITTED",
  };
  timesheets[TS3_ID] = {
    id: TS3_ID,
    orgId: ORG_ID,
    userId: REP_USER_ID,
    weekStartDate: WEEK_START_3,
    status: "DRAFT",
  };
  users[REP_USER_ID].email = "bob@example.com";
  users[REP2_USER_ID].email = "carol@example.com";

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

describe("Task #424 — POST /api/timesheets/bulk-approve fans out the approval email", () => {
  it("fires one sendTimesheetApprovedEmail call per affected timesheet with the submitter, week, and approver name", async () => {
    const r = await fetch(`${baseUrl}/api/timesheets/bulk-approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [TS_ID, TS2_ID] }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.results).toEqual([
      { id: TS_ID, status: "approved" },
      { id: TS2_ID, status: "approved" },
    ]);
    await flushMicrotasks();

    expect(sendTimesheetApprovedEmail).toHaveBeenCalledTimes(2);

    const callsByTo = new Map<string, any[]>();
    for (const call of sendTimesheetApprovedEmail.mock.calls) {
      callsByTo.set(call[0] as string, call as any[]);
    }

    const bobCall = callsByTo.get("bob@example.com");
    expect(bobCall).toBeDefined();
    expect(bobCall![1]).toBe("Bob Builder"); // submitter name
    expect(bobCall![2]).toBe(WEEK_START); // week start date
    expect(bobCall![3]).toBe("Alice Approver"); // approver name

    const carolCall = callsByTo.get("carol@example.com");
    expect(carolCall).toBeDefined();
    expect(carolCall![1]).toBe("Carol Coder");
    expect(carolCall![2]).toBe(WEEK_START_2);
    expect(carolCall![3]).toBe("Alice Approver");

    expect(sendRejectionEmail).not.toHaveBeenCalled();
    expect(sendTimesheetReopenedEmail).not.toHaveBeenCalled();
  });

  it("does not fire an email for skipped rows that aren't pending", async () => {
    const r = await fetch(`${baseUrl}/api/timesheets/bulk-approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [TS_ID, TS3_ID] }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.results).toEqual([
      { id: TS_ID, status: "approved" },
      { id: TS3_ID, status: "skipped_not_pending" },
    ]);
    await flushMicrotasks();

    expect(sendTimesheetApprovedEmail).toHaveBeenCalledTimes(1);
    expect(sendTimesheetApprovedEmail.mock.calls[0][0]).toBe("bob@example.com");
    expect(sendTimesheetApprovedEmail.mock.calls[0][2]).toBe(WEEK_START);
  });

  it("does not fire an email for not_found rows", async () => {
    const r = await fetch(`${baseUrl}/api/timesheets/bulk-approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [MISSING_TS_ID, TS2_ID] }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.results).toEqual([
      { id: MISSING_TS_ID, status: "not_found" },
      { id: TS2_ID, status: "approved" },
    ]);
    await flushMicrotasks();

    expect(sendTimesheetApprovedEmail).toHaveBeenCalledTimes(1);
    expect(sendTimesheetApprovedEmail.mock.calls[0][0]).toBe("carol@example.com");
    expect(sendTimesheetApprovedEmail.mock.calls[0][2]).toBe(WEEK_START_2);
  });

  it("silently skips submitters with no email on file without 500-ing", async () => {
    users[REP_USER_ID].email = null;
    const r = await fetch(`${baseUrl}/api/timesheets/bulk-approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [TS_ID, TS2_ID] }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.results).toEqual([
      { id: TS_ID, status: "approved" },
      { id: TS2_ID, status: "approved" },
    ]);
    await flushMicrotasks();

    expect(sendTimesheetApprovedEmail).toHaveBeenCalledTimes(1);
    expect(sendTimesheetApprovedEmail.mock.calls[0][0]).toBe("carol@example.com");
  });

  it("400s and never fires the email when no ids are provided", async () => {
    const r = await fetch(`${baseUrl}/api/timesheets/bulk-approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(400);
    await flushMicrotasks();
    expect(sendTimesheetApprovedEmail).not.toHaveBeenCalled();
  });
});
