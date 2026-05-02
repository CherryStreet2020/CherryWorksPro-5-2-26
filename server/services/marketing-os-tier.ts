/**
 * Task #392 — Tier-derived `marketing_os` entitlement.
 *
 * As of this task, `marketing_os` is no longer a standalone Stripe add-on
 * SKU. Instead it is granted automatically whenever the org's base
 * subscription is on the BUSINESS or ENTERPRISE plan_tier with a healthy
 * subscription_status. Existing add-on holders on Starter/Professional
 * are grandfathered until their Stripe `current_period_end` (Option B in
 * the migration plan); the column `org_entitlements.grandfather_expires_at`
 * carries that deadline.
 *
 * This module owns the pure helper used by both the read-path overlay
 * (server/services/entitlements.ts) and the webhook-side write hook
 * (server/stripe_webhook.ts). Keeping it standalone makes it trivial to
 * unit-test without booting Stripe / Drizzle plumbing.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { orgEntitlements } from "@shared/schema";

/**
 * Plan tiers that auto-grant `marketing_os`. Kept here (not in
 * stripe-addon-prices.ts) so the helper has zero coupling to the addon
 * config — addon prices remain configured for legacy webhook routing.
 */
export const MARKETING_OS_TIERS = ["BUSINESS", "ENTERPRISE"] as const;
export type MarketingOsTier = (typeof MARKETING_OS_TIERS)[number];

/**
 * Subscription statuses that *unconditionally* keep marketing_os flipped on
 * for a B/E org. `past_due` is intentionally NOT in this set: it is
 * honored only inside a bounded 7-day grace window — see
 * `MARKETING_OS_GRACE_STATUSES` and `MARKETING_OS_PAST_DUE_GRACE_DAYS`
 * below. This mirrors the bounded grace semantics that paid add-ons
 * already use, so transient payment failures get the customer 7 days to
 * fix billing without yanking access mid-cycle, but a stuck-past_due
 * subscription cannot keep Marketing OS active forever.
 */
export const MARKETING_OS_HEALTHY_STATUSES = ["active", "trialing"] as const;

/**
 * Subscription statuses that grant marketing_os ONLY within a bounded
 * grace window (see `MARKETING_OS_PAST_DUE_GRACE_DAYS`). The grace
 * deadline lives on `org_entitlements.grace_period_ends_at` and is
 * seeded by `syncMarketingOsTierEntitlement` the first time the status
 * flips to `past_due`. The read-path overlay (entitlements.ts) re-checks
 * the deadline on every read; the existing `lazyExpire` flips the row
 * to `active=false` once the deadline passes.
 */
export const MARKETING_OS_GRACE_STATUSES = ["past_due"] as const;
export const MARKETING_OS_PAST_DUE_GRACE_DAYS = 7;

/**
 * Pure tier-derivation predicate. Returns true iff the org's base plan
 * grants marketing_os AND the subscription is healthy.
 *
 * For `past_due` (the only grace status today) the caller MUST pass
 * `gracePeriodEndsAt` so we can enforce the bounded 7-day window. When
 * called from the read-path overlay this comes from the persisted
 * `org_entitlements.grace_period_ends_at` row; when called from contexts
 * that don't have the row handy (e.g. webhook write-side checks before
 * the row exists) you may pass `undefined` — past_due will then be
 * treated as inactive until the write hook persists the grace deadline.
 */
export function marketingOsActiveFromTier(
  planTier: string | null | undefined,
  subscriptionStatus: string | null | undefined,
  gracePeriodEndsAt?: Date | string | null,
): boolean {
  if (!planTier || !subscriptionStatus) return false;
  if (!(MARKETING_OS_TIERS as readonly string[]).includes(planTier)) return false;
  if ((MARKETING_OS_HEALTHY_STATUSES as readonly string[]).includes(subscriptionStatus)) {
    return true;
  }
  if ((MARKETING_OS_GRACE_STATUSES as readonly string[]).includes(subscriptionStatus)) {
    if (!gracePeriodEndsAt) return false;
    const ends =
      gracePeriodEndsAt instanceof Date
        ? gracePeriodEndsAt
        : new Date(gracePeriodEndsAt);
    return Number.isFinite(ends.getTime()) && ends.getTime() > Date.now();
  }
  return false;
}

/**
 * Compute the bounded past_due grace deadline. Returns `now + 7d` for
 * fresh past_due transitions, or preserves any existing earlier deadline
 * (so a customer who's been in past_due for 5 days, briefly recovers,
 * then re-enters past_due doesn't get a fresh 7-day clock). Returns
 * null for any non-grace status.
 */
export function computeMarketingOsPastDueGraceEndsAt(
  subscriptionStatus: string | null | undefined,
  existingGracePeriodEndsAt: Date | null | undefined,
  now: Date = new Date(),
): Date | null {
  if (
    !subscriptionStatus ||
    !(MARKETING_OS_GRACE_STATUSES as readonly string[]).includes(subscriptionStatus)
  ) {
    return null;
  }
  const fresh = new Date(
    now.getTime() + MARKETING_OS_PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000,
  );
  if (
    existingGracePeriodEndsAt &&
    existingGracePeriodEndsAt instanceof Date &&
    Number.isFinite(existingGracePeriodEndsAt.getTime()) &&
    existingGracePeriodEndsAt.getTime() < fresh.getTime()
  ) {
    return existingGracePeriodEndsAt;
  }
  return fresh;
}

/**
 * Webhook write-side hook. Called after the base-plan handlers update
 * `orgs.plan_tier` / `orgs.subscription_status`. Maintains the persisted
 * `org_entitlements` row so admin tooling and DB inspections see a
 * consistent picture. The read-path overlay re-derives the tier-derived
 * boolean on every read regardless, so this hook is purely for tidiness
 * and audit-log fodder — never the source of truth.
 *
 * Behavior:
 *   • tier-derived ACTIVE → upsert active=true. For NEW rows we leave
 *     grandfather null; for EXISTING rows we **preserve** any existing
 *     `grandfather_expires_at` so a legacy add-on holder who upgrades to
 *     Business doesn't lose their grandfather safety net (if they later
 *     downgrade to Professional within the add-on period, the grandfather
 *     row keeps marketing_os live until the original deadline).
 *   • tier-derived INACTIVE → flip the row's `active` column to false,
 *     BUT leave any grandfather hold (`grandfather_expires_at IS NOT NULL`)
 *     completely untouched. The grandfather window is the authoritative
 *     deadline for legacy holders; we never shorten or revoke it here.
 */
export async function syncMarketingOsTierEntitlement(
  orgId: string,
  planTier: string | null | undefined,
  subscriptionStatus: string | null | undefined,
): Promise<void> {
  const now = new Date();
  const inHealthyTier = !!(
    planTier && (MARKETING_OS_TIERS as readonly string[]).includes(planTier)
  );
  const isHealthy =
    inHealthyTier &&
    !!subscriptionStatus &&
    (MARKETING_OS_HEALTHY_STATUSES as readonly string[]).includes(
      subscriptionStatus,
    );
  const isGrace =
    inHealthyTier &&
    !!subscriptionStatus &&
    (MARKETING_OS_GRACE_STATUSES as readonly string[]).includes(
      subscriptionStatus,
    );

  if (isHealthy || isGrace) {
    // Tier-derived ACTIVE (active/trialing) → upsert active=true, clear
    // grace.
    // Tier-derived GRACE (past_due) → upsert active=true with a bounded
    // 7-day grace window seeded by COALESCE(existing, now+7d) so a flap
    // (past_due → active → past_due) doesn't reset the clock.
    const setBlock: Record<string, any> = {
      active: true,
      // Preserve activatedAt if already set; only stamp on first activation.
      activatedAt: sql`COALESCE(${orgEntitlements.activatedAt}, ${now})`,
      // PRESERVE existing grandfather_expires_at. A legacy add-on holder
      // who upgrades to Business must not lose their grandfather safety
      // net — if they later downgrade back to Professional within the
      // original add-on period, the grandfather row keeps marketing_os
      // live until the original deadline.
      grandfatherExpiresAt: sql`${orgEntitlements.grandfatherExpiresAt}`,
      updatedAt: now,
    };
    if (isHealthy) {
      // Healthy status clears any prior past_due grace window.
      setBlock.gracePeriodEndsAt = null;
    } else {
      // past_due → seed grace = COALESCE(existing earlier, now+7d).
      const sevenDays = new Date(
        now.getTime() +
          MARKETING_OS_PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000,
      );
      setBlock.gracePeriodEndsAt = sql`COALESCE(${orgEntitlements.gracePeriodEndsAt}, ${sevenDays})`;
    }
    await db
      .insert(orgEntitlements)
      .values({
        orgId,
        feature: "marketing_os",
        active: true,
        activatedAt: now,
        grandfatherExpiresAt: null,
        gracePeriodEndsAt: isGrace
          ? new Date(
              now.getTime() +
                MARKETING_OS_PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000,
            )
          : null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [orgEntitlements.orgId, orgEntitlements.feature],
        set: setBlock,
      });
    return;
  }

  // Tier-derived inactive. Only flip non-grandfather rows; grandfather rows
  // continue to govern themselves until the daily cleanup job (or lazy-expire)
  // catches up at grandfather_expires_at. Also clear any stale grace window.
  await db
    .update(orgEntitlements)
    .set({ active: false, gracePeriodEndsAt: null, updatedAt: now })
    .where(
      and(
        eq(orgEntitlements.orgId, orgId),
        eq(orgEntitlements.feature, "marketing_os"),
        eq(orgEntitlements.active, true),
        isNull(orgEntitlements.grandfatherExpiresAt),
      ),
    );
}
