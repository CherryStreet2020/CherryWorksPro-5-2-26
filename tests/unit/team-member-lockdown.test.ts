import { describe, it, expect, beforeAll } from "vitest";

import { TEST_BASE as BASE } from "../helpers/base";

let adminCookie = "";
let teamMemberCookie = "";

beforeAll(async () => {
  const adminRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin.test@cwpro.dev", password: "admin123" }),
  });
  const sc1 = adminRes.headers.getSetCookie?.() ?? [];
  adminCookie = sc1.map(c => c.split(";")[0]).join("; ");

  const teamMemberRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "team.test@cwpro.dev", password: "team123" }),
  });
  const sc2 = teamMemberRes.headers.getSetCookie?.() ?? [];
  teamMemberCookie = sc2.map(c => c.split(";")[0]).join("; ");
});

describe("Team Member role lockdown — 403 on admin-only endpoints", () => {
  it("GET /api/clients returns 403 for team member", async () => {
    const res = await fetch(`${BASE}/api/clients`, { headers: { Cookie: teamMemberCookie } });
    expect(res.status).toBe(403);
  });

  it("GET /api/invoices returns 403 for team member", async () => {
    const res = await fetch(`${BASE}/api/invoices`, { headers: { Cookie: teamMemberCookie } });
    expect(res.status).toBe(403);
  });

  it("GET /api/payments returns 403 for team member", async () => {
    const res = await fetch(`${BASE}/api/payments`, { headers: { Cookie: teamMemberCookie } });
    expect(res.status).toBe(403);
  });

  it("GET /api/reports returns 403 for team member", async () => {
    const res = await fetch(`${BASE}/api/reports`, { headers: { Cookie: teamMemberCookie } });
    expect(res.status).toBe(403);
  });

  it("GET /api/dashboard returns 403 for team member", async () => {
    const res = await fetch(`${BASE}/api/dashboard`, { headers: { Cookie: teamMemberCookie } });
    expect(res.status).toBe(403);
  });

  it("GET /api/projects returns 403 for team member", async () => {
    const res = await fetch(`${BASE}/api/projects`, { headers: { Cookie: teamMemberCookie } });
    expect(res.status).toBe(403);
  });

  it("GET /api/users/team-members returns 403 for team member", async () => {
    const res = await fetch(`${BASE}/api/users/team-members`, { headers: { Cookie: teamMemberCookie } });
    expect(res.status).toBe(403);
  });

  it("GET /api/reports/utilization returns 403 for team member", async () => {
    const res = await fetch(`${BASE}/api/reports/utilization`, { headers: { Cookie: teamMemberCookie } });
    expect(res.status).toBe(403);
  });

  it("GET /api/invoices/unpaid returns 403 for team member", async () => {
    const res = await fetch(`${BASE}/api/invoices/unpaid`, { headers: { Cookie: teamMemberCookie } });
    expect(res.status).toBe(403);
  });
});

describe("Team Member-scoped endpoints return correct data", () => {
  it("GET /api/projects returns 403 for team member (admin-only)", async () => {
    const res = await fetch(`${BASE}/api/projects`, { headers: { Cookie: teamMemberCookie } });
    expect(res.status).toBe(403);
  });

  it("GET /api/dashboard/my returns 200 with no dollar amounts", async () => {
    const res = await fetch(`${BASE}/api/dashboard/my`, { headers: { Cookie: teamMemberCookie } });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("hoursThisWeek");
    expect(data).toHaveProperty("timesheetStatus");
    expect(data).toHaveProperty("recentEntries");
    expect(data).toHaveProperty("myProjects");
    for (const entry of data.recentEntries) {
      expect(entry).not.toHaveProperty("rate");
      expect(entry).not.toHaveProperty("invoiced");
      expect(entry).not.toHaveProperty("invoiceLineId");
    }
  });

  it("GET /api/time-entries strips rate for team member", async () => {
    const res = await fetch(`${BASE}/api/time-entries`, { headers: { Cookie: teamMemberCookie } });
    expect(res.status).toBe(200);
    const entries = await res.json();
    expect(Array.isArray(entries)).toBe(true);
    for (const entry of entries) {
      expect(entry).not.toHaveProperty("rate");
      expect(entry).not.toHaveProperty("invoiced");
      expect(entry).not.toHaveProperty("invoiceLineId");
    }
  });
});

describe("Admin can still access all endpoints", () => {
  it("GET /api/clients returns 200 for admin", async () => {
    const res = await fetch(`${BASE}/api/clients`, { headers: { Cookie: adminCookie } });
    expect(res.status).toBe(200);
  });

  it("GET /api/invoices returns 200 for admin", async () => {
    const res = await fetch(`${BASE}/api/invoices`, { headers: { Cookie: adminCookie } });
    expect(res.status).toBe(200);
  });

  it("GET /api/payments returns 200 for admin", async () => {
    const res = await fetch(`${BASE}/api/payments`, { headers: { Cookie: adminCookie } });
    expect(res.status).toBe(200);
  });

  it("GET /api/reports returns 200 for admin", async () => {
    const res = await fetch(`${BASE}/api/reports`, { headers: { Cookie: adminCookie } });
    expect(res.status).toBe(200);
  });

  it("GET /api/dashboard returns 200 for admin", async () => {
    const res = await fetch(`${BASE}/api/dashboard`, { headers: { Cookie: adminCookie } });
    expect(res.status).toBe(200);
  });

  it("GET /api/projects returns 200 for admin", async () => {
    const res = await fetch(`${BASE}/api/projects`, { headers: { Cookie: adminCookie } });
    expect(res.status).toBe(200);
  });

  it("GET /api/time-entries includes rate for admin", async () => {
    const res = await fetch(`${BASE}/api/time-entries`, { headers: { Cookie: adminCookie } });
    expect(res.status).toBe(200);
    const entries = await res.json();
    if (entries.length > 0) {
      expect(entries[0]).toHaveProperty("rate");
    }
  });
});
