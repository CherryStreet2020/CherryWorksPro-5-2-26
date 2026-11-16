import { describe, it, expect } from "vitest";
import { addProjectMemberSchema } from "@shared/schema";
import { costRateForSubmit } from "../../client/src/lib/member-cost-rate";

describe("addProjectMemberSchema cost rate", () => {
  it("leaves the cost rate undefined when none is given, so the route can use the person's default pay rate", () => {
    const parsed = addProjectMemberSchema.parse({ userId: "u1", hourlyRate: 150 });
    expect(parsed.costRateHourly).toBeUndefined();
  });

  it("keeps an explicit cost rate, including 0", () => {
    expect(addProjectMemberSchema.parse({ userId: "u1", hourlyRate: 150, costRateHourly: 135 }).costRateHourly).toBe(135);
    expect(addProjectMemberSchema.parse({ userId: "u1", hourlyRate: 150, costRateHourly: 0 }).costRateHourly).toBe(0);
    expect(addProjectMemberSchema.parse({ userId: "u1", billRate: 150, costRate: 105 }).costRateHourly).toBe(105);
  });
});

describe("costRateForSubmit", () => {
  it("sends nothing for an empty box", () => {
    expect(costRateForSubmit("")).toBeUndefined();
    expect(costRateForSubmit("  ")).toBeUndefined();
    expect(costRateForSubmit(undefined)).toBeUndefined();
    expect(costRateForSubmit(null)).toBeUndefined();
  });

  it("sends the typed number", () => {
    expect(costRateForSubmit("135")).toBe(135);
    expect(costRateForSubmit("135.50")).toBe(135.5);
    expect(costRateForSubmit("0")).toBe(0);
  });
});
