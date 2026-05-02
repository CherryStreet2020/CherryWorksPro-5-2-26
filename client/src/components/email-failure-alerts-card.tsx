import { useEffect, useMemo, useState } from "react";
import {
  useQuery,
  useMutation,
  keepPreviousData,
} from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  Bell,
  ArrowRight,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Download,
  Pin,
  X,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type FailureAlertOrgSlice = {
  failureCount: number;
  topTransport: string | null;
  topErrorCode: string | null;
};

type FailureAlert = {
  ts: number;
  failureCount: number;
  threshold: number;
  thresholdBreached: boolean;
  topTransport: string | null;
  topErrorCode: string | null;
  delivered: boolean;
  byOrg?: Record<string, FailureAlertOrgSlice>;
};

type FailureAlertsResponse = {
  alerts: FailureAlert[];
  total: number;
  limit: number;
  offset: number;
  from: number | null;
  to: number | null;
  retentionDays: number;
  truncated?: boolean;
  thresholdPerHour: number;
  isPlatformOperator?: boolean;
  orgNames?: Record<string, string>;
};

const TRANSPORT_LABELS: Record<string, string> = {
  smtp: "SMTP",
  graph: "Microsoft 365",
  gmail: "Gmail",
};

const PAGE_SIZE = 10;

type RangePreset = "24h" | "7d" | "30d" | "all" | "custom";

const RANGE_PRESETS: Array<{ value: RangePreset; label: string; ms: number | null }> = [
  { value: "24h", label: "Last 24 hours", ms: 24 * 60 * 60 * 1000 },
  { value: "7d", label: "Last 7 days", ms: 7 * 24 * 60 * 60 * 1000 },
  { value: "30d", label: "Last 30 days", ms: 30 * 24 * 60 * 60 * 1000 },
  { value: "all", label: "All history", ms: null },
  { value: "custom", label: "Custom range", ms: null },
];

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.max(1, Math.floor(diff / 1000))}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function formatDateTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function dateInputToStartMs(value: string): number | null {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00`);
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
}

function dateInputToEndMs(value: string): number | null {
  if (!value) return null;
  const d = new Date(`${value}T23:59:59.999`);
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
}

export function EmailFailureAlertsCard() {
  const [preset, setPreset] = useState<RangePreset>("24h");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [page, setPage] = useState(0);
  // Keyed by `${ts}-${idx}` — `ts` alone can collide when two alerts
  // are persisted in the same millisecond, which would toggle both
  // expansions at once.
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  const toggleExpanded = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const { fromMs, toMs } = useMemo(() => {
    if (preset === "custom") {
      return {
        fromMs: dateInputToStartMs(customFrom),
        toMs: dateInputToEndMs(customTo),
      };
    }
    const def = RANGE_PRESETS.find((p) => p.value === preset);
    if (!def || def.ms === null) return { fromMs: null, toMs: null };
    return { fromMs: Date.now() - def.ms, toMs: null };
  }, [preset, customFrom, customTo]);

  const offset = page * PAGE_SIZE;

  const queryParams = new URLSearchParams();
  queryParams.set("limit", String(PAGE_SIZE));
  queryParams.set("offset", String(offset));
  if (fromMs !== null) queryParams.set("from", String(fromMs));
  if (toMs !== null) queryParams.set("to", String(toMs));

  const queryUrl = `/api/admin/email/failure-alerts?${queryParams.toString()}`;

  const { data, isLoading, error } = useQuery<FailureAlertsResponse>({
    queryKey: [
      "/api/admin/email/failure-alerts",
      { offset, limit: PAGE_SIZE, fromMs, toMs },
    ],
    queryFn: async () => {
      const res = await fetch(queryUrl, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Clamp the page index back into range whenever the result set shrinks
  // (e.g. a tighter date range or rows aging out of the durable store).
  // Without this, the user can get stuck on an empty out-of-range page
  // until they manually click Prev.
  useEffect(() => {
    if (data && page > totalPages - 1) {
      setPage(Math.max(0, totalPages - 1));
    }
  }, [data, page, totalPages]);

  const currentPage = Math.min(page, totalPages - 1);
  const currentOffset = currentPage * PAGE_SIZE;
  const showingFrom = total === 0 ? 0 : currentOffset + 1;
  const showingTo = Math.min(currentOffset + PAGE_SIZE, total);

  const handlePresetChange = (value: string) => {
    setPreset(value as RangePreset);
    setPage(0);
  };

  const csvParams = new URLSearchParams();
  if (fromMs !== null) csvParams.set("from", String(fromMs));
  if (toMs !== null) csvParams.set("to", String(toMs));
  const csvHref = `/api/admin/email/failure-alerts.csv${
    csvParams.toString() ? `?${csvParams.toString()}` : ""
  }`;
  const csvDisabled =
    preset === "custom" && (fromMs === null || toMs === null);
  const csvTruncated = !!data?.truncated;
  const retentionDays = data?.retentionDays ?? 30;

  return (
    <Card
      className="border-0"
      style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}
      data-testid="card-email-failure-alerts"
    >
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4 gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Bell className="w-4 h-4 shrink-0" style={{ color: "var(--lux-text-muted)" }} />
            <h3 className="text-sm font-semibold" style={{ color: "var(--lux-text)" }}>
              Email failure alerts
            </h3>
          </div>
          <Link
            href="/settings#accounting-email"
            className="text-xs inline-flex items-center gap-1 hover:underline"
            style={{ color: "var(--lux-text-muted)" }}
            data-testid="link-email-failure-alerts-detail"
          >
            View details
            <ArrowRight className="w-3 h-3" />
          </Link>
        </div>

        <div className="flex items-center gap-2 flex-wrap mb-3">
          <Select value={preset} onValueChange={handlePresetChange}>
            <SelectTrigger
              className="h-8 w-[180px] text-xs"
              data-testid="select-email-failure-alerts-range"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGE_PRESETS.map((p) => (
                <SelectItem
                  key={p.value}
                  value={p.value}
                  data-testid={`option-email-failure-alerts-range-${p.value}`}
                >
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {preset === "custom" && (
            <div className="flex items-center gap-1 flex-wrap">
              <input
                type="date"
                value={customFrom}
                onChange={(e) => {
                  setCustomFrom(e.target.value);
                  setPage(0);
                }}
                className="h-8 text-xs px-2 rounded border bg-transparent"
                style={{
                  borderColor: "var(--lux-border)",
                  color: "var(--lux-text)",
                }}
                data-testid="input-email-failure-alerts-from"
              />
              <span className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
                to
              </span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => {
                  setCustomTo(e.target.value);
                  setPage(0);
                }}
                className="h-8 text-xs px-2 rounded border bg-transparent"
                style={{
                  borderColor: "var(--lux-border)",
                  color: "var(--lux-text)",
                }}
                data-testid="input-email-failure-alerts-to"
              />
            </div>
          )}
          {csvDisabled ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 px-2 ml-auto text-xs gap-1"
              disabled
              data-testid="button-email-failure-alerts-export-csv"
            >
              <Download className="w-3.5 h-3.5" />
              Download CSV
            </Button>
          ) : (
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-8 px-2 ml-auto text-xs"
              data-testid="button-email-failure-alerts-export-csv"
            >
              <a href={csvHref} download className="inline-flex items-center gap-1">
                <Download className="w-3.5 h-3.5" />
                Download CSV
              </a>
            </Button>
          )}
        </div>

        {csvTruncated && !isLoading && (
          <div
            className="rounded-md p-2.5 mb-3 flex items-start gap-2"
            style={{
              background: "rgba(234,179,8,0.06)",
              border: "1px solid rgba(234,179,8,0.2)",
            }}
            data-testid="email-failure-alerts-truncation-warning"
          >
            <AlertTriangle
              className="w-4 h-4 mt-0.5 shrink-0"
              style={{ color: "rgb(202,138,4)" }}
            />
            <p
              className="text-[11px] leading-snug"
              style={{ color: "var(--lux-text-muted)" }}
            >
              Alerts older than {retentionDays} days are not retained. The
              selected range extends before that cutoff, so older matching
              alerts may have been pruned and will not appear here or in the
              CSV export. Alerts within the last {retentionDays} days are
              complete.
            </p>
          </div>
        )}

        {isLoading ? (
          <div data-testid="email-failure-alerts-loading">
            <Skeleton className="h-4 w-40 mb-2" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : error || !data ? (
          <div
            className="rounded-md p-3 flex items-start gap-2"
            style={{ background: "rgba(234,179,8,0.06)", border: "1px solid rgba(234,179,8,0.2)" }}
            data-testid="email-failure-alerts-error"
          >
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "rgb(202,138,4)" }} />
            <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
              Could not load recent email failure alerts.
            </p>
          </div>
        ) : data.alerts.length === 0 ? (
          <div
            className="rounded-md p-3 flex items-start gap-2"
            style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.2)" }}
            data-testid="email-failure-alerts-empty"
          >
            <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "rgb(21,128,61)" }} />
            <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
              No outgoing email failure threshold breaches recorded for this range
              {" "}(alert threshold: {data.thresholdPerHour}/hr).
            </p>
          </div>
        ) : (
          <>
            <ul className="divide-y" style={{ borderColor: "var(--lux-border)" }}>
              {data.alerts.map((a, idx) => {
                const transportLabel = a.topTransport
                  ? TRANSPORT_LABELS[a.topTransport] ?? a.topTransport
                  : "unknown";
                const byOrgEntries = a.byOrg
                  ? Object.entries(a.byOrg).sort(
                      (x, y) => y[1].failureCount - x[1].failureCount,
                    )
                  : [];
                // Gate the cross-org breakdown on the operator flag from
                // the API. Tenant ADMINs never get a `byOrg` payload, but
                // we still gate explicitly so a future server-side bug
                // can't accidentally leak the affordance to them.
                const hasByOrg =
                  !!data.isPlatformOperator && byOrgEntries.length > 0;
                const rowKey = `${a.ts}-${idx}`;
                const expanded = expandedKeys.has(rowKey);
                return (
                  <li
                    key={`${a.ts}-${idx}`}
                    className="py-2.5 first:pt-0 last:pb-0"
                    style={{ borderColor: "var(--lux-border)" }}
                    data-testid={`row-email-failure-alert-${idx}`}
                  >
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2 min-w-0">
                        <AlertTriangle
                          className="w-3.5 h-3.5 shrink-0"
                          style={{ color: "rgb(185,28,28)" }}
                        />
                        <span
                          className="text-xs font-semibold"
                          style={{ color: "var(--lux-text)" }}
                          data-testid={`text-email-failure-alert-time-${idx}`}
                          title={formatDateTime(a.ts)}
                        >
                          {formatRelative(a.ts)}
                        </span>
                        <span
                          className="text-[11px]"
                          style={{ color: "var(--lux-text-muted)" }}
                        >
                          · {formatDateTime(a.ts)}
                        </span>
                      </div>
                      <span
                        className="text-[11px] px-2 py-0.5 rounded-full"
                        style={
                          a.thresholdBreached
                            ? { background: "rgba(220,38,38,0.12)", color: "rgb(185,28,28)" }
                            : { background: "rgba(34,197,94,0.12)", color: "rgb(21,128,61)" }
                        }
                        data-testid={`badge-email-failure-alert-breach-${idx}`}
                      >
                        {a.thresholdBreached
                          ? `Threshold breached (${a.failureCount}/${a.threshold}/hr)`
                          : "Within threshold"}
                      </span>
                    </div>
                    <p
                      className="text-[11px] mt-1 ml-5"
                      style={{ color: "var(--lux-text-muted)" }}
                      data-testid={`text-email-failure-alert-detail-${idx}`}
                    >
                      Top transport:{" "}
                      <span className="font-medium" style={{ color: "var(--lux-text)" }}>
                        {transportLabel}
                      </span>
                      {" · "}
                      Top error:{" "}
                      <span className="font-medium" style={{ color: "var(--lux-text)" }}>
                        {a.topErrorCode ?? "unknown"}
                      </span>
                      {!a.delivered && (
                        <>
                          {" · "}
                          <span style={{ color: "rgb(202,138,4)" }}>webhook delivery failed</span>
                        </>
                      )}
                    </p>
                    {hasByOrg && (
                      <div className="ml-5 mt-1.5">
                        <button
                          type="button"
                          onClick={() => toggleExpanded(rowKey)}
                          className="text-[11px] inline-flex items-center gap-1 hover:underline"
                          style={{ color: "var(--lux-text-muted)" }}
                          data-testid={`button-email-failure-alert-toggle-orgs-${idx}`}
                          aria-expanded={expanded}
                        >
                          {expanded ? (
                            <ChevronUp className="w-3 h-3" />
                          ) : (
                            <ChevronDown className="w-3 h-3" />
                          )}
                          {expanded ? "Hide" : "Show"} affected orgs (
                          {byOrgEntries.length})
                        </button>
                        {expanded && (
                          <div
                            className="mt-1.5 rounded-md border overflow-hidden"
                            style={{
                              borderColor: "var(--lux-border)",
                              background: "rgba(0,0,0,0.02)",
                            }}
                            data-testid={`details-email-failure-alert-orgs-${idx}`}
                          >
                            <table className="w-full text-[11px]">
                              <thead>
                                <tr style={{ color: "var(--lux-text-muted)" }}>
                                  <th className="text-left font-medium px-2 py-1">
                                    Org
                                  </th>
                                  <th className="text-right font-medium px-2 py-1">
                                    Failures
                                  </th>
                                  <th className="text-left font-medium px-2 py-1">
                                    Top transport
                                  </th>
                                  <th className="text-left font-medium px-2 py-1">
                                    Top error
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {byOrgEntries.map(([orgId, slice]) => {
                                  const sliceTransport = slice.topTransport
                                    ? TRANSPORT_LABELS[slice.topTransport] ??
                                      slice.topTransport
                                    : "unknown";
                                  const orgLabel =
                                    data.orgNames?.[orgId] ?? orgId;
                                  return (
                                    <tr
                                      key={orgId}
                                      className="border-t"
                                      style={{ borderColor: "var(--lux-border)" }}
                                      data-testid={`row-email-failure-alert-org-${idx}-${orgId}`}
                                    >
                                      <td
                                        className="px-2 py-1"
                                        style={{ color: "var(--lux-text)" }}
                                        title={orgId}
                                        data-testid={`text-email-failure-alert-org-name-${idx}-${orgId}`}
                                      >
                                        {orgLabel}
                                      </td>
                                      <td
                                        className="px-2 py-1 text-right font-medium"
                                        style={{ color: "var(--lux-text)" }}
                                        data-testid={`text-email-failure-alert-org-count-${idx}-${orgId}`}
                                      >
                                        {slice.failureCount}
                                      </td>
                                      <td
                                        className="px-2 py-1"
                                        style={{ color: "var(--lux-text-muted)" }}
                                      >
                                        {sliceTransport}
                                      </td>
                                      <td
                                        className="px-2 py-1"
                                        style={{ color: "var(--lux-text-muted)" }}
                                      >
                                        {slice.topErrorCode ?? "unknown"}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t flex-wrap"
              style={{ borderColor: "var(--lux-border)" }}>
              <span
                className="text-[11px]"
                style={{ color: "var(--lux-text-muted)" }}
                data-testid="text-email-failure-alerts-pagination-summary"
              >
                Showing {showingFrom}-{showingTo} of {total}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2"
                  disabled={currentPage === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  data-testid="button-email-failure-alerts-prev"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </Button>
                <span
                  className="text-[11px]"
                  style={{ color: "var(--lux-text-muted)" }}
                  data-testid="text-email-failure-alerts-page"
                >
                  Page {currentPage + 1} of {totalPages}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2"
                  disabled={currentPage >= totalPages - 1}
                  onClick={() => setPage((p) => p + 1)}
                  data-testid="button-email-failure-alerts-next"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          </>
        )}

        {data?.isPlatformOperator && <PinnedAlertOrgsPanel />}
      </CardContent>
    </Card>
  );
}

type PinnedAlertOrgEntry = {
  orgId: string;
  pinnedAt: number;
  pinnedBy: string | null;
  note: string | null;
};

type PinnedAlertOrgsResponse = {
  entries: PinnedAlertOrgEntry[];
  count: number;
  orgNames?: Record<string, string>;
};

function PinnedAlertOrgsPanel() {
  const { toast } = useToast();
  const [orgIdInput, setOrgIdInput] = useState("");
  const [noteInput, setNoteInput] = useState("");

  const { data, isLoading, error } = useQuery<PinnedAlertOrgsResponse>({
    queryKey: ["/api/admin/email/alert-pinned-orgs"],
  });

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ["/api/admin/email/alert-pinned-orgs"],
    });

  const addMutation = useMutation({
    mutationFn: async (vars: { orgId: string; note: string | null }) => {
      const res = await apiRequest(
        "POST",
        "/api/admin/email/alert-pinned-orgs",
        { orgId: vars.orgId, note: vars.note },
      );
      return res.json();
    },
    onSuccess: () => {
      setOrgIdInput("");
      setNoteInput("");
      toast({ title: "Org pinned", description: "Added to alert breakdown." });
      invalidate();
    },
    onError: (err: unknown) => {
      toast({
        title: "Could not pin org",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (orgId: string) => {
      const res = await apiRequest(
        "DELETE",
        `/api/admin/email/alert-pinned-orgs/${encodeURIComponent(orgId)}`,
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Org unpinned" });
      invalidate();
    },
    onError: (err: unknown) => {
      toast({
        title: "Could not unpin org",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = orgIdInput.trim();
    if (!trimmed) return;
    const note = noteInput.trim();
    addMutation.mutate({ orgId: trimmed, note: note ? note : null });
  };

  const entries = data?.entries ?? [];

  return (
    <div
      className="mt-5 pt-4 border-t"
      style={{ borderColor: "var(--lux-border)" }}
      data-testid="section-pinned-alert-orgs"
    >
      <div className="flex items-center gap-2 mb-2">
        <Pin
          className="w-3.5 h-3.5"
          style={{ color: "var(--lux-text-muted)" }}
        />
        <h4
          className="text-xs font-semibold"
          style={{ color: "var(--lux-text)" }}
        >
          Pinned orgs in alert breakdown
        </h4>
      </div>
      <p
        className="text-[11px] mb-3"
        style={{ color: "var(--lux-text-muted)" }}
      >
        Pinned orgs are always included in the cross-tenant alert webhook
        breakdown, even when their failure count would otherwise fall outside
        the top set.
      </p>

      {isLoading ? (
        <div data-testid="pinned-alert-orgs-loading">
          <Skeleton className="h-4 w-40 mb-2" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : error ? (
        <div
          className="rounded-md p-2.5 mb-3 flex items-start gap-2"
          style={{
            background: "rgba(234,179,8,0.06)",
            border: "1px solid rgba(234,179,8,0.2)",
          }}
          data-testid="pinned-alert-orgs-error"
        >
          <AlertTriangle
            className="w-4 h-4 mt-0.5 shrink-0"
            style={{ color: "rgb(202,138,4)" }}
          />
          <p
            className="text-[11px]"
            style={{ color: "var(--lux-text-muted)" }}
          >
            Could not load pinned orgs.
          </p>
        </div>
      ) : entries.length === 0 ? (
        <p
          className="text-[11px] mb-3"
          style={{ color: "var(--lux-text-muted)" }}
          data-testid="pinned-alert-orgs-empty"
        >
          No pinned orgs yet.
        </p>
      ) : (
        <ul
          className="mb-3 rounded-md border divide-y"
          style={{ borderColor: "var(--lux-border)" }}
          data-testid="list-pinned-alert-orgs"
        >
          {entries.map((entry) => {
            const orgLabel = data?.orgNames?.[entry.orgId] ?? entry.orgId;
            return (
              <li
                key={entry.orgId}
                className="flex items-start justify-between gap-3 px-2.5 py-2"
                style={{ borderColor: "var(--lux-border)" }}
                data-testid={`row-pinned-alert-org-${entry.orgId}`}
              >
                <div className="min-w-0">
                  <div
                    className="text-[12px] font-medium truncate"
                    style={{ color: "var(--lux-text)" }}
                    title={entry.orgId}
                    data-testid={`text-pinned-alert-org-name-${entry.orgId}`}
                  >
                    {orgLabel}
                  </div>
                  <div
                    className="text-[11px] truncate"
                    style={{ color: "var(--lux-text-muted)" }}
                  >
                    {entry.orgId}
                    {entry.note ? (
                      <>
                        {" · "}
                        <span
                          data-testid={`text-pinned-alert-org-note-${entry.orgId}`}
                        >
                          {entry.note}
                        </span>
                      </>
                    ) : null}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-[11px] shrink-0"
                  disabled={
                    removeMutation.isPending &&
                    removeMutation.variables === entry.orgId
                  }
                  onClick={() => removeMutation.mutate(entry.orgId)}
                  data-testid={`button-unpin-alert-org-${entry.orgId}`}
                >
                  <X className="w-3.5 h-3.5 mr-1" />
                  Unpin
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <form
        onSubmit={onSubmit}
        className="flex flex-wrap items-end gap-2"
        data-testid="form-pin-alert-org"
      >
        <div className="flex flex-col gap-1">
          <label
            htmlFor="pin-alert-org-id"
            className="text-[11px]"
            style={{ color: "var(--lux-text-muted)" }}
          >
            Org id
          </label>
          <input
            id="pin-alert-org-id"
            type="text"
            value={orgIdInput}
            onChange={(e) => setOrgIdInput(e.target.value)}
            placeholder="org_..."
            className="h-8 text-xs px-2 rounded border bg-transparent w-[220px]"
            style={{
              borderColor: "var(--lux-border)",
              color: "var(--lux-text)",
            }}
            data-testid="input-pin-alert-org-id"
          />
        </div>
        <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
          <label
            htmlFor="pin-alert-org-note"
            className="text-[11px]"
            style={{ color: "var(--lux-text-muted)" }}
          >
            Note (optional)
          </label>
          <input
            id="pin-alert-org-note"
            type="text"
            value={noteInput}
            onChange={(e) => setNoteInput(e.target.value)}
            placeholder="Why is this org pinned?"
            className="h-8 text-xs px-2 rounded border bg-transparent w-full"
            style={{
              borderColor: "var(--lux-border)",
              color: "var(--lux-text)",
            }}
            data-testid="input-pin-alert-org-note"
          />
        </div>
        <Button
          type="submit"
          size="sm"
          className="h-8 px-3 text-xs"
          disabled={!orgIdInput.trim() || addMutation.isPending}
          data-testid="button-pin-alert-org"
        >
          <Pin className="w-3.5 h-3.5 mr-1" />
          {addMutation.isPending ? "Pinning..." : "Pin org"}
        </Button>
      </form>
    </div>
  );
}
