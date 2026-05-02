/**
 * Marketing OS — Sprint 2d: tag CRUD + bulk + counts storage tests.
 *
 * 7 unit tests, real DB hits, mirrors marketing-contacts.test.ts cleanup
 * convention (RUN_TAG, full afterAll).
 */
process.env.MARKETING_OS_ENABLED = "true";

import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { storage } from "../../server/storage";
import { db, pool } from "../../server/db";
import {
  brands, marketingProspects, contactTags, contactActivities, contactTagAssignments, companies,
} from "@shared/schema";
import { inArray } from "drizzle-orm";

const ORG_A = "c89d120d-1f07-4010-938f-070a0e13b8f2";
const ORG_B = "30cb6705-f98e-44c5-8e2a-fbe3f150a3eb";

const RUN_TAG = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const slugFor = (label: string) => `t2d-${label}-${RUN_TAG}`;

let brandA1: { id: string };
let brandA2: { id: string };
let brandB:  { id: string };
const createdContactIds: string[] = [];
const createdTagIds: string[] = [];
const createdBrandIds: string[] = [];

beforeAll(async () => {
  brandA1 = await storage.createBrand({ orgId: ORG_A, name: `2d-A1 ${RUN_TAG}`, slug: slugFor("a1") });
  brandA2 = await storage.createBrand({ orgId: ORG_A, name: `2d-A2 ${RUN_TAG}`, slug: slugFor("a2") });
  brandB  = await storage.createBrand({ orgId: ORG_B, name: `2d-B  ${RUN_TAG}`, slug: slugFor("b")  });
  createdBrandIds.push(brandA1.id, brandA2.id, brandB.id);
});

afterAll(async () => {
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
    // Companies may have been auto-linked by domain on contact create; clean those first.
    await db.delete(companies).where(inArray(companies.brandId, createdBrandIds));
    await db.delete(brands).where(inArray(brands.id, createdBrandIds));
  }
  await pool.end();
});

describe("Sprint 2d — listTagsByBrandWithCounts", () => {
  it("returns contactCount and lastUsedAt computed via LEFT JOIN", async () => {
    const tag = await storage.createTag({ orgId: ORG_A, brandId: brandA1.id, name: `vip-${RUN_TAG}`, color: "#C41E3A" });
    createdTagIds.push(tag.id);
    const c1 = await storage.createProspect({ orgId: ORG_A, brandId: brandA1.id, firstName: "C1", lastName: "T", email: `c1-${RUN_TAG}@x.com` });
    const c2 = await storage.createProspect({ orgId: ORG_A, brandId: brandA1.id, firstName: "C2", lastName: "T", email: `c2-${RUN_TAG}@x.com` });
    createdContactIds.push(c1.id, c2.id);
    await storage.addTagsToContacts(ORG_A, brandA1.id, [c1.id, c2.id], [tag.id]);
    const rows = await storage.listTagsByBrandWithCounts(ORG_A, brandA1.id);
    const found = rows.find((r) => r.id === tag.id);
    expect(found).toBeDefined();
    expect(found!.contactCount).toBe(2);
    expect(found!.lastUsedAt).toBeInstanceOf(Date);
  });

  it("excludes soft-deleted contacts from contactCount", async () => {
    const tag = await storage.createTag({ orgId: ORG_A, brandId: brandA1.id, name: `softd-${RUN_TAG}`, color: "#15803D" });
    createdTagIds.push(tag.id);
    const c1 = await storage.createProspect({ orgId: ORG_A, brandId: brandA1.id, firstName: "Live", lastName: "T", email: `live-${RUN_TAG}@x.com` });
    const c2 = await storage.createProspect({ orgId: ORG_A, brandId: brandA1.id, firstName: "Gone", lastName: "T", email: `gone-${RUN_TAG}@x.com` });
    createdContactIds.push(c1.id, c2.id);
    await storage.addTagsToContacts(ORG_A, brandA1.id, [c1.id, c2.id], [tag.id]);
    await storage.softDeleteProspect(c2.id, ORG_A);
    const rows = await storage.listTagsByBrandWithCounts(ORG_A, brandA1.id);
    const found = rows.find((r) => r.id === tag.id);
    expect(found!.contactCount).toBe(1);
  });

  it("returns 0 / null for an unused tag", async () => {
    const tag = await storage.createTag({ orgId: ORG_A, brandId: brandA1.id, name: `unused-${RUN_TAG}`, color: "#475569" });
    createdTagIds.push(tag.id);
    const rows = await storage.listTagsByBrandWithCounts(ORG_A, brandA1.id);
    const found = rows.find((r) => r.id === tag.id);
    expect(found!.contactCount).toBe(0);
    expect(found!.lastUsedAt).toBeNull();
  });
});

describe("Sprint 2d — findInvalidTagIds / findInvalidContactIds", () => {
  it("flags cross-brand tagIds and accepts in-brand ones", async () => {
    const ok    = await storage.createTag({ orgId: ORG_A, brandId: brandA1.id, name: `ok-${RUN_TAG}`,    color: "#1D4ED8" });
    const wrong = await storage.createTag({ orgId: ORG_A, brandId: brandA2.id, name: `wrong-${RUN_TAG}`, color: "#1D4ED8" });
    createdTagIds.push(ok.id, wrong.id);
    const invalid = await storage.findInvalidTagIds(ORG_A, brandA1.id, [ok.id, wrong.id]);
    expect(invalid).toEqual([wrong.id]);
    const allOk = await storage.findInvalidTagIds(ORG_A, brandA1.id, [ok.id]);
    expect(allOk).toEqual([]);
  });

  it("flags cross-org tagIds (different org entirely)", async () => {
    const otherOrgTag = await storage.createTag({ orgId: ORG_B, brandId: brandB.id, name: `xorg-${RUN_TAG}`, color: "#A21CAF" });
    createdTagIds.push(otherOrgTag.id);
    const invalid = await storage.findInvalidTagIds(ORG_A, brandA1.id, [otherOrgTag.id]);
    expect(invalid).toEqual([otherOrgTag.id]);
  });
});

describe("Sprint 2d — removeTagsFromContacts", () => {
  it("deletes only matching (contact, tag) pairs and is idempotent", async () => {
    const tag = await storage.createTag({ orgId: ORG_A, brandId: brandA1.id, name: `rm-${RUN_TAG}`, color: "#6D28D9" });
    createdTagIds.push(tag.id);
    const c = await storage.createProspect({ orgId: ORG_A, brandId: brandA1.id, firstName: "RM", lastName: "T", email: `rm-${RUN_TAG}@x.com` });
    createdContactIds.push(c.id);
    await storage.addTagsToContacts(ORG_A, brandA1.id, [c.id], [tag.id]);
    const removed = await storage.removeTagsFromContacts(ORG_A, brandA1.id, [c.id], [tag.id]);
    expect(removed).toBe(1);
    // second call → no-op (idempotent)
    const again = await storage.removeTagsFromContacts(ORG_A, brandA1.id, [c.id], [tag.id]);
    expect(again).toBe(0);
  });

  it("rejects cross-brand tagIds via thrown error (no rows touched)", async () => {
    const tag = await storage.createTag({ orgId: ORG_A, brandId: brandA2.id, name: `xb-${RUN_TAG}`, color: "#0F766E" });
    createdTagIds.push(tag.id);
    const c = await storage.createProspect({ orgId: ORG_A, brandId: brandA1.id, firstName: "XB", lastName: "T", email: `xb-${RUN_TAG}@x.com` });
    createdContactIds.push(c.id);
    await expect(
      storage.removeTagsFromContacts(ORG_A, brandA1.id, [c.id], [tag.id]),
    ).rejects.toThrow(/Invalid tag/);
  });
});

describe("Sprint 2d — addTagsToContacts is idempotent (single-add semantics)", () => {
  it("adding the same tag twice does not duplicate the assignment row", async () => {
    const tag = await storage.createTag({ orgId: ORG_A, brandId: brandA1.id, name: `idem-${RUN_TAG}`, color: "#B45309" });
    createdTagIds.push(tag.id);
    const c = await storage.createProspect({ orgId: ORG_A, brandId: brandA1.id, firstName: "Idem", lastName: "T", email: `idem-${RUN_TAG}@x.com` });
    createdContactIds.push(c.id);
    await storage.addTagsToContacts(ORG_A, brandA1.id, [c.id], [tag.id]);
    await storage.addTagsToContacts(ORG_A, brandA1.id, [c.id], [tag.id]);
    const rows = await db
      .select({ id: contactTagAssignments.contactId })
      .from(contactTagAssignments)
      .where(inArray(contactTagAssignments.tagId, [tag.id]));
    expect(rows.length).toBe(1);
  });
});
