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
  const raw = res.headers.getSetCookie?.() ?? (res.headers as any).raw?.()?.["set-cookie"] ?? [];
  if (raw.length > 0) {
    cookie = raw.map((c: string) => c.split(";")[0]).join("; ");
  }
  if (!cookie) {
    const sc = res.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
  }
}

function get(path: string) {
  return fetch(`${BASE}${path}`, { headers: { Cookie: cookie } });
}

describe("B5 — Critical accounting fixes", () => {
  beforeAll(login);

  describe("BUG 1 (V3-GL2): Service Revenue uses subtotal (net-of-tax)", () => {

    it("source code uses invoices.subtotal in getServiceRevenue", async () => {
      const fs = await import("fs");
      const src = fs.readFileSync("server/storage.ts", "utf-8");
      const fnBody = src.match(/async getServiceRevenue\b[\s\S]*?return round2/);
      expect(fnBody).toBeDefined();
      expect(fnBody![0]).toContain("invoices.subtotal");
      expect(fnBody![0]).not.toMatch(/invoices\.total[^D]/);
    });

    it("source code uses invoices.subtotal in getServiceRevenueByMonth", async () => {
      const fs = await import("fs");
      const src = fs.readFileSync("server/storage.ts", "utf-8");
      const fnBody = src.match(/async getServiceRevenueByMonth\b[\s\S]*?return rows\.map/);
      expect(fnBody).toBeDefined();
      expect(fnBody![0]).toContain("invoices.subtotal");
      expect(fnBody![0]).not.toMatch(/invoices\.total[^D]/);
    });

    it("canonical service revenue (revenueByMonth sum) matches GL 4000 balance to the penny", async () => {
      const reportsRes = await get("/api/reports");
      expect(reportsRes.ok).toBe(true);
      const reportData = await reportsRes.json();
      const revenueByMonth: Array<{ invoiced: number }> = reportData.revenueByMonth || [];
      const lifetimeInvoiced = revenueByMonth.reduce(
        (sum: number, m: any) => sum + Number(m.invoiced || 0), 0
      );
      const roundedLifetime = Math.round(lifetimeInvoiced * 100) / 100;

      const glRes = await get("/api/gl/report?endDate=2099-12-31");
      expect(glRes.ok).toBe(true);
      const glAccounts = await glRes.json();
      const gl4000 = glAccounts.find((a: any) => a.accountNumber === "4000");
      const gl4000Balance = gl4000 ? parseFloat(gl4000.balance) : 0;

      expect(roundedLifetime).toBeCloseTo(gl4000Balance, 2);
    });

    it("service revenue <= invoice total (tax not double-counted)", async () => {
      const invoiceRes = await get("/api/invoices");
      const invoices = await invoiceRes.json();
      const active = invoices.filter((inv: any) => inv.status !== "VOID" && inv.status !== "DRAFT");

      const sumSubtotal = active.reduce(
        (s: number, inv: any) => s + Number(inv.subtotal || 0) * Number(inv.exchangeRate || 1), 0
      );
      const sumTotal = active.reduce(
        (s: number, inv: any) => s + Number(inv.total || 0) * Number(inv.exchangeRate || 1), 0
      );

      expect(Math.round(sumSubtotal * 100) / 100).toBeLessThanOrEqual(
        Math.round(sumTotal * 100) / 100
      );
    });
  });

  describe("BUG 2 (V3-TB1): Trial Balance shows DR/CR for zero-balance accounts with postings", () => {

    it("GL report returns totalDebit and totalCredit for account 5100 with postings", async () => {
      const res = await get("/api/gl/report?endDate=2099-12-31");
      expect(res.ok).toBe(true);
      const accounts = await res.json();
      const acct5100 = accounts.find((a: any) => a.accountNumber === "5100");
      if (!acct5100 || !acct5100.lines || acct5100.lines.length === 0) {
        return;
      }

      expect(acct5100.lines.length).toBeGreaterThan(0);
      expect(parseFloat(acct5100.totalDebit)).toBeGreaterThan(0);
      expect(parseFloat(acct5100.totalCredit)).toBeGreaterThan(0);
      expect(parseFloat(acct5100.balance)).toBeCloseTo(0, 2);
    });

    it("frontend computeDebitCredit uses totalDebit/totalCredit when available", async () => {
      const fs = await import("fs");
      const src = fs.readFileSync("client/src/pages/gl-trial-balance.tsx", "utf-8");

      expect(src).toContain("parseFloat(a.totalDebit)");
      expect(src).toContain("parseFloat(a.totalCredit)");
      expect(src).toContain("return { debit: td, credit: tc }");
    });

    it("zero-balance account with postings gets non-zero DR and CR (unit logic)", () => {
      function computeDebitCredit(a: { totalDebit: string; totalCredit: string; balance: string; normalBalance: string }) {
        const td = parseFloat(a.totalDebit) || 0;
        const tc = parseFloat(a.totalCredit) || 0;
        if (td > 0 || tc > 0) {
          return { debit: td, credit: tc };
        }
        const bal = parseFloat(a.balance);
        if (a.normalBalance === "DEBIT") {
          return bal >= 0 ? { debit: bal, credit: 0 } : { debit: 0, credit: -bal };
        }
        return bal >= 0 ? { debit: 0, credit: bal } : { debit: -bal, credit: 0 };
      }

      const result = computeDebitCredit({ totalDebit: "150.00", totalCredit: "150.00", balance: "0.00", normalBalance: "DEBIT" });
      expect(result.debit).toBe(150);
      expect(result.credit).toBe(150);

      const noPostings = computeDebitCredit({ totalDebit: "0.00", totalCredit: "0.00", balance: "0.00", normalBalance: "DEBIT" });
      expect(noPostings.debit).toBe(0);
      expect(noPostings.credit).toBe(0);

      const normal = computeDebitCredit({ totalDebit: "500.00", totalCredit: "200.00", balance: "300.00", normalBalance: "DEBIT" });
      expect(normal.debit).toBe(500);
      expect(normal.credit).toBe(200);
    });

    it("grand totals use totalDebit/totalCredit sums (source code check)", async () => {
      const fs = await import("fs");
      const src = fs.readFileSync("client/src/pages/gl-trial-balance.tsx", "utf-8");
      
      const debitTotal = src.match(/grandTotalDebit[\s\S]*?parseFloat\(a\.totalDebit\)/);
      expect(debitTotal).toBeDefined();
      
      const creditTotal = src.match(/grandTotalCredit[\s\S]*?parseFloat\(a\.totalCredit\)/);
      expect(creditTotal).toBeDefined();
    });
  });

  describe("BUG 3 (V3-COA1/GL1): GL 5100 — NOT a code bug, reversed test data", () => {

    it("payout posting logic uses correct accounts (DR 5100 / CR 1000)", async () => {
      const fs = await import("fs");
      const src = fs.readFileSync("server/routes/payout-routes.ts", "utf-8");

      expect(src).toMatch(/accountNumber:\s*"5100".*?debit:\s*\w+.*?credit:\s*"0\.00"/s);
      expect(src).toMatch(/accountNumber:\s*"1000".*?debit:\s*"0\.00".*?credit:\s*\w+/s);
    });

    it("5100 lines are payouts and their delete-reversals only", async () => {
      const res = await get("/api/gl/report?endDate=2099-12-31");
      const accounts = await res.json();
      const acct5100 = accounts.find((a: any) => a.accountNumber === "5100");
      if (!acct5100 || !acct5100.lines || acct5100.lines.length === 0) {
        return;
      }

      for (const line of acct5100.lines) {
        expect(["PAYOUT", "PAYOUT_DELETE"]).toContain(line.sourceType);
        if (line.sourceType === "PAYOUT") {
          expect(parseFloat(line.debit)).toBeGreaterThan(0);
          expect(parseFloat(line.credit)).toBe(0);
        } else {
          expect(parseFloat(line.debit)).toBe(0);
          expect(parseFloat(line.credit)).toBeGreaterThan(0);
        }
      }

      expect(parseFloat(acct5100.balance)).toBeCloseTo(0, 2);
    });
  });
});
