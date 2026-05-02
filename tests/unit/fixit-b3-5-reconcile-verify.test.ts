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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

describe("FIXIT B3.5 — Revenue, Collected, AR reconciliation across all surfaces", () => {
  beforeAll(login);

  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const today = now.toISOString().split("T")[0];
  const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  let canonicalRevenue: number;
  let canonicalCollected: number;
  let canonicalAR: number;

  it("fetches canonical values", async () => {
    const rev = await get(`/api/canonical/service-revenue?startDate=${monthStart}&endDate=${today}`);
    canonicalRevenue = rev.serviceRevenue;
    expect(typeof canonicalRevenue).toBe("number");

    const col = await get(`/api/canonical/collected?startDate=${monthStart}&endDate=${today}`);
    canonicalCollected = col.collected;
    expect(typeof canonicalCollected).toBe("number");

    const ar = await get("/api/ar/outstanding");
    canonicalAR = ar.outstandingAR;
    expect(typeof canonicalAR).toBe("number");
  });

  it("executive KPIs revenue matches canonical", async () => {
    const kpis = await get("/api/reports/executive-kpis");
    expect(kpis.revenueThisMonth).toBe(canonicalRevenue);
  });

  it("executive KPIs collected matches canonical", async () => {
    const kpis = await get("/api/reports/executive-kpis");
    expect(kpis.collectedThisMonth).toBe(canonicalCollected);
  });

  it("dashboard revenueByMonth current month invoiced matches canonical", async () => {
    const stats = await get("/api/dashboard");
    const entry = (stats.revenueByMonth || []).find((r: any) => r.month === monthStr);
    expect(entry?.invoiced ?? 0).toBe(canonicalRevenue);
  });

  it("dashboard revenueByMonth current month collected matches canonical", async () => {
    const stats = await get("/api/dashboard");
    const entry = (stats.revenueByMonth || []).find((r: any) => r.month === monthStr);
    expect(entry?.collected ?? 0).toBe(canonicalCollected);
  });

  it("reports revenueByMonth current month invoiced matches canonical", async () => {
    const report = await get("/api/reports");
    const entry = (report.revenueByMonth || []).find((r: any) => r.month === monthStr);
    expect(entry?.invoiced ?? 0).toBe(canonicalRevenue);
  });

  it("reports revenueByMonth current month paid matches canonical collected", async () => {
    const report = await get("/api/reports");
    const entry = (report.revenueByMonth || []).find((r: any) => r.month === monthStr);
    expect(entry?.paid ?? 0).toBe(canonicalCollected);
  });

  it("cash flow cashIn for current month matches canonical collected", async () => {
    const cashFlow = await get("/api/reports/cash-flow");
    const entry = (cashFlow || []).find((r: any) => r.month === monthStr);
    expect(entry?.cashIn ?? 0).toBe(canonicalCollected);
  });

  it("reports AR aging total matches canonical AR", async () => {
    const report = await get("/api/reports");
    const arAging = report.arAging || [];
    const arAgingTotal = round2(arAging.reduce((s: number, b: any) => s + b.amount, 0));
    expect(arAgingTotal).toBe(canonicalAR);
  });
});
