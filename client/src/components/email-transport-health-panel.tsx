import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  Mail,
  Activity,
  ExternalLink,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Ban,
  Undo2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

type LastError = { ts: number; orgId: string; errorCode: string } | null;

type TransportRow = {
  transport: string;
  totalSinceBoot: number;
  windowCount: number;
  lastError: LastError;
};

type RecentSample = {
  ts: number;
  orgId: string;
  transport: string;
  errorCode: string;
  recipient: string | null;
};

type TransportErrorsResponse = {
  totalSinceBoot: number;
  windowMs: number;
  windowCount: number;
  byTransport: TransportRow[];
  recent: RecentSample[];
  threshold: { perHour: number; breached: boolean };
  alertActionUrl: string;
  alertThresholdPerHour: number;
};

const TRANSPORT_LABELS: Record<string, string> = {
  smtp: "SMTP",
  graph: "Microsoft 365 (Graph)",
  gmail: "Gmail",
};

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.max(1, Math.floor(diff / 1000))}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function EmailTransportHealthPanel() {
  const { data, isLoading, error, refetch, isFetching } = useQuery<TransportErrorsResponse>({
    queryKey: ["/api/admin/email/transport-errors"],
    refetchInterval: (query) => (query.state.data?.threshold.breached ? 5_000 : 15_000),
    refetchIntervalInBackground: false,
  });

  const suppressionsSummaryQuery = useQuery<MaskedSuppressionsResponse>({
    queryKey: ["/api/admin/email/masked-suppressions"],
  });

  const [drillOpen, setDrillOpen] = useState(false);
  const [transportFilter, setTransportFilter] = useState<string | null>(null);
  const [drillTab, setDrillTab] = useState<"recent" | "top" | "suppressed">("recent");

  if (isLoading) {
    return (
      <div className="rounded-lg p-4 mb-5" style={{ border: "1px solid var(--lux-border)" }} data-testid="panel-email-transport-health-loading">
        <Skeleton className="h-4 w-40 mb-3" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div
        className="rounded-lg p-4 mb-5 flex items-start gap-3"
        style={{ background: "rgba(234,179,8,0.06)", border: "1px solid rgba(234,179,8,0.2)" }}
        data-testid="panel-email-transport-health-error"
      >
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "rgb(202,138,4)" }} />
        <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
          Could not load outgoing email health right now.
        </p>
      </div>
    );
  }

  const breached = data.threshold.breached;
  const knownTransports = ["smtp", "graph", "gmail"];
  const rowMap = new Map(data.byTransport.map((r) => [r.transport, r]));
  const rows: TransportRow[] = knownTransports.map(
    (t) =>
      rowMap.get(t) ?? {
        transport: t,
        totalSinceBoot: 0,
        windowCount: 0,
        lastError: null,
      },
  );
  for (const r of data.byTransport) {
    if (!knownTransports.includes(r.transport)) rows.push(r);
  }

  return (
    <div
      className="rounded-lg p-4 mb-5"
      style={{
        border: breached ? "1px solid rgba(220,38,38,0.4)" : "1px solid var(--lux-border)",
        background: breached ? "rgba(220,38,38,0.04)" : "transparent",
      }}
      data-testid="panel-email-transport-health"
    >
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Activity className="w-4 h-4 shrink-0" style={{ color: "var(--lux-text-muted)" }} />
          <h4 className="text-sm font-semibold" style={{ color: "var(--lux-text)" }}>
            Outgoing email health
          </h4>
          <span className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
            (last hour)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setTransportFilter(null);
              setDrillTab("recent");
              setDrillOpen((v) => !v);
            }}
            className="text-xs px-2 py-0.5 rounded-full font-medium inline-flex items-center gap-1 cursor-pointer hover-elevate"
            style={
              breached
                ? { background: "rgba(220,38,38,0.12)", color: "rgb(185,28,28)" }
                : { background: "rgba(34,197,94,0.12)", color: "rgb(21,128,61)" }
            }
            aria-expanded={drillOpen}
            aria-controls="email-failure-drilldown"
            title="Show recent failure samples"
            data-testid="badge-email-health-status"
          >
            <span>{breached ? "Threshold breached" : "Healthy"}</span>
            {drillOpen && !transportFilter ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </button>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="text-xs inline-flex items-center gap-1 px-2 py-0.5 rounded-md disabled:opacity-50"
            style={{ border: "1px solid var(--lux-border)", color: "var(--lux-text-muted)" }}
            data-testid="button-email-health-refresh"
            aria-label="Refresh email health"
          >
            <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
          {breached && (
            <a
              href={
                /^https?:\/\//i.test(data.alertActionUrl) || data.alertActionUrl.startsWith("/")
                  ? data.alertActionUrl
                  : `/${data.alertActionUrl}`
              }
              target="_blank"
              rel="noreferrer"
              className="text-xs underline inline-flex items-center gap-1"
              style={{ color: "rgb(185,28,28)" }}
              data-testid="link-email-health-runbook"
            >
              Rollback runbook
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Mail className="w-3.5 h-3.5" style={{ color: "var(--lux-text-muted)" }} />
          <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
            <span className="font-semibold" style={{ color: "var(--lux-text)" }} data-testid="text-email-health-window-count">
              {data.windowCount}
            </span>{" "}
            failure{data.windowCount === 1 ? "" : "s"} in the last hour (alert at {data.alertThresholdPerHour}/hr)
          </p>
        </div>
        {suppressionsSummaryQuery.data && (() => {
          const sd = suppressionsSummaryQuery.data;
          const silencedBreached = sd.suppressedSendsThreshold?.breached === true;
          const windowCount = sd.suppressedSendsWindowCount ?? 0;
          const perHour = sd.suppressedSendsThreshold?.perHour;
          const openSuppressedTab = () => {
            setTransportFilter(null);
            setDrillTab("suppressed");
            setDrillOpen(true);
          };
          return (
            <button
              type="button"
              onClick={openSuppressedTab}
              className="text-xs inline-flex items-center gap-1 cursor-pointer hover-elevate rounded-md px-2 py-0.5"
              style={
                silencedBreached
                  ? {
                      background: "rgba(220,38,38,0.08)",
                      color: "rgb(185,28,28)",
                      border: "1px solid rgba(220,38,38,0.3)",
                    }
                  : {
                      color: "var(--lux-text-muted)",
                      border: "1px solid transparent",
                    }
              }
              title={
                silencedBreached
                  ? `Silenced-send spike: ${windowCount} in the last hour (warns at ${perHour}/hr). Open the Suppressed tab to review.`
                  : perHour != null
                    ? `Silenced sends were short-circuited by the suppression list and are not counted as transport errors. Warns at ${perHour}/hr (last hour: ${windowCount}). Click to review.`
                    : "Silenced sends were short-circuited by the suppression list and are not counted as transport errors. Click to review."
              }
              aria-label={
                silencedBreached
                  ? `Silenced send spike — ${windowCount} in the last hour (threshold ${perHour}). Open Suppressed tab.`
                  : "Open Suppressed tab"
              }
              data-testid="text-email-health-suppressed-summary"
            >
              {silencedBreached ? (
                <AlertTriangle className="w-3.5 h-3.5" />
              ) : (
                <Ban className="w-3.5 h-3.5" />
              )}
              <span>
                <span
                  className="font-semibold"
                  style={{
                    color: silencedBreached ? "rgb(185,28,28)" : "var(--lux-text)",
                  }}
                  data-testid="text-email-health-suppressed-sends"
                >
                  {sd.suppressedSendsSinceBoot}
                </span>{" "}
                send{sd.suppressedSendsSinceBoot === 1 ? "" : "s"} silenced (
                <span data-testid="text-email-health-suppressed-active">
                  {sd.count}
                </span>{" "}
                active)
              </span>
              {silencedBreached && (
                <span
                  className="font-semibold"
                  data-testid="badge-email-health-silenced-spike"
                >
                  · Spike: {windowCount}/hr ≥ {perHour}
                </span>
              )}
            </button>
          );
        })()}
      </div>

      <SilencedSendThresholdEditor />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {rows.map((r) => {
          const label = TRANSPORT_LABELS[r.transport] ?? r.transport;
          const hasFailures = r.windowCount > 0;
          const isActive = drillOpen && transportFilter === r.transport;
          const suppressedForTransport =
            suppressionsSummaryQuery.data?.suppressedSendsByTransport?.[r.transport] ?? 0;
          return (
            <button
              key={r.transport}
              type="button"
              onClick={() => {
                if (isActive) {
                  setDrillOpen(false);
                  setTransportFilter(null);
                } else {
                  setTransportFilter(r.transport);
                  setDrillTab("recent");
                  setDrillOpen(true);
                }
              }}
              className="rounded-md p-3 text-left hover-elevate cursor-pointer"
              style={{
                border: isActive
                  ? "1px solid rgba(220,38,38,0.4)"
                  : "1px solid var(--lux-border)",
                background: "var(--lux-surface)",
              }}
              aria-pressed={isActive}
              aria-controls="email-failure-drilldown"
              title={
                hasFailures
                  ? `Show recent ${label} failures`
                  : `No recent ${label} failures`
              }
              data-testid={`row-transport-${r.transport}`}
            >
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-medium" style={{ color: "var(--lux-text)" }}>
                  {label}
                </p>
                <span
                  className="text-xs font-semibold"
                  style={{ color: hasFailures ? "rgb(185,28,28)" : "var(--lux-text-muted)" }}
                  data-testid={`text-transport-${r.transport}-count`}
                >
                  {r.windowCount}
                </span>
              </div>
              {r.lastError ? (
                <p
                  className="text-[11px] truncate"
                  style={{ color: "var(--lux-text-muted)" }}
                  title={r.lastError.errorCode}
                  data-testid={`text-transport-${r.transport}-last-error`}
                >
                  {r.lastError.errorCode} · {formatRelative(r.lastError.ts)}
                </p>
              ) : (
                <p
                  className="text-[11px]"
                  style={{ color: "var(--lux-text-muted)" }}
                  data-testid={`text-transport-${r.transport}-last-error`}
                >
                  No recent errors
                </p>
              )}
              {suppressionsSummaryQuery.data && (
                <p
                  className="text-[11px] inline-flex items-center gap-1 mt-1 cursor-help"
                  style={{ color: "var(--lux-text-muted)" }}
                  title="Silenced sends were short-circuited by the suppression list and are not counted as transport errors."
                  data-testid={`text-transport-${r.transport}-suppressed`}
                >
                  <Ban className="w-3 h-3" />
                  <span>{suppressedForTransport} silenced</span>
                </p>
              )}
            </button>
          );
        })}
      </div>

      {drillOpen && (
        <FailureDrilldown
          recent={data.recent ?? []}
          transportFilter={transportFilter}
          tab={drillTab}
          onTabChange={setDrillTab}
          onClear={() => {
            setDrillOpen(false);
            setTransportFilter(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Task #314 — Inline admin editor for the per-org silenced-send
 * warning threshold (per hour). Sits inside the existing email-health
 * panel (which is already admin-gated via the `/api/admin/...`
 * endpoints) so admins can tune the warning to their org's send
 * volume without leaving the page. An empty value clears the override
 * and reverts the org to the platform default.
 */
function SilencedSendThresholdEditor() {
  const { toast } = useToast();
  const { data, isLoading, error } = useQuery<SilencedSendThresholdResponse>({
    queryKey: ["/api/admin/email/silenced-send-threshold"],
  });
  const [draft, setDraft] = useState<string>("");
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (data && !initialized) {
      setDraft(data.override == null ? "" : String(data.override));
      setInitialized(true);
    }
  }, [data, initialized]);

  const mutation = useMutation({
    mutationFn: async (perHour: number | null) => {
      const res = await apiRequest(
        "PUT",
        "/api/admin/email/silenced-send-threshold",
        { perHour },
      );
      return res.json() as Promise<SilencedSendThresholdResponse>;
    },
    onSuccess: (next) => {
      queryClient.setQueryData(
        ["/api/admin/email/silenced-send-threshold"],
        next,
      );
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/email/masked-suppressions"],
      });
      setDraft(next.override == null ? "" : String(next.override));
      toast({
        title:
          next.override == null
            ? "Reverted to platform default"
            : `Silenced-send warning set to ${next.override}/hr`,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Could not update silenced-send threshold",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="mb-3" data-testid="silenced-threshold-editor-loading">
        <Skeleton className="h-7 w-72" />
      </div>
    );
  }
  if (error || !data) return null;

  const trimmed = draft.trim();
  let parsed: number | null = null;
  let invalid = false;
  if (trimmed !== "") {
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n <= 0 || Math.floor(n) !== n || n > data.max) {
      invalid = true;
    } else {
      parsed = n;
    }
  }
  const currentOverride = data.override;
  const dirty = parsed !== currentOverride;
  const submit = () => {
    if (invalid || mutation.isPending) return;
    mutation.mutate(parsed);
  };

  return (
    <div
      className="mb-3 rounded-md p-2 flex flex-wrap items-center gap-2 text-xs"
      style={{
        border: "1px solid var(--lux-border)",
        background: "var(--lux-surface)",
      }}
      data-testid="silenced-threshold-editor"
    >
      <label
        htmlFor="silenced-threshold-input"
        className="font-medium"
        style={{ color: "var(--lux-text)" }}
      >
        Silenced-send warning at
      </label>
      <input
        id="silenced-threshold-input"
        type="number"
        inputMode="numeric"
        min={1}
        max={data.max}
        step={1}
        value={draft}
        placeholder={String(data.defaultPerHour)}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        disabled={mutation.isPending}
        className="w-20 px-2 py-1 rounded-md text-xs"
        style={{
          border: invalid
            ? "1px solid rgba(220,38,38,0.5)"
            : "1px solid var(--lux-border)",
          background: "var(--lux-bg)",
          color: "var(--lux-text)",
        }}
        aria-invalid={invalid || undefined}
        aria-describedby="silenced-threshold-help"
        data-testid="input-silenced-threshold"
      />
      <span style={{ color: "var(--lux-text-muted)" }}>/hr</span>
      <button
        type="button"
        onClick={submit}
        disabled={!dirty || invalid || mutation.isPending}
        className="px-2 py-1 rounded-md font-medium disabled:opacity-50"
        style={{
          border: "1px solid var(--lux-border)",
          color: "var(--lux-text)",
          background: "var(--lux-bg)",
        }}
        data-testid="button-silenced-threshold-save"
      >
        {mutation.isPending ? "Saving…" : "Save"}
      </button>
      {currentOverride != null && (
        <button
          type="button"
          onClick={() => {
            if (mutation.isPending) return;
            mutation.mutate(null);
          }}
          disabled={mutation.isPending}
          className="px-2 py-1 rounded-md disabled:opacity-50"
          style={{
            border: "1px solid var(--lux-border)",
            color: "var(--lux-text-muted)",
            background: "transparent",
          }}
          title="Clear the per-org override and revert to the platform default"
          data-testid="button-silenced-threshold-reset"
        >
          Reset to default
        </button>
      )}
      <span
        id="silenced-threshold-help"
        style={{ color: "var(--lux-text-muted)" }}
        data-testid="text-silenced-threshold-help"
      >
        {invalid
          ? `Enter a whole number between 1 and ${data.max}, or leave blank to use the platform default (${data.defaultPerHour}/hr).`
          : currentOverride == null
            ? `Using platform default (${data.defaultPerHour}/hr). Set a value to override for this org.`
            : `Override active (${currentOverride}/hr). Platform default is ${data.defaultPerHour}/hr.`}
      </span>
    </div>
  );
}

export function formatFailureSampleForCopy(s: RecentSample): string {
  const transportLabel = TRANSPORT_LABELS[s.transport] ?? s.transport;
  const recipient = s.recipient ?? "unknown";
  const when = new Date(s.ts).toISOString();
  return `Recipient: ${recipient} | Transport: ${transportLabel} | Error: ${s.errorCode} | When: ${when}`;
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function buildFailureSamplesCsv(samples: RecentSample[]): string {
  const header = ["recipient", "transport", "error_code", "timestamp"];
  const lines = [header.join(",")];
  for (const s of samples) {
    const transportLabel = TRANSPORT_LABELS[s.transport] ?? s.transport;
    const recipient = s.recipient ?? "unknown";
    const when = new Date(s.ts).toISOString();
    lines.push(
      [recipient, transportLabel, s.errorCode, when].map(csvEscape).join(","),
    );
  }
  return lines.join("\n");
}

export function buildFailureSamplesCsvFilename(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return `email-failure-samples-${stamp}.csv`;
}

type TopRecipientRow = {
  recipient: string;
  count: number;
  transports: string[];
  lastErrorCode: string;
  lastTs: number;
};

export type TopRecipientSort = "count" | "recent";

function buildTopRecipients(
  samples: RecentSample[],
  sort: TopRecipientSort = "count",
): TopRecipientRow[] {
  const groups = new Map<
    string,
    {
      count: number;
      transports: Set<string>;
      lastErrorCode: string;
      lastTs: number;
    }
  >();
  for (const s of samples) {
    if (!s.recipient) continue;
    const cur = groups.get(s.recipient) ?? {
      count: 0,
      transports: new Set<string>(),
      lastErrorCode: s.errorCode,
      lastTs: s.ts,
    };
    cur.count += 1;
    cur.transports.add(s.transport);
    if (s.ts >= cur.lastTs) {
      cur.lastTs = s.ts;
      cur.lastErrorCode = s.errorCode;
    }
    groups.set(s.recipient, cur);
  }
  return Array.from(groups.entries())
    .map(([recipient, g]) => ({
      recipient,
      count: g.count,
      transports: Array.from(g.transports).sort(),
      lastErrorCode: g.lastErrorCode,
      lastTs: g.lastTs,
    }))
    .sort((a, b) =>
      sort === "recent"
        ? b.lastTs - a.lastTs || b.count - a.count
        : b.count - a.count || b.lastTs - a.lastTs,
    );
}

type MaskedSuppression = {
  orgId: string;
  hash: string;
  maskedRecipient: string;
  reason: string;
  addedAt: number;
  addedBy: string | null;
  suppressedSends: number;
  lastSuppressedAt: number | null;
};

type MaskedSuppressionsResponse = {
  entries: MaskedSuppression[];
  count: number;
  suppressedSendsSinceBoot: number;
  suppressedSendsByTransport: Record<string, number>;
  suppressedSendsByReason?: Record<string, number>;
  windowMs?: number;
  suppressedSendsWindowCount?: number;
  suppressedSendsThreshold?: { perHour: number; breached: boolean };
  retentionDays?: number;
  // Task #314 — surfaced so the admin threshold editor can show the
  // active platform default alongside any per-org override the org
  // has set.
  suppressedAlertThresholdOverride?: number | null;
  suppressedAlertThresholdDefault?: number;
};

type SilencedSendThresholdResponse = {
  override: number | null;
  defaultPerHour: number;
  effectivePerHour: number;
  hardCodedDefault: number;
  max: number;
};

function formatLastActivity(ts: number, now: number): string {
  const diffMs = Math.max(0, now - ts);
  const day = 24 * 60 * 60 * 1000;
  const hour = 60 * 60 * 1000;
  const min = 60 * 1000;
  if (diffMs < hour) {
    const m = Math.max(1, Math.floor(diffMs / min));
    return `${m}m ago`;
  }
  if (diffMs < day) {
    const h = Math.floor(diffMs / hour);
    return `${h}h ago`;
  }
  const d = Math.floor(diffMs / day);
  return `${d}d ago`;
}

function daysUntilExpiry(
  lastActivityMs: number,
  retentionDays: number,
  now: number,
): number {
  const day = 24 * 60 * 60 * 1000;
  const expiresAt = lastActivityMs + retentionDays * day;
  const remainingMs = expiresAt - now;
  return Math.ceil(remainingMs / day);
}

const DRILLDOWN_ERROR_CODE_KEY = "email-failure-drilldown:error-code";
const DRILLDOWN_TOP_SORT_KEY = "email-failure-drilldown:top-sort";

function readPersistedErrorCodeFilter(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DRILLDOWN_ERROR_CODE_KEY);
    return raw && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

function readPersistedTopSort(): TopRecipientSort {
  if (typeof window === "undefined") return "count";
  try {
    const raw = window.localStorage.getItem(DRILLDOWN_TOP_SORT_KEY);
    return raw === "recent" || raw === "count" ? raw : "count";
  } catch {
    return "count";
  }
}

export function FailureDrilldown({
  recent,
  transportFilter,
  tab: tabProp,
  onTabChange,
  onClear,
}: {
  recent: RecentSample[];
  transportFilter: string | null;
  tab?: "recent" | "top" | "suppressed";
  onTabChange?: (tab: "recent" | "top" | "suppressed") => void;
  onClear: () => void;
}) {
  const { toast } = useToast();
  const [internalTab, setInternalTab] = useState<"recent" | "top" | "suppressed">(
    tabProp ?? "recent",
  );
  const tab = tabProp ?? internalTab;
  const setTab = (next: "recent" | "top" | "suppressed") => {
    if (onTabChange) onTabChange(next);
    else setInternalTab(next);
  };
  const [topErrorCodeFilter, setTopErrorCodeFilter] = useState<string | null>(
    () => readPersistedErrorCodeFilter(),
  );
  const [topSort, setTopSort] = useState<TopRecipientSort>(
    () => readPersistedTopSort(),
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (topErrorCodeFilter === null) {
        window.localStorage.removeItem(DRILLDOWN_ERROR_CODE_KEY);
      } else {
        window.localStorage.setItem(
          DRILLDOWN_ERROR_CODE_KEY,
          topErrorCodeFilter,
        );
      }
    } catch {
      // ignore storage failures (private mode, quota, etc.)
    }
  }, [topErrorCodeFilter]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(DRILLDOWN_TOP_SORT_KEY, topSort);
    } catch {
      // ignore storage failures
    }
  }, [topSort]);

  const suppressionsQuery = useQuery<MaskedSuppressionsResponse>({
    queryKey: ["/api/admin/email/masked-suppressions"],
  });
  const suppressedHashes = useMemo(
    () =>
      new Set((suppressionsQuery.data?.entries ?? []).map((e) => e.hash)),
    [suppressionsQuery.data],
  );

  const suppressMutation = useMutation({
    mutationFn: async (recipient: string) => {
      const res = await apiRequest(
        "POST",
        "/api/admin/email/masked-suppressions",
        { recipient },
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/email/masked-suppressions"],
      });
      toast({ title: "Recipient suppressed" });
    },
    onError: (err: any) => {
      toast({
        title: "Could not suppress recipient",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  const unsuppressMutation = useMutation({
    mutationFn: async (hash: string) => {
      const res = await apiRequest(
        "DELETE",
        `/api/admin/email/masked-suppressions/${encodeURIComponent(hash)}`,
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/email/masked-suppressions"],
      });
      toast({ title: "Recipient unsuppressed" });
    },
    onError: (err: any) => {
      toast({
        title: "Could not unsuppress recipient",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  async function writeToClipboard(text: string, successTitle: string) {
    try {
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === "function"
      ) {
        await navigator.clipboard.writeText(text);
        toast({ title: successTitle });
      } else {
        toast({
          title: "Could not copy",
          description: "Clipboard is not available in this browser.",
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "Could not copy",
        description: "Clipboard write was blocked.",
        variant: "destructive",
      });
    }
  }

  async function copySample(s: RecentSample) {
    await writeToClipboard(
      formatFailureSampleForCopy(s),
      "Copied failure sample to clipboard",
    );
  }

  const scoped = useMemo(
    () =>
      transportFilter
        ? recent.filter((r) => r.transport === transportFilter)
        : recent,
    [recent, transportFilter],
  );

  const filtered = useMemo(
    () => [...scoped].sort((a, b) => b.ts - a.ts).slice(0, 50),
    [scoped],
  );

  const topErrorCodes = useMemo(() => {
    const codes = new Set<string>();
    for (const s of scoped) {
      if (s.recipient) codes.add(s.errorCode);
    }
    return Array.from(codes).sort();
  }, [scoped]);

  useEffect(() => {
    if (
      topErrorCodeFilter !== null &&
      topErrorCodes.length > 0 &&
      !topErrorCodes.includes(topErrorCodeFilter)
    ) {
      setTopErrorCodeFilter(null);
    }
  }, [topErrorCodeFilter, topErrorCodes]);

  const topScoped = useMemo(
    () =>
      topErrorCodeFilter
        ? scoped.filter((s) => s.errorCode === topErrorCodeFilter)
        : scoped,
    [scoped, topErrorCodeFilter],
  );

  const topRecipients = useMemo(
    () => buildTopRecipients(topScoped, topSort).slice(0, 50),
    [topScoped, topSort],
  );

  const topFilterActive = topErrorCodeFilter !== null;
  const hasUnfilteredTopRows = useMemo(
    () => buildTopRecipients(scoped).length > 0,
    [scoped],
  );

  async function copyAll() {
    const text = filtered.map(formatFailureSampleForCopy).join("\n");
    const count = filtered.length;
    await writeToClipboard(
      text,
      `Copied ${count} failure sample${count === 1 ? "" : "s"} to clipboard`,
    );
  }

  function downloadCsv() {
    const csv = buildFailureSamplesCsv(filtered);
    const filename = buildFailureSamplesCsvFilename();
    try {
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      const count = filtered.length;
      toast({
        title: `Downloaded ${count} failure sample${count === 1 ? "" : "s"} as CSV`,
      });
    } catch {
      toast({
        title: "Could not download CSV",
        description: "Your browser blocked the download.",
        variant: "destructive",
      });
    }
  }

  const transportLabel = transportFilter
    ? TRANSPORT_LABELS[transportFilter] ?? transportFilter
    : null;
  const suppressedEntries = suppressionsQuery.data?.entries ?? [];
  const suppressionRetentionDays = suppressionsQuery.data?.retentionDays ?? null;
  const heading =
    tab === "top"
      ? transportLabel
        ? `Top failing recipients — ${transportLabel}`
        : "Top failing recipients"
      : tab === "suppressed"
        ? "Suppressed recipients"
        : transportLabel
          ? `Recent ${transportLabel} failures`
          : "Recent failure samples";
  const headingCount =
    tab === "top"
      ? topRecipients.length
      : tab === "suppressed"
        ? suppressedEntries.length
        : filtered.length;

  return (
    <div
      id="email-failure-drilldown"
      className="mt-3 rounded-md"
      style={{ border: "1px solid var(--lux-border)", background: "var(--lux-surface)" }}
      data-testid="panel-email-failure-drilldown"
    >
      <div className="flex items-center justify-between px-3 py-2 gap-3 flex-wrap" style={{ borderBottom: "1px solid var(--lux-border)" }}>
        <p className="text-xs font-semibold" style={{ color: "var(--lux-text)" }}>
          {heading}
          <span className="ml-2 font-normal" style={{ color: "var(--lux-text-muted)" }}>
            ({headingCount})
          </span>
        </p>
        <div className="flex items-center gap-3">
          <div
            className="inline-flex rounded-md overflow-hidden"
            style={{ border: "1px solid var(--lux-border)" }}
            role="tablist"
            aria-label="Failure drill-down view"
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab === "recent"}
              onClick={() => setTab("recent")}
              className="text-[11px] px-2 py-0.5"
              style={{
                background:
                  tab === "recent" ? "var(--lux-border)" : "transparent",
                color: "var(--lux-text)",
              }}
              data-testid="tab-failure-drilldown-recent"
            >
              Recent
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "top"}
              onClick={() => setTab("top")}
              className="text-[11px] px-2 py-0.5"
              style={{
                background:
                  tab === "top" ? "var(--lux-border)" : "transparent",
                color: "var(--lux-text)",
                borderLeft: "1px solid var(--lux-border)",
              }}
              data-testid="tab-failure-drilldown-top"
            >
              Top recipients
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "suppressed"}
              onClick={() => setTab("suppressed")}
              className="text-[11px] px-2 py-0.5"
              style={{
                background:
                  tab === "suppressed" ? "var(--lux-border)" : "transparent",
                color: "var(--lux-text)",
                borderLeft: "1px solid var(--lux-border)",
              }}
              data-testid="tab-failure-drilldown-suppressed"
            >
              Suppressed
              {suppressedEntries.length > 0 ? ` (${suppressedEntries.length})` : ""}
            </button>
          </div>
          {tab === "recent" && (
            <>
              <button
                type="button"
                onClick={copyAll}
                disabled={filtered.length === 0}
                className="text-[11px] inline-flex items-center gap-1 underline disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ color: "var(--lux-text-muted)" }}
                title="Copy all visible failure samples"
                aria-label="Copy all visible failure samples"
                data-testid="button-failure-drilldown-copy-all"
              >
                <Copy className="w-3 h-3" />
                Copy all
              </button>
              <button
                type="button"
                onClick={downloadCsv}
                disabled={filtered.length === 0}
                className="text-[11px] inline-flex items-center gap-1 underline disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ color: "var(--lux-text-muted)" }}
                title="Download visible failure samples as CSV"
                aria-label="Download visible failure samples as CSV"
                data-testid="button-failure-drilldown-download-csv"
              >
                <Download className="w-3 h-3" />
                Download CSV
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onClear}
            className="text-[11px] underline"
            style={{ color: "var(--lux-text-muted)" }}
            data-testid="button-failure-drilldown-close"
          >
            Hide
          </button>
        </div>
      </div>
      {tab === "suppressed" ? (
        <>
          {(() => {
            const byReason = suppressionsQuery.data?.suppressedSendsByReason;
            if (!byReason) return null;
            const entries = Object.entries(byReason)
              .filter(([, n]) => (n ?? 0) > 0)
              .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
            if (entries.length === 0) return null;
            return (
              <div
                className="px-3 py-2 text-[11px] flex items-center gap-1 flex-wrap"
                style={{
                  borderBottom: "1px solid var(--lux-border)",
                  color: "var(--lux-text-muted)",
                }}
                title="Silenced sends in the last hour, grouped by suppression reason."
                data-testid="text-failure-drilldown-suppressed-by-reason"
              >
                <span>Silenced by reason (last hour):</span>
                {entries.map(([reason, count], idx) => (
                  <span
                    key={reason}
                    data-testid={`text-suppressed-by-reason-${reason}`}
                  >
                    <span
                      className="font-semibold"
                      style={{ color: "var(--lux-text)" }}
                    >
                      {count}
                    </span>{" "}
                    {reason}
                    {idx < entries.length - 1 ? " · " : ""}
                  </span>
                ))}
              </div>
            );
          })()}
          {suppressionsQuery.isLoading ? (
          <p
            className="px-3 py-3 text-xs"
            style={{ color: "var(--lux-text-muted)" }}
            data-testid="text-failure-drilldown-suppressed-loading"
          >
            Loading suppressed recipients…
          </p>
        ) : suppressedEntries.length === 0 ? (
          <p
            className="px-3 py-3 text-xs"
            style={{ color: "var(--lux-text-muted)" }}
            data-testid="text-failure-drilldown-suppressed-empty"
          >
            No recipients are currently suppressed. Use the "Suppress" button on
            the Top recipients tab to stop further sends to a chronic failing
            address.
          </p>
        ) : (
          <ul
            className="divide-y"
            style={{ borderColor: "var(--lux-border)" }}
            data-testid="list-failure-drilldown-suppressed"
          >
            {suppressedEntries.map((s, idx) => {
              const now = Date.now();
              const lastActivityMs = s.lastSuppressedAt ?? s.addedAt;
              const lastActivityLabel = formatLastActivity(lastActivityMs, now);
              const lastActivityKind =
                s.lastSuppressedAt != null ? "Last silenced" : "Added";
              const lastActivityIso = new Date(lastActivityMs).toISOString();
              const remainingDays =
                suppressionRetentionDays != null
                  ? daysUntilExpiry(
                      lastActivityMs,
                      suppressionRetentionDays,
                      now,
                    )
                  : null;
              const expiryLabel =
                remainingDays === null
                  ? null
                  : remainingDays <= 0
                    ? "Auto-removes soon"
                    : remainingDays === 1
                      ? "1 day until auto-removal"
                      : `${remainingDays} days until auto-removal`;
              const expiryTitle =
                suppressionRetentionDays != null
                  ? `Auto-removed after ${suppressionRetentionDays} days of inactivity${
                      s.lastSuppressedAt
                        ? " (counted from the last silenced send)"
                        : " (counted from when it was added)"
                    }`
                  : undefined;
              return (
              <li
                key={s.hash}
                className="grid grid-cols-12 gap-2 px-3 py-2 text-[11px] items-center"
                style={{ borderColor: "var(--lux-border)" }}
                data-testid={`row-suppressed-recipient-${idx}`}
              >
                <span
                  className="col-span-4 truncate font-mono"
                  style={{ color: "var(--lux-text)" }}
                  title={s.maskedRecipient}
                  data-testid={`text-suppressed-recipient-address-${idx}`}
                >
                  {s.maskedRecipient}
                </span>
                <span
                  className="col-span-2 truncate"
                  style={{ color: "var(--lux-text-muted)" }}
                  title={`${s.reason} — ${s.suppressedSends} blocked`}
                  data-testid={`text-suppressed-recipient-reason-${idx}`}
                >
                  {s.reason}
                  <span
                    className="ml-1"
                    data-testid={`text-suppressed-recipient-blocked-${idx}`}
                  >
                    ({s.suppressedSends})
                  </span>
                </span>
                <span
                  className="col-span-2 truncate text-right"
                  style={{ color: "var(--lux-text-muted)" }}
                  title={`${lastActivityKind}: ${lastActivityIso}`}
                  data-testid={`text-suppressed-recipient-last-activity-${idx}`}
                >
                  {lastActivityKind} {lastActivityLabel}
                </span>
                <span
                  className="col-span-2 truncate text-right"
                  style={{
                    color:
                      remainingDays !== null && remainingDays <= 7
                        ? "var(--lux-warning, var(--lux-text))"
                        : "var(--lux-text-muted)",
                  }}
                  title={expiryTitle}
                  data-testid={`text-suppressed-recipient-expiry-${idx}`}
                >
                  {expiryLabel ?? `${s.suppressedSends} blocked`}
                </span>
                <span className="col-span-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => unsuppressMutation.mutate(s.hash)}
                    disabled={
                      unsuppressMutation.isPending &&
                      unsuppressMutation.variables === s.hash
                    }
                    className="inline-flex items-center gap-1 rounded px-2 py-0.5 hover-elevate cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                      border: "1px solid var(--lux-border)",
                      color: "var(--lux-text-muted)",
                    }}
                    title="Remove this recipient from the suppression list"
                    aria-label="Unsuppress recipient"
                    data-testid={`button-unsuppress-recipient-${idx}`}
                  >
                    <Undo2 className="w-3 h-3" />
                    Unsuppress
                  </button>
                </span>
              </li>
              );
            })}
          </ul>
        )}
        </>
      ) : tab === "top" ? (
        <>
          <div
            className="flex items-center gap-2 px-3 py-2 flex-wrap"
            style={{ borderBottom: "1px solid var(--lux-border)" }}
            data-testid="toolbar-top-recipients"
          >
            <span
              className="text-[11px] font-medium"
              style={{ color: "var(--lux-text-muted)" }}
            >
              Error code:
            </span>
            <button
              type="button"
              onClick={() => setTopErrorCodeFilter(null)}
              className="text-[11px] px-2 py-0.5 rounded-full hover-elevate cursor-pointer"
              style={{
                border: "1px solid var(--lux-border)",
                background:
                  topErrorCodeFilter === null
                    ? "var(--lux-border)"
                    : "transparent",
                color: "var(--lux-text)",
              }}
              aria-pressed={topErrorCodeFilter === null}
              data-testid="chip-top-error-code-all"
            >
              All
            </button>
            {topErrorCodes.map((code) => {
              const active = topErrorCodeFilter === code;
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() =>
                    setTopErrorCodeFilter(active ? null : code)
                  }
                  className="text-[11px] px-2 py-0.5 rounded-full font-mono hover-elevate cursor-pointer"
                  style={{
                    border: "1px solid var(--lux-border)",
                    background: active ? "var(--lux-border)" : "transparent",
                    color: "var(--lux-text)",
                  }}
                  aria-pressed={active}
                  data-testid={`chip-top-error-code-${code}`}
                  title={`Filter to ${code}`}
                >
                  {code}
                </button>
              );
            })}
            <div className="ml-auto inline-flex items-center gap-2">
              <span
                className="text-[11px] font-medium"
                style={{ color: "var(--lux-text-muted)" }}
              >
                Sort:
              </span>
              <div
                className="inline-flex rounded-md overflow-hidden"
                style={{ border: "1px solid var(--lux-border)" }}
                role="group"
                aria-label="Sort top recipients"
              >
                <button
                  type="button"
                  onClick={() => setTopSort("count")}
                  className="text-[11px] px-2 py-0.5"
                  style={{
                    background:
                      topSort === "count" ? "var(--lux-border)" : "transparent",
                    color: "var(--lux-text)",
                  }}
                  aria-pressed={topSort === "count"}
                  data-testid="button-top-sort-count"
                >
                  Most failures
                </button>
                <button
                  type="button"
                  onClick={() => setTopSort("recent")}
                  className="text-[11px] px-2 py-0.5"
                  style={{
                    background:
                      topSort === "recent" ? "var(--lux-border)" : "transparent",
                    color: "var(--lux-text)",
                    borderLeft: "1px solid var(--lux-border)",
                  }}
                  aria-pressed={topSort === "recent"}
                  data-testid="button-top-sort-recent"
                >
                  Most recent
                </button>
              </div>
            </div>
          </div>
          {topRecipients.length === 0 ? (
          <p
            className="px-3 py-3 text-xs"
            style={{ color: "var(--lux-text-muted)" }}
            data-testid="text-failure-drilldown-top-empty"
          >
            {topFilterActive && hasUnfilteredTopRows ? (
              <>
                No recipients match the{" "}
                <span className="font-mono">{topErrorCodeFilter}</span> filter.{" "}
                <button
                  type="button"
                  onClick={() => setTopErrorCodeFilter(null)}
                  className="underline"
                  style={{ color: "var(--lux-text)" }}
                  data-testid="button-top-clear-error-code"
                >
                  Clear filter
                </button>
              </>
            ) : (
              <>
                No recipients with masked addresses failed in the last hour
                {transportFilter ? ` for this transport.` : "."}
              </>
            )}
          </p>
        ) : (
          <ul
            className="divide-y"
            style={{ borderColor: "var(--lux-border)" }}
            data-testid="list-failure-drilldown-top"
          >
            {topRecipients.map((r, idx) => {
              const recipientHash = (r.recipient.match(/\(#([a-f0-9]{4})\)\s*$/i)?.[1] ?? "").toLowerCase();
              const isSuppressed = recipientHash ? suppressedHashes.has(recipientHash) : false;
              const pending =
                suppressMutation.isPending &&
                suppressMutation.variables === r.recipient;
              return (
              <li
                key={`${r.recipient}-${idx}`}
                className="grid grid-cols-12 gap-2 px-3 py-2 text-[11px] items-center"
                style={{ borderColor: "var(--lux-border)" }}
                data-testid={`row-top-recipient-${idx}`}
              >
                <span
                  className="col-span-4 truncate font-mono"
                  style={{ color: "var(--lux-text)" }}
                  title={r.recipient}
                  data-testid={`text-top-recipient-address-${idx}`}
                >
                  {r.recipient}
                </span>
                <span
                  className="col-span-1 font-semibold"
                  style={{ color: "rgb(185,28,28)" }}
                  data-testid={`text-top-recipient-count-${idx}`}
                >
                  {r.count}
                </span>
                <span
                  className="col-span-2 truncate"
                  style={{ color: "var(--lux-text-muted)" }}
                  title={r.transports
                    .map((t) => TRANSPORT_LABELS[t] ?? t)
                    .join(", ")}
                  data-testid={`text-top-recipient-transports-${idx}`}
                >
                  {r.transports
                    .map((t) => TRANSPORT_LABELS[t] ?? t)
                    .join(", ")}
                </span>
                <span
                  className="col-span-2 truncate"
                  style={{ color: "rgb(185,28,28)" }}
                  title={r.lastErrorCode}
                  data-testid={`text-top-recipient-last-error-${idx}`}
                >
                  {r.lastErrorCode}
                </span>
                <span
                  className="col-span-1 text-right"
                  style={{ color: "var(--lux-text-muted)" }}
                  data-testid={`text-top-recipient-last-seen-${idx}`}
                >
                  {formatRelative(r.lastTs)}
                </span>
                <span className="col-span-2 flex justify-end">
                  {isSuppressed ? (
                    <span
                      className="inline-flex items-center gap-1 rounded px-2 py-0.5"
                      style={{
                        background: "rgba(120,120,120,0.12)",
                        color: "var(--lux-text-muted)",
                      }}
                      title="This recipient is already suppressed for your org"
                      data-testid={`badge-top-recipient-suppressed-${idx}`}
                    >
                      <Ban className="w-3 h-3" />
                      Suppressed
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => suppressMutation.mutate(r.recipient)}
                      disabled={pending || !recipientHash}
                      className="inline-flex items-center gap-1 rounded px-2 py-0.5 hover-elevate cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{
                        border: "1px solid rgba(220,38,38,0.4)",
                        color: "rgb(185,28,28)",
                      }}
                      title="Stop further sends to this masked recipient for your org"
                      aria-label="Suppress recipient"
                      data-testid={`button-suppress-recipient-${idx}`}
                    >
                      <Ban className="w-3 h-3" />
                      {pending ? "Suppressing…" : "Suppress"}
                    </button>
                  )}
                </span>
              </li>
              );
            })}
          </ul>
        )}
        </>
      ) : filtered.length === 0 ? (
        <p
          className="px-3 py-3 text-xs"
          style={{ color: "var(--lux-text-muted)" }}
          data-testid="text-failure-drilldown-empty"
        >
          No failure samples in the last hour{transportFilter ? ` for this transport.` : "."}
        </p>
      ) : (
        <ul className="divide-y" style={{ borderColor: "var(--lux-border)" }} data-testid="list-failure-drilldown">
          {filtered.map((s, idx) => {
            const transportLabel = TRANSPORT_LABELS[s.transport] ?? s.transport;
            const rowKey = `${s.ts}-${s.transport}-${s.errorCode}-${idx}`;
            return (
              <li
                key={rowKey}
                className="grid grid-cols-12 gap-2 px-3 py-2 text-[11px] items-center"
                style={{ borderColor: "var(--lux-border)" }}
                data-testid={`row-failure-sample-${idx}`}
              >
                <span
                  className="col-span-4 truncate font-mono"
                  style={{ color: "var(--lux-text)" }}
                  title={s.recipient ?? "unknown recipient"}
                  data-testid={`text-failure-sample-recipient-${idx}`}
                >
                  {s.recipient ?? "—"}
                </span>
                <span
                  className="col-span-2"
                  style={{ color: "var(--lux-text-muted)" }}
                  data-testid={`text-failure-sample-transport-${idx}`}
                >
                  {transportLabel}
                </span>
                <span
                  className="col-span-3 truncate"
                  style={{ color: "rgb(185,28,28)" }}
                  title={s.errorCode}
                  data-testid={`text-failure-sample-error-${idx}`}
                >
                  {s.errorCode}
                </span>
                <span
                  className="col-span-2 text-right"
                  style={{ color: "var(--lux-text-muted)" }}
                  data-testid={`text-failure-sample-ts-${idx}`}
                >
                  {formatRelative(s.ts)}
                </span>
                <span className="col-span-1 flex justify-end">
                  <button
                    type="button"
                    onClick={() => copySample(s)}
                    className="inline-flex items-center justify-center rounded p-1 hover-elevate cursor-pointer"
                    style={{ color: "var(--lux-text-muted)" }}
                    title="Copy failure details for support ticket"
                    aria-label="Copy failure details"
                    data-testid={`button-failure-sample-copy-${idx}`}
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
