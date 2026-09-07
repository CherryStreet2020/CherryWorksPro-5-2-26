/**
 * Base-plan list prices — the single source every screen quotes from.
 * These mirror the LIVE Stripe prices (verified 2026-09-07):
 *   Starter       $39/mo   $379/yr
 *   Professional  $89/mo   $849/yr
 *   Business     $159/mo  $1,499/yr
 * annualPerMonth is the rounded monthly equivalent used in marketing copy.
 */
export const PLAN_PRICING = {
  STARTER: { monthly: 39, annual: 379 },
  PROFESSIONAL: { monthly: 89, annual: 849 },
  BUSINESS: { monthly: 159, annual: 1499 },
} as const;
export type PlanId = keyof typeof PLAN_PRICING;
export function annualPerMonth(plan: PlanId): number {
  return Math.round(PLAN_PRICING[plan].annual / 12);
}
