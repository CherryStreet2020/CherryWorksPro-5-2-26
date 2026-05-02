import { describe, it, expect } from "vitest";
import { stripCostFieldsForRole } from "../../server/routes/middleware";

const SENSITIVE_FIELDS = [
  "costRateHourly",
  "costRateSnapshot",
  "costRate",
  "costAmount",
  "totalCost",
  "laborCost",
  "profit",
  "profitability",
  "margin",
  "profitMargin",
];

function assertNoSensitiveFields(value: any) {
  if (value == null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) assertNoSensitiveFields(item);
    return;
  }
  for (const key of Object.keys(value)) {
    expect(SENSITIVE_FIELDS).not.toContain(key);
    assertNoSensitiveFields(value[key]);
  }
}

describe("stripCostFieldsForRole — TEAM_MEMBER project list contract", () => {
  const projectsListShape = [
    {
      id: "p1",
      name: "Website",
      clientName: "Acme",
      budgetHours: "40.00",
      members: [
        {
          id: "m1",
          userId: "u1",
          userName: "Alice",
          hourlyRate: "150.00",
          costRateHourly: "90.00",
          role: "MEMBER",
        },
        {
          id: "m2",
          userId: "u2",
          userName: "Bob",
          hourlyRate: "200.00",
          costRateHourly: "110.00",
          role: "MEMBER",
        },
      ],
    },
  ];

  it("ADMIN sees cost rate fields on nested member rows", () => {
    const out = stripCostFieldsForRole(projectsListShape, "ADMIN");
    expect(out[0].members[0].costRateHourly).toBe("90.00");
  });

  it("TEAM_MEMBER never sees costRateHourly on nested member rows", () => {
    const out = stripCostFieldsForRole(projectsListShape, "TEAM_MEMBER");
    expect(out[0].members[0]).not.toHaveProperty("costRateHourly");
    expect(out[0].members[1]).not.toHaveProperty("costRateHourly");
    // Bill rate (hourlyRate) is not a cost field and stays visible
    expect(out[0].members[0].hourlyRate).toBe("150.00");
    expect(out[0].members[0].userName).toBe("Alice");
  });

  it("TEAM_MEMBER never sees any sensitive financial field anywhere in /api/projects shapes", () => {
    const projectDetailShape = {
      id: "p1",
      name: "Website",
      members: [
        { id: "m1", userId: "u1", hourlyRate: "150.00", costRateHourly: "90.00", role: "MEMBER" },
      ],
      hoursByMember: [
        { userId: "u1", userName: "Alice", totalHours: 10, profit: 500, margin: 0.4, laborCost: 200 },
      ],
      summary: {
        totalCost: 1000,
        profitability: { profit: 500, margin: 0.5, profitMargin: 50 },
        costRateSnapshot: "90.00",
      },
    };
    const out = stripCostFieldsForRole(projectDetailShape, "TEAM_MEMBER");
    assertNoSensitiveFields(out);
    // Non-sensitive surfaces remain intact
    expect(out.members[0].hourlyRate).toBe("150.00");
    expect(out.hoursByMember[0].totalHours).toBe(10);
    expect(out.summary).toBeDefined();
  });

  it("MANAGER sees cost rate fields on nested member rows (same as ADMIN)", () => {
    // Product policy: MANAGER is trusted with cost / profit / margin
    // visibility. The project-detail Profitability tab is shown to both
    // ADMIN and MANAGER on the client, so the API must return these fields
    // for MANAGER as well — otherwise the panel renders empty.
    const out = stripCostFieldsForRole(projectsListShape, "MANAGER");
    expect(out[0].members[0].costRateHourly).toBe("90.00");
    expect(out[0].members[1].costRateHourly).toBe("110.00");
  });

  it("MANAGER sees profit / margin / totalCost on project detail shapes", () => {
    const projectDetailShape = {
      id: "p1",
      name: "Website",
      members: [
        { id: "m1", userId: "u1", hourlyRate: "150.00", costRateHourly: "90.00", role: "MEMBER" },
      ],
      hoursByMember: [
        { userId: "u1", userName: "Alice", totalHours: 10, profit: 500, margin: 0.4, laborCost: 200 },
      ],
      summary: {
        totalCost: 1000,
        profitability: { profit: 500, margin: 0.5, profitMargin: 50 },
        costRateSnapshot: "90.00",
      },
    };
    const out = stripCostFieldsForRole(projectDetailShape, "MANAGER");
    expect(out.members[0].costRateHourly).toBe("90.00");
    expect(out.hoursByMember[0].profit).toBe(500);
    expect(out.hoursByMember[0].margin).toBe(0.4);
    expect(out.hoursByMember[0].laborCost).toBe(200);
    expect(out.summary.totalCost).toBe(1000);
    expect(out.summary.profitability.profit).toBe(500);
    expect(out.summary.costRateSnapshot).toBe("90.00");
  });

  it("handles null and primitive values defensively", () => {
    expect(stripCostFieldsForRole(null, "TEAM_MEMBER")).toBeNull();
    expect(stripCostFieldsForRole(undefined, "TEAM_MEMBER")).toBeUndefined();
    expect(stripCostFieldsForRole(42, "TEAM_MEMBER")).toBe(42);
    expect(stripCostFieldsForRole([], "TEAM_MEMBER")).toEqual([]);
  });
});
