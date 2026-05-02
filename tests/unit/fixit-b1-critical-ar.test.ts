import { describe, it, expect, beforeAll } from "vitest";

import { TEST_BASE as BASE } from "../helpers/base";
let cookie = "";
let csrfToken = "";

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
  csrfToken = res.headers.get("x-csrf-token") || "";
  return res;
}

async function get(path: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Cookie: cookie },
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

async function post(path: string) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
  });
  return res.json();
}

describe("C1: AR Deterministic Truth — All surfaces must agree", () => {
  let canonicalAR: number;
  let dashboardOutstanding: number;
  let dashboardKpiOutstanding: number;
  let reportCanonicalAR: number;

  beforeAll(async () => {
    await login();
    expect(cookie.length).toBeGreaterThan(0);

    await post("/api/gl/reconcile/repair");

    const arRes = await get("/api/ar/outstanding");
    canonicalAR = arRes.outstandingAR;

    const dashStats = await get("/api/dashboard");
    dashboardOutstanding = dashStats.totalOutstanding;

    const kpis = await get("/api/reports/executive-kpis");
    dashboardKpiOutstanding = kpis.totalOutstanding;

    const reports = await get("/api/reports");
    reportCanonicalAR = reports.canonicalAR;
  });

  it("canonical AR endpoint returns a number", () => {
    expect(typeof canonicalAR).toBe("number");
  });

  it("dashboard stats totalOutstanding === canonical AR", () => {
    expect(dashboardOutstanding).toBe(canonicalAR);
  });

  it("dashboard executive KPI totalOutstanding === canonical AR", () => {
    expect(dashboardKpiOutstanding).toBe(canonicalAR);
  });

  it("reports endpoint canonicalAR === canonical AR", () => {
    expect(reportCanonicalAR).toBe(canonicalAR);
  });

  it("reconcile endpoint is read-only and shows sub-ledger === canonical AR", async () => {
    const reconcile = await get("/api/gl/reconcile");
    expect(parseFloat(reconcile.ar_subledger_total)).toBe(canonicalAR);
  });

  it("GL 1200 matches canonical AR after explicit repair", async () => {
    const reconcile = await get("/api/gl/reconcile");
    expect(reconcile.diff).toBe("0.00");
    expect(parseFloat(reconcile.gl_1200_balance)).toBe(canonicalAR);
  });

  it("all backend surfaces agree on the same AR value", () => {
    const values = [canonicalAR, dashboardOutstanding, dashboardKpiOutstanding, reportCanonicalAR];
    const unique = new Set(values);
    expect(unique.size).toBe(1);
  });
});
