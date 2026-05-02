import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { TEST_BASE as BASE_URL } from "../helpers/base";
import { storage } from "../../server/storage";
import { stripCostFieldsForRole } from "../../server/routes/middleware";

// Belt-and-suspenders coverage for `/api/projects` cost-field exposure.
//
// The route is currently gated behind `requireManagerOrAbove`, so a
// TEAM_MEMBER session just gets a 403 (covered by
// `project-routes-cost-visibility.test.ts`). If a future change relaxes the
// gate — e.g. to let team members see projects they're a member of — the
// `stripCostFieldsForRole(scoped, currentUser?.role)` call inside the
// handler becomes the only line of defense.
//
// This file pins down two contracts that together fail loudly in that
// scenario:
//   1. The exact route source still calls `stripCostFieldsForRole` on the
//      list response. If somebody removes the wrapper while opening the
//      gate, this assertion screams.
//   2. The real shape returned by `storage.getProjectsByOrg` (the same
//      function the route uses) — when run through `stripCostFieldsForRole`
//      with role = "TEAM_MEMBER" — is fully scrubbed of every sensitive
//      financial field on every nested member row. This is the
//      "hypothetical TEAM_MEMBER-accessible response shape" the task asks
//      for, exercised against a real DB row rather than a hand-rolled
//      fixture.

interface SessionContext {
  cookies: string;
  csrfToken: string;
  userId: string;
  orgId: string;
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
    orgId: body.orgId || body.user?.orgId || "",
    role: body.role || body.user?.role || "",
  };
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

describe("/api/projects — TEAM_MEMBER cost-field stripping (hypothetical-gate guard)", () => {
  let admin: SessionContext;
  let teamMember: SessionContext;
  let projectId = "";
  // Distinctive non-zero cost rate so the "rate is present pre-strip" sanity
  // assertion is meaningful (proves the seed actually populated the column).
  const SEEDED_COST_RATE = "57.00";

  beforeAll(async () => {
    admin = await login("admin.test@cwpro.dev", "admin123");
    teamMember = await login("team.test@cwpro.dev", "team123");

    expect(admin.role).toBe("ADMIN");
    expect(teamMember.role).toBe("TEAM_MEMBER");
    expect(admin.orgId).toBeTruthy();
    expect(admin.orgId).toBe(teamMember.orgId);

    // Seed via admin so the storage row has the same shape the route would
    // serve. addProjectMember is ON CONFLICT DO UPDATE, so re-runs are safe.
    const list = await fetch(`${BASE_URL}/api/projects`, { headers: { Cookie: admin.cookies } });
    expect(list.status).toBe(200);
    const projects = await list.json();
    const seeded = projects.find((p: any) => p.name === "QA Test Project") || projects[0];
    projectId = seeded.id;

    const addRes = await apiPost(admin, `/api/projects/${projectId}/members`, {
      userId: teamMember.userId,
      hourlyRate: 150,
      costRateHourly: Number(SEEDED_COST_RATE),
    });
    expect(addRes.status).toBe(200);
  }, 30000);

  it("storage layer returns costRateHourly on member rows (sanity — seed worked)", async () => {
    const rows = await storage.getProjectsByOrg(admin.orgId);
    const project = rows.find((p: any) => p.id === projectId);
    expect(project).toBeDefined();
    const membership = project!.members.find((m: any) => m.userId === teamMember.userId);
    expect(membership).toBeDefined();
    expect(membership).toHaveProperty("costRateHourly");
    expect(Number((membership as any).costRateHourly)).toBeCloseTo(Number(SEEDED_COST_RATE), 2);
  });

  it("stripCostFieldsForRole(TEAM_MEMBER) scrubs the real /api/projects response shape", async () => {
    // This is the exact computation the route performs, minus the
    // requireManagerOrAbove gate. If the gate is relaxed in the future, this
    // is what TEAM_MEMBER will receive — and it MUST be free of cost data.
    const raw = await storage.getProjectsByOrg(admin.orgId);
    const stripped = stripCostFieldsForRole(raw, "TEAM_MEMBER");

    expect(Array.isArray(stripped)).toBe(true);
    expect(stripped.length).toBeGreaterThan(0);

    const project = stripped.find((p: any) => p.id === projectId);
    expect(project).toBeDefined();
    expect(Array.isArray(project.members)).toBe(true);
    expect(project.members.length).toBeGreaterThan(0);

    for (const m of project.members) {
      // Cost rate must not leak on any member row.
      expect(m).not.toHaveProperty("costRateHourly");
      // Bill rate stays visible — it is not a cost field.
      expect(m).toHaveProperty("hourlyRate");
    }

    // Recursively assert the entire response — every project, every member,
    // every nested object — is free of the full sensitive-field set.
    assertNoSensitiveFields(stripped);
  });

  it("the GET /api/projects handler still wraps its response in stripCostFieldsForRole", () => {
    // Static guard: if a future contributor removes the stripper from the
    // list route (especially while loosening the gate), this test fails
    // loudly and points them at the contract above.
    const routeSrc = readFileSync(
      resolve(__dirname, "../../server/routes/project-routes.ts"),
      "utf8",
    );
    // Find the GET /api/projects handler block (not /api/projects/:id, not POST).
    const listHandlerMatch = routeSrc.match(
      /app\.get\("\/api\/projects",[\s\S]*?\}\)\;/,
    );
    expect(listHandlerMatch, "GET /api/projects handler not found in project-routes.ts").not.toBeNull();
    const handlerBody = listHandlerMatch![0];
    expect(handlerBody).toMatch(/stripCostFieldsForRole\s*\(/);
  });
});
