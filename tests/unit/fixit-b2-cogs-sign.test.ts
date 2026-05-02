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

describe("H1: COGS sign — 5100 Team Payout Costs must never carry a credit balance", () => {
  beforeAll(async () => {
    await login();
    expect(cookie.length).toBeGreaterThan(0);
  });

  it("5100 period balance is DEBIT (non-negative) on GL report", async () => {
    const accounts = await get("/api/gl/report?startDate=2026-01-01&endDate=2026-12-31");
    const acct5100 = accounts.find((a: any) => a.accountNumber === "5100");
    if (!acct5100 || (parseFloat(acct5100.totalDebit) === 0 && parseFloat(acct5100.totalCredit) === 0)) {
      return;
    }
    const balance = parseFloat(acct5100.balance);
    expect(balance).toBeGreaterThanOrEqual(0);
  });

  it("5100 net debit minus credit is non-negative across all lines", async () => {
    const accounts = await get("/api/gl/report?startDate=2026-01-01&endDate=2026-12-31");
    const acct5100 = accounts.find((a: any) => a.accountNumber === "5100");
    if (!acct5100) return;
    const dr = parseFloat(acct5100.totalDebit);
    const cr = parseFloat(acct5100.totalCredit);
    expect(dr - cr).toBeGreaterThanOrEqual(0);
  });

  it("no journal entry credits 5100 without a corresponding payout reversal context", async () => {
    const accounts = await get("/api/gl/report?startDate=2026-01-01&endDate=2026-12-31");
    const acct5100 = accounts.find((a: any) => a.accountNumber === "5100");
    if (!acct5100 || !acct5100.lines) return;
    for (const line of acct5100.lines) {
      const cr = parseFloat(line.credit);
      if (cr > 0) {
        expect(line.sourceType).toMatch(/PAYOUT_DELETE|PAYOUT_VOID|PAYOUT_REFUND/);
      }
    }
  });
});
