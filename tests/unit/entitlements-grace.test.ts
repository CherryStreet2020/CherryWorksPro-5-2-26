import { describe, it, expect } from "vitest";

describe("Sprint 2j — entitlements grace decay (effectiveActive)", () => {
  it("inactive row → false regardless of grace window", async () => {
    const { effectiveActive } = await import("../../server/services/entitlements");
    const now = new Date("2026-04-22T00:00:00Z").getTime();
    const future = new Date("2026-05-01T00:00:00Z");
    expect(effectiveActive(false, null, now)).toBe(false);
    expect(effectiveActive(false, future, now)).toBe(false);
  });

  it("active row with no grace window stays true forever", async () => {
    const { effectiveActive } = await import("../../server/services/entitlements");
    const now = new Date("2026-04-22T00:00:00Z").getTime();
    expect(effectiveActive(true, null, now)).toBe(true);
  });

  it("active row in grace, before expiry → true", async () => {
    const { effectiveActive } = await import("../../server/services/entitlements");
    const now = new Date("2026-04-22T00:00:00Z").getTime();
    const future = new Date("2026-04-25T00:00:00Z");
    expect(effectiveActive(true, future, now)).toBe(true);
  });

  it("active row whose grace window has elapsed → false (lazy-expire trigger)", async () => {
    const { effectiveActive } = await import("../../server/services/entitlements");
    const now = new Date("2026-04-22T00:00:00Z").getTime();
    const past = new Date("2026-04-15T00:00:00Z");
    expect(effectiveActive(true, past, now)).toBe(false);
  });
});
