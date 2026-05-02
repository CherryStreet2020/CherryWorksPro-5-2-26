import { describe, it, expect, beforeAll } from "vitest";

import { TEST_BASE as BASE_URL } from "../helpers/base";

// End-to-end role contract for `stripCostFieldsForRole`-wrapped routes.
// MANAGER (trusted) keeps `costRateHourly` / `profit` / `margin`.
// TEAM_MEMBER (untrusted) has them stripped or is gated 403.

interface SessionContext {
  cookies: string;
  csrfToken: string;
  userId: string;
  role: string;
}

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

function assertNoSensitiveFields(value: any): void {
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

async function login(email: string, password: string): Promise<SessionContext> {
  const csrfRes = await fetch(`${BASE_URL}/api/csrf-token`);
  const csrfCookies = csrfRes.headers.getSetCookie();
  const csrfToken = csrfRes.headers.get("x-csrf-token") || "";
  const csrfJar = csrfCookies.map((c) => c.split(";")[0]).join("; ");

  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: csrfJar,
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({ email, password }),
  });
  if (loginRes.status !== 200) {
    throw new Error(`login(${email}) failed with ${loginRes.status}`);
  }
  const body = await loginRes.json();
  const allCookies = [
    ...csrfCookies.map((c) => c.split(";")[0]),
    ...loginRes.headers.getSetCookie().map((c) => c.split(";")[0]),
  ].join("; ");

  return {
    cookies: allCookies,
    csrfToken: loginRes.headers.get("x-csrf-token") || csrfToken,
    userId: body.id || body.user?.id || "",
    role: body.role || body.user?.role || "",
  };
}

async function apiGet(ctx: SessionContext, path: string): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, { headers: { Cookie: ctx.cookies } });
}

async function apiPost(ctx: SessionContext, path: string, body: any): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: ctx.cookies,
      "X-CSRF-Token": ctx.csrfToken,
    },
    body: JSON.stringify(body),
  });
}

describe("Cost-field visibility — role contract on real routes (e2e)", () => {
  let manager: SessionContext;
  let teamMember: SessionContext;
  let admin: SessionContext;
  let projectId = "";
  // Distinctive non-zero cost rate so MANAGER assertions are positive
  // (not just "field happens to be null and accidentally passes").
  const SEEDED_COST_RATE = "57.00";
  const PROFIT_RANGE = "?startDate=2024-01-01&endDate=2027-12-31";

  beforeAll(async () => {
    admin = await login("admin.test@cwpro.dev", "admin123");
    manager = await login("manager.test@cwpro.dev", "manager123");
    teamMember = await login("team.test@cwpro.dev", "team123");

    expect(manager.role).toBe("MANAGER");
    expect(teamMember.role).toBe("TEAM_MEMBER");

    const listRes = await apiGet(admin, "/api/projects");
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    const seeded = list.find((p: any) => p.name === "QA Test Project") || list[0];
    projectId = seeded.id;

    // Idempotent — `addProjectMember` uses ON CONFLICT DO UPDATE, so re-runs
    // are safe.
    const addRes = await apiPost(admin, `/api/projects/${projectId}/members`, {
      userId: teamMember.userId,
      hourlyRate: 150,
      costRateHourly: Number(SEEDED_COST_RATE),
    });
    expect(addRes.status).toBe(200);
  }, 30000);

  describe("MANAGER (trusted) sees cost / profit / margin", () => {
    it("GET /api/projects exposes costRateHourly on member rows", async () => {
      const res = await apiGet(manager, "/api/projects");
      expect(res.status).toBe(200);
      const list = await res.json();
      const project = list.find((p: any) => p.id === projectId);
      const teamMembership = project.members.find((m: any) => m.userId === teamMember.userId);
      expect(teamMembership).toHaveProperty("costRateHourly");
      expect(Number(teamMembership.costRateHourly)).toBeCloseTo(Number(SEEDED_COST_RATE), 2);
    });

    it("GET /api/projects/:id exposes costRateHourly on member rows", async () => {
      const res = await apiGet(manager, `/api/projects/${projectId}`);
      expect(res.status).toBe(200);
      const detail = await res.json();
      const teamMembership = detail.members.find((m: any) => m.userId === teamMember.userId);
      expect(teamMembership).toHaveProperty("costRateHourly");
      expect(Number(teamMembership.costRateHourly)).toBeCloseTo(Number(SEEDED_COST_RATE), 2);
    });

    it("GET /api/reports/profitability rows expose profit, margin, and cost", async () => {
      const res = await apiGet(manager, `/api/reports/profitability${PROFIT_RANGE}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.rows)).toBe(true);
      expect(body.rows.length).toBeGreaterThan(0);
      for (const row of body.rows) {
        expect(row).toHaveProperty("profit");
        expect(row).toHaveProperty("margin");
        expect(row).toHaveProperty("cost");
        expect(typeof row.profit).toBe("number");
        expect(typeof row.margin).toBe("number");
        expect(Number.isNaN(row.profit)).toBe(false);
        expect(Number.isNaN(row.margin)).toBe(false);
      }
    });
  });

  describe("TEAM_MEMBER (untrusted) — cost / profit / margin are stripped or 403", () => {
    it("GET /api/projects is 403 (requireManagerOrAbove)", async () => {
      const res = await apiGet(teamMember, "/api/projects");
      expect(res.status).toBe(403);
    });

    it("GET /api/projects/:id strips costRateHourly on every member row", async () => {
      const res = await apiGet(teamMember, `/api/projects/${projectId}`);
      expect(res.status).toBe(200);
      const detail = await res.json();
      expect(Array.isArray(detail.members)).toBe(true);
      for (const m of detail.members) {
        expect(m).not.toHaveProperty("costRateHourly");
        // Bill rate stays visible.
        expect(m).toHaveProperty("hourlyRate");
      }
      assertNoSensitiveFields(detail);
    });

    it("GET /api/reports/profitability is 403 (requireManagerOrAbove)", async () => {
      const res = await apiGet(teamMember, `/api/reports/profitability${PROFIT_RANGE}`);
      expect(res.status).toBe(403);
    });
  });
});
