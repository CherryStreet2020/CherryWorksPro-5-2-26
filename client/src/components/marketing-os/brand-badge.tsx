/**
 * Sprint 2f.1 — Marketing OS shared <BrandBadge /> chip.
 *
 * Single source of truth for the read-only "Brand: <name>" chip rendered
 * under the H1 on every marketing list page (Contacts, Companies, Tags,
 * Segments, Activity). Reads `activeBrand` from `useBrand()` directly so
 * each consumer is a one-line `<BrandBadge />`. The data-testid
 * `badge-active-brand` is preserved across all pages and is the canonical
 * selector for Playwright/e2e assertions.
 *
 * Markup is intentionally byte-identical to the original Activity-page
 * span (formerly at activity.tsx:135-141) so visual parity is automatic.
 */
import { useBrand } from "@/hooks/useBrand";

export function BrandBadge() {
  const { activeBrand } = useBrand();
  return (
    <span
      className="text-xs px-2 py-1 rounded"
      style={{
        background: "var(--lux-bg)",
        border: "1px solid var(--lux-border)",
        color: "var(--lux-text-muted)",
      }}
      data-testid="badge-active-brand"
    >
      Brand: {activeBrand?.name ?? "—"}
    </span>
  );
}
