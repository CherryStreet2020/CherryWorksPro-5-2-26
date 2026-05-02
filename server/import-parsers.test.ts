import { describe, it, expect } from "vitest";
import { parseAmount, parseDate, parseHours } from "./import-parsers";

describe("parseAmount", () => {
  it("parses plain decimals", () => {
    expect(parseAmount("1234.56")).toBe(1234.56);
    expect(parseAmount("0")).toBe(0);
    expect(parseAmount("100")).toBe(100);
  });

  it("strips currency symbols", () => {
    expect(parseAmount("$1234.56")).toBe(1234.56);
    expect(parseAmount("€100.00")).toBe(100);
    expect(parseAmount("£50.25")).toBe(50.25);
    expect(parseAmount("¥1000")).toBe(1000);
  });

  it("handles thousands separators", () => {
    expect(parseAmount("1,234.56")).toBe(1234.56);
    expect(parseAmount("$1,234.56")).toBe(1234.56);
    expect(parseAmount("10,000.00")).toBe(10000);
    expect(parseAmount("1,000,000.99")).toBe(1000000.99);
  });

  it("handles European decimal format", () => {
    expect(parseAmount("1.234,56")).toBe(1234.56);
    expect(parseAmount("€1.234,56")).toBe(1234.56);
    expect(parseAmount("10.000,00")).toBe(10000);
  });

  it("handles comma-as-decimal with no thousands", () => {
    expect(parseAmount("100,50")).toBe(100.50);
    expect(parseAmount("€50,25")).toBe(50.25);
  });

  it("handles negative amounts", () => {
    expect(parseAmount("-100.50")).toBe(-100.50);
    expect(parseAmount("($50.00)")).toBe(-50);
    expect(parseAmount("-$1,234.56")).toBe(-1234.56);
  });

  it("handles whitespace and trimming", () => {
    expect(parseAmount("  1234.56  ")).toBe(1234.56);
    expect(parseAmount(" $ 100.00 ")).toBe(100);
  });

  it("returns NaN for unparseable values", () => {
    expect(parseAmount("")).toBeNaN();
    expect(parseAmount("   ")).toBeNaN();
    expect(parseAmount("abc")).toBeNaN();
    expect(parseAmount("N/A")).toBeNaN();
    expect(parseAmount("--")).toBeNaN();
  });

  it("handles zero amounts", () => {
    expect(parseAmount("0.00")).toBe(0);
    expect(parseAmount("$0.00")).toBe(0);
  });
});

describe("parseDate", () => {
  it("parses YYYY-MM-DD", () => {
    expect(parseDate("2025-01-15")).toBe("2025-01-15");
    expect(parseDate("2024-12-31")).toBe("2024-12-31");
  });

  it("parses MM/DD/YYYY (US format)", () => {
    expect(parseDate("01/15/2025")).toBe("2025-01-15");
    expect(parseDate("12/31/2024")).toBe("2024-12-31");
    expect(parseDate("1/5/2025")).toBe("2025-01-05");
  });

  it("prefers MM/DD/YYYY for ambiguous dates", () => {
    expect(parseDate("03/04/2025")).toBe("2025-03-04");
    expect(parseDate("01/12/2025")).toBe("2025-01-12");
  });

  it("parses DD/MM/YYYY when month > 12", () => {
    expect(parseDate("31/01/2025")).toBe("2025-01-31");
    expect(parseDate("25/12/2024")).toBe("2024-12-25");
  });

  it("parses Month DD, YYYY format", () => {
    expect(parseDate("Jan 15, 2025")).toBe("2025-01-15");
    expect(parseDate("December 31, 2024")).toBe("2024-12-31");
    expect(parseDate("Feb 1, 2025")).toBe("2025-02-01");
    expect(parseDate("September 5, 2025")).toBe("2025-09-05");
  });

  it("parses DD Month YYYY format", () => {
    expect(parseDate("15 Jan 2025")).toBe("2025-01-15");
    expect(parseDate("1 February 2025")).toBe("2025-02-01");
  });

  it("parses ISO 8601 with time", () => {
    expect(parseDate("2025-01-15T10:30:00")).toBe("2025-01-15");
    expect(parseDate("2025-01-15T00:00:00Z")).toBe("2025-01-15");
    expect(parseDate("2025-01-15 14:30")).toBe("2025-01-15");
  });

  it("parses short year MM/DD/YY", () => {
    expect(parseDate("01/15/25")).toBe("2025-01-15");
    expect(parseDate("12/31/99")).toBe("1999-12-31");
  });

  it("parses with dashes instead of slashes", () => {
    expect(parseDate("01-15-2025")).toBe("2025-01-15");
  });

  it("returns null for invalid inputs", () => {
    expect(parseDate("")).toBeNull();
    expect(parseDate("   ")).toBeNull();
    expect(parseDate("not a date")).toBeNull();
    expect(parseDate("13/32/2025")).toBeNull();
    expect(parseDate("2025-13-01")).toBeNull();
    expect(parseDate("2025-02-30")).toBeNull();
  });

  it("handles edge dates correctly", () => {
    expect(parseDate("2025-02-28")).toBe("2025-02-28");
    expect(parseDate("2024-02-29")).toBe("2024-02-29");
    expect(parseDate("2025-02-29")).toBeNull();
  });
});

describe("parseHours", () => {
  it("parses plain decimal hours", () => {
    expect(parseHours("2.5")).toBe(2.5);
    expect(parseHours("0.25")).toBe(0.25);
    expect(parseHours("8")).toBe(8);
    expect(parseHours("0")).toBe(0);
  });

  it("parses HH:MM:SS format", () => {
    expect(parseHours("02:30:00")).toBe(2.5);
    expect(parseHours("01:15:00")).toBe(1.25);
    expect(parseHours("00:00:00")).toBe(0);
    expect(parseHours("10:30:30")).toBeCloseTo(10.5083, 3);
  });

  it("parses HH:MM format", () => {
    expect(parseHours("02:30")).toBe(2.5);
    expect(parseHours("01:45")).toBe(1.75);
    expect(parseHours("00:15")).toBe(0.25);
    expect(parseHours("0:30")).toBe(0.5);
  });

  it("parses Nh Nm format", () => {
    expect(parseHours("2h 30m")).toBe(2.5);
    expect(parseHours("1h")).toBe(1);
    expect(parseHours("3h 0m")).toBe(3);
    expect(parseHours("2h30m")).toBe(2.5);
    expect(parseHours("1h 15min")).toBe(1.25);
  });

  it("parses standalone minutes", () => {
    expect(parseHours("30m")).toBe(0.5);
    expect(parseHours("45min")).toBe(0.75);
    expect(parseHours("15minutes")).toBe(0.25);
  });

  it("treats large integers as minutes", () => {
    expect(parseHours("90")).toBe(1.5);
    expect(parseHours("120")).toBe(2);
    expect(parseHours("150")).toBe(2.5);
    expect(parseHours("60")).toBe(1);
    expect(parseHours("30")).toBeCloseTo(0.5, 3);
  });

  it("keeps small decimals as hours", () => {
    expect(parseHours("1.5")).toBe(1.5);
    expect(parseHours("7.75")).toBe(7.75);
    expect(parseHours("24")).toBe(24);
  });

  it("returns NaN for unparseable values", () => {
    expect(parseHours("")).toBeNaN();
    expect(parseHours("   ")).toBeNaN();
    expect(parseHours("abc")).toBeNaN();
    expect(parseHours("N/A")).toBeNaN();
  });

  it("handles midnight/zero durations", () => {
    expect(parseHours("0:00")).toBe(0);
    expect(parseHours("00:00:00")).toBe(0);
    expect(parseHours("0")).toBe(0);
    expect(parseHours("0h 0m")).toBe(0);
  });
});

describe("QuickBooks duration normalization", () => {
  it("converts HH:MM:SS to decimal hours via normalizer", async () => {
    const { normalizeRows } = await import("./import-normalizer");
    const rows = [
      { Date: "2025-01-15", Name: "John", Customer: "Acme", Service: "Dev", Duration: "02:30:00", Memo: "work" },
      { Date: "2025-01-15", Name: "Jane", Customer: "Acme", Service: "Dev", Duration: "01:15:00", Memo: "work" },
    ];
    const result = normalizeRows(rows, "quickbooks", "time_entry_details");
    expect(result[0]["Hours"]).toBe("2.50");
    expect(result[1]["Hours"]).toBe("1.25");
  });

  it("converts HH:MM to decimal hours", async () => {
    const { normalizeRows } = await import("./import-normalizer");
    const rows = [
      { Date: "2025-01-15", Name: "John", Customer: "Acme", Service: "Dev", Duration: "03:45", Memo: "work" },
    ];
    const result = normalizeRows(rows, "quickbooks", "time_entry_details");
    expect(result[0]["Hours"]).toBe("3.75");
  });

  it("handles plain minutes as Duration", async () => {
    const { normalizeRows } = await import("./import-normalizer");
    const rows = [
      { Date: "2025-01-15", Name: "John", Customer: "Acme", Service: "Dev", Duration: "90", Memo: "work" },
    ];
    const result = normalizeRows(rows, "quickbooks", "time_entry_details");
    expect(result[0]["Hours"]).toBe("1.50");
  });

  it("handles plain decimal hours", async () => {
    const { normalizeRows } = await import("./import-normalizer");
    const rows = [
      { Date: "2025-01-15", Name: "John", Customer: "Acme", Service: "Dev", Duration: "2.5", Memo: "work" },
    ];
    const result = normalizeRows(rows, "quickbooks", "time_entry_details");
    expect(result[0]["Hours"]).toBe("2.50");
  });
});

describe("Scoro duration normalization", () => {
  it("converts HH:MM Duration to decimal hours", async () => {
    const { normalizeRows } = await import("./import-normalizer");
    const rows = [
      { Date: "2025-01-15", User: "Alice", Project: "Acme", Duration: "02:30", Comment: "coding" },
    ];
    const result = normalizeRows(rows, "scoro", "time_entry_details");
    expect(result[0]["Hours"]).toBe("2.50");
  });

  it("converts decimal Duration to hours", async () => {
    const { normalizeRows } = await import("./import-normalizer");
    const rows = [
      { Date: "2025-01-15", User: "Alice", Project: "Acme", Duration: "1.75", Comment: "coding" },
    ];
    const result = normalizeRows(rows, "scoro", "time_entry_details");
    expect(result[0]["Hours"]).toBe("1.75");
  });
});

describe("Paymo duration normalization", () => {
  it("converts seconds to decimal hours for large integer durations", async () => {
    const { normalizeRows } = await import("./import-normalizer");
    const rows = [
      { Date: "2025-01-15", User: "Bob", Task: "Deploy", Duration: "9000" },
    ];
    const result = normalizeRows(rows, "paymo", "time_entry_details");
    expect(result[0]["Hours"]).toBe("2.50");
  });
});

describe("BigTime hours normalization", () => {
  it("computes Hours from Billable + Non-Billable when no Hours column", async () => {
    const { normalizeRows } = await import("./import-normalizer");
    const rows = [
      { Date: "2025-01-15", Staff: "Carol", Project: "Dev", Task: "Task1", "Billable Hours": "1.5", "Non-Billable Hours": "0.5" },
    ];
    const result = normalizeRows(rows, "bigtime", "time_entry_details");
    expect(result[0]["Hours"]).toBe("2.00");
  });
});
