/**
 * What trial, if any, a base-plan Checkout session should carry.
 *
 * Signup promised 14 days from signup (orgs.trial_ends_at). Choosing a plan
 * mid-trial keeps THAT deadline; it does not restart the clock. A workspace
 * whose trial already ended (or that never had one) bills immediately.
 * Stripe requires trial_end to be at least 48 hours out, so a trial with
 * less than that left is extended to the minimum rather than dropped.
 */
export const STRIPE_MIN_TRIAL_MS = 48 * 60 * 60 * 1000;

export type CheckoutTrial = { trial_end: number } | null;

export function checkoutTrialFor(org: { subscriptionStatus?: string | null; stripeSubscriptionId?: string | null; trialEndsAt?: Date | null }, now = new Date()): CheckoutTrial {
  if (org.subscriptionStatus !== "trialing" || org.stripeSubscriptionId) return null;
  if (!org.trialEndsAt) return null;
  const remaining = org.trialEndsAt.getTime() - now.getTime();
  if (remaining <= 0) return null;
  const end = Math.max(org.trialEndsAt.getTime(), now.getTime() + STRIPE_MIN_TRIAL_MS);
  return { trial_end: Math.floor(end / 1000) };
}
