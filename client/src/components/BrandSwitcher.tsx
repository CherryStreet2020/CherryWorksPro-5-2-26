/**
 * Marketing OS — Sprint 1: BrandSwitcher.
 *
 * Header dropdown for choosing the active brand. Renders nothing
 * (returns null) when MARKETING_OS_ENABLED is unset OR when the
 * current org has no brands. Visual scale per Sprint 1 spec:
 * rounded-md, text-sm, px-3 py-1.5, var(--lux-text), hover var(--lux-accent).
 */
import { useLocation } from "wouter";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useBrand } from "@/hooks/useBrand";
import { useEntitlement } from "@/lib/entitlements";

export function BrandSwitcher() {
  const { activeBrand, brands, setActiveBrand } = useBrand();
  const [location, setLocation] = useLocation();
  // Sprint 2i.3: gate on the marketing_os entitlement so non-entitled
  // orgs never render any marketing-related chrome in the header.
  const { active: marketingOsActive } = useEntitlement("marketing_os");

  // Hard gate (cheapest checks first): entitlement → brands → route prefix.
  // Sprint 2e.1: BrandSwitcher must only appear on /marketing/* routes
  // so the brand selector never bleeds into accounting/billing chrome.
  if (
    !marketingOsActive ||
    brands.length === 0 ||
    !location.startsWith("/marketing/")
  ) {
    return null;
  }

  const label = activeBrand?.name ?? "Choose brand";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="button-brand-switcher"
          className="inline-flex items-center gap-1.5 rounded-md text-sm px-3 py-1.5 transition-colors hover:[color:var(--lux-accent,#cf3339)]"
          style={{ color: "var(--lux-text)" }}
        >
          <span className="font-medium" data-testid="text-active-brand">{label}</span>
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-56"
        style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}
      >
        {brands.map((b) => (
          <DropdownMenuItem
            key={b.id}
            onClick={() => setActiveBrand(b.id)}
            data-testid={`menu-item-brand-${b.id}`}
            style={{ color: "var(--lux-text)" }}
          >
            <span className="truncate">{b.name}</span>
            {activeBrand?.id === b.id && (
              <span className="ml-auto text-xs" style={{ color: "var(--lux-text-muted)" }}>active</span>
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => setLocation("/settings/brands")}
          data-testid="menu-item-manage-brands"
          style={{ color: "var(--lux-text)" }}
        >
          Manage brands
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
