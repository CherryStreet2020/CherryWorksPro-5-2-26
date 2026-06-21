/**
 * Security regression (audit #11): a boot-time data migration used to hard-code a
 * plaintext password ("Jetsin2026!") for dd2011@me.com and, on EVERY startup,
 * force-reset that account's password + role='ADMIN' and the org's
 * plan_tier='ENTERPRISE' whenever they had drifted. That defeated password
 * rotation (silently reverting any change on the next deploy) and embedded a
 * working credential in git history.
 *
 * The block was removed from server/migrate-production.ts. This test proves
 * runProductionMigrations() no longer mutates a matching account's password/role
 * or its org tier — it would have FAILED on the old code (password -> a bcrypt
 * hash of Jetsin2026!, role -> ADMIN, plan_tier -> ENTERPRISE).
 *
 * In-process real-DB pattern mirrors tests/integration/field-crypto-reencrypt-route.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.hoisted(() => {
  process.env.BANKING_ENCRYPTION_KEY ||=
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  process.env.SMTP_ENCRYPTION_KEY ||=
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

import { db } from "../../server/db";
import { orgs, users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { runProductionMigrations } from "../../server/migrate-production";

const ORG_ID = randomUUID();
const USER_ID = randomUUID();
// A recognizable non-bcrypt sentinel: the old block would overwrite this with a
// bcrypt hash of "Jetsin2026!".
const SENTINEL_PASSWORD = `sentinel-${USER_ID}`;

beforeAll(async () => {
  await db.insert(orgs).values({
    id: ORG_ID,
    name: "Boot Migration Test Org",
    slug: `bootmig-${ORG_ID.slice(0, 8)}`,
    planTier: "PROFESSIONAL",
  });
  await db.insert(users).values({
    id: USER_ID,
    orgId: ORG_ID,
    // The exact identity the removed block targeted.
    email: "dd2011@me.com",
    name: "Dean Dunagan",
    password: SENTINEL_PASSWORD,
    role: "MANAGER",
  });
}, 60_000);

afterAll(async () => {
  // Leave the org row (fresh UUID; cwp_test is recreated each run) — only the
  // seeded user needs removing.
  await db.delete(users).where(eq(users.id, USER_ID));
});

describe("boot migration no longer resets admin credentials (audit #11)", () => {
  it("runProductionMigrations leaves a dd2011@me.com / 'Dean Dunagan' account's password, role, and org tier untouched", async () => {
    await runProductionMigrations();

    const [u] = await db.select().from(users).where(eq(users.id, USER_ID));
    expect(u.password).toBe(SENTINEL_PASSWORD); // not re-hashed to Jetsin2026!
    expect(u.role).toBe("MANAGER"); // not escalated to ADMIN

    const [o] = await db.select().from(orgs).where(eq(orgs.id, ORG_ID));
    expect(o.planTier).toBe("PROFESSIONAL"); // not forced to ENTERPRISE
  }, 60_000);
});
