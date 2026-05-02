import { describe, it, expect } from "vitest";
import { buildImportOps, computeOpCountsByType, computeIgnoredBreakdown } from "../../server/import-engine";
import type { ImportOptions, ParsedFileData } from "../../server/import-engine";

const BASE_OPTIONS: ImportOptions = {
  importClients: true,
  importServices: false,
  servicesNonZeroOnly: false,
  importTeamMembers: false,
  importInvoices: true,
  importHistoricalPayments: true,
  importTimeEntries: true,
  timeEntrySkipDuplicates: false,
  importImportedPayouts: true,
};

function makeFiles(): ParsedFileData[] {
  return [
    {
      type: "clients",
      sha256: "sha_clients_001",
      filename: "clients.csv",
      rows: [
        { Organization: "ABS Machining", "First Name": "", "Last Name": "", Email: "abs@co.ca", Phone: "555-1234" },
        { Organization: "Beta Corp", "First Name": "", "Last Name": "", Email: "beta@co.ca", Phone: "" },
      ],
    },
    {
      type: "invoice_details",
      sha256: "sha_inv_001",
      filename: "invoices.csv",
      rows: [
        { "Client Name": "ABS Machining", "Invoice #": "100", "Date Issued": "2026-01-01", "Date Due": "2026-02-01", "Invoice Status": "paid", "Date Paid": "2026-01-15", "Item Name": "Consulting", Rate: "100", Quantity: "2", "Line Total": "200" },
        { "Client Name": "ABS Machining", "Invoice #": "100", "Date Issued": "2026-01-01", "Date Due": "2026-02-01", "Invoice Status": "paid", "Date Paid": "2026-01-15", "Item Name": "Travel", Rate: "50", Quantity: "1", "Line Total": "50" },
        { "Client Name": "Beta Corp", "Invoice #": "101", "Date Issued": "2026-02-01", "Date Due": "2026-03-01", "Invoice Status": "sent", "Date Paid": "", "Item Name": "Dev", Rate: "150", Quantity: "3", "Line Total": "450" },
      ],
    },
    {
      type: "time_entry_details",
      sha256: "sha_time_001",
      filename: "time.csv",
      rows: [
        { Date: "2026-02-01", Client: "ABS Machining", Project: "ERP Upgrade", Service: "Dev", Note: "Worked on module", "Team Member": "Dean", Status: "billed", Hours: "4.0000", Seconds: "14400" },
        { Date: "2026-02-02", Client: "Beta Corp", Project: "Web Redesign", Service: "Design", Note: "Mockups", "Team Member": "Kelly", Status: "unbilled", Hours: "2.5000", Seconds: "9000" },
      ],
    },
    {
      type: "expense_details",
      sha256: "sha_exp_001",
      filename: "expenses.csv",
      rows: [
        { Date: "2026-02-17", "Parent Category": "Independents", Merchant: "Zelle", Description: "Zelle payment to Dean Dunagan Conf# abc", Amount: "350.00", Currency: "USD", Source: "CherrySt" },
        { Date: "2026-02-20", "Parent Category": "Independents", Merchant: "Sophie Nyland", Description: "Consulting services", Amount: "500.00", Currency: "USD", Source: "CherrySt" },
        { Date: "2026-02-22", "Parent Category": "Travel", Merchant: "Delta Airlines", Description: "Flight to Toronto", Amount: "742.30", Currency: "USD", Source: "CherrySt" },
      ],
    },
  ];
}

describe("import-parity (buildImportOps)", () => {
  it("produces deterministic ops and planHash for fixed input", () => {
    const files = makeFiles();
    const result1 = buildImportOps(files, BASE_OPTIONS);
    const result2 = buildImportOps(files, BASE_OPTIONS);

    expect(result1.planHash).toBe(result2.planHash);
    expect(result1.ops.length).toBe(result2.ops.length);
    expect(result1.planHash).toHaveLength(64);
  });

  it("generates correct op counts for each entity type", () => {
    const files = makeFiles();
    const { ops } = buildImportOps(files, BASE_OPTIONS);

    const counts = computeOpCountsByType(ops);

    expect(counts["client"]).toBe(2);
    expect(counts["project"]).toBe(2);
    expect(counts["invoice"]).toBe(2);
    expect(counts["invoice_line"]).toBe(3);
    expect(counts["payment"]).toBe(1);
    expect(counts["time_entry"]).toBe(2);
    expect(counts["imported_payout"]).toBe(2);
  });

  it("planHash changes when options differ (disable independent payouts)", () => {
    const files = makeFiles();
    const result1 = buildImportOps(files, BASE_OPTIONS);
    const result2 = buildImportOps(files, { ...BASE_OPTIONS, importImportedPayouts: false });

    expect(result1.planHash).not.toBe(result2.planHash);
    const payoutOps2 = result2.ops.filter((op) => op.entityType === "imported_payout");
    expect(payoutOps2).toHaveLength(0);
  });

  it("planHash changes when payeeIncludeList filters a payee", () => {
    const files = makeFiles();
    const result1 = buildImportOps(files, BASE_OPTIONS);
    const result2 = buildImportOps(files, {
      ...BASE_OPTIONS,
      payeeIncludeList: ["dean dunagan"],
    });

    expect(result1.planHash).not.toBe(result2.planHash);
    const payoutOps = result2.ops.filter((op) => op.entityType === "imported_payout");
    expect(payoutOps).toHaveLength(1);
    expect(payoutOps[0].normalizedKeyFields.payee).toBe("dean dunagan");
  });

  it("planHash changes when expenseCategoryIncludeList filters categories", () => {
    const files = makeFiles();
    const result1 = buildImportOps(files, BASE_OPTIONS);
    const result2 = buildImportOps(files, {
      ...BASE_OPTIONS,
      expenseCategoryIncludeList: ["independents"],
    });

    expect(result1.planHash).toBe(result2.planHash);

    const result3 = buildImportOps(files, {
      ...BASE_OPTIONS,
      expenseCategoryIncludeList: ["travel"],
    });
    expect(result3.planHash).not.toBe(result1.planHash);
    const payoutOps = result3.ops.filter((op) => op.entityType === "imported_payout");
    expect(payoutOps).toHaveLength(0);
  });

  it("tracks ignored rows with reasons", () => {
    const files = makeFiles();
    const { ignored } = buildImportOps(files, {
      ...BASE_OPTIONS,
      timeEntryDateStart: "2026-02-02",
    });

    const dateFiltered = ignored.filter((r) => r.reason === "date_out_of_range");
    expect(dateFiltered.length).toBeGreaterThanOrEqual(1);
    expect(dateFiltered[0].fileType).toBe("time_entry_details");
  });

  it("duplicate time rows are tracked as ignored when skip is on", () => {
    const filesWithDup = makeFiles();
    filesWithDup[2].rows.push({ ...filesWithDup[2].rows[0] });

    const { ignored } = buildImportOps(filesWithDup, {
      ...BASE_OPTIONS,
      timeEntrySkipDuplicates: true,
    });

    const dupIgnored = ignored.filter((r) => r.reason === "duplicate_time_row");
    expect(dupIgnored).toHaveLength(1);
  });

  it("independent payout externalKeys include file sha256", () => {
    const files = makeFiles();
    const { ops } = buildImportOps(files, BASE_OPTIONS);
    const payoutOps = ops.filter((op) => op.entityType === "imported_payout");
    for (const op of payoutOps) {
      expect(op.externalKey).toContain("sha_exp_001");
    }
  });

  it("emits explicit project ops for time-entry-derived projects", () => {
    const files = makeFiles();
    const { ops } = buildImportOps(files, BASE_OPTIONS);
    const projectOps = ops.filter((op) => op.entityType === "project");
    expect(projectOps).toHaveLength(2);
    const keys = projectOps.map((op) => op.externalKey).sort();
    expect(keys).toEqual([
      "FB:PROJ:ABS Machining:ERP Upgrade",
      "FB:PROJ:Beta Corp:Web Redesign",
    ]);
  });

  it("project ops are deduplicated for same client+project", () => {
    const files = makeFiles();
    files[2].rows.push({
      Date: "2026-02-03",
      Client: "ABS Machining",
      Project: "ERP Upgrade",
      Service: "Review",
      Note: "Code review",
      "Team Member": "Dean",
      Status: "unbilled",
      Hours: "1.0000",
      Seconds: "3600",
    });
    const { ops } = buildImportOps(files, BASE_OPTIONS);
    const projectOps = ops.filter((op) => op.entityType === "project");
    expect(projectOps).toHaveLength(2);
  });

  it("computeIgnoredBreakdown aggregates by reason", () => {
    const files = makeFiles();
    const { ignored } = buildImportOps(files, {
      ...BASE_OPTIONS,
      timeEntryDateStart: "2026-02-02",
      payeeIncludeList: ["dean dunagan"],
    });
    const breakdown = computeIgnoredBreakdown(ignored);
    expect(breakdown["date_out_of_range"]).toBeGreaterThanOrEqual(1);
    expect(breakdown["filtered_by_payee"]).toBeGreaterThanOrEqual(1);
  });

  it("computeOpCountsByType matches manual count", () => {
    const files = makeFiles();
    const { ops } = buildImportOps(files, BASE_OPTIONS);
    const counts = computeOpCountsByType(ops);
    const manualCounts: Record<string, number> = {};
    for (const op of ops) {
      manualCounts[op.entityType] = (manualCounts[op.entityType] || 0) + 1;
    }
    expect(counts).toEqual(manualCounts);
  });
});
