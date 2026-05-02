import { describe, it, expect, beforeAll } from "vitest";

import { TEST_BASE as BASE } from "../helpers/base";
let adminCookie = "";
let teamMemberCookie = "";

beforeAll(async () => {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin.test@cwpro.dev", password: "admin123" }),
  });
  adminCookie = (res.headers.getSetCookie?.() ?? []).map(c => c.split(";")[0]).join("; ");

  const res2 = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "team.test@cwpro.dev", password: "team123" }),
  });
  teamMemberCookie = (res2.headers.getSetCookie?.() ?? []).map(c => c.split(";")[0]).join("; ");
});

describe("Integrity check endpoint", () => {
  it("GET /api/admin/integrity-check returns violations array (admin)", async () => {
    const res = await fetch(`${BASE}/api/admin/integrity-check`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("violations");
    expect(data).toHaveProperty("count");
    expect(Array.isArray(data.violations)).toBe(true);
    expect(typeof data.count).toBe("number");
  });

  it("GET /api/admin/integrity-check returns 403 for team member", async () => {
    const res = await fetch(`${BASE}/api/admin/integrity-check`, {
      headers: { Cookie: teamMemberCookie },
    });
    expect(res.status).toBe(403);
  });

  it("violation objects have correct shape", async () => {
    const res = await fetch(`${BASE}/api/admin/integrity-check`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    for (const v of data.violations) {
      expect(v).toHaveProperty("type");
      expect(v).toHaveProperty("entity");
      expect(v).toHaveProperty("id");
      expect(v).toHaveProperty("detail");
    }
  });
});

describe("Client detail financial integrity", () => {
  it("client detail outstanding is never negative", async () => {
    const clientsRes = await fetch(`${BASE}/api/clients`, {
      headers: { Cookie: adminCookie },
    });
    const clients = await clientsRes.json();
    for (const c of clients.slice(0, 5)) {
      const detailRes = await fetch(`${BASE}/api/clients/${c.id}`, {
        headers: { Cookie: adminCookie },
      });
      if (detailRes.status === 200) {
        const detail = await detailRes.json();
        expect(detail.outstanding).toBeGreaterThanOrEqual(0);
        expect(detail.totalBilled).toBeGreaterThanOrEqual(0);
        expect(detail.totalPaid).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("client detail includes hasOverpayment flag", async () => {
    const clientsRes = await fetch(`${BASE}/api/clients`, {
      headers: { Cookie: adminCookie },
    });
    const clients = await clientsRes.json();
    if (clients.length > 0) {
      const detailRes = await fetch(`${BASE}/api/clients/${clients[0].id}`, {
        headers: { Cookie: adminCookie },
      });
      const detail = await detailRes.json();
      expect(detail).toHaveProperty("hasOverpayment");
      expect(typeof detail.hasOverpayment).toBe("boolean");
    }
  });
});

describe("Test DB reset endpoint", () => {
  it("POST /api/test/reset-db rejects bad secret", async () => {
    const res = await fetch(`${BASE}/api/test/reset-db`, {
      method: "POST",
      headers: { "X-Test-Secret": "wrong-secret" },
    });
    expect(res.status).toBe(403);
  });
});
