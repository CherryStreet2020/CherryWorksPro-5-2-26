/**
 * Marketing OS — Sprint 1: useBrand hook.
 *
 * Returns { activeBrand, brands, setActiveBrand, isLoading } from BrandContext.
 *
 * When MARKETING_OS_ENABLED is unset (provider is a passthrough), context is
 * null and we return safe defaults so consumers never have to flag-check
 * themselves.
 */
import { useContext } from "react";
import { BrandContext, type BrandContextValue } from "@/contexts/BrandContext";

const SAFE_DEFAULTS: BrandContextValue = {
  activeBrand: null,
  brands: [],
  setActiveBrand: () => {},
  isLoading: false,
};

export function useBrand(): BrandContextValue {
  const ctx = useContext(BrandContext);
  if (ctx === null) {
    return SAFE_DEFAULTS;
  }
  return ctx;
}
