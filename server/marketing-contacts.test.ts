/**
 * Marketing OS — Sprint 2a: contacts foundation storage tests.
 *
 * Sprint 2o.0 5b1c — shape-migrated from clientContacts (PSO) to
 * marketingProspects. Method renames: createContact→createProspect,
 * updateContact→updateProspect, getContact→getProspect,
 * softDeleteContact→softDeleteProspect. PSO-only assertions
 * (leadStatus, bulkUpdateContacts, contact_created auto-emit) were
 * dropped per the 5b1c migration rules — see the migration report.
 *
 * MARKETING_OS_ENABLED is set so any flag-aware paths execute.
 */
process.env.MARKETING_OS_ENABLED = "true";

import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { storage } from "./storage";
import { db, pool } from "./db";
import {
  brands, marketingProspects, contactTags, contactActivities, contactTagAssignments,
  companies,
} from "@shared/schema";
import { inArray } from "drizzle-orm";

const ORG_A = "c89d120d-1f07-4010-938f-070a0e13b8f2";
const ORG_B = "30cb6705-f98e-44c5-8e2a-fbe3f150a3eb";

const RUN_TAG = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const slugFor = (label: string) => `t2a-${label}-${RUN_TAG}`;

let brandA: { id: string };
let brandB: { id: string };
const createdContactIds: string[] = [];
const createdTagIds: string[] = [];
const createdBrandIds: string[] = [];

beforeAll(async () => {
  brandA = await storage.createBrand({ orgId: ORG_A, name: `BrandA ${RUN_TAG}`, slug: slugFor("ba") });
  brandB = await storage.createBrand({ orgId: ORG_B, name: `BrandB ${RUN_TAG}`, slug: slugFor("bb") });
  createdBrandIds.push(brandA.id, brandB.id);
});

afterAll(async () => {
  // Activities + tag assignments cascade on prospect delete; clean explicitly anyway.
  if (createdContactIds.length > 0) {
    await db.delete(contactActivities).where(inArray(contactActivities.prospectId, createdContactIds));
    await db.delete(contactTagAssignments).where(inArray(contactTagAssignments.prospectId, createdContactIds));
    await db.delete(marketingProspects).where(inArray(marketingProspects.id, createdContactIds));
  }
  if (createdTagIds.length > 0) {
    await db.delete(contactTags).where(inArray(contactTags.id, createdTagIds));
  }
  if (createdBrandIds.length > 0) {
    // Sprint 2b's maybeAutoLinkContactCompany may have inserted rows into
    // `companies` keyed to these brands. The brands FK is restrict, so we
    // must clear company rows for these brands before dropping the brand.
    await db.delete(companies).where(inArray(companies.brandId, createdBrandIds));
    await db.delete(brands).where(inArray(brands.id, createdBrandIds));
  }
  await pool.end();
});

describe("prospects storage — createProspect / getProspect", () => {
  it("creates a prospect and reads it back with tags=[] via getProspectWithTags", async () => {
    const c = await storage.createProspect({
      orgId: ORG_A,
      brandId: brandA.id,
      firstName: "Alice",
      lastName: "Smith",
      email: `alice-${RUN_TAG}@example.com`,
    });
    createdContactIds.push(c.id);
    expect(c.id).toBeTruthy();
    expect(c.lifecycleStage).toBe("lead"); // marketing schema default
    expect(c.leadScore).toBe(0); // marketing default; PSO leadStatus="new" dropped
    expect(c.deletedAt).toBeNull();

    const got = await storage.getProspect(c.id, ORG_A);
    expect(got?.id).toBe(c.id);
    const withTags = await storage.getProspectWithTags(c.id, ORG_A);
    expect(withTags?.tags).toEqual([]);
  });
});

describe("prospects storage — tenant isolation", () => {
  it("getProspect returns undefined when queried with the wrong orgId", async () => {
    const c = await storage.createProspect({
      orgId: ORG_A,
      brandId: brandA.id,
      firstName: "Iso",
      lastName: "Lated",
    });
    createdContactIds.push(c.id);
    const wrong = await storage.getProspect(c.id, ORG_B);
    expect(wrong).toBeUndefined();
  });

  it("listProspectsByOrg never returns prospects from a different org", async () => {
    const inA = await storage.createProspect({
      orgId: ORG_A, brandId: brandA.id, firstName: "AOnly", lastName: RUN_TAG,
    });
    const inB = await storage.createProspect({
      orgId: ORG_B, brandId: brandB.id, firstName: "BOnly", lastName: RUN_TAG,
    });
    createdContactIds.push(inA.id, inB.id);

    const aRows = await storage.listProspectsByOrg(ORG_A, { brandId: brandA.id, search: RUN_TAG });
    const bRows = await storage.listProspectsByOrg(ORG_B, { brandId: brandB.id, search: RUN_TAG });

    expect(aRows.some((r) => r.id === inA.id)).toBe(true);
    expect(aRows.some((r) => r.id === inB.id)).toBe(false);
    expect(bRows.some((r) => r.id === inB.id)).toBe(true);
    expect(bRows.some((r) => r.id === inA.id)).toBe(false);
  });
});

describe("prospects storage — updateProspect", () => {
  it("updates fields and refuses cross-tenant writes", async () => {
    const c = await storage.createProspect({
      orgId: ORG_A, brandId: brandA.id, firstName: "U", lastName: "P",
    });
    createdContactIds.push(c.id);
    const ok = await storage.updateProspect(c.id, ORG_A, { lifecycleStage: "mql" });
    expect(ok?.lifecycleStage).toBe("mql");

    const cross = await storage.updateProspect(c.id, ORG_B, { lifecycleStage: "lost" });
    expect(cross).toBeUndefined();

    // Original org row was NOT mutated by the cross-tenant attempt
    const reread = await storage.getProspect(c.id, ORG_A);
    expect(reread?.lifecycleStage).toBe("mql");
  });
});

describe("prospects storage — softDeleteProspect", () => {
  it("sets deleted_at and excludes from default list", async () => {
    const c = await storage.createProspect({
      orgId: ORG_A, brandId: brandA.id, firstName: "Soft", lastName: RUN_TAG,
    });
    createdContactIds.push(c.id);
    await storage.softDeleteProspect(c.id, ORG_A);

    // Search by RUN_TAG matches the lastName column via ILIKE.
    const list = await storage.listProspectsByOrg(ORG_A, { brandId: brandA.id, search: RUN_TAG });
    expect(list.some((r) => r.id === c.id)).toBe(false);

    const onlyDel = await storage.listProspectsByOrg(ORG_A, { brandId: brandA.id, search: RUN_TAG, includeDeleted: true });
    expect(onlyDel.some((r) => r.id === c.id)).toBe(true);
  });
});

// dropped: PSO-only bulkUpdateContacts semantics (leadStatus assertions);
// no marketing-side bulkUpdateProspects helper exists. See 5b1c report.

describe("tags storage — createTag / listTagsByBrand / deleteTag / setContactTags", () => {
  it("creates a brand-scoped tag and lists it", async () => {
    const t = await storage.createTag({
      orgId: ORG_A, brandId: brandA.id, name: `VIP-${RUN_TAG}`,
    });
    createdTagIds.push(t.id);
    const list = await storage.listTagsByBrand(ORG_A, brandA.id);
    expect(list.some((r) => r.id === t.id)).toBe(true);
  });

  it("setContactTags replaces the full tag set in a transaction", async () => {
    const c = await storage.createProspect({ orgId: ORG_A, brandId: brandA.id, firstName: "Tagged", lastName: RUN_TAG });
    createdContactIds.push(c.id);
    const t1 = await storage.createTag({ orgId: ORG_A, brandId: brandA.id, name: `T1-${RUN_TAG}` });
    const t2 = await storage.createTag({ orgId: ORG_A, brandId: brandA.id, name: `T2-${RUN_TAG}` });
    createdTagIds.push(t1.id, t2.id);

    await storage.setContactTags(ORG_A, c.id, [t1.id, t2.id]);
    let read = await storage.getProspectWithTags(c.id, ORG_A);
    expect(read?.tags.map((x) => x.id).sort()).toEqual([t1.id, t2.id].sort());

    // Replace with a single tag → t2 is removed
    await storage.setContactTags(ORG_A, c.id, [t1.id]);
    read = await storage.getProspectWithTags(c.id, ORG_A);
    expect(read?.tags.map((x) => x.id)).toEqual([t1.id]);

    // Empty array clears all tags
    await storage.setContactTags(ORG_A, c.id, []);
    read = await storage.getProspectWithTags(c.id, ORG_A);
    expect(read?.tags).toEqual([]);
  });

  it("setContactTags rejects cross-org tag ids", async () => {
    const c = await storage.createProspect({ orgId: ORG_A, brandId: brandA.id, firstName: "X", lastName: RUN_TAG });
    createdContactIds.push(c.id);
    const tInB = await storage.createTag({ orgId: ORG_B, brandId: brandB.id, name: `BTag-${RUN_TAG}` });
    createdTagIds.push(tInB.id);
    await expect(storage.setContactTags(ORG_A, c.id, [tInB.id])).rejects.toThrow();
  });

  it("deleteTag removes the tag and its assignments cascade", async () => {
    const c = await storage.createProspect({ orgId: ORG_A, brandId: brandA.id, firstName: "D", lastName: RUN_TAG });
    createdContactIds.push(c.id);
    const t = await storage.createTag({ orgId: ORG_A, brandId: brandA.id, name: `Del-${RUN_TAG}` });
    createdTagIds.push(t.id);
    await storage.setContactTags(ORG_A, c.id, [t.id]);
    const ok = await storage.deleteTag(t.id, ORG_A);
    expect(ok).toBe(true);
    const read = await storage.getProspectWithTags(c.id, ORG_A);
    expect(read?.tags).toEqual([]);
  });
});

describe("activities storage — createContactActivity / listContactActivities", () => {
  it("appends an activity and bumps last_activity_at on the prospect", async () => {
    const c = await storage.createProspect(
      { orgId: ORG_A, brandId: brandA.id, firstName: "Act", lastName: RUN_TAG },
    );
    createdContactIds.push(c.id);
    expect(c.lastActivityAt).toBeNull();

    const a1 = await storage.createContactActivity({
      orgId: ORG_A, brandId: brandA.id, prospectId: c.id, type: "note_added", payload: { body: "hello" },
    });
    expect(a1.id).toBeTruthy();

    const list = await storage.listContactActivities(ORG_A, c.id);
    expect(list.length).toBe(1);
    expect(list[0].type).toBe("note_added");

    const reread = await storage.getProspect(c.id, ORG_A);
    expect(reread?.lastActivityAt).toBeTruthy();
  });

  // dropped: PSO-only `contact_created` auto-emit assertion. createProspect
  // does not auto-emit a system activity; the equivalent would be a new
  // `prospect_created` emission contract, out of scope for 5b1c.

  it("listContactActivities returns [] for a wrong-org prospect id", async () => {
    const c = await storage.createProspect({ orgId: ORG_B, brandId: brandB.id, firstName: "BAct", lastName: RUN_TAG });
    createdContactIds.push(c.id);
    await storage.createContactActivity({
      orgId: ORG_B, brandId: brandB.id, prospectId: c.id, type: "note_added", payload: {},
    });
    const wrong = await storage.listContactActivities(ORG_A, c.id);
    expect(wrong).toEqual([]);
  });
});
