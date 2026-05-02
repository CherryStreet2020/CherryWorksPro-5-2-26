/**
 * PillTab — Sprint 2m premium primitive.
 *
 * Pill-style tabs composing shadcn `Tabs`. Active pill is cherry-red
 * with white text; inactive is transparent with `--lux-text-muted`.
 *
 * Theme behaviour: Active fill uses `--lux-accent` and inactive text
 * uses `--lux-text-muted`, both of which adapt via `.dark`. Focus
 * indicator on each pill uses `box-shadow: 0 0 0 2px
 * rgba(var(--lux-accent-rgb), 0.25)` directly on `:focus-visible`
 * (never `var(--lux-focus-ring)`, which is `none` in dark mode).
 */
import * as React from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export interface PillTabItem {
  value: string;
  label: string;
}

export interface PillTabProps {
  items: PillTabItem[];
  value: string;
  onValueChange: (v: string) => void;
  className?: string;
}

export function PillTab({ items, value, onValueChange, className }: PillTabProps) {
  return (
    <Tabs value={value} onValueChange={onValueChange} className={className}>
      <TabsList
        className="h-auto gap-1 rounded-full p-1"
        style={{
          background: "var(--lux-surface-alt)",
          border: "1px solid var(--lux-border)",
        }}
        data-testid="premium-pill-tab-list"
      >
        {items.map((item) => {
          const active = item.value === value;
          return (
            <TabsTrigger
              key={item.value}
              value={item.value}
              className={cn(
                "rounded-full px-4 py-1.5 text-xs font-semibold transition-all duration-150 ease-out",
                "data-[state=active]:shadow-none",
                "focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_rgba(var(--lux-accent-rgb),0.25)]",
              )}
              style={{
                background: active ? "var(--lux-accent)" : "transparent",
                color: active
                  ? "hsl(var(--primary-foreground))"
                  : "var(--lux-text-muted)",
              }}
              data-testid={`premium-pill-tab-${item.value}`}
            >
              {item.label}
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}

export default PillTab;
