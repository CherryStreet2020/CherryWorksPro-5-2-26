/**
 * Security regression guard (audit #11).
 *
 * server/migrate-production.ts ran a data-migration block on EVERY startup that
 * hard-coded a plaintext password ("Jetsin2026!") for dd2011@me.com and
 * force-reset that account's password + role='ADMIN' and the org's
 * plan_tier='ENTERPRISE' whenever they had drifted. That embedded a working
 * credential in committed git history and silently reverted any password
 * rotation / role change on the next deploy.
 *
 * The fix removed the block. The contract was verified BEHAVIORALLY during
 * review (seeding a matching dd2011@me.com / "Dean Dunagan" account, running the
 * real runProductionMigrations(), and asserting password/role/tier unchanged —
 * which fails on the pre-fix code). This persistent guard pins the invariant
 * STRUCTURALLY instead, so it is deterministic and does not run the full boot
 * migration (which performs global DDL on the shared test DB) inside the parallel
 * suite: a boot data-migration must never embed a known credential or reset an
 * existing account's password.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = readFileSync(
  fileURLToPath(new URL("../../server/migrate-production.ts", import.meta.url)),
  "utf8",
);

describe("boot migration never embeds or resets a user's credentials (audit #11)", () => {
  it("contains no hard-coded credential and no boot-time password reset", () => {
    // The exact credential the removed block hard-coded.
    expect(SRC).not.toMatch(/Jetsin/i);
    // A boot data-migration must not hash or compare passwords at all — any
    // password (re)set requires this, so its absence forecloses re-introduction.
    expect(SRC).not.toMatch(/\bbcrypt\b/);
    // No raw-SQL password reset...
    expect(SRC).not.toMatch(/UPDATE\s+users\s+SET\s+password/i);
    // ...and no Drizzle-style password update either.
    expect(SRC).not.toMatch(/\.set\(\s*\{[^}]*\bpassword\b/i);
  });
});
