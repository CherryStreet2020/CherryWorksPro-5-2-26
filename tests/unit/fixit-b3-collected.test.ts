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

describe("FIXIT B3 — Collected payments single source of truth", () => {
  beforeAll(login);

  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const today = now.toISOString().split("T")[0];

  let canonicalCollected: number;

  it("canonical endpoint returns a number", async () => {
    const data = await get(`/api/canonical/collected?startDate=${monthStart}&endDate=${today}`);
    canonicalCollected = data.collected;
    expect(typeof canonicalCollected).toBe("number");
  });

  it("dashboard executive KPI collectedThisMonth matches canonical", async () => {
    const kpis = await get("/api/reports/executive-kpis");
    expect(kpis.collectedThisMonth).toBe(canonicalCollected);
  });

  it("dashboard stats revenueByMonth current month collected matches canonical", async () => {
    const stats = await get("/api/dashboard");
    const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const entry = stats.revenueByMonth?.find((r: any) => r.month === monthStr);
    const dashCollected = entry?.collected ?? 0;
    expect(dashCollected).toBe(canonicalCollected);
  });
});
