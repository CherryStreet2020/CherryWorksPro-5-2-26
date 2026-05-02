/**
 * StatusRibbon — Sprint 2m premium primitive.
 *
 * Lifecycle stage chip: lead → mql → sql → opportunity → customer →
 * evangelist. Each stage has a per-stage gradient that contrasts on
 * both `--lux-bg` and `--lux-surface` in both themes.
 *
 * Theme behaviour: Gradient + text colors are tuned to clear contrast
 * in both modes and routed through `--stage-*` CSS custom properties so
 * brand teams can retune them in one place. Wrapping a ribbon in an
 * interactive parent is fine;
 * any interactive ancestor should use the project focus-ring rule
 * (`box-shadow: 0 0 0 2px rgba(var(--lux-accent-rgb), 0.25)` directly
 * on `:focus-visible`, never `var(--lux-focus-ring)`).
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export type LifecycleStage =
  | "lead"
  | "mql"
  | "sql"
  | "opportunity"
  | "customer"
  | "evangelist";

const STAGES: Record<
  LifecycleStage,
  { label: string; from: string; to: string; text: string }
> = {
  lead:        { label: "Lead",        from: "var(--stage-lead-from)",        to: "var(--stage-lead-to)",        text: "var(--stage-lead-text)" },
  mql:         { label: "MQL",         from: "var(--stage-mql-from)",         to: "var(--stage-mql-to)",         text: "var(--stage-mql-text)" },
  sql:         { label: "SQL",         from: "var(--stage-sql-from)",         to: "var(--stage-sql-to)",         text: "var(--stage-sql-text)" },
  opportunity: { label: "Opportunity", from: "var(--stage-opportunity-from)", to: "var(--stage-opportunity-to)", text: "var(--stage-opportunity-text)" },
  customer:    { label: "Customer",    from: "var(--stage-customer-from)",    to: "var(--stage-customer-to)",    text: "var(--stage-customer-text)" },
  evangelist:  { label: "Evangelist",  from: "var(--stage-evangelist-from)",  to: "var(--stage-evangelist-to)",  text: "var(--stage-evangelist-text)" },
};

export interface StatusRibbonProps {
  stage: LifecycleStage;
  className?: string;
}

export function StatusRibbon({ stage, className }: StatusRibbonProps) {
  const s = STAGES[stage];
  return (
    <span
      data-testid={`premium-status-ribbon-${stage}`}
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wide",
        className,
      )}
      style={{
        backgroundImage: `linear-gradient(135deg, ${s.from}, ${s.to})`,
        color: s.text,
        boxShadow: "0 1px 2px rgba(0,0,0,0.15)",
      }}
    >
      {s.label}
    </span>
  );
}

export default StatusRibbon;
