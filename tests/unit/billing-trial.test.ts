import { describe, it, expect } from "vitest";
import { checkoutTrialFor, STRIPE_MIN_TRIAL_MS } from "../../server/billing-trial";
import { TEST_BASE as BASE } from "../helpers/base";

const now = new Date("2026-09-10T12:00:00Z");
const DAY = 86_400_000;

describe("checkout trial policy", () => {
  it("keeps the signup deadline mid-trial, never restarts it", () => {
    const t = checkoutTrialFor({ subscriptionStatus: "trialing", stripeSubscriptionId: null, trialEndsAt: new Date(now.getTime() + 9 * DAY) }, now);
    expect(t).toEqual({ trial_end: Math.floor((now.getTime() + 9 * DAY) / 1000) });
  });
  it("extends only to Stripe's 48-hour minimum when less than that is left", () => {
    const t = checkoutTrialFor({ subscriptionStatus: "trialing", stripeSubscriptionId: null, trialEndsAt: new Date(now.getTime() + 6 * 60 * 60 * 1000) }, now);
    expect(t).toEqual({ trial_end: Math.floor((now.getTime() + STRIPE_MIN_TRIAL_MS) / 1000) });
  });
  it("bills immediately when the trial ended, never existed, or a subscription already exists", () => {
    expect(checkoutTrialFor({ subscriptionStatus: "trial_expired", stripeSubscriptionId: null, trialEndsAt: new Date(now.getTime() - DAY) }, now)).toBeNull();
    expect(checkoutTrialFor({ subscriptionStatus: "trialing", stripeSubscriptionId: null, trialEndsAt: new Date(now.getTime() - 1) }, now)).toBeNull();
    expect(checkoutTrialFor({ subscriptionStatus: "canceled", stripeSubscriptionId: null, trialEndsAt: null }, now)).toBeNull();
    expect(checkoutTrialFor({ subscriptionStatus: "trialing", stripeSubscriptionId: "sub_1", trialEndsAt: new Date(now.getTime() + DAY) }, now)).toBeNull();
  });
});

async function login(email: string, password: string) {
  const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  const cookies = res.headers.getSetCookie?.() ?? [];
  return { ok: res.ok, cookie: cookies.map((c: string) => c.split(";")[0]).join("; "), csrf: res.headers.get("x-csrf-token") || "" };
}
describe("billing endpoints are admin-only", () => {
  it("a team member gets 403 on checkout and portal before any Stripe call", async () => {
    const s = await login("team.test@cwpro.dev", "team123");
    expect(s.ok).toBe(true);
    for (const p of ["/api/billing/checkout", "/api/billing/portal"]) {
      const r = await fetch(`${BASE}${p}`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: s.cookie, "X-CSRF-Token": s.csrf }, body: JSON.stringify({ plan: "PROFESSIONAL" }) });
      expect(r.status, p).toBe(403);
    }
  });
});
