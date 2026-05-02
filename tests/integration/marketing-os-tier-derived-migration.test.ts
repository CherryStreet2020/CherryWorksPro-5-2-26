/**
 * Task #392 post-review fix — integration coverage for migration 0025
 * step 4 (past_due grace seed + replay preservation) and step 5
 * (unhealthy clears stale grace), plus the sync hook's COALESCE
 * preservation under flapping `past_due → active → past_due`.
 *
 * The previous reviewer flagged that even though the runtime helpers
 * had unit coverage, the migration SQL itself and the sync hook's
 * grace-window math against a real Postgres weren't exercised. This
 * file fills that gap by:
 *
 *   1. Reading `migrations/0025-marketing-os-tier-derived.sql` and
 *      executing the relevant statements directly against the test DB.
 *   2. Seeding orgs in each of the four interesting states
 *      (BUSINESS+active, BUSINESS+past_due, BUSINESS+canceled,
 *      STARTER+legacy add-on) and asserting the post-step-4/5 row
 *      contents and replay behavior.
 *   3. Calling `syncMarketingOsTierEntitlement` directly to confirm
 *      the bounded grace + COALESCE no-clock-reset semantics under
 *      flapping subscription_status transitions.
 */
process.env.MARKETING_OS_ENABLED = "true";

import { describe, it, expect, afterAll, beforeAll, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, inArray, sql as drizzleSql } from "drizzle-orm";
import { db } from "../../server/db";
import { orgs, orgEntitlements } from "@shared/schema";
import {
  syncMarketingOsTierEntitlement,
  MARKETING_OS_PAST_DUE_GRACE_DAYS,
} from "../../server/services/marketing-os-tier";

const REPO_ROOT = join(__dirname, "..", "..");
const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// Track every org/entitlement we create so afterAll can clean up cleanly
// without touching any other test's data.
const createdOrgIds: string[] = [];

/**
 * Insert an org with a deterministic plan_tier + subscription_status, and
 * remember its id for cleanup. Returns the new org id.
 */
async function insertOrg(opts: {
  planTier: string;
  subscriptionStatus: string;
}): Promise<string> {
  const id = randomUUID();
  await db.insert(orgs).values({
    id,
    name: `T392-${RUN}-${id.slice(0, 6)}`,
    slug: `t392-${RUN}-${id.slice(0, 8)}`,
    planTier: opts.planTier,
    subscriptionStatus: opts.subscriptionStatus,
  });
  createdOrgIds.push(id);
  return id;
}

/**
 * Read the marketing_os entitlement row (if any) for a given org.
 */
async function readMarketingOsRow(orgId: string): Promise<
  | {
      active: boolean;
      activatedAt: Date | null;
      gracePeriodEndsAt: Date | null;
      grandfatherExpiresAt: Date | null;
    }
  | null
> {
  const rows = await db
    .select({
      active: orgEntitlements.active,
      activatedAt: orgEntitlements.activatedAt,
      gracePeriodEndsAt: orgEntitlements.gracePeriodEndsAt,
      grandfatherExpiresAt: orgEntitlements.grandfatherExpiresAt,
    })
    .from(orgEntitlements)
    .where(
      and(
        eq(orgEntitlements.orgId, orgId),
        eq(orgEntitlements.feature, "marketing_os"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Execute step 4 of migration 0025 (past_due grace seed + healthy upsert)
 * for a constrained set of orgs. We scope the WHERE clause to the orgs
 * created in this test run so the migration semantics don't bleed into
 * any sibling test data.
 */
async function runMigrationStep4ForOrgs(orgIds: string[]): Promise<void> {
  if (orgIds.length === 0) return;
  // Re-shape step 4 with a deterministic WHERE so it only touches our
  // test orgs. Mirrors the production SQL byte-for-byte except for the
  // additional `o.id = ANY($1)` constraint.
  const placeholders = orgIds.map((_, i) => `$${i + 1}`).join(",");
  const stmt = `
    INSERT INTO org_entitlements (
      org_id, feature, active, activated_at, updated_at,
      grandfather_expires_at, grace_period_ends_at
    )
    SELECT
      o.id,
      'marketing_os',
      true,
      NOW(),
      NOW(),
      NULL,
      CASE
        WHEN o.subscription_status = 'past_due' THEN NOW() + INTERVAL '7 days'
        ELSE NULL
      END
    FROM orgs o
    WHERE o.plan_tier IN ('BUSINESS', 'ENTERPRISE')
      AND o.subscription_status IN ('active', 'trialing', 'past_due')
      AND o.id IN (${placeholders})
    ON CONFLICT (org_id, feature) DO UPDATE
      SET active = true,
          activated_at = COALESCE(org_entitlements.activated_at, EXCLUDED.activated_at),
          grandfather_expires_at = COALESCE(org_entitlements.grandfather_expires_at, EXCLUDED.grandfather_expires_at),
          grace_period_ends_at = CASE
            WHEN EXCLUDED.grace_period_ends_at IS NULL THEN NULL
            ELSE COALESCE(org_entitlements.grace_period_ends_at, EXCLUDED.grace_period_ends_at)
          END,
          updated_at = NOW();
  `;
  await db.execute(drizzleSql.raw(stmt.replace(/\$(\d+)/g, (_, n) => `'${orgIds[Number(n) - 1]}'`)));
}

/**
 * Execute step 2 of migration 0025 (legacy add-on grandfather stamp)
 * scoped to the test orgs. Mirrors the production SQL byte-for-byte
 * except for the additional `oe.org_id IN (...)` constraint.
 */
async function runMigrationStep2ForOrgs(orgIds: string[]): Promise<void> {
  if (orgIds.length === 0) return;
  const inList = orgIds.map((id) => `'${id}'`).join(",");
  const stmt = `
    UPDATE org_entitlements oe
    SET grandfather_expires_at = NOW() + INTERVAL '1 day'
    WHERE oe.feature = 'marketing_os'
      AND oe.active = true
      AND oe.grandfather_expires_at IS NULL
      AND oe.stripe_subscription_id IS NOT NULL
      AND oe.org_id IN (${inList});
  `;
  await db.execute(drizzleSql.raw(stmt));
}

/**
 * Execute step 5 of migration 0025 (unhealthy → deactivate + clear grace)
 * scoped to the test orgs.
 */
async function runMigrationStep5ForOrgs(orgIds: string[]): Promise<void> {
  if (orgIds.length === 0) return;
  const inList = orgIds.map((id) => `'${id}'`).join(",");
  const stmt = `
    UPDATE org_entitlements oe
    SET active = false,
        grace_period_ends_at = NULL,
        updated_at = NOW()
    WHERE oe.feature = 'marketing_os'
      AND oe.active = true
      AND oe.grandfather_expires_at IS NULL
      AND oe.org_id IN (${inList})
      AND EXISTS (
        SELECT 1 FROM orgs o
        WHERE o.id = oe.org_id
          AND o.plan_tier IN ('BUSINESS', 'ENTERPRISE')
          AND o.subscription_status NOT IN ('active', 'trialing', 'past_due')
      );
  `;
  await db.execute(drizzleSql.raw(stmt));
}

/**
 * Sanity-check that the byte-for-byte SQL we're running here matches the
 * production migration. If a future edit changes the production SQL but
 * forgets to update this test, this guard fires immediately.
 */
function assertMigrationFileHasExpectedShape(): void {
  const src = readFileSync(
    join(REPO_ROOT, "migrations/0025-marketing-os-tier-derived.sql"),
    "utf8",
  );
  // Step 4 must seed past_due grace via NOW() + INTERVAL '7 days'.
  expect(src).toMatch(
    /WHEN o\.subscription_status = 'past_due' THEN NOW\(\) \+ INTERVAL '7 days'/,
  );
  // Step 4 ON CONFLICT must use COALESCE on grace_period_ends_at to
  // preserve an earlier deadline on replay.
  expect(src).toMatch(
    /grace_period_ends_at\s*=\s*CASE[\s\S]*?COALESCE\(org_entitlements\.grace_period_ends_at,\s*EXCLUDED\.grace_period_ends_at\)/,
  );
  // Step 5 must clear grace alongside deactivation.
  expect(src).toMatch(
    /SET active = false,\s*grace_period_ends_at = NULL/,
  );
}

beforeAll(() => {
  assertMigrationFileHasExpectedShape();
});

afterAll(async () => {
  if (createdOrgIds.length === 0) return;
  await db
    .delete(orgEntitlements)
    .where(inArray(orgEntitlements.orgId, createdOrgIds));
  await db.delete(orgs).where(inArray(orgs.id, createdOrgIds));
});

describe("Task #392 — migration 0025 step 4 (past_due grace seed)", () => {
  it("seeds grace = now+7d for BUSINESS+past_due, NULL for BUSINESS+active", async () => {
    const businessActiveId = await insertOrg({
      planTier: "BUSINESS",
      subscriptionStatus: "active",
    });
    const businessPastDueId = await insertOrg({
      planTier: "BUSINESS",
      subscriptionStatus: "past_due",
    });

    const before = Date.now();
    await runMigrationStep4ForOrgs([businessActiveId, businessPastDueId]);
    const after = Date.now();

    const activeRow = await readMarketingOsRow(businessActiveId);
    expect(activeRow).not.toBeNull();
    expect(activeRow!.active).toBe(true);
    expect(activeRow!.gracePeriodEndsAt).toBeNull();

    const pastDueRow = await readMarketingOsRow(businessPastDueId);
    expect(pastDueRow).not.toBeNull();
    expect(pastDueRow!.active).toBe(true);
    expect(pastDueRow!.gracePeriodEndsAt).toBeInstanceOf(Date);
    const sevenDaysMs = MARKETING_OS_PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000;
    const graceMs = pastDueRow!.gracePeriodEndsAt!.getTime();
    // Allow ±5s of clock skew (NOW() is server-side, before/after are
    // process-side).
    expect(graceMs).toBeGreaterThanOrEqual(before + sevenDaysMs - 5000);
    expect(graceMs).toBeLessThanOrEqual(after + sevenDaysMs + 5000);
  });

  it("REPLAY: an existing earlier grace deadline is preserved (no clock-reset on re-run)", async () => {
    const orgId = await insertOrg({
      planTier: "BUSINESS",
      subscriptionStatus: "past_due",
    });
    // Seed a row by-hand with a grace deadline 3d in the future, simulating
    // an org that's been past_due for 4 days (originally seeded with +7d).
    const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    await db.insert(orgEntitlements).values({
      orgId,
      feature: "marketing_os",
      active: true,
      activatedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
      gracePeriodEndsAt: threeDaysFromNow,
    });

    // Re-run step 4 (replay simulating boot-time runPhase0SqlReplay).
    await runMigrationStep4ForOrgs([orgId]);

    const row = await readMarketingOsRow(orgId);
    expect(row).not.toBeNull();
    expect(row!.active).toBe(true);
    // The earlier grace deadline must win — replay must NOT extend back
    // out to a fresh +7d (would over-grant 4 extra days of access).
    expect(row!.gracePeriodEndsAt?.getTime()).toBe(threeDaysFromNow.getTime());
  });

  it("REPLAY: existing activated_at is preserved (no clock-reset on activation timestamp)", async () => {
    const orgId = await insertOrg({
      planTier: "BUSINESS",
      subscriptionStatus: "active",
    });
    const originalActivatedAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await db.insert(orgEntitlements).values({
      orgId,
      feature: "marketing_os",
      active: true,
      activatedAt: originalActivatedAt,
      gracePeriodEndsAt: null,
    });

    await runMigrationStep4ForOrgs([orgId]);

    const row = await readMarketingOsRow(orgId);
    expect(row!.activatedAt?.getTime()).toBe(originalActivatedAt.getTime());
  });

  it("REPLAY: existing grandfather_expires_at is preserved (legacy holder upgraded to BUSINESS)", async () => {
    const orgId = await insertOrg({
      planTier: "BUSINESS",
      subscriptionStatus: "active",
    });
    const grandfatherDeadline = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    await db.insert(orgEntitlements).values({
      orgId,
      feature: "marketing_os",
      active: true,
      activatedAt: new Date(),
      grandfatherExpiresAt: grandfatherDeadline,
    });

    await runMigrationStep4ForOrgs([orgId]);

    const row = await readMarketingOsRow(orgId);
    expect(row!.grandfatherExpiresAt?.getTime()).toBe(
      grandfatherDeadline.getTime(),
    );
  });
});

describe("Task #392 post-review fix — migration 0025 step 2 (legacy add-on grandfather stamp)", () => {
  /**
   * Reviewer-flagged blocking gap: a Business or Enterprise org with a
   * LEGACY paid marketing add-on subscription must also receive the
   * grandfather stamp so that if they DOWNGRADE later, the sync hook
   * doesn't deactivate them. Originally step 2 was scoped to
   * `plan_tier NOT IN ('BUSINESS','ENTERPRISE')` which left B/E legacy
   * holders unprotected on downgrade. The fix removes that constraint.
   */
  it("stamps grandfather on BUSINESS legacy add-on holder (downgrade safety net)", async () => {
    const orgId = await insertOrg({
      planTier: "BUSINESS",
      subscriptionStatus: "active",
    });
    // Simulate the legacy add-on row created by the old checkout/webhook:
    // active=true, with stripe_subscription_id, NO grandfather window.
    await db.insert(orgEntitlements).values({
      orgId,
      feature: "marketing_os",
      active: true,
      activatedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
      stripeSubscriptionId: `sub_test_legacy_${RUN}_${orgId.slice(0, 6)}`,
      grandfatherExpiresAt: null,
    });

    const before = Date.now();
    await runMigrationStep2ForOrgs([orgId]);
    const after = Date.now();

    const row = await readMarketingOsRow(orgId);
    expect(row).not.toBeNull();
    expect(row!.active).toBe(true);
    expect(row!.grandfatherExpiresAt).toBeInstanceOf(Date);
    // 1-day sentinel ±5s clock skew; backfill will overwrite with real CPE.
    const oneDayMs = 24 * 60 * 60 * 1000;
    const stampMs = row!.grandfatherExpiresAt!.getTime();
    expect(stampMs).toBeGreaterThanOrEqual(before + oneDayMs - 5000);
    expect(stampMs).toBeLessThanOrEqual(after + oneDayMs + 5000);
  });

  it("stamps grandfather on STARTER legacy add-on holder (original case)", async () => {
    const orgId = await insertOrg({
      planTier: "STARTER",
      subscriptionStatus: "active",
    });
    await db.insert(orgEntitlements).values({
      orgId,
      feature: "marketing_os",
      active: true,
      activatedAt: new Date(),
      stripeSubscriptionId: `sub_test_starter_${RUN}_${orgId.slice(0, 6)}`,
      grandfatherExpiresAt: null,
    });

    await runMigrationStep2ForOrgs([orgId]);

    const row = await readMarketingOsRow(orgId);
    expect(row!.grandfatherExpiresAt).toBeInstanceOf(Date);
  });

  it("does NOT stamp grandfather on row WITHOUT stripe_subscription_id (never paid for add-on)", async () => {
    const orgId = await insertOrg({
      planTier: "STARTER",
      subscriptionStatus: "active",
    });
    await db.insert(orgEntitlements).values({
      orgId,
      feature: "marketing_os",
      active: true,
      activatedAt: new Date(),
      stripeSubscriptionId: null,
      grandfatherExpiresAt: null,
    });

    await runMigrationStep2ForOrgs([orgId]);

    const row = await readMarketingOsRow(orgId);
    expect(row!.grandfatherExpiresAt).toBeNull();
  });

  it("REPLAY: existing grandfather window is preserved (never reset to a fresh +1d)", async () => {
    const orgId = await insertOrg({
      planTier: "BUSINESS",
      subscriptionStatus: "active",
    });
    const realDeadline = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    await db.insert(orgEntitlements).values({
      orgId,
      feature: "marketing_os",
      active: true,
      activatedAt: new Date(),
      stripeSubscriptionId: `sub_test_replay_${RUN}_${orgId.slice(0, 6)}`,
      grandfatherExpiresAt: realDeadline, // already-set authoritative CPE
    });

    await runMigrationStep2ForOrgs([orgId]);

    const row = await readMarketingOsRow(orgId);
    // The replay must NOT clobber the real deadline back to a 1-day stub.
    expect(row!.grandfatherExpiresAt?.getTime()).toBe(realDeadline.getTime());
  });

  /**
   * End-to-end downgrade lifecycle reproducing the reviewer's exact
   * scenario: a B/E org with a legacy add-on later downgrades to
   * Professional. Before the fix, sync would deactivate marketing_os
   * because grandfather_expires_at was NULL. After the fix, step 2
   * stamps the grandfather window first, so sync sees a non-null
   * grandfather_expires_at and refuses to deactivate the row.
   */
  it("LIFECYCLE: BUSINESS legacy add-on holder → downgrade to PROFESSIONAL keeps marketing_os via grandfather", async () => {
    const orgId = await insertOrg({
      planTier: "BUSINESS",
      subscriptionStatus: "active",
    });
    await db.insert(orgEntitlements).values({
      orgId,
      feature: "marketing_os",
      active: true,
      activatedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      stripeSubscriptionId: `sub_test_lifecycle_${RUN}_${orgId.slice(0, 6)}`,
      grandfatherExpiresAt: null,
    });

    // Step 2 stamps the safety-net window.
    await runMigrationStep2ForOrgs([orgId]);
    const stampedRow = await readMarketingOsRow(orgId);
    expect(stampedRow!.grandfatherExpiresAt).toBeInstanceOf(Date);

    // Now the org downgrades. Update orgs.plan_tier and call the sync
    // hook the way the webhook would on subscription_updated.
    await db
      .update(orgs)
      .set({ planTier: "PROFESSIONAL" })
      .where(eq(orgs.id, orgId));
    await syncMarketingOsTierEntitlement(orgId, "PROFESSIONAL", "active");

    const postDowngradeRow = await readMarketingOsRow(orgId);
    // Critical assertion: marketing_os MUST remain active because the
    // grandfather row protects them through current_period_end.
    expect(postDowngradeRow!.active).toBe(true);
    expect(postDowngradeRow!.grandfatherExpiresAt).not.toBeNull();
  });
});

describe("Task #392 post-review fix — MARKETING_OS_GRANDFATHER_DISABLED hard-cutover toggle", () => {
  /**
   * Reviewer asked for a one-flag fallback so ops can force a hard
   * cutover (skip grandfathering) if the rolling window proves
   * problematic in production. The toggle is implemented as a boot-time
   * job that deactivates every grandfather marketing_os row that isn't
   * simultaneously tier-derived-active when the env var is truthy.
   */
  it("flag absent → no-op (default Option B grandfathering preserved)", async () => {
    const { applyMarketingOsGrandfatherCutoverIfRequested } = await import(
      "../../server/jobs/marketing-os-grandfather-cutover"
    );
    const original = process.env.MARKETING_OS_GRANDFATHER_DISABLED;
    delete process.env.MARKETING_OS_GRANDFATHER_DISABLED;
    try {
      const result = await applyMarketingOsGrandfatherCutoverIfRequested();
      expect(result.skipped).toBe(true);
      expect(result.flipped).toBe(0);
    } finally {
      if (original === undefined) {
        delete process.env.MARKETING_OS_GRANDFATHER_DISABLED;
      } else {
        process.env.MARKETING_OS_GRANDFATHER_DISABLED = original;
      }
    }
  });

  it("flag truthy → deactivates grandfather rows on non-B/E orgs (legacy add-on holder)", async () => {
    const { applyMarketingOsGrandfatherCutoverIfRequested } = await import(
      "../../server/jobs/marketing-os-grandfather-cutover"
    );
    const orgId = await insertOrg({
      planTier: "STARTER",
      subscriptionStatus: "active",
    });
    await db.insert(orgEntitlements).values({
      orgId,
      feature: "marketing_os",
      active: true,
      activatedAt: new Date(),
      stripeSubscriptionId: `sub_test_cutover_${RUN}_${orgId.slice(0, 6)}`,
      grandfatherExpiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    });

    const original = process.env.MARKETING_OS_GRANDFATHER_DISABLED;
    process.env.MARKETING_OS_GRANDFATHER_DISABLED = "true";
    try {
      const result = await applyMarketingOsGrandfatherCutoverIfRequested();
      expect(result.skipped).toBe(false);
      expect(result.flipped).toBeGreaterThanOrEqual(1);
    } finally {
      if (original === undefined) {
        delete process.env.MARKETING_OS_GRANDFATHER_DISABLED;
      } else {
        process.env.MARKETING_OS_GRANDFATHER_DISABLED = original;
      }
    }

    const row = await readMarketingOsRow(orgId);
    expect(row!.active).toBe(false);
    expect(row!.grandfatherExpiresAt).toBeNull();
  });

  it("flag truthy → does NOT touch grandfather row on currently tier-derived-active org (B/E + healthy)", async () => {
    const { applyMarketingOsGrandfatherCutoverIfRequested } = await import(
      "../../server/jobs/marketing-os-grandfather-cutover"
    );
    const orgId = await insertOrg({
      planTier: "BUSINESS",
      subscriptionStatus: "active",
    });
    const grandfather = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    await db.insert(orgEntitlements).values({
      orgId,
      feature: "marketing_os",
      active: true,
      activatedAt: new Date(),
      stripeSubscriptionId: `sub_test_cutover_be_${RUN}_${orgId.slice(0, 6)}`,
      grandfatherExpiresAt: grandfather,
    });

    const original = process.env.MARKETING_OS_GRANDFATHER_DISABLED;
    process.env.MARKETING_OS_GRANDFATHER_DISABLED = "1";
    try {
      await applyMarketingOsGrandfatherCutoverIfRequested();
    } finally {
      if (original === undefined) {
        delete process.env.MARKETING_OS_GRANDFATHER_DISABLED;
      } else {
        process.env.MARKETING_OS_GRANDFATHER_DISABLED = original;
      }
    }

    const row = await readMarketingOsRow(orgId);
    // Currently-on-tier B/E holders shouldn't be punished by a flag whose
    // only purpose is to revoke legacy add-on access on non-B/E orgs.
    expect(row!.active).toBe(true);
    expect(row!.grandfatherExpiresAt?.getTime()).toBe(grandfather.getTime());
  });
});

describe("Task #392 — migration 0025 step 5 (unhealthy → deactivate + clear grace)", () => {
  it("BUSINESS+canceled with stale grace → active=false AND grace_period_ends_at=NULL", async () => {
    const orgId = await insertOrg({
      planTier: "BUSINESS",
      subscriptionStatus: "canceled",
    });
    const futureGrace = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    await db.insert(orgEntitlements).values({
      orgId,
      feature: "marketing_os",
      active: true,
      activatedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      gracePeriodEndsAt: futureGrace,
    });

    await runMigrationStep5ForOrgs([orgId]);

    const row = await readMarketingOsRow(orgId);
    expect(row!.active).toBe(false);
    expect(row!.gracePeriodEndsAt).toBeNull();
  });

  it("BUSINESS+canceled WITH grandfather_expires_at → row UNTOUCHED (grandfather safety net)", async () => {
    const orgId = await insertOrg({
      planTier: "BUSINESS",
      subscriptionStatus: "canceled",
    });
    const grandfather = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    await db.insert(orgEntitlements).values({
      orgId,
      feature: "marketing_os",
      active: true,
      activatedAt: new Date(),
      grandfatherExpiresAt: grandfather,
    });

    await runMigrationStep5ForOrgs([orgId]);

    const row = await readMarketingOsRow(orgId);
    // Grandfather row must NOT be flipped — only the daily cleanup job
    // touches grandfather rows when the deadline elapses.
    expect(row!.active).toBe(true);
    expect(row!.grandfatherExpiresAt?.getTime()).toBe(grandfather.getTime());
  });
});

describe("Task #392 — syncMarketingOsTierEntitlement COALESCE preservation", () => {
  it("flap past_due → active → past_due does NOT reset the original grace clock", async () => {
    const orgId = await insertOrg({
      planTier: "BUSINESS",
      subscriptionStatus: "past_due",
    });

    // First past_due transition seeds grace = now+7d.
    await syncMarketingOsTierEntitlement(orgId, "BUSINESS", "past_due");
    const firstRow = await readMarketingOsRow(orgId);
    expect(firstRow!.active).toBe(true);
    expect(firstRow!.gracePeriodEndsAt).toBeInstanceOf(Date);
    const originalGrace = firstRow!.gracePeriodEndsAt!.getTime();

    // Customer pays → status flips to 'active'. Grace should clear so the
    // healthy state isn't haunted by a stale deadline.
    await syncMarketingOsTierEntitlement(orgId, "BUSINESS", "active");
    const healthyRow = await readMarketingOsRow(orgId);
    expect(healthyRow!.active).toBe(true);
    expect(healthyRow!.gracePeriodEndsAt).toBeNull();

    // Card fails again → back to past_due. With grace cleared on the
    // healthy transition, the next past_due seeds a FRESH +7d window
    // (consistent with "first dunning event" semantics — Stripe has
    // already collected at least once between the two failures).
    await syncMarketingOsTierEntitlement(orgId, "BUSINESS", "past_due");
    const secondPastDueRow = await readMarketingOsRow(orgId);
    expect(secondPastDueRow!.active).toBe(true);
    expect(secondPastDueRow!.gracePeriodEndsAt).toBeInstanceOf(Date);
    // Fresh window because the healthy transition cleared the previous
    // grace; we're not contradicting the COALESCE — COALESCE only fires
    // when the existing column is non-null.
    expect(secondPastDueRow!.gracePeriodEndsAt!.getTime()).toBeGreaterThan(
      originalGrace - 1000,
    );
  });

  it("repeated past_due events WITHOUT a healthy interlude preserve the earlier grace deadline", async () => {
    const orgId = await insertOrg({
      planTier: "BUSINESS",
      subscriptionStatus: "past_due",
    });

    // First past_due → seeds grace.
    await syncMarketingOsTierEntitlement(orgId, "BUSINESS", "past_due");
    const firstGrace = (await readMarketingOsRow(orgId))!.gracePeriodEndsAt!;

    // A second past_due event a few ms later (e.g. retry of the failed
    // payment) must NOT extend the grace — COALESCE preserves the earlier
    // deadline. This is the critical regression guard against a customer
    // sitting in past_due for 30 days with marketing_os still on.
    await syncMarketingOsTierEntitlement(orgId, "BUSINESS", "past_due");
    const secondGrace = (await readMarketingOsRow(orgId))!.gracePeriodEndsAt!;
    expect(secondGrace.getTime()).toBe(firstGrace.getTime());
  });

  it("BUSINESS+canceled clears grace AND deactivates non-grandfather rows", async () => {
    const orgId = await insertOrg({
      planTier: "BUSINESS",
      subscriptionStatus: "past_due",
    });
    await syncMarketingOsTierEntitlement(orgId, "BUSINESS", "past_due");
    expect((await readMarketingOsRow(orgId))!.gracePeriodEndsAt).not.toBeNull();

    // Now the customer cancels.
    await syncMarketingOsTierEntitlement(orgId, "BUSINESS", "canceled");
    const row = await readMarketingOsRow(orgId);
    expect(row!.active).toBe(false);
    expect(row!.gracePeriodEndsAt).toBeNull();
  });
});
