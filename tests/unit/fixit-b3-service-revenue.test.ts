import { describe, it, expect, beforeAll } from "vitest";

import { TEST_BASE as BASE } from "../helpers/base";
let cookie = "";

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin.test@cwpro.dev", password: "admin123" }),
    redirect: "manual",
  });
  const raw = res.headers.getSetCookie?.() ?? [];
  if (raw.length > 0) {
    cookie = raw.map(c => c.split(";")[0]).join("; ");
  } else {
    const sc = res.headers.get("set-cookie") || "";
    cookie = sc.split(";")[0];
  }
}

async function get(path: string) {
  const res = await fetch(`${BASE}${path}`, { headers: { Cookie: cookie } });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

describe("FIXIT B3 — Service Revenue single source of truth", () => {
  beforeAll(login);

  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const today = now.toISOString().split("T")[0];

  let canonicalRevenue: number;

  it("canonical endpoint returns a number", async () => {
    const data = await get(`/api/canonical/service-revenue?startDate=${monthStart}&endDate=${today}`);
    canonicalRevenue = data.serviceRevenue;
    expect(typeof canonicalRevenue).toBe("number");
  });

  it("dashboard executive KPI revenueThisMonth matches canonical", async () => {
    const kpis = await get("/api/reports/executive-kpis");
    expect(kpis.revenueThisMonth).toBe(canonicalRevenue);
  });

  it("dashboard stats revenueByMonth current month invoiced matches canonical", async () => {
    const stats = await get("/api/dashboard");
    const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const entry = stats.revenueByMonth?.find((r: any) => r.month === monthStr);
    const dashInvoiced = entry?.invoiced ?? 0;
    expect(dashInvoiced).toBe(canonicalRevenue);
  });

  it("reports revenueByMonth current month invoiced matches canonical", async () => {
    const report = await get("/api/reports");
    const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const entry = report.revenueByMonth?.find((r: any) => r.month === monthStr);
    const reportInvoiced = entry?.invoiced ?? 0;
    expect(reportInvoiced).toBe(canonicalRevenue);
  });

  it("all-time revenue is consistent across dashboard and canonical", async () => {
    const allTime = await get(`/api/canonical/service-revenue?startDate=2000-01-01&endDate=2099-12-31`);
    const stats = await get("/api/dashboard");
    expect(stats.totalRevenue).toBe(allTime.serviceRevenue);
  });
});
