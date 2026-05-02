/**
 * Task #185 — Regression test for brand stats cache invalidation
 * (Task #162 introduced a 30s in-memory TTL on listBrandsByOrg with
 *  invalidation hooks on contact + "sent" activity writes.)
 *
 * Pins three behaviors so a future refactor cannot silently re-introduce
 * stale brand-list stats:
 *   1. createContact invalidates → next listBrandsByOrg shows the new
 *      contactCount without waiting for the TTL.
 *   2. createActivity({type:"email_sent"}) invalidates → next call shows
 *      the new lastSentAt without waiting for the TTL.
 *   3. createActivity({type:"note"}) does NOT invalidate (cache hit
 *      returns the same array reference) and correctness still holds
 *      (contactCount / lastSentAt unchanged on a re-fetched-from-DB call).
 */
process.env.MARKETING_OS_ENABLED = "true";

import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { storage, invalidateBrandStatsCache } from "../../server/storage";
import { db } from "../../server/db";
import {
  brands, marketingProspects, contactActivities, companies,
} from "@shared/schema";
import { inArray } from "drizzle-orm";

const ORG = "c89d120d-1f07-4010-938f-070a0e13b8f2";
const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let brandId: string;
const createdContactIds: string[] = [];

beforeAll(async () => {
  const b = await storage.createBrand({
    orgId: ORG,
    name: `t185 ${RUN}`,
    slug: `t185-${RUN}`,
  });
  brandId = b.id;
});

afterAll(async () => {
  if (createdContactIds.length > 0) {
    await db.delete(contactActivities).where(inArray(contactActivities.prospectId, createdContactIds));
    await db.delete(marketingProspects).where(inArray(marketingProspects.id, createdContactIds));
  }
  if (brandId) {
    await db.delete(companies).where(inArray(companies.brandId, [brandId]));
    await db.delete(brands).where(inArray(brands.id, [brandId]));
  }
  invalidateBrandStatsCache(ORG);
});

function findBrand(rows: Awaited<ReturnType<typeof storage.listBrandsByOrg>>, id: string) {
  const row = rows.find((r) => r.id === id);
  if (!row) throw new Error(`brand ${id} missing from listBrandsByOrg`);
  return row;
}

describe("Task #185 — listBrandsByOrg cache invalidation", () => {
  it("createContact invalidates: next listBrandsByOrg reflects new contactCount immediately", async () => {
    // Seed cache.
    invalidateBrandStatsCache(ORG);
    const before = await storage.listBrandsByOrg(ORG);
    expect(findBrand(before, brandId).contactCount).toBe(0);

    // Confirm a second call hits cache (same reference, no DB round-trip).
    const beforeCached = await storage.listBrandsByOrg(ORG);
    expect(beforeCached).toBe(before);

    const c = await storage.createProspect({
      orgId: ORG, brandId,
      firstName: "Cache", lastName: "Buster",
      email: `t185-c1-${RUN}@x.test`,
    });
    createdContactIds.push(c.id);

    const after = await storage.listBrandsByOrg(ORG);
    // Cache must have been dropped (new array) AND value must be fresh.
    expect(after).not.toBe(before);
    expect(findBrand(after, brandId).contactCount).toBe(1);
  });

  it("createActivity(email_sent) invalidates: next listBrandsByOrg reflects new lastSentAt immediately", async () => {
    // Re-seed cache from the post-contact state.
    const cached = await storage.listBrandsByOrg(ORG);
    expect(findBrand(cached, brandId).lastSentAt).toBeNull();
    const cached2 = await storage.listBrandsByOrg(ORG);
    expect(cached2).toBe(cached);

    await storage.createActivity({
      orgId: ORG, brandId,
      prospectId: createdContactIds[0],
      type: "email_sent",
      payload: {},
    });

    const after = await storage.listBrandsByOrg(ORG);
    expect(after).not.toBe(cached);
    const row = findBrand(after, brandId);
    // SQL max() bubbles up as a Date or an ISO string depending on driver
    // path; either way it must be a valid timestamp (no longer null).
    expect(row.lastSentAt).not.toBeNull();
    expect(Number.isFinite(new Date(row.lastSentAt as Date | string).getTime())).toBe(true);
    expect(row.contactCount).toBe(1);
  });

  it("createActivity(note) does NOT invalidate, and correctness is preserved", async () => {
    // Re-seed cache from the post-email_sent state and capture the truth
    // values so we can compare them to a forced-fresh re-read later.
    const cached = await storage.listBrandsByOrg(ORG);
    const truth = findBrand(cached, brandId);
    const truthLastSentMs = new Date(truth.lastSentAt as Date | string).getTime();
    const truthCount = truth.contactCount;

    // Note activity is NOT in ACTIVITY_TYPES_AFFECTING_LAST_SENT, so the
    // cache must remain valid.
    await storage.createActivity({
      orgId: ORG, brandId,
      prospectId: createdContactIds[0],
      type: "note",
      payload: { body: "regression-test note" },
    });

    // Same reference → cache was NOT dropped by the note write.
    const afterNote = await storage.listBrandsByOrg(ORG);
    expect(afterNote).toBe(cached);

    // Force a fresh DB read and confirm correctness did not regress: the
    // note activity must not have moved contactCount or lastSentAt.
    invalidateBrandStatsCache(ORG);
    const fresh = await storage.listBrandsByOrg(ORG);
    expect(fresh).not.toBe(cached);
    const freshRow = findBrand(fresh, brandId);
    expect(freshRow.contactCount).toBe(truthCount);
    expect(new Date(freshRow.lastSentAt as Date | string).getTime()).toBe(truthLastSentMs);
  });
});
