/**
 * Sprint 2j — Mode-aware add-on price → entitlement feature map.
 *
 * Mirrors the pattern in `server/stripe-prices.ts` (base plans). Reads
 * env vars at lookup time (NOT at module load) so unit tests can stub
 * env vars between test cases. Boot-time logging IS emitted once per
 * module import via `logAddonAvailability()` (called from server boot).
 *
 * Marketing OS LIVE price (operator-supplied):
 *   STRIPE_LIVE_MARKETING_OS_PRICE_ID = price_1TOij0PlbOuzXblr37aDvOLU
 */

export type AddonFeature = "marketing_os" | "multi_brand" | "hubspot_bridge";

/**
 * Live add-on features that are still purchasable as standalone Stripe SKUs.
 * Iterated by `logAddonAvailability` and any other "all current add-ons"
 * surface. Marketing OS is intentionally NOT here as of Task #392 — it is
 * tier-derived from the BUSINESS/ENTERPRISE base plan and should not appear
 * in generic add-on routing or admin tooling lists.
 */
export const ADDON_FEATURES: AddonFeature[] = ["multi_brand", "hubspot_bridge"];

/**
 * Add-on features whose Stripe SKU has been retired but whose webhooks
 * still need to land on `handleAddonSubscriptionEvent` so the per-event
 * grandfather-extend / terminal-revoke special-case branch can run for
 * legacy holders. The reverse-lookup (`getAddonFeatureForPrice`) iterates
 * BOTH lists so a webhook with a retired price still resolves to its
 * AddonFeature; everything else (`logAddonAvailability`,
 * `isFeatureAvailable` listings) skips retired features.
 */
export const RETIRED_ADDON_FEATURES: AddonFeature[] = ["marketing_os"];

/**
 * Convenience iterable for the reverse-lookup: every feature we still need
 * to recognize on inbound webhooks, both live and retired.
 */
const ALL_ADDON_FEATURES_FOR_LOOKUP: AddonFeature[] = [
  ...ADDON_FEATURES,
  ...RETIRED_ADDON_FEATURES,
];

const ENV_MAP: Record<"live" | "test", Record<AddonFeature, string>> = {
  live: {
    marketing_os: "STRIPE_LIVE_MARKETING_OS_PRICE_ID",
    multi_brand: "STRIPE_LIVE_MULTI_BRAND_PRICE_ID",
    hubspot_bridge: "STRIPE_LIVE_HUBSPOT_BRIDGE_PRICE_ID",
  },
  test: {
    marketing_os: "STRIPE_TEST_MARKETING_OS_PRICE_ID",
    multi_brand: "STRIPE_TEST_MULTI_BRAND_PRICE_ID",
    hubspot_bridge: "STRIPE_TEST_HUBSPOT_BRIDGE_PRICE_ID",
  },
};

export function getStripeMode(): "live" | "test" {
  const key = process.env.STRIPE_SECRET_KEY;
  return key?.startsWith("sk_live_") ? "live" : "test";
}

export function getAddonPriceId(feature: AddonFeature): string | null {
  const mode = getStripeMode();
  const envName = ENV_MAP[mode][feature];
  const value = process.env[envName];
  return value && value.length > 0 ? value : null;
}

export function isFeatureAvailable(feature: AddonFeature): boolean {
  return getAddonPriceId(feature) !== null;
}

/**
 * Reverse lookup: given a Stripe price ID seen in a webhook event, return
 * the matching add-on feature, or null if it isn't one of ours. Iterates
 * BOTH live and test maps so a webhook delivered after a Stripe-mode
 * switch still routes correctly.
 */
export function getAddonFeatureForPrice(priceId: string): AddonFeature | null {
  if (!priceId) return null;
  for (const mode of ["live", "test"] as const) {
    for (const feature of ALL_ADDON_FEATURES_FOR_LOOKUP) {
      const envName = ENV_MAP[mode][feature];
      const value = process.env[envName];
      if (value && value === priceId) return feature;
    }
  }
  return null;
}

export function isAddonPriceId(priceId: string): boolean {
  return getAddonFeatureForPrice(priceId) !== null;
}

let _logged = false;

/** Boot-time, idempotent. Logs availability per add-on exactly once. */
export function logAddonAvailability(): void {
  if (_logged) return;
  _logged = true;
  const mode = getStripeMode();
  for (const feature of ADDON_FEATURES) {
    const available = isFeatureAvailable(feature);
    if (available) {
      console.log(`[addon-prices] ${feature} available in ${mode} mode`);
    } else {
      console.log(
        `[addon-prices] ${feature} unavailable in ${mode} mode (env var unset)`,
      );
    }
  }
}

/** Test-only: reset the once-flag so tests can re-exercise the boot log. */
export function _resetAddonAvailabilityLogForTests(): void {
  _logged = false;
}
