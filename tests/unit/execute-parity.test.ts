import { describe, it, expect } from "vitest";
import {
  buildImportOps,
  applyImportOps,
  computeOpCountsByType,
} from "../../server/import-engine";
import type {
  ImportOptions,
  ParsedFileData,
  ImportStorage,
} from "../../server/import-engine";

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

function createMockStorage(): ImportStorage & {
  createdEntities: Array<{ entityType: string; externalKey: string; data: unknown }>;
  importedKeys: Array<{ entityType: string; externalKey: string; entityId: string }>;
} {
  let idCounter = 0;
  const createdEntities: Array<{ entityType: string; externalKey: string; data: unknown }> = [];
  const importedKeys: Array<{ entityType: string; externalKey: string; entityId: string }> = [];
  const importedKeyMap = new Map<string, { entityId: string }>();

  return {
    createdEntities,
    importedKeys,
    async getImportedKeyByExternalKey(key: string) {
      return importedKeyMap.get(key);
    },
    async getClientByName() {
      return undefined;
    },
    async getProjectByName() {
      return undefined;
    },
    async getImportedPayoutByExternalKey() {
      return undefined;
    },
    async createClient(data) {
      const id = `client_${++idCounter}`;
      createdEntities.push({ entityType: "client", externalKey: `FB:CLIENT:${data.name}`, data });
      return { id };
    },
    async createProject(data) {
      const id = `project_${++idCounter}`;
      createdEntities.push({ entityType: "project", externalKey: `FB:PROJ:${data.name}`, data });
      return { id };
    },
    async createInvoice(data) {
      const id = `invoice_${++idCounter}`;
      createdEntities.push({ entityType: "invoice", externalKey: `inv:${(data as Record<string, unknown>).number}`, data });
      return { id };
    },
    async createInvoiceLine(data) {
      const id = `invline_${++idCounter}`;
      createdEntities.push({ entityType: "invoice_line", externalKey: `invline:${id}`, data });
      return { id };
    },
    async createPayment(data) {
      const id = `payment_${++idCounter}`;
      createdEntities.push({ entityType: "payment", externalKey: `pay:${id}`, data });
      return { id };
    },
    async createTimeEntry(data) {
      const id = `time_${++idCounter}`;
      createdEntities.push({ entityType: "time_entry", externalKey: `time:${id}`, data });
      return { id };
    },
    async createImportedPayout(data) {
      const id = `payout_${++idCounter}`;
      createdEntities.push({ entityType: "imported_payout", externalKey: (data as Record<string, unknown>).externalKey as string, data });
      return { id };
    },
    async createImportedKey(data) {
      importedKeys.push({ entityType: data.entityType, externalKey: data.externalKey, entityId: data.entityId });
      importedKeyMap.set(data.externalKey, { entityId: data.entityId });
    },
    async recalcInvoiceTotals() {},
    async markTimeEntriesInvoiced() {},
  };
}

describe("execute-parity (applyImportOps)", () => {
  it("storage creates correspond 1:1 to ops by entityType", async () => {
    const files = makeFiles();
    const { ops } = buildImportOps(files, BASE_OPTIONS);
    const opCounts = computeOpCountsByType(ops);

    const mockStorage = createMockStorage();
    const counts = await applyImportOps("org1", "user1", "run1", files, ops, mockStorage);

    expect(counts["client"]).toBe(opCounts["client"]);
    expect(counts["invoice"]).toBe(opCounts["invoice"]);
    expect(counts["invoice_line"]).toBe(opCounts["invoice_line"]);
    expect(counts["payment"]).toBe(opCounts["payment"]);
    expect(counts["time_entry"]).toBe(opCounts["time_entry"]);
    expect(counts["imported_payout"]).toBe(opCounts["imported_payout"]);
    expect(counts["project"]).toBe(opCounts["project"]);
  });

  it("imported keys match ops externalKeys", async () => {
    const files = makeFiles();
    const { ops } = buildImportOps(files, BASE_OPTIONS);

    const mockStorage = createMockStorage();
    await applyImportOps("org1", "user1", "run1", files, ops, mockStorage);

    const opExternalKeys = ops.map((op) => op.externalKey).sort();
    const importedExternalKeys = mockStorage.importedKeys.map((k) => k.externalKey).sort();

    expect(importedExternalKeys).toEqual(opExternalKeys);
  });

  it("imported key entityTypes match op entityTypes", async () => {
    const files = makeFiles();
    const { ops } = buildImportOps(files, BASE_OPTIONS);

    const mockStorage = createMockStorage();
    await applyImportOps("org1", "user1", "run1", files, ops, mockStorage);

    for (const op of ops) {
      const matchingKey = mockStorage.importedKeys.find((k) => k.externalKey === op.externalKey);
      expect(matchingKey).toBeDefined();
      expect(matchingKey!.entityType).toBe(op.entityType);
    }
  });

  it("filtered payees do not produce ops or creates", async () => {
    const files = makeFiles();
    const filteredOptions: ImportOptions = {
      ...BASE_OPTIONS,
      payeeIncludeList: ["dean dunagan"],
    };

    const { ops, ignored } = buildImportOps(files, filteredOptions);
    const payoutOps = ops.filter((op) => op.entityType === "imported_payout");
    expect(payoutOps).toHaveLength(1);
    expect(payoutOps[0].normalizedKeyFields.payee).toBe("dean dunagan");

    const filteredIgnored = ignored.filter((r) => r.reason === "filtered_by_payee");
    expect(filteredIgnored.length).toBeGreaterThanOrEqual(1);

    const mockStorage = createMockStorage();
    const counts = await applyImportOps("org1", "user1", "run1", files, ops, mockStorage);
    expect(counts["imported_payout"]).toBe(1);

    const payoutCreates = mockStorage.createdEntities.filter((e) => e.entityType === "imported_payout");
    expect(payoutCreates).toHaveLength(1);
  });

  it("filtered categories do not produce ops or creates", async () => {
    const files = makeFiles();
    const filteredOptions: ImportOptions = {
      ...BASE_OPTIONS,
      expenseCategoryIncludeList: ["travel"],
    };

    const { ops, ignored } = buildImportOps(files, filteredOptions);
    const payoutOps = ops.filter((op) => op.entityType === "imported_payout");
    expect(payoutOps).toHaveLength(0);

    const catIgnored = ignored.filter((r) => r.reason === "filtered_by_parent_category");
    expect(catIgnored.length).toBeGreaterThanOrEqual(1);

    const mockStorage = createMockStorage();
    const counts = await applyImportOps("org1", "user1", "run1", files, ops, mockStorage);
    expect(counts["imported_payout"]).toBeUndefined();
  });

  it("idempotency: second run skips already-imported keys", async () => {
    const files = makeFiles();
    const { ops } = buildImportOps(files, BASE_OPTIONS);

    const mockStorage = createMockStorage();
    const counts1 = await applyImportOps("org1", "user1", "run1", files, ops, mockStorage);

    const totalCreated1 = Object.values(counts1).reduce((a, b) => a + b, 0);
    expect(totalCreated1).toBeGreaterThan(0);

    const counts2 = await applyImportOps("org1", "user1", "run2", files, ops, mockStorage);
    const totalCreated2 = Object.values(counts2).reduce((a, b) => a + b, 0);
    expect(totalCreated2).toBe(0);
  });

  it("op order is deterministic across runs", () => {
    const files = makeFiles();
    const result1 = buildImportOps(files, BASE_OPTIONS);
    const result2 = buildImportOps(files, BASE_OPTIONS);

    expect(result1.ops.map((o) => `${o.entityType}:${o.externalKey}`)).toEqual(
      result2.ops.map((o) => `${o.entityType}:${o.externalKey}`),
    );
  });
});
