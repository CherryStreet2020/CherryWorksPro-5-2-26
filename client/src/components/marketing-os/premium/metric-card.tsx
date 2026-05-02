/**
 * MetricCard — Sprint 2m premium primitive.
 *
 * Label, large value, optional delta arrow, optional icon.
 *
 * Theme behaviour: Surface, border and shadow use `--lux-*` tokens that
 * flip with the `.dark` selector. Positive delta uses `--trend-up` and
 * negative delta uses `--trend-down` so brand teams can retune both in
 * one place. No interactive child here, but the card itself is
 * focusable when wrapped — focus indicator uses `box-shadow: 0 0 0 2px
 * rgba(var(--lux-accent-rgb), 0.25)` directly on `:focus-visible`
 * (never `var(--lux-focus-ring)`).
 */
import * as React from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MetricCardProps {
  label: string;
  value: React.ReactNode;
  delta?: number;
  deltaLabel?: string;
  icon?: React.ReactNode;
  className?: string;
}

export function MetricCard({
  label,
  value,
  delta,
  deltaLabel,
  icon,
  className,
}: MetricCardProps) {
  const positive = typeof delta === "number" && delta > 0;
  const negative = typeof delta === "number" && delta < 0;
  return (
    <div
      data-testid="premium-metric-card"
      className={cn(
        "relative overflow-hidden rounded-xl border p-5 transition-all duration-150 ease-out",
        className,
      )}
      style={{
        background: "var(--lux-surface)",
        borderColor: "var(--lux-border)",
        boxShadow: "var(--lux-card-shadow)",
        backgroundImage:
          "linear-gradient(135deg, rgba(var(--lux-accent-rgb), 0.06), transparent 55%)",
      }}
    >
      <div className="flex items-start justify-between">
        <div
          className="text-xs font-medium uppercase tracking-wide"
          style={{ color: "var(--lux-text-muted)" }}
        >
          {label}
        </div>
        {icon ? (
          <div style={{ color: "var(--lux-accent)" }} aria-hidden>
            {icon}
          </div>
        ) : null}
      </div>
      <div
        className="mt-2 text-3xl font-semibold tabular-nums"
        style={{ color: "var(--lux-text)" }}
        data-testid="metric-value"
      >
        {value}
      </div>
      {typeof delta === "number" ? (
        <div
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium"
          style={{
            color: positive
              ? "var(--trend-up)"
              : negative
                ? "var(--trend-down)"
                : "var(--lux-text-muted)",
          }}
          data-testid="metric-delta"
        >
          {positive ? (
            <ArrowUpRight className="h-3 w-3" />
          ) : negative ? (
            <ArrowDownRight className="h-3 w-3" />
          ) : null}
          <span>
            {positive ? "+" : ""}
            {delta}%{deltaLabel ? ` ${deltaLabel}` : ""}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export default MetricCard;
