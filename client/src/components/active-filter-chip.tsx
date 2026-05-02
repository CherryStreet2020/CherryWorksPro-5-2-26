import { X } from "lucide-react";

interface ActiveFilterChipProps {
  label: string;
  onClear: () => void;
  testId?: string;
}

export function ActiveFilterChip({ label, onClear, testId }: ActiveFilterChipProps) {
  return (
    <div
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold"
      style={{
        background: "rgba(var(--lux-accent-rgb), 0.10)",
        color: "var(--lux-accent)",
        border: "1px solid rgba(var(--lux-accent-rgb), 0.25)",
      }}
      data-testid={testId || "chip-active-filter"}
    >
      <span>{label}</span>
      <button
        type="button"
        onClick={onClear}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full transition-colors hover:bg-black/10 dark:hover:bg-white/10"
        aria-label={`Clear filter: ${label}`}
        data-testid={testId ? `${testId}-clear` : "chip-active-filter-clear"}
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

export interface FilterChipDescriptor {
  id: string;
  label: string;
  onClear: () => void;
}

interface ActiveFilterBarProps {
  chips: FilterChipDescriptor[];
  className?: string;
  testId?: string;
}

export function ActiveFilterBar({ chips, className, testId }: ActiveFilterBarProps) {
  if (chips.length === 0) return null;
  const handleClearAll = () => {
    for (const c of chips) c.onClear();
  };
  return (
    <div
      className={`flex items-center gap-2 flex-wrap ${className || ""}`}
      data-testid={testId || "active-filter-bar"}
    >
      <span
        className="text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--lux-text-muted)" }}
      >
        Filtered:
      </span>
      {chips.map((c) => (
        <ActiveFilterChip
          key={c.id}
          label={c.label}
          onClear={c.onClear}
          testId={`chip-${c.id}`}
        />
      ))}
      {chips.length >= 2 && (
        <button
          type="button"
          onClick={handleClearAll}
          className="text-xs font-semibold underline-offset-2 hover:underline px-1 py-0.5"
          style={{ color: "var(--lux-text-muted)" }}
          data-testid="button-clear-all-filters"
        >
          Clear all
        </button>
      )}
    </div>
  );
}
