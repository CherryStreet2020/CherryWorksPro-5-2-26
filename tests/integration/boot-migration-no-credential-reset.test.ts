/**
 * Security regression guard (audit #11).
 *
 * server/migrate-production.ts ran a data-migration block on EVERY startup that
 * force-RESET an EXISTING admin account's password + role and the org's plan tier
 * back to hard-coded values (via `UPDATE users SET password = ..., role = 'ADMIN'`)
 * whenever they had drifted — defeating password rotation and embedding a working
 * credential in committed git history.
 *
 * The fix removed that block. The contract was verified BEHAVIORALLY during review
 * (seeding the matching account, running the real runProductionMigrations(), and
 * asserting password/role/tier unchanged — which fails on the pre-fix code). This
 * persistent guard pins the specific invariant the block violated, STRUCTURALLY,
 * so it is deterministic and does not run the full boot migration (which performs
 * global DDL on the shared test DB) inside the parallel suite: the boot migration
 * must not RESET an existing account's password. It is value-agnostic, so it
 * catches any reintroduction regardless of the credential.
 *
 * Out of scope (intentionally NOT asserted): the disaster-recovery bootstrap that
 * INSERTs a brand-new admin with temp_password=true ONLY when no admin exists
 * anywhere. That is a distinct, accepted create-if-missing pattern (the user is
 * forced to change the temp password on first login), not a reset of an existing
 * account.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = readFileSync(
  fileURLToPath(new URL("../../server/migrate-production.ts", import.meta.url)),
  "utf8",
);

describe("boot migration never resets an existing user's credentials (audit #11)", () => {
  it("performs no boot-time RESET of an existing account's password (value-agnostic)", () => {
    // A boot data-migration must not hash or compare passwords at all — any
    // password (re)set requires this, so its absence forecloses re-introduction
    // of a boot-time credential reset regardless of the specific value.
    expect(SRC).not.toMatch(/\bbcrypt\b/);
    // No raw-SQL password reset of an existing row...
    expect(SRC).not.toMatch(/UPDATE\s+users\s+SET\s+password/i);
    // ...and no Drizzle-style password update either.
    expect(SRC).not.toMatch(/\.set\(\s*\{[^}]*\bpassword\b/i);
  });
});
