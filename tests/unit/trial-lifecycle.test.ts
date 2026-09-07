import { describe, it, expect } from "vitest";
import { trialActionFor, planInactive } from "../../server/trial-lifecycle";
import { tempCredentialMarker, tempCredentialProves, hashToken } from "../../server/email-verification";

const DAY = 86_400_000;
const now = new Date("2026-09-10T12:00:00Z");
const org = (over: Partial<Parameters<typeof trialActionFor>[0]> = {}) => ({
  planTier: "TRIAL", subscriptionStatus: "trialing", stripeSubscriptionId: null,
  trialEndsAt: new Date(now.getTime() + 10 * DAY), trialReminder7SentAt: null, trialReminder1SentAt: null, ...over,
});

describe("trial lifecycle decisions", () => {
  it("does nothing while more than 7 days remain", () => {
    expect(trialActionFor(org(), now)).toBeNull();
  });
  it("reminds at 7 days once, then at 1 day once, then expires", () => {
    const at7 = org({ trialEndsAt: new Date(now.getTime() + 6 * DAY) });
    expect(trialActionFor(at7, now)).toBe("remind_7d");
    expect(trialActionFor({ ...at7, trialReminder7SentAt: now }, now)).toBeNull();
    const at1 = org({ trialEndsAt: new Date(now.getTime() + 12 * 60 * 60 * 1000), trialReminder7SentAt: now });
    expect(trialActionFor(at1, now)).toBe("remind_1d");
    expect(trialActionFor({ ...at1, trialReminder1SentAt: now }, now)).toBeNull();
    expect(trialActionFor(org({ trialEndsAt: new Date(now.getTime() - 1) }), now)).toBe("expire");
  });
  it("inside the last day only the 1-day reminder exists: a missed 7-day reminder is never sent late", () => {
    const lastDay = org({ trialEndsAt: new Date(now.getTime() + 6 * 60 * 60 * 1000) });
    expect(trialActionFor(lastDay, now)).toBe("remind_1d");
    expect(trialActionFor({ ...lastDay, trialReminder1SentAt: now }, now)).toBeNull();
  });
  it("leaves Stripe-managed, comped, and already-closed workspaces alone", () => {
    expect(trialActionFor(org({ stripeSubscriptionId: "sub_1", trialEndsAt: new Date(now.getTime() - DAY) }), now)).toBeNull();
    expect(trialActionFor(org({ planTier: "ENTERPRISE", trialEndsAt: new Date(now.getTime() - DAY) }), now)).toBeNull();
    expect(trialActionFor(org({ subscriptionStatus: "trial_expired", trialEndsAt: new Date(now.getTime() - DAY) }), now)).toBeNull();
    expect(trialActionFor(org({ subscriptionStatus: "active", trialEndsAt: new Date(now.getTime() - DAY) }), now)).toBeNull();
    expect(trialActionFor(org({ trialEndsAt: null }), now)).toBeNull();
  });
  it("planInactive: trial_expired or an EXPIRED tier; everything else is active", () => {
    expect(planInactive({ planTier: "TRIAL", subscriptionStatus: "trial_expired" })).toBe(true);
    expect(planInactive({ planTier: "EXPIRED", subscriptionStatus: "canceled" })).toBe(true);
    expect(planInactive({ planTier: "TRIAL", subscriptionStatus: "trialing" })).toBe(false);
    expect(planInactive({ planTier: "PROFESSIONAL", subscriptionStatus: "past_due" })).toBe(false);
    expect(planInactive({ planTier: "ENTERPRISE", subscriptionStatus: "trial_expired" })).toBe(false);
    // A no-card trial past its deadline is inactive on the request path, before the hourly tick lands.
    expect(planInactive({ planTier: "TRIAL", subscriptionStatus: "trialing", stripeSubscriptionId: null, trialEndsAt: new Date(now.getTime() - 1) }, now)).toBe(true);
    expect(planInactive({ planTier: "TRIAL", subscriptionStatus: "trialing", stripeSubscriptionId: "sub_1", trialEndsAt: new Date(now.getTime() - 1) }, now)).toBe(false);
    expect(planInactive({ planTier: "TRIAL", subscriptionStatus: "trialing", stripeSubscriptionId: null, trialEndsAt: new Date(now.getTime() + DAY) }, now)).toBe(false);
    expect(planInactive(null)).toBe(false);
  });

  it("temp-credential marker fits the column, is address-bound, and can never equal a token hash", () => {
    const m = tempCredentialMarker("  Person@Example.com ");
    expect(m.length).toBe(64);
    expect(m).toBe(tempCredentialMarker("person@example.com"));
    expect(tempCredentialProves({ email: "person@example.com", emailVerificationTokenHash: m })).toBe(true);
    expect(tempCredentialProves({ email: "other@example.com", emailVerificationTokenHash: m })).toBe(false);
    expect(tempCredentialProves({ email: "person@example.com", emailVerificationTokenHash: null })).toBe(false);
    expect(/^[0-9a-f]{64}$/.test(hashToken("anything"))).toBe(true);
    expect(/^[0-9a-f]{64}$/.test(m)).toBe(false);
  });
});
