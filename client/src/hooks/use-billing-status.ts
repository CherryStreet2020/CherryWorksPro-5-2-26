import { useQuery } from "@tanstack/react-query";

export interface BillingStatus {
  planTier: string;
  subscriptionStatus: string;
  maxTeamMembers: number;
  currentTeamMembers: number;
  trialEndsAt: string | null;
  stripeCustomerId: string | null;
  deletionScheduledFor: string | null;
}

export function useBillingStatus() {
  const query = useQuery<BillingStatus>({
    queryKey: ["/api/billing/status"],
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const planTier = query.data?.planTier || "TRIAL";
  const isStarter = planTier === "STARTER" || planTier === "TRIAL";
  const isProfessionalPlus = ["PROFESSIONAL", "BUSINESS", "ENTERPRISE"].includes(planTier);
  const isBusinessPlus = ["BUSINESS", "ENTERPRISE"].includes(planTier);

  return {
    ...query,
    planTier,
    isStarter,
    isProfessionalPlus,
    isBusinessPlus,
    maxTeamMembers: query.data?.maxTeamMembers ?? 5,
    currentTeamMembers: query.data?.currentTeamMembers ?? 0,
  };
}
