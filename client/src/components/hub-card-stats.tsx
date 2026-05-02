import { useLocation } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";

export interface HubCardStat {
  label: string;
  value: string;
  href?: string;
}

interface HubCardStatsProps {
  isLoading: boolean;
  stats: HubCardStat[];
  testIdPrefix?: string;
}

export function HubCardStats({ isLoading, stats, testIdPrefix }: HubCardStatsProps) {
  const [, setLocation] = useLocation();

  if (isLoading) {
    return (
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-24" />
      </div>
    );
  }
  if (stats.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs" data-testid={testIdPrefix ? `${testIdPrefix}-stats` : undefined}>
      {stats.map((s, idx) => {
        const inner = (
          <>
            <span className="font-semibold tabular-nums" style={{ color: "var(--lux-text)" }}>
              {s.value}
            </span>
            <span style={{ color: "var(--lux-text-muted)" }}>{s.label}</span>
          </>
        );
        const testId = testIdPrefix ? `${testIdPrefix}-stat-${idx}` : undefined;
        if (s.href) {
          const href = s.href;
          return (
            <button
              key={idx}
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setLocation(href);
              }}
              className="flex items-baseline gap-1 rounded hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--lux-accent)] cursor-pointer"
              data-testid={testId}
            >
              {inner}
            </button>
          );
        }
        return (
          <div
            key={idx}
            className="flex items-baseline gap-1"
            data-testid={testId}
          >
            {inner}
          </div>
        );
      })}
    </div>
  );
}
