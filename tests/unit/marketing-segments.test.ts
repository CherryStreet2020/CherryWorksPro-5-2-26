/**
 * Marketing OS — Sprint 2e: contact_segments storage + cleanup-cascade tests.
 *
 * Real-DB unit tests covering:
 *   1. createSegment/getSegment/listSegmentsByBrand round-trip
 *   2. listSegmentsByBrandWithCounts uses computed-on-read AND-intersect
 *   3. resolveSegmentContacts honours pagination + AND-intersection
 *   4. updateSegment renames; deleteSegment removes the row
 *   5. cleanupE2EBrandPollution cascade DELETES contact_segments rows and
 *      reports contactSegmentsDeleted in the result
 */
process.env.MARKETING_OS_ENABLED = "true";

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { storage } from "../../server/storage";
import { db, pool } from "../../server/db";
import {
  brands, marketingProspects, contactTags, contactActivities, contactSegments,
  contactTagAssignments, companies,
} from "@shared/schema";
import { inArray } from "drizzle-orm";
import { cleanupE2EBrandPollution } from "../../scripts/cleanup-e2e-brand-pollution";

const ORG_A = "c89d120d-1f07-4010-938f-070a0e13b8f2";

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const slugFor = (label: string) => `s2e-${label}-${RUN}`;

let brandA: { id: string };
let brandCascade: { id: string };
const createdContactIds: string[] = [];
const createdTagIds: string[] = [];
const createdSegmentIds: string[] = [];
const createdBrandIds: string[] = [];

beforeAll(async () => {
  brandA = await storage.createBrand({ orgId: ORG_A, name: `2e-A ${RUN}`, slug: slugFor("a") });
  // Second brand is used ONLY for the cascade test — it gets passed straight
  // into cleanupE2EBrandPollution and dropped, so we do NOT push it onto
  // createdBrandIds (afterAll would otherwise try to delete it twice).
  brandCascade = await storage.createBrand({ orgId: ORG_A, name: `2e-X ${RUN}`, slug: slugFor("x") });
  createdBrandIds.push(brandA.id);
});

afterAll(async () => {
  if (createdSegmentIds.length > 0) {
    await db.delete(contactSegments).where(inArray(contactSegments.id, createdSegmentIds));
  }
  if (createdContactIds.length > 0) {
    await db.delete(contactActivities).where(inArray(contactActivities.prospectId, createdContactIds));
    await db.delete(contactTagAssignments).where(inArray(contactTagAssignments.prospectId, createdContactIds));
    await db.delete(marketingProspects).where(inArray(marketingProspects.id, createdContactIds));
  }
  if (createdTagIds.length > 0) {
    await db.delete(contactTagAssignments).where(inArray(contactTagAssignments.tagId, createdTagIds));
    await db.delete(contactTags).where(inArray(contactTags.id, createdTagIds));
  }
  if (createdBrandIds.length > 0) {
    await db.delete(companies).where(inArray(companies.brandId, createdBrandIds));
    await db.delete(brands).where(inArray(brands.id, createdBrandIds));
  }
  await pool.end();
});

describe("Sprint 2e — segment storage", () => {
  it("CRUD round-trip + listSegmentsByBrandWithCounts uses AND-intersect", async () => {
    const vip = await storage.createTag({
      orgId: ORG_A, brandId: brandA.id, name: `vip-${RUN}`, color: "#C41E3A",
    });
    createdTagIds.push(vip.id);
    const buyer = await storage.createTag({
      orgId: ORG_A, brandId: brandA.id, name: `buyer-${RUN}`, color: "#1D4ED8",
    });
    createdTagIds.push(buyer.id);

    const c1 = await storage.createProspect({
      orgId: ORG_A, brandId: brandA.id, firstName: "C1", lastName: "Seg",
      email: `seg-c1-${RUN}@x.com`,
    });
    createdContactIds.push(c1.id);
    const c2 = await storage.createProspect({
      orgId: ORG_A, brandId: brandA.id, firstName: "C2", lastName: "Seg",
      email: `seg-c2-${RUN}@x.com`,
    });
    createdContactIds.push(c2.id);

    // VIP → both, Buyer → c1 only.
    await storage.bulkAssignTagsAtomic(ORG_A, brandA.id, [c1.id, c2.id], [vip.id]);
    await storage.bulkAssignTagsAtomic(ORG_A, brandA.id, [c1.id], [buyer.id]);

    const seg = await storage.createSegment({
      orgId: ORG_A, brandId: brandA.id, name: `seg-vip-buyer-${RUN}`,
      filter: { tagIds: [vip.id, buyer.id], search: "" },
    });
    createdSegmentIds.push(seg.id);

    const single = await storage.getSegment(seg.id, ORG_A);
    expect(single).toBeDefined();
    expect(single!.name).toBe(`seg-vip-buyer-${RUN}`);

    const list = await storage.listSegmentsByBrand(ORG_A, brandA.id);
    expect(list.find((s) => s.id === seg.id)).toBeDefined();

    const withCounts = await storage.listSegmentsByBrandWithCounts(ORG_A, brandA.id);
    const row = withCounts.find((s) => s.id === seg.id);
    expect(row).toBeDefined();
    // AND-intersection: only c1 has BOTH vip and buyer.
    expect(row!.contactCount).toBe(1);
  });

  it("resolveSegmentContacts honours pagination + AND-intersection", async () => {
    const seg = createdSegmentIds[0];
    const stored = await storage.getSegment(seg, ORG_A);
    expect(stored).toBeDefined();
    const filter = stored!.filter as { tagIds: string[]; search: string };

    const all = await storage.resolveSegmentProspects(
      ORG_A, stored!.brandId, filter, { limit: 50, offset: 0 },
    );
    expect(all.length).toBe(1);

    const lim0 = await storage.resolveSegmentProspects(
      ORG_A, stored!.brandId, filter, { limit: 1, offset: 0 },
    );
    expect(lim0.length).toBe(1);
    const lim1 = await storage.resolveSegmentProspects(
      ORG_A, stored!.brandId, filter, { limit: 1, offset: 1 },
    );
    expect(lim1.length).toBe(0);
  });

  it("updateSegment renames; deleteSegment removes the row", async () => {
    const seg = await storage.createSegment({
      orgId: ORG_A, brandId: brandA.id, name: `temp-${RUN}`,
      filter: { tagIds: [], search: "" },
    });
    createdSegmentIds.push(seg.id);

    const renamed = await storage.updateSegment(seg.id, ORG_A, { name: `temp-renamed-${RUN}` });
    expect(renamed).toBeDefined();
    expect(renamed!.name).toBe(`temp-renamed-${RUN}`);

    const ok = await storage.deleteSegment(seg.id, ORG_A);
    expect(ok).toBe(true);
    // Pop so afterAll doesn't try to delete it again.
    createdSegmentIds.pop();

    const gone = await storage.getSegment(seg.id, ORG_A);
    expect(gone).toBeUndefined();
  });

  it("cleanupE2EBrandPollution cascade deletes contact_segments + reports count", async () => {
    // Create a segment under brandCascade and immediately wipe the brand.
    const seg = await storage.createSegment({
      orgId: ORG_A, brandId: brandCascade.id, name: `cascade-${RUN}`,
      filter: { tagIds: [], search: "" },
    });

    const counts = await cleanupE2EBrandPollution([brandCascade.id]);
    expect(counts.contactSegmentsDeleted).toBeGreaterThanOrEqual(1);
    expect(counts.brandsDeleted).toBe(1);

    const after = await storage.getSegment(seg.id, ORG_A);
    expect(after).toBeUndefined();
  });
});
