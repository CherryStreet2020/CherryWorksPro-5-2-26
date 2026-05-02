import { useQuery } from "@tanstack/react-query";

export function useBaseCurrency(): string {
  const { data: org } = useQuery<any>({
    queryKey: ["/api/org/settings"],
    staleTime: 5 * 60 * 1000,
  });
  return org?.baseCurrency || "USD";
}
