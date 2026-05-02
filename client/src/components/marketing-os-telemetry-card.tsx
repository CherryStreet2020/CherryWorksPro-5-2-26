import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, TrendingUp } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/shared/empty-state";
import type {
  MarketingOsTelemetryDailyBucket,
  MarketingOsTelemetryDailySeries,
  MarketingOsTelemetryLastCleanup,
  MarketingOsTelemetrySummary,
  MarketingOsTelemetrySummaryWindow,
} from "@shared/schema";

function formatRelativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "unknown";
  const diffMs = Date.now() - then;
  const abs = Math.abs(diffMs);
  const minutes = Math.floor(abs / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  let text: string;
  if (minutes < 1) text = "just now";
  else if (minutes < 60) text = `${minutes}m`;
  else if (hours < 24) text = `${hours}h`;
  else text = `${days}d`;
  if (minutes < 1) return text;
  return diffMs >= 0 ? `${text} ago` : `in ${text}`;
}

function formatPct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function FunnelRow({
  window,
}: {
  window: MarketingOsTelemetrySummaryWindow;
}) {
  const max = Math.max(
    window.sectionShown,
    window.modalOpened,
    window.checkoutClicked,
    1,
  );
  const stages: Array<{
    key: string;
    label: string;
    count: number;
    testId: string;
  }> = [
    {
      key: "shown",
      label: "Section shown",
      count: window.sectionShown,
      testId: `text-marketing-os-telemetry-${window.days}d-section-shown`,
    },
    {
      key: "modal",
      label: "Modal opened",
      count: window.modalOpened,
      testId: `text-marketing-os-telemetry-${window.days}d-modal-opened`,
    },
    {
      key: "checkout",
      label: "Checkout clicked",
      count: window.checkoutClicked,
      testId: `text-marketing-os-telemetry-${window.days}d-checkout-clicked`,
    },
  ];

  return (
    <div
      className="space-y-3"
      data-testid={`section-marketing-os-telemetry-${window.days}d`}
    >
      <div className="flex items-baseline justify-between">
        <h4
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color: "var(--lux-text-muted)" }}
        >
          Last {window.days} days
        </h4>
        <span
          className="text-[11px]"
          style={{ color: "var(--lux-text-muted)" }}
          data-testid={`text-marketing-os-telemetry-${window.days}d-conversion`}
        >
          shown → checkout {formatPct(window.shownToCheckoutRate)}
        </span>
      </div>
      <div className="space-y-2">
        {stages.map((stage) => {
          const widthPct = (stage.count / max) * 100;
          return (
            <div key={stage.key} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span style={{ color: "var(--lux-text)" }}>{stage.label}</span>
                <span
                  className="font-semibold tabular-nums"
                  style={{ color: "var(--lux-text)" }}
                  data-testid={stage.testId}
                >
                  {stage.count}
                </span>
              </div>
              <div
                className="h-2 rounded-full overflow-hidden"
                style={{ background: "var(--lux-border)" }}
              >
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${widthPct}%`,
                    background: "var(--lux-accent, #6366f1)",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div
        className="grid grid-cols-2 gap-3 pt-1 text-[11px]"
        style={{ color: "var(--lux-text-muted)" }}
      >
        <div>
          shown → modal:{" "}
          <span
            className="font-semibold"
            style={{ color: "var(--lux-text)" }}
            data-testid={`text-marketing-os-telemetry-${window.days}d-shown-to-modal`}
          >
            {formatPct(window.shownToModalRate)}
          </span>
        </div>
        <div>
          modal → checkout:{" "}
          <span
            className="font-semibold"
            style={{ color: "var(--lux-text)" }}
            data-testid={`text-marketing-os-telemetry-${window.days}d-modal-to-checkout`}
          >
            {formatPct(window.modalToCheckoutRate)}
          </span>
        </div>
      </div>
    </div>
  );
}

function formatShortDate(iso: string): string {
  // iso is YYYY-MM-DD; render as "Apr 9" without TZ surprises.
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

interface CompareOverlay {
  values: number[];
  buckets: MarketingOsTelemetryDailyBucket[];
  testId: string;
}

function StageSparkline({
  label,
  values,
  buckets,
  testId,
  compare,
}: {
  label: string;
  values: number[];
  buckets: MarketingOsTelemetryDailyBucket[];
  testId: string;
  compare?: CompareOverlay;
}) {
  const total = values.reduce((sum, v) => sum + v, 0);
  const compareTotal = compare?.values.reduce((sum, v) => sum + v, 0) ?? 0;
  const slots = Math.max(values.length, compare?.values.length ?? 0, 1);
  const max = Math.max(
    ...values,
    ...(compare?.values ?? []),
    1,
  );
  const width = 220;
  const height = 36;
  const barGap = 1;
  const slotWidth = Math.max(
    (width - barGap * (slots - 1)) / slots,
    1,
  );
  const showCompare = Boolean(compare);
  const barWidth = showCompare ? Math.max(slotWidth / 2 - 0.5, 0.5) : slotWidth;
  const firstDate = buckets[0]?.date;
  const lastDate = buckets[buckets.length - 1]?.date;
  const compareFirst = compare?.buckets[0]?.date;
  const compareLast = compare?.buckets[compare.buckets.length - 1]?.date;
  const delta = total - compareTotal;
  const deltaSign = delta > 0 ? "+" : "";

  return (
    <div className="space-y-1.5" data-testid={testId}>
      <div className="flex items-baseline justify-between text-xs">
        <span style={{ color: "var(--lux-text)" }}>{label}</span>
        <span className="flex items-center gap-2">
          <span
            className="font-semibold tabular-nums"
            style={{ color: "var(--lux-text)" }}
            data-testid={`${testId}-total`}
          >
            {total}
          </span>
          {showCompare && (
            <>
              <span
                className="tabular-nums"
                style={{ color: "var(--lux-text-muted)" }}
                data-testid={`${testId}-compare-total`}
              >
                vs {compareTotal}
              </span>
              <span
                className="tabular-nums text-[10px] px-1.5 py-0.5 rounded"
                style={{
                  color: "var(--lux-text)",
                  background: "var(--lux-border)",
                }}
                data-testid={`${testId}-compare-delta`}
              >
                {deltaSign}
                {delta}
              </span>
            </>
          )}
        </span>
      </div>
      <svg
        role="img"
        aria-label={`${label} per day for the last ${values.length} days${
          showCompare ? ` compared with ${compare!.values.length}-day prior window` : ""
        }`}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
      >
        {showCompare &&
          compare!.values.map((v, i) => {
            const h = (v / max) * height;
            const x = i * (slotWidth + barGap);
            const y = height - h;
            return (
              <rect
                key={`c-${i}`}
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(h, v > 0 ? 1 : 0)}
                rx={1}
                fill="var(--lux-text-muted, #94a3b8)"
                opacity={v === 0 ? 0.18 : 0.55}
                data-testid={`${compare!.testId}-bar-${compare!.buckets[i]?.date ?? i}`}
              >
                <title>{`${compare!.buckets[i]?.date ?? ""}: ${v}`}</title>
              </rect>
            );
          })}
        {values.map((v, i) => {
          const h = (v / max) * height;
          const x = i * (slotWidth + barGap) + (showCompare ? barWidth + 1 : 0);
          const y = height - h;
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={barWidth}
              height={Math.max(h, v > 0 ? 1 : 0)}
              rx={1}
              fill="var(--lux-accent, #6366f1)"
              opacity={v === 0 ? 0.18 : 1}
              data-testid={`${testId}-bar-${buckets[i]?.date ?? i}`}
            >
              <title>{`${buckets[i]?.date ?? ""}: ${v}`}</title>
            </rect>
          );
        })}
      </svg>
      <div
        className="flex justify-between text-[10px]"
        style={{ color: "var(--lux-text-muted)" }}
      >
        <span>{firstDate ? formatShortDate(firstDate) : ""}</span>
        <span>{lastDate ? formatShortDate(lastDate) : ""}</span>
      </div>
      {showCompare && (
        <div
          className="flex justify-between text-[10px]"
          style={{ color: "var(--lux-text-muted)" }}
          data-testid={`${testId}-compare-range`}
        >
          <span>vs {compareFirst ? formatShortDate(compareFirst) : ""}</span>
          <span>{compareLast ? formatShortDate(compareLast) : ""}</span>
        </div>
      )}
    </div>
  );
}

function sumStages(buckets: MarketingOsTelemetryDailyBucket[]): {
  sectionShown: number;
  modalOpened: number;
  checkoutClicked: number;
} {
  let sectionShown = 0;
  let modalOpened = 0;
  let checkoutClicked = 0;
  for (const b of buckets) {
    sectionShown += b.sectionShown;
    modalOpened += b.modalOpened;
    checkoutClicked += b.checkoutClicked;
  }
  return { sectionShown, modalOpened, checkoutClicked };
}

function rateOrZero(num: number, den: number): number {
  return den > 0 ? num / den : 0;
}

function ConversionRateRow({
  label,
  current,
  previous,
  testId,
  hasCompare,
}: {
  label: string;
  current: number;
  previous: number;
  testId: string;
  hasCompare: boolean;
}) {
  const deltaPp = (current - previous) * 100;
  const sign = deltaPp > 0 ? "+" : "";
  return (
    <div
      className="flex items-baseline justify-between text-xs"
      data-testid={testId}
    >
      <span style={{ color: "var(--lux-text)" }}>{label}</span>
      <span className="flex items-center gap-2 tabular-nums">
        <span
          className="font-semibold"
          style={{ color: "var(--lux-text)" }}
          data-testid={`${testId}-current`}
        >
          {formatPct(current)}
        </span>
        {hasCompare && (
          <>
            <span
              style={{ color: "var(--lux-text-muted)" }}
              data-testid={`${testId}-previous`}
            >
              vs {formatPct(previous)}
            </span>
            <span
              className="text-[10px] px-1.5 py-0.5 rounded"
              style={{
                color: "var(--lux-text)",
                background: "var(--lux-border)",
              }}
              data-testid={`${testId}-delta`}
            >
              {sign}
              {deltaPp.toFixed(1)} pp
            </span>
          </>
        )}
      </span>
    </div>
  );
}

function DailyTrend({
  series,
  compare,
}: {
  series: MarketingOsTelemetryDailySeries;
  compare?: MarketingOsTelemetryDailySeries;
}) {
  const buckets = series.buckets;
  const stages = [
    {
      key: "shown",
      label: "Section shown",
      values: buckets.map(b => b.sectionShown),
      compareValues: compare?.buckets.map(b => b.sectionShown),
      testId: "chart-marketing-os-telemetry-daily-section-shown",
      compareTestId: "chart-marketing-os-telemetry-daily-compare-section-shown",
    },
    {
      key: "modal",
      label: "Modal opened",
      values: buckets.map(b => b.modalOpened),
      compareValues: compare?.buckets.map(b => b.modalOpened),
      testId: "chart-marketing-os-telemetry-daily-modal-opened",
      compareTestId: "chart-marketing-os-telemetry-daily-compare-modal-opened",
    },
    {
      key: "checkout",
      label: "Checkout clicked",
      values: buckets.map(b => b.checkoutClicked),
      compareValues: compare?.buckets.map(b => b.checkoutClicked),
      testId: "chart-marketing-os-telemetry-daily-checkout-clicked",
      compareTestId: "chart-marketing-os-telemetry-daily-compare-checkout-clicked",
    },
  ];
  return (
    <div
      className="space-y-3"
      data-testid={`section-marketing-os-telemetry-daily-${series.days}d`}
    >
      <div className="flex items-baseline justify-between">
        <h4
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color: "var(--lux-text-muted)" }}
        >
          Daily trend ({series.days}d)
          {compare && (
            <span
              className="ml-2 normal-case font-normal text-[10px]"
              style={{ color: "var(--lux-text-muted)" }}
              data-testid="text-marketing-os-telemetry-daily-compare-label"
            >
              vs {compare.days}d
            </span>
          )}
        </h4>
        {compare && (
          <div
            className="flex items-center gap-2 text-[10px]"
            style={{ color: "var(--lux-text-muted)" }}
            data-testid="legend-marketing-os-telemetry-daily-compare"
          >
            <span className="flex items-center gap-1">
              <span
                className="inline-block w-2 h-2 rounded-sm"
                style={{ background: "var(--lux-accent, #6366f1)" }}
              />
              Current
            </span>
            <span className="flex items-center gap-1">
              <span
                className="inline-block w-2 h-2 rounded-sm"
                style={{ background: "var(--lux-text-muted, #94a3b8)", opacity: 0.55 }}
              />
              Comparison
            </span>
          </div>
        )}
      </div>
      <div className="space-y-3">
        {stages.map(stage => (
          <StageSparkline
            key={stage.key}
            label={stage.label}
            values={stage.values}
            buckets={buckets}
            testId={stage.testId}
            compare={
              compare && stage.compareValues
                ? {
                    values: stage.compareValues,
                    buckets: compare.buckets,
                    testId: stage.compareTestId,
                  }
                : undefined
            }
          />
        ))}
      </div>
      {(() => {
        // Conversion rates for the user-selected daily window(s). When
        // no comparison is loaded, only the "current" column renders.
        const cur = sumStages(buckets);
        const prev = compare ? sumStages(compare.buckets) : { sectionShown: 0, modalOpened: 0, checkoutClicked: 0 };
        return (
          <div
            className="space-y-1.5 pt-2 border-t"
            style={{ borderColor: "var(--lux-border)" }}
            data-testid="section-marketing-os-telemetry-daily-rates"
          >
            <h5
              className="text-[11px] font-semibold uppercase tracking-wide pb-0.5"
              style={{ color: "var(--lux-text-muted)" }}
            >
              Conversion rates
            </h5>
            <ConversionRateRow
              label="shown → modal"
              current={rateOrZero(cur.modalOpened, cur.sectionShown)}
              previous={rateOrZero(prev.modalOpened, prev.sectionShown)}
              hasCompare={!!compare}
              testId="text-marketing-os-telemetry-daily-rate-shown-to-modal"
            />
            <ConversionRateRow
              label="modal → checkout"
              current={rateOrZero(cur.checkoutClicked, cur.modalOpened)}
              previous={rateOrZero(prev.checkoutClicked, prev.modalOpened)}
              hasCompare={!!compare}
              testId="text-marketing-os-telemetry-daily-rate-modal-to-checkout"
            />
            <ConversionRateRow
              label="shown → checkout"
              current={rateOrZero(cur.checkoutClicked, cur.sectionShown)}
              previous={rateOrZero(prev.checkoutClicked, prev.sectionShown)}
              hasCompare={!!compare}
              testId="text-marketing-os-telemetry-daily-rate-shown-to-checkout"
            />
          </div>
        );
      })()}
    </div>
  );
}

type DailyRangePreset = "7" | "14" | "30" | "60" | "90" | "custom";
type ComparePreset = "previous" | "custom";

const DAILY_PRESETS: Array<{ value: DailyRangePreset; label: string }> = [
  { value: "7", label: "Last 7 days" },
  { value: "14", label: "Last 14 days" },
  { value: "30", label: "Last 30 days" },
  { value: "60", label: "Last 60 days" },
  { value: "90", label: "Last 90 days" },
  { value: "custom", label: "Custom range" },
];

// Single source of truth for the initial primary daily range. The unit
// tests (`marketing-os-telemetry-card-compare.test.tsx`,
// `marketing-os-telemetry-card-custom-range.test.tsx`) import this so a
// future change to the default preset doesn't silently turn those tests
// into no-ops. Must be a non-"custom" preset so it maps to a `?days=N`
// initial request.
export const DEFAULT_DAILY_PRESET: Exclude<DailyRangePreset, "custom"> = "30";

const COMPARE_PRESETS: Array<{ value: ComparePreset; label: string }> = [
  { value: "previous", label: "Previous period" },
  { value: "custom", label: "Custom range" },
];

const MAX_DAILY_RANGE_DAYS = 90;

function todayUtcIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoFromTodayMinus(daysBack: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysBack);
  return d.toISOString().slice(0, 10);
}

function addDaysIso(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

function daysBetweenInclusive(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86_400_000) + 1;
}

export function MarketingOsTelemetryCard() {
  const { data, isLoading, isError } = useQuery<MarketingOsTelemetrySummary>({
    queryKey: ["/api/telemetry/marketing-os/summary"],
  });

  const [preset, setPreset] = useState<DailyRangePreset>(DEFAULT_DAILY_PRESET);
  const today = todayUtcIso();
  const defaultFrom = useMemo(() => isoFromTodayMinus(13), []);
  const [fromDate, setFromDate] = useState<string>(defaultFrom);
  const [toDate, setToDate] = useState<string>(today);

  // Task 238 — comparison range state. We store *only* the user's custom
  // comparison dates here. The "previous period" preset derives its
  // window synchronously from the active primary range below, so toggling
  // compare on never fires a query against stale dates.
  const [compareEnabled, setCompareEnabled] = useState<boolean>(false);
  const [comparePreset, setComparePreset] = useState<ComparePreset>("previous");
  const [compareCustomFrom, setCompareCustomFrom] = useState<string>(
    isoFromTodayMinus(27),
  );
  const [compareCustomTo, setCompareCustomTo] = useState<string>(
    isoFromTodayMinus(14),
  );

  // Resolve the *primary* range as concrete from/to ISO dates so the
  // "previous period" comparison can be derived from it regardless of
  // whether the user picked a preset or a custom window.
  const primaryRange = useMemo<
    | { from: string; to: string; days: number; error: null }
    | { from: null; to: null; days: 0; error: string }
  >(() => {
    if (preset !== "custom") {
      const days = Number(preset);
      return {
        from: isoFromTodayMinus(days - 1),
        to: today,
        days,
        error: null,
      };
    }
    if (!fromDate || !toDate) {
      return { from: null, to: null, days: 0, error: "Pick both a start and end date." };
    }
    if (toDate < fromDate) {
      return { from: null, to: null, days: 0, error: "End date must be on or after the start date." };
    }
    const span = daysBetweenInclusive(fromDate, toDate);
    if (span > MAX_DAILY_RANGE_DAYS) {
      return {
        from: null,
        to: null,
        days: 0,
        error: `Custom range can't exceed ${MAX_DAILY_RANGE_DAYS} days.`,
      };
    }
    return { from: fromDate, to: toDate, days: span, error: null };
  }, [preset, fromDate, toDate, today]);

  // Effective comparison dates. For the "previous period" preset they're
  // derived synchronously from the primary range so the very first
  // request after enabling compare uses the right window — no transient
  // fetch with stale defaults. For "custom" we use the user's own state.
  const { compareFromDate, compareToDate } = useMemo(() => {
    if (comparePreset === "previous") {
      if (primaryRange.error || !primaryRange.from) {
        return { compareFromDate: "", compareToDate: "" };
      }
      const newTo = addDaysIso(primaryRange.from, -1);
      const newFrom = addDaysIso(newTo, -(primaryRange.days - 1));
      return { compareFromDate: newFrom, compareToDate: newTo };
    }
    return { compareFromDate: compareCustomFrom, compareToDate: compareCustomTo };
  }, [
    comparePreset,
    primaryRange.from,
    primaryRange.days,
    primaryRange.error,
    compareCustomFrom,
    compareCustomTo,
  ]);

  const dailyUrl = useMemo(() => {
    if (primaryRange.error) return null;
    if (preset !== "custom") {
      return `/api/telemetry/marketing-os/daily?days=${preset}`;
    }
    return `/api/telemetry/marketing-os/daily?from=${primaryRange.from}&to=${primaryRange.to}`;
  }, [preset, primaryRange.error, primaryRange.from, primaryRange.to]);

  const customError = primaryRange.error;

  // Resolve comparison URL + its own validation error.
  const { compareUrl, compareError } = useMemo(() => {
    if (!compareEnabled) return { compareUrl: null, compareError: null as string | null };
    if (!compareFromDate || !compareToDate) {
      return { compareUrl: null, compareError: "Pick both comparison dates." };
    }
    if (compareToDate < compareFromDate) {
      return {
        compareUrl: null,
        compareError: "Comparison end date must be on or after the start date.",
      };
    }
    const span = daysBetweenInclusive(compareFromDate, compareToDate);
    if (span > MAX_DAILY_RANGE_DAYS) {
      return {
        compareUrl: null,
        compareError: `Comparison range can't exceed ${MAX_DAILY_RANGE_DAYS} days.`,
      };
    }
    return {
      compareUrl: `/api/telemetry/marketing-os/daily?from=${compareFromDate}&to=${compareToDate}`,
      compareError: null,
    };
  }, [compareEnabled, compareFromDate, compareToDate]);

  const {
    data: dailyData,
    isLoading: isDailyLoading,
    isError: isDailyError,
  } = useQuery<MarketingOsTelemetryDailySeries>({
    queryKey: [dailyUrl ?? "/api/telemetry/marketing-os/daily"],
    enabled: dailyUrl !== null,
  });

  const { data: lastCleanupData } = useQuery<{
    lastRun: MarketingOsTelemetryLastCleanup | null;
    // Task #290 — Server now also returns a derived health summary so
    // the card can flip into a warning state when the sweep has gone
    // silent. Optional in the type so older cached payloads still
    // render without a warning instead of crashing.
    health?: {
      status: "ok" | "overdue" | "missing";
      intervalMs: number;
      thresholdMs: number;
      ageMs: number | null;
      hasEventsOlderThanRetention: boolean;
    };
  }>({
    queryKey: ["/api/telemetry/marketing-os/cleanup/last"],
  });

  const cleanupHealth = lastCleanupData?.health;
  const cleanupWarning = useMemo<
    { tone: "warning"; testIdSuffix: string; title: string; body: string } | null
  >(() => {
    if (!cleanupHealth || cleanupHealth.status === "ok") return null;
    const hours = Math.round(cleanupHealth.thresholdMs / 3_600_000);
    if (cleanupHealth.status === "missing") {
      return {
        tone: "warning",
        testIdSuffix: "missing",
        title: "Cleanup hasn't run yet",
        body: `There are telemetry rows older than retention but no cleanup on record. The scheduler may be stuck — check the server logs.`,
      };
    }
    // status === "overdue"
    return {
      tone: "warning",
      testIdSuffix: "overdue",
      title: "Cleanup is overdue",
      body: `The last successful sweep was more than ${hours}h ago. The scheduler may be stuck — check the server logs.`,
    };
  }, [cleanupHealth]);

  // Task #267 — Lazy-load the full cleanup history only after the admin
  // expands the panel so we don't refetch up to 50 rows on every render.
  const [showCleanupHistory, setShowCleanupHistory] = useState(false);
  const {
    data: cleanupHistoryData,
    isLoading: isCleanupHistoryLoading,
    isError: isCleanupHistoryError,
  } = useQuery<{ runs: MarketingOsTelemetryLastCleanup[] }>({
    queryKey: ["/api/telemetry/marketing-os/cleanup/history"],
    enabled: showCleanupHistory,
  });

  // Task #266 — Trigger an on-demand cleanup sweep. The mutation refreshes
  // the "Last cleanup" line on success and surfaces a friendly message when
  // another replica already holds the advisory lock.
  const queryClient = useQueryClient();
  const [cleanupMessage, setCleanupMessage] = useState<{
    kind: "success" | "skipped" | "error";
    text: string;
  } | null>(null);
  const cleanupMutation = useMutation<
    { ran: boolean; skipped?: boolean; reason?: string; lastRun?: MarketingOsTelemetryLastCleanup | null }
  >({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        "/api/telemetry/marketing-os/cleanup/run",
      );
      return res.json();
    },
    onSuccess: (result) => {
      if (result.ran) {
        // Seed the cache with the freshly returned run so the UI updates
        // immediately, and also invalidate so any other consumers refetch.
        // Task #267 — also invalidate the history query so the newly
        // recorded run appears in the expanded history panel.
        if (result.lastRun !== undefined) {
          queryClient.setQueryData(
            ["/api/telemetry/marketing-os/cleanup/last"],
            { lastRun: result.lastRun },
          );
        }
        queryClient.invalidateQueries({
          queryKey: ["/api/telemetry/marketing-os/cleanup/last"],
        });
        queryClient.invalidateQueries({
          queryKey: ["/api/telemetry/marketing-os/cleanup/history"],
        });
        setCleanupMessage({
          kind: "success",
          text: `Cleanup ran — ${result.lastRun?.deletedCount ?? 0} rows removed.`,
        });
      } else if (result.skipped || result.reason === "lock-held") {
        setCleanupMessage({
          kind: "skipped",
          text: "Another run in progress — try again in a moment.",
        });
      } else {
        setCleanupMessage({
          kind: "error",
          text: "Cleanup didn't run. Try again in a moment.",
        });
      }
    },
    onError: () => {
      setCleanupMessage({
        kind: "error",
        text: "Cleanup failed. Try again in a moment.",
      });
    },
  });

  const {
    data: compareData,
    isLoading: isCompareLoading,
    isError: isCompareError,
  } = useQuery<MarketingOsTelemetryDailySeries>({
    queryKey: [compareUrl ?? "/api/telemetry/marketing-os/daily"],
    enabled: compareEnabled && compareUrl !== null,
  });

  const compareReady =
    compareEnabled && !compareError && !isCompareError && compareData;


  return (
    <Card
      className="border-0"
      style={{
        background: "var(--lux-surface)",
        boxShadow: "var(--lux-card-shadow)",
      }}
      data-testid="card-marketing-os-telemetry"
    >
      <CardContent className="p-5 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3
              className="text-sm font-semibold"
              style={{ color: "var(--lux-text)" }}
            >
              Marketing OS upgrade interest
            </h3>
            <p
              className="text-[11px] mt-0.5"
              style={{ color: "var(--lux-text-muted)" }}
            >
              Discovery funnel for the upgrade prompt
            </p>
          </div>
          <TrendingUp
            className="w-4 h-4"
            style={{ color: "var(--lux-text-muted)" }}
          />
        </div>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-32 rounded-lg" />
            <Skeleton className="h-32 rounded-lg" />
          </div>
        ) : isError ? (
          <EmptyState
            icon={TrendingUp}
            title="Couldn't load telemetry"
            description="Try refreshing the page."
          />
        ) : !data ||
          (data.last30Days.sectionShown === 0 &&
            data.last30Days.modalOpened === 0 &&
            data.last30Days.checkoutClicked === 0) ? (
          <EmptyState
            icon={TrendingUp}
            title="No upgrade activity yet"
            description="Counts will appear here once admins see the Marketing OS prompt."
          />
        ) : (
          <div className="space-y-6">
            <FunnelRow window={data.last7Days} />
            <div
              className="border-t pt-5"
              style={{ borderColor: "var(--lux-border)" }}
            >
              <FunnelRow window={data.last30Days} />
            </div>
            <div
              className="border-t pt-5 space-y-4"
              style={{ borderColor: "var(--lux-border)" }}
            >
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label
                    htmlFor="select-marketing-os-telemetry-daily-range"
                    className="text-[11px] font-semibold uppercase tracking-wide"
                    style={{ color: "var(--lux-text-muted)" }}
                  >
                    Range
                  </Label>
                  <Select
                    value={preset}
                    onValueChange={(v) => setPreset(v as DailyRangePreset)}
                  >
                    <SelectTrigger
                      id="select-marketing-os-telemetry-daily-range"
                      className="h-8 w-[160px] text-xs"
                      data-testid="select-marketing-os-telemetry-daily-range"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DAILY_PRESETS.map((p) => (
                        <SelectItem
                          key={p.value}
                          value={p.value}
                          data-testid={`option-marketing-os-telemetry-daily-range-${p.value}`}
                        >
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {preset === "custom" && (
                  <>
                    <div className="space-y-1">
                      <Label
                        htmlFor="input-marketing-os-telemetry-daily-from"
                        className="text-[11px] font-semibold uppercase tracking-wide"
                        style={{ color: "var(--lux-text-muted)" }}
                      >
                        From
                      </Label>
                      <Input
                        id="input-marketing-os-telemetry-daily-from"
                        type="date"
                        value={fromDate}
                        max={toDate || today}
                        onChange={(e) => setFromDate(e.target.value)}
                        className="h-8 w-[150px] text-xs"
                        data-testid="input-marketing-os-telemetry-daily-from"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label
                        htmlFor="input-marketing-os-telemetry-daily-to"
                        className="text-[11px] font-semibold uppercase tracking-wide"
                        style={{ color: "var(--lux-text-muted)" }}
                      >
                        To
                      </Label>
                      <Input
                        id="input-marketing-os-telemetry-daily-to"
                        type="date"
                        value={toDate}
                        min={fromDate}
                        max={today}
                        onChange={(e) => setToDate(e.target.value)}
                        className="h-8 w-[150px] text-xs"
                        data-testid="input-marketing-os-telemetry-daily-to"
                      />
                    </div>
                  </>
                )}
              </div>

              {/* Task 238 — Comparison controls */}
              <div
                className="flex flex-wrap items-end gap-3 pt-1"
                data-testid="section-marketing-os-telemetry-daily-compare-controls"
              >
                <label className="flex items-center gap-2 text-xs">
                  <Checkbox
                    checked={compareEnabled}
                    onCheckedChange={(v) => setCompareEnabled(Boolean(v))}
                    data-testid="checkbox-marketing-os-telemetry-daily-compare"
                  />
                  <span style={{ color: "var(--lux-text)" }}>
                    Compare to another range
                  </span>
                </label>
                {compareEnabled && (
                  <div className="space-y-1">
                    <Label
                      htmlFor="select-marketing-os-telemetry-daily-compare-preset"
                      className="text-[11px] font-semibold uppercase tracking-wide"
                      style={{ color: "var(--lux-text-muted)" }}
                    >
                      Comparison
                    </Label>
                    <Select
                      value={comparePreset}
                      onValueChange={(v) => setComparePreset(v as ComparePreset)}
                    >
                      <SelectTrigger
                        id="select-marketing-os-telemetry-daily-compare-preset"
                        className="h-8 w-[160px] text-xs"
                        data-testid="select-marketing-os-telemetry-daily-compare-preset"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {COMPARE_PRESETS.map((p) => (
                          <SelectItem
                            key={p.value}
                            value={p.value}
                            data-testid={`option-marketing-os-telemetry-daily-compare-preset-${p.value}`}
                          >
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {compareEnabled && comparePreset === "custom" && (
                  <>
                    <div className="space-y-1">
                      <Label
                        htmlFor="input-marketing-os-telemetry-daily-compare-from"
                        className="text-[11px] font-semibold uppercase tracking-wide"
                        style={{ color: "var(--lux-text-muted)" }}
                      >
                        Compare from
                      </Label>
                      <Input
                        id="input-marketing-os-telemetry-daily-compare-from"
                        type="date"
                        value={compareCustomFrom}
                        max={compareCustomTo || today}
                        onChange={(e) => setCompareCustomFrom(e.target.value)}
                        className="h-8 w-[150px] text-xs"
                        data-testid="input-marketing-os-telemetry-daily-compare-from"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label
                        htmlFor="input-marketing-os-telemetry-daily-compare-to"
                        className="text-[11px] font-semibold uppercase tracking-wide"
                        style={{ color: "var(--lux-text-muted)" }}
                      >
                        Compare to
                      </Label>
                      <Input
                        id="input-marketing-os-telemetry-daily-compare-to"
                        type="date"
                        value={compareCustomTo}
                        min={compareCustomFrom}
                        max={today}
                        onChange={(e) => setCompareCustomTo(e.target.value)}
                        className="h-8 w-[150px] text-xs"
                        data-testid="input-marketing-os-telemetry-daily-compare-to"
                      />
                    </div>
                  </>
                )}
                {compareEnabled && comparePreset === "previous" && primaryRange.from && (
                  <span
                    className="text-[11px] pb-1"
                    style={{ color: "var(--lux-text-muted)" }}
                    data-testid="text-marketing-os-telemetry-daily-compare-window"
                  >
                    {formatShortDate(compareFromDate)} – {formatShortDate(compareToDate)}
                  </span>
                )}
              </div>

              {customError ? (
                <p
                  className="text-xs"
                  style={{ color: "var(--lux-text-muted)" }}
                  data-testid="text-marketing-os-telemetry-daily-custom-error"
                >
                  {customError}
                </p>
              ) : isDailyError ? (
                <p
                  className="text-xs"
                  style={{ color: "var(--lux-text-muted)" }}
                  data-testid="text-marketing-os-telemetry-daily-error"
                >
                  Couldn't load the daily trend. Try refreshing the page.
                </p>
              ) : isDailyLoading ||
                !dailyData ||
                (compareEnabled &&
                  !compareError &&
                  !isCompareError &&
                  (isCompareLoading || !compareData)) ? (
                <Skeleton
                  className="h-40 rounded-lg"
                  data-testid="skeleton-marketing-os-telemetry-daily"
                />
              ) : (
                <>
                  <DailyTrend
                    series={dailyData}
                    compare={compareReady ? compareData : undefined}
                  />
                  {compareEnabled && compareError && (
                    <p
                      className="text-xs"
                      style={{ color: "var(--lux-text-muted)" }}
                      data-testid="text-marketing-os-telemetry-daily-compare-error"
                    >
                      {compareError}
                    </p>
                  )}
                  {compareEnabled && !compareError && isCompareError && (
                    <p
                      className="text-xs"
                      style={{ color: "var(--lux-text-muted)" }}
                      data-testid="text-marketing-os-telemetry-daily-compare-fetch-error"
                    >
                      Couldn't load the comparison range. Try refreshing the page.
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        <div
          className="border-t pt-3 text-[11px] space-y-2"
          style={{
            borderColor: "var(--lux-border)",
            color: "var(--lux-text-muted)",
          }}
          data-testid="section-marketing-os-telemetry-last-cleanup"
        >
          {cleanupWarning && (
            <div
              className="flex items-start gap-2 rounded-md border px-2 py-1.5"
              style={{
                borderColor: "var(--lux-border)",
                background: "var(--lux-border)",
                color: "var(--lux-text)",
              }}
              role="status"
              data-testid={`alert-marketing-os-telemetry-cleanup-${cleanupWarning.testIdSuffix}`}
            >
              <AlertTriangle
                className="w-3.5 h-3.5 mt-0.5 shrink-0"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <div
                  className="text-[11px] font-semibold"
                  data-testid="text-marketing-os-telemetry-cleanup-warning-title"
                >
                  {cleanupWarning.title}
                </div>
                <div
                  className="text-[11px]"
                  style={{ color: "var(--lux-text-muted)" }}
                  data-testid="text-marketing-os-telemetry-cleanup-warning-body"
                >
                  {cleanupWarning.body}
                </div>
              </div>
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              {lastCleanupData?.lastRun ? (
                <span data-testid="text-marketing-os-telemetry-last-cleanup">
                  Last cleanup:{" "}
                  <span
                    title={lastCleanupData.lastRun.ranAt}
                    style={{ color: "var(--lux-text)" }}
                    data-testid="text-marketing-os-telemetry-last-cleanup-relative"
                  >
                    {formatRelativeTime(lastCleanupData.lastRun.ranAt)}
                  </span>{" "}
                  —{" "}
                  <span
                    style={{ color: "var(--lux-text)" }}
                    data-testid="text-marketing-os-telemetry-last-cleanup-deleted"
                  >
                    {lastCleanupData.lastRun.deletedCount} rows removed
                  </span>{" "}
                  <span data-testid="text-marketing-os-telemetry-last-cleanup-retention">
                    (retention {lastCleanupData.lastRun.retentionDays} days)
                  </span>
                </span>
              ) : (
                <span data-testid="text-marketing-os-telemetry-last-cleanup-empty">
                  Last cleanup: never
                </span>
              )}
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-[11px] shrink-0"
              disabled={cleanupMutation.isPending}
              onClick={() => {
                setCleanupMessage(null);
                cleanupMutation.mutate();
              }}
              data-testid="button-marketing-os-telemetry-run-cleanup"
            >
              {cleanupMutation.isPending ? (
                <>
                  <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                  Running…
                </>
              ) : (
                "Run cleanup now"
              )}
            </Button>
          </div>
          {cleanupMessage && (
            <p
              className="text-[11px]"
              style={{
                color:
                  cleanupMessage.kind === "success"
                    ? "var(--lux-text)"
                    : "var(--lux-text-muted)",
              }}
              data-testid={`text-marketing-os-telemetry-run-cleanup-${cleanupMessage.kind}`}
            >
              {cleanupMessage.text}
            </p>
          )}
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowCleanupHistory((v) => !v)}
              className="text-[11px] underline-offset-2 hover:underline"
              style={{ color: "var(--lux-text)" }}
              data-testid="button-marketing-os-telemetry-cleanup-history-toggle"
              aria-expanded={showCleanupHistory}
            >
              {showCleanupHistory ? "Hide history" : "View history"}
            </button>
          </div>
          {showCleanupHistory && (
            <div
              className="mt-2"
              data-testid="section-marketing-os-telemetry-cleanup-history"
            >
              {isCleanupHistoryLoading ? (
                <Skeleton
                  className="h-20 rounded-md"
                  data-testid="skeleton-marketing-os-telemetry-cleanup-history"
                />
              ) : isCleanupHistoryError ? (
                <p
                  className="text-[11px]"
                  style={{ color: "var(--lux-text-muted)" }}
                  data-testid="text-marketing-os-telemetry-cleanup-history-error"
                >
                  Couldn't load cleanup history. Try refreshing the page.
                </p>
              ) : !cleanupHistoryData ||
                cleanupHistoryData.runs.length === 0 ? (
                <p
                  className="text-[11px]"
                  style={{ color: "var(--lux-text-muted)" }}
                  data-testid="text-marketing-os-telemetry-cleanup-history-empty"
                >
                  No cleanup runs recorded yet.
                </p>
              ) : (
                <div
                  className="rounded-md border overflow-hidden"
                  style={{ borderColor: "var(--lux-border)" }}
                >
                  <table className="w-full text-[11px] tabular-nums">
                    <thead>
                      <tr
                        className="text-left"
                        style={{ color: "var(--lux-text-muted)" }}
                      >
                        <th className="px-2 py-1 font-semibold">Ran at</th>
                        <th className="px-2 py-1 font-semibold text-right">
                          Deleted
                        </th>
                        <th className="px-2 py-1 font-semibold text-right">
                          Retention (days)
                        </th>
                        <th className="px-2 py-1 font-semibold">Cutoff</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cleanupHistoryData.runs.map((run, idx) => (
                        <tr
                          key={`${run.ranAt}-${idx}`}
                          className="border-t"
                          style={{
                            borderColor: "var(--lux-border)",
                            color: "var(--lux-text)",
                          }}
                          data-testid={`row-marketing-os-telemetry-cleanup-history-${idx}`}
                        >
                          <td
                            className="px-2 py-1"
                            title={run.ranAt}
                            data-testid={`text-marketing-os-telemetry-cleanup-history-ran-at-${idx}`}
                          >
                            {formatRelativeTime(run.ranAt)}
                          </td>
                          <td
                            className="px-2 py-1 text-right"
                            data-testid={`text-marketing-os-telemetry-cleanup-history-deleted-${idx}`}
                          >
                            {run.deletedCount}
                          </td>
                          <td
                            className="px-2 py-1 text-right"
                            data-testid={`text-marketing-os-telemetry-cleanup-history-retention-${idx}`}
                          >
                            {run.retentionDays}
                          </td>
                          <td
                            className="px-2 py-1"
                            title={run.cutoff}
                            data-testid={`text-marketing-os-telemetry-cleanup-history-cutoff-${idx}`}
                          >
                            {run.cutoff.slice(0, 10)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
