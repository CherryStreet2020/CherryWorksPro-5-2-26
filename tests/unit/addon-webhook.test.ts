import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_fake_for_unit_tests";
  process.env.STRIPE_TEST_MARKETING_OS_PRICE_ID = "price_test_marketing_os";
  process.env.STRIPE_TEST_MULTI_BRAND_PRICE_ID = "price_test_multi_brand";
  process.env.STRIPE_TEST_HUBSPOT_BRIDGE_PRICE_ID = "price_test_hubspot_bridge";
});

describe("Sprint 2j — addon webhook pure helpers", () => {
  it("computeAddonTargetState: subscription.created/active → active, no grace", async () => {
    const { computeAddonTargetState } = await import("../../server/stripe_webhook");
    const now = new Date("2026-04-22T00:00:00Z");
    const t = computeAddonTargetState("customer.subscription.created", "active", null, now);
    expect(t).toEqual({ active: true, gracePeriodEndsAt: null });
  });

  it("computeAddonTargetState: subscription.updated/canceled (terminal) → inactive", async () => {
    // The 7-day grace window in this implementation is reserved for the
    // payment-failure (`past_due`) path. A subscription whose status has
    // already transitioned to `canceled` has finished its period and is
    // terminal — flip the entitlement off immediately.
    const { computeAddonTargetState } = await import("../../server/stripe_webhook");
    const now = new Date("2026-04-22T00:00:00Z");
    const t = computeAddonTargetState("customer.subscription.updated", "canceled", null, now);
    expect(t).toEqual({ active: false, gracePeriodEndsAt: null });
  });

  it("computeAddonTargetState: subscription.deleted → inactive, no grace", async () => {
    const { computeAddonTargetState } = await import("../../server/stripe_webhook");
    const now = new Date("2026-04-22T00:00:00Z");
    const t = computeAddonTargetState("customer.subscription.deleted", null, null, now);
    expect(t).toEqual({ active: false, gracePeriodEndsAt: null });
  });

  it("computeAddonTargetState: past_due preserves an existing grace window", async () => {
    const { computeAddonTargetState } = await import("../../server/stripe_webhook");
    const now = new Date("2026-04-22T00:00:00Z");
    const existing = new Date("2026-04-25T00:00:00Z");
    const t = computeAddonTargetState("customer.subscription.updated", "past_due", existing, now);
    expect(t?.active).toBe(true);
    expect(t?.gracePeriodEndsAt?.toISOString()).toBe(existing.toISOString());
  });

  it("computeAddonTargetState: past_due with no existing grace opens a fresh 7d window", async () => {
    const { computeAddonTargetState } = await import("../../server/stripe_webhook");
    const now = new Date("2026-04-22T00:00:00Z");
    const t = computeAddonTargetState("customer.subscription.updated", "past_due", null, now);
    expect(t?.active).toBe(true);
    const diffMs = (t!.gracePeriodEndsAt as Date).getTime() - now.getTime();
    expect(diffMs).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("extractAddonPricesFromEvent: subscription event splits add-on vs base price IDs", async () => {
    const { extractAddonPricesFromEvent } = await import("../../server/stripe_webhook");
    const event = {
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_123",
          customer: "cus_abc",
          status: "active",
          items: {
            data: [
              { price: { id: "price_test_marketing_os" } },
              { price: { id: "price_base_pso_core_xyz" } },
            ],
          },
        },
      },
    };
    const ctx = await extractAddonPricesFromEvent(event);
    expect(ctx.addonPriceIds).toContain("price_test_marketing_os");
    expect(ctx.basePriceIds).toContain("price_base_pso_core_xyz");
    expect(ctx.subscriptionId).toBe("sub_123");
  });

  it("extractAddonPricesFromEvent: pure base subscription returns no add-on IDs", async () => {
    const { extractAddonPricesFromEvent } = await import("../../server/stripe_webhook");
    const event = {
      type: "customer.subscription.created",
      data: {
        object: {
          id: "sub_only_base",
          customer: "cus_xyz",
          status: "active",
          items: { data: [{ price: { id: "price_base_only" } }] },
        },
      },
    };
    const ctx = await extractAddonPricesFromEvent(event);
    expect(ctx.addonPriceIds).toEqual([]);
    expect(ctx.basePriceIds).toEqual(["price_base_only"]);
  });

  it("getAddonFeatureForPrice maps known add-on price IDs to features", async () => {
    const { getAddonFeatureForPrice } = await import("../../server/stripe-addon-prices");
    expect(getAddonFeatureForPrice("price_test_marketing_os")).toBe("marketing_os");
    expect(getAddonFeatureForPrice("price_test_multi_brand")).toBe("multi_brand");
    expect(getAddonFeatureForPrice("price_test_hubspot_bridge")).toBe("hubspot_bridge");
    expect(getAddonFeatureForPrice("price_unknown")).toBeNull();
  });
});
