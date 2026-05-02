import { describe, it, expect, beforeAll } from "vitest";

import { TEST_BASE as BASE } from "../helpers/base";

let adminCookie = "";
let teamMemberCookie = "";
let teamMemberUserId = "";

beforeAll(async () => {
  const adminRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin.test@cwpro.dev", password: "admin123" }),
  });
  adminCookie = (adminRes.headers.getSetCookie?.() ?? []).map(c => c.split(";")[0]).join("; ");

  const teamMemberRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "team.test@cwpro.dev", password: "team123" }),
  });
  teamMemberCookie = (teamMemberRes.headers.getSetCookie?.() ?? []).map(c => c.split(";")[0]).join("; ");
  const me = await fetch(`${BASE}/api/auth/me`, { headers: { cookie: teamMemberCookie } });
  const user = await me.json();
  teamMemberUserId = user.id;
});

describe("Team Member time entry visibility", () => {
  it("admin sees all time entries", async () => {
    const res = await fetch(`${BASE}/api/time-entries`, { headers: { cookie: adminCookie } });
    expect(res.status).toBe(200);
    const entries = await res.json();
    expect(Array.isArray(entries)).toBe(true);
    const userIds = new Set(entries.map((e: any) => e.userId));
    expect(userIds.size).toBeGreaterThanOrEqual(1);
  });

  it("team member sees only their own time entries", async () => {
    const res = await fetch(`${BASE}/api/time-entries`, { headers: { cookie: teamMemberCookie } });
    expect(res.status).toBe(200);
    const entries = await res.json();
    expect(Array.isArray(entries)).toBe(true);
    for (const entry of entries) {
      expect(entry.userId).toBe(teamMemberUserId);
    }
  });

  it("team member dashboard /api/dashboard/my returns valid data", async () => {
    const res = await fetch(`${BASE}/api/dashboard/my`, { headers: { cookie: teamMemberCookie } });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("hoursThisWeek");
    expect(data.hoursThisWeek).toHaveProperty("billable");
    expect(data.hoursThisWeek).toHaveProperty("nonBillable");
    expect(data.hoursThisWeek).toHaveProperty("total");
    expect(data).toHaveProperty("timesheetStatus");
    expect(data).toHaveProperty("myProjects");
  });
});

describe("Unbilled preview endpoint", () => {
  it("returns 400 without clientId", async () => {
    const res = await fetch(`${BASE}/api/time-entries/unbilled-preview`, { headers: { cookie: adminCookie } });
    expect(res.status).toBe(400);
  });

  it("returns preview with valid clientId", async () => {
    const clientsRes = await fetch(`${BASE}/api/clients`, { headers: { cookie: adminCookie } });
    const clients = await clientsRes.json();
    expect(clients.length).toBeGreaterThan(0);
    const clientId = clients[0].id;
    const res = await fetch(`${BASE}/api/time-entries/unbilled-preview?clientId=${clientId}`, { headers: { cookie: adminCookie } });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("entries");
    expect(data).toHaveProperty("totalHours");
    expect(data).toHaveProperty("totalAmount");
    expect(data).toHaveProperty("byProject");
    expect(Array.isArray(data.entries)).toBe(true);
    expect(typeof data.totalHours).toBe("number");
    expect(typeof data.totalAmount).toBe("number");
  });
});
