/**
 * Marketing OS — Sprint 1: BrandContext.
 *
 * When MARKETING_OS_ENABLED is unset, BrandProvider is a passthrough that
 * renders children without mounting any state, fetcher, or context value.
 * useBrand() returns safe defaults in that case (see ../hooks/useBrand.ts).
 *
 * When enabled, the provider:
 *  - fetches /api/brands via TanStack Query (queryKey ["/api/brands"])
 *  - hydrates activeBrandId from localStorage["cwp_active_brand_id"] on mount
 *  - persists activeBrandId to the same localStorage key on change
 *  - exposes { activeBrand, brands, setActiveBrand, isLoading } via context
 */
import { createContext, useEffect, useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { isMarketingOsEnabled } from "@/lib/featureFlags";
import type { Brand } from "@shared/schema";

const STORAGE_KEY = "cwp_active_brand_id";

export type BrandContextValue = {
  activeBrand: Brand | null;
  brands: Brand[];
  setActiveBrand: (id: string | null) => void;
  isLoading: boolean;
};

export const BrandContext = createContext<BrandContextValue | null>(null);

function readStoredBrandId(): string | null {
  try {
    return typeof window !== "undefined"
      ? window.localStorage.getItem(STORAGE_KEY)
      : null;
  } catch {
    return null;
  }
}

function writeStoredBrandId(id: string | null): void {
  try {
    if (typeof window === "undefined") return;
    if (id === null) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, id);
    }
  } catch {
    // swallow — storage failures are non-fatal
  }
}

export function BrandProvider({ children }: { children: React.ReactNode }) {
  // Passthrough no-op when the flag is off. No state, no fetch, no context value.
  if (!isMarketingOsEnabled()) {
    return <>{children}</>;
  }
  return <BrandProviderInner>{children}</BrandProviderInner>;
}

function BrandProviderInner({ children }: { children: React.ReactNode }) {
  const [activeBrandId, setActiveBrandId] = useState<string | null>(null);

  // Hydrate from localStorage on mount (client-only).
  useEffect(() => {
    const stored = readStoredBrandId();
    if (stored) setActiveBrandId(stored);
  }, []);

  const { data: brands = [], isLoading } = useQuery<Brand[]>({
    queryKey: ["/api/brands"],
  });

  // Auto-select the only brand when the org has exactly one. This is a UX
  // win (no friction for solo operators with a single brand) AND the
  // behavior the e2e smoke depends on. Multi-brand orgs still require
  // explicit selection.
  useEffect(() => {
    if (isLoading) return;
    // Priority 1: keep stored id only if it still exists in the loaded list.
    if (activeBrandId && brands.some((b) => b.id === activeBrandId)) return;
    // Priority 1 (cont.): stored id is stale — clear it.
    if (activeBrandId && !brands.some((b) => b.id === activeBrandId)) {
      setActiveBrandId(null);
      writeStoredBrandId(null);
    }
    // Priority 2: exactly one brand → auto-select and persist.
    if (brands.length === 1) {
      setActiveBrandId(brands[0].id);
      writeStoredBrandId(brands[0].id);
      return;
    }
    // Priority 3 (>1 brands, no stored match) and Priority 4 (0 brands):
    // leave activeBrandId null — user must pick (or there's nothing to pick).
  }, [brands, isLoading, activeBrandId]);

  const activeBrand = useMemo<Brand | null>(() => {
    if (!activeBrandId) return null;
    return brands.find((b) => b.id === activeBrandId) ?? null;
  }, [brands, activeBrandId]);

  const setActiveBrand = useCallback((id: string | null) => {
    setActiveBrandId(id);
    writeStoredBrandId(id);
  }, []);

  const value = useMemo<BrandContextValue>(
    () => ({ activeBrand, brands, setActiveBrand, isLoading }),
    [activeBrand, brands, setActiveBrand, isLoading],
  );

  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}
