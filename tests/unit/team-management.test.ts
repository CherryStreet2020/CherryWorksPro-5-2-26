import { describe, it, expect, beforeAll } from "vitest";

import { TEST_BASE as BASE } from "../helpers/base";

interface Ctx { cookie: string; csrfToken: string }
let adminCookie: Ctx = { cookie: "", csrfToken: "" };
let teamMemberCookie: Ctx = { cookie: "", csrfToken: "" };

async function api(method: string, path: string, ctx: Ctx, body?: unknown) {
  const opts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json", Cookie: ctx.cookie, "X-CSRF-Token": ctx.csrfToken },
  };
  if (body) opts.body = JSON.stringify(body);
  return fetch(`${BASE}${path}`, opts);
}

async function loginAs(email: string, password: string): Promise<Ctx> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const sc = res.headers.getSetCookie?.() ?? [];
  return {
    cookie: sc.map(c => c.split(";")[0]).join("; "),
    csrfToken: res.headers.get("x-csrf-token") || "",
  };
}

beforeAll(async () => {
  adminCookie = await loginAs("admin.test@cwpro.dev", "admin123");
  teamMemberCookie = await loginAs("team.test@cwpro.dev", "team123");
});

describe("Team Management API", () => {
  it("GET /api/team returns 200 for admin with user data", async () => {
    const res = await api("GET", "/api/team", adminCookie);
    expect(res.status).toBe(200);
    const members = await res.json();
    expect(Array.isArray(members)).toBe(true);
    expect(members.length).toBeGreaterThan(0);
    const admin = members.find((m: any) => m.email === "admin.test@cwpro.dev");
    expect(admin).toBeDefined();
    expect(admin.name).toBe("Ada Adminson");
    expect(admin.role).toBe("ADMIN");
    expect(typeof admin.projectCount).toBe("number");
    expect(typeof admin.totalHoursThisMonth).toBe("number");
    expect(admin.password).toBeUndefined();
  });

  it("GET /api/team returns 403 for team member", async () => {
    const res = await api("GET", "/api/team", teamMemberCookie);
    expect(res.status).toBe(403);
  });

  const testEmail = `testinvite_${Date.now()}@cherrystconsulting.com`;
  let invitedUserId = "";
  it("POST /api/team/invite creates user with temp password", async () => {
    const res = await api("POST", "/api/team/invite", adminCookie, {
      name: "Test Invite User",
      email: testEmail,
      role: "TEAM_MEMBER",
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.user).toBeDefined();
    expect(data.user.email).toBe(testEmail);
    expect(data.user.role).toBe("TEAM_MEMBER");
    expect(data.user.tempPassword).toBe(true);
    expect(data.emailSent).toBe(false);
    expect(typeof data.inviteUrl).toBe("string");
    expect(data.inviteUrl).toContain("tempPassword=");
    invitedUserId = data.user.id;
  });

  it("POST /api/team/invite rejects duplicate email", async () => {
    const res = await api("POST", "/api/team/invite", adminCookie, {
      name: "Duplicate User",
      email: testEmail,
    });
    expect(res.status).toBe(409);
  });

  it("POST /api/team/:id/deactivate sets isActive=false", async () => {
    const res = await api("POST", `/api/team/${invitedUserId}/deactivate`, adminCookie);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.isActive).toBe(false);
  });

  it("PATCH /api/team/:id updates user fields", async () => {
    const res = await api("PATCH", `/api/team/${invitedUserId}`, adminCookie, {
      name: "Updated Name",
      isActive: true,
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe("Updated Name");
    expect(data.isActive).toBe(true);
  });

  it("POST /api/team/:id/reset-password generates new temp password", async () => {
    const res = await api("POST", `/api/team/${invitedUserId}/reset-password`, adminCookie);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("emailSent");
    const updated = await api("GET", "/api/team", adminCookie);
    const members = await updated.json();
    const target = members.find((m: any) => m.id === invitedUserId);
    expect(target).toBeDefined();
    expect(target.tempPassword).toBe(true);
  });
});

describe("Auth self-service endpoints", () => {
  it("PATCH /api/auth/change-password works with current password", async () => {
    const res = await api("PATCH", "/api/auth/change-password", teamMemberCookie, {
      currentPassword: "team123",
      newPassword: "team123",
    });
    expect(res.status).toBe(200);
  });

  it("PATCH /api/auth/change-password rejects wrong current password", async () => {
    const res = await api("PATCH", "/api/auth/change-password", teamMemberCookie, {
      currentPassword: "wrongpassword",
      newPassword: "newpassword123",
    });
    expect(res.status).toBe(401);
  });

  it("PATCH /api/auth/change-password rejects short password", async () => {
    const res = await api("PATCH", "/api/auth/change-password", teamMemberCookie, {
      currentPassword: "team123",
      newPassword: "short",
    });
    expect(res.status).toBe(400);
  });

  it("GET /api/auth/me includes new fields", async () => {
    const res = await api("GET", "/api/auth/me", adminCookie);
    expect(res.status).toBe(200);
    const user = await res.json();
    expect(user).toHaveProperty("isActive");
    expect(user).toHaveProperty("onboardingComplete");
    expect(user).toHaveProperty("tempPassword");
  });
});
