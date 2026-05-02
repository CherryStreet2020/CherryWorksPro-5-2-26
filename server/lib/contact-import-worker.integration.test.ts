/**
 * Sprint 2o.0 Step 5b1d (HR4) — Worker-level integration coverage for the
 * Marketing OS contact-import worker after retargeting writes from PSO
 * `client_contacts` to `marketing_prospects`.
 *
 * Acceptance scope:
 *   1. insert path → row lands in `marketing_prospects`, NOT `client_contacts`
 *   2. update-existing path → mutates the existing prospect (no second row)
 *   3. dedupe lookup queries `marketing_prospects` (case-insensitive)
 *   4. lifecycleStage is coerced to the marketing enum; out-of-range falls
 *      back to "lead"; `source` lands in `lead_source` with the
 *      "csv-import" default
 *
 * Mirrors the env-handling and isolated-org pattern from
 * server/marketing/scheduled-send.integration.test.ts.
 */
process.env.MARKETING_OS_ENABLED = "true";

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { and, eq, inArray, sql } from "drizzle-orm";

import { runContactImportJob } from "./contact-import-worker";
import { db } from "../db";
import {
  orgs,
  brands,
  users,
  clientContacts,
  marketingProspects,
  contactImports,
  contactActivities,
  expenseCategories,
  orgEntitlements,
} from "@shared/schema";

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ORG_ID = randomUUID();
const BRAND_ID = randomUUID();
const USER_ID = randomUUID();

const createdImportIds: string[] = [];

beforeAll(async () => {
  await db.insert(orgs).values({
    id: ORG_ID,
    name: `s2o-5b1d ${RUN}`,
    slug: `s2o-5b1d-${RUN}`,
  });
  await db.insert(brands).values({
    id: BRAND_ID,
    orgId: ORG_ID,
    name: `s2o-5b1d Brand ${RUN}`,
    slug: `s2o-5b1d-brand-${RUN}`,
  });
  await db.insert(users).values({
    id: USER_ID,
    orgId: ORG_ID,
    email: `s2o-5b1d-${RUN}@s2o5b1d.test`,
    password: "x",
    name: "Importer",
    firstName: "Importer",
    lastName: "User",
  });
});

afterAll(async () => {
  await db
    .delete(contactActivities)
    .where(eq(contactActivities.orgId, ORG_ID));
  await db
    .delete(marketingProspects)
    .where(eq(marketingProspects.orgId, ORG_ID));
  // Defensive: assert nothing leaked into PSO contacts on this org.
  await db.delete(clientContacts).where(eq(clientContacts.orgId, ORG_ID));
  if (createdImportIds.length) {
    await db
      .delete(contactImports)
      .where(inArray(contactImports.id, createdImportIds));
  }
  await db.delete(users).where(eq(users.id, USER_ID));
  await db.delete(brands).where(eq(brands.id, BRAND_ID));
  // Sweep auto-seeded children before the org delete (mirrors scheduled-send
  // suite — parallel seeders may attach rows to our ad-hoc org mid-test).
  await db.delete(expenseCategories).where(eq(expenseCategories.orgId, ORG_ID));
  await db.delete(orgEntitlements).where(eq(orgEntitlements.orgId, ORG_ID));
  await db.delete(orgs).where(eq(orgs.id, ORG_ID));
});

async function enqueue(): Promise<string> {
  const id = randomUUID();
  await db.insert(contactImports).values({
    id,
    orgId: ORG_ID,
    brandId: BRAND_ID,
    userId: USER_ID,
    status: "pending",
    fileName: `${RUN}.csv`,
  });
  createdImportIds.push(id);
  return id;
}

describe("Sprint 2o.0 5b1d — contact-import worker writes to marketing_prospects", () => {
  it("insert path: creates rows in marketing_prospects (and NOT in client_contacts)", async () => {
    const importId = await enqueue();
    const email = `insert-${RUN}@s2o5b1d.test`;

    await runContactImportJob({
      importId,
      orgId: ORG_ID,
      brandId: BRAND_ID,
      rows: [
        {
          first_name: "Ada",
          last_name: "Lovelace",
          email,
          source: "google",
          lifecycle_stage: "mql",
        },
      ],
      mapping: {
        first_name: "firstName",
        last_name: "lastName",
        email: "email",
        source: "source",
        lifecycle_stage: "lifecycleStage",
      },
      dedupeStrategy: "skip",
    });

    const prospects = await db
      .select()
      .from(marketingProspects)
      .where(
        and(
          eq(marketingProspects.orgId, ORG_ID),
          eq(sql`lower(${marketingProspects.email})`, email),
        ),
      );
    expect(prospects).toHaveLength(1);
    expect(prospects[0].firstName).toBe("Ada");
    expect(prospects[0].lastName).toBe("Lovelace");
    expect(prospects[0].lifecycleStage).toBe("mql");
    expect(prospects[0].leadSource).toBe("google");

    // Defensive: nothing was written to PSO clientContacts for this email.
    const psoRows = await db
      .select({ id: clientContacts.id })
      .from(clientContacts)
      .where(
        and(
          eq(clientContacts.orgId, ORG_ID),
          eq(sql`lower(${clientContacts.email})`, email),
        ),
      );
    expect(psoRows).toHaveLength(0);

    // Job status should be completed and successCount=1.
    const [imp] = await db
      .select()
      .from(contactImports)
      .where(eq(contactImports.id, importId));
    expect(imp.status).toBe("completed");
    expect(imp.successCount).toBe(1);
  });

  it("update path: dedupes against marketing_prospects and updates the existing row", async () => {
    const importId = await enqueue();
    const email = `update-${RUN}@s2o5b1d.test`;

    // Pre-seed a marketing_prospects row that the second import will dedupe to.
    const seedId = randomUUID();
    await db.insert(marketingProspects).values({
      id: seedId,
      orgId: ORG_ID,
      brandId: BRAND_ID,
      firstName: "Old",
      lastName: "Name",
      email,
      lifecycleStage: "lead",
    });

    await runContactImportJob({
      importId,
      orgId: ORG_ID,
      brandId: BRAND_ID,
      rows: [
        {
          first_name: "New",
          last_name: "Name",
          email: email.toUpperCase(), // case-insensitive dedupe
          source: "csv",
        },
      ],
      mapping: {
        first_name: "firstName",
        last_name: "lastName",
        email: "email",
        source: "source",
      },
      dedupeStrategy: "update",
    });

    const rows = await db
      .select()
      .from(marketingProspects)
      .where(
        and(
          eq(marketingProspects.orgId, ORG_ID),
          eq(sql`lower(${marketingProspects.email})`, email),
        ),
      );
    expect(rows).toHaveLength(1); // dedupe held — no second row inserted
    expect(rows[0].id).toBe(seedId);
    expect(rows[0].firstName).toBe("New");
    expect(rows[0].leadSource).toBe("csv");

    const [imp] = await db
      .select()
      .from(contactImports)
      .where(eq(contactImports.id, importId));
    expect(imp.status).toBe("completed");
    expect(imp.updatedCount).toBe(1);
    expect(imp.successCount).toBe(1);
  });

  it("dedupe path with strategy=skip: existing prospect is skipped", async () => {
    const importId = await enqueue();
    const email = `skip-${RUN}@s2o5b1d.test`;

    await db.insert(marketingProspects).values({
      id: randomUUID(),
      orgId: ORG_ID,
      brandId: BRAND_ID,
      firstName: "Existing",
      lastName: "Prospect",
      email,
      lifecycleStage: "lead",
    });

    await runContactImportJob({
      importId,
      orgId: ORG_ID,
      brandId: BRAND_ID,
      rows: [{ first_name: "Should", last_name: "Skip", email }],
      mapping: {
        first_name: "firstName",
        last_name: "lastName",
        email: "email",
      },
      dedupeStrategy: "skip",
    });

    // Still exactly one row; firstName unchanged because the row was skipped.
    const rows = await db
      .select()
      .from(marketingProspects)
      .where(
        and(
          eq(marketingProspects.orgId, ORG_ID),
          eq(sql`lower(${marketingProspects.email})`, email),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].firstName).toBe("Existing");

    const [imp] = await db
      .select()
      .from(contactImports)
      .where(eq(contactImports.id, importId));
    expect(imp.status).toBe("completed");
    expect(imp.successCount).toBe(0);
  });

  it("field-map: out-of-range lifecycleStage falls back to 'lead'; missing source defaults to 'csv-import'", async () => {
    const importId = await enqueue();
    const email = `map-${RUN}@s2o5b1d.test`;

    await runContactImportJob({
      importId,
      orgId: ORG_ID,
      brandId: BRAND_ID,
      rows: [
        {
          first_name: "Map",
          last_name: "Test",
          email,
          // PSO accepts arbitrary lifecycleStage strings; marketing enum
          // does not — must coerce to "lead".
          lifecycle_stage: "active_client",
        },
      ],
      mapping: {
        first_name: "firstName",
        last_name: "lastName",
        email: "email",
        lifecycle_stage: "lifecycleStage",
      },
      dedupeStrategy: "skip",
    });

    const [row] = await db
      .select()
      .from(marketingProspects)
      .where(
        and(
          eq(marketingProspects.orgId, ORG_ID),
          eq(sql`lower(${marketingProspects.email})`, email),
        ),
      );
    expect(row).toBeDefined();
    expect(row.lifecycleStage).toBe("lead");
    expect(row.leadSource).toBe("csv-import");
  });
});
