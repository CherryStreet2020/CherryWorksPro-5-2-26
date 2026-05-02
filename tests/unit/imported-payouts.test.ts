import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  extractPayee,
  runPreflightOnFile,
  parseCSV,
} from "../../server/import-engine";

vi.mock("../../server/storage", () => {
  const mockStorage = {
    getImportedKeyByExternalKey: vi.fn().mockResolvedValue(undefined),
    getImportedPayoutByExternalKey: vi.fn().mockResolvedValue(undefined),
    createImportedPayout: vi.fn().mockImplementation(async (data: any) => ({
      id: `payout-${Date.now()}`,
      ...data,
    })),
    createImportedKey: vi.fn().mockResolvedValue({ id: "ik-1" }),
    getClientByName: vi.fn().mockResolvedValue(undefined),
    createClient: vi
      .fn()
      .mockImplementation(async (data: any) => ({ id: "client-1", ...data })),
    getProjectByName: vi.fn().mockResolvedValue(undefined),
    createProject: vi
      .fn()
      .mockImplementation(async (data: any) => ({ id: "proj-1", ...data })),
    markTimeEntriesInvoiced: vi.fn().mockResolvedValue(undefined),
    createTimeEntry: vi
      .fn()
      .mockImplementation(async (data: any) => ({ id: "te-1", ...data })),
  };
  return { storage: mockStorage };
});

describe("independent-payouts", () => {
  describe("extractPayee", () => {
    it("extracts payee from Zelle description with heavy whitespace", () => {
      const result = extractPayee({
        merchant: "Zelle",
        description:
          "Zelle payment to                                             Dean Dunagan                                               Conf# h4cmrz0tb",
      });
      expect(result.payeeRaw).toBe("Dean Dunagan");
      expect(result.payeeNormalized).toBe("dean dunagan");
    });

    it("extracts payee from Venmo description", () => {
      const result = extractPayee({
        merchant: "Venmo",
        description: "Venmo payment to Kelly Jo Miller Conf# abc123",
      });
      expect(result.payeeRaw).toBe("Kelly Jo Miller");
      expect(result.payeeNormalized).toBe("kelly jo miller");
    });

    it("falls back to merchant for non-pass-through merchants", () => {
      const result = extractPayee({
        merchant: "Sophie Nyland",
        description: "Direct payment for consulting",
      });
      expect(result.payeeRaw).toBe("Sophie Nyland");
      expect(result.payeeNormalized).toBe("sophie nyland");
    });

    it("falls back to merchant when Zelle description has no parseable payee", () => {
      const result = extractPayee({
        merchant: "Zelle",
        description: "Random transaction 12345",
      });
      expect(result.payeeRaw).toBe("Zelle");
      expect(result.payeeNormalized).toBe("zelle");
    });

    it("handles PayPal as a pass-through merchant", () => {
      const result = extractPayee({
        merchant: "PayPal",
        description: "PayPal transfer to John Smith ref#xyz",
      });
      expect(result.payeeRaw).toBe("John Smith");
      expect(result.payeeNormalized).toBe("john smith");
    });

    it("normalizes whitespace in extracted payee", () => {
      const result = extractPayee({
        merchant: "Zelle",
        description: "Zelle payment to   Dean   Dunagan   Conf# abc",
      });
      expect(result.payeeRaw).toBe("Dean Dunagan");
      expect(result.payeeNormalized).toBe("dean dunagan");
    });
  });

  describe("preflight payee breakdown", () => {
    it("reports payee breakdown for expense_details with Zelle independent rows", () => {
      const csv = [
        "Date,Account Sub Type,Parent Category,Subcategory,Source,Merchant,Project,Client,Description,Tax 1 Amount,Tax 1 Type,Tax 2 Amount,Tax 2 Type,Amount,Currency",
        '2026-02-17,Operating Expense,Independents,Independents (general),CherrySt,Zelle,,,"Zelle payment to                                             Dean Dunagan                                               Conf# h4cmrz0tb",0.00,,0.00,,350.00,USD',
        "2026-02-20,Operating Expense,Independents,Independents (general),CherrySt,Sophie Nyland,,,Consulting services,0.00,,0.00,,500.00,USD",
      ].join("\n");

      const rows = parseCSV(csv);
      const preflight = runPreflightOnFile(
        rows,
        "expense_details",
        "exp.csv",
        "sha123",
      );

      expect(preflight.independentPayoutSum).toBe(850);
      expect(preflight.payeeBreakdown).not.toBeNull();
      expect(preflight.payeeBreakdown!.totalImportedPayoutRows).toBe(2);
      expect(preflight.payeeBreakdown!.uniquePayees).toContain("dean dunagan");
      expect(preflight.payeeBreakdown!.uniquePayees).toContain(
        "sophie nyland",
      );
      expect(preflight.payeeBreakdown!.payeeParseFallbackCount).toBe(0);
    });

    it("counts payee parse fallback when Zelle description is not parseable", () => {
      const csv = [
        "Date,Account Sub Type,Parent Category,Subcategory,Source,Merchant,Project,Client,Description,Tax 1 Amount,Tax 1 Type,Tax 2 Amount,Tax 2 Type,Amount,Currency",
        "2026-02-17,Operating Expense,Independents,Independents (general),CherrySt,Zelle,,,Random 12345,0.00,,0.00,,350.00,USD",
      ].join("\n");

      const rows = parseCSV(csv);
      const preflight = runPreflightOnFile(
        rows,
        "expense_details",
        "exp.csv",
        "sha123",
      );

      expect(preflight.payeeBreakdown!.payeeParseFallbackCount).toBe(1);
    });
  });

  describe("executeImport independent payouts (mocked storage)", () => {
    let mockStorage: any;

    beforeEach(async () => {
      const mod = await import("../../server/storage");
      mockStorage = mod.storage;
      vi.clearAllMocks();
      mockStorage.getImportedKeyByExternalKey.mockResolvedValue(undefined);
      mockStorage.getImportedPayoutByExternalKey.mockResolvedValue(undefined);
      mockStorage.createImportedPayout.mockImplementation(
        async (data: any) => ({
          id: `payout-real-${data.externalKey}`,
          ...data,
        }),
      );
      mockStorage.createImportedKey.mockResolvedValue({ id: "ik-1" });
    });

    it("persists independent payout with payeeName from Zelle description", async () => {
      const { executeImport } = await import("../../server/import-engine");

      const files = [
        {
          type: "expense_details" as const,
          sha256: "abc123",
          filename: "exp.csv",
          rows: [
            {
              Date: "2026-02-17",
              "Account Sub Type": "Operating Expense",
              "Parent Category": "Independents",
              Subcategory: "Independents (general)",
              Source: "CherrySt",
              Merchant: "Zelle",
              Description:
                "Zelle payment to                                             Dean Dunagan                                               Conf# h4cmrz0tb",
              Amount: "350.00",
              Currency: "USD",
            },
          ],
        },
      ];

      const counts = await executeImport("org-1", "user-1", "run-1", files, {
        importClients: false,
        importServices: false,
        servicesNonZeroOnly: false,
        importIndependents: false,
        importInvoices: false,
        importHistoricalPayments: false,
        importTimeEntries: false,
        timeEntrySkipDuplicates: false,
        importImportedPayouts: true,
      });

      expect(counts["imported_payout"]).toBe(1);

      expect(mockStorage.createImportedPayout).toHaveBeenCalledTimes(1);
      const createCall = mockStorage.createImportedPayout.mock.calls[0][0];
      expect(createCall.payeeName).toBe("Dean Dunagan");
      expect(createCall.payeeNormalized).toBe("dean dunagan");

      expect(mockStorage.createImportedKey).toHaveBeenCalledTimes(1);
      const ikCall = mockStorage.createImportedKey.mock.calls[0][0];
      expect(ikCall.entityType).toBe("imported_payout");
      expect(ikCall.entityId).toBe("payout-real-FB:PAYOUT:abc123:0");
    });

    it("imported_key.entityId equals the returned payout.id", async () => {
      mockStorage.createImportedPayout.mockResolvedValue({
        id: "payout-uuid-777",
      });

      const { executeImport } = await import("../../server/import-engine");

      const files = [
        {
          type: "expense_details" as const,
          sha256: "sha999",
          filename: "exp.csv",
          rows: [
            {
              Date: "2026-03-01",
              "Parent Category": "Independents",
              Merchant: "Sophie Nyland",
              Description: "Consulting payment",
              Amount: "500.00",
              Currency: "USD",
              Source: "CherrySt",
            },
          ],
        },
      ];

      await executeImport("org-1", "user-1", "run-2", files, {
        importClients: false,
        importServices: false,
        servicesNonZeroOnly: false,
        importIndependents: false,
        importInvoices: false,
        importHistoricalPayments: false,
        importTimeEntries: false,
        timeEntrySkipDuplicates: false,
        importImportedPayouts: true,
      });

      const ikCall = mockStorage.createImportedKey.mock.calls[0][0];
      expect(ikCall.entityId).toBe("payout-uuid-777");
    });

    it("uses existing payout on rerun (idempotency via getImportedPayoutByExternalKey)", async () => {
      mockStorage.getImportedPayoutByExternalKey.mockResolvedValue({
        id: "existing-payout-id-555",
        externalKey: "FB:PAYOUT:sha888:0",
      });

      const { executeImport } = await import("../../server/import-engine");

      const files = [
        {
          type: "expense_details" as const,
          sha256: "sha888",
          filename: "exp.csv",
          rows: [
            {
              Date: "2026-02-17",
              "Parent Category": "Independents",
              Merchant: "Zelle",
              Description:
                "Zelle payment to Dean Dunagan Conf# h4cmrz0tb",
              Amount: "350.00",
              Currency: "USD",
              Source: "CherrySt",
            },
          ],
        },
      ];

      const counts = await executeImport("org-1", "user-1", "run-3", files, {
        importClients: false,
        importServices: false,
        servicesNonZeroOnly: false,
        importIndependents: false,
        importInvoices: false,
        importHistoricalPayments: false,
        importTimeEntries: false,
        timeEntrySkipDuplicates: false,
        importImportedPayouts: true,
      });

      expect(counts["imported_payout"]).toBe(1);
      expect(mockStorage.createImportedPayout).not.toHaveBeenCalled();
      const ikCall = mockStorage.createImportedKey.mock.calls[0][0];
      expect(ikCall.entityId).toBe("existing-payout-id-555");
    });
  });
});
