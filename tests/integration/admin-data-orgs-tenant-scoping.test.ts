/**
 * Security regression (audit #5): the generic admin-data API
 * (GET /api/admin/data/orgs[/:id]) resolved the `orgs` entity through
 * adminListEntity/adminGetEntity, which org-scope every table that has an orgId
 * column. `orgs` has none (its PK *is* the org id), so it was returned UNSCOPED —
 * letting any tenant ADMIN read every other tenant's org row (stripeCustomerId,
 * SMTP config, apiKey, billing address, ...). The fix scopes `orgs` to the
 * caller's own org unless they are a platform operator.
 *
 * This exercises the storage scoping directly with two orgs. The route
 * (settings-routes.ts) wires the allowCrossTenantOrgs flag from
 * isPlatformOperatorUserId(session.userId).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.hoisted(() => {
  process.env.BANKING_ENCRYPTION_KEY ||=
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  process.env.SMTP_ENCRYPTION_KEY ||=
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

import { db } from "../../server/db";
import { orgs } from "@shared/schema";
import { inArray } from "drizzle-orm";
import { storage } from "../../server/storage";

const ORG_A = randomUUID(); // the caller's own org
const ORG_B = randomUUID(); // a different tenant

beforeAll(async () => {
  await db.insert(orgs).values([
    { id: ORG_A, name: "Tenant A", slug: `tenant-a-${ORG_A.slice(0, 8)}`, stripeCustomerId: "cus_A_secret" },
    { id: ORG_B, name: "Tenant B", slug: `tenant-b-${ORG_B.slice(0, 8)}`, stripeCustomerId: "cus_B_secret" },
  ]);
});
afterAll(async () => {
  await db.delete(orgs).where(inArray(orgs.id, [ORG_A, ORG_B]));
});

describe("admin-data orgs entity is org-scoped for non-operators (audit #5)", () => {
  it("a non-operator admin's list is scoped to ONLY their own org", async () => {
    const { rows } = await storage.adminListEntity("orgs", ORG_A, "", 200, 0, false);
    const ids = rows.map((r: any) => r.id);
    expect(ids).toContain(ORG_A);
    expect(ids).not.toContain(ORG_B); // no cross-tenant leak
    expect(ids).toEqual([ORG_A]); // and nothing else
  });

  it("a non-operator admin cannot fetch another tenant's org by id", async () => {
    const row = await storage.adminGetEntity("orgs", ORG_B, ORG_A, false);
    expect(row).toBeUndefined();
  });

  it("a non-operator admin CAN fetch their own org by id", async () => {
    const row = await storage.adminGetEntity("orgs", ORG_A, ORG_A, false);
    expect(row?.id).toBe(ORG_A);
  });

  it("a platform operator sees all tenants' orgs (cross-tenant allowed)", async () => {
    const { rows } = await storage.adminListEntity("orgs", ORG_A, "", 200, 0, true);
    const ids = rows.map((r: any) => r.id);
    expect(ids).toContain(ORG_A);
    expect(ids).toContain(ORG_B);

    const row = await storage.adminGetEntity("orgs", ORG_B, ORG_A, true);
    expect(row?.id).toBe(ORG_B);
  });

  it("regression: a real org-scoped entity (users) is unaffected", async () => {
    // users has an orgId column, so it must still be scoped to the caller's org
    // (id-based orgs special-case must not have broken the generic path).
    const { rows } = await storage.adminListEntity("users", ORG_A, "", 50, 0, false);
    expect(rows.every((u: any) => u.orgId === ORG_A)).toBe(true);
  });
});
