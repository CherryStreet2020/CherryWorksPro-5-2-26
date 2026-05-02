/**
 * Sprint 2k — shared client helper for the (legacy) Marketing OS
 * "upgrade" flow.
 *
 * Task #392 — Marketing OS is no longer a standalone Stripe add-on. It is
 * now derived from the org's plan_tier (BUSINESS / ENTERPRISE auto-grant
 * the entitlement). The legacy POST `/api/entitlements/marketing_os/checkout`
 * endpoint hard-stops with HTTP 410 + body `{ code: "MARKETING_OS_TIER_DERIVED" }`.
 *
 * Production callers (the upgrade modal and the locked card) have been
 * rewired to link to `/settings/billing` instead. This helper is kept as a
 * defensive shim — if any future caller calls it by mistake, it surfaces
 * a friendly tier-derived error rather than silently failing. The helper
 * still attempts the network call so server logs can capture the stale
 * call site for follow-up cleanup.
 */
import { apiRequest } from "@/lib/queryClient";

export const MARKETING_OS_CHECKOUT_PATH =
  "/api/entitlements/marketing_os/checkout";

/**
 * Task #392 — sentinel string set as the Error message when the helper is
 * invoked after the migration. Tests assert on this constant so any UI
 * that still depends on the old behavior fails loudly.
 */
export const MARKETING_OS_TIER_DERIVED_ERROR =
  "Marketing OS is no longer a standalone add-on. It's included with the Business and Enterprise plans — visit Settings → Billing to upgrade your plan.";

export interface MarketingOsCheckoutResult {
  url: string;
}

export async function startMarketingOsCheckout(): Promise<MarketingOsCheckoutResult> {
  let res: Response;
  try {
    res = await apiRequest("POST", MARKETING_OS_CHECKOUT_PATH, {});
  } catch (err: any) {
    // apiRequest throws on non-2xx by default; the new 410 ends up here.
    // Detect the tier-derived sentinel so we render the migration message
    // rather than a generic "Checkout could not be started".
    const message: string = err?.message ?? "";
    if (
      message.includes("MARKETING_OS_TIER_DERIVED") ||
      message.includes("410") ||
      message.toLowerCase().includes("no longer a standalone")
    ) {
      throw new Error(MARKETING_OS_TIER_DERIVED_ERROR);
    }
    throw new Error(message || "Checkout could not be started");
  }
  // 410 may also surface as a successful Response with a body — guard both.
  if (res.status === 410) {
    throw new Error(MARKETING_OS_TIER_DERIVED_ERROR);
  }
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    throw new Error("Checkout could not be started");
  }
  if (json?.code === "MARKETING_OS_TIER_DERIVED") {
    throw new Error(MARKETING_OS_TIER_DERIVED_ERROR);
  }
  if (json && typeof json.url === "string" && json.url.length > 0) {
    return { url: json.url };
  }
  throw new Error(json?.error ?? "Checkout could not be started");
}
