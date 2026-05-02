import { describe, it, expect, beforeAll } from "vitest";

import { TEST_BASE as BASE } from "../helpers/base";
let cookie = "";

beforeAll(async () => {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin.test@cwpro.dev", password: "admin123" }),
  });
  const raw = res.headers.getSetCookie?.() ?? [];
  cookie = raw.map(c => c.split(";")[0]).join("; ");
});

describe("Report CSV Exports", () => {
  it("GET /api/reports/revenue/csv returns text/csv content-type", async () => {
    const res = await fetch(`${BASE}/api/reports/revenue/csv`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const text = await res.text();
    expect(text.split("\n")[0]).toContain("month");
  });

  it("GET /api/reports/ar-aging/csv returns csv", async () => {
    const res = await fetch(`${BASE}/api/reports/ar-aging/csv`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
  });

  it("GET /api/reports/utilization/csv returns csv", async () => {
    const res = await fetch(`${BASE}/api/reports/utilization/csv`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
  });

  it("GET /api/reports/profitability/csv returns csv", async () => {
    const res = await fetch(`${BASE}/api/reports/profitability/csv?startDate=2024-01-01&endDate=2026-12-31`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
  });

  it("GET /api/reports/wip-aging/csv returns csv", async () => {
    const res = await fetch(`${BASE}/api/reports/wip-aging/csv`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
  });

  it("CSV exports require auth", async () => {
    const res = await fetch(`${BASE}/api/reports/revenue/csv`);
    expect(res.status).toBe(401);
  });
});
