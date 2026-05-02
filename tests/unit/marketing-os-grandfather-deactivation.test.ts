/**
 * Task #392 post-review regression guard — verify all three deactivation
 * paths for grandfathered marketing_os rows clear `grandfatherExpiresAt`
 * alongside flipping `active=false`. The architect flagged that an
 * already-canceled grandfather hold would otherwise still surface a
 * contradictory "current access ends <date>" notice in the billing UI.
 *
 * We exercise this two ways:
 *   1. The cleanup job (exported, no DB plumbing required) — mocked-db
 *      unit test asserting the .set() payload.
 *   2. The webhook terminal branch + lazy-expire path — source-level
 *      regression guards. Both are deeply embedded in their host modules
 *      (webhook handler depends on Express + Stripe + Drizzle; lazy-expire
 *      is a private fire-and-forget inside fetchEntitlement* read paths)
 *      so a focused source-content assertion is the cleanest way to lock
 *      in the field-clearing without standing up the full integration.
 *
 * If any of these regress, the test fails with a clear pointer to the
 * exact path that lost the `grandfatherExpiresAt: null` clearing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..");

describe("Task #392 — grandfather deactivation paths clear grandfatherExpiresAt", () => {
  describe("expireGrandfatheredMarketingOs (daily cleanup job)", () => {
    beforeEach(() => {
      vi.resetModules();
    });

    it("SET payload includes both active=false AND grandfatherExpiresAt=null", async () => {
      // Capture the .set() payload by mocking the db chain. The job builds:
      //   db.update(table).set(payload).where(...).returning(...)
      // We grab the payload off the `set` spy.
      const setSpy = vi.fn();
      const whereSpy = vi.fn();
      const returningSpy = vi.fn().mockResolvedValue([]);
      const updateSpy = vi.fn(() => ({
        set: (payload: any) => {
          setSpy(payload);
          return {
            where: (cond: any) => {
              whereSpy(cond);
              return { returning: returningSpy };
            },
          };
        },
      }));

      vi.doMock("../../server/db", () => ({
        db: { update: updateSpy },
      }));

      const { expireGrandfatheredMarketingOs } = await import(
        "../../server/jobs/expire-grandfathered-marketing-os"
      );

      const out = await expireGrandfatheredMarketingOs();

      expect(out).toEqual({ flipped: 0 });
      expect(setSpy).toHaveBeenCalledTimes(1);
      const payload = setSpy.mock.calls[0][0];
      expect(payload.active).toBe(false);
      // The critical post-review fix:
      expect(payload.grandfatherExpiresAt).toBeNull();
      // Sanity-check the rest of the payload is well-formed.
      expect(payload.updatedAt).toBeInstanceOf(Date);
    });

    it("soft-fails (returns flipped:0) if org_entitlements relation is missing (42P01)", async () => {
      vi.doMock("../../server/db", () => ({
        db: {
          update: () => ({
            set: () => ({
              where: () => ({
                returning: () => {
                  const err: any = new Error("relation does not exist");
                  err.code = "42P01";
                  throw err;
                },
              }),
            }),
          }),
        },
      }));

      const { expireGrandfatheredMarketingOs } = await import(
        "../../server/jobs/expire-grandfathered-marketing-os"
      );

      const out = await expireGrandfatheredMarketingOs();
      expect(out).toEqual({ flipped: 0 });
    });
  });

  describe("syncMarketingOsTierEntitlement preserves grandfather metadata", () => {
    /**
     * Critical lifecycle regression guard: a legacy add-on holder who
     * upgrades from Starter (grandfathered) to Business must NOT lose their
     * grandfather safety net on the upsert. If they later downgrade back to
     * Professional within the original add-on period, the grandfather row
     * needs to keep marketing_os live until the original deadline. This is
     * enforced by setting grandfatherExpiresAt to the existing column value
     * (a no-op SQL-side) in the onConflictDoUpdate.set map, NEVER to null.
     */
    it("upsert SET map references existing grandfatherExpiresAt column (no clobber to null)", () => {
      const src = readFileSync(
        join(REPO_ROOT, "server/services/marketing-os-tier.ts"),
        "utf8",
      );
      // Post-Fix-#1 refactor: the SET block is now built as a named local
      // (`const setBlock: Record<string, any> = { ... }`) and passed to
      // `set: setBlock` so the past_due grace branch can conditionally
      // override `gracePeriodEndsAt`. We therefore search the setBlock
      // declaration for the grandfather mapping.
      expect(src).toMatch(/onConflictDoUpdate\(/);
      // The setBlock declaration must reference the existing column value
      // for grandfatherExpiresAt (preserving the upgrade-then-downgrade
      // safety net) — NEVER clobber to null inside this declaration.
      const preserveBlock =
        /const\s+setBlock[^=]*=\s*\{[\s\S]*?grandfatherExpiresAt:\s*sql`[^`]*orgEntitlements\.grandfatherExpiresAt[^`]*`/;
      expect(src).toMatch(preserveBlock);
      // And it must NOT clobber to literal null inside the setBlock decl.
      const clobberBlock =
        /const\s+setBlock[^=]*=\s*\{[\s\S]*?grandfatherExpiresAt:\s*null[\s\S]*?\};/;
      expect(src).not.toMatch(clobberBlock);
      // Belt-and-suspenders: the onConflictDoUpdate call must wire the
      // setBlock through (not a literal `set: { ... }` with a null
      // clobber).
      expect(src).toMatch(/onConflictDoUpdate\(\{[\s\S]*?set:\s*setBlock/);
    });
  });

  describe("source-level regression guards", () => {
    /**
     * The webhook terminal path lives inside `handleAddonSubscriptionEvent`
     * and the lazy-expire path lives inside a private fire-and-forget in
     * `entitlements.ts`. Standing up Express + Stripe + Drizzle just to
     * assert a SET payload is overkill; instead we lock in the post-review
     * fix with a source-content assertion. If a future refactor drops the
     * `grandfatherExpiresAt: null` clearing from either site, this test
     * fires immediately with a clear pointer.
     */
    it("server/stripe_webhook.ts deactivate branch sets grandfatherExpiresAt: null", () => {
      const src = readFileSync(
        join(REPO_ROOT, "server/stripe_webhook.ts"),
        "utf8",
      );
      // The marketing_os deactivate branch is the only place in this file
      // where we both assign `active: false` and clear the grandfather
      // field. Assert the literal string appears within ~10 lines after the
      // deactivate branch comment.
      expect(src).toMatch(/decision\.action === "deactivate"/);
      // Match a SET block that contains BOTH active:false AND
      // grandfatherExpiresAt:null (whitespace-tolerant).
      const setBlock =
        /\.set\(\s*\{[^}]*active:\s*false[^}]*grandfatherExpiresAt:\s*null[^}]*\}\s*\)/;
      expect(src).toMatch(setBlock);
    });

    it("server/services/entitlements.ts lazy-expire path sets grandfatherExpiresAt: null", () => {
      const src = readFileSync(
        join(REPO_ROOT, "server/services/entitlements.ts"),
        "utf8",
      );
      expect(src).toMatch(/function lazyExpireGrandfather/);
      const setBlock =
        /\.set\(\s*\{[^}]*active:\s*false[^}]*grandfatherExpiresAt:\s*null[^}]*\}\s*\)/;
      expect(src).toMatch(setBlock);
    });

    it("server/jobs/expire-grandfathered-marketing-os.ts cleanup query sets grandfatherExpiresAt: null", () => {
      const src = readFileSync(
        join(REPO_ROOT, "server/jobs/expire-grandfathered-marketing-os.ts"),
        "utf8",
      );
      const setBlock =
        /\.set\(\s*\{\s*active:\s*false,\s*grandfatherExpiresAt:\s*null/;
      expect(src).toMatch(setBlock);
    });
  });

  /**
   * Architect pass-3 regression: the Stripe-aware backfill that overwrites
   * the migration's NOW()+30d sentinel must NOT honor a "forward-only" rule
   * — Stripe's `current_period_end` is the source of truth and the sentinel
   * is just a placeholder. If Stripe's value is *earlier* than the
   * sentinel, we MUST shorten (or deactivate when already elapsed) so the
   * over-grant window collapses on first prod boot rather than lingering
   * until the sentinel date hits the daily cleanup.
   */
  describe("backfillMarketingOsGrandfatherFromStripe — over-grant collapse", () => {
    beforeEach(() => {
      vi.resetModules();
      delete (process.env as any).STRIPE_SECRET_KEY;
    });

    it("source explicitly handles 'CPE earlier than sentinel' as a shorten/deactivate path (no forward-only)", () => {
      const src = readFileSync(
        join(
          REPO_ROOT,
          "server/jobs/backfill-marketing-os-grandfather-from-stripe.ts",
        ),
        "utf8",
      );
      // Forward-only would look like `if (existing && existing >= authoritative) continue;`
      // Lock that anti-pattern out.
      expect(src).not.toMatch(/existing\s*>=\s*authoritative/);
      // Confirm the elapsed-CPE branch deactivates instead of leaving the row.
      expect(src).toMatch(/authoritative\.getTime\(\)\s*<=\s*now\.getTime\(\)/);
      expect(src).toMatch(
        /active:\s*false,[\s\S]{0,80}grandfatherExpiresAt:\s*null/,
      );
    });

    it("EVERY backfill UPDATE includes the active=true guard (all 4 branches)", () => {
      const src = readFileSync(
        join(
          REPO_ROOT,
          "server/jobs/backfill-marketing-os-grandfather-from-stripe.ts",
        ),
        "utf8",
      );
      // The backfill emits exactly 4 UPDATE statements: Stripe-404 deactivate,
      // terminal-status deactivate, elapsed-CPE deactivate, authoritative-CPE
      // overwrite. Each must carry the active=true belt-and-suspenders guard
      // so the backfill can never accidentally resurrect a row that was
      // already deactivated by the boot cleanup sweep, a webhook, or a
      // concurrent admin action. The initial SELECT also filters on
      // active=true, so total guards = 4 (UPDATE) + 1 (SELECT) = 5.
      const updateCalls = src.match(/db\s*\n?\s*\.update\(orgEntitlements\)/g);
      const activeGuards = src.match(/eq\(orgEntitlements\.active,\s*true\)/g);
      expect(updateCalls?.length ?? 0).toBe(4);
      expect(activeGuards?.length ?? 0).toBe(5);

      // Verify each UPDATE block is followed by a .where(...) that
      // includes the active=true guard within a small lookahead window.
      // This pins each branch to the guard rather than just counting
      // totals, which would pass even if guards were lopsidedly placed.
      const updateBlocks = src.split(/db\s*\n?\s*\.update\(orgEntitlements\)/);
      // First chunk is the prologue; subsequent chunks each begin
      // immediately after a `db.update(orgEntitlements)`.
      for (let i = 1; i < updateBlocks.length; i++) {
        const branch = updateBlocks[i].slice(0, 600);
        expect(branch).toMatch(/eq\(orgEntitlements\.active,\s*true\)/);
      }
    });

    it("no-ops cleanly when STRIPE_SECRET_KEY is absent (dev / preview)", async () => {
      const { backfillMarketingOsGrandfatherFromStripe } = await import(
        "../../server/jobs/backfill-marketing-os-grandfather-from-stripe"
      );
      const out = await backfillMarketingOsGrandfatherFromStripe();
      expect(out).toEqual({
        scanned: 0,
        extended: 0,
        deactivated: 0,
        skipped: 0,
        errors: 0,
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Task #392 architect-flagged regression: a grandfathered marketing_os
  // row carrying both a future `grandfather_expires_at` AND an elapsed
  // `grace_period_ends_at` (seeded by syncMarketingOsTierEntitlement
  // during a past_due window) must NOT be revoked by the grace lazy-
  // expire path or the boot sweep. Grandfather window is the source of
  // truth for marketing_os while it's open.
  // ─────────────────────────────────────────────────────────────────────
  describe("grandfather window outranks grace expiry for marketing_os", () => {
    it("fetchEntitlementMap source: grace lazy-expire is gated on !grandfatherActive", () => {
      const src = readFileSync(
        join(REPO_ROOT, "server/services/entitlements.ts"),
        "utf8",
      );
      // The previous bug was: `if (row.active && graceExpired) { lazyExpire(...); continue; }`
      // ran for every row including marketing_os. The fixed predicate
      // must include `&& !grandfatherActive` so a still-future
      // grandfather window suppresses the grace flip.
      expect(src).toMatch(
        /row\.active\s*&&\s*graceExpired\s*&&\s*!grandfatherActive/,
      );
    });

    it("fetchEntitlementDetails source: grace lazy-expire is gated on !grandfatherActive", () => {
      const src = readFileSync(
        join(REPO_ROOT, "server/services/entitlements.ts"),
        "utf8",
      );
      // Mirror of the map fixer — same bug class, same fix shape.
      expect(src).toMatch(
        /graceEnds\s*<=\s*now\s*&&\s*!grandfatherActive/,
      );
    });

    it("sweepExpiredEntitlements source: WHERE clause excludes future-grandfather marketing_os rows", () => {
      const src = readFileSync(
        join(REPO_ROOT, "server/services/entitlements.ts"),
        "utf8",
      );
      // The boot sweep must not flip marketing_os rows whose grandfather
      // window is still in the future. Lock the OR-exclusion in place.
      // The exclusion has 3 disjuncts: (feature != marketing_os),
      // (grandfatherExpiresAt IS NULL), or (grandfatherExpiresAt < now).
      expect(src).toMatch(/ne\(orgEntitlements\.feature,\s*"marketing_os"\)/);
      expect(src).toMatch(/isNull\(orgEntitlements\.grandfatherExpiresAt\)/);
      // The lt() against grandfatherExpiresAt completes the disjunction so
      // an EXPIRED grandfather row still gets caught by the sweep.
      expect(src).toMatch(
        /lt\(orgEntitlements\.grandfatherExpiresAt,\s*sweepNow\)/,
      );
    });

    it("read fetchers also surface marketing_os as active when only the grandfather window grants it", () => {
      const src = readFileSync(
        join(REPO_ROOT, "server/services/entitlements.ts"),
        "utf8",
      );
      // After the fix, a row with active=false but a future grandfather
      // would fall through to the "set the map true" branch. Make sure
      // grandfatherActive participates in that OR.
      expect(src).toMatch(
        /row\.active\s*\|\|\s*inGrace\s*\|\|\s*grandfatherActive/,
      );
    });
  });
});
