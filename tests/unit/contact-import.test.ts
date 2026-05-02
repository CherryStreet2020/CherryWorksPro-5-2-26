import { describe, it, expect } from "vitest";
import { planContactImport } from "../../server/lib/contact-import";

const MAPPING = {
  "First Name": "firstName",
  "Last Name": "lastName",
  Email: "email",
  Company: "companyName",
};

describe("planContactImport", () => {
  it("plans an insert for a valid, non-duplicate row", () => {
    const result = planContactImport({
      rows: [
        {
          "First Name": "Ada",
          "Last Name": "Lovelace",
          Email: "ada@example.com",
          Company: "Analytical Engines",
        },
      ],
      mapping: MAPPING,
      dedupeStrategy: "skip",
      existingEmails: new Set<string>(),
    });

    expect(result.summary).toEqual({
      willCreate: 1,
      willUpdate: 0,
      willSkip: 0,
      errors: 0,
    });
    expect(result.plans).toHaveLength(1);
    const p = result.plans[0];
    expect(p.action).toBe("insert");
    if (p.action === "insert") {
      expect(p.data.firstName).toBe("Ada");
      expect(p.data.email).toBe("ada@example.com");
      expect(p.data.companyName).toBe("Analytical Engines");
    }
  });

  it("skips a row whose email already exists when dedupeStrategy is 'skip'", () => {
    const result = planContactImport({
      rows: [
        {
          "First Name": "Ada",
          "Last Name": "Lovelace",
          Email: "Ada@Example.com",
          Company: "Analytical Engines",
        },
      ],
      mapping: MAPPING,
      dedupeStrategy: "skip",
      existingEmails: new Set(["ada@example.com"]),
    });

    expect(result.summary).toEqual({
      willCreate: 0,
      willUpdate: 0,
      willSkip: 1,
      errors: 0,
    });
    const p = result.plans[0];
    expect(p.action).toBe("skip");
    if (p.action === "skip") {
      expect(p.reason).toBe("duplicate_in_db");
      expect(p.emailKey).toBe("ada@example.com");
    }
  });

  it("plans an update for a duplicate row when dedupeStrategy is 'update'", () => {
    const result = planContactImport({
      rows: [
        {
          "First Name": "Ada",
          "Last Name": "Lovelace",
          Email: "ada@example.com",
          Company: "Updated Co",
        },
      ],
      mapping: MAPPING,
      dedupeStrategy: "update",
      existingEmails: new Set(["ada@example.com"]),
    });

    expect(result.summary).toEqual({
      willCreate: 0,
      willUpdate: 1,
      willSkip: 0,
      errors: 0,
    });
    const p = result.plans[0];
    expect(p.action).toBe("update");
    if (p.action === "update") {
      expect(p.emailKey).toBe("ada@example.com");
      expect(p.data.companyName).toBe("Updated Co");
    }
  });

  it("buckets a row missing required fields as an error", () => {
    const result = planContactImport({
      rows: [
        {
          "First Name": "",
          "Last Name": "Lovelace",
          Email: "not-an-email",
          Company: "Acme",
        },
      ],
      mapping: MAPPING,
      dedupeStrategy: "skip",
      existingEmails: new Set<string>(),
    });

    expect(result.summary.errors).toBe(1);
    expect(result.summary.willCreate).toBe(0);
    const p = result.plans[0];
    expect(p.action).toBe("error");
    if (p.action === "error") {
      expect(p.message).toMatch(/firstName/);
    }
  });
});
