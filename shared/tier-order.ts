export const TIER_ORDER: Record<string, number> = {
  TRIAL: 0,
  STARTER: 1,
  PROFESSIONAL: 2,
  BUSINESS: 3,
  ENTERPRISE: 4,
};

export function tierRank(tier: string | null | undefined): number {
  return TIER_ORDER[tier || "TRIAL"] ?? 0;
}

export function meetsMinTier(currentTier: string | null | undefined, requiredTier: string): boolean {
  return tierRank(currentTier) >= tierRank(requiredTier);
}
