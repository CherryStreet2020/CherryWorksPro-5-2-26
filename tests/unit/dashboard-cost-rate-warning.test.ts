/**
 * GET /api/dashboard/my — plumbing of the member earnings summary.
 *
 * The earnings math itself lives in storage.getMemberEarningsSummary and is pinned
 * against a real database in tests/integration/member-earnings-payout-truth.test.ts
 * (rates, rounding, buckets, cost-rate-missing, agreement with the admin's payout
 * math). This unit file only checks that the route passes the summary through
 * unchanged, trims the recent-payout list to completed payouts, and degrades
 * to an explicit "unavailable" flag — never a silent $0 — when the summary fails.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import type { AddressInfo, Server } from "node:net";

vi.mock("../../server/routes/middleware", () => {
  const passthrough = (req: Request, _res: Response, next: NextFunction) => {
    const r = req as Request & { session?: Record<string, unknown> };
    if (!r.session) r.session = { userId: "user-1", orgId: "org-1", role: "TEAM_MEMBER" };
    next();
  };
  return {
    requireAuth: passthrough,
    requireAdmin: passthrough,
    requireManagerOrAbove: passthrough,
    dashboardBankingLimiter: passthrough,
    sanitizeErrorMessage: (err: { message?: string } | null) => err?.message ?? "error",
  };
});

vi.mock("../../server/storage", () => ({
  storage: {
    getDashboardStats: vi.fn().mockResolvedValue({}),
    getOutstandingAR: vi.fn().mockResolvedValue(0),
    getServiceRevenue: vi.fn().mockResolvedValue(0),
    getCollected: vi.fn().mockResolvedValue(0),
    getActiveTeamCount: vi.fn().mockResolvedValue({}),
    getActiveTeamMembersList: vi.fn().mockResolvedValue([]),
    getRecentActivity: vi.fn().mockResolvedValue([]),
    getBankConnectionsByOrg: vi.fn().mockResolvedValue([]),
    getBankTransactionsByOrg: vi.fn().mockResolvedValue([]),
    getTimeEntriesByUser: vi.fn().mockResolvedValue([]),
    getUserProjects: vi.fn().mockResolvedValue([]),
    getTimesheetWeek: vi.fn().mockResolvedValue(null),
    getMemberEarningsSummary: vi.fn(),
  },
}));

// dashboard-routes imports db at module load for the admin routes; the member route never touches it.
vi.mock("../../server/db", () => ({ db: {} }));

import { storage } from "../../server/storage";
import { registerDashboardRoutes } from "../../server/routes/dashboard-routes";

const storageMock = storage as unknown as { getMemberEarningsSummary: ReturnType<typeof vi.fn> };

let server: Server;
let baseUrl: string;

beforeEach(async () => {
  const app: Express = express();
  app.use(express.json());
  registerDashboardRoutes(app);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.clearAllMocks();
});

function payout(id: string, status: string, kind = "EARNINGS", amount = 100) {
  return { id, payoutDate: "2026-08-10", periodStart: null, periodEnd: null, paymentMethod: "ZELLE", referenceNumber: null, status, amount, kind, linkedMinutes: 0, linkedHours: 0 };
}

function summary(overrides: Record<string, unknown> = {}) {
  return {
    costRateMissing: false,
    unbilled: { hours: 1, minutes: 60, amount: 135, byProject: [] },
    awaitingPayout: { hours: 2, minutes: 120, amount: 270, byProject: [] },
    totalOwed: 405,
    pendingPayouts: { count: 0, amount: 0, hours: 0, reimbursements: { count: 0, amount: 0 } },
    paid: { hours: 0, totalReceived: 0, linkedToHours: { count: 0, amount: 0 }, withoutLinkedHours: { count: 0, amount: 0 } },
    reimbursements: { count: 0, amount: 0 },
    totalReceivedIncludingReimbursements: 0,
    payouts: [] as ReturnType<typeof payout>[],
    entries: [],
    ...overrides,
  };
}

async function getMyDashboard(): Promise<any> {
  const res = await fetch(`${baseUrl}/api/dashboard/my`);
  expect(res.status).toBe(200);
  return res.json();
}

describe("GET /api/dashboard/my — member earnings plumbing", () => {
  it("passes the summary through: costRateMissing, buckets and totalOwed are the storage values", async () => {
    storageMock.getMemberEarningsSummary.mockResolvedValue(summary({ costRateMissing: true }));
    const data = await getMyDashboard();
    expect(storageMock.getMemberEarningsSummary).toHaveBeenCalledWith("org-1", "user-1");
    expect(data.earningsUnavailable).toBe(false);
    expect(data.earnings.costRateMissing).toBe(true);
    expect(data.earnings.totalOwed).toBe(405);
    expect(data.earnings.unbilled).toEqual({ hours: 1, minutes: 60, amount: 135, byProject: [] });
    expect(data.earnings.awaitingPayout.amount).toBe(270);
    // The per-entry ledger is for /api/my/earnings only — the dashboard never carries it.
    expect(data.earnings.entries).toBeUndefined();
  });

  it("does not flag a cost rate when the summary does not", async () => {
    storageMock.getMemberEarningsSummary.mockResolvedValue(summary({ costRateMissing: false }));
    const data = await getMyDashboard();
    expect(data.earnings.costRateMissing).toBe(false);
  });

  it("lists only COMPLETED payouts as recent, at most five, in summary order, keeping their kind", async () => {
    const payouts = [
      payout("p-pending", "PENDING"),
      payout("p1", "COMPLETED"), payout("p2", "COMPLETED", "EXPENSE_REIMBURSEMENT", 89), payout("p3", "COMPLETED"),
      payout("p4", "COMPLETED"), payout("p5", "COMPLETED"), payout("p6", "COMPLETED"),
    ];
    storageMock.getMemberEarningsSummary.mockResolvedValue(summary({ payouts }));
    const data = await getMyDashboard();
    expect(data.earnings.paid.items.map((i: any) => i.id)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    expect(data.earnings.paid.items[1].kind).toBe("EXPENSE_REIMBURSEMENT");
  });

  it("keeps the rest of the dashboard and says so when the summary fails — never a silent $0", async () => {
    storageMock.getMemberEarningsSummary.mockRejectedValue(new Error("payout tables unavailable"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const data = await getMyDashboard();
    spy.mockRestore();
    expect(data.earningsUnavailable).toBe(true);
    expect(data.earnings).toBeNull();
    expect(data.hoursThisWeek).toEqual({ billable: 0, nonBillable: 0, total: 0 });
    expect(data.timesheetStatus).toBe("DRAFT");
  });
});
