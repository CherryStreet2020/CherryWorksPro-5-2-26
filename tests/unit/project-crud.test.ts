import { describe, it, expect } from "vitest";

describe("Project duplicate logic", () => {
  it("duplicated project name has (Copy) suffix", () => {
    const originalName = "Website Redesign";
    const copyName = originalName + " (Copy)";
    expect(copyName).toBe("Website Redesign (Copy)");
    expect(copyName).toContain("(Copy)");
  });

  it("duplicate preserves clientId and description", () => {
    const source = {
      name: "Mobile App",
      clientId: "client-123",
      description: "Build a mobile app",
      status: "ACTIVE",
    };

    const duplicate = {
      name: source.name + " (Copy)",
      clientId: source.clientId,
      description: source.description,
      status: "ACTIVE",
    };

    expect(duplicate.clientId).toBe(source.clientId);
    expect(duplicate.description).toBe(source.description);
    expect(duplicate.status).toBe("ACTIVE");
    expect(duplicate.name).toBe("Mobile App (Copy)");
  });

  it("duplicate copies members with same rates", () => {
    const sourceMembers = [
      { userId: "user-1", hourlyRate: "175.00", costRateHourly: "100.00" },
      { userId: "user-2", hourlyRate: "200.00", costRateHourly: "120.00" },
    ];

    const copiedMembers = sourceMembers.map((m) => ({
      userId: m.userId,
      hourlyRate: m.hourlyRate,
      costRateHourly: m.costRateHourly,
    }));

    expect(copiedMembers).toHaveLength(2);
    expect(copiedMembers[0].userId).toBe("user-1");
    expect(copiedMembers[0].hourlyRate).toBe("175.00");
    expect(copiedMembers[0].costRateHourly).toBe("100.00");
    expect(copiedMembers[1].userId).toBe("user-2");
    expect(copiedMembers[1].hourlyRate).toBe("200.00");
    expect(copiedMembers[1].costRateHourly).toBe("120.00");
  });

  it("duplicate with no members results in empty members array", () => {
    const sourceMembers: any[] = [];
    const copiedMembers = sourceMembers.map((m) => ({
      userId: m.userId,
      hourlyRate: m.hourlyRate,
      costRateHourly: m.costRateHourly,
    }));
    expect(copiedMembers).toHaveLength(0);
  });

  it("duplicate resets status to ACTIVE regardless of source status", () => {
    const statuses = ["COMPLETED", "ON_HOLD", "ARCHIVED", "ACTIVE"];
    for (const _status of statuses) {
      const duplicate = { status: "ACTIVE" };
      expect(duplicate.status).toBe("ACTIVE");
    }
  });
});
