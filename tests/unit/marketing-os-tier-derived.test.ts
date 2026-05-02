/**
 * Task #392 — pure tier-derivation predicate.
 *
 * `marketingOsActiveFromTier` is the single source-of-truth boolean used
 * by both the read-path overlay (server/services/entitlements.ts) and
 * the webhook-side write hook. We don't touch Drizzle here — the helper
 * is a pure function and can be exercised directly. The DB-touching
 * `syncMarketingOsTierEntitlement` is covered by integration tests.
 */
import { describe, it, expect } from "vitest";

describe("Task #392 — marketingOsActiveFromTier", () => {
  it("BUSINESS + active → true", async () => {
    const { marketingOsActiveFromTier } = await import(
      "../../server/services/marketing-os-tier"
    );
    expect(marketingOsActiveFromTier("BUSINESS", "active")).toBe(true);
  });

  it("ENTERPRISE + active → true", async () => {
    const { marketingOsActiveFromTier } = await import(
      "../../server/services/marketing-os-tier"
    );
    expect(marketingOsActiveFromTier("ENTERPRISE", "active")).toBe(true);
  });

  it("BUSINESS + trialing → true (trial counts as healthy)", async () => {
    const { marketingOsActiveFromTier } = await import(
      "../../server/services/marketing-os-tier"
    );
    expect(marketingOsActiveFromTier("BUSINESS", "trialing")).toBe(true);
  });

  it("BUSINESS + past_due WITHOUT grace → false (bounded grace required)", async () => {
    // Post-review fix: past_due is no longer unconditionally honored. The
    // caller must pass a not-yet-expired gracePeriodEndsAt for marketing_os
    // to remain active during a payment-failure window.
    const { marketingOsActiveFromTier } = await import(
      "../../server/services/marketing-os-tier"
    );
    expect(marketingOsActiveFromTier("BUSINESS", "past_due")).toBe(false);
    expect(marketingOsActiveFromTier("BUSINESS", "past_due", null)).toBe(false);
  });

  it("BUSINESS + past_due WITH future grace → true (within 7-day window)", async () => {
    const { marketingOsActiveFromTier } = await import(
      "../../server/services/marketing-os-tier"
    );
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // +3d
    expect(marketingOsActiveFromTier("BUSINESS", "past_due", future)).toBe(
      true,
    );
    // String-form (ISO from JSON serialization) also accepted.
    expect(
      marketingOsActiveFromTier("BUSINESS", "past_due", future.toISOString()),
    ).toBe(true);
  });

  it("BUSINESS + past_due WITH expired grace → false (window elapsed)", async () => {
    const { marketingOsActiveFromTier } = await import(
      "../../server/services/marketing-os-tier"
    );
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000); // -1d
    expect(marketingOsActiveFromTier("BUSINESS", "past_due", past)).toBe(false);
  });

  it("BUSINESS + active ignores grace param (healthy never needs grace)", async () => {
    const { marketingOsActiveFromTier } = await import(
      "../../server/services/marketing-os-tier"
    );
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    expect(marketingOsActiveFromTier("BUSINESS", "active", past)).toBe(true);
    expect(marketingOsActiveFromTier("BUSINESS", "active", null)).toBe(true);
  });

  it("STARTER + active → false (tier doesn't grant Marketing OS)", async () => {
    const { marketingOsActiveFromTier } = await import(
      "../../server/services/marketing-os-tier"
    );
    expect(marketingOsActiveFromTier("STARTER", "active")).toBe(false);
  });

  it("PROFESSIONAL + active → false (tier doesn't grant Marketing OS)", async () => {
    const { marketingOsActiveFromTier } = await import(
      "../../server/services/marketing-os-tier"
    );
    expect(marketingOsActiveFromTier("PROFESSIONAL", "active")).toBe(false);
  });

  it("BUSINESS + canceled → false (status not healthy)", async () => {
    const { marketingOsActiveFromTier } = await import(
      "../../server/services/marketing-os-tier"
    );
    expect(marketingOsActiveFromTier("BUSINESS", "canceled")).toBe(false);
  });

  it("BUSINESS + incomplete → false (status not healthy)", async () => {
    const { marketingOsActiveFromTier } = await import(
      "../../server/services/marketing-os-tier"
    );
    expect(marketingOsActiveFromTier("BUSINESS", "incomplete")).toBe(false);
  });

  it("BUSINESS + unpaid → false (status not healthy)", async () => {
    const { marketingOsActiveFromTier } = await import(
      "../../server/services/marketing-os-tier"
    );
    expect(marketingOsActiveFromTier("BUSINESS", "unpaid")).toBe(false);
  });

  it("null inputs → false (treated as 'no tier-derived grant')", async () => {
    const { marketingOsActiveFromTier } = await import(
      "../../server/services/marketing-os-tier"
    );
    expect(marketingOsActiveFromTier(null, "active")).toBe(false);
    expect(marketingOsActiveFromTier("BUSINESS", null)).toBe(false);
    expect(marketingOsActiveFromTier(null, null)).toBe(false);
    expect(marketingOsActiveFromTier(undefined, undefined)).toBe(false);
  });

  it("exports the expected tier / status / grace constants", async () => {
    const mod = await import("../../server/services/marketing-os-tier");
    expect(mod.MARKETING_OS_TIERS).toEqual(["BUSINESS", "ENTERPRISE"]);
    // Post-review fix: past_due removed from HEALTHY (now requires bounded
    // grace window) and split into a separate GRACE_STATUSES constant.
    expect(mod.MARKETING_OS_HEALTHY_STATUSES).toEqual(["active", "trialing"]);
    expect(mod.MARKETING_OS_GRACE_STATUSES).toEqual(["past_due"]);
    expect(mod.MARKETING_OS_PAST_DUE_GRACE_DAYS).toBe(7);
  });

  it("computeMarketingOsPastDueGraceEndsAt(past_due, null) → now+7d", async () => {
    const { computeMarketingOsPastDueGraceEndsAt } = await import(
      "../../server/services/marketing-os-tier"
    );
    const before = Date.now();
    const result = computeMarketingOsPastDueGraceEndsAt("past_due", null);
    const after = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(result).not.toBeNull();
    expect(result!.getTime()).toBeGreaterThanOrEqual(
      before + sevenDaysMs - 100,
    );
    expect(result!.getTime()).toBeLessThanOrEqual(after + sevenDaysMs + 100);
  });

  it("computeMarketingOsPastDueGraceEndsAt preserves an EARLIER existing deadline (no clock-reset)", async () => {
    const { computeMarketingOsPastDueGraceEndsAt } = await import(
      "../../server/services/marketing-os-tier"
    );
    // 5 days from now is earlier than the fresh +7d we'd compute, so it
    // must win — protects against a flap (past_due → active → past_due)
    // resetting the customer's clock for a fresh week of grace.
    const fiveDays = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const result = computeMarketingOsPastDueGraceEndsAt("past_due", fiveDays);
    expect(result?.getTime()).toBe(fiveDays.getTime());
  });

  it("computeMarketingOsPastDueGraceEndsAt returns null for non-grace status", async () => {
    const { computeMarketingOsPastDueGraceEndsAt } = await import(
      "../../server/services/marketing-os-tier"
    );
    expect(computeMarketingOsPastDueGraceEndsAt("active", null)).toBeNull();
    expect(computeMarketingOsPastDueGraceEndsAt("canceled", null)).toBeNull();
    expect(computeMarketingOsPastDueGraceEndsAt(null, null)).toBeNull();
  });
});

/**
 * Task #392 post-review fix — pure helper for the marketing_os branch of
 * `handleAddonSubscriptionEvent`. We exercise it directly so we don't need
 * to stand up Stripe + Drizzle just to verify:
 *   • non-grandfather rows are never touched (skip)
 *   • renewals only extend forward and only from authoritative
 *     `current_period_end` (no fabricated `+30d` fallback)
 *   • terminal events deactivate AND clear grandfather_expires_at
 */
describe("Task #392 — computeMarketingOsGrandfatherTarget", () => {
  it("no existing grandfather row → skip (tier-derived overlay handles it)", async () => {
    const { computeMarketingOsGrandfatherTarget } = await import(
      "../../server/stripe_webhook"
    );
    const out = computeMarketingOsGrandfatherTarget(
      "customer.subscription.updated",
      "active",
      null,
      new Date("2026-06-01T00:00:00Z"),
    );
    expect(out).toEqual({ action: "skip" });
  });

  it("subscription.deleted on grandfather row → deactivate", async () => {
    const { computeMarketingOsGrandfatherTarget } = await import(
      "../../server/stripe_webhook"
    );
    const out = computeMarketingOsGrandfatherTarget(
      "customer.subscription.deleted",
      "canceled",
      new Date("2026-05-01T00:00:00Z"),
      null,
    );
    expect(out).toEqual({ action: "deactivate" });
  });

  it("status=canceled on grandfather row → deactivate (regardless of event type)", async () => {
    const { computeMarketingOsGrandfatherTarget } = await import(
      "../../server/stripe_webhook"
    );
    const out = computeMarketingOsGrandfatherTarget(
      "customer.subscription.updated",
      "canceled",
      new Date("2026-05-01T00:00:00Z"),
      new Date("2026-06-01T00:00:00Z"),
    );
    expect(out).toEqual({ action: "deactivate" });
  });

  it("status=incomplete_expired → deactivate", async () => {
    const { computeMarketingOsGrandfatherTarget } = await import(
      "../../server/stripe_webhook"
    );
    const out = computeMarketingOsGrandfatherTarget(
      "customer.subscription.updated",
      "incomplete_expired",
      new Date("2026-05-01T00:00:00Z"),
      null,
    );
    expect(out).toEqual({ action: "deactivate" });
  });

  it("status=unpaid → deactivate (treated as terminal for grandfather hold)", async () => {
    const { computeMarketingOsGrandfatherTarget } = await import(
      "../../server/stripe_webhook"
    );
    const out = computeMarketingOsGrandfatherTarget(
      "customer.subscription.updated",
      "unpaid",
      new Date("2026-05-01T00:00:00Z"),
      null,
    );
    expect(out).toEqual({ action: "deactivate" });
  });

  it("renewal with future current_period_end → extend forward to that date", async () => {
    const { computeMarketingOsGrandfatherTarget } = await import(
      "../../server/stripe_webhook"
    );
    const existing = new Date("2026-05-01T00:00:00Z");
    const cpe = new Date("2026-06-01T00:00:00Z");
    const out = computeMarketingOsGrandfatherTarget(
      "customer.subscription.updated",
      "active",
      existing,
      cpe,
    );
    expect(out).toEqual({ action: "extend", newGrandfather: cpe });
  });

  it("renewal with stale (earlier) current_period_end → keep existing window (forward-only)", async () => {
    const { computeMarketingOsGrandfatherTarget } = await import(
      "../../server/stripe_webhook"
    );
    const existing = new Date("2026-06-01T00:00:00Z");
    const stale = new Date("2026-05-01T00:00:00Z");
    const out = computeMarketingOsGrandfatherTarget(
      "customer.subscription.updated",
      "active",
      existing,
      stale,
    );
    expect(out).toEqual({ action: "extend", newGrandfather: existing });
  });

  it("renewal WITHOUT authoritative current_period_end → skip (NEVER fabricate +30d)", async () => {
    // Critical regression guard: prior implementation fell back to
    // now+30d, which could grant access past the true Stripe period.
    const { computeMarketingOsGrandfatherTarget } = await import(
      "../../server/stripe_webhook"
    );
    const existing = new Date("2026-05-01T00:00:00Z");
    const out = computeMarketingOsGrandfatherTarget(
      "customer.subscription.updated",
      "active",
      existing,
      null,
    );
    expect(out).toEqual({ action: "skip" });
  });

  it("trialing on grandfather row with current_period_end → extend", async () => {
    const { computeMarketingOsGrandfatherTarget } = await import(
      "../../server/stripe_webhook"
    );
    const existing = new Date("2026-05-01T00:00:00Z");
    const cpe = new Date("2026-06-15T00:00:00Z");
    const out = computeMarketingOsGrandfatherTarget(
      "customer.subscription.updated",
      "trialing",
      existing,
      cpe,
    );
    expect(out).toEqual({ action: "extend", newGrandfather: cpe });
  });

  it("past_due on grandfather row with current_period_end → extend (not terminal)", async () => {
    const { computeMarketingOsGrandfatherTarget } = await import(
      "../../server/stripe_webhook"
    );
    const existing = new Date("2026-05-01T00:00:00Z");
    const cpe = new Date("2026-06-15T00:00:00Z");
    const out = computeMarketingOsGrandfatherTarget(
      "customer.subscription.updated",
      "past_due",
      existing,
      cpe,
    );
    expect(out).toEqual({ action: "extend", newGrandfather: cpe });
  });

  it("checkout.session.completed on grandfather row with cpe → extend (legacy holder reactivating)", async () => {
    const { computeMarketingOsGrandfatherTarget } = await import(
      "../../server/stripe_webhook"
    );
    const existing = new Date("2026-05-01T00:00:00Z");
    const cpe = new Date("2026-07-01T00:00:00Z");
    const out = computeMarketingOsGrandfatherTarget(
      "checkout.session.completed",
      "active",
      existing,
      cpe,
    );
    expect(out).toEqual({ action: "extend", newGrandfather: cpe });
  });

  // Race regression — delayed renewal arrives after cleanup/lazy-expire
  // cleared grandfather_expires_at; legacySubscriptionMatch must let the
  // helper re-extend instead of silently skipping.
  describe("race regression — delayed renewal after cleanup cleared grandfather", () => {
    it("null grandfather + legacy sub match + future cpe → extend (re-grants window)", async () => {
      const { computeMarketingOsGrandfatherTarget } = await import(
        "../../server/stripe_webhook"
      );
      const cpe = new Date("2026-08-01T00:00:00Z");
      const out = computeMarketingOsGrandfatherTarget(
        "customer.subscription.updated",
        "active",
        null,
        cpe,
        true,
      );
      expect(out).toEqual({ action: "extend", newGrandfather: cpe });
    });

    it("null grandfather + legacy sub match + invoice.payment_succeeded → extend", async () => {
      const { computeMarketingOsGrandfatherTarget } = await import(
        "../../server/stripe_webhook"
      );
      const cpe = new Date("2026-08-15T00:00:00Z");
      const out = computeMarketingOsGrandfatherTarget(
        "invoice.payment_succeeded",
        "active",
        null,
        cpe,
        true,
      );
      expect(out).toEqual({ action: "extend", newGrandfather: cpe });
    });

    it("null grandfather + legacy sub match BUT no cpe → skip (still never fabricates)", async () => {
      const { computeMarketingOsGrandfatherTarget } = await import(
        "../../server/stripe_webhook"
      );
      const out = computeMarketingOsGrandfatherTarget(
        "customer.subscription.updated",
        "active",
        null,
        null,
        true,
      );
      expect(out).toEqual({ action: "skip" });
    });

    it("null grandfather + legacy sub match + canceled status → deactivate (terminal still terminal)", async () => {
      const { computeMarketingOsGrandfatherTarget } = await import(
        "../../server/stripe_webhook"
      );
      const out = computeMarketingOsGrandfatherTarget(
        "customer.subscription.deleted",
        "canceled",
        null,
        null,
        true,
      );
      expect(out).toEqual({ action: "deactivate" });
    });

    it("null grandfather + NO legacy sub match → skip (genuinely tier-derived)", async () => {
      // Negative control: fresh org with no legacy sub stays ignored.
      const { computeMarketingOsGrandfatherTarget } = await import(
        "../../server/stripe_webhook"
      );
      const out = computeMarketingOsGrandfatherTarget(
        "customer.subscription.updated",
        "active",
        null,
        new Date("2026-08-01T00:00:00Z"),
        false,
      );
      expect(out).toEqual({ action: "skip" });
    });
  });
});
