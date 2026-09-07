/**
 * Base-plan Stripe prices.
 *
 * Resolution order for a plan + interval:
 *   1. The environment variable for the current mode
 *      (STRIPE_{LIVE|TEST}_{PLAN}_{MONTHLY|YEARLY}_PRICE_ID) — explicit, exact.
 *   2. The Stripe account itself: active recurring prices whose product name
 *      carries the plan word (Starter / Professional / Business) and whose
 *      interval matches. Cached for ten minutes.
 *
 * Why (2) exists: the Azure estate shipped without the six price variables
 * (2026-09-07 onboarding audit), which made every new signup on
 * cherryworkspro.com fail at "Continue to Payment" with a configuration
 * error. Missing configuration must degrade to "look it up", not to a dead
 * signup button. The reverse map (price → plan) lives here too so the
 * webhook and the checkout agree on what a price means.
 */
type PlanTier = "STARTER" | "PROFESSIONAL" | "BUSINESS";
const PLANS: PlanTier[] = ["STARTER", "PROFESSIONAL", "BUSINESS"];

const ENV_MAP: Record<string, Record<string, { monthly: string; yearly: string }>> = {
  test: {
    STARTER: { monthly: "STRIPE_TEST_STARTER_MONTHLY_PRICE_ID", yearly: "STRIPE_TEST_STARTER_YEARLY_PRICE_ID" },
    PROFESSIONAL: { monthly: "STRIPE_TEST_PROFESSIONAL_MONTHLY_PRICE_ID", yearly: "STRIPE_TEST_PROFESSIONAL_YEARLY_PRICE_ID" },
    BUSINESS: { monthly: "STRIPE_TEST_BUSINESS_MONTHLY_PRICE_ID", yearly: "STRIPE_TEST_BUSINESS_YEARLY_PRICE_ID" },
  },
  live: {
    STARTER: { monthly: "STRIPE_LIVE_STARTER_MONTHLY_PRICE_ID", yearly: "STRIPE_LIVE_STARTER_YEARLY_PRICE_ID" },
    PROFESSIONAL: { monthly: "STRIPE_LIVE_PROFESSIONAL_MONTHLY_PRICE_ID", yearly: "STRIPE_LIVE_PROFESSIONAL_YEARLY_PRICE_ID" },
    BUSINESS: { monthly: "STRIPE_LIVE_BUSINESS_MONTHLY_PRICE_ID", yearly: "STRIPE_LIVE_BUSINESS_YEARLY_PRICE_ID" },
  },
};

export function stripeMode(): "live" | "test" {
  return process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_") ? "live" : "test";
}

/** The configured price id, or null when the variable is not set. */
export function configuredPriceId(plan: PlanTier, annual: boolean): string | null {
  const envVarName = ENV_MAP[stripeMode()][plan]?.[annual ? "yearly" : "monthly"];
  if (!envVarName) throw new Error(`Unknown plan/interval: ${plan}/${annual ? "yearly" : "monthly"}`);
  return process.env[envVarName] || null;
}

/** Synchronous, env-only. Kept for callers that cannot await; throws when unset. */
export function getPriceId(plan: PlanTier, annual: boolean): string {
  const value = configuredPriceId(plan, annual);
  if (!value) throw new Error(`Missing Stripe price env var: ${ENV_MAP[stripeMode()][plan][annual ? "yearly" : "monthly"]}`);
  return value;
}

export interface PriceLike {
  id: string;
  lookup_key?: string | null;
  nickname?: string | null;
  active?: boolean;
  recurring?: { interval?: string | null } | null;
  product?: string | { name?: string | null; deleted?: boolean } | null;
}

/** Plan word in any of the price's labels (product name, nickname, lookup key). */
export function planFromPriceLabels(price: PriceLike): PlanTier | null {
  const productName = typeof price.product === "object" && price.product ? price.product.name || "" : "";
  const text = `${productName} ${price.nickname || ""} ${price.lookup_key || ""}`.toLowerCase();
  if (/add-?on|marketing/.test(text)) return null;
  for (const plan of PLANS) if (text.includes(plan.toLowerCase())) return plan;
  return null;
}

/** Reverse map: what plan does this price sell? Env ids first, then labels. */
export function planFromPrice(price: PriceLike | null | undefined): PlanTier | null {
  if (!price) return null;
  for (const plan of PLANS) {
    for (const annual of [false, true]) {
      let configured: string | null = null;
      try { configured = configuredPriceId(plan, annual); } catch { /* unknown plan */ }
      if (configured && configured === price.id) return plan;
    }
  }
  return planFromPriceLabels(price);
}

interface PriceLister { prices: { list(params: Record<string, unknown>): Promise<{ data: PriceLike[]; has_more?: boolean }> } }

let cache: { at: number; mode: string; prices: PriceLike[] } | null = null;
const CACHE_MS = 10 * 60 * 1000;

async function listBasePrices(stripe: PriceLister): Promise<PriceLike[]> {
  const mode = stripeMode();
  if (cache && cache.mode === mode && Date.now() - cache.at < CACHE_MS) return cache.prices;
  // Stripe caps a page at 100; walk the catalogue (bounded) so a plan price
  // past the first page is still found.
  const prices: PriceLike[] = [];
  let startingAfter: string | undefined;
  for (let pages = 0; pages < 10; pages++) {
    const page = await stripe.prices.list({ active: true, type: "recurring", limit: 100, expand: ["data.product"], ...(startingAfter ? { starting_after: startingAfter } : {}) });
    prices.push(...page.data);
    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  cache = { at: Date.now(), mode, prices };
  return prices;
}

/** Test hook. */
export function resetPriceCache(): void { cache = null; }

/**
 * The price to put in a Checkout session. Falls back to the Stripe account
 * when the environment variable is missing; throws only when neither knows.
 */
export async function resolvePriceId(stripe: PriceLister, plan: PlanTier, annual: boolean): Promise<string> {
  const configured = configuredPriceId(plan, annual);
  if (configured) return configured;
  const interval = annual ? "year" : "month";
  const candidates = (await listBasePrices(stripe)).filter(p =>
    p.active !== false && p.recurring?.interval === interval && planFromPriceLabels(p) === plan,
  );
  if (candidates.length === 1) return candidates[0].id;
  if (candidates.length > 1) {
    console.warn(`[stripe-prices] ${candidates.length} ${plan}/${interval} prices match by name; set ${ENV_MAP[stripeMode()][plan][annual ? "yearly" : "monthly"]} to pin one (using ${candidates[0].id})`);
    return candidates[0].id;
  }
  throw new Error(`No Stripe price found for ${plan}/${interval}; set ${ENV_MAP[stripeMode()][plan][annual ? "yearly" : "monthly"]}`);
}
