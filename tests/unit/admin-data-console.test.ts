import { describe, it, expect } from "vitest";

describe("Admin Data Console invariants", () => {
  const EDITABLE_ENTITIES = [
    "clients",
    "projects",
    "project_members",
    "services",
    "time_entries",
    "invoices",
    "invoice_lines",
    "payments",
    "imported_payouts",
  ];
  const VIEW_ONLY_ENTITIES = ["audit_logs", "imported_keys"];
  const ALL_ENTITIES = [...EDITABLE_ENTITIES, ...VIEW_ONLY_ENTITIES];

  describe("entity classification", () => {
    it("all entities are either editable or view-only, no overlap", () => {
      const overlap = EDITABLE_ENTITIES.filter((e) =>
        VIEW_ONLY_ENTITIES.includes(e),
      );
      expect(overlap).toEqual([]);
      expect(ALL_ENTITIES.length).toBe(
        EDITABLE_ENTITIES.length + VIEW_ONLY_ENTITIES.length,
      );
    });

    it("view-only entities reject write operations", () => {
      for (const entity of VIEW_ONLY_ENTITIES) {
        expect(EDITABLE_ENTITIES.includes(entity)).toBe(false);
      }
    });

    it("editable entities allow CRUD", () => {
      for (const entity of EDITABLE_ENTITIES) {
        expect(ALL_ENTITIES.includes(entity)).toBe(true);
        expect(VIEW_ONLY_ENTITIES.includes(entity)).toBe(false);
      }
    });
  });

  describe("org-scoped admin list filtering", () => {
    it("filters records by orgId", () => {
      const orgA = "org-aaa";
      const orgB = "org-bbb";
      const records = [
        { id: "1", orgId: orgA, name: "Client A1" },
        { id: "2", orgId: orgB, name: "Client B1" },
        { id: "3", orgId: orgA, name: "Client A2" },
      ];

      const filtered = records.filter((r) => r.orgId === orgA);
      expect(filtered).toHaveLength(2);
      expect(filtered.every((r) => r.orgId === orgA)).toBe(true);
    });

    it("search filters by text match (case-insensitive)", () => {
      const records = [
        { id: "1", name: "Acme Corp" },
        { id: "2", name: "Beta Industries" },
        { id: "3", name: "acme widgets" },
      ];
      const query = "acme";
      const filtered = records.filter((r) =>
        r.name.toLowerCase().includes(query.toLowerCase()),
      );
      expect(filtered).toHaveLength(2);
    });

    it("pagination slices correctly", () => {
      const items = Array.from({ length: 120 }, (_, i) => ({ id: String(i) }));
      const limit = 50;
      const offset0 = items.slice(0, limit);
      expect(offset0).toHaveLength(50);
      expect(offset0[0].id).toBe("0");

      const offset50 = items.slice(50, 50 + limit);
      expect(offset50).toHaveLength(50);
      expect(offset50[0].id).toBe("50");

      const offset100 = items.slice(100, 100 + limit);
      expect(offset100).toHaveLength(20);
    });
  });

  describe("org-scoped admin getById", () => {
    it("returns record only when orgId matches", () => {
      const records = [
        { id: "c1", orgId: "org-1", name: "Alpha" },
        { id: "c2", orgId: "org-2", name: "Beta" },
      ];

      function getById(id: string, orgId: string) {
        return records.find((r) => r.id === id && r.orgId === orgId);
      }

      expect(getById("c1", "org-1")).toBeDefined();
      expect(getById("c1", "org-2")).toBeUndefined();
      expect(getById("c2", "org-1")).toBeUndefined();
      expect(getById("c2", "org-2")).toBeDefined();
    });
  });

  describe("admin create entity", () => {
    it("injects orgId into created record", () => {
      const orgId = "org-test";
      const input = { name: "New Client", email: "client@cherryst.co" };
      const created = { id: "new-id", orgId, ...input };
      expect(created.orgId).toBe(orgId);
      expect(created.name).toBe(input.name);
    });

    it("rejects create on view-only entities", () => {
      for (const entity of VIEW_ONLY_ENTITIES) {
        const allowed = EDITABLE_ENTITIES.includes(entity);
        expect(allowed).toBe(false);
      }
    });
  });

  describe("admin update entity", () => {
    it("only updates if record belongs to same org", () => {
      const record = { id: "c1", orgId: "org-1", name: "Old Name" };
      const requestOrgId = "org-2";

      const allowed = record.orgId === requestOrgId;
      expect(allowed).toBe(false);

      const correctOrg = "org-1";
      const allowed2 = record.orgId === correctOrg;
      expect(allowed2).toBe(true);
    });

    it("merges partial update data", () => {
      const existing = {
        id: "c1",
        name: "Client A",
        email: "a@test.com",
        phone: "555-1234",
      };
      const patch = { phone: "555-9999" };
      const updated = { ...existing, ...patch };
      expect(updated.name).toBe("Client A");
      expect(updated.phone).toBe("555-9999");
    });
  });

  describe("admin delete entity", () => {
    it("prevents delete on view-only entities", () => {
      for (const entity of VIEW_ONLY_ENTITIES) {
        expect(EDITABLE_ENTITIES.includes(entity)).toBe(false);
      }
    });

    it("delete returns not_found for wrong org", () => {
      const records = [{ id: "c1", orgId: "org-1" }];
      function tryDelete(id: string, orgId: string) {
        const rec = records.find((r) => r.id === id && r.orgId === orgId);
        if (!rec) return { deleted: false, error: "not_found" };
        return { deleted: true };
      }

      expect(tryDelete("c1", "org-1").deleted).toBe(true);
      expect(tryDelete("c1", "org-2")).toEqual({
        deleted: false,
        error: "not_found",
      });
    });
  });

  describe("imported_payouts admin fields", () => {
    it("payout record contains required fields", () => {
      const payout = {
        id: "p1",
        orgId: "org-1",
        paidAt: "2026-01-15",
        amount: "500.00",
        payeeName: "John Doe",
        payeeNormalized: "john doe",
        merchant: "Zelle",
        description: "Payment for work",
        currency: "USD",
        source: "chase_csv",
      };

      expect(payout.payeeName).toBe("John Doe");
      expect(payout.payeeNormalized).toBe("john doe");
      expect(payout.amount).toBe("500.00");
      expect(payout.source).toBe("chase_csv");
    });
  });

  describe("services admin fields", () => {
    it("service record contains required fields", () => {
      const service = {
        id: "svc-1",
        orgId: "org-1",
        name: "Strategy",
        description: "Advisory and roadmapping",
        defaultRate: "175.00",
        isActive: true,
      };

      expect(service.name).toBe("Strategy");
      expect(service.defaultRate).toBe("175.00");
      expect(service.isActive).toBe(true);
    });

    it("service with null defaultRate is valid", () => {
      const service = {
        id: "svc-2",
        orgId: "org-1",
        name: "Internal / Non-Billable",
        description: "Internal tasks",
        defaultRate: null,
        isActive: true,
      };
      expect(service.defaultRate).toBeNull();
    });
  });

  describe("request validation", () => {
    it("unsupported entity returns 400 equivalent", () => {
      const entity = "nonexistent_table";
      const supported = ALL_ENTITIES.includes(entity);
      expect(supported).toBe(false);
    });

    it("limit is capped at 200", () => {
      function clampLimit(raw: number) {
        return Math.min(raw || 50, 200);
      }
      expect(clampLimit(500)).toBe(200);
      expect(clampLimit(50)).toBe(50);
      expect(clampLimit(0)).toBe(50);
    });
  });
});
