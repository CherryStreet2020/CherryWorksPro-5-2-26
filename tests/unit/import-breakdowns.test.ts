import { describe, it, expect } from "vitest";
import {
  canonicalizeParentCategory,
  runPreflightOnFile,
  buildImportOps,
} from "../../server/import-engine";
import type { ImportOptions, ParsedFileData } from "../../server/import-engine";

describe("canonicalizeParentCategory", () => {
  it("maps 'Team Members' to key 'independents'", () => {
    const result = canonicalizeParentCategory("Team Members");
    expect(result.key).toBe("independents");
    expect(result.label).toBe("Independents / Team Members");
  });

  it("maps 'Independents' to key 'independents'", () => {
    const result = canonicalizeParentCategory("Independents");
    expect(result.key).toBe("independents");
    expect(result.label).toBe("Independents / Team Members");
  });

  it("maps 'Independent' (singular) to key 'independents'", () => {
    const result = canonicalizeParentCategory("Independent");
    expect(result.key).toBe("independents");
  });

  it("maps 'Team Member' (singular) to key 'independents'", () => {
    const result = canonicalizeParentCategory("Team Member");
    expect(result.key).toBe("independents");
  });

  it("normalizes weird whitespace and case", () => {
    const result = canonicalizeParentCategory("  INDEPENDENTS  ");
    expect(result.key).toBe("independents");
    expect(result.label).toBe("Independents / Team Members");
  });

  it("maps empty string to (empty)", () => {
    const result = canonicalizeParentCategory("");
    expect(result.key).toBe("(empty)");
    expect(result.label).toBe("(empty)");
  });

  it("passes through non-independent categories", () => {
    const result = canonicalizeParentCategory("Travel");
    expect(result.key).toBe("travel");
    expect(result.label).toBe("Travel");
  });

  it("is deterministic across calls", () => {
    const r1 = canonicalizeParentCategory("Team Members");
    const r2 = canonicalizeParentCategory("Team Members");
    expect(r1).toEqual(r2);
  });
});

describe("preflight breakdown with canonical categories", () => {
  it("combines Team Members and Independents into single canonical category with count+amount", () => {
    const rows = [
      { Date: "2026-01-10", "Parent Category": "Team Members", Merchant: "Zelle", Description: "Zelle payment to Alice Smith Conf# 123", Amount: "200.00", Currency: "USD", Source: "CherrySt" },
      { Date: "2026-01-12", "Parent Category": "Independents", Merchant: "Bob Jones", Description: "Dev work", Amount: "500.00", Currency: "USD", Source: "CherrySt" },
      { Date: "2026-01-15", "Parent Category": "Travel", Merchant: "Delta Airlines", Description: "Flight", Amount: "300.00", Currency: "USD", Source: "CherrySt" },
    ];

    const result = runPreflightOnFile(rows, "expense_details", "test.csv", "sha_test");

    expect(result.independentPayoutSum).toBe(700);

    expect(result.expenseBreakdowns).toBeDefined();
    const catBreakdown = result.expenseBreakdowns!.byParentCategory;
    const independentsCat = catBreakdown.find((c) => c.key === "independents");
    expect(independentsCat).toBeDefined();
    expect(independentsCat!.count).toBe(2);
    expect(independentsCat!.amount).toBe(700);
    expect(independentsCat!.label).toBe("Independents / Team Members");

    const travelCat = catBreakdown.find((c) => c.key === "travel");
    expect(travelCat).toBeDefined();
    expect(travelCat!.count).toBe(1);
    expect(travelCat!.amount).toBe(300);
  });

  it("payeeBreakdown includes payees from both Team Members and Independents", () => {
    const rows = [
      { Date: "2026-01-10", "Parent Category": "Team Members", Merchant: "Zelle", Description: "Zelle payment to Alice Smith Conf# 123", Amount: "200.00", Currency: "USD", Source: "CherrySt" },
      { Date: "2026-01-12", "Parent Category": "Independents", Merchant: "Bob Jones", Description: "Dev work", Amount: "500.00", Currency: "USD", Source: "CherrySt" },
    ];

    const result = runPreflightOnFile(rows, "expense_details", "test.csv", "sha_test");
    expect(result.payeeBreakdown).toBeDefined();
    expect(result.payeeBreakdown!.totalImportedPayoutRows).toBe(2);
    expect(result.payeeBreakdown!.uniquePayees).toContain("alice smith");
    expect(result.payeeBreakdown!.uniquePayees).toContain("bob jones");
  });

  it("sorting is deterministic (count desc, name asc tie-break)", () => {
    const rows = [
      { Date: "2026-01-01", "Parent Category": "Travel", Merchant: "Delta", Description: "", Amount: "100.00", Currency: "USD", Source: "" },
      { Date: "2026-01-02", "Parent Category": "Travel", Merchant: "United", Description: "", Amount: "200.00", Currency: "USD", Source: "" },
      { Date: "2026-01-03", "Parent Category": "Office", Merchant: "Staples", Description: "", Amount: "50.00", Currency: "USD", Source: "" },
      { Date: "2026-01-04", "Parent Category": "Office", Merchant: "OfficeMax", Description: "", Amount: "75.00", Currency: "USD", Source: "" },
    ];

    const result = runPreflightOnFile(rows, "expense_details", "test.csv", "sha_test");
    const cats = result.expenseBreakdowns!.byParentCategory;
    expect(cats[0].count).toBe(cats[1].count);
    expect(cats[0].key.localeCompare(cats[1].key)).toBeLessThan(0);
  });

  it("byPayee and byMerchant include amounts", () => {
    const rows = [
      { Date: "2026-01-01", "Parent Category": "Independents", Merchant: "Zelle", Description: "Zelle payment to Alice Smith Conf# 1", Amount: "150.00", Currency: "USD", Source: "" },
    ];

    const result = runPreflightOnFile(rows, "expense_details", "test.csv", "sha_test");
    expect(result.expenseBreakdowns!.byPayee[0].amount).toBe(150);
    expect(result.expenseBreakdowns!.byMerchant[0].amount).toBe(150);
  });
});

describe("separate merchantOther and payeeOther buckets", () => {
  function makeRow(idx: number, merchant: string, payeeDesc: string, amount: string) {
    return {
      Date: "2026-03-01",
      "Parent Category": "Independents",
      Merchant: merchant,
      Description: payeeDesc,
      Amount: amount,
      Currency: "USD",
      Source: "CherrySt",
    };
  }

  it("merchantOther and payeeOther are independent (not cross-contaminated)", () => {
    const rows: Record<string, string>[] = [];

    for (let i = 1; i <= 30; i++) {
      const pad = String(i).padStart(2, "0");
      rows.push(makeRow(
        i,
        `Vendor${pad}`,
        `Vendor${pad} services rendered`,
        `${10 * i}.00`,
      ));
    }

    for (let i = 1; i <= 5; i++) {
      const pad = String(i).padStart(2, "0");
      rows.push(makeRow(
        30 + i,
        `SharedMerchant`,
        `Zelle payment to Payee${pad} Conf# ${i}`,
        `${20 * i}.00`,
      ));
    }

    const result = runPreflightOnFile(rows, "expense_details", "test.csv", "sha_test");
    const bd = result.expenseBreakdowns!;

    expect(bd.topN).toBe(25);

    const totalMerchantCount = rows.length;
    expect(bd.byMerchant.length).toBe(25);

    const merchantTopCount = bd.byMerchant.reduce((s, m) => s + m.count, 0);
    expect(bd.merchantOther.count).toBe(totalMerchantCount - merchantTopCount);

    const merchantTopAmount = bd.byMerchant.reduce((s, m) => s + m.amount, 0);
    const totalAmount = rows.reduce((s, r) => s + parseFloat(r["Amount"]), 0);
    expect(bd.merchantOther.amount).toBeCloseTo(totalAmount - merchantTopAmount, 2);

    const payeeTopCount = bd.byPayee.reduce((s, p) => s + p.count, 0);
    expect(bd.payeeOther.count).toBe(rows.length - payeeTopCount);

    const payeeTopAmount = bd.byPayee.reduce((s, p) => s + p.amount, 0);
    expect(bd.payeeOther.amount).toBeCloseTo(totalAmount - payeeTopAmount, 2);

    const expectedMerchantOtherCount = rows.length - bd.byMerchant.reduce((s, m) => s + m.count, 0);
    const expectedPayeeOtherCount = rows.length - bd.byPayee.reduce((s, p) => s + p.count, 0);
    expect(bd.merchantOther.count).toBe(expectedMerchantOtherCount);
    expect(bd.payeeOther.count).toBe(expectedPayeeOtherCount);
  });

  it("merchantOther counts match exactly (distinctMerchants - topN) remainder", () => {
    const rows: Record<string, string>[] = [];
    for (let i = 1; i <= 28; i++) {
      const pad = String(i).padStart(2, "0");
      rows.push(makeRow(i, `Merchant${pad}`, `Merchant${pad} work`, `${100 + i}.00`));
    }

    const result = runPreflightOnFile(rows, "expense_details", "test.csv", "sha_test");
    const bd = result.expenseBreakdowns!;

    expect(bd.byMerchant.length).toBe(25);
    expect(bd.merchantOther.count).toBe(3);

    const merchantTopAmount = bd.byMerchant.reduce((s, m) => s + m.amount, 0);
    const totalAmount = rows.reduce((s, r) => s + parseFloat(r["Amount"]), 0);
    expect(bd.merchantOther.amount).toBeCloseTo(totalAmount - merchantTopAmount, 2);
  });

  it("payeeOther counts match exactly (distinctPayees - topN) remainder", () => {
    const rows: Record<string, string>[] = [];
    for (let i = 1; i <= 27; i++) {
      const pad = String(i).padStart(2, "0");
      rows.push(makeRow(i, `Zelle`, `Zelle payment to Worker${pad} Conf# ${i}`, `${50 + i}.00`));
    }

    const result = runPreflightOnFile(rows, "expense_details", "test.csv", "sha_test");
    const bd = result.expenseBreakdowns!;

    expect(bd.byPayee.length).toBe(25);
    expect(bd.payeeOther.count).toBe(2);

    const payeeTopAmount = bd.byPayee.reduce((s, p) => s + p.amount, 0);
    const totalAmount = rows.reduce((s, r) => s + parseFloat(r["Amount"]), 0);
    expect(bd.payeeOther.amount).toBeCloseTo(totalAmount - payeeTopAmount, 2);
  });

  it("when fewer than topN entries, Other buckets are zero", () => {
    const rows = [
      makeRow(1, "AlphaVendor", "AlphaVendor consulting", "100.00"),
      makeRow(2, "BetaVendor", "BetaVendor consulting", "200.00"),
    ];

    const result = runPreflightOnFile(rows, "expense_details", "test.csv", "sha_test");
    const bd = result.expenseBreakdowns!;

    expect(bd.merchantOther.count).toBe(0);
    expect(bd.merchantOther.amount).toBe(0);
    expect(bd.payeeOther.count).toBe(0);
    expect(bd.payeeOther.amount).toBe(0);
  });

  it("canonical category still works with separate Other buckets", () => {
    const rows = [
      { Date: "2026-01-10", "Parent Category": "Team Members", Merchant: "Zelle", Description: "Zelle payment to Alice Smith Conf# 1", Amount: "200.00", Currency: "USD", Source: "" },
      { Date: "2026-01-12", "Parent Category": "Independents", Merchant: "Bob Jones", Description: "Dev work", Amount: "500.00", Currency: "USD", Source: "" },
    ];

    const result = runPreflightOnFile(rows, "expense_details", "test.csv", "sha_test");
    const bd = result.expenseBreakdowns!;
    const independentsCat = bd.byParentCategory.find((c) => c.key === "independents");
    expect(independentsCat).toBeDefined();
    expect(independentsCat!.count).toBe(2);
    expect(independentsCat!.amount).toBe(700);

    expect(bd.merchantOther.count).toBe(0);
    expect(bd.payeeOther.count).toBe(0);
  });
});

describe("buildImportOps with canonical category filtering", () => {
  function makeFiles(): ParsedFileData[] {
    return [
      {
        type: "expense_details",
        sha256: "sha_exp_test",
        filename: "expenses.csv",
        rows: [
          { Date: "2026-02-01", "Parent Category": "Team Members", Merchant: "Zelle", Description: "Zelle payment to Alice Smith Conf# 1", Amount: "200.00", Currency: "USD", Source: "CherrySt" },
          { Date: "2026-02-02", "Parent Category": "Independents", Merchant: "Bob Jones", Description: "Dev work", Amount: "500.00", Currency: "USD", Source: "CherrySt" },
          { Date: "2026-02-03", "Parent Category": "Travel", Merchant: "Delta Airlines", Description: "Flight", Amount: "300.00", Currency: "USD", Source: "CherrySt" },
        ],
      },
    ];
  }

  const BASE_OPTIONS: ImportOptions = {
    importClients: false,
    importServices: false,
    servicesNonZeroOnly: false,
    importTeamMembers: false,
    importInvoices: false,
    importHistoricalPayments: false,
    importTimeEntries: false,
    timeEntrySkipDuplicates: false,
    importImportedPayouts: true,
  };

  it("expenseCategoryIncludeList=['independents'] includes both Team Members and Independents rows", () => {
    const files = makeFiles();
    const { ops } = buildImportOps(files, {
      ...BASE_OPTIONS,
      expenseCategoryIncludeList: ["independents"],
    });

    const payoutOps = ops.filter((op) => op.entityType === "imported_payout");
    expect(payoutOps).toHaveLength(2);
  });

  it("non-independent category is ignored with reason filtered_by_parent_category", () => {
    const files = makeFiles();
    const { ignored } = buildImportOps(files, {
      ...BASE_OPTIONS,
      expenseCategoryIncludeList: ["independents"],
    });

    const catFiltered = ignored.filter((r) => r.reason === "filtered_by_parent_category");
    expect(catFiltered).toHaveLength(1);
    expect(catFiltered[0].rowIndex).toBe(2);
  });

  it("without filter, Travel rows are excluded (not independent)", () => {
    const files = makeFiles();
    const { ops } = buildImportOps(files, BASE_OPTIONS);
    const payoutOps = ops.filter((op) => op.entityType === "imported_payout");
    expect(payoutOps).toHaveLength(2);
  });
});
