/**
 * Marketing OS — Sprint 1: brands storage unit tests.
 *
 * Tests the storage methods directly against the dev DB. Uses unique
 * slugs per run (timestamp + random) so re-runs do not collide. All
 * created rows are cleaned up in afterAll. MARKETING_OS_ENABLED is set
 * for the test process so any flag-aware code paths execute.
 *
 * Convention matches server/import-cache.test.ts (flat server/*.test.ts,
 * vitest, no setup files). Differs in that these tests hit the real DB
 * because the goal is to prove tenant-scoping at the SQL layer.
 */
process.env.MARKETING_OS_ENABLED = "true";

import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { storage } from "./storage";
import { db, pool } from "./db";
import { brands } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";

const ORG_A = "c89d120d-1f07-4010-938f-070a0e13b8f2";
const ORG_B = "30cb6705-f98e-44c5-8e2a-fbe3f150a3eb";

const RUN_TAG = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const slugFor = (label: string) => `t-${label}-${RUN_TAG}`;

const createdIds: string[] = [];

beforeAll(async () => {
  // Defensive: clear any prior leftovers from this exact run tag (no-op
  // on a fresh run, useful if a previous test crashed mid-flight).
  await db.delete(brands).where(inArray(brands.slug, [
    slugFor("create"),
    slugFor("isolation"),
    slugFor("update-iso"),
    slugFor("unique"),
    slugFor("delete"),
  ]));
});

afterAll(async () => {
  if (createdIds.length > 0) {
    await db.delete(brands).where(inArray(brands.id, createdIds));
  }
  await pool.end();
});

describe("brands storage — createBrand", () => {
  it("returns row with id, createdAt, updatedAt", async () => {
    const row = await storage.createBrand({
      orgId: ORG_A,
      name: "Test Create",
      slug: slugFor("create"),
    });
    createdIds.push(row.id);
    expect(row.id).toBeTruthy();
    expect(row.orgId).toBe(ORG_A);
    expect(row.name).toBe("Test Create");
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.updatedAt).toBeInstanceOf(Date);
    expect(row.active).toBe(true);
  });
});

describe("brands storage — tenant isolation", () => {
  it("getBrand(id, correctOrg) returns row, getBrand(id, wrongOrg) returns undefined", async () => {
    const row = await storage.createBrand({
      orgId: ORG_A,
      name: "Iso A",
      slug: slugFor("isolation"),
    });
    createdIds.push(row.id);

    const same = await storage.getBrand(row.id, ORG_A);
    expect(same?.id).toBe(row.id);

    const cross = await storage.getBrand(row.id, ORG_B);
    expect(cross).toBeUndefined();
  });

  it("updateBrand(id, wrongOrg, ...) returns undefined and does not mutate", async () => {
    const row = await storage.createBrand({
      orgId: ORG_A,
      name: "Iso Upd",
      slug: slugFor("update-iso"),
    });
    createdIds.push(row.id);

    const wrongUpdate = await storage.updateBrand(row.id, ORG_B, {
      name: "Should Not Apply",
    });
    expect(wrongUpdate).toBeUndefined();

    const stillOriginal = await storage.getBrand(row.id, ORG_A);
    expect(stillOriginal?.name).toBe("Iso Upd");
  });
});

describe("brands storage — unique (orgId, slug) constraint", () => {
  it("second insert with same (orgId, slug) throws", async () => {
    const slug = slugFor("unique");
    const first = await storage.createBrand({
      orgId: ORG_A,
      name: "Unique A",
      slug,
    });
    createdIds.push(first.id);

    await expect(
      storage.createBrand({ orgId: ORG_A, name: "Unique A dup", slug }),
    ).rejects.toThrow();
  });
});

describe("brands storage — softDeleteBrand", () => {
  it("flips active=false and the row is still returned by getBrand", async () => {
    const row = await storage.createBrand({
      orgId: ORG_A,
      name: "Soft Del",
      slug: slugFor("delete"),
    });
    createdIds.push(row.id);
    expect(row.active).toBe(true);

    const deleted = await storage.softDeleteBrand(row.id, ORG_A);
    expect(deleted?.active).toBe(false);

    const fetched = await storage.getBrand(row.id, ORG_A);
    expect(fetched?.id).toBe(row.id);
    expect(fetched?.active).toBe(false);
  });
});
