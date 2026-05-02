import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import type { AddressInfo, Server } from "node:net";

type MockTimeEntry = {
  id: string;
  projectId: string;
  projectName: string;
  date: string;
  minutes: number;
  billable: boolean;
  invoiced: boolean;
  invoiceLineId: string | null;
  notes: string | null;
  serviceId: string | null;
  serviceName: string | null;
  costRate: string | number | null;
};

type MockInvoiceLine = { id: string; invoiceId: string; orgId: string };
type MockInvoice = { id: string; orgId: string; status: string; dueDate: string | null };
type MockPayment = { id: string; invoiceId: string; orgId: string; date: string };

type DbResults = {
  invoiceLines: MockInvoiceLine[];
  invoices: MockInvoice[];
  payments: MockPayment[];
};

type MockStorage = {
  getDashboardStats: ReturnType<typeof vi.fn>;
  getOutstandingAR: ReturnType<typeof vi.fn>;
  getServiceRevenue: ReturnType<typeof vi.fn>;
  getCollected: ReturnType<typeof vi.fn>;
  getActiveTeamCount: ReturnType<typeof vi.fn>;
  getActiveTeamMembersList: ReturnType<typeof vi.fn>;
  getRecentActivity: ReturnType<typeof vi.fn>;
  getBankConnectionsByOrg: ReturnType<typeof vi.fn>;
  getBankTransactionsByOrg: ReturnType<typeof vi.fn>;
  getTimeEntriesByUser: ReturnType<typeof vi.fn>;
  getUserProjects: ReturnType<typeof vi.fn>;
  getTimesheetWeek: ReturnType<typeof vi.fn>;
};

type MockDb = {
  __setResults(r: DbResults): void;
  select(): { from(table: unknown): SelectChain };
};

type SelectChain = {
  from(table: unknown): SelectChain;
  where(...args: unknown[]): SelectChain;
  orderBy(...args: unknown[]): SelectChain;
  limit(n: number): Promise<unknown[]>;
};

vi.mock("../../server/routes/middleware", () => {
  const passthrough = (req: Request, _res: Response, next: NextFunction) => {
    const session = (req as Request & { session?: Record<string, unknown> }).session;
    if (!session) {
      (req as Request & { session: Record<string, unknown> }).session = {
        userId: "user-1",
        orgId: "org-1",
        role: "ADMIN",
      };
    }
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

vi.mock("../../server/storage", () => {
  const storage: MockStorage = {
    getDashboardStats: vi.fn().mockResolvedValue({}),
    getOutstandingAR: vi.fn().mockResolvedValue(0),
    getServiceRevenue: vi.fn().mockResolvedValue(0),
    getCollected: vi.fn().mockResolvedValue(0),
    getActiveTeamCount: vi.fn().mockResolvedValue({}),
    getActiveTeamMembersList: vi.fn().mockResolvedValue([]),
    getRecentActivity: vi.fn().mockResolvedValue([]),
    getBankConnectionsByOrg: vi.fn().mockResolvedValue([]),
    getBankTransactionsByOrg: vi.fn().mockResolvedValue([]),
    getTimeEntriesByUser: vi.fn(),
    getUserProjects: vi.fn().mockResolvedValue([]),
    getTimesheetWeek: vi.fn().mockResolvedValue(null),
  };
  return { storage };
});

vi.mock("../../server/db", () => {
  const dbResults: DbResults = { invoiceLines: [], invoices: [], payments: [] };
  const buildChain = (rows: unknown[]): SelectChain => {
    const chain: SelectChain = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => Promise.resolve(rows),
    };
    return chain;
  };
  const tableName = (table: unknown): string => {
    const t = table as Record<PropertyKey, unknown>;
    const symName = t?.[Symbol.for("drizzle:Name")];
    if (typeof symName === "string") return symName;
    if (typeof t?.name === "string") return t.name;
    return "";
  };
  const db: MockDb = {
    __setResults(r: DbResults) {
      dbResults.invoiceLines = r.invoiceLines;
      dbResults.invoices = r.invoices;
      dbResults.payments = r.payments;
    },
    select: () => ({
      from: (table: unknown) => {
        const name = tableName(table);
        if (name.includes("invoice_lines")) return buildChain(dbResults.invoiceLines);
        if (name.includes("invoices")) return buildChain(dbResults.invoices);
        if (name.includes("payments")) return buildChain(dbResults.payments);
        return buildChain([]);
      },
    }),
  };
  return { db };
});

let app: Express;
let baseUrl: string;
let server: Server;
let storageMock: MockStorage;

beforeEach(async () => {
  const storageMod = await import("../../server/storage");
  storageMock = (storageMod as unknown as { storage: MockStorage }).storage;
  vi.clearAllMocks();
  storageMock.getUserProjects.mockResolvedValue([]);
  storageMock.getTimesheetWeek.mockResolvedValue(null);

  const { registerDashboardRoutes } = await import("../../server/routes/dashboard-routes");
  app = express();
  app.use(express.json());
  registerDashboardRoutes(app);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve()) as unknown as Server;
  });
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(() => {
  server?.close();
});

const TODAY = new Date().toISOString().split("T")[0];

function unbilledEntry(costRate: string | number | null, idSuffix = "x"): MockTimeEntry {
  return {
    id: `te-${idSuffix}`,
    projectId: "p1",
    projectName: "P1",
    date: TODAY,
    minutes: 60,
    billable: true,
    invoiced: false,
    invoiceLineId: null,
    notes: null,
    serviceId: null,
    serviceName: null,
    costRate,
  };
}

function billedEntry(costRate: string | number | null, lineId = "line-1"): MockTimeEntry {
  return {
    ...unbilledEntry(costRate, `billed-${lineId}`),
    invoiced: true,
    invoiceLineId: lineId,
  };
}

async function getMyDashboard(): Promise<{ earnings: { costRateMissing: boolean } }> {
  const res = await fetch(`${baseUrl}/api/dashboard/my`);
  expect(res.status).toBe(200);
  return (await res.json()) as { earnings: { costRateMissing: boolean } };
}

describe("dashboard /api/dashboard/my cost-rate-missing warning (unbilled entries)", () => {
  it("fires when costRate is null", async () => {
    storageMock.getTimeEntriesByUser.mockResolvedValue([unbilledEntry(null, "null")]);
    const data = await getMyDashboard();
    expect(data.earnings.costRateMissing).toBe(true);
  });

  it("fires when costRate is empty string", async () => {
    storageMock.getTimeEntriesByUser.mockResolvedValue([unbilledEntry("", "empty")]);
    const data = await getMyDashboard();
    expect(data.earnings.costRateMissing).toBe(true);
  });

  it("does NOT fire when costRate is the string '0'", async () => {
    storageMock.getTimeEntriesByUser.mockResolvedValue([unbilledEntry("0", "zerostr")]);
    const data = await getMyDashboard();
    expect(data.earnings.costRateMissing).toBe(false);
  });

  it("does NOT fire when costRate is numeric zero", async () => {
    storageMock.getTimeEntriesByUser.mockResolvedValue([unbilledEntry(0, "zeronum")]);
    const data = await getMyDashboard();
    expect(data.earnings.costRateMissing).toBe(false);
  });

  it("does NOT fire when costRate is a normal positive numeric rate", async () => {
    storageMock.getTimeEntriesByUser.mockResolvedValue([unbilledEntry(125, "pos")]);
    const data = await getMyDashboard();
    expect(data.earnings.costRateMissing).toBe(false);
  });

  it("does NOT fire when costRate is a normal positive string rate", async () => {
    storageMock.getTimeEntriesByUser.mockResolvedValue([unbilledEntry("125.50", "posstr")]);
    const data = await getMyDashboard();
    expect(data.earnings.costRateMissing).toBe(false);
  });

  it("fires when ANY entry in a mixed batch has a missing costRate", async () => {
    storageMock.getTimeEntriesByUser.mockResolvedValue([
      unbilledEntry(125, "good"),
      unbilledEntry(0, "zero"),
      unbilledEntry(null, "bad"),
    ]);
    const data = await getMyDashboard();
    expect(data.earnings.costRateMissing).toBe(true);
  });

  it("does NOT fire when there are no unbilled billable entries", async () => {
    storageMock.getTimeEntriesByUser.mockResolvedValue([
      { ...unbilledEntry(null, "nb"), billable: false },
    ]);
    const data = await getMyDashboard();
    expect(data.earnings.costRateMissing).toBe(false);
  });
});

describe("dashboard /api/dashboard/my cost-rate-missing warning (billed entries)", () => {
  async function withInvoice(status: string): Promise<void> {
    const dbMod = await import("../../server/db");
    (dbMod as unknown as { db: MockDb }).db.__setResults({
      invoiceLines: [{ id: "line-1", invoiceId: "inv-1", orgId: "org-1" }],
      invoices: [{ id: "inv-1", orgId: "org-1", status, dueDate: "2026-01-01" }],
      payments: [],
    });
  }

  it("fires when a billed entry has null costRate", async () => {
    await withInvoice("SENT");
    storageMock.getTimeEntriesByUser.mockResolvedValue([billedEntry(null)]);
    const data = await getMyDashboard();
    expect(data.earnings.costRateMissing).toBe(true);
  });

  it("fires when a billed entry has an empty-string costRate", async () => {
    await withInvoice("PAID");
    storageMock.getTimeEntriesByUser.mockResolvedValue([billedEntry("")]);
    const data = await getMyDashboard();
    expect(data.earnings.costRateMissing).toBe(true);
  });

  it("does NOT fire when a billed entry has costRate '0'", async () => {
    await withInvoice("SENT");
    storageMock.getTimeEntriesByUser.mockResolvedValue([billedEntry("0")]);
    const data = await getMyDashboard();
    expect(data.earnings.costRateMissing).toBe(false);
  });

  it("does NOT fire when a billed entry has numeric-zero costRate", async () => {
    await withInvoice("SENT");
    storageMock.getTimeEntriesByUser.mockResolvedValue([billedEntry(0)]);
    const data = await getMyDashboard();
    expect(data.earnings.costRateMissing).toBe(false);
  });

  it("does NOT fire when a billed entry has a normal positive costRate", async () => {
    await withInvoice("PAID");
    storageMock.getTimeEntriesByUser.mockResolvedValue([billedEntry(150)]);
    const data = await getMyDashboard();
    expect(data.earnings.costRateMissing).toBe(false);
  });
});
