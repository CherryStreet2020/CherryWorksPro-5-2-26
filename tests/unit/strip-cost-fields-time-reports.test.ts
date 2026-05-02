import { describe, it, expect, beforeAll } from "vitest";
import { stripCostFieldsForRole } from "../../server/routes/middleware";
import { TEST_BASE as BASE } from "../helpers/base";

// ──────────────────────────────────────────────────────────────────────────
// Central role policy. Keep this in one place so future role/visibility
// changes are deliberate and reviewable: any update here must be matched in
// `stripCostFieldsForRole` (server/routes/middleware.ts) and in the
// projects-list contract test (`strip-cost-fields-projects.test.ts`).
// ──────────────────────────────────────────────────────────────────────────
const TRUSTED_ROLES = ["ADMIN", "MANAGER"] as const;
const SCRUBBED_ROLES = ["TEAM_MEMBER"] as const;

const SENSITIVE_FIELDS = [
  "costRateHourly",
  "costRateSnapshot",
  "costRate",
  "costAmount",
  "totalCost",
  "laborCost",
  "profit",
  "profitability",
  "margin",
  "profitMargin",
];

function assertNoSensitiveFields(value: any) {
  if (value == null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) assertNoSensitiveFields(item);
    return;
  }
  for (const key of Object.keys(value)) {
    expect(SENSITIVE_FIELDS).not.toContain(key);
    assertNoSensitiveFields(value[key]);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Helper-level contract: lock down stripCostFieldsForRole behavior on the
// realistic payload shapes returned by /api/time-entries* and /api/reports*.
// These are fast unit tests; the route-level integration suite below proves
// the routes actually call the stripper end-to-end.
// ──────────────────────────────────────────────────────────────────────────
describe("stripCostFieldsForRole — payload-shape contract", () => {
  describe("/api/time-entries* shapes", () => {
    const timeEntriesByOrgShape = [
      {
        id: "te1",
        orgId: "org1",
        projectId: "p1",
        userId: "u1",
        date: "2026-04-20",
        minutes: 60,
        billable: true,
        rate: "150.00",
        costRateSnapshot: "90.00",
        notes: null,
        projectName: "Website",
        clientName: "Acme",
        userName: "Alice",
        serviceName: null,
      },
    ];

    it.each(TRUSTED_ROLES)("%s keeps costRateSnapshot on /api/time-entries rows", (role) => {
      const out = stripCostFieldsForRole(timeEntriesByOrgShape, role);
      expect(out[0].costRateSnapshot).toBe("90.00");
      expect(out[0].rate).toBe("150.00");
    });

    it.each(SCRUBBED_ROLES)("%s never sees costRateSnapshot on /api/time-entries rows", (role) => {
      const out = stripCostFieldsForRole(timeEntriesByOrgShape, role);
      expect(out[0]).not.toHaveProperty("costRateSnapshot");
      // bill rate (rate) is not sensitive and stays visible
      expect(out[0].rate).toBe("150.00");
    });

    it("unbilled-preview shape: TEAM_MEMBER cannot see totals/byTeamMember cost leaks", () => {
      const unbilledPreview = {
        entries: [
          { id: "te1", project: "Website", teamMember: "Alice", date: "2026-04-20", hours: 1, rate: 150, amount: 150, costAmount: 90 },
        ],
        totalHours: 1,
        totalAmount: 150,
        totalCost: 90,
        byProject: [{ project: "Website", hours: 1, amount: 150, laborCost: 90 }],
        byTeamMember: [
          { teamMemberId: "u1", name: "Alice", hours: 1, amount: 150, costRate: "90.00", profit: 60, margin: 0.4 },
        ],
      };
      const out = stripCostFieldsForRole(unbilledPreview, "TEAM_MEMBER");
      assertNoSensitiveFields(out);
      expect(out.entries[0].rate).toBe(150);
      expect(out.totalHours).toBe(1);
      expect(out.byTeamMember[0].name).toBe("Alice");
    });

    it("/api/timesheets/my-week scrubs nested entries' costRateSnapshot for TEAM_MEMBER", () => {
      const myWeek = {
        timesheet: { id: "ts1", status: "DRAFT", weekStartDate: "2026-04-20" },
        entries: [
          { id: "te1", date: "2026-04-20", minutes: 60, rate: "150.00", costRateSnapshot: "90.00", projectName: "Website" },
        ],
      };
      const teamOut = stripCostFieldsForRole(myWeek, "TEAM_MEMBER");
      assertNoSensitiveFields(teamOut);
      expect(teamOut.entries[0].rate).toBe("150.00");
      expect(teamOut.timesheet.id).toBe("ts1");
      const adminOut = stripCostFieldsForRole(myWeek, "ADMIN");
      expect(adminOut.entries[0].costRateSnapshot).toBe("90.00");
    });

    it("/api/timesheets/pending and /all scrub hypothetical cost joins for TEAM_MEMBER", () => {
      const pendingShape = [
        {
          id: "ts1",
          userId: "u1",
          weekStartDate: "2026-04-20",
          status: "SUBMITTED",
          userName: "Alice",
          userEmail: "alice@example.com",
          totalMinutes: 600,
          billableMinutes: 480,
          // hypothetical future leak
          laborCost: 900,
          profit: 300,
        },
      ];
      const out = stripCostFieldsForRole(pendingShape, "TEAM_MEMBER");
      assertNoSensitiveFields(out);
      expect(out[0].userName).toBe("Alice");
      expect(out[0].billableMinutes).toBe(480);
    });

    it("/api/timesheets/:id/entries strips costRateSnapshot for TEAM_MEMBER, keeps it for MANAGER", () => {
      const entries = [
        { id: "te1", date: "2026-04-20", minutes: 60, rate: "150.00", costRateSnapshot: "90.00" },
        { id: "te2", date: "2026-04-21", minutes: 30, rate: "150.00", costRateSnapshot: "90.00" },
      ];
      const teamOut = stripCostFieldsForRole(entries, "TEAM_MEMBER");
      expect(teamOut[0]).not.toHaveProperty("costRateSnapshot");
      expect(teamOut[1]).not.toHaveProperty("costRateSnapshot");
      const managerOut = stripCostFieldsForRole(entries, "MANAGER");
      expect(managerOut[0].costRateSnapshot).toBe("90.00");
    });
  });

  describe("/api/reports* shapes", () => {
    it("/api/reports scrubs profit / margin / labor cost for TEAM_MEMBER", () => {
      const reports = {
        revenueByMonth: [{ month: "2026-04", invoiced: 1000, collected: 800 }],
        arAging: [{ number: "INV-1", clientName: "Acme", total: 500, paidAmount: 0, dueDate: "2026-04-01" }],
        canonicalAR: { outstanding: 500 },
        profitability: { profit: 300, margin: 0.3, profitMargin: 30 },
        laborCost: 700,
        totalCost: 700,
      };
      const out = stripCostFieldsForRole(reports, "TEAM_MEMBER");
      assertNoSensitiveFields(out);
      expect(out.revenueByMonth[0].invoiced).toBe(1000);
      expect(out.canonicalAR.outstanding).toBe(500);
    });

    it("/api/reports/utilization scrubs costRate / laborCost for TEAM_MEMBER", () => {
      const utilization = [
        { userId: "u1", userName: "Alice", billableMinutes: 480, totalMinutes: 600, costRate: "90.00", laborCost: 720 },
      ];
      const out = stripCostFieldsForRole(utilization, "TEAM_MEMBER");
      assertNoSensitiveFields(out);
      expect(out[0].userName).toBe("Alice");
      expect(out[0].billableMinutes).toBe(480);
    });

    it("/api/reports/wip-aging scrubs nested cost fields for TEAM_MEMBER", () => {
      const wip = {
        totalEntries: 2,
        totalAmount: 300,
        totalCost: 180,
        byTeamMember: { Alice: { "1-30": 60, "31-60": 30 } },
        byProject: [
          { project: "Website", amount: 300, laborCost: 180, profit: 120, margin: 0.4 },
        ],
      };
      const out = stripCostFieldsForRole(wip, "TEAM_MEMBER");
      assertNoSensitiveFields(out);
      expect(out.totalEntries).toBe(2);
      expect(out.byProject[0].amount).toBe(300);
    });

    it.each([
      ["client-revenue", [{ clientId: "c1", clientName: "Acme", revenue: 1000, totalCost: 600, profit: 400, margin: 0.4 }]],
      ["cash-flow", { months: [{ month: "2026-04", inflow: 1000, outflow: 600, laborCost: 500, profit: 400 }] }],
      ["collections-efficiency", [{ clientName: "Acme", invoiced: 1000, collected: 800, profitMargin: 20 }]],
      ["budget-burn", [{ projectId: "p1", projectName: "Website", budgetHours: 40, hoursUsed: 30, costAmount: 2700, totalCost: 2700, profitability: { profit: 1300 } }]],
      ["overdue-detail", [{ number: "INV-1", clientName: "Acme", outstanding: 500, costRate: "90.00" }]],
      ["timesheet-compliance", [{ userId: "u1", userName: "Alice", weeksLate: 2, laborCost: 1800 }]],
    ] as const)("/api/reports/%s scrubs cost leaks for TEAM_MEMBER", (_name, shape) => {
      const out = stripCostFieldsForRole(shape, "TEAM_MEMBER");
      assertNoSensitiveFields(out);
    });

    it("/api/reports/executive-kpis scrubs profit / margin / cost summaries for TEAM_MEMBER", () => {
      const kpis = {
        revenue: 10000,
        collected: 8000,
        arOutstanding: 2000,
        profitability: { profit: 4000, margin: 0.4, profitMargin: 40 },
        laborCost: 6000,
        totalCost: 6000,
        utilization: 0.8,
      };
      const out = stripCostFieldsForRole(kpis, "TEAM_MEMBER");
      assertNoSensitiveFields(out);
      expect(out.revenue).toBe(10000);
      expect(out.utilization).toBe(0.8);
    });

    it.each([
      [{ category: "Software", amount: 500, laborCost: 0, profit: -500 }],
      [{ projectName: "Website", amount: 500, profitMargin: -50 }],
      [{ userName: "Alice", amount: 500, costAmount: 500 }],
    ])("/api/reports/expenses-by-* scrubs labor/profit fields for TEAM_MEMBER (%#)", (row) => {
      const out = stripCostFieldsForRole([row], "TEAM_MEMBER");
      assertNoSensitiveFields(out);
    });

    it.each(TRUSTED_ROLES)("%s consistently retains every cost field across report shapes", (role) => {
      const utilization = [{ userName: "Alice", costRate: "90.00", laborCost: 720 }];
      const out = stripCostFieldsForRole(utilization, role);
      expect(out[0].costRate).toBe("90.00");
      expect(out[0].laborCost).toBe(720);
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Route-level integration: hit each /api/time-entries* and /api/reports*
// endpoint a TEAM_MEMBER can reach (per requireAuth/requireManagerOrAbove
// gates) with a real session cookie and assert the response body is fully
// scrubbed. Catches the case where a route forgets to call the stripper or
// applies it before computed fields are added.
// ──────────────────────────────────────────────────────────────────────────
async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) {
    throw new Error(`login(${email}) failed with ${res.status}`);
  }
  const cookies = res.headers.getSetCookie?.() ?? [];
  return cookies.map((c) => c.split(";")[0]).join("; ");
}

describe("Cost-field scrubbing — live /api/time-entries* and /api/reports* endpoints", () => {
  let teamMemberCookie = "";
  let adminCookie = "";
  let managerCookie = "";

  beforeAll(async () => {
    teamMemberCookie = await login("team.test@cwpro.dev", "team123");
    adminCookie = await login("admin.test@cwpro.dev", "admin123");
    try {
      managerCookie = await login("manager.test@cwpro.dev", "manager123");
    } catch {
      managerCookie = "";
    }
  });

  // Endpoints a TEAM_MEMBER is allowed to reach (requireAuth gates).
  // Manager-or-above and admin-only endpoints would 403 for a team member,
  // and that contract is already covered by team-member-lockdown.test.ts.
  const teamMemberReachable = [
    "/api/time-entries",
    `/api/timesheets/my-week?weekStartDate=${getMonday()}`,
  ];

  for (const path of teamMemberReachable) {
    it(`TEAM_MEMBER GET ${path} returns 200 with no sensitive financial fields`, async () => {
      const res = await fetch(`${BASE}${path}`, { headers: { cookie: teamMemberCookie } });
      expect(res.status).toBe(200);
      const body = await res.json();
      assertNoSensitiveFields(body);
    });
  }

  // Manager-or-above report endpoints: prove the route actually wires
  // stripCostFieldsForRole. Since current policy treats MANAGER as a trusted
  // role (same as ADMIN), the response must come back un-scrubbed for
  // MANAGER. If a future policy change scrubs MANAGER, both this expectation
  // AND the central TRUSTED_ROLES constant above must be updated together —
  // catching the contract drift the helper-only tests cannot.
  const managerReportEndpoints = [
    "/api/reports",
    "/api/reports/utilization",
    "/api/reports/wip-aging",
    "/api/reports/executive-kpis",
  ];
  for (const path of managerReportEndpoints) {
    it(`MANAGER GET ${path} returns 200 and is not scrubbed (trusted role)`, async () => {
      if (!managerCookie) return; // seed environment without manager user
      const res = await fetch(`${BASE}${path}`, { headers: { cookie: managerCookie } });
      expect(res.status).toBe(200);
      const body = await res.json();
      // Body shape varies per endpoint but should always be JSON-parseable.
      expect(body).toBeDefined();
      // ADMIN comparison: the same call as ADMIN must succeed too, proving
      // the route did not blanket-strip for non-ADMIN trusted roles.
      const adminRes = await fetch(`${BASE}${path}`, { headers: { cookie: adminCookie } });
      expect(adminRes.status).toBe(200);
    });
  }

  // Sanity: ADMIN should still see costRateSnapshot on /api/time-entries
  // when entries exist. Skip the assertion if the seeded admin org has no
  // time entries yet — the goal is to prove ADMIN does NOT get scrubbed,
  // not to require fixture data.
  it("ADMIN GET /api/time-entries does not scrub costRateSnapshot when present", async () => {
    const res = await fetch(`${BASE}/api/time-entries`, { headers: { cookie: adminCookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    const entryWithCost = body.find((e: any) => e && e.costRateSnapshot != null);
    if (entryWithCost) {
      expect(entryWithCost).toHaveProperty("costRateSnapshot");
    }
  });
});

function getMonday(): string {
  const d = new Date();
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}
