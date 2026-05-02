/**
 * Sprint 2j — Marketing OS upgrade gate.
 *
 * Rendered in place of marketing-os routes when the org's `marketing_os`
 * entitlement is inactive (and not in grace).
 *
 * Task #392 — Marketing OS is no longer a $99/mo add-on. It's auto-granted
 * to BUSINESS / ENTERPRISE plans. The CTA now points the admin to the
 * Settings → Billing surface where they can review their plan tier and
 * upgrade through the existing plan-change flow.
 */
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";

export function MarketingOsLockedCard() {
  return (
    <div
      className="px-6 lg:px-8 xl:px-10 py-10 max-w-2xl mx-auto"
      data-testid="card-marketing-os-locked"
    >
      <Card
        className="border-0"
        style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}
      >
        <CardContent className="p-8 text-center">
          <div
            className="w-12 h-12 rounded-xl mx-auto mb-4 flex items-center justify-center"
            style={{ background: "var(--lux-accent, #cf3339)", color: "#fff" }}
          >
            <Sparkles className="w-6 h-6" />
          </div>
          <h2
            className="text-xl font-semibold mb-2"
            style={{ color: "var(--lux-text)" }}
            data-testid="text-marketing-os-locked-title"
          >
            Marketing OS
          </h2>
          <p
            className="text-sm mb-6"
            style={{ color: "var(--lux-text-muted)" }}
            data-testid="text-marketing-os-locked-description"
          >
            Contacts, companies, segments, tags, and the activity firehose
            are included with the Business and Enterprise plans. Upgrade
            your workspace to unlock the full suite.
          </p>
          <Link href="/settings/billing">
            <Button data-testid="button-upgrade-marketing-os-card">
              View plans
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

export default MarketingOsLockedCard;
