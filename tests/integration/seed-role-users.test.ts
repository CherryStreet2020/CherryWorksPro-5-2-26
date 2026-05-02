import { describe, it, expect, beforeAll } from "vitest";

import { TEST_BASE as BASE_URL } from "../helpers/base";

interface SessionContext {
  cookies: string;
  csrfToken: string;
  role: string;
  email: string;
}

async function loginAs(email: string, password: string): Promise<SessionContext> {
  const csrfRes = await fetch(`${BASE_URL}/api/csrf-token`);
  const csrfCookies = csrfRes.headers.getSetCookie();
  const csrfToken = csrfRes.headers.get("x-csrf-token")!;
  const cookieJar = csrfCookies.map((c) => c.split(";")[0]).join("; ");

  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieJar,
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({ email, password }),
    redirect: "manual",
  });

  expect(loginRes.status).toBe(200);
  const loginBody = await loginRes.json();

  const allCookies = [
    ...csrfCookies.map((c) => c.split(";")[0]),
    ...loginRes.headers.getSetCookie().map((c) => c.split(";")[0]),
  ].join("; ");

  return {
    cookies: allCookies,
    csrfToken: loginRes.headers.get("x-csrf-token") || csrfToken,
    role: loginBody.role || loginBody.user?.role,
    email,
  };
}

async function apiGet(ctx: SessionContext, path: string): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    headers: { Cookie: ctx.cookies },
  });
}

describe("P1-SEED: Dev QA seed users and role-based access", () => {
  let admin: SessionContext;
  let manager: SessionContext;
  let teamMember: SessionContext;

  beforeAll(async () => {
    admin = await loginAs("admin.test@cwpro.dev", "admin123");
    manager = await loginAs("manager.test@cwpro.dev", "manager123");
    teamMember = await loginAs("team.test@cwpro.dev", "team123");
  }, 30000);

  describe("Login and role verification", () => {
    it("admin user should have ADMIN role", () => {
      expect(admin.role).toBe("ADMIN");
    });
    it("manager user should have MANAGER role", () => {
      expect(manager.role).toBe("MANAGER");
    });
    it("team member user should have TEAM_MEMBER role", () => {
      expect(teamMember.role).toBe("TEAM_MEMBER");
    });
  });

  describe("/api/auth/me returns correct role", () => {
    it("admin /api/auth/me returns ADMIN", async () => {
      const res = await apiGet(admin, "/api/auth/me");
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.role).toBe("ADMIN");
    });
    it("manager /api/auth/me returns MANAGER", async () => {
      const res = await apiGet(manager, "/api/auth/me");
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.role).toBe("MANAGER");
    });
    it("team member /api/auth/me returns TEAM_MEMBER", async () => {
      const res = await apiGet(teamMember, "/api/auth/me");
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.role).toBe("TEAM_MEMBER");
    });
  });

  describe("Admin-only routes (requireAdmin)", () => {
    it("ADMIN can GET /api/org/settings", async () => {
      const res = await apiGet(admin, "/api/org/settings");
      expect(res.status).toBe(200);
    });
    it("MANAGER cannot GET /api/org/settings (403)", async () => {
      const res = await apiGet(manager, "/api/org/settings");
      expect(res.status).toBe(403);
    });
    it("TEAM_MEMBER cannot GET /api/org/settings (403)", async () => {
      const res = await apiGet(teamMember, "/api/org/settings");
      expect(res.status).toBe(403);
    });
  });

  describe("Manager-or-above routes (requireManagerOrAbove)", () => {
    it("ADMIN can GET /api/clients", async () => {
      const res = await apiGet(admin, "/api/clients");
      expect(res.status).toBe(200);
    });
    it("MANAGER can GET /api/clients", async () => {
      const res = await apiGet(manager, "/api/clients");
      expect(res.status).toBe(200);
    });
    it("TEAM_MEMBER cannot GET /api/clients (403)", async () => {
      const res = await apiGet(teamMember, "/api/clients");
      expect(res.status).toBe(403);
    });
  });

  describe("Team Member-accessible routes (requireAuth only)", () => {
    it("TEAM_MEMBER can GET /api/time-entries", async () => {
      const res = await apiGet(teamMember, "/api/time-entries");
      expect([200, 304]).toContain(res.status);
    });
    it("TEAM_MEMBER can GET /api/auth/me", async () => {
      const res = await apiGet(teamMember, "/api/auth/me");
      expect(res.status).toBe(200);
    });
  });

  // Task #396 — Marketing routes (and the campaign Send Now action)
  // were opened from ADMIN-only to ADMIN+MANAGER. These tests drive the
  // real HTTP routes against the test server (not just middleware-unit
  // mocks) to prove a manager actually gets through, the Send Now gate
  // accepts a manager session, and a non-marketing admin endpoint
  // (feature-flags) still rejects MANAGER.
  describe("Task #396 — Marketing routes are MANAGER-accessible", () => {
    // The campaigns GET requires a `brandId` query param to reach the
    // handler. We don't need a real brand to verify the auth gate —
    // the requireAdminOrManager check fires BEFORE the route's body
    // parsing. So we assert the response is NOT a 401/403, which is
    // the only thing the auth gate can produce. (A missing brand still
    // returns 400, but that proves auth passed.)
    const CAMPAIGNS_PATH =
      "/api/marketing/campaigns?brandId=00000000-0000-0000-0000-000000000000";

    it("ADMIN passes the marketing campaigns auth gate (no 401/403)", async () => {
      const res = await apiGet(admin, CAMPAIGNS_PATH);
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });
    it("MANAGER passes the marketing campaigns auth gate (Task #396 change)", async () => {
      const res = await apiGet(manager, CAMPAIGNS_PATH);
      // Pre-Task-#396 this would have been 403 from `requireAdmin`.
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });
    it("TEAM_MEMBER is blocked by the marketing campaigns auth gate (403)", async () => {
      const res = await apiGet(teamMember, CAMPAIGNS_PATH);
      // The entitlement gate runs FIRST and would 404 stealth on a
      // non-entitled org, but seed orgs are entitled to marketing_os
      // via seedOrgEntitlements(), so the auth gate fires next and
      // produces a 403 for TEAM_MEMBER.
      expect(res.status).toBe(403);
    });
  });

  describe("Task #396 — Campaign Send Now route accepts MANAGER", () => {
    // We don't need a real campaign — we just need to prove the
    // requireAdminOrManager gate on the Send Now route does not
    // 401/403 a MANAGER. Use a non-existent UUID; the handler
    // should respond with a 4xx that is NOT 401/403.
    const SEND_NOW_PATH =
      "/api/marketing/campaigns/00000000-0000-0000-0000-000000000000/send-now";

    async function postCsrf(
      ctx: SessionContext,
      path: string,
    ): Promise<Response> {
      return fetch(`${BASE_URL}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: ctx.cookies,
          "X-CSRF-Token": ctx.csrfToken,
        },
        body: JSON.stringify({}),
      });
    }

    it("ADMIN passes the Send Now auth gate (no 401/403)", async () => {
      const res = await postCsrf(admin, SEND_NOW_PATH);
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });
    it("MANAGER passes the Send Now auth gate (Task #396 change)", async () => {
      const res = await postCsrf(manager, SEND_NOW_PATH);
      // Pre-Task-#396 this would have been 403 from `requireAdmin`.
      // Post-#396 it should pass auth and return a different 4xx
      // (typically 404 campaign-not-found, or 4xx body-validation).
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });
    it("TEAM_MEMBER is blocked by the Send Now auth gate (403)", async () => {
      const res = await postCsrf(teamMember, SEND_NOW_PATH);
      expect(res.status).toBe(403);
    });
  });

  describe("Task #396 regression — non-marketing admin routes still reject MANAGER", () => {
    it("ADMIN can GET /api/admin/feature-flags", async () => {
      const res = await apiGet(admin, "/api/admin/feature-flags");
      expect(res.status).toBe(200);
    });
    it("MANAGER cannot GET /api/admin/feature-flags (403, NOT broadened)", async () => {
      const res = await apiGet(manager, "/api/admin/feature-flags");
      // This is the most important regression check from Task #396:
      // the bulk swap was scoped to /api/marketing/* — admin surfaces
      // like feature-flags must still return 403 for MANAGER.
      expect(res.status).toBe(403);
    });
    it("TEAM_MEMBER cannot GET /api/admin/feature-flags (403)", async () => {
      const res = await apiGet(teamMember, "/api/admin/feature-flags");
      expect(res.status).toBe(403);
    });
  });

  describe("Idempotency: seed can run again without errors", () => {
    it("re-importing seedDevQaUsers does not throw", async () => {
      const { seedDevQaUsers } = await import("../../server/seed-role-test-users");
      await expect(seedDevQaUsers()).resolves.not.toThrow();
    });
  });
});
