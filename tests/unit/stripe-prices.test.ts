import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolvePriceId, planFromPrice, planFromPriceLabels, resetPriceCache, configuredPriceId } from "../../server/stripe-prices";
import { planTierFromSubscription } from "../../server/stripe_webhook";

// The live account as of 2026-09-07: lookup keys are human labels, not the
// cherryworks_* keys the webhook once expected; one add-on product exists.
const LIVE_PRICES = [
  { id: "price_addon0", lookup_key: null, product: { name: "CherryWorks Pro - Marketing Add-On" }, recurring: null, active: true },
  { id: "price_addon", lookup_key: null, product: { name: "CherryWorks Pro - Marketing Add-On" }, recurring: { interval: "month" }, active: true },
  { id: "price_starter_m", lookup_key: "Starter - Monthly", product: { name: "CherryWorks Pro — Starter" }, recurring: { interval: "month" }, active: true },
  { id: "price_starter_y", lookup_key: "Starter - Yearly", product: { name: "CherryWorks Pro — Starter" }, recurring: { interval: "year" }, active: true },
  { id: "price_pro_m", lookup_key: "CherryWorks Pro — Professional", product: { name: "CherryWorks Pro — Professional" }, recurring: { interval: "month" }, active: true },
  { id: "price_pro_y", lookup_key: "Professional Yearly", product: { name: "CherryWorks Pro — Professional" }, recurring: { interval: "year" }, active: true },
  { id: "price_biz_m", lookup_key: "Business Monthly", product: { name: "CherryWorks Pro — Business" }, recurring: { interval: "month" }, active: true },
  { id: "price_biz_y", lookup_key: "Business Yearly", product: { name: "CherryWorks Pro — Business" }, recurring: { interval: "year" }, active: true },
];
const fakeStripe = (calls: { n: number }) => ({ prices: { list: async () => { calls.n++; return { data: LIVE_PRICES }; } } });

const SAVED: Record<string, string | undefined> = {};
const VARS = ["STRIPE_SECRET_KEY", "STRIPE_LIVE_PROFESSIONAL_MONTHLY_PRICE_ID", "STRIPE_TEST_PROFESSIONAL_MONTHLY_PRICE_ID", "STRIPE_TEST_BUSINESS_YEARLY_PRICE_ID"];
beforeEach(() => { for (const v of VARS) { SAVED[v] = process.env[v]; delete process.env[v]; } resetPriceCache(); });
afterEach(() => { for (const v of VARS) { if (SAVED[v] === undefined) delete process.env[v]; else process.env[v] = SAVED[v]; } resetPriceCache(); });

describe("stripe base-plan price resolution", () => {
  it("uses the configured env var when present and never calls Stripe", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_TEST_PROFESSIONAL_MONTHLY_PRICE_ID = "price_env";
    const calls = { n: 0 };
    expect(await resolvePriceId(fakeStripe(calls), "PROFESSIONAL", false)).toBe("price_env");
    expect(calls.n).toBe(0);
    expect(configuredPriceId("BUSINESS", true)).toBeNull();
  });

  it("falls back to the account's prices by product name + interval, and caches", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_x";
    const calls = { n: 0 };
    expect(await resolvePriceId(fakeStripe(calls), "PROFESSIONAL", false)).toBe("price_pro_m");
    expect(await resolvePriceId(fakeStripe(calls), "STARTER", true)).toBe("price_starter_y");
    expect(await resolvePriceId(fakeStripe(calls), "BUSINESS", true)).toBe("price_biz_y");
    expect(calls.n).toBe(1);
  });

  it("walks past the first page of the catalogue", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_x";
    const seen: any[] = [];
    const paged = { prices: { list: async (params: any) => { seen.push(params.starting_after); return params.starting_after ? { data: LIVE_PRICES.slice(2), has_more: false } : { data: LIVE_PRICES.slice(0, 2), has_more: true }; } } };
    expect(await resolvePriceId(paged, "BUSINESS", false)).toBe("price_biz_m");
    expect(seen).toEqual([undefined, "price_addon"]);
  });

  it("never picks the add-on and throws when nothing matches", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_x";
    const empty = { prices: { list: async () => ({ data: LIVE_PRICES.filter(p => /Add-On/.test(p.product.name)) }) } };
    await expect(resolvePriceId(empty, "STARTER", false)).rejects.toThrow(/No Stripe price found for STARTER\/month/);
  });

  it("maps a price back to its plan: env id first, then labels; add-ons map to nothing", () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_x";
    process.env.STRIPE_LIVE_PROFESSIONAL_MONTHLY_PRICE_ID = "price_pinned";
    expect(planFromPrice({ id: "price_pinned" })).toBe("PROFESSIONAL");
    expect(planFromPrice(LIVE_PRICES[6])).toBe("BUSINESS");
    expect(planFromPrice({ id: "x", lookup_key: "cherryworks_starter_monthly" })).toBe("STARTER");
    expect(planFromPriceLabels(LIVE_PRICES[1])).toBeNull();
    expect(planFromPrice({ id: "unknown" })).toBeNull();
  });

  it("planTierFromSubscription: billed price beats checkout metadata, which beats the legacy lookup key; trialing counts", () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_x";
    const sub = (price: any, meta?: string, status = "trialing") => ({ status, metadata: meta ? { planTier: meta } : {}, items: { data: price ? [{ price }] : [] } });
    // Portal downgrade: metadata still says BUSINESS, the item now bills Starter.
    expect(planTierFromSubscription(sub(LIVE_PRICES[2], "BUSINESS"), "BUSINESS")).toBe("STARTER");
    // Unrecognised price → metadata from checkout.
    expect(planTierFromSubscription(sub({ id: "price_mystery" }, "BUSINESS"), "TRIAL")).toBe("BUSINESS");
    // Legacy lookup key.
    expect(planTierFromSubscription(sub({ id: "x", lookup_key: "cherryworks_starter_monthly" }), "TRIAL")).toBe("STARTER");
    // Nothing recognisable but a live trial on a TRIAL org → PROFESSIONAL; an established org is left alone.
    expect(planTierFromSubscription(sub({ id: "price_mystery" }), "TRIAL")).toBe("PROFESSIONAL");
    expect(planTierFromSubscription(sub({ id: "price_mystery" }, undefined, "active"), "BUSINESS")).toBeNull();
    expect(planTierFromSubscription(sub({ id: "price_mystery" }, undefined, "past_due"), "TRIAL")).toBeNull();
  });
});
