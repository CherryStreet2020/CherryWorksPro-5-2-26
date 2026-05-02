/**
 * Task #197 — Regression test: brand stats cache must not leak across orgs.
 *
 * Task #185 pinned cache invalidation behavior for a single org. This test
 * pins the cross-org isolation contract:
 *   1. Warming org A's cache and then mutating contacts in org A must NOT
 *      affect org B's cached entry — org B's next listBrandsByOrg call
 *      still returns its own (untouched, cached) array reference.
 *   2. After org A is mutated, org A's next call reflects the new count.
 *   3. invalidateBrandStatsCache(orgA) must NOT drop org B's cache entry —
 *      a subsequent listBrandsByOrg(orgB) still returns the same cached
 *      array reference it returned before the targeted invalidation.
 *
 * A future refactor that accidentally widens the cache key (shared map,
 * missing orgId on invalidation, global flush, etc.) will fail this test.
 */
process.env.MARKETING_OS_ENABLED = "true";

import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { randomUUID } from "crypto";
import { storage, invalidateBrandStatsCache } from "../../server/storage";
import { db } from "../../server/db";
import {
  orgs, brands, clientContacts, contactActivities, companies,
} from "@shared/schema";
import { inArray } from "drizzle-orm";

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ORG_A = randomUUID();
const ORG_B = randomUUID();

let brandAId: string;
let brandBId: string;
const createdContactIds: string[] = [];

beforeAll(async () => {
  await db.insert(orgs).values([
    { id: ORG_A, name: `t197-A ${RUN}`, slug: `t197-a-${RUN}` },
    { id: ORG_B, name: `t197-B ${RUN}`, slug: `t197-b-${RUN}` },
  ]);

  const a = await storage.createBrand({
    orgId: ORG_A, name: `t197-A ${RUN}`, slug: `t197-a-${RUN}`,
  });
  brandAId = a.id;

  const b = await storage.createBrand({
    orgId: ORG_B, name: `t197-B ${RUN}`, slug: `t197-b-${RUN}`,
  });
  brandBId = b.id;
});

afterAll(async () => {
  if (createdContactIds.length > 0) {
    await db.delete(contactActivities).where(inArray(contactActivities.contactId, createdContactIds));
    await db.delete(clientContacts).where(inArray(clientContacts.id, createdContactIds));
  }
  const brandIds = [brandAId, brandBId].filter(Boolean);
  if (brandIds.length > 0) {
    await db.delete(companies).where(inArray(companies.brandId, brandIds));
    await db.delete(brands).where(inArray(brands.id, brandIds));
  }
  await db.delete(orgs).where(inArray(orgs.id, [ORG_A, ORG_B]));
  invalidateBrandStatsCache(ORG_A);
  invalidateBrandStatsCache(ORG_B);
});

function findBrand(rows: Awaited<ReturnType<typeof storage.listBrandsByOrg>>, id: string) {
  const row = rows.find((r) => r.id === id);
  if (!row) throw new Error(`brand ${id} missing from listBrandsByOrg`);
  return row;
}

describe("Task #197 — listBrandsByOrg cache is per-org and does not leak", () => {
  it("mutating org A's contacts does not invalidate or alter org B's cached entry", async () => {
    invalidateBrandStatsCache(ORG_A);
    invalidateBrandStatsCache(ORG_B);

    // Warm both org caches.
    const aWarm = await storage.listBrandsByOrg(ORG_A);
    const bWarm = await storage.listBrandsByOrg(ORG_B);
    expect(findBrand(aWarm, brandAId).contactCount).toBe(0);
    expect(findBrand(bWarm, brandBId).contactCount).toBe(0);

    // Confirm both are cache hits (same array reference on a second call).
    expect(await storage.listBrandsByOrg(ORG_A)).toBe(aWarm);
    expect(await storage.listBrandsByOrg(ORG_B)).toBe(bWarm);

    // Mutate ONLY org A.
    const c = await storage.createContact({
      orgId: ORG_A, brandId: brandAId,
      firstName: "Cross", lastName: "Org",
      email: `t197-${RUN}@x.test`,
    });
    createdContactIds.push(c.id);

    // Org A's cache must have been invalidated and the next read must
    // reflect the new contact.
    const aAfter = await storage.listBrandsByOrg(ORG_A);
    expect(aAfter).not.toBe(aWarm);
    expect(findBrand(aAfter, brandAId).contactCount).toBe(1);

    // Org B's cache must be untouched: same reference as before.
    const bAfter = await storage.listBrandsByOrg(ORG_B);
    expect(bAfter).toBe(bWarm);
    expect(findBrand(bAfter, brandBId).contactCount).toBe(0);
  });

  it("invalidateBrandStatsCache(orgA) does not drop org B's cache entry", async () => {
    // Re-warm both so we have known cached references for each org.
    invalidateBrandStatsCache(ORG_A);
    invalidateBrandStatsCache(ORG_B);
    const aWarm = await storage.listBrandsByOrg(ORG_A);
    const bWarm = await storage.listBrandsByOrg(ORG_B);
    expect(await storage.listBrandsByOrg(ORG_A)).toBe(aWarm);
    expect(await storage.listBrandsByOrg(ORG_B)).toBe(bWarm);

    // Targeted invalidation of org A only.
    invalidateBrandStatsCache(ORG_A);

    // Org A must miss (new array), org B must still hit (same reference).
    const aAfter = await storage.listBrandsByOrg(ORG_A);
    const bAfter = await storage.listBrandsByOrg(ORG_B);
    expect(aAfter).not.toBe(aWarm);
    expect(bAfter).toBe(bWarm);
  });
});
