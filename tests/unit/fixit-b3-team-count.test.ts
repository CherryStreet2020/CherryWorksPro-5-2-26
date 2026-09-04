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

  // Other test files (team invites, deactivations) change the shared test org's
  // roster while this file runs, so each comparison reads the canonical count and
  // the dashboard figure together rather than trusting a value captured earlier.
  it("dashboard executive KPI teamActive matches canonical", async () => {
    const [canonical, kpis] = await Promise.all([get("/api/canonical/active-team"), get("/api/reports/executive-kpis")]);
    expect(kpis.teamActive).toBe(canonical.active);
    expect(kpis.teamIndependents).toBe(canonical.independents);
    expect(kpis.teamEmployees).toBe(canonical.employees);
  });

  it("dashboard stats activeTeamCount matches canonical", async () => {
    // /api/dashboard is the slowest of the three reads, so a roster change by a
    // parallel file can land between the two fetches; compare up to three times.
    let canonical: any, stats: any;
    for (let attempt = 0; attempt < 3; attempt++) {
      [canonical, stats] = await Promise.all([get("/api/canonical/active-team"), get("/api/dashboard")]);
      if (stats.activeTeamCount === canonical.active) break;
    }
    expect(stats.activeTeamCount).toBe(canonical.active);
  });

  it("dashboard utilization lists all active members", async () => {
    const [canonical, stats] = await Promise.all([get("/api/canonical/active-team"), get("/api/dashboard")]);
    expect(stats.teamMemberUtilization.length).toBe(canonical.active);
  });
});
