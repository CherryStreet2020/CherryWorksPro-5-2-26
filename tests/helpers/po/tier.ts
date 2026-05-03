/**
 * Tier + entitlement helpers for E2E specs (Task #435).
 *
 * Direct-DB shortcuts so a downstream spec can flip an isolated org's
 * `plan_tier` / `subscription_status` (typically minted by the
 * `isolatedOrg` fixture at BUSINESS-active) and grant or revoke
 * persisted `org_entitlements` rows without round-tripping through
 * Stripe.
 *
 * Why direct DB:
 *   - We never want test traffic talking to live Stripe.
 *   - Many CI envs lack STRIPE_SECRET_KEY entirely; webhook-driven
 *     paths would 503 before the entitlement ever flips.
 *   - Tier flips need to be instantaneous and synchronous so the very
 *     next page-load reflects the new gate.
 *
 * Architectural caveat — `marketing_os` is partially tier-derived.
 * `EntitlementService` re-derives `marketing_os = true` whenever
 * plan_tier ∈ {BUSINESS,ENTERPRISE} AND subscription_status is
 * healthy (see server/services/marketing-os-tier.ts). That means
 * `setEntitlement(orgId, "marketing_os", false)` while the org is on
 * BUSINESS will appear to be a no-op via the read-path overlay. The
 * spec must ALSO drop the tier (e.g. `setOrgTier(orgId, "STARTER")`)
 * to fully revoke marketing_os. This mirrors production semantics
 * exactly — a manual revoke from billing/admin tooling on a B/E org
 * is similarly a no-op.
 *
 * Conversely, `setEntitlement(orgId, "marketing_os", true)` on a
 * Starter/Professional org IS honored — it acts like a manually
 * granted (or grandfathered) entitlement. That's the variant the
 * `marketing-os-locked` family of specs uses.
 */
import { TIER_ORDER } from "@shared/tier-order";
import type { OrgEntitlementFeature } from "@shared/schema";
import { Pool } from "pg";

let _pool: Pool | null = null;
function pool(): Pool {
  if (_pool) return _pool;
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "[e2e tier] DATABASE_URL is not set; cannot mutate tier/entitlements.",
    );
  }
  _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return _pool;
}

export async function closeTierPool(): Promise<void> {
  if (_pool) {
    await _pool.end().catch(() => undefined);
    _pool = null;
  }
}

export type Tier = keyof typeof TIER_ORDER;
export const VALID_TIERS = Object.keys(TIER_ORDER) as Tier[];

/**
 * Set an org's `plan_tier` (and optionally `subscription_status`).
 * No Stripe contact. Returns true if the row was updated.
 */
export async function setOrgTier(
  orgId: string,
  tier: Tier,
  subscriptionStatus: string = "active",
): Promise<boolean> {
  if (!VALID_TIERS.includes(tier)) {
    throw new Error(
      `[e2e tier] Invalid tier "${tier}". Valid: ${VALID_TIERS.join(", ")}`,
    );
  }
  const r = await pool().query(
    `UPDATE orgs
        SET plan_tier = $1,
            subscription_status = $2,
            updated_at = NOW()
      WHERE id = $3`,
    [tier, subscriptionStatus, orgId],
  );
  return (r.rowCount ?? 0) > 0;
}

/**
 * Grant or revoke a persisted `org_entitlements` row.
 *
 * `granted=true` upserts an active row (clearing grace window).
 * `granted=false` flips active=false ONLY for non-grandfathered rows
 *   (matches the production sweep semantics in
 *   server/services/marketing-os-tier.ts) and clears the grace window.
 *
 * Returns the number of rows affected. With `strict=true` (default
 * `false`), throws if the operation matched zero rows — useful when
 * a spec wants the helper to fail fast on a typo'd orgId rather than
 * silently no-op. For grant=true the upsert always affects exactly
 * one row; strict-mode is mainly meaningful for revokes.
 *
 * NOTE on tier-derived overlay: see module docstring. For
 * `marketing_os` you usually want to call `setOrgTier(...)` alongside
 * this helper.
 */
export async function setEntitlement(
  orgId: string,
  feature: OrgEntitlementFeature,
  granted: boolean,
  opts: { strict?: boolean } = {},
): Promise<number> {
  let affected: number;
  if (granted) {
    const r = await pool().query(
      `INSERT INTO org_entitlements (org_id, feature, active, activated_at, updated_at)
       VALUES ($1, $2, true, NOW(), NOW())
       ON CONFLICT (org_id, feature) DO UPDATE
         SET active = true,
             activated_at = COALESCE(org_entitlements.activated_at, NOW()),
             grace_period_ends_at = NULL,
             updated_at = NOW()`,
      [orgId, feature],
    );
    affected = r.rowCount ?? 0;
  } else {
    const r = await pool().query(
      `UPDATE org_entitlements
          SET active = false,
              grace_period_ends_at = NULL,
              updated_at = NOW()
        WHERE org_id = $1
          AND feature = $2
          AND grandfather_expires_at IS NULL`,
      [orgId, feature],
    );
    affected = r.rowCount ?? 0;
  }
  if (opts.strict && affected === 0) {
    throw new Error(
      `[e2e tier] setEntitlement(${orgId}, ${feature}, ${granted}) affected 0 rows in strict mode`,
    );
  }
  return affected;
}
