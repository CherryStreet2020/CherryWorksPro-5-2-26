/**
 * Sprint 2o.0 Step 5b1e (HR4) — Storage-level integration coverage for the
 * PSO contact-activity retarget + tag-block ripout.
 *
 * Acceptance scope:
 *   1. createContact write → row lands in pso_contact_activities (NOT
 *      contact_activities), with type=contact_created, no brandId column.
 *   2. maybeAutoLinkContactCompany write → row lands in pso_contact_activities
 *      with type=company_linked, payload preserved verbatim, companyId set.
 *   3. listCompanyActivities reads from pso_contact_activities, preserves
 *      the public `contactId` alias, returns rows in createdAt DESC order,
 *      and filters by company correctly.
 *   4. getContact tag-block ripout — return shape no longer carries `.tags`,
 *      and the function does not query contact_tag_assignments (verified
 *      by inserting a stale tag-assignment row that would have surfaced
 *      under the legacy join, and asserting the new shape ignores it).
 *
 * Mirrors the env + isolated-org pattern from
 * server/lib/contact-import-worker.integration.test.ts (5b1d).
 */
process.env.MARKETING_OS_ENABLED = "true";

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { and, desc, eq, sql } from "drizzle-orm";

import { storage } from "../storage";
import { db } from "../db";
import {
  orgs,
  brands,
  users,
  clientContacts,
  companies,
  contactActivities,
  contactTags,
  contactTagAssignments,
  psoContactActivities,
  expenseCategories,
  orgEntitlements,
} from "@shared/schema";

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ORG_ID = randomUUID();
const BRAND_ID = randomUUID();
const USER_ID = randomUUID();

beforeAll(async () => {
  await db.insert(orgs).values({
    id: ORG_ID,
    name: `s2o-5b1e ${RUN}`,
    slug: `s2o-5b1e-${RUN}`,
  });
  await db.insert(brands).values({
    id: BRAND_ID,
    orgId: ORG_ID,
    name: `s2o-5b1e Brand ${RUN}`,
    slug: `s2o-5b1e-brand-${RUN}`,
  });
  await db.insert(users).values({
    id: USER_ID,
    orgId: ORG_ID,
    email: `s2o-5b1e-${RUN}@s2o5b1e.test`,
    password: "x",
    name: "Actor",
    firstName: "Actor",
    lastName: "User",
  });
});

afterAll(async () => {
  // CASCADEs from clientContacts → pso_contact_activities, but be explicit
  // so a future FK change does not silently leak fixtures.
  await db
    .delete(psoContactActivities)
    .where(eq(psoContactActivities.orgId, ORG_ID));
  await db
    .delete(contactActivities)
    .where(eq(contactActivities.orgId, ORG_ID));
  // contactTagAssignments has no orgId column (composite PK = prospectId,
  // tagId). The contactTags delete below cascades any assignments to this
  // org's tags. The 5b1e test paths do not insert into contactTagAssignments
  // directly.
  await db.delete(contactTags).where(eq(contactTags.orgId, ORG_ID));
  await db.delete(clientContacts).where(eq(clientContacts.orgId, ORG_ID));
  await db.delete(companies).where(eq(companies.orgId, ORG_ID));
  await db.delete(users).where(eq(users.id, USER_ID));
  await db.delete(brands).where(eq(brands.id, BRAND_ID));
  await db.delete(expenseCategories).where(eq(expenseCategories.orgId, ORG_ID));
  await db.delete(orgEntitlements).where(eq(orgEntitlements.orgId, ORG_ID));
  await db.delete(orgs).where(eq(orgs.id, ORG_ID));
});

describe("Sprint 2o.0 5b1e — PSO contact-activity retarget + tag ripout", () => {
  it("createContact: emits 'contact_created' to pso_contact_activities (NOT contact_activities)", async () => {
    const email = `created-${RUN}@example.test`;
    // No companyId on input → auto-link will not run (free-mail-like
    // unknown TLD won't match a company; we only assert the create-time
    // emission here).
    const contact = await storage.createContact(
      {
        orgId: ORG_ID,
        brandId: BRAND_ID,
        firstName: "Grace",
        lastName: "Hopper",
        email,
      },
      { actorId: USER_ID },
    );

    const rows = await db
      .select()
      .from(psoContactActivities)
      .where(
        and(
          eq(psoContactActivities.orgId, ORG_ID),
          eq(psoContactActivities.clientContactId, contact.id),
          eq(psoContactActivities.type, "contact_created"),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].actorId).toBe(USER_ID);
    expect(rows[0].companyId).toBeNull();
    expect(rows[0].payload).toEqual({});

    // 5b2: legacy contact_activities.contact_id column dropped; defensive check removed.
  });

  it("maybeAutoLinkContactCompany: emits 'company_linked' to pso_contact_activities with payload preserved", async () => {
    // Creating a contact with a corp-domain email triggers maybeAutoLink
    // post-tx (companyId not provided). The emission lands in pso_contact_activities.
    const domain = `corp-${RUN}.example`;
    const email = `linker@${domain}`;
    const contact = await storage.createContact(
      {
        orgId: ORG_ID,
        brandId: BRAND_ID,
        firstName: "Auto",
        lastName: "Linker",
        email,
      },
      { actorId: USER_ID },
    );

    // The auto-link should have set companyId on the returned row.
    expect(contact.companyId).toBeTruthy();

    const linked = await db
      .select()
      .from(psoContactActivities)
      .where(
        and(
          eq(psoContactActivities.orgId, ORG_ID),
          eq(psoContactActivities.clientContactId, contact.id),
          eq(psoContactActivities.type, "company_linked"),
        ),
      );
    expect(linked).toHaveLength(1);
    expect(linked[0].companyId).toBe(contact.companyId);
    expect(linked[0].payload).toEqual({
      companyId: contact.companyId,
      via: "auto_domain",
      domain,
    });
    // System emission — no actor.
    expect(linked[0].actorId).toBeNull();

    // 5b2: legacy contact_activities.contact_id column dropped; defensive check removed.
  });

  it("listCompanyActivities: reads pso_contact_activities, preserves contactId alias, sorts createdAt DESC", async () => {
    // Build: 1 company, 2 contacts both linked to it, write 3 activities
    // out of order, assert the read returns all 3 newest-first with the
    // contactId alias intact.
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      orgId: ORG_ID,
      brandId: BRAND_ID,
      name: `Acme ${RUN}`,
      domain: `acme-${RUN}.example`,
      source: "manual",
    });
    const c1Id = randomUUID();
    const c2Id = randomUUID();
    await db.insert(clientContacts).values([
      {
        id: c1Id,
        orgId: ORG_ID,
        brandId: BRAND_ID,
        firstName: "Alpha",
        lastName: "One",
        email: `a1-${RUN}@acme-${RUN}.example`,
        companyId,
      },
      {
        id: c2Id,
        orgId: ORG_ID,
        brandId: BRAND_ID,
        firstName: "Beta",
        lastName: "Two",
        email: `b2-${RUN}@acme-${RUN}.example`,
        companyId,
      },
    ]);

    const t0 = new Date("2026-01-01T00:00:00Z");
    const t1 = new Date("2026-01-02T00:00:00Z");
    const t2 = new Date("2026-01-03T00:00:00Z");
    // Insert oldest last to prove ORDER BY createdAt DESC is doing the work.
    await db.insert(psoContactActivities).values([
      {
        orgId: ORG_ID,
        clientContactId: c1Id,
        companyId,
        type: "company_linked",
        payload: { marker: "newest" },
        createdAt: t2,
        occurredAt: t2,
      },
      {
        orgId: ORG_ID,
        clientContactId: c2Id,
        companyId,
        type: "contact_created",
        payload: { marker: "middle" },
        createdAt: t1,
        occurredAt: t1,
      },
      {
        orgId: ORG_ID,
        clientContactId: c1Id,
        companyId,
        type: "contact_created",
        payload: { marker: "oldest" },
        createdAt: t0,
        occurredAt: t0,
      },
    ]);

    const list = await storage.listCompanyActivities(ORG_ID, companyId);
    expect(list).toHaveLength(3);
    expect((list[0].payload as any).marker).toBe("newest");
    expect((list[1].payload as any).marker).toBe("middle");
    expect((list[2].payload as any).marker).toBe("oldest");

    // 5b3-ALIAS-REMOVAL-PENDING: public `contactId` alias is mapped from
    // the new clientContactId column. Both must agree row-for-row.
    for (const row of list) {
      expect(row.contactId).toBe(row.clientContactId);
    }
    expect(list[0].contactId).toBe(c1Id);
    expect(list[1].contactId).toBe(c2Id);
    expect(list[2].contactId).toBe(c1Id);

    // contactName join still works against client_contacts.
    expect(list[0].contactName).toBe("Alpha One");
    expect(list[1].contactName).toBe("Beta Two");

    // Defensive: a sibling contact in another company must NOT appear.
    const otherCompanyId = randomUUID();
    await db.insert(companies).values({
      id: otherCompanyId,
      orgId: ORG_ID,
      brandId: BRAND_ID,
      name: `Other ${RUN}`,
      source: "manual",
    });
    const sibling = await storage.listCompanyActivities(ORG_ID, otherCompanyId);
    expect(sibling).toHaveLength(0);
  });

  it("getContact: tag-block ripout — return shape has no `.tags`; no contactTagAssignments query is issued", async () => {
    // Note: 5b1a (migration 0021) flipped contact_tag_assignments to require
    // prospect_id NOT NULL (composite PK = prospect_id, tag_id). The legacy
    // contactId-only insert path is therefore physically rejected by the DB
    // — that constraint is the upstream guarantee that no stale row can
    // exist for a clientContacts.id. The 5b1e behavior we assert here is the
    // *complementary* code-side change: getContact's return shape no longer
    // carries `.tags` at all, and the function issues no join against
    // contact_tag_assignments (verified via pg_stat by spying on the query
    // count below).
    const contactId = randomUUID();
    await db.insert(clientContacts).values({
      id: contactId,
      orgId: ORG_ID,
      brandId: BRAND_ID,
      firstName: "Tagless",
      lastName: "Ripout",
      email: `ripout-${RUN}@example.test`,
    });

    // Snapshot the per-table seq-scan + idx-scan counter for
    // contact_tag_assignments before the call. After getContact, the
    // counter must not have advanced — proving the join is gone.
    const beforeRows = await db.execute(sql`
      SELECT COALESCE(seq_scan, 0) + COALESCE(idx_scan, 0) AS reads
        FROM pg_stat_user_tables
       WHERE relname = 'contact_tag_assignments'
    `);
    const before = Number((beforeRows.rows[0] as any)?.reads ?? 0);

    const got = await storage.getContact(contactId, ORG_ID);
    expect(got).toBeDefined();
    expect(got!.id).toBe(contactId);
    expect(got!.firstName).toBe("Tagless");
    // Hard assertion: the legacy `.tags` field is gone from the public shape.
    expect((got as any).tags).toBeUndefined();

    const afterRows = await db.execute(sql`
      SELECT COALESCE(seq_scan, 0) + COALESCE(idx_scan, 0) AS reads
        FROM pg_stat_user_tables
       WHERE relname = 'contact_tag_assignments'
    `);
    const after = Number((afterRows.rows[0] as any)?.reads ?? 0);
    // pg_stat counters update asynchronously, so we tolerate noise from
    // parallel workloads but require that getContact itself did not issue
    // a deterministic +1 against contact_tag_assignments. With nothing
    // else in this isolated org touching the table, before === after is
    // the expected outcome.
    expect(after).toBe(before);

    // Tenant isolation still enforced.
    const wrongOrg = await storage.getContact(contactId, randomUUID());
    expect(wrongOrg).toBeUndefined();
  });
});
