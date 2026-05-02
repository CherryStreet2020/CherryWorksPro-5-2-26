import { describe, it, expect } from "vitest";
import {
  detectFileType,
  parseCSV,
  parseCSVWithIntegrity,
  sha256Sync,
  normalizeName,
  runPreflightOnFile,
} from "../../server/import-engine";
import { parseCsvWithMeta, mapRows } from "../../shared/csv";

describe("import-engine", () => {
  it("detects clients CSV by header signature", () => {
    const header =
      'Organization,First Name,Last Name,Email,Phone,Address Line 1,Address Line 2,City,Province/State,Country,Postal Code,Notes';
    expect(detectFileType(header)).toBe("clients");
  });

  it("detects vendors CSV by header signature", () => {
    const header =
      "Organization,First Name,Last Name,Account Number,Email,Website,Phone";
    expect(detectFileType(header)).toBe("vendors");
  });

  it("detects services CSV by header signature", () => {
    const header = "Name,Type,Rate,Income Account,Status";
    expect(detectFileType(header)).toBe("services");
  });

  it("detects time_entry_details CSV by header signature", () => {
    const header =
      '"Date","Client","Project","Service","Note","Team Member","Status","Hours","Seconds"';
    expect(detectFileType(header)).toBe("time_entry_details");
  });

  it("detects invoice_details CSV by header signature", () => {
    const header =
      "Client Name,Invoice #,Date Issued,Date Due,Invoice Status,Date Paid,Item Name";
    expect(detectFileType(header)).toBe("invoice_details");
  });

  it("detects expense_details CSV by header signature", () => {
    const header =
      "Date,Account Sub Type,Parent Category,Subcategory,Source,Merchant,Project";
    expect(detectFileType(header)).toBe("expense_details");
  });

  it("returns unknown for unrecognized headers", () => {
    expect(detectFileType("Foo,Bar,Baz")).toBe("unknown");
  });

  it("sha256 produces stable hex digest", () => {
    const input = "hello world";
    const hash1 = sha256Sync(input);
    const hash2 = sha256Sync(input);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
    expect(hash1).toBe(
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    );
  });

  it("normalizes double spaces in names", () => {
    expect(normalizeName("Sophie  Nyland")).toBe("Sophie Nyland");
    expect(normalizeName("  Dean   Dunagan  ")).toBe("Dean Dunagan");
    expect(normalizeName("Kelly Jo Miller")).toBe("Kelly Jo Miller");
  });

  it("parseCSV handles quoted fields with commas", () => {
    const csv = `Name,City\n"ABS Machining, Inc",Mississauga\nOther,Toronto`;
    const rows = parseCSV(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]["Name"]).toBe("ABS Machining, Inc");
    expect(rows[0]["City"]).toBe("Mississauga");
  });

  it("groups invoice lines by invoice number and computes rowIndex", () => {
    const csv = [
      "Client Name,Invoice #,Date Issued,Date Due,Invoice Status,Date Paid,Item Name,Rate,Quantity,Line Total",
      '"ABS Machining, Inc",196810,2024-02-05,2024-02-19,paid,2024-02-29,Service A,95.00,4.00,380.00',
      '"ABS Machining, Inc",196810,2024-02-05,2024-02-19,paid,2024-02-29,Service B,95.00,3.50,332.50',
      '"ABS Machining, Inc",196933,2026-02-09,2026-02-23,overdue,,Service C,125.00,1.00,125.00',
    ].join("\n");

    const rows = parseCSV(csv);
    const preflight = runPreflightOnFile(rows, "invoice_details", "test.csv", "abc123");
    expect(preflight.uniqueInvoiceNumbers).toEqual(["196810", "196933"]);
    expect(preflight.totalInvoiceLineSum).toBe(837.5);
    expect(preflight.openARSum).toBe(125.0);
    expect(preflight.rowCount).toBe(3);
  });

  it("calculates open A/R correctly (excludes paid invoices)", () => {
    const csv = [
      "Client Name,Invoice #,Date Issued,Date Due,Invoice Status,Date Paid,Item Name,Rate,Quantity,Line Total",
      "Client A,001,2024-01-01,2024-02-01,paid,2024-02-01,Svc,100,1,100.00",
      "Client A,002,2024-01-01,2024-02-01,overdue,,Svc,200,1,200.00",
      "Client A,003,2024-01-01,2024-02-01,sent,,Svc,300,1,300.00",
    ].join("\n");

    const rows = parseCSV(csv);
    const preflight = runPreflightOnFile(rows, "invoice_details", "inv.csv", "xyz");
    expect(preflight.openARSum).toBe(500.0);
    expect(preflight.totalInvoiceLineSum).toBe(600.0);
  });

  it("extracts independent payouts from expense_details (Independents category)", () => {
    const csv = [
      "Date,Account Sub Type,Parent Category,Subcategory,Source,Merchant,Project,Client,Description,Tax 1 Amount,Tax 1 Type,Tax 2 Amount,Tax 2 Type,Amount,Currency",
      "2026-02-17,Operating Expense,Independents,Independents (general),CherrySt,Zelle,,,Zelle payment to Dean,0.00,,0.00,,350.00,USD",
      "2026-02-06,Operating Expense,Travel,Travel (general),Sophie,Sophie Nyland,ERP21 Upgrade,Client,Travel,0.00,,0.00,,742.30,USD",
    ].join("\n");

    const rows = parseCSV(csv);
    const preflight = runPreflightOnFile(rows, "expense_details", "exp.csv", "abc");
    expect(preflight.independentPayoutSum).toBe(350.0);
  });

  it("flags duplicate time rows", () => {
    const csv = [
      '"Date","Client","Project","Service","Note","Team Member","Status","Hours","Seconds"',
      '"2026-02-01","Client A","Project X","Svc","Did stuff","John","billed","2.0000","7200"',
      '"2026-02-01","Client A","Project X","Svc","Did stuff","John","billed","2.0000","7200"',
    ].join("\n");

    const rows = parseCSV(csv);
    const preflight = runPreflightOnFile(rows, "time_entry_details", "time.csv", "abc");
    expect(preflight.duplicateTimeRows).toBe(1);
  });

  it("detects name normalization candidates (double spaces)", () => {
    const csv = [
      '"Date","Client","Project","Service","Note","Team Member","Status","Hours","Seconds"',
      '"2026-02-01","ABS  Machining","Project X","Svc","Note","Sophie  Nyland","billed","1.0000","3600"',
    ].join("\n");

    const rows = parseCSV(csv);
    const preflight = runPreflightOnFile(rows, "time_entry_details", "time.csv", "abc");
    expect(preflight.nameNormalizationCandidates).toContain("ABS  Machining");
    expect(preflight.nameNormalizationCandidates).toContain("Sophie  Nyland");
  });

  it("parses CSV with multiline quoted fields into 1 logical record", () => {
    const csv = [
      "Name,Description,Amount",
      '"ABS Machining","Multi-line\nnote with\nnewlines",100.00',
      "Other,Simple,200.00",
    ].join("\n");

    const rows = parseCSV(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]["Name"]).toBe("ABS Machining");
    expect(rows[0]["Description"]).toBe("Multi-line\nnote with\nnewlines");
    expect(rows[0]["Amount"]).toBe("100.00");
    expect(rows[1]["Name"]).toBe("Other");
  });

  it("physicalLineCount > parsedRecordCount with multiline fields", () => {
    const csv = [
      "Name,Description,Amount",
      '"ABS","Line one\nLine two\nLine three",100.00',
      "Other,Simple,200.00",
    ].join("\n");

    const { integrity } = parseCSVWithIntegrity(csv);
    expect(integrity.physicalLineCount).toBe(5);
    expect(integrity.parsedRecordCount).toBe(2);
    expect(integrity.physicalLineCount).toBeGreaterThan(
      integrity.parsedRecordCount,
    );
  });

  it("unclosed quote CSV throws an error (no silent corruption)", () => {
    const csv = 'Name,Value\n"ABS Machining,100\nOther,200';
    expect(() => parseCSV(csv)).toThrow("unclosed quote");
  });

  it("parseCsvWithMeta handles escaped quotes inside fields", () => {
    const csv = 'Name,Note\n"She said ""hello""",value\nOther,plain';
    const meta = parseCsvWithMeta(csv);
    expect(meta.unclosedQuotes).toBe(0);
    const { rows } = mapRows(meta.headers, meta.rowsRaw);
    expect(rows).toHaveLength(2);
    expect(rows[0]["Name"]).toBe('She said "hello"');
  });

  it("parseCsvWithMeta handles CRLF line endings", () => {
    const csv = "Name,Value\r\nAlpha,100\r\nBeta,200\r\n";
    const meta = parseCsvWithMeta(csv);
    expect(meta.unclosedQuotes).toBe(0);
    expect(meta.recordCount).toBe(2);
    const { rows } = mapRows(meta.headers, meta.rowsRaw);
    expect(rows[0]["Name"]).toBe("Alpha");
    expect(rows[1]["Value"]).toBe("200");
  });

  it("parseCSVWithIntegrity reports ignored rows", () => {
    const csv = "Name,Value\nAlpha,100\n,,\nBeta,200";
    const { rows, integrity } = parseCSVWithIntegrity(csv);
    expect(rows).toHaveLength(2);
    expect(integrity.parsedRecordCount).toBe(3);
    expect(integrity.ignoredRowCount).toBe(1);
    expect(integrity.ignoredRowBreakdown["all_fields_empty"]).toBe(1);
  });
});
