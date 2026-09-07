import { describe, it, expect } from "vitest";
import { deriveCaseKeyPrefix, CASE_KEY_PREFIX_RE } from "../../server/support-cases";

describe("deriveCaseKeyPrefix", () => {
  it("keeps an all-caps first word (ABS Machining, Inc → ABS)", () => {
    expect(deriveCaseKeyPrefix("ABS Machining, Inc")).toBe("ABS");
  });
  it("uses initials for multi-word names", () => {
    expect(deriveCaseKeyPrefix("Cherry Street Consulting")).toBe("CSC");
    expect(deriveCaseKeyPrefix("Acme Corporation")).toBe("AC");
  });
  it("uses the first three letters for a single word", () => {
    expect(deriveCaseKeyPrefix("Acme")).toBe("ACM");
  });
  it("never starts with a digit and never falls below two characters", () => {
    for (const name of ["7-Eleven", "3M", "X", "12345", "", "!!!", "A", "Élan"]) {
      const p = deriveCaseKeyPrefix(name);
      expect(p, name).toMatch(CASE_KEY_PREFIX_RE);
    }
    expect(deriveCaseKeyPrefix("X")).toBe("CASE");
    expect(deriveCaseKeyPrefix("12345")).toBe("CASE");
  });
  it("caps at ten characters", () => {
    expect(deriveCaseKeyPrefix("Supercalifragilistic").length).toBeLessThanOrEqual(10);
  });
});
