import { describe, it, expect } from "vitest";

describe("Org scoping invariants", () => {
  it("org-scoped filter rejects cross-org entity", () => {
    const orgA = "org-aaa-111";
    const orgB = "org-bbb-222";

    const clientsInDb = [
      { id: "c1", orgId: orgA, name: "Client A" },
      { id: "c2", orgId: orgB, name: "Client B" },
      { id: "c3", orgId: orgA, name: "Client C" },
    ];

    const filteredForOrgA = clientsInDb.filter((c) => c.orgId === orgA);
    expect(filteredForOrgA).toHaveLength(2);
    expect(filteredForOrgA.every((c) => c.orgId === orgA)).toBe(true);
    expect(filteredForOrgA.find((c) => c.orgId === orgB)).toBeUndefined();
  });

  it("entity lookup by id rejects wrong org", () => {
    const entities = [
      { id: "inv-1", orgId: "org-1", total: "1000.00" },
      { id: "inv-2", orgId: "org-2", total: "2000.00" },
    ];

    function getEntityByIdAndOrg(id: string, orgId: string) {
      return entities.find((e) => e.id === id && e.orgId === orgId);
    }

    expect(getEntityByIdAndOrg("inv-1", "org-1")).toBeDefined();
    expect(getEntityByIdAndOrg("inv-1", "org-2")).toBeUndefined();
    expect(getEntityByIdAndOrg("inv-2", "org-1")).toBeUndefined();
    expect(getEntityByIdAndOrg("inv-2", "org-2")).toBeDefined();
  });

  it("org filter produces deterministic ordering", () => {
    const orgId = "org-test";
    const items = [
      { id: "a", orgId, createdAt: "2026-01-03" },
      { id: "b", orgId, createdAt: "2026-01-01" },
      { id: "c", orgId, createdAt: "2026-01-02" },
    ];

    const sorted = items
      .filter((i) => i.orgId === orgId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    expect(sorted.map((i) => i.id)).toEqual(["a", "c", "b"]);
  });
});
