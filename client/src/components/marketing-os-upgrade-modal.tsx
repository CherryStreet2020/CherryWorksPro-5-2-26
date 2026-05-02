/**
 * Sprint 2k — Marketing OS upgrade modal.
 *
 * Opened from the always-on sidebar Marketing section when the org's
 * `marketing_os` entitlement is inactive.
 *
 * Task #392 — Marketing OS is no longer a $99/mo add-on. It is auto-granted
 * to BUSINESS / ENTERPRISE plans. The primary CTA now closes the modal
 * and routes the admin to Settings → Billing where they can upgrade their
 * plan tier through the existing flow.
 */
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { useLocation } from "wouter";
import { trackMarketingOsEvent } from "@/lib/marketing-os-telemetry";

export interface MarketingOsUpgradeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const FEATURE_BULLETS: string[] = [
  "Contacts & companies CRM",
  "Segments and tags",
  "Activity firehose across the org",
  "Per-brand marketing workspaces",
];

export function MarketingOsUpgradeModal({
  open,
  onOpenChange,
}: MarketingOsUpgradeModalProps) {
  const [, navigate] = useLocation();

  function handleUpgrade() {
    // Reuse the existing telemetry event so the funnel dashboards keep
    // tracking modal → upgrade conversion (the click target changed but
    // the user intent is identical: "I want Marketing OS unlocked").
    trackMarketingOsEvent("marketing_os.discovery.checkout_clicked");
    onOpenChange(false);
    navigate("/settings/billing");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        data-testid="dialog-marketing-os-upgrade"
      >
        <DialogHeader>
          <div
            className="w-12 h-12 rounded-xl mb-3 flex items-center justify-center"
            style={{ background: "var(--lux-accent, #cf3339)", color: "#fff" }}
          >
            <Sparkles className="w-6 h-6" />
          </div>
          <DialogTitle data-testid="text-upgrade-title">
            Unlock Marketing OS
          </DialogTitle>
          <DialogDescription data-testid="text-upgrade-subtitle">
            Turn CherryWorks into your contacts hub. Segments, tags, and the
            activity firehose — all wired into your existing projects.
          </DialogDescription>
        </DialogHeader>

        <ul
          className="my-2 space-y-2 text-sm"
          data-testid="list-upgrade-features"
        >
          {FEATURE_BULLETS.map((bullet, i) => (
            <li
              key={bullet}
              className="flex items-start gap-2"
              style={{ color: "var(--lux-text)" }}
              data-testid={`text-upgrade-feature-${i}`}
            >
              <span
                className="mt-1 inline-block h-1.5 w-1.5 rounded-full flex-shrink-0"
                style={{ background: "var(--lux-accent, #cf3339)" }}
                aria-hidden="true"
              />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>

        <p
          className="text-xs"
          style={{ color: "var(--lux-text-muted)" }}
          data-testid="text-upgrade-price"
        >
          Included with the Business and Enterprise plans
        </p>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            data-testid="button-upgrade-not-now"
          >
            Not now
          </Button>
          <Button
            onClick={handleUpgrade}
            data-testid="button-upgrade-marketing-os"
            style={{
              background: "var(--lux-accent, #cf3339)",
              color: "#fff",
            }}
          >
            View plans
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default MarketingOsUpgradeModal;
