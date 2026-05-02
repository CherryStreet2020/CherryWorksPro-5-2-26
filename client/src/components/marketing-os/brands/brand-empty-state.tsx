/**
 * BrandEmptyState — Sprint 2n.
 *
 * Full-width premium empty state shown when the brand list is empty.
 * Wrapped in `SectionCard` per spec. Surfaces and borders inherit
 * from SectionCard (`--lux-*` tokens). Focus indicator on the CTA is
 * the shadcn Button default (already correct).
 */
import { Sparkles, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/marketing-os/premium/section-card";

export interface BrandEmptyStateProps {
  onAdd: () => void;
}

export function BrandEmptyState({ onAdd }: BrandEmptyStateProps) {
  return (
    <SectionCard
      icon={<Sparkles className="h-4 w-4" />}
      title="No brands yet"
      subtitle="Brands let you send marketing emails from a verified domain with a consistent voice and color palette."
      data-testid="empty-state-brands"
    >
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <p
          className="max-w-sm text-sm"
          style={{ color: "var(--lux-text-muted)" }}
        >
          Create your first brand to start sending campaigns.
        </p>
        <Button
          onClick={onAdd}
          className="inline-flex items-center gap-1.5"
          data-testid="button-add-first-brand"
        >
          <Plus className="h-4 w-4" />
          Add Brand
        </Button>
      </div>
    </SectionCard>
  );
}

export default BrandEmptyState;
