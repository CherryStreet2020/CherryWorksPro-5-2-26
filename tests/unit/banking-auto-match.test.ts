import { describe, it, expect } from "vitest";

interface BankTx {
  id: number;
  amount: string;
  date: string;
  status: string;
}

interface Candidate {
  entityType: string;
  entityId: string;
  amount: number;
  date: string;
}

function autoMatch(
  tx: BankTx,
  payments: Candidate[],
  payouts: Candidate[],
  expenses: Candidate[],
): { action: "MATCHED" | "SUGGESTED" | "NONE"; candidates: Candidate[] } {
  const txAmount = Math.abs(Number(tx.amount));
  const txDate = new Date(tx.date + "T00:00:00Z");
  const isCredit = Number(tx.amount) > 0;
  const isDebit = Number(tx.amount) < 0;

  const candidates: Candidate[] = [];

  if (isCredit) {
    for (const pay of payments) {
      if (Math.abs(txAmount - pay.amount) < 0.01) {
        const daysDiff = Math.abs((txDate.getTime() - new Date(pay.date + "T00:00:00Z").getTime()) / (1000 * 60 * 60 * 24));
        if (daysDiff <= 3) candidates.push(pay);
      }
    }
  }

  if (isDebit) {
    for (const po of payouts) {
      if (Math.abs(txAmount - po.amount) < 0.01) {
        const daysDiff = Math.abs((txDate.getTime() - new Date(po.date + "T00:00:00Z").getTime()) / (1000 * 60 * 60 * 24));
        if (daysDiff <= 3) candidates.push(po);
      }
    }
    for (const exp of expenses) {
      if (Math.abs(txAmount - exp.amount) < 0.01) {
        const daysDiff = Math.abs((txDate.getTime() - new Date(exp.date + "T00:00:00Z").getTime()) / (1000 * 60 * 60 * 24));
        if (daysDiff <= 3) candidates.push(exp);
      }
    }
  }

  if (candidates.length === 1) return { action: "MATCHED", candidates };
  if (candidates.length > 1) return { action: "SUGGESTED", candidates };
  return { action: "NONE", candidates: [] };
}

describe("banking auto-match", () => {
  it("matches a credit transaction to exactly one payment within 3 days", () => {
    const tx: BankTx = { id: 1, amount: "500.00", date: "2026-04-01", status: "PENDING" };
    const payments: Candidate[] = [
      { entityType: "INVOICE_PAYMENT", entityId: "pay-1", amount: 500, date: "2026-04-02" },
    ];
    const result = autoMatch(tx, payments, [], []);
    expect(result.action).toBe("MATCHED");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].entityId).toBe("pay-1");
  });

  it("suggests when multiple payments match a credit transaction", () => {
    const tx: BankTx = { id: 2, amount: "200.00", date: "2026-04-05", status: "PENDING" };
    const payments: Candidate[] = [
      { entityType: "INVOICE_PAYMENT", entityId: "pay-a", amount: 200, date: "2026-04-04" },
      { entityType: "INVOICE_PAYMENT", entityId: "pay-b", amount: 200, date: "2026-04-06" },
    ];
    const result = autoMatch(tx, payments, [], []);
    expect(result.action).toBe("SUGGESTED");
    expect(result.candidates).toHaveLength(2);
  });

  it("matches a debit transaction to a payout within 3 days", () => {
    const tx: BankTx = { id: 3, amount: "-1000.00", date: "2026-03-28", status: "PENDING" };
    const payouts: Candidate[] = [
      { entityType: "PAYOUT", entityId: "po-1", amount: 1000, date: "2026-03-27" },
    ];
    const result = autoMatch(tx, [], payouts, []);
    expect(result.action).toBe("MATCHED");
    expect(result.candidates[0].entityId).toBe("po-1");
  });

  it("matches a debit transaction to an expense within 3 days", () => {
    const tx: BankTx = { id: 4, amount: "-49.99", date: "2026-04-01", status: "PENDING" };
    const expenses: Candidate[] = [
      { entityType: "EXPENSE", entityId: "exp-1", amount: 49.99, date: "2026-04-01" },
    ];
    const result = autoMatch(tx, [], [], expenses);
    expect(result.action).toBe("MATCHED");
    expect(result.candidates[0].entityId).toBe("exp-1");
  });

  it("returns NONE when no candidates match within 3 days", () => {
    const tx: BankTx = { id: 5, amount: "500.00", date: "2026-04-01", status: "PENDING" };
    const payments: Candidate[] = [
      { entityType: "INVOICE_PAYMENT", entityId: "pay-far", amount: 500, date: "2026-03-25" },
    ];
    const result = autoMatch(tx, payments, [], []);
    expect(result.action).toBe("NONE");
  });

  it("returns NONE when amounts don't match", () => {
    const tx: BankTx = { id: 6, amount: "500.00", date: "2026-04-01", status: "PENDING" };
    const payments: Candidate[] = [
      { entityType: "INVOICE_PAYMENT", entityId: "pay-x", amount: 501, date: "2026-04-01" },
    ];
    const result = autoMatch(tx, payments, [], []);
    expect(result.action).toBe("NONE");
  });

  it("suggests when debit matches both a payout and an expense", () => {
    const tx: BankTx = { id: 7, amount: "-100.00", date: "2026-04-01", status: "PENDING" };
    const payouts: Candidate[] = [
      { entityType: "PAYOUT", entityId: "po-x", amount: 100, date: "2026-04-01" },
    ];
    const expenses: Candidate[] = [
      { entityType: "EXPENSE", entityId: "exp-x", amount: 100, date: "2026-04-02" },
    ];
    const result = autoMatch(tx, [], payouts, expenses);
    expect(result.action).toBe("SUGGESTED");
    expect(result.candidates).toHaveLength(2);
  });
});
