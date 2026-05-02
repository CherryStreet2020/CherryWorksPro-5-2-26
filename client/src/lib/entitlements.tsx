/**
 * Sprint 2i.3 — Frontend entitlement hook + gate.
 *
 * Single source of truth for "does this org have this feature?" on the
 * client. Backed by GET /api/me/entitlements and cached for the session
 * via React Query (one shared query key, long staleTime).
 *
 * Use `useEntitlement(feature)` to read the boolean reactively, or wrap
 * any UI in `<EntitlementGate feature="marketing_os">…</EntitlementGate>`
 * to make it literally invisible to non-entitled orgs.
 */
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import type { OrgEntitlementFeature } from "@shared/schema";

export type EntitlementMap = Record<OrgEntitlementFeature, boolean>;

/**
 * Sprint 2i.4 — richer per-feature shape used by the Settings → Billing
 * page to compute the **Grace** badge. Backed by
 * GET /api/me/entitlements/details (admin-only).
 */
export type EntitlementDetail = {
  active: boolean;
  gracePeriodEndsAt: string | null;
  /**
   * Task #392 — Non-null only when the row is a legacy marketing_os
   * grandfather hold (existing add-on holder kept active until their
   * Stripe `current_period_end`). The Settings → Billing surface uses
   * this to render the "current access ends <date>" notice.
   */
  grandfatherExpiresAt: string | null;
  /**
   * Task #392 — `true` when this entitlement is currently honored because
   * the org's plan_tier auto-grants it (vs. via a persisted entitlement
   * row). Surfaced so the UI can render the "Included with Business plan"
   * copy and hide the legacy add-on CTA.
   */
  tierDerived: boolean;
};
export type EntitlementDetailsMap = Record<OrgEntitlementFeature, EntitlementDetail>;

const ENTITLEMENTS_QUERY_KEY = ["/api/me/entitlements"] as const;
const ENTITLEMENT_DETAILS_QUERY_KEY = ["/api/me/entitlements/details"] as const;

interface EntitlementResult {
  active: boolean;
  isLoading: boolean;
}

export function useEntitlement(feature: OrgEntitlementFeature): EntitlementResult {
  const { data, isLoading } = useQuery<EntitlementMap>({
    queryKey: ENTITLEMENTS_QUERY_KEY,
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });
  return {
    active: data?.[feature] === true,
    isLoading,
  };
}

interface EntitlementDetailsResult {
  data: EntitlementDetailsMap | undefined;
  isLoading: boolean;
  isError: boolean;
}

/**
 * Returns the per-feature `{ active, gracePeriodEndsAt }` map for the
 * authenticated admin's org. Shares its query key with React Query so
 * any consumer reads the same cached snapshot.
 */
export function useEntitlementDetails(): EntitlementDetailsResult {
  const { data, isLoading, isError } = useQuery<EntitlementDetailsMap>({
    queryKey: ENTITLEMENT_DETAILS_QUERY_KEY,
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });
  return { data, isLoading, isError };
}

export type EntitlementStatus = "active" | "inactive" | "grace";

/**
 * Pure helper — given a detail row (or undefined), compute the badge
 * status and, when in Grace, the future end date. `now` is injectable
 * for deterministic tests.
 */
export function resolveEntitlementStatus(
  detail: EntitlementDetail | undefined,
  now: number = Date.now(),
): { status: EntitlementStatus; graceEndsAt: Date | null } {
  if (!detail) return { status: "inactive", graceEndsAt: null };
  if (detail.gracePeriodEndsAt) {
    const ends = new Date(detail.gracePeriodEndsAt);
    if (!Number.isNaN(ends.getTime()) && ends.getTime() > now) {
      return { status: "grace", graceEndsAt: ends };
    }
  }
  return { status: detail.active ? "active" : "inactive", graceEndsAt: null };
}

interface EntitlementGateProps {
  feature: OrgEntitlementFeature;
  children: ReactNode;
  fallback?: ReactNode;
}

export function EntitlementGate({ feature, children, fallback = null }: EntitlementGateProps) {
  const { active, isLoading } = useEntitlement(feature);
  if (isLoading) {
    // Minimal skeleton placeholder — gate is invisible plumbing, not a UI
    // element, so we render a tiny non-interactive shimmer that occupies
    // negligible space while the entitlements query resolves.
    return (
      <Skeleton
        aria-hidden="true"
        className="h-3 w-3 rounded-sm"
        data-testid="entitlement-gate-loading"
      />
    );
  }
  if (!active) return <>{fallback}</>;
  return <>{children}</>;
}
