/**
 * Task #410 — coverage for new rep-facing timesheet UX:
 *   • POST /api/timesheets/submit (empty-week confirmEmpty gate)
 *   • POST /api/timesheets/:id/recall (owner-only, SUBMITTED → DRAFT)
 *   • GET  /api/timesheets/my-recent (per-user isolation)
 *   • storage.getRecentTimesheetsForUser (per-user isolation)
 *   • Submit-route observability: console.error fires on exception
 *
 * HERMETIC: this suite creates its own ephemeral org + two users in
 * beforeAll and tears them down in afterAll. It does NOT depend on the
 * dev seed-role-test-users fixture, so it is safe to run in CI / a fresh
 * database. A tiny session-shim middleware injects req.session.userId/orgId
 * from x-test-user-id / x-test-org-id headers so we don't need full
 * express-session.
 */
process.env.NODE_ENV = process.env.NODE_ENV || "test";

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express, { type Request, type Response, type NextFunction, type Express } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { storage } from "./storage";
import { db, pool } from "./db";
import { timesheetWeeks, timeEntries, users, orgs, auditLogs } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { registerTimeRoutes } from "./routes/time-routes";

const SUITE_TAG = `task410-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let ORG_ID: string;
let TEAM_USER_ID: string;
let MANAGER_USER_ID: string;
let server: Server;
let baseUrl: string;
const createdTsIds: string[] = [];

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  // Session shim: emulate express-session via headers so requireAuth can
  // resolve the caller and time-routes can read userId/orgId.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const uid = req.header("x-test-user-id");
    const oid = req.header("x-test-org-id");
    (req as any).session = {
      userId: uid || undefined,
      orgId: oid || undefined,
      destroy: (cb: () => void) => cb && cb(),
      save: (cb: () => void) => cb && cb(),
    };
    next();
  });
  registerTimeRoutes(app);
  return app;
}

beforeAll(async () => {
  // Hermetic fixtures: own org (ENTERPRISE plan so requirePlanTier passes
  // for /submit and /recall) + a TEAM_MEMBER and a MANAGER user.
  const org = await storage.createOrg({
    name: `T410 Test Org ${SUITE_TAG}`,
    slug: `t410-${SUITE_TAG}`,
    planTier: "ENTERPRISE",
  } as any);
  ORG_ID = org.id;

  const teamUser = await storage.createUser({
    orgId: ORG_ID,
    email: `team.${SUITE_TAG}@t410.test`,
    password: "x",
    name: "Team Member",
    firstName: "Team",
    lastName: "Member",
    role: "TEAM_MEMBER" as any,
  } as any);
  TEAM_USER_ID = teamUser.id;

  const managerUser = await storage.createUser({
    orgId: ORG_ID,
    email: `manager.${SUITE_TAG}@t410.test`,
    password: "x",
    name: "Manager User",
    firstName: "Manager",
    lastName: "User",
    role: "MANAGER" as any,
  } as any);
  MANAGER_USER_ID = managerUser.id;

  const app = buildApp();
  server = createServer(app);
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  // Tear down in FK-safe order: time entries → timesheets → audit logs →
  // users → org. Filter by ORG_ID so we never touch unrelated rows.
  // (audit_logs.org_id has an FK to orgs.id, so it MUST be cleared before
  // the org delete — don't swallow errors here.)
  await db.delete(timeEntries).where(eq(timeEntries.orgId, ORG_ID));
  await db.delete(timesheetWeeks).where(eq(timesheetWeeks.orgId, ORG_ID));
  // audit_logs has an immutability trigger; sanctioned bypass is a
  // transaction-local GUC (see migrations/0017-audit-log-test-bypass.sql).
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.allow_audit_log_modification', 'on', true)`);
    await tx.delete(auditLogs).where(eq(auditLogs.orgId, ORG_ID));
  });
  await db.delete(users).where(eq(users.orgId, ORG_ID));
  await db.delete(orgs).where(eq(orgs.id, ORG_ID));

  await new Promise<void>(r => server.close(() => r()));
  await pool.end();
});

beforeEach(() => {
  vi.restoreAllMocks();
});

// Build a unique weekStartDate per test by walking back N weeks from a fixed
// base. Fixed base avoids collision with anything else in this test file.
// NOTE: schema.ts → getWeekStartDate() treats Sunday as day 0 (week start),
// so weekStartDate must be a SUNDAY for the /submit route's Monday-check
// (which is really a "first day of week" check) to pass.
const BASE_WEEK_START = new Date(Date.UTC(2025, 0, 5)); // 2025-01-05 is a Sunday
let weekOffset = 0;
function nextWeekStart(): string {
  const d = new Date(BASE_WEEK_START);
  d.setUTCDate(d.getUTCDate() - weekOffset * 7);
  weekOffset += 1;
  return d.toISOString().slice(0, 10);
}

async function makeTimesheet(opts: {
  userId: string;
  status: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";
  approvedByUserId?: string;
}) {
  const weekStart = nextWeekStart();
  const ts = await storage.createTimesheetWeek({
    orgId: ORG_ID,
    userId: opts.userId,
    weekStartDate: weekStart,
    status: opts.status as any,
    approvedByUserId: opts.approvedByUserId ?? null,
    rejectionReason: null,
  });
  if (opts.status !== "DRAFT") {
    const extra: any = {};
    if (opts.status === "SUBMITTED") extra.submittedAt = new Date();
    if (opts.status === "APPROVED") {
      extra.submittedAt = new Date();
      extra.approvedAt = new Date();
      extra.approvedByUserId = opts.approvedByUserId ?? MANAGER_USER_ID;
    }
    await storage.updateTimesheetWeekStatus(ts.id, ORG_ID, opts.status, extra);
  }
  createdTsIds.push(ts.id);
  return ts;
}

async function postJson(path: string, body: any, headers: Record<string, string> = {}) {
  const res = await fetch(baseUrl + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  let parsed: any;
  try { parsed = await res.json(); } catch { parsed = null; }
  return { status: res.status, body: parsed };
}

async function getJson(path: string, headers: Record<string, string> = {}) {
  const res = await fetch(baseUrl + path, { headers });
  let parsed: any;
  try { parsed = await res.json(); } catch { parsed = null; }
  return { status: res.status, body: parsed };
}

const teamHeaders = () => ({
  "x-test-user-id": TEAM_USER_ID,
  "x-test-org-id": ORG_ID,
});
const managerHeaders = () => ({
  "x-test-user-id": MANAGER_USER_ID,
  "x-test-org-id": ORG_ID,
});

describe("storage.getRecentTimesheetsForUser", () => {
  it("returns only the requested user's rows, newest first, capped to limit", async () => {
    const tsTeam1 = await makeTimesheet({ userId: TEAM_USER_ID, status: "DRAFT" });
    const tsTeam2 = await makeTimesheet({ userId: TEAM_USER_ID, status: "SUBMITTED" });
    await makeTimesheet({ userId: MANAGER_USER_ID, status: "SUBMITTED" });

    const rows = await storage.getRecentTimesheetsForUser(ORG_ID, TEAM_USER_ID, 8);
    const ids = rows.map(r => r.id);
    expect(ids).toContain(tsTeam1.id);
    expect(ids).toContain(tsTeam2.id);
    // Manager's row must not leak into team member's list
    for (const r of rows) {
      expect(r.userId).toBe(TEAM_USER_ID);
    }
    // Limit honored
    const capped = await storage.getRecentTimesheetsForUser(ORG_ID, TEAM_USER_ID, 1);
    expect(capped.length).toBe(1);
  });
});

describe("GET /api/timesheets/my-recent", () => {
  it("returns 401 when unauthenticated", async () => {
    const r = await getJson("/api/timesheets/my-recent");
    expect(r.status).toBe(401);
  });

  it("returns only the caller's submissions", async () => {
    const mine = await makeTimesheet({ userId: TEAM_USER_ID, status: "SUBMITTED" });
    const theirs = await makeTimesheet({ userId: MANAGER_USER_ID, status: "SUBMITTED" });

    const r = await getJson("/api/timesheets/my-recent", teamHeaders());
    expect(r.status).toBe(200);
    const ids = (r.body as any[]).map(row => row.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
  });
});

describe("POST /api/timesheets/submit — empty-week confirmEmpty gate", () => {
  it("rejects empty-week submit with 400 when confirmEmpty is omitted/false", async () => {
    const weekStart = nextWeekStart(); // a brand-new week with no entries

    const r = await postJson(
      "/api/timesheets/submit",
      { weekStartDate: weekStart },
      teamHeaders(),
    );
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/confirmEmpty/i);

    // No timesheet should have been created for that week
    const ts = await storage.getTimesheetWeek(ORG_ID, TEAM_USER_ID, weekStart);
    expect(ts).toBeUndefined();
  });

  it("accepts empty-week submit with 200 when confirmEmpty=true", async () => {
    const weekStart = nextWeekStart();

    const r = await postJson(
      "/api/timesheets/submit",
      { weekStartDate: weekStart, confirmEmpty: true },
      teamHeaders(),
    );
    expect(r.status).toBe(200);
    expect(r.body?.status).toBe("SUBMITTED");
    expect(r.body?.userId).toBe(TEAM_USER_ID);

    if (r.body?.id) createdTsIds.push(r.body.id);

    const ts = await storage.getTimesheetWeek(ORG_ID, TEAM_USER_ID, weekStart);
    expect(ts?.status).toBe("SUBMITTED");
  });
});

describe("POST /api/timesheets/:id/recall", () => {
  it("returns 401 when unauthenticated", async () => {
    const ts = await makeTimesheet({ userId: TEAM_USER_ID, status: "SUBMITTED" });
    const r = await postJson(`/api/timesheets/${ts.id}/recall`, {});
    expect(r.status).toBe(401);
  });

  it("flips SUBMITTED back to DRAFT for the owner and clears rejectionReason", async () => {
    const ts = await makeTimesheet({ userId: TEAM_USER_ID, status: "SUBMITTED" });
    const r = await postJson(`/api/timesheets/${ts.id}/recall`, {}, teamHeaders());
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });

    const after = await storage.getTimesheetById(ts.id, ORG_ID);
    expect(after?.status).toBe("DRAFT");
    expect(after?.submittedAt).toBeNull();
    expect(after?.rejectionReason).toBeNull();
  });

  it("rejects recall when status is APPROVED", async () => {
    const ts = await makeTimesheet({ userId: TEAM_USER_ID, status: "APPROVED" });
    const r = await postJson(`/api/timesheets/${ts.id}/recall`, {}, teamHeaders());
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/APPROVED/);

    const after = await storage.getTimesheetById(ts.id, ORG_ID);
    expect(after?.status).toBe("APPROVED");
  });

  it("rejects recall when status is DRAFT (nothing to recall)", async () => {
    const ts = await makeTimesheet({ userId: TEAM_USER_ID, status: "DRAFT" });
    const r = await postJson(`/api/timesheets/${ts.id}/recall`, {}, teamHeaders());
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/DRAFT/);
  });

  it("returns 404 (not 403) when caller is not the timesheet owner — no existence oracle for teammates", async () => {
    const ts = await makeTimesheet({ userId: TEAM_USER_ID, status: "SUBMITTED" });
    const r = await postJson(`/api/timesheets/${ts.id}/recall`, {}, managerHeaders());
    // Lock predicate includes userId so non-owners can't distinguish 403-vs-404.
    expect(r.status).toBe(404);

    const after = await storage.getTimesheetById(ts.id, ORG_ID);
    expect(after?.status).toBe("SUBMITTED");
  });

  it("returns 404 when timesheet does not exist", async () => {
    const r = await postJson(`/api/timesheets/00000000-0000-0000-0000-000000000000/recall`, {}, teamHeaders());
    expect(r.status).toBe(404);
  });
});

describe("POST /api/timesheets/submit — manager submits on behalf of a rep", () => {
  it("manager submits a forgotten week for a team member with confirmEmpty", async () => {
    const weekStart = nextWeekStart();

    const r = await postJson(
      "/api/timesheets/submit",
      { targetUserId: TEAM_USER_ID, weekStartDate: weekStart, confirmEmpty: true },
      managerHeaders(),
    );
    expect(r.status).toBe(200);
    expect(r.body?.status).toBe("SUBMITTED");
    expect(r.body?.userId).toBe(TEAM_USER_ID); // belongs to the rep, not the manager
    if (r.body?.id) createdTsIds.push(r.body.id);

    // Verify the rep's storage row reflects the submission
    const ts = await storage.getTimesheetWeek(ORG_ID, TEAM_USER_ID, weekStart);
    expect(ts?.status).toBe("SUBMITTED");
    expect(ts?.userId).toBe(TEAM_USER_ID);
  });

  it("blocks team members from submitting on behalf of another user (403)", async () => {
    const weekStart = nextWeekStart();

    // TEAM_USER trying to submit a week for the manager
    const r = await postJson(
      "/api/timesheets/submit",
      { targetUserId: MANAGER_USER_ID, weekStartDate: weekStart, confirmEmpty: true },
      teamHeaders(),
    );
    expect(r.status).toBe(403);
    expect(r.body.message).toMatch(/managers and admins/i);

    const ts = await storage.getTimesheetWeek(ORG_ID, MANAGER_USER_ID, weekStart);
    expect(ts).toBeUndefined();
  });

  it("returns 404 when the targetUserId does not exist", async () => {
    const weekStart = nextWeekStart();
    const r = await postJson(
      "/api/timesheets/submit",
      {
        targetUserId: "00000000-0000-0000-0000-000000000000",
        weekStartDate: weekStart,
        confirmEmpty: true,
      },
      managerHeaders(),
    );
    expect(r.status).toBe(404);
    expect(r.body.message).toMatch(/not found/i);
  });

  it("still enforces the empty-week confirmEmpty gate when called on behalf of someone", async () => {
    const weekStart = nextWeekStart();
    const r = await postJson(
      "/api/timesheets/submit",
      { targetUserId: TEAM_USER_ID, weekStartDate: weekStart },
      managerHeaders(),
    );
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/confirmEmpty/i);
  });

  it("treats targetUserId === self as an ordinary self-submit (no role check, no on-behalf flag)", async () => {
    const weekStart = nextWeekStart();
    // TEAM_USER includes their own id as targetUserId — should behave the
    // same as omitting it entirely; route silently uses session.userId.
    const r = await postJson(
      "/api/timesheets/submit",
      { targetUserId: TEAM_USER_ID, weekStartDate: weekStart, confirmEmpty: true },
      teamHeaders(),
    );
    expect(r.status).toBe(200);
    expect(r.body?.userId).toBe(TEAM_USER_ID);
    if (r.body?.id) createdTsIds.push(r.body.id);
  });
});

describe("POST /api/timesheets/submit observability", () => {
  it("logs structured error to console.error when the request body fails validation", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Missing weekStartDate triggers zod parse failure → catch block → log fires
    const r = await postJson("/api/timesheets/submit", { confirmEmpty: true }, teamHeaders());
    expect(r.status).toBe(400);

    const matched = errSpy.mock.calls.find(call =>
      typeof call[0] === "string" && call[0] === "[timesheets] submit failed",
    );
    expect(matched).toBeDefined();
    expect(matched![1]).toMatchObject({
      userId: TEAM_USER_ID,
      orgId: ORG_ID,
    });
    errSpy.mockRestore();
  });
});
