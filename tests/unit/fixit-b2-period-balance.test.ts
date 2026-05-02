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

describe("H3: Period Balance — every period must have sum(debits) === sum(credits)", () => {
  let accounts: any[];

  beforeAll(async () => {
    await login();
    expect(cookie.length).toBeGreaterThan(0);
  });

  it("all-time period debits equal credits to the cent", async () => {
    accounts = await get("/api/gl/report?startDate=2020-01-01&endDate=2030-12-31");
    let totalDr = 0;
    let totalCr = 0;
    for (const acct of accounts) {
      totalDr += parseFloat(acct.totalDebit) || 0;
      totalCr += parseFloat(acct.totalCredit) || 0;
    }
    const diff = Math.abs(Math.round((totalDr - totalCr) * 100) / 100);
    expect(diff).toBe(0);
  });

  it("March 2026 period balances", async () => {
    const marchAccounts = await get("/api/gl/report?startDate=2026-03-01&endDate=2026-03-31");
    let dr = 0, cr = 0;
    for (const a of marchAccounts) {
      dr += parseFloat(a.totalDebit) || 0;
      cr += parseFloat(a.totalCredit) || 0;
    }
    expect(Math.abs(Math.round((dr - cr) * 100) / 100)).toBe(0);
  });

  it("April 2026 period balances", async () => {
    const aprilAccounts = await get("/api/gl/report?startDate=2026-04-01&endDate=2026-04-30");
    let dr = 0, cr = 0;
    for (const a of aprilAccounts) {
      dr += parseFloat(a.totalDebit) || 0;
      cr += parseFloat(a.totalCredit) || 0;
    }
    expect(Math.abs(Math.round((dr - cr) * 100) / 100)).toBe(0);
  });

  it("every individual journal entry balances (DR === CR)", async () => {
    const jes = await get("/api/gl/journal-entries?limit=500");
    for (const je of jes) {
      if (!je.lines || je.lines.length === 0) continue;
      const dr = je.lines.reduce((s: number, l: any) => s + (parseFloat(l.debit) || 0), 0);
      const cr = je.lines.reduce((s: number, l: any) => s + (parseFloat(l.credit) || 0), 0);
      const diff = Math.round((dr - cr) * 100) / 100;
      expect(diff, `JE#${je.id} (${je.sourceType}) unbalanced: DR=${dr} CR=${cr}`).toBe(0);
    }
  });
});
