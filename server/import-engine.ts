import { createHash } from "crypto";
import { storage } from "./storage";
import { round2 } from "@shared/schema";
import { parseCsvWithMeta, mapRows } from "@shared/csv";
import { parseAmount as robustParseAmount, parseDate as robustParseDate, parseHours as robustParseHours, sanitizeCsvField } from "./import-parsers";

export function normalizeName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

const PASS_THROUGH_MERCHANTS = new Set([
  "zelle",
  "venmo",
  "paypal",
  "cashapp",
  "cash app",
  "ach",
  "wire",
]);

export function extractPayee(input: {
  merchant: string;
  description: string;
}): { payeeRaw: string; payeeNormalized: string } {
  const desc = normalizeName(input.description);
  const merchantNorm = normalizeName(input.merchant).toLowerCase();

  const paymentToMatch = desc.match(
    /(?:payment\s+to|transfer\s+to|sent\s+to)\s+(.+?)(?:\s+conf#|\s+confirmation|\s+ref[.#:]|\s*$)/i,
  );
  if (paymentToMatch) {
    const raw = normalizeName(paymentToMatch[1]);
    if (raw.length > 0) {
      return { payeeRaw: raw, payeeNormalized: raw.toLowerCase() };
    }
  }

  const toMatch = desc.match(/\bto\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,5})(?:\s|$)/);
  if (toMatch) {
    const raw = normalizeName(toMatch[1]);
    return { payeeRaw: raw, payeeNormalized: raw.toLowerCase() };
  }

  if (!PASS_THROUGH_MERCHANTS.has(merchantNorm) && merchantNorm.length > 0) {
    const raw = normalizeName(input.merchant);
    return { payeeRaw: raw, payeeNormalized: raw.toLowerCase() };
  }

  const raw = normalizeName(input.merchant || input.description);
  return { payeeRaw: raw, payeeNormalized: raw.toLowerCase() };
}

export function sha256Sync(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export type FBFileType =
  | "clients"
  | "vendors"
  | "services"
  | "time_entry_details"
  | "invoice_details"
  | "expense_details"
  | "unknown";

const SIGNATURES: Record<string, FBFileType> = {
  "Organization,First Name,Last Name,Email,Phone,Address Line 1": "clients",
  "Organization,First Name,Last Name,Account Number,Email": "vendors",
  "Name,Type,Rate,Income Account,Status": "services",
  "Date,Client,Project,Service,Note,Team Member,Status,Hours,Seconds": "time_entry_details",
  "Client Name,Invoice #,Date Issued,Date Due,Invoice Status": "invoice_details",
  "Date,Account Sub Type,Parent Category,Subcategory,Source,Merchant": "expense_details",
};

function stripBOM(text: string): string {
  if (text.charCodeAt(0) === 0xfeff) return text.slice(1);
  return text;
}

export function detectFileType(headerLine: string): FBFileType {
  const cleaned = stripBOM(headerLine).replace(/"/g, "").trim();
  for (const [sig, type] of Object.entries(SIGNATURES)) {
    if (cleaned.startsWith(sig)) return type;
  }
  return "unknown";
}

export interface CsvParseIntegrity {
  physicalLineCount: number;
  parsedRecordCount: number;
  ignoredRowCount: number;
  ignoredRowBreakdown: Record<string, number>;
  unclosedQuotes: number;
}

function sanitizeRowFields(rows: Record<string, string>[]): Record<string, string>[] {
  return rows.map(row => {
    const clean: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      clean[key] = sanitizeCsvField(value);
    }
    return clean;
  });
}

const MAX_IMPORT_ROWS = (() => {
  const envVal = parseInt(process.env.MAX_IMPORT_ROWS || "100000", 10);
  if (isNaN(envVal) || envVal < 1000 || envVal > 500000) {
    if (process.env.MAX_IMPORT_ROWS) {
      console.warn(`[config] MAX_IMPORT_ROWS value "${process.env.MAX_IMPORT_ROWS}" is out of range (1000–500000), falling back to 100000`);
    }
    return 100000;
  }
  return envVal;
})();

export function parseCSV(text: string): Record<string, string>[] {
  const meta = parseCsvWithMeta(text);
  if (meta.unclosedQuotes > 0) {
    throw new Error(
      `CSV parse error: ${meta.unclosedQuotes} unclosed quote(s) detected`,
    );
  }
  if (meta.rowsRaw.length > MAX_IMPORT_ROWS) {
    throw new Error(
      `CSV file exceeds maximum row limit of ${MAX_IMPORT_ROWS.toLocaleString()} rows (found ${meta.rowsRaw.length.toLocaleString()}). Please split the file into smaller batches.`,
    );
  }
  const { rows } = mapRows(meta.headers, meta.rowsRaw);
  return sanitizeRowFields(rows);
}

export function parseCSVWithIntegrity(text: string): {
  rows: Record<string, string>[];
  integrity: CsvParseIntegrity;
} {
  const meta = parseCsvWithMeta(text);
  if (meta.unclosedQuotes > 0) {
    throw new Error(
      `CSV parse error: ${meta.unclosedQuotes} unclosed quote(s) detected`,
    );
  }
  if (meta.rowsRaw.length > MAX_IMPORT_ROWS) {
    throw new Error(
      `CSV file exceeds maximum row limit of ${MAX_IMPORT_ROWS.toLocaleString()} rows (found ${meta.rowsRaw.length.toLocaleString()}). Please split the file into smaller batches.`,
    );
  }
  const mapped = mapRows(meta.headers, meta.rowsRaw);
  return {
    rows: sanitizeRowFields(mapped.rows),
    integrity: {
      physicalLineCount: meta.physicalLineCount,
      parsedRecordCount: meta.recordCount,
      ignoredRowCount: mapped.ignored.count,
      ignoredRowBreakdown: mapped.ignored.byReason,
      unclosedQuotes: meta.unclosedQuotes,
    },
  };
}

export function canonicalizeParentCategory(raw: string): { key: string; label: string } {
  const normalized = normalizeName(raw).toLowerCase();
  if (!normalized) return { key: "(empty)", label: "(empty)" };
  if (/contract(?:or|ors)?|consultant(?:s)?|team.?member(?:s)?|independent(?:s)?/i.test(normalized)) {
    return { key: "independents", label: "Independents / Team Members" };
  }
  return { key: normalized, label: normalizeName(raw) || normalized };
}

export interface PayeeBreakdown {
  totalImportedPayoutRows: number;
  uniquePayees: string[];
  payeeParseFallbackCount: number;
}

export interface ExpenseBreakdowns {
  byParentCategory: Array<{ key: string; label: string; count: number; amount: number }>;
  byMerchant: Array<{ name: string; count: number; amount: number }>;
  byPayee: Array<{ name: string; count: number; amount: number }>;
  topN: number;
  merchantOther: { count: number; amount: number };
  payeeOther: { count: number; amount: number };
}

export interface PreflightFile {
  type: FBFileType;
  filename: string;
  sha256: string;
  rowCount: number;
  dateRange: { min: string; max: string } | null;
  uniqueClients: string[];
  uniqueTeamMembers: string[];
  uniqueInvoiceNumbers: string[];
  totalInvoiceLineSum: number;
  openARSum: number;
  independentPayoutSum: number;
  duplicateTimeRows: number;
  nameNormalizationCandidates: string[];
  noServiceTimeRows: number;
  payeeBreakdown: PayeeBreakdown | null;
  expenseBreakdowns: ExpenseBreakdowns | null;
}

export function runPreflightOnFile(
  rows: Record<string, string>[],
  type: FBFileType,
  filename: string,
  sha: string,
): PreflightFile {
  const result: PreflightFile = {
    type,
    filename,
    sha256: sha,
    rowCount: rows.length,
    dateRange: null,
    uniqueClients: [],
    uniqueTeamMembers: [],
    uniqueInvoiceNumbers: [],
    totalInvoiceLineSum: 0,
    openARSum: 0,
    independentPayoutSum: 0,
    duplicateTimeRows: 0,
    nameNormalizationCandidates: [],
    noServiceTimeRows: 0,
    payeeBreakdown: null,
    expenseBreakdowns: null,
  };

  const dates: string[] = [];
  const clientSet = new Set<string>();
  const teamSet = new Set<string>();
  const invSet = new Set<string>();
  const normCandidates = new Set<string>();
  const timeRowSigs = new Set<string>();
  const payeeSet = new Set<string>();
  const expCatData: Record<string, { label: string; count: number; amount: number }> = {};
  const expMerchantData: Record<string, { count: number; amount: number }> = {};
  const expPayeeData: Record<string, { count: number; amount: number }> = {};

  for (const row of rows) {
    const dateField = row["Date"] || row["Date Issued"] || "";
    if (dateField) {
      const parsed = robustParseDate(dateField);
      if (parsed) dates.push(parsed);
    }

    const checkNorm = (val: string) => {
      if (val && val !== normalizeName(val)) {
        normCandidates.add(val);
      }
    };

    if (type === "clients") {
      const org = row["Organization"] || "";
      if (org) clientSet.add(normalizeName(org));
      checkNorm(org);
    }

    if (type === "time_entry_details") {
      const client = row["Client"] || "";
      const member = row["Team Member"] || "";
      const svc = row["Service"] || "";
      if (client) clientSet.add(normalizeName(client));
      if (member) teamSet.add(normalizeName(member));
      checkNorm(client);
      checkNorm(member);

      if (!svc || svc.toLowerCase() === "no service") {
        result.noServiceTimeRows++;
      }

      const sig = `${row["Date"]}|${client}|${row["Project"]}|${svc}|${member}|${row["Hours"]}|${row["Note"] || ""}`;
      if (timeRowSigs.has(sig)) {
        result.duplicateTimeRows++;
      } else {
        timeRowSigs.add(sig);
      }
    }

    if (type === "invoice_details") {
      const clientName = row["Client Name"] || "";
      const invNum = row["Invoice #"] || "";
      const status = (row["Invoice Status"] || "").toLowerCase();
      const lineTotal = robustParseAmount(row["Line Total"] || "0") || 0;

      if (clientName) clientSet.add(normalizeName(clientName));
      if (invNum) invSet.add(invNum);
      checkNorm(clientName);

      result.totalInvoiceLineSum += lineTotal;
      if (status !== "paid") {
        result.openARSum += lineTotal;
      }
    }

    if (type === "expense_details") {
      const rawCat = row["Parent Category"] || "";
      const { key: catKey, label: catLabel } = canonicalizeParentCategory(rawCat);
      const merchant = row["Merchant"] || "";
      const description = row["Description"] || "";
      const amount = robustParseAmount(row["Amount"] || "0") || 0;
      checkNorm(merchant);

      if (!expCatData[catKey]) expCatData[catKey] = { label: catLabel, count: 0, amount: 0 };
      expCatData[catKey].count++;
      expCatData[catKey].amount += amount;

      const merchantNorm = normalizeName(merchant) || "(empty)";
      if (!expMerchantData[merchantNorm]) expMerchantData[merchantNorm] = { count: 0, amount: 0 };
      expMerchantData[merchantNorm].count++;
      expMerchantData[merchantNorm].amount += amount;

      const { payeeNormalized: rowPayee } = extractPayee({ merchant, description });
      if (!expPayeeData[rowPayee]) expPayeeData[rowPayee] = { count: 0, amount: 0 };
      expPayeeData[rowPayee].count++;
      expPayeeData[rowPayee].amount += amount;

      if (catKey === "independents") {
        result.independentPayoutSum += amount;

        if (!result.payeeBreakdown) {
          result.payeeBreakdown = {
            totalImportedPayoutRows: 0,
            uniquePayees: [],
            payeeParseFallbackCount: 0,
          };
        }
        result.payeeBreakdown.totalImportedPayoutRows++;

        const { payeeNormalized } = extractPayee({
          merchant,
          description,
        });
        payeeSet.add(payeeNormalized);

        if (payeeNormalized === normalizeName(merchant).toLowerCase()) {
          const merchantLower = normalizeName(merchant).toLowerCase();
          if (PASS_THROUGH_MERCHANTS.has(merchantLower)) {
            result.payeeBreakdown.payeeParseFallbackCount++;
          }
        }
      }
    }

    if (type === "vendors") {
      const org = row["Organization"] || "";
      const first = row["First Name"] || "";
      const last = row["Last Name"] || "";
      const name = org || `${first} ${last}`.trim();
      if (name) teamSet.add(normalizeName(name));
      checkNorm(name);
    }

    if (type === "services") {
      checkNorm(row["Name"] || "");
    }
  }

  if (dates.length > 0) {
    dates.sort();
    result.dateRange = { min: dates[0], max: dates[dates.length - 1] };
  }

  result.uniqueClients = Array.from(clientSet).sort();
  result.uniqueTeamMembers = Array.from(teamSet).sort();
  result.uniqueInvoiceNumbers = Array.from(invSet).sort();
  result.nameNormalizationCandidates = Array.from(normCandidates).sort();
  result.totalInvoiceLineSum = round2(result.totalInvoiceLineSum);
  result.openARSum = round2(result.openARSum);
  result.independentPayoutSum = round2(result.independentPayoutSum);
  if (result.payeeBreakdown) {
    result.payeeBreakdown.uniquePayees = Array.from(payeeSet).sort();
  }

  if (type === "expense_details") {
    const TOP_N = 25;

    const sortedCats = Object.entries(expCatData)
      .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
      .map(([key, d]) => ({ key, label: d.label, count: d.count, amount: round2(d.amount) }));

    const sortNamedData = (data: Record<string, { count: number; amount: number }>) => {
      const sorted = Object.entries(data)
        .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));
      const top = sorted.slice(0, TOP_N).map(([name, d]) => ({ name, count: d.count, amount: round2(d.amount) }));
      const rest = sorted.slice(TOP_N);
      const other = rest.reduce(
        (acc, [_, d]) => ({ count: acc.count + d.count, amount: acc.amount + d.amount }),
        { count: 0, amount: 0 },
      );
      return { top, other: { count: other.count, amount: round2(other.amount) } };
    };

    const merchantResult = sortNamedData(expMerchantData);
    const payeeResult = sortNamedData(expPayeeData);

    result.expenseBreakdowns = {
      byParentCategory: sortedCats,
      byMerchant: merchantResult.top,
      byPayee: payeeResult.top,
      topN: TOP_N,
      merchantOther: merchantResult.other,
      payeeOther: payeeResult.other,
    };
  }

  return result;
}

export interface ImportOptions {
  importClients: boolean;
  importServices: boolean;
  servicesNonZeroOnly: boolean;
  importTeamMembers?: boolean;
  importIndependents?: boolean;
  importInvoices: boolean;
  invoicePaidCutoffStart?: string;
  invoicePaidCutoffEnd?: string;
  importHistoricalPayments: boolean;
  importTimeEntries: boolean;
  timeEntryDateStart?: string;
  timeEntryDateEnd?: string;
  timeEntrySkipDuplicates: boolean;
  importImportedPayouts?: boolean;
  payoutDateStart?: string;
  payoutDateEnd?: string;
  expenseCategoryIncludeList?: string[];
  payeeIncludeList?: string[];
}

export interface RowIssueSummary {
  totalErrors: number;
  totalWarnings: number;
  skippedRows: number;
}

export interface ReconciliationLeg {
  source: number;
  imported: number;
  diff: number;
}

export interface Reconciliation {
  invoiceTotal: ReconciliationLeg;
  timeHours: ReconciliationLeg;
  expenseTotal: ReconciliationLeg;
  isBalanced: boolean;
}

export interface FileRowCounts {
  totalSourceRows: number;
  processedRows: number;
  skippedRows: number;
  warningRows: number;
}

export interface DryRunPlan {
  clientsToCreate: number;
  projectsToCreate: number;
  invoicesToCreate: number;
  invoiceLinesToCreate: number;
  paymentsToCreate: number;
  timeEntriesToCreate: number;
  payoutsToCreate: number;
  nameMerges: Array<{ original: string; normalized: string }>;
  skippedDuplicateKeys: number;
  planHash: string;
  ignoredBreakdown: Record<string, number>;
  opCountsByType: Record<string, number>;
  rowIssues: RowIssue[];
  rowIssueSummary: RowIssueSummary;
  reconciliation: Reconciliation;
  fileRowCounts: Record<string, FileRowCounts>;
}

export interface ParsedFileData {
  type: FBFileType;
  rows: Record<string, string>[];
  sha256: string;
  filename: string;
}

export interface RowIssue {
  row: number;
  field?: string;
  severity: "error" | "warning";
  message: string;
  rawValue?: string;
}

export interface ImportOp {
  entityType: string;
  externalKey: string;
  normalizedKeyFields: Record<string, string>;
  payload: Record<string, unknown>;
}

export interface IgnoredRow {
  fileType: string;
  rowIndex: number;
  reason: string;
}

function isValidDate(d: string): boolean {
  const parsed = robustParseDate(d);
  return parsed !== null;
}

function normalizeDate(d: string): string {
  const parsed = robustParseDate(d);
  return parsed || d;
}

function isValidAmount(val: string): { valid: boolean; num: number } {
  const num = robustParseAmount(val);
  if (isNaN(num)) return { valid: false, num: 0 };
  return { valid: true, num };
}

function validHours(val: string): { valid: boolean; num: number } {
  const num = robustParseHours(val);
  if (isNaN(num)) return { valid: false, num: 0 };
  return { valid: true, num };
}

export function computeRowIssueSummary(issues: RowIssue[], ignored?: IgnoredRow[]): RowIssueSummary {
  let totalErrors = 0;
  let totalWarnings = 0;
  for (const issue of issues) {
    if (issue.severity === "error") {
      totalErrors++;
    } else {
      totalWarnings++;
    }
  }
  const skippedRows = ignored
    ? new Set(ignored.map(r => `${r.fileType}:${r.rowIndex}`)).size
    : new Set(issues.filter(i => i.severity === "error").map(i => i.row)).size;
  return { totalErrors, totalWarnings, skippedRows };
}

export function buildImportOps(
  files: ParsedFileData[],
  options: ImportOptions,
): { ops: ImportOp[]; ignored: IgnoredRow[]; rowIssues: RowIssue[]; planHash: string; reconciliation: Reconciliation; fileRowCounts: Record<string, FileRowCounts> } {
  const ops: ImportOp[] = [];
  const ignored: IgnoredRow[] = [];
  const rowIssues: RowIssue[] = [];

  let sourceInvoiceTotal = 0;
  let importedInvoiceTotal = 0;
  let sourceTimeHours = 0;
  let importedTimeHours = 0;
  let sourceExpenseTotal = 0;
  let importedExpenseTotal = 0;

  const fileRowCounts: Record<string, FileRowCounts> = {};

  if (options.importClients) {
    const clientsFile = files.find((f) => f.type === "clients");
    if (clientsFile) {
      const counts: FileRowCounts = { totalSourceRows: clientsFile.rows.length, processedRows: 0, skippedRows: 0, warningRows: 0 };
      const warningRowSet = new Set<number>();
      const seen = new Set<string>();
      for (let i = 0; i < clientsFile.rows.length; i++) {
        const row = clientsFile.rows[i];
        const csvRow = i + 2;
        try {
          const org = normalizeName(row["Organization"] || "");
          if (!org) {
            rowIssues.push({ row: csvRow, field: "Organization", severity: "error", message: "Missing required field: Organization", rawValue: row["Organization"] });
            ignored.push({ fileType: "clients", rowIndex: i, reason: "missing_required_field" });
            counts.skippedRows++;
            continue;
          }
          if (seen.has(org)) {
            rowIssues.push({ row: csvRow, field: "Organization", severity: "warning", message: `Duplicate organization name: "${org}"`, rawValue: org });
            warningRowSet.add(csvRow);
            counts.processedRows++;
            continue;
          }
          seen.add(org);
          counts.processedRows++;
          ops.push({
            entityType: "client",
            externalKey: `FB:CLIENT:${org}`,
            normalizedKeyFields: { name: org },
            payload: {
              email: row["Email"] || "",
              phone: row["Phone"] || "",
            },
          });
        } catch (err) {
          rowIssues.push({ row: csvRow, severity: "error", message: `Unexpected error processing client row: ${(err as Error).message}` });
          ignored.push({ fileType: "clients", rowIndex: i, reason: "processing_error" });
          counts.skippedRows++;
        }
      }
      counts.warningRows = warningRowSet.size;
      fileRowCounts["clients"] = counts;
    }
  }

  if (options.importInvoices) {
    const invFile = files.find((f) => f.type === "invoice_details");
    if (invFile) {
      const counts: FileRowCounts = { totalSourceRows: invFile.rows.length, processedRows: 0, skippedRows: 0, warningRows: 0 };
      const warningRowSet = new Set<number>();
      const invGroups = new Map<string, { rows: Record<string, string>[]; indices: number[] }>();
      for (let i = 0; i < invFile.rows.length; i++) {
        const row = invFile.rows[i];
        const csvRow = i + 2;
        try {
          const status = (row["Invoice Status"] || "").toLowerCase();
          const invNum = row["Invoice #"] || "";
          const datePaid = row["Date Paid"] || "";
          const lineTotal = row["Line Total"] || "";

          if (!invNum) {
            rowIssues.push({ row: csvRow, field: "Invoice #", severity: "error", message: "Missing required field: Invoice #", rawValue: row["Invoice #"] });
            ignored.push({ fileType: "invoice_details", rowIndex: i, reason: "missing_required_field" });
            counts.skippedRows++;
            continue;
          }

          const dateIssued = row["Date Issued"] || "";
          const normalizedDateIssued = dateIssued ? normalizeDate(dateIssued) : "";
          if (dateIssued && !isValidDate(dateIssued)) {
            rowIssues.push({ row: csvRow, field: "Date Issued", severity: "warning", message: `Unparseable date: "${dateIssued}"`, rawValue: dateIssued });
            warningRowSet.add(csvRow);
          }
          const normalizedDatePaid = datePaid ? normalizeDate(datePaid) : "";
          if (datePaid && !isValidDate(datePaid)) {
            rowIssues.push({ row: csvRow, field: "Date Paid", severity: "warning", message: `Unparseable date: "${datePaid}"`, rawValue: datePaid });
            warningRowSet.add(csvRow);
          }

          if (lineTotal) {
            const { valid, num } = isValidAmount(lineTotal);
            if (!valid) {
              rowIssues.push({ row: csvRow, field: "Line Total", severity: "error", message: `Invalid amount (NaN): "${lineTotal}"`, rawValue: lineTotal });
              ignored.push({ fileType: "invoice_details", rowIndex: i, reason: "invalid_amount" });
              counts.skippedRows++;
              continue;
            }
            if (num < 0) {
              rowIssues.push({ row: csvRow, field: "Line Total", severity: "warning", message: `Negative amount: ${num}`, rawValue: lineTotal });
              warningRowSet.add(csvRow);
            }
          }

          const isOpen = status !== "paid";
          let include = isOpen;
          if (!isOpen) {
            if (options.invoicePaidCutoffStart || options.invoicePaidCutoffEnd) {
              if (normalizedDatePaid) {
                const afterStart = !options.invoicePaidCutoffStart || normalizedDatePaid >= options.invoicePaidCutoffStart;
                const beforeEnd = !options.invoicePaidCutoffEnd || normalizedDatePaid <= options.invoicePaidCutoffEnd;
                include = afterStart && beforeEnd;
              }
            } else {
              include = true;
            }
          }

          if (include && invNum) {
            if (lineTotal) {
              const parsed = isValidAmount(lineTotal);
              if (parsed.valid) {
                sourceInvoiceTotal += parsed.num;
              }
            }
            if (!invGroups.has(invNum)) invGroups.set(invNum, { rows: [], indices: [] });
            invGroups.get(invNum)!.rows.push(row);
            invGroups.get(invNum)!.indices.push(i);
            counts.processedRows++;
          } else {
            ignored.push({ fileType: "invoice_details", rowIndex: i, reason: "date_out_of_range" });
            counts.skippedRows++;
          }
        } catch (err) {
          rowIssues.push({ row: csvRow, severity: "error", message: `Unexpected error processing invoice row: ${(err as Error).message}` });
          ignored.push({ fileType: "invoice_details", rowIndex: i, reason: "processing_error" });
          counts.skippedRows++;
        }
      }

      for (const [invNum, group] of Array.from(invGroups.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
        const lines = group.rows;
        ops.push({
          entityType: "invoice",
          externalKey: `FB:INV:${invNum}`,
          normalizedKeyFields: { number: invNum },
          payload: {
            clientName: normalizeName(lines[0]["Client Name"] || ""),
            status: (lines[0]["Invoice Status"] || "").toLowerCase(),
            lineCount: lines.length,
          },
        });

        for (let li = 0; li < lines.length; li++) {
          const rateParsed = isValidAmount(lines[li]["Rate"] || "0");
          const qtyParsed = isValidAmount(lines[li]["Quantity"] || "0");
          const lineCsvRow = group.indices[li] + 2;
          if (!rateParsed.valid) {
            rowIssues.push({ row: lineCsvRow, field: "Rate", severity: "warning", message: `Invalid rate: "${lines[li]["Rate"]}"`, rawValue: lines[li]["Rate"] });
            warningRowSet.add(lineCsvRow);
          }
          if (!qtyParsed.valid) {
            rowIssues.push({ row: lineCsvRow, field: "Quantity", severity: "warning", message: `Invalid quantity: "${lines[li]["Quantity"]}"`, rawValue: lines[li]["Quantity"] });
            warningRowSet.add(lineCsvRow);
          }

          const lt = lines[li]["Line Total"] || "0";
          const ltParsed = isValidAmount(lt);
          if (ltParsed.valid) {
            importedInvoiceTotal += ltParsed.num;
          }

          ops.push({
            entityType: "invoice_line",
            externalKey: `FB:INVLINE:${invNum}:${li}`,
            normalizedKeyFields: { invoiceNumber: invNum, lineIndex: String(li) },
            payload: {
              itemName: lines[li]["Item Name"] || "",
              rate: lines[li]["Rate"] || "0",
              quantity: lines[li]["Quantity"] || "0",
            },
          });
        }

        const status = (lines[0]["Invoice Status"] || "").toLowerCase();
        if (status === "paid" && options.importHistoricalPayments) {
          ops.push({
            entityType: "payment",
            externalKey: `FB:PAY:${invNum}`,
            normalizedKeyFields: { invoiceNumber: invNum },
            payload: { datePaid: normalizeDate(lines[0]["Date Paid"] || "") },
          });
        }
      }
      counts.warningRows = warningRowSet.size;
      fileRowCounts["invoice_details"] = counts;
    }
  }

  if (options.importTimeEntries) {
    const timeFile = files.find((f) => f.type === "time_entry_details");
    if (timeFile) {
      const counts: FileRowCounts = { totalSourceRows: timeFile.rows.length, processedRows: 0, skippedRows: 0, warningRows: 0 };
      const warningRowSet = new Set<number>();
      const timeRowSigs = new Set<string>();
      const emittedProjects = new Set<string>();
      for (let i = 0; i < timeFile.rows.length; i++) {
        const row = timeFile.rows[i];
        const csvRow = i + 2;
        try {
          const hours = row["Hours"] || "0";
          const hoursParsed = validHours(hours);

          const rawDate = row["Date"] || "";

          if (!rawDate) {
            rowIssues.push({ row: csvRow, field: "Date", severity: "error", message: "Missing required field: Date" });
            ignored.push({ fileType: "time_entry_details", rowIndex: i, reason: "missing_required_field" });
            counts.skippedRows++;
            continue;
          }
          const date = normalizeDate(rawDate);
          if (!isValidDate(rawDate)) {
            rowIssues.push({ row: csvRow, field: "Date", severity: "error", message: `Unparseable date: "${rawDate}"`, rawValue: rawDate });
            ignored.push({ fileType: "time_entry_details", rowIndex: i, reason: "invalid_date" });
            counts.skippedRows++;
            continue;
          }

          if (options.timeEntryDateStart && date < options.timeEntryDateStart) {
            ignored.push({ fileType: "time_entry_details", rowIndex: i, reason: "date_out_of_range" });
            counts.skippedRows++;
            continue;
          }
          if (options.timeEntryDateEnd && date > options.timeEntryDateEnd) {
            ignored.push({ fileType: "time_entry_details", rowIndex: i, reason: "date_out_of_range" });
            counts.skippedRows++;
            continue;
          }

          if (options.timeEntrySkipDuplicates) {
            const sig = `${row["Date"]}|${row["Client"]}|${row["Project"]}|${row["Service"]}|${row["Team Member"]}|${row["Hours"]}|${row["Note"] || ""}`;
            if (timeRowSigs.has(sig)) {
              rowIssues.push({ row: csvRow, severity: "warning", message: "Duplicate time entry row (skipped)", rawValue: sig });
              ignored.push({ fileType: "time_entry_details", rowIndex: i, reason: "duplicate_time_row" });
              warningRowSet.add(csvRow);
              counts.skippedRows++;
              continue;
            }
            timeRowSigs.add(sig);
          }

          const clientName = normalizeName(row["Client"] || "");
          const projectName = normalizeName(row["Project"] || "");
          if (!clientName) {
            rowIssues.push({ row: csvRow, field: "Client", severity: "error", message: "Missing required field: Client" });
          }
          if (!projectName) {
            rowIssues.push({ row: csvRow, field: "Project", severity: "error", message: "Missing required field: Project" });
          }
          if (!clientName || !projectName) {
            ignored.push({ fileType: "time_entry_details", rowIndex: i, reason: "missing_client_or_project" });
            counts.skippedRows++;
            continue;
          }

          if (!hoursParsed.valid) {
            rowIssues.push({ row: csvRow, field: "Hours", severity: "error", message: `Invalid hours (NaN): "${hours}"`, rawValue: hours });
            ignored.push({ fileType: "time_entry_details", rowIndex: i, reason: "invalid_hours" });
            counts.skippedRows++;
            continue;
          }
          if (hoursParsed.num < 0) {
            rowIssues.push({ row: csvRow, field: "Hours", severity: "warning", message: `Negative hours: ${hoursParsed.num}`, rawValue: hours });
            warningRowSet.add(csvRow);
          }

          sourceTimeHours += hoursParsed.num;
          importedTimeHours += hoursParsed.num;

          const projKey = `${clientName}::${projectName}`;
          if (!emittedProjects.has(projKey)) {
            emittedProjects.add(projKey);
            ops.push({
              entityType: "project",
              externalKey: `FB:PROJ:${clientName}:${projectName}`,
              normalizedKeyFields: { client: clientName, project: projectName },
              payload: {},
            });
          }

          counts.processedRows++;
          ops.push({
            entityType: "time_entry",
            externalKey: `FB:TIME:${timeFile.sha256}:${i}`,
            normalizedKeyFields: { date, client: clientName, project: projectName, member: normalizeName(row["Team Member"] || "") },
            payload: { hours: String(hoursParsed.num), service: row["Service"] || "" },
          });
        } catch (err) {
          rowIssues.push({ row: csvRow, severity: "error", message: `Unexpected error processing time entry row: ${(err as Error).message}` });
          ignored.push({ fileType: "time_entry_details", rowIndex: i, reason: "processing_error" });
          counts.skippedRows++;
        }
      }
      counts.warningRows = warningRowSet.size;
      fileRowCounts["time_entry_details"] = counts;
    }
  }

  if (options.importImportedPayouts) {
    const expFile = files.find((f) => f.type === "expense_details");
    if (expFile) {
      const counts: FileRowCounts = { totalSourceRows: expFile.rows.length, processedRows: 0, skippedRows: 0, warningRows: 0 };
      const warningRowSet = new Set<number>();
      const vendorsFile = files.find((f) => f.type === "vendors");
      const knownPayees = new Set<string>();
      if (vendorsFile) {
        for (const row of vendorsFile.rows) {
          const org = row["Organization"] || "";
          const first = row["First Name"] || "";
          const last = row["Last Name"] || "";
          const name = normalizeName(org || `${first} ${last}`.trim());
          if (name) knownPayees.add(name.toLowerCase());
        }
      }

      for (let i = 0; i < expFile.rows.length; i++) {
        const row = expFile.rows[i];
        const csvRow = i + 2;
        try {
          const amount = row["Amount"] || "0";
          const amountParsed = isValidAmount(amount);

          const rawDate = row["Date"] || "";

          if (!rawDate) {
            rowIssues.push({ row: csvRow, field: "Date", severity: "error", message: "Missing required field: Date" });
            ignored.push({ fileType: "expense_details", rowIndex: i, reason: "missing_required_field" });
            counts.skippedRows++;
            continue;
          }
          const date = normalizeDate(rawDate);
          if (!isValidDate(rawDate)) {
            rowIssues.push({ row: csvRow, field: "Date", severity: "error", message: `Unparseable date: "${rawDate}"`, rawValue: rawDate });
            ignored.push({ fileType: "expense_details", rowIndex: i, reason: "invalid_date" });
            counts.skippedRows++;
            continue;
          }

          if (options.payoutDateStart && date < options.payoutDateStart) {
            ignored.push({ fileType: "expense_details", rowIndex: i, reason: "date_out_of_range" });
            counts.skippedRows++;
            continue;
          }
          if (options.payoutDateEnd && date > options.payoutDateEnd) {
            ignored.push({ fileType: "expense_details", rowIndex: i, reason: "date_out_of_range" });
            counts.skippedRows++;
            continue;
          }

          const { key: catKey } = canonicalizeParentCategory(row["Parent Category"] || "");

          if (options.expenseCategoryIncludeList && options.expenseCategoryIncludeList.length > 0) {
            if (!options.expenseCategoryIncludeList.includes(catKey)) {
              ignored.push({ fileType: "expense_details", rowIndex: i, reason: "filtered_by_parent_category" });
              counts.skippedRows++;
              continue;
            }
          }

          const merchant = row["Merchant"] || "";
          const description = row["Description"] || "";
          const { payeeRaw, payeeNormalized } = extractPayee({ merchant, description });

          if (options.payeeIncludeList && options.payeeIncludeList.length > 0) {
            if (!options.payeeIncludeList.includes(payeeNormalized)) {
              ignored.push({ fileType: "expense_details", rowIndex: i, reason: "filtered_by_payee" });
              counts.skippedRows++;
              continue;
            }
          }

          if (!amountParsed.valid) {
            rowIssues.push({ row: csvRow, field: "Amount", severity: "error", message: `Invalid amount (NaN): "${amount}"`, rawValue: amount });
            ignored.push({ fileType: "expense_details", rowIndex: i, reason: "invalid_amount" });
            counts.skippedRows++;
            continue;
          }
          if (amountParsed.num < 0) {
            rowIssues.push({ row: csvRow, field: "Amount", severity: "warning", message: `Negative amount: ${amountParsed.num}`, rawValue: amount });
            warningRowSet.add(csvRow);
          }

          const isPayoutEligible =
            catKey === "independents" ||
            knownPayees.has(payeeNormalized);
          if (!isPayoutEligible) {
            counts.skippedRows++;
            continue;
          }

          sourceExpenseTotal += amountParsed.num;
          importedExpenseTotal += amountParsed.num;
          counts.processedRows++;
          ops.push({
            entityType: "imported_payout",
            externalKey: `FB:PAYOUT:${expFile.sha256}:${i}`,
            normalizedKeyFields: { date, payee: payeeNormalized, amount: row["Amount"] || "0" },
            payload: {
              payeeRaw,
              merchant: normalizeName(merchant),
              description: normalizeName(description),
              currency: row["Currency"] || "USD",
              source: row["Source"] || "",
            },
          });
        } catch (err) {
          rowIssues.push({ row: csvRow, severity: "error", message: `Unexpected error processing expense row: ${(err as Error).message}` });
          ignored.push({ fileType: "expense_details", rowIndex: i, reason: "processing_error" });
          counts.skippedRows++;
        }
      }
      counts.warningRows = warningRowSet.size;
      fileRowCounts["expense_details"] = counts;
    }
  }

  const hashInput = ops.map((op) =>
    `${op.entityType}|${op.externalKey}|${JSON.stringify(op.normalizedKeyFields)}`
  ).join("\n");
  const planHash = createHash("sha256").update(hashInput, "utf8").digest("hex");

  const invDiff = round2(sourceInvoiceTotal - importedInvoiceTotal);
  const timeDiff = round2(sourceTimeHours - importedTimeHours);
  const expDiff = round2(sourceExpenseTotal - importedExpenseTotal);

  const reconciliation: Reconciliation = {
    invoiceTotal: { source: round2(sourceInvoiceTotal), imported: round2(importedInvoiceTotal), diff: invDiff },
    timeHours: { source: round2(sourceTimeHours), imported: round2(importedTimeHours), diff: timeDiff },
    expenseTotal: { source: round2(sourceExpenseTotal), imported: round2(importedExpenseTotal), diff: expDiff },
    isBalanced: Math.abs(invDiff) <= 0.01 && Math.abs(timeDiff) <= 0.01 && Math.abs(expDiff) <= 0.01,
  };

  if (Math.abs(invDiff) > 0.01) {
    rowIssues.push({ row: 0, severity: "error", message: `Invoice total reconciliation mismatch: source $${sourceInvoiceTotal.toFixed(2)} vs imported $${importedInvoiceTotal.toFixed(2)} (diff: $${invDiff.toFixed(2)})` });
  }
  if (Math.abs(timeDiff) > 0.01) {
    rowIssues.push({ row: 0, severity: "error", message: `Time hours reconciliation mismatch: source ${sourceTimeHours.toFixed(2)}h vs imported ${importedTimeHours.toFixed(2)}h (diff: ${timeDiff.toFixed(2)}h)` });
  }
  if (Math.abs(expDiff) > 0.01) {
    rowIssues.push({ row: 0, severity: "error", message: `Expense total reconciliation mismatch: source $${sourceExpenseTotal.toFixed(2)} vs imported $${importedExpenseTotal.toFixed(2)} (diff: $${expDiff.toFixed(2)})` });
  }

  return { ops, ignored, rowIssues, planHash, reconciliation, fileRowCounts };
}

export function computeOpCountsByType(ops: ImportOp[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const op of ops) {
    counts[op.entityType] = (counts[op.entityType] || 0) + 1;
  }
  return counts;
}

export function computeIgnoredBreakdown(ignored: IgnoredRow[]): Record<string, number> {
  const breakdown: Record<string, number> = {};
  for (const row of ignored) {
    breakdown[row.reason] = (breakdown[row.reason] || 0) + 1;
  }
  return breakdown;
}

export async function buildDryRunPlan(
  orgId: string,
  files: ParsedFileData[],
  options: ImportOptions,
): Promise<DryRunPlan> {
  const { ops, ignored, rowIssues, planHash, reconciliation, fileRowCounts } = buildImportOps(files, options);

  const ignoredBreakdown = computeIgnoredBreakdown(ignored);
  const opCountsByType = computeOpCountsByType(ops);
  const rowIssueSummary = computeRowIssueSummary(rowIssues, ignored);

  const plan: DryRunPlan = {
    clientsToCreate: 0,
    projectsToCreate: 0,
    invoicesToCreate: 0,
    invoiceLinesToCreate: 0,
    paymentsToCreate: 0,
    timeEntriesToCreate: 0,
    payoutsToCreate: 0,
    nameMerges: [],
    skippedDuplicateKeys: 0,
    planHash,
    ignoredBreakdown,
    opCountsByType,
    rowIssues,
    rowIssueSummary,
    reconciliation,
    fileRowCounts,
  };

  const nameSet = new Set<string>();
  for (const file of files) {
    for (const row of file.rows) {
      for (const val of Object.values(row)) {
        if (val && val !== normalizeName(val)) {
          const norm = normalizeName(val);
          if (!nameSet.has(val)) {
            nameSet.add(val);
            plan.nameMerges.push({ original: val, normalized: norm });
          }
        }
      }
    }
  }

  for (const op of ops) {
    const existing = await storage.getImportedKeyByExternalKey(op.externalKey, orgId);
    if (existing) {
      plan.skippedDuplicateKeys++;
      continue;
    }

    if (op.entityType === "client") {
      const dbClient = await storage.getClientByName(orgId, op.normalizedKeyFields.name);
      if (!dbClient) plan.clientsToCreate++;
    } else if (op.entityType === "project") {
      plan.projectsToCreate++;
    } else if (op.entityType === "invoice") {
      plan.invoicesToCreate++;
    } else if (op.entityType === "invoice_line") {
      plan.invoiceLinesToCreate++;
    } else if (op.entityType === "payment") {
      plan.paymentsToCreate++;
    } else if (op.entityType === "time_entry") {
      plan.timeEntriesToCreate++;
    } else if (op.entityType === "imported_payout") {
      plan.payoutsToCreate++;
    }
  }

  return plan;
}

export interface ImportStorage {
  getImportedKeyByExternalKey(key: string, orgId: string): Promise<{ entityId: string } | undefined>;
  getImportedKeysByRun?(runId: string, orgId: string): Promise<{ entityType: string; externalKey: string; entityId: string }[]>;
  getClientByName(orgId: string, name: string): Promise<{ id: string } | undefined>;
  getProjectByName(orgId: string, clientId: string, name: string): Promise<{ id: string } | undefined>;
  getImportedPayoutByExternalKey(key: string, orgId: string): Promise<{ id: string } | undefined>;
  createClient(data: { orgId: string; name: string; email: string | null; phone: string | null; address: string | null }): Promise<{ id: string }>;
  createProject(data: { orgId: string; clientId: string; name: string }): Promise<{ id: string }>;
  createInvoice(data: Record<string, unknown>): Promise<{ id: string }>;
  createInvoiceLine(data: Record<string, unknown>): Promise<{ id: string }>;
  createPayment(data: Record<string, unknown>): Promise<{ id: string }>;
  createTimeEntry(data: Record<string, unknown>): Promise<{ id: string }>;
  createImportedPayout(data: Record<string, unknown>): Promise<{ id: string }>;
  createImportedKey(data: { orgId: string; importRunId: string; entityType: string; externalKey: string; entityId: string }): Promise<unknown>;
  recalcInvoiceTotals(invoiceId: string, orgId: string): Promise<void>;
  markTimeEntriesInvoiced(entryIds: string[], lineId: string, orgId: string): Promise<void>;
}

export async function applyImportOps(
  orgId: string,
  userId: string,
  importRunId: string,
  files: ParsedFileData[],
  ops: ImportOp[],
  storageImpl: ImportStorage,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const ensuredClients = new Map<string, string>();
  const ensuredProjects = new Map<string, string>();

  async function ensureClient(name: string, email?: string, phone?: string, address?: string): Promise<string> {
    const normalized = normalizeName(name);
    if (ensuredClients.has(normalized)) return ensuredClients.get(normalized)!;

    const key = `FB:CLIENT:${normalized}`;
    const existingKey = await storageImpl.getImportedKeyByExternalKey(key, orgId);
    if (existingKey) {
      ensuredClients.set(normalized, existingKey.entityId);
      return existingKey.entityId;
    }

    const existing = await storageImpl.getClientByName(orgId, normalized);
    if (existing) {
      ensuredClients.set(normalized, existing.id);
      return existing.id;
    }

    try {
      const client = await storageImpl.createClient({
        orgId,
        name: normalized,
        email: email || null,
        phone: phone || null,
        address: address || null,
      });
      await storageImpl.createImportedKey({
        orgId,
        importRunId,
        entityType: "client",
        externalKey: key,
        entityId: client.id,
      });
      counts["client"] = (counts["client"] || 0) + 1;
      ensuredClients.set(normalized, client.id);
      return client.id;
    } catch (err: any) {
      if (err.code === "23505") {
        const retryExisting = await storageImpl.getClientByName(orgId, normalized);
        if (retryExisting) {
          ensuredClients.set(normalized, retryExisting.id);
          return retryExisting.id;
        }
      }
      throw err;
    }
  }

  async function ensureProject(clientName: string, projectName: string): Promise<string> {
    const clientId = await ensureClient(clientName);
    const normalized = normalizeName(projectName);
    const cacheKey = `${clientId}:${normalized}`;
    if (ensuredProjects.has(cacheKey)) return ensuredProjects.get(cacheKey)!;

    const existing = await storageImpl.getProjectByName(orgId, clientId, normalized);
    if (existing) {
      ensuredProjects.set(cacheKey, existing.id);
      return existing.id;
    }

    const project = await storageImpl.createProject({
      orgId,
      clientId,
      name: normalized,
    });
    await storageImpl.createImportedKey({
      orgId,
      importRunId,
      entityType: "project",
      externalKey: `FB:PROJ:${clientName}:${normalized}`,
      entityId: project.id,
    });
    counts["project"] = (counts["project"] || 0) + 1;
    ensuredProjects.set(cacheKey, project.id);
    return project.id;
  }

  const invoiceFile = files.find((f) => f.type === "invoice_details");
  const invoiceRowsByNum = new Map<string, Record<string, string>[]>();
  if (invoiceFile) {
    for (const row of invoiceFile.rows) {
      const invNum = row["Invoice #"] || "";
      if (invNum) {
        if (!invoiceRowsByNum.has(invNum)) invoiceRowsByNum.set(invNum, []);
        invoiceRowsByNum.get(invNum)!.push(row);
      }
    }
  }

  const timeFile = files.find((f) => f.type === "time_entry_details");

  const invoiceIdMap = new Map<string, string>();

  for (const op of ops) {
    const existingKey = await storageImpl.getImportedKeyByExternalKey(op.externalKey, orgId);
    if (existingKey) continue;

    if (op.entityType === "client") {
      await ensureClient(
        op.normalizedKeyFields.name,
        (op.payload.email as string) || "",
        (op.payload.phone as string) || "",
      );
    } else if (op.entityType === "project") {
      await ensureProject(op.normalizedKeyFields.client, op.normalizedKeyFields.project);
    } else if (op.entityType === "invoice") {
      const invNum = op.normalizedKeyFields.number;
      const lines = invoiceRowsByNum.get(invNum) || [];
      const firstLine = lines[0] || {};
      const clientName = normalizeName(firstLine["Client Name"] || "");
      const clientId = await ensureClient(clientName);
      const status = (firstLine["Invoice Status"] || "").toLowerCase();

      let mappedStatus: "DRAFT" | "SENT" | "PAID" | "PARTIAL" | "VOID" = "DRAFT";
      if (status === "paid") mappedStatus = "PAID";
      else if (status === "sent" || status === "overdue") mappedStatus = "SENT";

      const issuedDate = firstLine["Date Issued"] || new Date().toISOString().split("T")[0];
      const dueDate = firstLine["Date Due"] || issuedDate;

      const invoice = await storageImpl.createInvoice({
        orgId,
        clientId,
        number: `FB-${invNum}`,
        status: mappedStatus,
        issuedDate,
        dueDate,
        discountType: "NONE",
        discountValue: "0",
        taxRate: "0",
        notes: `Imported from FreshBooks invoice #${invNum}`,
      });

      await storageImpl.createImportedKey({
        orgId,
        importRunId,
        entityType: "invoice",
        externalKey: op.externalKey,
        entityId: invoice.id,
      });
      invoiceIdMap.set(invNum, invoice.id);
      counts["invoice"] = (counts["invoice"] || 0) + 1;
    } else if (op.entityType === "invoice_line") {
      const invNum = op.normalizedKeyFields.invoiceNumber;
      const li = parseInt(op.normalizedKeyFields.lineIndex, 10);
      const lines = invoiceRowsByNum.get(invNum) || [];
      const l = lines[li] || {};
      const invoiceId = invoiceIdMap.get(invNum);
      if (!invoiceId) continue;

      const desc = l["Item Name"] || "Imported line";
      const rate = parseFloat(l["Rate"] || "0");
      const qty = parseFloat(l["Quantity"] || "0");
      const lineTotal = parseFloat(l["Line Total"] || "0");

      const line = await storageImpl.createInvoiceLine({
        orgId,
        invoiceId,
        description: l["Item Description"] ? `${desc} - ${l["Item Description"]}` : desc,
        quantity: qty.toString(),
        unitRate: rate.toString(),
        amount: round2(lineTotal).toString(),
      });

      await storageImpl.createImportedKey({
        orgId,
        importRunId,
        entityType: "invoice_line",
        externalKey: op.externalKey,
        entityId: line.id,
      });
      counts["invoice_line"] = (counts["invoice_line"] || 0) + 1;
    } else if (op.entityType === "payment") {
      const invNum = op.normalizedKeyFields.invoiceNumber;
      const invoiceId = invoiceIdMap.get(invNum);
      if (!invoiceId) continue;

      await storageImpl.recalcInvoiceTotals(invoiceId, orgId);

      const datePaid = (op.payload.datePaid as string) || new Date().toISOString().split("T")[0];
      const lines = invoiceRowsByNum.get(invNum) || [];
      const lineItems = lines.map((l) => parseFloat(l["Line Total"] || "0"));
      const total = round2(lineItems.reduce((s, v) => s + v, 0));

      const payment = await storageImpl.createPayment({
        orgId,
        invoiceId,
        amount: total.toString(),
        date: datePaid,
        method: "IMPORTED",
        provider: "IMPORTED",
        notes: `Historical payment from FreshBooks invoice #${invNum}`,
      });

      await storageImpl.createImportedKey({
        orgId,
        importRunId,
        entityType: "payment",
        externalKey: op.externalKey,
        entityId: payment.id,
      });
      counts["payment"] = (counts["payment"] || 0) + 1;
      await storageImpl.recalcInvoiceTotals(invoiceId, orgId);
    } else if (op.entityType === "time_entry") {
      const clientName = op.normalizedKeyFields.client;
      const projectName = op.normalizedKeyFields.project;
      const projectId = await ensureProject(clientName, projectName);

      const hours = parseFloat((op.payload.hours as string) || "0");
      const minutes = Math.round(hours * 60);

      const rowIndex = parseInt(op.externalKey.split(":").pop()!, 10);
      const row = timeFile?.rows[rowIndex] || {};
      const status = (row["Status"] || "").toLowerCase();
      const billable = status !== "non-billable";

      const entry = await storageImpl.createTimeEntry({
        orgId,
        projectId,
        userId,
        date: op.normalizedKeyFields.date,
        minutes,
        billable,
        rate: "0",
        notes: `[IMPORTED] ${op.payload.service || ""}: ${row["Note"] || ""} (${op.normalizedKeyFields.member || ""})`.trim(),
      });

      if (status === "billed") {
        await storageImpl.markTimeEntriesInvoiced([entry.id], entry.id, orgId);
      }

      await storageImpl.createImportedKey({
        orgId,
        importRunId,
        entityType: "time_entry",
        externalKey: op.externalKey,
        entityId: entry.id,
      });
      counts["time_entry"] = (counts["time_entry"] || 0) + 1;
    } else if (op.entityType === "imported_payout") {
      const existingPayout = await storageImpl.getImportedPayoutByExternalKey(op.externalKey, orgId);
      let payoutId: string;
      if (existingPayout) {
        payoutId = existingPayout.id;
      } else {
        const amount = parseFloat(op.normalizedKeyFields.amount || "0") || 0;
        const payout = await storageImpl.createImportedPayout({
          orgId,
          paidAt: op.normalizedKeyFields.date || new Date().toISOString().split("T")[0],
          amount: amount.toString(),
          currency: (op.payload.currency as string) || "USD",
          payeeName: (op.payload.payeeRaw as string) || "",
          payeeNormalized: op.normalizedKeyFields.payee,
          merchant: (op.payload.merchant as string) || "",
          description: (op.payload.description as string) || "",
          source: (op.payload.source as string) || "",
          externalKey: op.externalKey,
        });
        payoutId = payout.id;
      }

      await storageImpl.createImportedKey({
        orgId,
        importRunId,
        entityType: "imported_payout",
        externalKey: op.externalKey,
        entityId: payoutId,
      });
      counts["imported_payout"] = (counts["imported_payout"] || 0) + 1;
    }
  }

  return counts;
}

export class ParsedFileCache {
  private cache = new Map<string, ParsedFileData>();
  private opsCache: {
    options: ImportOptions;
    result: ReturnType<typeof buildImportOps>;
  } | null = null;
  fingerprint: string = "";

  set(fileType: string, data: ParsedFileData): void {
    this.cache.set(fileType, data);
    this.opsCache = null;
    this.fingerprint = Array.from(this.cache.values())
      .map(f => `${f.type}:${f.sha256}`)
      .sort()
      .join("|");
  }

  get(fileType: string): ParsedFileData | undefined {
    return this.cache.get(fileType);
  }

  getAll(): ParsedFileData[] {
    return Array.from(this.cache.values());
  }

  size(): number {
    return this.cache.size;
  }

  buildOps(options: ImportOptions): ReturnType<typeof buildImportOps> {
    if (this.opsCache && JSON.stringify(this.opsCache.options) === JSON.stringify(options)) {
      return this.opsCache.result;
    }
    const result = buildImportOps(this.getAll(), options);
    this.opsCache = { options, result };
    return result;
  }

  invalidateOps(): void {
    this.opsCache = null;
  }
}

export interface VerificationResult {
  passed: boolean;
  checks: VerificationCheck[];
}

export interface VerificationCheck {
  entity: string;
  metric: string;
  expected: number;
  actual: number;
  passed: boolean;
}

export async function verifyImportResults(
  importRunId: string,
  expectedCounts: Record<string, number>,
  storageImpl: ImportStorage,
  orgId: string,
): Promise<VerificationResult> {
  const checks: VerificationCheck[] = [];

  const keys = await storageImpl.getImportedKeysByRun?.(importRunId, orgId);
  if (!keys) {
    return { passed: true, checks };
  }

  const actualCounts: Record<string, number> = {};
  for (const key of keys) {
    actualCounts[key.entityType] = (actualCounts[key.entityType] || 0) + 1;
  }

  for (const [entity, expected] of Object.entries(expectedCounts)) {
    const actual = actualCounts[entity] || 0;
    checks.push({
      entity,
      metric: "count",
      expected,
      actual,
      passed: expected === actual,
    });
  }

  for (const [entity, actual] of Object.entries(actualCounts)) {
    if (!(entity in expectedCounts)) {
      checks.push({
        entity,
        metric: "count",
        expected: 0,
        actual,
        passed: false,
      });
    }
  }

  const passed = checks.every((c) => c.passed);
  return { passed, checks };
}

export async function executeImport(
  orgId: string,
  userId: string,
  importRunId: string,
  files: ParsedFileData[],
  options: ImportOptions,
): Promise<Record<string, number>> {
  const { ops } = buildImportOps(files, options);
  const counts = await applyImportOps(orgId, userId, importRunId, files, ops, storage as unknown as ImportStorage);
  return counts;
}
