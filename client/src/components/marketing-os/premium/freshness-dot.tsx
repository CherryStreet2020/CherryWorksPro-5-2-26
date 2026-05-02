/**
 * FreshnessDot — Sprint 2m premium primitive.
 *
 * Tiny colored dot indicating recency of last activity:
 *   <7d   → green
 *   7–30d → amber
 *   >30d  → red-muted
 *   null  → gray
 * Soft halo so it reads on both `--lux-bg` and `--lux-surface`.
 *
 * Theme behaviour: Dot colors flow through `--status-*` CSS custom
 * properties so brand teams can retune them in one place. The halo
 * uses `color-mix` so it adapts to either surface. No interactive
 * elements; any wrapping focusable parent should use `box-shadow: 0 0
 * 0 2px rgba(var(--lux-accent-rgb), 0.25)` directly on
 * `:focus-visible` (never `var(--lux-focus-ring)`).
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export interface FreshnessDotProps {
  lastActivityAt: Date | string | null | undefined;
  className?: string;
  showLabel?: boolean;
}

function classify(input: FreshnessDotProps["lastActivityAt"]) {
  if (!input) return { color: "var(--status-unknown)", label: "Never" };
  const ts = input instanceof Date ? input.getTime() : new Date(input).getTime();
  if (Number.isNaN(ts)) return { color: "var(--status-unknown)", label: "Never" };
  const days = (Date.now() - ts) / (1000 * 60 * 60 * 24);
  if (days < 7) return { color: "var(--status-active)", label: "Active" };
  if (days <= 30) return { color: "var(--status-cooling)", label: "Cooling" };
  return { color: "var(--status-stale)", label: "Stale" };
}

export function FreshnessDot({
  lastActivityAt,
  className,
  showLabel = false,
}: FreshnessDotProps) {
  const { color, label } = classify(lastActivityAt);
  return (
    <span
      data-testid="premium-freshness-dot"
      className={cn("inline-flex items-center gap-1.5", className)}
      title={label}
    >
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{
          background: color,
          boxShadow: `0 0 0 3px color-mix(in srgb, ${color} 13%, transparent)`,
        }}
        aria-hidden
      />
      {showLabel ? (
        <span
          className="text-xs"
          style={{ color: "var(--lux-text-muted)" }}
        >
          {label}
        </span>
      ) : null}
    </span>
  );
}

export default FreshnessDot;
