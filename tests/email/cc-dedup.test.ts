/**
 * normalizeCc — guarantees an invoice recipient never appears in both the
 * To and the Cc. The invoice send/resend/reminder paths CC every billing
 * contact; once a billing contact can be chosen as the To (the selectable
 * recipient feature), the same address would otherwise be duplicated into
 * the Cc. sendInvoiceEmail runs the Cc through this before dispatch.
 */
import { describe, it, expect } from "vitest";
import { normalizeCc } from "../../server/email";

describe("normalizeCc", () => {
  it("removes the To address from the Cc list (case-insensitive)", () => {
    expect(normalizeCc(["BILLING@acme.com", "ap@acme.com"], "billing@acme.com")).toEqual([
      "ap@acme.com",
    ]);
  });

  it("dedupes case-insensitive duplicates within the Cc list", () => {
    expect(normalizeCc(["ap@acme.com", "AP@acme.com", "ar@acme.com"], "client@acme.com")).toEqual([
      "ap@acme.com",
      "ar@acme.com",
    ]);
  });

  it("drops blank/whitespace entries and trims", () => {
    expect(normalizeCc(["  ", "", "  ar@acme.com  "], "client@acme.com")).toEqual(["ar@acme.com"]);
  });

  it("returns an empty array when Cc is empty or undefined", () => {
    expect(normalizeCc(undefined, "client@acme.com")).toEqual([]);
    expect(normalizeCc([], "client@acme.com")).toEqual([]);
  });

  it("returns an empty array when the only Cc entry equals the To", () => {
    expect(normalizeCc(["billing@acme.com"], "Billing@acme.com")).toEqual([]);
  });

  it("preserves a Cc list that does not overlap the To", () => {
    expect(normalizeCc(["ap@acme.com", "ar@acme.com"], "client@acme.com")).toEqual([
      "ap@acme.com",
      "ar@acme.com",
    ]);
  });

  it("drops Cc entries that aren't valid email addresses (don't fail the whole send)", () => {
    expect(normalizeCc(["good@acme.com", "not-an-email", "also bad", "a@b"], "x@acme.com")).toEqual([
      "good@acme.com",
    ]);
  });

  it("ignores non-string Cc entries without throwing", () => {
    expect(
      normalizeCc(["good@acme.com", 123 as any, { a: 1 } as any, null as any], "x@acme.com"),
    ).toEqual(["good@acme.com"]);
  });
});
