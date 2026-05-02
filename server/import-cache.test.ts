import { describe, it, expect } from "vitest";
import {
  ParsedFileCache,
  buildImportOps,
  verifyImportResults,
} from "./import-engine";
import type { ImportOptions, ImportStorage, ParsedFileData } from "./import-engine";

const sampleTimeRows = [
  { Date: "2025-01-15", Client: "Acme Corp", Project: "Website", Service: "Development", "Team Member": "John Doe", Hours: "2.5", Note: "work" },
  { Date: "2025-01-16", Client: "Acme Corp", Project: "Website", Service: "Design", "Team Member": "Jane Smith", Hours: "3.0", Note: "design" },
];

const sampleInvoiceRows = [
  { "Client Name": "Acme Corp", "Invoice #": "INV-001", "Date Issued": "2025-01-01", "Date Due": "2025-01-31", "Invoice Status": "Paid", "Date Paid": "2025-01-15", "Line Total": "500.00", "Item Name": "Dev work", Rate: "100", Quantity: "5" },
  { "Client Name": "Acme Corp", "Invoice #": "INV-002", "Date Issued": "2025-02-01", "Date Due": "2025-02-28", "Invoice Status": "Sent", "Line Total": "300.00", "Item Name": "Design", Rate: "150", Quantity: "2" },
];

const sampleFiles: ParsedFileData[] = [
  { type: "time_entry_details", rows: sampleTimeRows, sha256: "abc123", filename: "time.csv" },
  { type: "invoice_details", rows: sampleInvoiceRows, sha256: "def456", filename: "invoices.csv" },
];

const baseOptions: ImportOptions = {
  importClients: false,
  importServices: false,
  servicesNonZeroOnly: false,
  importTeamMembers: false,
  importInvoices: true,
  importHistoricalPayments: true,
  importTimeEntries: true,
  timeEntrySkipDuplicates: false,
  importImportedPayouts: false,
};

describe("ParsedFileCache", () => {
  it("stores and retrieves parsed files by type", () => {
    const cache = new ParsedFileCache();
    for (const f of sampleFiles) {
      cache.set(f.type, f);
    }
    expect(cache.size()).toBe(2);
    expect(cache.get("time_entry_details")).toBe(sampleFiles[0]);
    expect(cache.get("invoice_details")).toBe(sampleFiles[1]);
    expect(cache.get("clients")).toBeUndefined();
  });

  it("getAll returns all cached files", () => {
    const cache = new ParsedFileCache();
    for (const f of sampleFiles) {
      cache.set(f.type, f);
    }
    const all = cache.getAll();
    expect(all.length).toBe(2);
  });

  it("buildOps caches results for same options", () => {
    const cache = new ParsedFileCache();
    for (const f of sampleFiles) {
      cache.set(f.type, f);
    }

    const result1 = cache.buildOps(baseOptions);
    const result2 = cache.buildOps(baseOptions);
    expect(result1).toBe(result2);
  });

  it("buildOps recomputes when options change", () => {
    const cache = new ParsedFileCache();
    for (const f of sampleFiles) {
      cache.set(f.type, f);
    }

    const result1 = cache.buildOps(baseOptions);
    const altOptions = { ...baseOptions, importInvoices: false };
    const result2 = cache.buildOps(altOptions);
    expect(result1).not.toBe(result2);
    expect(result2.ops.length).toBeLessThan(result1.ops.length);
  });

  it("invalidateOps forces recomputation", () => {
    const cache = new ParsedFileCache();
    for (const f of sampleFiles) {
      cache.set(f.type, f);
    }

    const result1 = cache.buildOps(baseOptions);
    cache.invalidateOps();
    const result2 = cache.buildOps(baseOptions);
    expect(result1).not.toBe(result2);
    expect(result1.planHash).toBe(result2.planHash);
  });

  it("same parsed data produces same planHash between dry-run and execute", () => {
    const cache = new ParsedFileCache();
    for (const f of sampleFiles) {
      cache.set(f.type, f);
    }

    const dryRunResult = cache.buildOps(baseOptions);

    const files = cache.getAll();
    const executeResult = buildImportOps(files, baseOptions);

    expect(dryRunResult.planHash).toBe(executeResult.planHash);
    expect(dryRunResult.ops.length).toBe(executeResult.ops.length);
  });

  it("adding a file invalidates ops cache", () => {
    const cache = new ParsedFileCache();
    cache.set("time_entry_details", sampleFiles[0]);
    const result1 = cache.buildOps({ ...baseOptions, importInvoices: false });

    cache.set("invoice_details", sampleFiles[1]);
    const result2 = cache.buildOps(baseOptions);
    expect(result1).not.toBe(result2);
  });
});

describe("planHash integrity", () => {
  it("same data + same options = same hash", () => {
    const result1 = buildImportOps(sampleFiles, baseOptions);
    const result2 = buildImportOps(sampleFiles, baseOptions);
    expect(result1.planHash).toBe(result2.planHash);
  });

  it("different options = different hash", () => {
    const result1 = buildImportOps(sampleFiles, baseOptions);
    const result2 = buildImportOps(sampleFiles, { ...baseOptions, importInvoices: false });
    expect(result1.planHash).not.toBe(result2.planHash);
  });

  it("different data = different hash", () => {
    const result1 = buildImportOps(sampleFiles, baseOptions);
    const altFiles = [
      ...sampleFiles.slice(0, 1),
      {
        ...sampleFiles[1],
        rows: [
          ...sampleInvoiceRows,
          { "Client Name": "New Client", "Invoice #": "INV-003", "Date Issued": "2025-03-01", "Date Due": "2025-03-31", "Invoice Status": "Draft", "Line Total": "100.00", "Item Name": "Extra", Rate: "100", Quantity: "1" },
        ],
      },
    ];
    const result2 = buildImportOps(altFiles, baseOptions);
    expect(result1.planHash).not.toBe(result2.planHash);
  });
});

describe("verifyImportResults", () => {
  it("passes when counts match", async () => {
    const mockStorage: ImportStorage = {
      getImportedKeyByExternalKey: async () => undefined,
      getImportedKeysByRun: async () => [
        { entityType: "client", externalKey: "FB:CLIENT:Acme", entityId: "c1" },
        { entityType: "invoice", externalKey: "FB:INV:001", entityId: "i1" },
        { entityType: "invoice", externalKey: "FB:INV:002", entityId: "i2" },
      ],
      getClientByName: async () => undefined,
      getProjectByName: async () => undefined,
      getImportedPayoutByExternalKey: async () => undefined,
      createClient: async () => ({ id: "c1" }),
      createProject: async () => ({ id: "p1" }),
      createInvoice: async () => ({ id: "i1" }),
      createInvoiceLine: async () => ({ id: "il1" }),
      createPayment: async () => ({ id: "pay1" }),
      createTimeEntry: async () => ({ id: "te1" }),
      createImportedPayout: async () => ({ id: "cp1" }),
      createImportedKey: async () => undefined,
      recalcInvoiceTotals: async (_invoiceId: string, _orgId: string) => {},
      markTimeEntriesInvoiced: async () => {},
    };

    const result = await verifyImportResults(
      "run-1",
      { client: 1, invoice: 2 },
      mockStorage,
      "org-test",
    );

    expect(result.passed).toBe(true);
    expect(result.checks.length).toBe(2);
    expect(result.checks.every(c => c.passed)).toBe(true);
  });

  it("fails when counts mismatch", async () => {
    const mockStorage: ImportStorage = {
      getImportedKeyByExternalKey: async () => undefined,
      getImportedKeysByRun: async () => [
        { entityType: "client", externalKey: "FB:CLIENT:Acme", entityId: "c1" },
        { entityType: "invoice", externalKey: "FB:INV:001", entityId: "i1" },
      ],
      getClientByName: async () => undefined,
      getProjectByName: async () => undefined,
      getImportedPayoutByExternalKey: async () => undefined,
      createClient: async () => ({ id: "c1" }),
      createProject: async () => ({ id: "p1" }),
      createInvoice: async () => ({ id: "i1" }),
      createInvoiceLine: async () => ({ id: "il1" }),
      createPayment: async () => ({ id: "pay1" }),
      createTimeEntry: async () => ({ id: "te1" }),
      createImportedPayout: async () => ({ id: "cp1" }),
      createImportedKey: async () => undefined,
      recalcInvoiceTotals: async (_invoiceId: string, _orgId: string) => {},
      markTimeEntriesInvoiced: async () => {},
    };

    const result = await verifyImportResults(
      "run-1",
      { client: 1, invoice: 3 },
      mockStorage,
      "org-test",
    );

    expect(result.passed).toBe(false);
    const invoiceCheck = result.checks.find(c => c.entity === "invoice");
    expect(invoiceCheck?.expected).toBe(3);
    expect(invoiceCheck?.actual).toBe(1);
    expect(invoiceCheck?.passed).toBe(false);
  });

  it("detects unexpected entity types in DB", async () => {
    const mockStorage: ImportStorage = {
      getImportedKeyByExternalKey: async () => undefined,
      getImportedKeysByRun: async () => [
        { entityType: "client", externalKey: "FB:CLIENT:Acme", entityId: "c1" },
        { entityType: "time_entry", externalKey: "FB:TIME:abc:0", entityId: "te1" },
      ],
      getClientByName: async () => undefined,
      getProjectByName: async () => undefined,
      getImportedPayoutByExternalKey: async () => undefined,
      createClient: async () => ({ id: "c1" }),
      createProject: async () => ({ id: "p1" }),
      createInvoice: async () => ({ id: "i1" }),
      createInvoiceLine: async () => ({ id: "il1" }),
      createPayment: async () => ({ id: "pay1" }),
      createTimeEntry: async () => ({ id: "te1" }),
      createImportedPayout: async () => ({ id: "cp1" }),
      createImportedKey: async () => undefined,
      recalcInvoiceTotals: async (_invoiceId: string, _orgId: string) => {},
      markTimeEntriesInvoiced: async () => {},
    };

    const result = await verifyImportResults(
      "run-1",
      { client: 1 },
      mockStorage,
      "org-test",
    );

    expect(result.passed).toBe(false);
    const unexpectedCheck = result.checks.find(c => c.entity === "time_entry");
    expect(unexpectedCheck?.expected).toBe(0);
    expect(unexpectedCheck?.actual).toBe(1);
  });

  it("handles empty results gracefully", async () => {
    const mockStorage: ImportStorage = {
      getImportedKeyByExternalKey: async () => undefined,
      getImportedKeysByRun: async () => [],
      getClientByName: async () => undefined,
      getProjectByName: async () => undefined,
      getImportedPayoutByExternalKey: async () => undefined,
      createClient: async () => ({ id: "c1" }),
      createProject: async () => ({ id: "p1" }),
      createInvoice: async () => ({ id: "i1" }),
      createInvoiceLine: async () => ({ id: "il1" }),
      createPayment: async () => ({ id: "pay1" }),
      createTimeEntry: async () => ({ id: "te1" }),
      createImportedPayout: async () => ({ id: "cp1" }),
      createImportedKey: async () => undefined,
      recalcInvoiceTotals: async (_invoiceId: string, _orgId: string) => {},
      markTimeEntriesInvoiced: async () => {},
    };

    const result = await verifyImportResults(
      "run-1",
      {},
      mockStorage,
      "org-test",
    );

    expect(result.passed).toBe(true);
    expect(result.checks.length).toBe(0);
  });
});
