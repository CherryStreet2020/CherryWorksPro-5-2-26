/**
 * Task #277 — Unit tests for the periodic trim of `email_alert_webhook_tests`.
 *
 * Hits the dev DB directly (matches the convention used by brands.test.ts /
 * marketing-contacts.test.ts). Uses a unique RUN_TAG-based pseudo org id so
 * concurrent runs don't collide, and cleans up everything in afterAll.
 *
 * NOTE: `email_alert_webhook_tests.org_id` has an FK to `orgs(id)`, so we
 * insert into `orgs` first and tear it down at the end (cascade removes any
 * stragglers we missed).
 */

import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { db, pool } from "./db";
import {
  cleanupOldEmailAlertWebhookTests,
  RECENT_TEST_LIMIT,
} from "./routes/email-alert-webhook-routes";
import { emailAlertWebhookTests, orgs } from "@shared/schema";
import { eq, inArray, sql } from "drizzle-orm";

const RUN_TAG = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ORG_A = `00000000-0000-4000-8000-${RUN_TAG.slice(0, 12).padEnd(12, "0")}`;
const ORG_B = `00000000-0000-4000-8001-${RUN_TAG.slice(0, 12).padEnd(12, "0")}`;

async function insertTestRow(orgId: string, testedAt: Date, ok: boolean) {
  const [row] = await db
    .insert(emailAlertWebhookTests)
    .values({ orgId, testedAt, ok, errorMessage: ok ? null : "boom" })
    .returning();
  return row;
}

beforeAll(async () => {
  await pool.query(
    `INSERT INTO orgs (id, name, slug) VALUES ($1, $2, $3), ($4, $5, $6)
     ON CONFLICT (id) DO NOTHING`,
    [
      ORG_A,
      `cleanup-test-a-${RUN_TAG}`,
      `cleanup-test-a-${RUN_TAG}`,
      ORG_B,
      `cleanup-test-b-${RUN_TAG}`,
      `cleanup-test-b-${RUN_TAG}`,
    ],
  );
  await db
    .delete(emailAlertWebhookTests)
    .where(inArray(emailAlertWebhookTests.orgId, [ORG_A, ORG_B]));
});

afterAll(async () => {
  await db
    .delete(emailAlertWebhookTests)
    .where(inArray(emailAlertWebhookTests.orgId, [ORG_A, ORG_B]));
  await pool.query(`DELETE FROM orgs WHERE id = ANY($1)`, [[ORG_A, ORG_B]]);
  await pool.end();
});

describe("cleanupOldEmailAlertWebhookTests", () => {
  it("returns 0 deleted when there is nothing to trim", async () => {
    // Each org has fewer than RECENT_TEST_LIMIT rows.
    const base = Date.now();
    for (let i = 0; i < 3; i++) {
      await insertTestRow(ORG_A, new Date(base - i * 1000), true);
    }
    const stats = await cleanupOldEmailAlertWebhookTests();
    expect(stats.deleted).toBe(0);
    expect(stats.perOrgLimit).toBe(RECENT_TEST_LIMIT);

    const remaining = await db
      .select()
      .from(emailAlertWebhookTests)
      .where(eq(emailAlertWebhookTests.orgId, ORG_A));
    expect(remaining).toHaveLength(3);

    await db
      .delete(emailAlertWebhookTests)
      .where(eq(emailAlertWebhookTests.orgId, ORG_A));
  });

  it("trims per-org rows beyond the most recent N, keeping newest", async () => {
    const base = Date.now();
    // Insert 15 rows for ORG_A with strictly decreasing testedAt so we can
    // tell which ones the cleanup kept.
    const aIds: string[] = [];
    for (let i = 0; i < 15; i++) {
      const row = await insertTestRow(
        ORG_A,
        new Date(base - i * 60_000),
        i % 2 === 0,
      );
      aIds.push(row.id);
    }
    // ORG_B stays under the cap; it must not be touched.
    const bIds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const row = await insertTestRow(ORG_B, new Date(base - i * 60_000), true);
      bIds.push(row.id);
    }

    const stats = await cleanupOldEmailAlertWebhookTests();
    expect(stats.deleted).toBe(15 - RECENT_TEST_LIMIT);

    const aRows = await db
      .select()
      .from(emailAlertWebhookTests)
      .where(eq(emailAlertWebhookTests.orgId, ORG_A))
      .orderBy(sql`tested_at DESC`);
    expect(aRows).toHaveLength(RECENT_TEST_LIMIT);
    // The kept rows must be the first RECENT_TEST_LIMIT inserted (newest
    // testedAt values).
    const expectedKeptIds = aIds.slice(0, RECENT_TEST_LIMIT).sort();
    const actualKeptIds = aRows.map((r) => r.id).sort();
    expect(actualKeptIds).toEqual(expectedKeptIds);

    const bRows = await db
      .select()
      .from(emailAlertWebhookTests)
      .where(eq(emailAlertWebhookTests.orgId, ORG_B));
    expect(bRows).toHaveLength(4);
  });

  it("respects a custom per-org limit", async () => {
    await db
      .delete(emailAlertWebhookTests)
      .where(inArray(emailAlertWebhookTests.orgId, [ORG_A, ORG_B]));

    const base = Date.now();
    for (let i = 0; i < 6; i++) {
      await insertTestRow(ORG_A, new Date(base - i * 60_000), true);
    }

    const stats = await cleanupOldEmailAlertWebhookTests(2);
    expect(stats.deleted).toBe(4);
    expect(stats.perOrgLimit).toBe(2);

    const remaining = await db
      .select()
      .from(emailAlertWebhookTests)
      .where(eq(emailAlertWebhookTests.orgId, ORG_A));
    expect(remaining).toHaveLength(2);
  });
});
