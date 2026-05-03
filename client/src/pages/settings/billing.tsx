/**
 * Sprint 2i.4 / Sprint 2j — Settings → Billing entitlements page.
 *
 * Admin-only. Renders the four feature entitlements with a status badge
 * (Active / Grace / Inactive). For paid add-ons (marketing_os, multi_brand,
 * hubspot_bridge), Sprint 2j adds an action button:
 *   • Active or Grace → "Manage in Stripe"  (POST /api/billing/portal)
 *   • Inactive        → "Upgrade $99/mo"    (POST /api/entitlements/<f>/checkout)
 * pso_core stays badge-only (it's the base plan, not purchasable as add-on).
 *
 * Success/cancel redirect handling: if the URL carries `?addon=<f>&status=...`
 * we toast and refresh the entitlements query, then strip the params from
 * the visible URL.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { useDocumentTitle } from "@/lib/use-document-title";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  useEntitlementDetails,
  resolveEntitlementStatus,
  type EntitlementStatus,
} from "@/lib/entitlements";
import type { OrgEntitlementFeature } from "@shared/schema";

const FEATURE_ROWS: Array<{
  key: OrgEntitlementFeature;
  label: string;
  description: string;
  purchasable: boolean;
  priceLabel: string | null;
}> = [
  {
    key: "pso_core",
    label: "PSO Core",
    description: "Projects, time tracking, invoicing, and accounting essentials.",
    purchasable: false,
    priceLabel: null,
  },
  {
    key: "marketing_os",
    label: "Marketing OS",
    // Task #392 — marketing_os is no longer a stand-alone purchase. It's
    // bundled into the Business / Enterprise plan tiers. The row stays
    // visible (so admins still see status), but `purchasable: false`
    // suppresses the legacy "Upgrade $99/mo" Stripe checkout button.
    description:
      "Contacts, companies, segments, and campaign tooling. Included with the Business and Enterprise plans.",
    purchasable: false,
    priceLabel: null,
  },
  {
    key: "multi_brand",
    label: "Multi-Brand",
    description: "Run multiple brands with separate sender identities.",
    purchasable: true,
    priceLabel: "Contact sales",
  },
  {
    key: "hubspot_bridge",
    label: "HubSpot Bridge",
    description: "Two-way sync of contacts and companies with HubSpot.",
    purchasable: true,
    priceLabel: "Contact sales",
  },
];

function StatusBadge({
  status,
  graceEndsAt,
}: {
  status: EntitlementStatus;
  graceEndsAt: Date | null;
}) {
  if (status === "active") {
    return (
      <Badge
        className="border-transparent text-white"
        style={{ background: "#16a34a" }}
        data-testid="badge-status-active"
      >
        Active
      </Badge>
    );
  }
  if (status === "grace") {
    const label = graceEndsAt
      ? `Grace · ends ${graceEndsAt.toLocaleDateString()}`
      : "Grace";
    return (
      <Badge
        className="border-transparent text-white"
        style={{ background: "#f59e0b" }}
        data-testid="badge-status-grace"
      >
        {label}
      </Badge>
    );
  }
  return (
    <Badge
      variant="secondary"
      style={{ background: "var(--lux-border)", color: "var(--lux-text-muted)" }}
      data-testid="badge-status-inactive"
    >
      Inactive
    </Badge>
  );
}

function ActionButton({
  feature,
  status,
  priceLabel,
}: {
  feature: OrgEntitlementFeature;
  status: EntitlementStatus;
  priceLabel: string | null;
}) {
  const { toast } = useToast();
  const [pending, setPending] = useState(false);

  async function startCheckout() {
    setPending(true);
    try {
      const res = await apiRequest(
        "POST",
        `/api/entitlements/${feature}/checkout`,
        {},
      );
      const json = await res.json();
      if (json?.url) {
        window.location.href = json.url;
        return;
      }
      throw new Error(json?.error ?? "Checkout could not be started");
    } catch (err: any) {
      toast({
        title: "Couldn't start checkout",
        description: err?.message ?? "Please try again later.",
        variant: "destructive",
      });
      setPending(false);
    }
  }

  async function openPortal() {
    setPending(true);
    try {
      const res = await apiRequest("POST", "/api/billing/portal", {});
      const json = await res.json();
      if (json?.url) {
        window.location.href = json.url;
        return;
      }
      throw new Error(json?.message ?? "Could not open billing portal");
    } catch (err: any) {
      toast({
        title: "Couldn't open billing portal",
        description: err?.message ?? "Please try again later.",
        variant: "destructive",
      });
      setPending(false);
    }
  }

  if (status === "active" || status === "grace") {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={openPortal}
        data-testid={`button-manage-${feature}`}
      >
        {pending ? "Opening…" : "Manage in Stripe"}
      </Button>
    );
  }
  const isMarketing = feature === "marketing_os";
  const label = isMarketing
    ? pending
      ? "Opening…"
      : `Upgrade ${priceLabel ?? ""}`.trim()
    : pending
      ? "Opening…"
      : "Upgrade";
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={startCheckout}
      data-testid={`button-upgrade-${feature}`}
    >
      {label}
    </Button>
  );
}

/**
 * Task #392 — focused "Upgrade plan" CTA for inactive Marketing OS rows.
 * Opens the same Stripe customer portal entry point that "Manage in Stripe"
 * uses; from the portal the customer can switch tiers (Starter →
 * Professional → Business). Once the upgrade webhook lands and flips
 * orgs.plan_tier, the read-path overlay grants Marketing OS automatically
 * with no further action from the user.
 */
function MarketingOsUpgradePlanButton() {
  const { toast } = useToast();
  const [pending, setPending] = useState(false);

  async function openPortal() {
    setPending(true);
    try {
      const res = await apiRequest("POST", "/api/billing/portal", {});
      const json = await res.json();
      if (json?.url) {
        window.location.href = json.url;
        return;
      }
      throw new Error(json?.message ?? "Could not open billing portal");
    } catch (err: any) {
      toast({
        title: "Couldn't open billing portal",
        description: err?.message ?? "Please try again later.",
        variant: "destructive",
      });
      setPending(false);
    }
  }

  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={openPortal}
      data-testid="button-upgrade-plan-marketing_os"
    >
      {pending ? "Opening…" : "Upgrade plan"}
    </Button>
  );
}

export default function SettingsBillingPage() {
  useDocumentTitle("Billing · Settings");
  const { toast } = useToast();

  const { data, isLoading, isError } = useEntitlementDetails();

  // Sprint 2j — handle ?addon=...&status=success|cancel from Stripe Checkout.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const addon = url.searchParams.get("addon");
    const status = url.searchParams.get("status");
    if (!addon || !status) return;
    // Sprint 2k follow-up — marketing_os success is handled at the top level
    // (App.tsx → MarketingOsCheckoutToast) with a feature-specific message.
    // Skip here to avoid double-toasting; let the top-level handler strip the
    // params so a refresh of the billing page re-renders cleanly.
    if (addon === "marketing_os" && status === "success") return;
    if (status === "success") {
      toast({ title: "Add-on activated", description: `${addon} is now enabled.` });
      queryClient.invalidateQueries({ queryKey: ["/api/me/entitlements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/me/entitlements/details"] });
    } else if (status === "cancel") {
      toast({ title: "Checkout canceled", description: "No charges were made." });
    }
    url.searchParams.delete("addon");
    url.searchParams.delete("status");
    window.history.replaceState({}, "", url.pathname + (url.search ? url.search : ""));
  }, []);

  return (
    <div className="px-6 lg:px-8 xl:px-10 py-6 max-w-5xl mx-auto">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1.5 text-sm mb-4 transition-colors hover:[color:var(--lux-accent,#cf3339)]"
        style={{ color: "var(--lux-text-muted)" }}
        data-testid="button-back-settings"
      >
        <ArrowLeft className="w-3 h-3" />
        Back to Settings
      </Link>

      <div className="mb-6">
        <h1
          className="text-2xl font-bold"
          style={{ color: "var(--lux-text)" }}
          data-testid="text-page-title"
        >
          Billing
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--lux-text-muted)" }}>
          Add-ons currently enabled on this workspace.
        </p>
      </div>

      <Card
        className="border-0"
        style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}
      >
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3" data-testid="status-loading">
              {FEATURE_ROWS.map((row) => (
                <Skeleton key={row.key} className="h-14 w-full rounded-md" />
              ))}
            </div>
          ) : isError ? (
            <div
              className="p-6 text-sm"
              style={{ color: "var(--lux-text-muted)" }}
              data-testid="status-error"
            >
              Couldn't load entitlements. Please try again later.
            </div>
          ) : (
            <ul className="divide-y" style={{ borderColor: "var(--lux-border)" }}>
              {FEATURE_ROWS.map((row) => {
                const detail = data?.[row.key];
                const { status, graceEndsAt } = resolveEntitlementStatus(detail);
                // Task #392 — Surface grandfather + tier-derived hints for
                // marketing_os so admins understand WHY the row is
                // active/inactive after the migration. The row stays
                // non-purchasable; the inline note replaces the legacy CTA.
                // For inactive rows, the right-hand action area renders an
                // actionable "Upgrade plan" button that opens the same
                // Stripe customer portal `Manage in Stripe` uses, so users
                // can change tiers without leaving Settings → Billing.
                const isMarketing = row.key === "marketing_os";
                const showMarketingUpgradeCta =
                  isMarketing && status !== "active" && status !== "grace";
                const grandfatherIso = detail?.grandfatherExpiresAt ?? null;
                const grandfatherDate = grandfatherIso
                  ? new Date(grandfatherIso)
                  : null;
                const grandfatherActive =
                  grandfatherDate !== null &&
                  !Number.isNaN(grandfatherDate.getTime()) &&
                  grandfatherDate.getTime() > Date.now();
                const tierDerived = detail?.tierDerived === true;
                return (
                  <li
                    key={row.key}
                    className="flex items-center justify-between gap-4 px-6 py-4"
                    data-testid={`row-entitlement-${row.key}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div
                        className="font-semibold truncate"
                        style={{ color: "var(--lux-text)" }}
                        data-testid={`text-feature-label-${row.key}`}
                      >
                        {row.label}
                      </div>
                      <div
                        className="text-xs mt-0.5"
                        style={{ color: "var(--lux-text-muted)" }}
                      >
                        {row.description}
                      </div>
                      {isMarketing && tierDerived && status === "active" && (
                        <div
                          className="text-xs mt-1"
                          style={{ color: "var(--lux-text-muted)" }}
                          data-testid="text-marketing-os-tier-included"
                        >
                          Included with your Business plan.
                        </div>
                      )}
                      {isMarketing && grandfatherActive && (
                        <div
                          className="text-xs mt-1"
                          style={{ color: "var(--lux-text-muted)" }}
                          data-testid="text-marketing-os-grandfather"
                        >
                          Legacy add-on — current access ends{" "}
                          {grandfatherDate!.toLocaleDateString()}. Upgrade
                          to the Business plan to keep Marketing OS without
                          interruption.
                        </div>
                      )}
                      {isMarketing &&
                        !tierDerived &&
                        !grandfatherActive &&
                        status !== "active" && (
                          <div
                            className="text-xs mt-1"
                            style={{ color: "var(--lux-text-muted)" }}
                            data-testid="text-marketing-os-upgrade-hint"
                          >
                            Upgrade to the Business plan to unlock
                            Marketing OS.
                          </div>
                        )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <StatusBadge status={status} graceEndsAt={graceEndsAt} />
                      {row.purchasable && (
                        <ActionButton
                          feature={row.key}
                          status={status}
                          priceLabel={row.priceLabel}
                        />
                      )}
                      {showMarketingUpgradeCta && (
                        // Task #392 — actionable Upgrade CTA. Reuses the
                        // existing ActionButton with feature="__plan__"
                        // would force a generic upgrade flow; instead we
                        // render a focused button that opens the same
                        // Stripe customer portal entry point so the user
                        // can change plan tiers without leaving billing.
                        <MarketingOsUpgradePlanButton />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
