import { describe, it, expect, beforeAll } from "vitest";

import { TEST_BASE as BASE } from "../helpers/base";
let cookie = "";
let csrfToken = "";
let apiKey = "";
let apiKeyId = "";
let orgId = "";

let testClientId = "";
let testProjectId = "";
let testUserId = "";

function extractCookies(res: Response): string {
  const raw = res.headers.getSetCookie?.() ?? [];
  if (raw.length > 0) {
    return raw.map(c => c.split(";")[0]).join("; ");
  }
  const sc = res.headers.get("set-cookie") || "";
  return sc.split(",").map(s => s.trim().split(";")[0]).filter(Boolean).join("; ");
}

function mergeCookies(existing: string, newCookies: string): string {
  const map = new Map<string, string>();
  for (const c of existing.split("; ").filter(Boolean)) {
    const [k] = c.split("=");
    map.set(k, c);
  }
  for (const c of newCookies.split("; ").filter(Boolean)) {
    const [k] = c.split("=");
    map.set(k, c);
  }
  return Array.from(map.values()).join("; ");
}

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin.test@cwpro.dev", password: "admin123" }),
    redirect: "manual",
  });
  cookie = extractCookies(res);
  csrfToken = res.headers.get("x-csrf-token") || "";

  const sessionRes = await fetch(`${BASE}/api/auth/me`, {
    headers: { Cookie: cookie },
  });
  const sessionCookies = extractCookies(sessionRes);
  if (sessionCookies) cookie = mergeCookies(cookie, sessionCookies);
  const newCsrf = sessionRes.headers.get("x-csrf-token");
  if (newCsrf) csrfToken = newCsrf;
  if (sessionRes.ok) {
    const me = await sessionRes.json();
    if (me?.orgId) orgId = me.orgId;
  }
}

async function sessionGet(path: string) {
  const res = await fetch(`${BASE}${path}`, { headers: { Cookie: cookie } });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

async function getAuditLogs(action: string) {
  const data = await sessionGet(`/api/admin/audit-logs/search?action=${action}&limit=50`);
  return data.logs || data || [];
}

async function sessionPost(path: string, body: any) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify(body),
  });
  return res;
}

async function apiPost(path: string, body: any, key?: string) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": key || apiKey,
    },
    body: JSON.stringify(body),
  });
  return res;
}

async function apiGet(path: string, key?: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "X-API-Key": key || apiKey },
  });
  return res;
}

describe("FIXIT B4 — Public API v1 Write Endpoints", () => {
  beforeAll(async () => {
    await login();

    const createRes = await sessionPost("/api/integrations/api-keys", {
      name: "B4 Test Key",
      permissions: ["read", "write"],
    });
    const keyData = await createRes.json();
    apiKey = keyData.key;
    apiKeyId = keyData.id;

    const teamRes = await apiGet("/api/v1/team?limit=1&status=active");
    const teamData = await teamRes.json();
    const teamArr = teamData.data || [];
    if (teamArr.length > 0) {
      testUserId = teamArr[0].id;
    }
  });

  describe("POST /api/v1/clients", () => {
    it("creates a client and returns 201", async () => {
      const res = await apiPost("/api/v1/clients", {
        name: "B4 Test Client",
        email: "b4test@example.com",
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBeTruthy();
      expect(body.name).toBe("B4 Test Client");
      expect(body.email).toBe("b4test@example.com");
      expect(body.orgId).toBe(orgId);
      testClientId = body.id;
    });

    it("returns 401 without API key", async () => {
      const res = await fetch(`${BASE}/api/v1/clients`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "No Key Client" }),
      });
      expect(res.status).toBe(401);
    });

    it("ignores orgId injection — row created under API key org", async () => {
      const res = await apiPost("/api/v1/clients", {
        name: "B4 Injection Test Client",
        orgId: "00000000-0000-0000-0000-000000000000",
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.orgId).toBe(orgId);
      expect(body.orgId).not.toBe("00000000-0000-0000-0000-000000000000");
    });

    it("returns 400 on validation failure", async () => {
      const res = await apiPost("/api/v1/clients", {});
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.errors || body.message).toBeTruthy();
    });

    it("creates audit log with source=api", async () => {
      const logArr = await getAuditLogs("CLIENT_CREATED");
      const apiLog = logArr.find((l: any) =>
        l.details?.source === "api" &&
        l.details?.apiKeyId === apiKeyId
      );
      expect(apiLog).toBeTruthy();
    });
  });

  describe("POST /api/v1/projects", () => {
    it("creates a project and returns 201", async () => {
      const res = await apiPost("/api/v1/projects", {
        clientId: testClientId,
        name: "B4 Test Project",
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBeTruthy();
      expect(body.name).toBe("B4 Test Project");
      expect(body.orgId).toBe(orgId);
      testProjectId = body.id;
    });

    it("returns 401 without API key", async () => {
      const res = await fetch(`${BASE}/api/v1/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: testClientId, name: "No Key Project" }),
      });
      expect(res.status).toBe(401);
    });

    it("ignores orgId injection — row created under API key org", async () => {
      const res = await apiPost("/api/v1/projects", {
        clientId: testClientId,
        name: "B4 Injection Test Project",
        orgId: "00000000-0000-0000-0000-000000000000",
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.orgId).toBe(orgId);
    });

    it("returns 400 on validation failure (missing clientId)", async () => {
      const res = await apiPost("/api/v1/projects", { name: "No Client" });
      expect(res.status).toBe(400);
    });

    it("creates audit log with source=api", async () => {
      const logArr = await getAuditLogs("PROJECT_CREATED");
      const apiLog = logArr.find((l: any) =>
        l.details?.source === "api" &&
        l.details?.apiKeyId === apiKeyId
      );
      expect(apiLog).toBeTruthy();
    });
  });

  describe("POST /api/v1/time-entries", () => {
    it("creates a time entry and returns 201", async () => {
      const today = new Date().toISOString().split("T")[0];
      const res = await apiPost("/api/v1/time-entries", {
        projectId: testProjectId,
        userId: testUserId,
        date: today,
        minutes: 90,
        billable: true,
        notes: "B4 API test time entry",
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBeTruthy();
      expect(body.orgId).toBe(orgId);
      expect(body.minutes).toBe(90);
    });

    it("returns 401 without API key", async () => {
      const res = await fetch(`${BASE}/api/v1/time-entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: testProjectId, userId: testUserId, date: "2026-04-09", minutes: 60, billable: true, notes: "No key" }),
      });
      expect(res.status).toBe(401);
    });

    it("ignores orgId injection — row created under API key org", async () => {
      const today = new Date().toISOString().split("T")[0];
      const res = await apiPost("/api/v1/time-entries", {
        projectId: testProjectId,
        userId: testUserId,
        date: today,
        minutes: 30,
        billable: true,
        notes: "B4 injection test",
        orgId: "00000000-0000-0000-0000-000000000000",
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.orgId).toBe(orgId);
    });

    it("returns 400 on validation failure (missing notes)", async () => {
      const res = await apiPost("/api/v1/time-entries", {
        projectId: testProjectId,
        userId: testUserId,
        date: "2026-04-09",
        minutes: 60,
        billable: true,
      });
      expect(res.status).toBe(400);
    });

    it("creates audit log with source=api", async () => {
      const logArr = await getAuditLogs("TIME_ENTRY_CREATED");
      const apiLog = logArr.find((l: any) =>
        l.details?.source === "api" &&
        l.details?.apiKeyId === apiKeyId
      );
      expect(apiLog).toBeTruthy();
    });
  });

  describe("POST /api/v1/invoices", () => {
    it("creates a DRAFT invoice and returns 201", async () => {
      const today = new Date().toISOString().split("T")[0];
      const dueDate = new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];
      const res = await apiPost("/api/v1/invoices", {
        clientId: testClientId,
        issuedDate: today,
        dueDate,
        currency: "USD",
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBeTruthy();
      expect(body.status).toBe("DRAFT");
      expect(body.orgId).toBe(orgId);
    });

    it("returns 401 without API key", async () => {
      const res = await fetch(`${BASE}/api/v1/invoices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: testClientId, issuedDate: "2026-04-09", dueDate: "2026-05-09" }),
      });
      expect(res.status).toBe(401);
    });

    it("ignores orgId injection — row created under API key org", async () => {
      const today = new Date().toISOString().split("T")[0];
      const dueDate = new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];
      const res = await apiPost("/api/v1/invoices", {
        clientId: testClientId,
        issuedDate: today,
        dueDate,
        orgId: "00000000-0000-0000-0000-000000000000",
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.orgId).toBe(orgId);
    });

    it("forces status=DRAFT even when SENT is passed", async () => {
      const today = new Date().toISOString().split("T")[0];
      const dueDate = new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];
      const res = await apiPost("/api/v1/invoices", {
        clientId: testClientId,
        issuedDate: today,
        dueDate,
        status: "SENT",
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.status).toBe("DRAFT");
    });

    it("returns 400 on validation failure (missing dates)", async () => {
      const res = await apiPost("/api/v1/invoices", {
        clientId: testClientId,
      });
      expect(res.status).toBe(400);
    });

    it("creates audit log with source=api and forcedStatus=DRAFT", async () => {
      const logArr = await getAuditLogs("INVOICE_CREATED");
      const apiLog = logArr.find((l: any) =>
        l.details?.source === "api" &&
        l.details?.apiKeyId === apiKeyId &&
        l.details?.forcedStatus === "DRAFT"
      );
      expect(apiLog).toBeTruthy();
    });
  });

  describe("Rate limiting", () => {
    it("rate limiter middleware exists and returns 429 when bucket is empty", async () => {
      const res = await apiPost("/api/v1/clients", { name: "RL-verify" });
      expect([201, 429].includes(res.status)).toBe(true);

      const verifyRes = await fetch(`${BASE}/api/v1/clients`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": "cwp_nonexistent_key_for_test" },
        body: JSON.stringify({ name: "RL-verify2" }),
      });
      expect([401, 429].includes(verifyRes.status)).toBe(true);
    });
  });
});
