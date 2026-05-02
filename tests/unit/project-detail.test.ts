import { describe, it, expect } from "vitest";

import { TEST_BASE as BASE } from "../helpers/base";
interface Ctx { cookie: string; csrfToken: string }
let adminCookie: Ctx = { cookie: "", csrfToken: "" };
let teamMemberCookie: Ctx = { cookie: "", csrfToken: "" };
let projectId = "";

async function api(method: string, path: string, ctx: Ctx, body?: any) {
  const opts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json", Cookie: ctx.cookie, "X-CSRF-Token": ctx.csrfToken },
  };
  if (body) opts.body = JSON.stringify(body);
  return fetch(`${BASE}${path}`, opts);
}

async function login(email: string, password: string): Promise<Ctx> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const cookies = res.headers.getSetCookie?.() ?? [];
  return {
    cookie: cookies.map((c: string) => c.split(";")[0]).join("; "),
    csrfToken: res.headers.get("x-csrf-token") || "",
  };
}

describe("project_detail_endpoint", () => {
  it("setup: login and get a project id", async () => {
    adminCookie = await login("admin.test@cwpro.dev", "admin123");
    teamMemberCookie = await login("team.test@cwpro.dev", "team123");
    const res = await api("GET", "/api/projects", adminCookie);
    expect(res.ok).toBe(true);
    const projects = await res.json();
    expect(projects.length).toBeGreaterThan(0);
    projectId = projects[0].id;
  });

  it("GET /api/projects/:id returns full data shape", async () => {
    const res = await api("GET", `/api/projects/${projectId}`, adminCookie);
    expect(res.ok).toBe(true);
    const data = await res.json();

    expect(data.project).toBeDefined();
    expect(data.project.id).toBe(projectId);
    expect(data.project.clientName).toBeTruthy();

    expect(data.members).toBeDefined();
    expect(Array.isArray(data.members)).toBe(true);

    expect(data.stats).toBeDefined();
    expect(typeof data.stats.totalHoursLogged).toBe("number");
    expect(typeof data.stats.billableHours).toBe("number");
    expect(typeof data.stats.nonBillableHours).toBe("number");
    expect(typeof data.stats.unbilledHours).toBe("number");
    expect(typeof data.stats.unbilledAmount).toBe("number");
    expect(typeof data.stats.totalInvoiced).toBe("number");
    expect(typeof data.stats.totalPaid).toBe("number");
    expect(typeof data.stats.totalOutstanding).toBe("number");
    expect(typeof data.stats.overBudgetHours).toBe("number");

    expect(Array.isArray(data.hoursByMember)).toBe(true);
    expect(Array.isArray(data.recentTimeEntries)).toBe(true);
    expect(Array.isArray(data.invoices)).toBe(true);
    expect(Array.isArray(data.estimates)).toBe(true);
    expect(Array.isArray(data.services)).toBe(true);
  });

  it("stats are computed correctly (hours sum)", async () => {
    const res = await api("GET", `/api/projects/${projectId}`, adminCookie);
    const data = await res.json();
    const { stats, hoursByMember } = data;

    const memberTotalHours = hoursByMember.reduce((s: number, h: any) => s + h.totalHours, 0);
    expect(Math.abs(stats.totalHoursLogged - memberTotalHours)).toBeLessThan(0.02);

    expect(stats.billableHours + stats.nonBillableHours).toBeCloseTo(stats.totalHoursLogged, 1);
  });

  it("hoursByMember sums correctly", async () => {
    const res = await api("GET", `/api/projects/${projectId}`, adminCookie);
    const data = await res.json();
    for (const h of data.hoursByMember) {
      expect(h.billableHours + h.nonBillableHours).toBeCloseTo(h.totalHours, 1);
      expect(h.userName).toBeTruthy();
    }
  });

  it("budget fields present for projects with budgets", async () => {
    const allRes = await api("GET", "/api/projects", adminCookie);
    const allProjects = await allRes.json();
    const withBudget = allProjects.find((p: any) => p.budgetHours);
    if (!withBudget) return;

    const res = await api("GET", `/api/projects/${withBudget.id}`, adminCookie);
    const data = await res.json();
    expect(data.stats.budgetHours).toBeGreaterThan(0);
    expect(typeof data.stats.budgetUsedPercent).toBe("number");
    expect(typeof data.stats.budgetRemaining).toBe("number");
  });

  it("team member cannot access project detail (403)", async () => {
    const res = await api("GET", `/api/projects/${projectId}`, teamMemberCookie);
    expect(res.status).toBe(403);
  });

  it("returns 404 for nonexistent project", async () => {
    const res = await api("GET", "/api/projects/nonexistent-id-999", adminCookie);
    expect(res.status).toBe(404);
  });

  it("PATCH updates budget fields", async () => {
    const res = await api("PATCH", `/api/projects/${projectId}`, adminCookie, {
      budgetHours: 999,
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    });
    expect(res.ok).toBe(true);
    const updated = await res.json();
    expect(Number(updated.budgetHours)).toBe(999);
    expect(updated.startDate).toBe("2026-01-01");
    expect(updated.endDate).toBe("2026-12-31");

    await api("PATCH", `/api/projects/${projectId}`, adminCookie, {
      budgetHours: null,
      startDate: null,
      endDate: null,
    });
  });
});
