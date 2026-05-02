-- Task #392 — Tier-derive marketing_os; grandfather legacy add-on holders.
--
-- Adds the `grandfather_expires_at` column to `org_entitlements` AND drives
-- the table to the canonical post-migration state for marketing_os:
--
--   1. Business / Enterprise orgs with a healthy subscription_status get an
--      active marketing_os row (upsert; preserve any existing grandfather
--      window so an upgrade-then-downgrade keeps the safety net).
--   2. Orgs with an existing marketing_os row that came from the LEGACY
--      paid add-on (stripe_subscription_id IS NOT NULL) get grandfathered
--      to NOW()+1 day as a conservative sentinel — REGARDLESS of current
--      plan_tier. This is critical because a Business/Enterprise org with
--      a legacy add-on may LATER downgrade to Professional; without a
--      stamped grandfather window, syncMarketingOsTierEntitlement would
--      deactivate them on downgrade even though they paid for the add-on
--      through current_period_end. Stamping all legacy holders here gives
--      every paid add-on customer the same downgrade-protection safety
--      net. The add-on Stripe webhook (handleAddonSubscriptionEvent)
--      extends this forward to the authoritative current_period_end on
--      the next subscription event; an out-of-band Stripe-aware backfill
--      script can also replace the sentinel with the real period boundary.
--   3. Non-Business/Enterprise orgs with an active marketing_os row that
--      did NOT come from the legacy add-on (no stripe_subscription_id)
--      get deactivated outright — they should never have had marketing_os
--      under the new tier-derived rule, so we revoke immediately.
--
-- The migration is replayed on every boot via runPhase0SqlReplay; every
-- statement is idempotent (ADD COLUMN IF NOT EXISTS, conditional UPDATE/
-- INSERT with ON CONFLICT), so re-runs are safe.

-- ───────────────────────────────────────────────────────────────────────────
-- Step 1: schema column
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE org_entitlements
  ADD COLUMN IF NOT EXISTS grandfather_expires_at TIMESTAMPTZ;

-- ───────────────────────────────────────────────────────────────────────────
-- Step 2: backfill grandfather window for LEGACY paid add-on holders.
-- A row is "legacy paid add-on" iff it has a stripe_subscription_id (set by
-- the previous add-on checkout / webhook). NOW()+1 day is a SHORT safety
-- sentinel — intentionally tight so that if the Stripe-aware backfill in
-- server/jobs/backfill-marketing-os-grandfather-from-stripe.ts is delayed
-- or fails, we cannot over-grant Marketing OS for more than ~24h beyond
-- whatever the real period end was. The boot-time backfill overwrites
-- this sentinel with the authoritative `current_period_end` fetched
-- straight from Stripe; the per-event webhook handler does the same on
-- the next subscription event.
--
-- IMPORTANT: We stamp regardless of current plan_tier. A Business or
-- Enterprise org with a legacy add-on is still entitled to keep
-- marketing_os through their next current_period_end if they later
-- DOWNGRADE to Professional. Without a grandfather window stamped on
-- those rows, syncMarketingOsTierEntitlement() would deactivate them
-- on the very next subscription_updated event after downgrade, even
-- though they paid for the add-on through period end. The B/E branch
-- in step 4 explicitly preserves any existing grandfather window via
-- COALESCE so this stamp is invisible to currently-on-tier holders
-- but rescues them on later downgrade.
-- ───────────────────────────────────────────────────────────────────────────
UPDATE org_entitlements oe
SET grandfather_expires_at = NOW() + INTERVAL '1 day'
WHERE oe.feature = 'marketing_os'
  AND oe.active = true
  AND oe.grandfather_expires_at IS NULL
  AND oe.stripe_subscription_id IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- Step 3: deactivate active marketing_os rows on non-B/E orgs that did NOT
-- come from the legacy add-on. These rows shouldn't exist under the new
-- tier-derived rule (no Stripe sub means the org never paid for the add-on),
-- so they're revoked here. Keeping them active would over-grant access.
-- ───────────────────────────────────────────────────────────────────────────
UPDATE org_entitlements oe
SET active = false,
    updated_at = NOW()
WHERE oe.feature = 'marketing_os'
  AND oe.active = true
  AND oe.grandfather_expires_at IS NULL
  AND oe.stripe_subscription_id IS NULL
  AND EXISTS (
    SELECT 1 FROM orgs o
    WHERE o.id = oe.org_id
      AND o.plan_tier NOT IN ('BUSINESS', 'ENTERPRISE')
  );

-- ───────────────────────────────────────────────────────────────────────────
-- Step 4: upsert active marketing_os for Business / Enterprise orgs whose
-- subscription_status is healthy (active / trialing) OR within the bounded
-- 7-day past_due grace window (mirrors MARKETING_OS_HEALTHY_STATUSES +
-- MARKETING_OS_GRACE_STATUSES in server/services/marketing-os-tier.ts).
-- ON CONFLICT preserves any existing grandfather_expires_at (upgrade-then-
-- downgrade safety net). For past_due orgs we seed a 7-day grace window
-- via COALESCE(existing earlier, now+7d) so re-running the migration
-- never resets the clock for an org already mid-grace.
-- ───────────────────────────────────────────────────────────────────────────
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
ON CONFLICT (org_id, feature) DO UPDATE
  SET active = true,
      -- Preserve activated_at if already set; only stamp on first activation.
      activated_at = COALESCE(org_entitlements.activated_at, EXCLUDED.activated_at),
      -- Preserve any existing grandfather window (upgrade-then-downgrade
      -- safety net). EXCLUDED.grandfather_expires_at is NULL on this insert,
      -- so COALESCE picks the existing value when present.
      grandfather_expires_at = COALESCE(org_entitlements.grandfather_expires_at, EXCLUDED.grandfather_expires_at),
      -- For past_due, seed grace = COALESCE(existing earlier, now+7d) so
      -- replays don't reset the clock. For healthy, clear any stale grace.
      grace_period_ends_at = CASE
        WHEN EXCLUDED.grace_period_ends_at IS NULL THEN NULL
        ELSE COALESCE(org_entitlements.grace_period_ends_at, EXCLUDED.grace_period_ends_at)
      END,
      updated_at = NOW();

-- ───────────────────────────────────────────────────────────────────────────
-- Step 5: deactivate marketing_os for B/E orgs whose subscription_status is
-- UNHEALTHY (canceled, incomplete_expired, unpaid, etc.) — but only when
-- there's no grandfather window protecting access. Also clears any stale
-- grace window so the daily lazy-expire / cleanup don't see ghost grace.
-- ───────────────────────────────────────────────────────────────────────────
UPDATE org_entitlements oe
SET active = false,
    grace_period_ends_at = NULL,
    updated_at = NOW()
WHERE oe.feature = 'marketing_os'
  AND oe.active = true
  AND oe.grandfather_expires_at IS NULL
  AND EXISTS (
    SELECT 1 FROM orgs o
    WHERE o.id = oe.org_id
      AND o.plan_tier IN ('BUSINESS', 'ENTERPRISE')
      AND o.subscription_status NOT IN ('active', 'trialing', 'past_due')
  );
