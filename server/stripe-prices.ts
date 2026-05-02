type PlanTier = "STARTER" | "PROFESSIONAL" | "BUSINESS";

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

export function getPriceId(plan: PlanTier, annual: boolean): string {
  const key = process.env.STRIPE_SECRET_KEY;
  const mode = key?.startsWith("sk_live_") ? "live" : "test";
  const interval = annual ? "yearly" : "monthly";
  const envVarName = ENV_MAP[mode][plan]?.[interval];
  if (!envVarName) {
    throw new Error(`Unknown plan/interval: ${plan}/${interval}`);
  }
  const value = process.env[envVarName];
  if (!value) {
    throw new Error(`Missing Stripe price env var: ${envVarName}`);
  }
  return value;
}
