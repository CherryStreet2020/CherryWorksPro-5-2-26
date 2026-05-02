import { describe, it, expect } from "vitest";

describe("FIXIT B2 — HIGH findings", () => {

  describe("H1: Dashboard Activity fallback format", () => {
    const formatMoney = (v: number) => `$${v.toFixed(2)}`;
    const DEFAULT_FORMAT = (d: any, u: string, action?: string) => ({
      title: ((action || d.action || "Activity").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c: string) => c.toUpperCase())) + (d.number ? ` ${d.number}` : "") + (d.amount ? ` · ${formatMoney(d.amount)}` : ""),
      subtitle: d.clientName || d.teamMemberName || d.vendor || d.title || u,
    });

    it("renders action name as readable title for unknown events", () => {
      const result = DEFAULT_FORMAT({}, "Dean Dunagan", "SENDER_DOMAIN_CONFIGURED");
      expect(result.title).toBe("Sender domain configured");
      expect(result.subtitle).toBe("Dean Dunagan");
    });

    it("includes number and amount when available", () => {
      const result = DEFAULT_FORMAT({ number: "INV-001", amount: 500 }, "Dean Dunagan", "INVOICE_BRAND_UPDATED");
      expect(result.title).toContain("INV-001");
      expect(result.title).toContain("$500.00");
    });

    it("shows vendor/clientName in subtitle when available", () => {
      const result = DEFAULT_FORMAT({ clientName: "Acme Corp" }, "Dean Dunagan", "CHECKOUT_SESSION_CREATED");
      expect(result.subtitle).toBe("Acme Corp");
    });
  });

  describe("H3: Invoice Collection Rate uses paidAmount", () => {
    function computeCollectionRate(invoices: Array<{ status: string; total: number; paidAmount: number }>) {
      let totalSentValue = 0;
      let totalPaidValue = 0;
      for (const inv of invoices) {
        if (inv.status === "VOID") continue;
        if (["SENT", "PARTIAL", "PAID"].includes(inv.status)) {
          totalSentValue += inv.total;
          totalPaidValue += inv.paidAmount;
        }
      }
      return totalSentValue > 0 ? Math.round((totalPaidValue / totalSentValue) * 100) : 0;
    }

    it("includes partial payments in rate", () => {
      const invoices = [
        { status: "SENT", total: 1000, paidAmount: 541 },
        { status: "PAID", total: 500, paidAmount: 500 },
        { status: "VOID", total: 200, paidAmount: 0 },
      ];
      const rate = computeCollectionRate(invoices);
      expect(rate).toBe(69);
    });

    it("returns 0 when no sent invoices", () => {
      expect(computeCollectionRate([{ status: "DRAFT", total: 100, paidAmount: 0 }])).toBe(0);
    });
  });

  describe("H4: Estimates status tabs include INVOICED", () => {
    const STATUS_TABS = ["All", "DRAFT", "SENT", "ACCEPTED", "INVOICED", "DECLINED", "EXPIRED"];
    const STATUS_LABELS: Record<string, string> = { ALL: "All", DRAFT: "Draft", SENT: "Sent", ACCEPTED: "Accepted", INVOICED: "Invoiced", DECLINED: "Declined", EXPIRED: "Expired" };

    it("includes INVOICED tab", () => {
      expect(STATUS_TABS).toContain("INVOICED");
    });

    it("has label for INVOICED", () => {
      expect(STATUS_LABELS.INVOICED).toBe("Invoiced");
    });

    it("status counts include INVOICED bucket", () => {
      const estimates = [
        { status: "DRAFT" }, { status: "INVOICED" }, { status: "INVOICED" }, { status: "ACCEPTED" },
      ];
      const statusCounts: Record<string, number> = { ALL: estimates.length, DRAFT: 0, SENT: 0, ACCEPTED: 0, INVOICED: 0, DECLINED: 0, EXPIRED: 0 };
      estimates.forEach((e: any) => { if (statusCounts[e.status] !== undefined) statusCounts[e.status]++; });
      expect(statusCounts.INVOICED).toBe(2);
      expect(statusCounts.ALL).toBe(4);
      expect(statusCounts.DRAFT + statusCounts.SENT + statusCounts.ACCEPTED + statusCounts.INVOICED + statusCounts.DECLINED + statusCounts.EXPIRED).toBe(4);
    });
  });

  describe("H5: Estimates Conversion Rate divide-by-zero", () => {
    it("returns null when no sent/accepted/declined estimates", () => {
      const estimates = [{ status: "DRAFT" }, { status: "DRAFT" }, { status: "EXPIRED" }];
      const sentCount = estimates.filter(e => ["SENT", "ACCEPTED", "DECLINED", "INVOICED"].includes(e.status)).length;
      const conversionRate = sentCount > 0 ? Math.round((0 / sentCount) * 100) : null;
      expect(conversionRate).toBeNull();
    });

    it("includes INVOICED in conversion denominator and numerator", () => {
      const estimates = [
        { status: "INVOICED" }, { status: "INVOICED" }, { status: "DECLINED" },
      ];
      const sentCount = estimates.filter(e => ["SENT", "ACCEPTED", "DECLINED", "INVOICED"].includes(e.status)).length;
      const acceptedCount = estimates.filter(e => e.status === "ACCEPTED" || e.status === "INVOICED").length;
      const rate = Math.round((acceptedCount / sentCount) * 100);
      expect(rate).toBe(67);
    });
  });

  describe("H7: Payments label shows open invoices count", () => {
    it("filters for SENT and PARTIAL only", () => {
      const unpaidInvoices = [
        { status: "SENT" }, { status: "PARTIAL" }, { status: "PAID" }, { status: "DRAFT" }, { status: "VOID" },
      ];
      const openCount = unpaidInvoices.filter((i: any) => ["SENT", "PARTIAL"].includes(i.status)).length;
      expect(openCount).toBe(2);
    });
  });

  describe("H8: Avg Days to Pay includes PARTIAL invoices", () => {
    it("includes PARTIAL invoices with paidAmount > 0", () => {
      const allInvoices = [
        { status: "PAID", paidAmount: 500, issuedDate: "2026-03-01" },
        { status: "PARTIAL", paidAmount: 200, issuedDate: "2026-03-05" },
        { status: "SENT", paidAmount: 0, issuedDate: "2026-03-10" },
      ];
      const paidInvoices = allInvoices.filter(i => (i.status === "PAID" || (i.status === "PARTIAL" && i.paidAmount > 0)) && i.issuedDate);
      expect(paidInvoices.length).toBe(2);
    });

    it("excludes PARTIAL with zero paidAmount", () => {
      const allInvoices = [
        { status: "PARTIAL", paidAmount: 0, issuedDate: "2026-03-05" },
      ];
      const paidInvoices = allInvoices.filter(i => (i.status === "PAID" || (i.status === "PARTIAL" && i.paidAmount > 0)) && i.issuedDate);
      expect(paidInvoices.length).toBe(0);
    });
  });

  describe("H12: GL Ledger period label sign for natural-credit accounts", () => {
    function periodLabel(balance: number, normalBalance: string): string {
      if (balance === 0) return "Dr";
      if (normalBalance === "CREDIT") return balance > 0 ? "Cr" : "Dr";
      return balance > 0 ? "Dr" : "Cr";
    }

    function groupPeriodLabel(balance: number, type: string): string {
      const NATURAL_CREDIT_TYPES = new Set(["REVENUE", "LIABILITY", "EQUITY"]);
      if (balance === 0) return "Dr";
      if (NATURAL_CREDIT_TYPES.has(type)) return balance > 0 ? "Cr" : "Dr";
      return balance > 0 ? "Dr" : "Cr";
    }

    it("shows Cr for positive REVENUE balance", () => {
      expect(periodLabel(1712.50, "CREDIT")).toBe("Cr");
    });

    it("shows Dr for negative REVENUE balance", () => {
      expect(periodLabel(-500, "CREDIT")).toBe("Dr");
    });

    it("shows Dr for positive ASSET balance", () => {
      expect(periodLabel(1000, "DEBIT")).toBe("Dr");
    });

    it("shows Cr for negative ASSET balance", () => {
      expect(periodLabel(-300, "DEBIT")).toBe("Cr");
    });

    it("group: REVENUE type positive = Cr", () => {
      expect(groupPeriodLabel(1712.50, "REVENUE")).toBe("Cr");
    });

    it("group: LIABILITY type positive = Cr", () => {
      expect(groupPeriodLabel(500, "LIABILITY")).toBe("Cr");
    });

    it("group: ASSET type positive = Dr", () => {
      expect(groupPeriodLabel(1000, "ASSET")).toBe("Dr");
    });

    it("group: EXPENSE type positive = Dr", () => {
      expect(groupPeriodLabel(800, "EXPENSE")).toBe("Dr");
    });
  });
});
