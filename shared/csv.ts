export interface CsvRowIssue {
  physicalLine: number;
  reason: string;
  raw: string;
}

export interface CsvParseMeta {
  headers: string[];
  rowsRaw: string[][];
  physicalLineCount: number;
  recordCount: number;
  unclosedQuotes: number;
  rowIssues: CsvRowIssue[];
}

export interface CsvMapResult {
  rows: Record<string, string>[];
  ignored: { count: number; byReason: Record<string, number> };
}

function stripBOM(text: string): string {
  if (text.charCodeAt(0) === 0xfeff) return text.slice(1);
  return text;
}

function parseRfc4180(
  text: string,
): { records: string[][]; physicalLineCount: number; unclosedQuotes: number } {
  const cleaned = stripBOM(text);
  const records: string[][] = [];
  let unclosedQuotes = 0;

  const physicalLineCount = cleaned.split(/\r?\n/).length;

  let i = 0;
  const len = cleaned.length;

  while (i < len) {
    const record: string[] = [];
    let atRecordStart = true;

    while (i < len) {
      let field = "";

      if (i < len && cleaned[i] === '"') {
        i++;
        let closed = false;
        while (i < len) {
          if (cleaned[i] === '"') {
            if (i + 1 < len && cleaned[i + 1] === '"') {
              field += '"';
              i += 2;
            } else {
              closed = true;
              i++;
              break;
            }
          } else {
            field += cleaned[i];
            i++;
          }
        }
        if (!closed) {
          unclosedQuotes++;
        }
      } else {
        while (i < len && cleaned[i] !== ',' && cleaned[i] !== '\r' && cleaned[i] !== '\n') {
          field += cleaned[i];
          i++;
        }
      }

      record.push(field);
      atRecordStart = false;

      if (i < len && cleaned[i] === ',') {
        i++;
        continue;
      }

      if (i < len && cleaned[i] === '\r') i++;
      if (i < len && cleaned[i] === '\n') i++;
      break;
    }

    if (atRecordStart) continue;

    if (record.length === 1 && record[0] === '' && i >= len) {
      break;
    }

    records.push(record);
  }

  return { records, physicalLineCount, unclosedQuotes };
}

export function parseCsvWithMeta(text: string): CsvParseMeta {
  const { records, physicalLineCount, unclosedQuotes } = parseRfc4180(text);

  if (records.length === 0) {
    return {
      headers: [],
      rowsRaw: [],
      physicalLineCount,
      recordCount: 0,
      unclosedQuotes,
      rowIssues: [],
    };
  }

  const headers = records[0].map((h) => h.trim());
  const dataRecords = records.slice(1);
  const rowsRaw: string[][] = [];
  const rowIssues: CsvRowIssue[] = [];

  for (let idx = 0; idx < dataRecords.length; idx++) {
    const rec = dataRecords[idx];

    if (rec.length === 1 && rec[0].trim() === "") {
      rowIssues.push({
        physicalLine: -1,
        reason: "empty_row",
        raw: "",
      });
      continue;
    }

    if (rec.length !== headers.length) {
      rowIssues.push({
        physicalLine: -1,
        reason: `column_count_mismatch:expected=${headers.length},got=${rec.length}`,
        raw: rec.join(",").substring(0, 200),
      });
    }

    rowsRaw.push(rec);
  }

  return {
    headers,
    rowsRaw,
    physicalLineCount,
    recordCount: rowsRaw.length,
    unclosedQuotes,
    rowIssues,
  };
}

export function mapRows(
  headers: string[],
  rowsRaw: string[][],
): CsvMapResult {
  const rows: Record<string, string>[] = [];
  const ignored: { count: number; byReason: Record<string, number> } = {
    count: 0,
    byReason: {},
  };

  for (const raw of rowsRaw) {
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (raw[j] || "").trim();
    }

    const allEmpty = Object.values(row).every((v) => v === "");
    if (allEmpty) {
      ignored.count++;
      ignored.byReason["all_fields_empty"] =
        (ignored.byReason["all_fields_empty"] || 0) + 1;
      continue;
    }

    rows.push(row);
  }

  return { rows, ignored };
}
