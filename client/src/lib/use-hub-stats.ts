import { useQuery } from "@tanstack/react-query";

export interface HubStats {
  billing: {
    invoicesOpen: number;
    invoicesOpenAmount: number;
    estimatesPending: number;
    paymentsThisMonth: number;
    paymentsThisMonthAmount: number;
  };
  management: {
    clients: number;
    activeProjects: number;
    services: number;
    approvalsPending: number;
    payoutsThisMonth: { count: number; amount: number } | null;
  };
  system: {
    apiKeys: number | null;
    webhooksActive: number | null;
    lastClosedPeriod: string | null;
    teamMembers: number;
    lastImport: string | null;
  };
  accounting: {
    glAccounts: number;
    journalEntriesThisMonth: number;
    bankingConnections: number | null;
  };
}

export function useHubStats() {
  return useQuery<HubStats>({
    queryKey: ["/api/hub-stats"],
    staleTime: 60_000,
  });
}
