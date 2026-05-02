import { describe, it, expect } from "vitest";

type Membership = { projectId: string; userId: string; costRateHourly: string | null };
type Entry = {
  id: string;
  projectId: string;
  userId: string;
  costRateSnapshot: string | null;
};

function isEligibleForLegacyBackfill(entry: Entry, memberships: Membership[]): boolean {
  const snapshotMissing =
    entry.costRateSnapshot == null
    || String(entry.costRateSnapshot) === ""
    || Number(entry.costRateSnapshot) === 0;
  if (!snapshotMissing) return false;
  const membershipExists = memberships.some(
    m => m.projectId === entry.projectId && m.userId === entry.userId,
  );
  return !membershipExists;
}

function computeNoDerivableCostRate(
  entries: Entry[],
  memberships: Membership[],
  missingProjectIdsCount: number,
): boolean {
  if (missingProjectIdsCount === 0) return false;
  const userHasAnyRateAnywhere =
    memberships.some(
      m => m.costRateHourly != null
        && String(m.costRateHourly) !== ""
        && Number(m.costRateHourly) > 0,
    )
    || entries.some(
      e => e.costRateSnapshot != null
        && String(e.costRateSnapshot) !== ""
        && Number(e.costRateSnapshot) > 0,
    );
  return !userHasAnyRateAnywhere;
}

describe("legacy cost_rate_snapshot backfill eligibility", () => {
  it("backfills entries whose project_members row was removed", () => {
    const entry: Entry = { id: "te-legacy", projectId: "p1", userId: "u1", costRateSnapshot: null };
    const memberships: Membership[] = [
      { projectId: "p2", userId: "u1", costRateHourly: "75" },
    ];
    expect(isEligibleForLegacyBackfill(entry, memberships)).toBe(true);
  });

  it("does NOT backfill when the project_members row still exists with a null rate", () => {
    const entry: Entry = { id: "te-active", projectId: "p1", userId: "u1", costRateSnapshot: null };
    const memberships: Membership[] = [
      { projectId: "p1", userId: "u1", costRateHourly: null },
    ];
    expect(isEligibleForLegacyBackfill(entry, memberships)).toBe(false);
  });

  it("does NOT backfill when the project_members row exists with a zero rate", () => {
    const entry: Entry = { id: "te-active", projectId: "p1", userId: "u1", costRateSnapshot: null };
    const memberships: Membership[] = [
      { projectId: "p1", userId: "u1", costRateHourly: "0" },
    ];
    expect(isEligibleForLegacyBackfill(entry, memberships)).toBe(false);
  });

  it("skips entries that already have a non-zero snapshot", () => {
    const entry: Entry = { id: "te-snapped", projectId: "p1", userId: "u1", costRateSnapshot: "50" };
    expect(isEligibleForLegacyBackfill(entry, [])).toBe(false);
  });
});

describe("noDerivableCostRate flag", () => {
  it("is true when the user has no rate anywhere and warning fires", () => {
    const entries: Entry[] = [
      { id: "te-1", projectId: "p1", userId: "u1", costRateSnapshot: null },
    ];
    const memberships: Membership[] = [
      { projectId: "p1", userId: "u1", costRateHourly: null },
    ];
    expect(computeNoDerivableCostRate(entries, memberships, 1)).toBe(true);
  });

  it("is false when the user has a prior non-zero snapshot elsewhere", () => {
    const entries: Entry[] = [
      { id: "te-1", projectId: "p1", userId: "u1", costRateSnapshot: null },
      { id: "te-old", projectId: "p2", userId: "u1", costRateSnapshot: "60" },
    ];
    const memberships: Membership[] = [
      { projectId: "p1", userId: "u1", costRateHourly: null },
    ];
    expect(computeNoDerivableCostRate(entries, memberships, 1)).toBe(false);
  });

  it("is false when the user has another project membership with a rate", () => {
    const entries: Entry[] = [
      { id: "te-1", projectId: "p1", userId: "u1", costRateSnapshot: null },
    ];
    const memberships: Membership[] = [
      { projectId: "p1", userId: "u1", costRateHourly: null },
      { projectId: "p2", userId: "u1", costRateHourly: "80" },
    ];
    expect(computeNoDerivableCostRate(entries, memberships, 1)).toBe(false);
  });

  it("is false when no project is missing a rate at all", () => {
    expect(computeNoDerivableCostRate([], [], 0)).toBe(false);
  });
});
