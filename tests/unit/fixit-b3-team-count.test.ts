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

describe("FIXIT B3 — Active team member count single source of truth", () => {
  beforeAll(login);

  let canonicalActive: number;
  let canonicalIndependents: number;
  let canonicalEmployees: number;

  it("canonical endpoint returns counts", async () => {
    const data = await get("/api/canonical/active-team");
    canonicalActive = data.active;
    canonicalIndependents = data.independents;
    canonicalEmployees = data.employees;
    expect(typeof canonicalActive).toBe("number");
    expect(canonicalActive).toBeGreaterThan(0);
  });

  it("canonical excludes Former User accounts", async () => {
    const data = await get("/api/canonical/active-team");
    const formerUsers = data.members?.filter((m: any) => m.name.startsWith("Former User")) ?? [];
    expect(formerUsers.length).toBe(0);
  });

  it("dashboard executive KPI teamActive matches canonical", async () => {
    const kpis = await get("/api/reports/executive-kpis");
    expect(kpis.teamActive).toBe(canonicalActive);
    expect(kpis.teamIndependents).toBe(canonicalIndependents);
    expect(kpis.teamEmployees).toBe(canonicalEmployees);
  });

  it("dashboard stats activeTeamCount matches canonical", async () => {
    const stats = await get("/api/dashboard");
    expect(stats.activeTeamCount).toBe(canonicalActive);
  });

  it("dashboard utilization lists all active members", async () => {
    const stats = await get("/api/dashboard");
    expect(stats.teamMemberUtilization.length).toBe(canonicalActive);
  });
});
