import type { LucideIcon } from "lucide-react";
import { Info } from "lucide-react";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";

interface StatCardProps {
  icon?: LucideIcon;
  label: string;
  value: string;
  subValue?: string;
  trend?: { value: number; label: string };
  color?: string;
  testId?: string;
  onClick?: () => void;
  tooltip?: string;
}

export function StatCard({ icon: Icon, label, value, subValue, trend, color, testId, onClick, tooltip }: StatCardProps) {
  return (
    <div
      className={`rounded-lg border p-4 flex flex-col gap-1 transition-all ${onClick ? "cursor-pointer hover:shadow-md" : ""}`}
      style={{
        background: "var(--lux-surface)",
        borderColor: "var(--lux-border)",
        borderLeft: "var(--lux-stat-accent-border, 1px solid var(--lux-border))",
        boxShadow: "var(--lux-card-shadow)",
      }}
      onClick={onClick}
      data-testid={testId || `stat-card-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className="flex items-center gap-2 mb-1">
        {Icon && (
          <Icon
            size={16}
            style={{ color: color || "var(--lux-text-muted)" }}
          />
        )}
        <span className="text-xs font-medium uppercase tracking-wider lux-stat-label" style={{ color: "var(--lux-text-muted)", letterSpacing: "0.08em" }}>
          {label}
        </span>
        {tooltip && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Info size={12} className="cursor-help" style={{ color: "var(--lux-text-muted)" }} data-testid={`tooltip-trigger-${label.toLowerCase().replace(/\s+/g, "-")}`} />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[250px] text-xs">
              {tooltip}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      <span className="text-2xl font-bold tabular-nums" style={{ color: color || "var(--lux-text)", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </span>
      {subValue && (
        <span className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
          {subValue}
        </span>
      )}
      {trend && (
        <span className={`text-xs font-medium ${trend.value >= 0 ? "text-green-500" : "text-red-500"}`}>
          {trend.value >= 0 ? "+" : ""}{trend.value}% {trend.label}
        </span>
      )}
      {onClick && (
        <span className="text-[10px] mt-1" style={{ color: "var(--lux-text-muted)" }}>
          Click for details →
        </span>
      )}
    </div>
  );
}
