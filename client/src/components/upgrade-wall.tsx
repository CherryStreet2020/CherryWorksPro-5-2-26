import { type ReactNode, useState, type ComponentType } from "react";
import { Lock, ArrowRight, Eye, X, ChevronLeft, ChevronRight as ChevRight, Check } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useBillingStatus } from "@/hooks/use-billing-status";
import { TIER_RANK, TIER_LABEL } from "@/lib/tier-config";
import { BankingPreview, bankingBenefits } from "@/components/previews/BankingPreview";
import { ImportPreview, importBenefits } from "@/components/previews/ImportPreview";
import { IntegrationsPreview, integrationsBenefits } from "@/components/previews/IntegrationsPreview";
import { ClosePeriodsPreview, closePeriodsBenefits } from "@/components/previews/ClosePeriodsPreview";
import { ApprovalsPreview, approvalsBenefits } from "@/components/previews/ApprovalsPreview";

interface FeaturePreviewConfig {
  preview: ComponentType;
  benefits: string[];
}

const FEATURE_PREVIEWS: Record<string, FeaturePreviewConfig> = {
  Banking: { preview: BankingPreview, benefits: bankingBenefits },
  Import: { preview: ImportPreview, benefits: importBenefits },
  "API & Integrations": { preview: IntegrationsPreview, benefits: integrationsBenefits },
  "Close Periods": { preview: ClosePeriodsPreview, benefits: closePeriodsBenefits },
  Approvals: { preview: ApprovalsPreview, benefits: approvalsBenefits },
};

interface UpgradeWallProps {
  requiredTier: "PROFESSIONAL" | "BUSINESS" | "ENTERPRISE";
  featureName: string;
  description?: string;
  children: ReactNode;
}

function PreviewGalleryModal({ featureName, Preview, onClose }: { featureName: string; Preview: ComponentType; onClose: () => void }) {
  const [page, setPage] = useState(0);
  const titles = [`${featureName} — Dashboard View`, `${featureName} — Detail View`, `${featureName} — Workflow View`];
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-4xl max-h-[85vh] rounded-2xl overflow-hidden flex flex-col"
        style={{ background: "var(--lux-surface)", border: "1px solid var(--lux-border)", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.4)" }}
        onClick={e => e.stopPropagation()}
        data-testid="preview-gallery-modal"
      >
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid var(--lux-border)" }}>
          <div>
            <h3 className="text-lg font-bold" style={{ color: "var(--lux-text)" }}>{titles[page]}</h3>
            <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>Preview — {page + 1} of {titles.length}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer" data-testid="button-close-gallery">
            <X className="w-5 h-5" style={{ color: "var(--lux-text-muted)" }} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto" style={{ background: "var(--lux-bg-muted)" }}>
          <div style={{ transform: `scale(${page === 0 ? 1 : page === 1 ? 0.95 : 0.9})`, transformOrigin: "top center", transition: "transform 0.3s ease" }}>
            <Preview />
          </div>
        </div>
        <div className="flex items-center justify-between px-6 py-3" style={{ borderTop: "1px solid var(--lux-border)" }}>
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)} data-testid="button-gallery-prev">
            <ChevronLeft className="w-4 h-4 mr-1" /> Previous
          </Button>
          <div className="flex gap-1.5">
            {titles.map((_, i) => (
              <button
                key={i}
                onClick={() => setPage(i)}
                className="w-2 h-2 rounded-full transition-all cursor-pointer"
                style={{ background: i === page ? "hsl(var(--primary))" : "var(--lux-border)", transform: i === page ? "scale(1.3)" : "scale(1)" }}
              />
            ))}
          </div>
          <Button variant="outline" size="sm" disabled={page === titles.length - 1} onClick={() => setPage(p => p + 1)} data-testid="button-gallery-next">
            Next <ChevRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function UpgradeWall({ requiredTier, featureName, description, children }: UpgradeWallProps) {
  const { planTier, isLoading } = useBillingStatus();
  const [galleryOpen, setGalleryOpen] = useState(false);

  if (isLoading) return null;

  const currentRank = TIER_RANK[planTier] ?? 0;
  const requiredRank = TIER_RANK[requiredTier] ?? 0;

  if (currentRank >= requiredRank) {
    return <>{children}</>;
  }

  const tierLabel = TIER_LABEL[requiredTier] || requiredTier;
  const previewConfig = FEATURE_PREVIEWS[featureName];

  if (!previewConfig) {
    return (
      <div className="px-6 lg:px-8 xl:px-10 py-6 flex items-center justify-center" style={{ minHeight: "60vh" }}>
        <Card
          className="w-full max-w-lg rounded-2xl border-0 overflow-hidden"
          style={{ background: "var(--lux-card-bg)", boxShadow: "var(--lux-card-shadow)", border: "1px solid var(--lux-border)" }}
          data-testid={`upgrade-wall-${featureName.toLowerCase().replace(/\s+/g, "-")}`}
        >
          <CardContent className="py-14 px-10 space-y-5 text-center">
            <div className="mx-auto w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "var(--gradient-brand)" }}>
              <Lock className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-xl font-bold" style={{ color: "var(--lux-text)" }} data-testid="text-upgrade-wall-title">
              {featureName} is a {tierLabel} feature
            </h2>
            <p className="text-sm leading-relaxed" style={{ color: "var(--lux-text-muted)" }}>
              {description || `Upgrade to ${tierLabel} to unlock ${featureName}.`}
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
              <Link href="/settings?tab=subscription">
                <Button className="text-white font-medium px-6" style={{ background: "var(--gradient-brand)" }} data-testid="button-upgrade-plan">
                  Upgrade to {tierLabel} <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { preview: Preview, benefits } = previewConfig;

  return (
    <div className="px-6 lg:px-8 xl:px-10 py-6" data-testid={`upgrade-wall-${featureName.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="relative w-full max-w-5xl mx-auto">
        <div
          className="relative rounded-2xl overflow-hidden"
          style={{ border: "1px solid var(--lux-border)", boxShadow: "var(--lux-card-shadow)" }}
        >
          <div
            className="pointer-events-none select-none"
            style={{ filter: "blur(2px) brightness(0.7)", opacity: 0.5 }}
            aria-hidden="true"
          >
            <Preview />
          </div>

          <div className="absolute inset-0 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.08)", backdropFilter: "blur(1px)" }}>
            <Card
              className="w-full max-w-md rounded-2xl border-0 overflow-hidden"
              style={{
                background: "var(--lux-card-bg)",
                boxShadow: "0 20px 60px -15px rgba(0,0,0,0.3), 0 0 0 1px var(--lux-border)",
              }}
            >
              <CardContent className="py-8 px-8 space-y-5">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "var(--gradient-brand)" }}>
                    <Lock className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold" style={{ color: "var(--lux-text)" }} data-testid="text-upgrade-wall-title">
                      Unlock {featureName}
                    </h2>
                    <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
                      Available on {tierLabel} and above
                    </p>
                  </div>
                </div>

                <ul className="space-y-2.5">
                  {benefits.map((b, i) => (
                    <li key={i} className="flex items-start gap-2.5">
                      <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: "rgba(34,197,94,0.1)" }}>
                        <Check className="w-3 h-3 text-green-600" />
                      </div>
                      <span className="text-sm leading-snug" style={{ color: "var(--lux-text-secondary)" }}>{b}</span>
                    </li>
                  ))}
                </ul>

                <div className="space-y-2 pt-1">
                  <Link href="/settings?tab=subscription">
                    <Button
                      className="w-full text-white font-medium"
                      style={{ background: "var(--gradient-brand)" }}
                      data-testid="button-upgrade-plan"
                    >
                      Upgrade to {tierLabel}
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </Link>
                  <Button
                    variant="ghost"
                    className="w-full text-sm"
                    style={{ color: "var(--lux-text-muted)" }}
                    onClick={() => setGalleryOpen(true)}
                    data-testid="button-view-preview"
                  >
                    <Eye className="w-4 h-4 mr-2" />
                    View full preview
                  </Button>
                </div>

                <p className="text-[10px] text-center" style={{ color: "var(--lux-text-muted)" }}>
                  Current plan: <span className="font-semibold" style={{ color: "var(--lux-accent)" }}>{planTier}</span>
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {galleryOpen && (
        <PreviewGalleryModal
          featureName={featureName}
          Preview={Preview}
          onClose={() => setGalleryOpen(false)}
        />
      )}
    </div>
  );
}
