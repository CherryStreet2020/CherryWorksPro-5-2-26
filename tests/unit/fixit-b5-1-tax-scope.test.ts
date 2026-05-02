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

describe("B5.1 — Tax-inclusion fix: missed revenue aggregations", () => {
  beforeAll(login);

  describe("Source code audit: no revenue/invoiced aggregation uses invoices.total", () => {

    it("revenueByClient (topClients) uses invoices.subtotal with exchangeRate", async () => {
      const fs = await import("fs");
      const src = fs.readFileSync("server/storage.ts", "utf-8");
      const topClientsBlock = src.match(/topClientRows[\s\S]*?\.limit\(5\)/);
      expect(topClientsBlock).toBeDefined();
      expect(topClientsBlock![0]).toContain("invoices.subtotal");
      expect(topClientsBlock![0]).toContain("invoices.exchangeRate");
    });

    it("getClientRevenueReport totalInvoiced uses invoices.subtotal", async () => {
      const fs = await import("fs");
      const src = fs.readFileSync("server/storage.ts", "utf-8");
      const fnBlock = src.match(/getClientRevenueReport[\s\S]*?\.orderBy/);
      expect(fnBlock).toBeDefined();
      const totalInvoicedMatch = fnBlock![0].match(/totalInvoiced:.*?sum\(cast\(\$\{invoices\.(\w+)\}/);
      expect(totalInvoicedMatch).toBeDefined();
      expect(totalInvoicedMatch![1]).toBe("subtotal");
    });

    it("getClientRevenueReport orderBy uses invoices.subtotal", async () => {
      const fs = await import("fs");
      const src = fs.readFileSync("server/storage.ts", "utf-8");
      const fnBlock = src.match(/getClientRevenueReport[\s\S]*?\.orderBy\([\s\S]*?\)/);
      expect(fnBlock).toBeDefined();
      expect(fnBlock![0]).toMatch(/orderBy.*invoices\.subtotal/s);
    });

    it("all remaining invoices.total usages are AR/outstanding patterns (total - paidAmount)", async () => {
      const fs = await import("fs");
      const src = fs.readFileSync("server/storage.ts", "utf-8");
      const totalUsages = [...src.matchAll(/sum\(cast\(\$\{invoices\.total\}/g)];
      for (const m of totalUsages) {
        const contextStart = Math.max(0, m.index! - 10);
        const contextEnd = Math.min(src.length, m.index! + m[0].length + 80);
        const context = src.substring(contextStart, contextEnd);
        expect(context).toMatch(/paidAmount/);
      }
    });
  });

  describe("Integration: revenueByClient sum == GL 4000", () => {

    it("sum of client-revenue report totalInvoiced matches GL 4000 balance", async () => {
      const [crRes, glRes] = await Promise.all([
        get("/api/reports/client-revenue"),
        get("/api/gl/report?endDate=2099-12-31"),
      ]);
      expect(crRes.ok).toBe(true);
      expect(glRes.ok).toBe(true);

      const clientRevenue = await crRes.json();
      const glAccounts = await glRes.json();
      const gl4000 = glAccounts.find((a: any) => a.accountNumber === "4000");
      const gl4000Balance = gl4000 ? parseFloat(gl4000.balance) : 0;

      const sumInvoiced = clientRevenue.reduce(
        (s: number, r: any) => s + Number(r.totalInvoiced || 0), 0
      );
      const roundedSum = Math.round(sumInvoiced * 100) / 100;

      expect(roundedSum).toBeCloseTo(gl4000Balance, 2);
    });

    it("topClients revenue sum matches GL 4000 balance", async () => {
      const [repRes, glRes] = await Promise.all([
        get("/api/reports"),
        get("/api/gl/report?endDate=2099-12-31"),
      ]);
      expect(repRes.ok).toBe(true);
      expect(glRes.ok).toBe(true);

      const reportData = await repRes.json();
      const glAccounts = await glRes.json();
      const gl4000 = glAccounts.find((a: any) => a.accountNumber === "4000");
      const gl4000Balance = gl4000 ? parseFloat(gl4000.balance) : 0;

      const revenueByMonth: Array<{ invoiced: number }> = reportData.revenueByMonth || [];
      const lifetimeInvoiced = revenueByMonth.reduce((s, m) => s + Number(m.invoiced || 0), 0);
      const roundedLifetime = Math.round(lifetimeInvoiced * 100) / 100;

      expect(roundedLifetime).toBeCloseTo(gl4000Balance, 2);
    });
  });
});
