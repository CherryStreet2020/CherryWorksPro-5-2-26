import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_fake_for_unit_tests";
  process.env.STRIPE_TEST_MARKETING_OS_PRICE_ID = "price_test_marketing_os";
});

describe("Sprint 2j — add-on checkout route surface", () => {
  it("ADDON_FEATURES enumerates only LIVE add-ons (marketing_os retired by Task #392)", async () => {
    const mod = await import("../../server/stripe-addon-prices");
    // Task #392 — marketing_os moved to RETIRED_ADDON_FEATURES (tier-derived
    // from BUSINESS/ENTERPRISE) and must not appear in the live list any more.
    expect(mod.ADDON_FEATURES).not.toContain("marketing_os" as any);
    expect(mod.ADDON_FEATURES).toContain("multi_brand");
    expect(mod.ADDON_FEATURES).toContain("hubspot_bridge");
    expect(mod.ADDON_FEATURES).not.toContain("pso_core" as any);
    // But the retired list still recognizes marketing_os so legacy webhooks
    // resolve via getAddonFeatureForPrice.
    expect(mod.RETIRED_ADDON_FEATURES).toContain("marketing_os");
    // And reverse-lookup must still resolve the marketing_os price → feature.
    const pid = mod.getAddonPriceId("marketing_os")!;
    expect(typeof pid).toBe("string");
    expect(mod.getAddonFeatureForPrice(pid)).toBe("marketing_os");
  });

  it("isAddonPriceId / isFeatureAvailable agree on a configured marketing_os price", async () => {
    const mod = await import("../../server/stripe-addon-prices");
    expect(mod.isFeatureAvailable("marketing_os")).toBe(true);
    const pid = mod.getAddonPriceId("marketing_os")!;
    expect(typeof pid).toBe("string");
    expect(mod.isAddonPriceId(pid)).toBe(true);
    expect(mod.isAddonPriceId("price_definitely_not_an_addon")).toBe(false);
  });

  it("registerEntitlementCheckoutRoutes mounts POST /api/entitlements/:feature/checkout", async () => {
    const { registerEntitlementCheckoutRoutes } = await import(
      "../../server/routes/entitlement-checkout-routes"
    );
    const seen: Array<{ method: string; path: string }> = [];
    const fakeApp: any = {
      post: (path: string, _mw: any, _h: any) => seen.push({ method: "post", path }),
    };
    registerEntitlementCheckoutRoutes(fakeApp);
    expect(seen).toContainEqual({
      method: "post",
      path: "/api/entitlements/:feature/checkout",
    });
  });

  // Task #392 — marketing_os is tier-derived now. The route MUST hard-stop
  // with HTTP 410 before falling through to the Stripe Checkout creation
  // path. We capture the registered handler, invoke it with a fake req/res
  // for `feature = "marketing_os"`, and assert the body shape the client
  // helper relies on (`code: "MARKETING_OS_TIER_DERIVED"` + `upgradePath`).
  it("returns 410 Gone for marketing_os without invoking Stripe", async () => {
    const { registerEntitlementCheckoutRoutes } = await import(
      "../../server/routes/entitlement-checkout-routes"
    );
    let captured: any = null;
    const fakeApp: any = {
      post: (path: string, _mw: any, handler: any) => {
        if (path === "/api/entitlements/:feature/checkout") captured = handler;
      },
    };
    registerEntitlementCheckoutRoutes(fakeApp);
    expect(typeof captured).toBe("function");

    const req: any = {
      params: { feature: "marketing_os" },
      session: { orgId: "org_test", userId: "user_test" },
      protocol: "http",
      get: () => "localhost:5000",
    };
    let statusCode: number | null = null;
    let body: any = null;
    const res: any = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(payload: any) {
        body = payload;
        return this;
      },
    };
    await captured!(req, res);
    expect(statusCode).toBe(410);
    expect(body?.code).toBe("MARKETING_OS_TIER_DERIVED");
    expect(body?.upgradePath).toBe("/settings/billing");
    expect(typeof body?.error).toBe("string");
  });

  it("does NOT short-circuit for the other paid add-ons", async () => {
    const { registerEntitlementCheckoutRoutes } = await import(
      "../../server/routes/entitlement-checkout-routes"
    );
    let captured: any = null;
    const fakeApp: any = {
      post: (path: string, _mw: any, handler: any) => {
        if (path === "/api/entitlements/:feature/checkout") captured = handler;
      },
    };
    registerEntitlementCheckoutRoutes(fakeApp);

    // multi_brand isn't configured with a price ID in this env; we expect
    // either a 400 ("not available") or a 503 ("Stripe not configured")
    // — explicitly NOT the 410 we reserve for marketing_os. This proves
    // the marketing_os early-return doesn't accidentally swallow other
    // features.
    const req: any = {
      params: { feature: "multi_brand" },
      session: { orgId: "org_test", userId: "user_test" },
      protocol: "http",
      get: () => "localhost:5000",
    };
    let statusCode: number | null = null;
    const res: any = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json() {
        return this;
      },
    };
    try {
      await captured!(req, res);
    } catch {
      // The handler may throw on missing Stripe wiring before sending —
      // that still proves it didn't 410. Swallow.
    }
    expect(statusCode).not.toBe(410);
  });
});
