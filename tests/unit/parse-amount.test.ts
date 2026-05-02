import { describe, it, expect } from "vitest";
import { parseAmount } from "../../server/import-parsers";

describe("parseAmount", () => {
  describe("basic formats", () => {
    it("parses plain integers", () => {
      expect(parseAmount("100")).toBe(100);
      expect(parseAmount("0")).toBe(0);
    });

    it("parses plain decimals", () => {
      expect(parseAmount("1234.56")).toBe(1234.56);
      expect(parseAmount("1234.5")).toBe(1234.5);
    });

    it("returns NaN for empty/whitespace", () => {
      expect(parseAmount("")).toBeNaN();
      expect(parseAmount("  ")).toBeNaN();
    });
  });

  describe("negative values", () => {
    it("parses parenthesized negatives", () => {
      expect(parseAmount("(100.50)")).toBe(-100.50);
    });

    it("parses minus-prefixed negatives", () => {
      expect(parseAmount("-500")).toBe(-500);
    });
  });

  describe("currency symbols", () => {
    it("strips dollar sign", () => {
      expect(parseAmount("$1,234.56")).toBe(1234.56);
    });

    it("strips euro sign", () => {
      expect(parseAmount("€1.234,56")).toBe(1234.56);
    });

    it("strips pound sign", () => {
      expect(parseAmount("£999.99")).toBe(999.99);
    });

    it("strips rupee sign", () => {
      expect(parseAmount("₹1,23,456.78")).toBe(123456.78);
    });
  });

  describe("European format (period thousands, comma decimal)", () => {
    it("parses 1.234,56 as 1234.56", () => {
      expect(parseAmount("1.234,56")).toBe(1234.56);
    });

    it("parses 12.345.678,90 as 12345678.90", () => {
      expect(parseAmount("12.345.678,90")).toBe(12345678.90);
    });

    it("parses comma-only decimal: 100,50", () => {
      expect(parseAmount("100,50")).toBe(100.50);
    });

    it("parses comma-only decimal: 1000,99", () => {
      expect(parseAmount("1000,99")).toBe(1000.99);
    });
  });

  describe("space as thousands separator", () => {
    it("parses 1 234.56 as 1234.56", () => {
      expect(parseAmount("1 234.56")).toBe(1234.56);
    });

    it("parses 1 234 567.89", () => {
      expect(parseAmount("1 234 567.89")).toBe(1234567.89);
    });

    it("parses non-breaking space", () => {
      expect(parseAmount("1\u00A0234,56")).toBe(1234.56);
    });
  });

  describe("Indian format", () => {
    it("parses 1,23,456.78 as 123456.78", () => {
      expect(parseAmount("1,23,456.78")).toBe(123456.78);
    });

    it("parses 12,34,567.00", () => {
      expect(parseAmount("12,34,567.00")).toBe(1234567.00);
    });
  });

  describe("US format (comma thousands)", () => {
    it("parses 1,234.56 as 1234.56", () => {
      expect(parseAmount("1,234.56")).toBe(1234.56);
    });

    it("parses 1,234,567.89", () => {
      expect(parseAmount("1,234,567.89")).toBe(1234567.89);
    });
  });

  describe("ambiguous cases with locale hint", () => {
    it("1,234 defaults to 1234 (en default)", () => {
      expect(parseAmount("1,234")).toBe(1234);
    });

    it("1,234 with eu hint becomes 1.234", () => {
      expect(parseAmount("1,234", "eu")).toBe(1.234);
    });

    it("1,234 with en hint stays 1234", () => {
      expect(parseAmount("1,234", "en")).toBe(1234);
    });

    it("1,23 treated as decimal (auto)", () => {
      expect(parseAmount("1,23")).toBe(1.23);
    });

    it("1,23 with en hint stays 123", () => {
      expect(parseAmount("1,23", "en")).toBe(123);
    });
  });

  describe("no-separator decimals", () => {
    it("parses 1234.5 correctly", () => {
      expect(parseAmount("1234.5")).toBe(1234.5);
    });

    it("parses 0.99 correctly", () => {
      expect(parseAmount("0.99")).toBe(0.99);
    });
  });

  describe("edge cases", () => {
    it("parses value with trailing/leading whitespace", () => {
      expect(parseAmount("  1,234.56  ")).toBe(1234.56);
    });

    it("rejects non-numeric strings", () => {
      expect(parseAmount("abc")).toBeNaN();
    });

    it("rejects Infinity", () => {
      expect(parseAmount("Infinity")).toBeNaN();
    });
  });
});
