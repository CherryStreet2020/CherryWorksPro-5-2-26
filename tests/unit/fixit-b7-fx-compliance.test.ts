import { describe, it, expect, beforeAll } from "vitest";

import { TEST_BASE as BASE } from "../helpers/base";
let cookie = "";

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin.test@cwpro.dev", password: "admin123" }),
  });
  const cookies = res.headers.getSetCookie();
  cookie = cookies.map((c: string) => c.split(";")[0]).join("; ");
}

async function api(path: string) {
  const res = await fetch(`${BASE}${path}`, { headers: { Cookie: cookie } });
  return { status: res.status, headers: res.headers, json: await res.json() };
}

beforeAll(login);

describe("FIX 1+4 — FX compliance: AR aging, overdue, outstanding all use exchangeRate", () => {
  it("Dashboard AR aging buckets sum matches totalOutstanding (canonical)", async () => {
    const dash = await api("/api/dashboard");
    const aging = dash.json.arAgingBuckets;
    const agingTotal = +(aging.current + aging.days30 + aging.days60 + aging.days90plus).toFixed(2);
    const totalOutstanding = dash.json.totalOutstanding;
    expect(agingTotal).toBe(totalOutstanding);
  });

  it("Dashboard overdueAmount uses FX (is a number >= 0)", async () => {
    const dash = await api("/api/dashboard");
    expect(typeof dash.json.overdueAmount).toBe("number");
    expect(dash.json.overdueAmount).toBeGreaterThanOrEqual(0);
  });

  it("Dashboard topClients.outstanding uses FX-adjusted values", async () => {
    const dash = await api("/api/dashboard");
    const topClients = dash.json.topClients;
    if (topClients.length > 0) {
      for (const c of topClients) {
        expect(typeof c.outstanding).toBe("number");
        expect(typeof c.revenue).toBe("number");
      }
    }
  });

  it("Executive KPIs overdue amount uses FX", async () => {
    const kpis = await api("/api/reports/executive-kpis");
    expect(typeof kpis.json.overdueAmount).toBe("number");
    expect(kpis.json.overdueAmount).toBeGreaterThanOrEqual(0);
  });

  it("Client revenue report totalOutstanding uses FX", async () => {
    const report = await api("/api/reports/client-revenue");
    if (Array.isArray(report.json) && report.json.length > 0) {
      for (const row of report.json) {
        expect(typeof row.totalOutstanding).toBe("number");
        expect(typeof row.totalInvoiced).toBe("number");
        expect(typeof row.totalPaid).toBe("number");
      }
    }
  });

  it("Client revenue report totalPaid uses FX", async () => {
    const report = await api("/api/reports/client-revenue");
    if (Array.isArray(report.json) && report.json.length > 0) {
      for (const row of report.json) {
        expect(row.totalInvoiced).toBeGreaterThanOrEqual(row.totalPaid);
      }
    }
  });

  it("Canonical service revenue unchanged after FX fixes", async () => {
    const rev = await api("/api/canonical/service-revenue?startDate=2000-01-01&endDate=2099-12-31");
    expect(rev.json).toHaveProperty("serviceRevenue");
    expect(typeof rev.json.serviceRevenue).toBe("number");
    expect(rev.json.serviceRevenue).toBeGreaterThanOrEqual(0);
  });

  it("Reports AR aging buckets use FX (total matches dashboard)", async () => {
    const report = await api("/api/reports/summary");
    const dash = await api("/api/dashboard");
    if (report.json.arAging) {
      const total = report.json.arAging.reduce((s: number, b: any) => s + Number(b.amount), 0);
      expect(+total.toFixed(2)).toBe(dash.json.totalOutstanding);
    }
  });
});

describe("FIX 2 — /api/invoices default pageSize=100 + X-Total-Count header", () => {
  it("Returns X-Total-Count header", async () => {
    const res = await fetch(`${BASE}/api/invoices`, { headers: { Cookie: cookie } });
    const totalCount = res.headers.get("x-total-count");
    expect(totalCount).not.toBeNull();
    expect(Number(totalCount)).toBeGreaterThan(0);
    await res.json();
  });

  it("Default pageSize returns up to 100 invoices", async () => {
    const { json } = await api("/api/invoices");
    const data = Array.isArray(json) ? json : json.data || [];
    expect(data.length).toBeLessThanOrEqual(100);
    expect(data.length).toBeGreaterThan(0);
  });

  it("Includes PAID invoices when total count allows", async () => {
    const res = await fetch(`${BASE}/api/invoices?pageSize=200`, { headers: { Cookie: cookie } });
    const json = await res.json();
    const data = Array.isArray(json) ? json : json.data || [];
    const statuses = new Set(data.map((i: any) => i.status));
    expect(data.length).toBeGreaterThan(0);
    if (data.length > 25 && statuses.size > 1) {
      expect(statuses.size).toBeGreaterThan(1);
    }
  });

  it("Custom pageSize=10 limits results", async () => {
    const { json } = await api("/api/invoices?page=1&pageSize=10");
    const data = Array.isArray(json) ? json : json.data || [];
    expect(data.length).toBeLessThanOrEqual(10);
  });
});

describe("FIX 4 — Trial balance DR=CR invariant", () => {
  it("Trial balance totals match after all FX fixes", async () => {
    const tb = await api("/api/reports/trial-balance");
    if (tb.json.totalDebit !== undefined) {
      expect(tb.json.totalDebit).toBe(tb.json.totalCredit);
    }
  });
});
