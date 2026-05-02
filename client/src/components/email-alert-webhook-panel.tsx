import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  Bell,
  ChevronDown,
  ChevronRight,
  Send,
  Trash2,
} from "lucide-react";

type ConfigResponse = {
  configured: boolean;
  webhookUrl: string | null;
  cooldownMs: number | null;
  envFallback: boolean;
  updatedAt?: string | null;
  updatedBy?: {
    id: string;
    name: string | null;
    email: string | null;
  } | null;
  lastTestedAt?: string | null;
  lastTestOk?: boolean | null;
  lastTestError?: string | null;
  recentTests?: Array<{
    testedAt: string;
    ok: boolean;
    errorMessage: string | null;
  }>;
  staleAfterMs?: number | null;
  tickIntervalMs?: number | null;
};

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "soon";
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = ms / (60 * 60 * 1000);
  if (hours < 24) {
    const rounded = Math.round(hours * 10) / 10;
    const display = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    return `${display} hour${rounded === 1 ? "" : "s"}`;
  }
  const days = Math.round((ms / (24 * 60 * 60 * 1000)) * 10) / 10;
  const display = Number.isInteger(days) ? String(days) : days.toFixed(1);
  return `${display} day${days === 1 ? "" : "s"}`;
}

function formatRelativeFuture(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "soon";
  return `in ${formatDuration(ms)}`;
}

function formatUpdatedAt(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString();
}

const QK = ["/api/admin/email-alert-webhook"];
const HISTORY_QK = ["/api/admin/email-alert-webhook/history"];

type HistoryEvent = {
  id: string;
  action:
    | "EMAIL_ALERT_WEBHOOK_CONFIGURED"
    | "EMAIL_ALERT_WEBHOOK_TESTED"
    | "EMAIL_ALERT_WEBHOOK_DELETED"
    | string;
  createdAt: string;
  host: string | null;
  details: Record<string, any>;
  actor: { id: string; name: string | null; email: string | null } | null;
};

type HistoryResponse = { events: HistoryEvent[] };

function actionLabel(action: string): string {
  switch (action) {
    case "EMAIL_ALERT_WEBHOOK_CONFIGURED":
      return "Configured";
    case "EMAIL_ALERT_WEBHOOK_TESTED":
      return "Tested";
    case "EMAIL_ALERT_WEBHOOK_DELETED":
      return "Cleared";
    default:
      return action;
  }
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "just now";
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec} sec ago`;
  const min = Math.round(diffSec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const days = Math.round(hr / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function EmailAlertWebhookPanel() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<ConfigResponse>({ queryKey: QK });

  const [url, setUrl] = useState("");
  const [cooldownMin, setCooldownMin] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [recentTestsOpen, setRecentTestsOpen] = useState(false);

  const {
    data: historyData,
    isLoading: historyLoading,
  } = useQuery<HistoryResponse>({
    queryKey: HISTORY_QK,
    enabled: historyOpen,
  });

  useEffect(() => {
    if (data) {
      setUrl(data.webhookUrl ?? "");
      setCooldownMin(
        typeof data.cooldownMs === "number"
          ? String(Math.round(data.cooldownMs / 60000))
          : "",
      );
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const cooldownMs =
        cooldownMin.trim() === ""
          ? null
          : Math.max(0, Math.floor(Number(cooldownMin) * 60000));
      const res = await apiRequest("PUT", "/api/admin/email-alert-webhook", {
        webhookUrl: url.trim(),
        cooldownMs,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Email alert webhook saved" });
      queryClient.invalidateQueries({ queryKey: QK });
      queryClient.invalidateQueries({ queryKey: HISTORY_QK });
    },
    onError: (err: any) => {
      toast({
        title: "Could not save webhook",
        description: err?.message ?? "Try again.",
        variant: "destructive",
      });
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        "/api/admin/email-alert-webhook/test",
      );
      return res.json();
    },
    onSuccess: (data: { scope?: string }) => {
      toast({
        title: "Test alert sent",
        description:
          data?.scope === "env"
            ? "Delivered to the environment fallback webhook."
            : "Delivered to the configured webhook URL.",
      });
      queryClient.invalidateQueries({ queryKey: QK });
      queryClient.invalidateQueries({ queryKey: HISTORY_QK });
    },
    onError: (err: any) => {
      toast({
        title: "Test alert failed",
        description: err?.message ?? "The webhook did not accept the request.",
        variant: "destructive",
      });
      queryClient.invalidateQueries({ queryKey: QK });
      queryClient.invalidateQueries({ queryKey: HISTORY_QK });
    },
  });

  const clearMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "DELETE",
        "/api/admin/email-alert-webhook",
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Email alert webhook cleared" });
      setUrl("");
      setCooldownMin("");
      queryClient.invalidateQueries({ queryKey: QK });
      queryClient.invalidateQueries({ queryKey: HISTORY_QK });
    },
    onError: (err: any) => {
      toast({
        title: "Could not clear webhook",
        description: err?.message ?? "Try again.",
        variant: "destructive",
      });
    },
  });

  return (
    <div
      className="rounded-lg p-4 mb-5"
      style={{ border: "1px solid var(--lux-border)" }}
      data-testid="panel-email-alert-webhook"
    >
      <div className="flex items-center gap-2 mb-1">
        <Bell
          className="w-4 h-4 shrink-0"
          style={{ color: "var(--lux-text-muted)" }}
        />
        <h4
          className="text-sm font-semibold"
          style={{ color: "var(--lux-text)" }}
        >
          Outgoing email alerts
        </h4>
      </div>
      <p
        className="text-xs mb-3"
        style={{ color: "var(--lux-text-muted)" }}
      >
        Paste a Slack incoming-webhook URL to receive an alert when too many
        outgoing emails fail in an hour. Saving here takes effect immediately —
        no redeploy needed.
        {data?.envFallback && (
          <>
            {" "}
            A global fallback webhook is also configured via environment.
          </>
        )}
      </p>

      {!isLoading && data?.configured && (() => {
        const staleAfterMs = typeof data.staleAfterMs === "number" && data.staleAfterMs > 0
          ? data.staleAfterMs
          : 24 * 60 * 60 * 1000;
        const lastTs = data.lastTestedAt
          ? new Date(data.lastTestedAt).getTime()
          : NaN;
        const failed = data.lastTestOk === false;
        const stale =
          !data.lastTestedAt ||
          !Number.isFinite(lastTs) ||
          Date.now() - lastTs > staleAfterMs;
        if (!failed && !stale) return null;
        const headline = failed
          ? "Last automatic webhook test failed"
          : !data.lastTestedAt
          ? "Webhook has never been auto-tested"
          : "Last webhook test is stale";
        const detail = failed
          ? data.lastTestError
            ? `Slack rejected the test payload: ${data.lastTestError}. Send a manual test below to confirm the URL still works.`
            : "Slack rejected the most recent automatic test. Send a manual test below to confirm the URL still works."
          : "We auto-test this webhook in the background. If you keep seeing this warning, the background job may be stalled or this URL is unreachable.";
        return (
          <div
            className="rounded-md p-3 mb-3 flex items-start gap-2"
            style={{
              border: "1px solid var(--lux-danger, #b91c1c)",
              background: "rgba(185, 28, 28, 0.06)",
            }}
            data-testid="warning-email-alert-webhook-health"
          >
            <AlertTriangle
              className="w-4 h-4 shrink-0 mt-0.5"
              style={{ color: "var(--lux-danger, #b91c1c)" }}
            />
            <div className="text-xs" style={{ color: "var(--lux-text)" }}>
              <div
                className="font-semibold"
                data-testid="text-email-alert-webhook-warning-headline"
              >
                {headline}
              </div>
              <div
                style={{ color: "var(--lux-text-muted)" }}
                data-testid="text-email-alert-webhook-warning-detail"
              >
                {detail}
              </div>
            </div>
          </div>
        );
      })()}

      {isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : (
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Webhook URL</Label>
            <Input
              type="url"
              placeholder="https://hooks.slack.com/services/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              data-testid="input-email-alert-webhook-url"
            />
            {data?.lastTestedAt && (
              <p
                className="text-[11px] mt-1"
                style={{
                  color: data.lastTestOk
                    ? "var(--lux-text-muted)"
                    : "var(--lux-danger, #b91c1c)",
                }}
                data-testid="text-email-alert-webhook-last-test"
              >
                Last test: {formatRelative(data.lastTestedAt)}
                {" — "}
                {data.lastTestOk
                  ? "delivered"
                  : `failed${data.lastTestError ? ` (${data.lastTestError})` : ""}`}
              </p>
            )}
            {typeof data?.tickIntervalMs === "number" && data.tickIntervalMs > 0 && (() => {
              const tickMs = data.tickIntervalMs!;
              const staleMs =
                typeof data.staleAfterMs === "number" && data.staleAfterMs > 0
                  ? data.staleAfterMs
                  : tickMs;
              // Effective per-URL cadence: a webhook is only re-tested
              // once its last check is older than staleMs, and the
              // background job runs every tickMs, so the worst-case
              // gap between auto-tests for any single URL is the
              // larger of the two values.
              const cadenceMs = Math.max(tickMs, staleMs);
              const lastTs = data.lastTestedAt
                ? new Date(data.lastTestedAt).getTime()
                : NaN;
              return (
                <p
                  className="text-[11px] mt-1"
                  style={{ color: "var(--lux-text-muted)" }}
                  data-testid="text-email-alert-webhook-auto-test-schedule"
                >
                  We auto-test this URL about every {formatDuration(cadenceMs)}.
                  {(() => {
                    if (!Number.isFinite(lastTs)) {
                      return (
                        <>
                          {" "}
                          <span data-testid="text-email-alert-webhook-next-check">
                            Next check expected on the next background tick (every {formatDuration(tickMs)}).
                          </span>
                        </>
                      );
                    }
                    // Next eligible re-test is when the row goes
                    // stale; round up to the next tick boundary so
                    // the displayed time matches when the job will
                    // actually pick it up.
                    const eligibleAt = lastTs + staleMs;
                    const ticksSinceLast = Math.max(
                      1,
                      Math.ceil((eligibleAt - lastTs) / tickMs),
                    );
                    const nextDueAt = lastTs + ticksSinceLast * tickMs;
                    const remaining = nextDueAt - Date.now();
                    const when = new Date(nextDueAt);
                    const whenLabel = Number.isNaN(when.getTime())
                      ? "soon"
                      : when.toLocaleString();
                    return (
                      <>
                        {" "}
                        <span data-testid="text-email-alert-webhook-next-check">
                          Next check {formatRelativeFuture(remaining)}
                          {" ("}
                          <span
                            title={whenLabel}
                            data-testid="text-email-alert-webhook-next-check-at"
                          >
                            {whenLabel}
                          </span>
                          {")."}
                        </span>
                      </>
                    );
                  })()}
                </p>
              );
            })()}
            {data?.recentTests && data.recentTests.length > 0 && (
              <div className="mt-1">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-[11px] underline-offset-2 hover:underline"
                  style={{ color: "var(--lux-text-muted)" }}
                  onClick={() => setRecentTestsOpen((v) => !v)}
                  data-testid="button-toggle-email-alert-webhook-recent-tests"
                  aria-expanded={recentTestsOpen}
                >
                  {recentTestsOpen ? (
                    <ChevronDown className="w-3 h-3" />
                  ) : (
                    <ChevronRight className="w-3 h-3" />
                  )}
                  {recentTestsOpen ? "Hide" : "Show"} recent tests (
                  {data.recentTests.length})
                </button>
                {recentTestsOpen && (
                  <ul
                    className="mt-1 space-y-0.5"
                    data-testid="list-email-alert-webhook-recent-tests"
                  >
                    {data.recentTests.map((t, i) => (
                      <li
                        key={`${t.testedAt}-${i}`}
                        className="text-[11px] flex items-start gap-2"
                        style={{
                          color: t.ok
                            ? "var(--lux-text-muted)"
                            : "var(--lux-danger, #b91c1c)",
                        }}
                        data-testid={`row-email-alert-webhook-recent-test-${i}`}
                      >
                        <span
                          className="shrink-0"
                          style={{ color: "var(--lux-text-muted)" }}
                        >
                          {formatRelative(t.testedAt)}
                        </span>
                        <span>—</span>
                        <span>
                          {t.ok
                            ? "delivered"
                            : `failed${t.errorMessage ? ` (${t.errorMessage})` : ""}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
          <div>
            <Label className="text-xs">Cooldown override (minutes)</Label>
            <Input
              type="number"
              min={0}
              max={1440}
              placeholder="Default 15"
              value={cooldownMin}
              onChange={(e) => setCooldownMin(e.target.value)}
              data-testid="input-email-alert-webhook-cooldown"
            />
            <p
              className="text-[11px] mt-1"
              style={{ color: "var(--lux-text-muted)" }}
            >
              Minimum minutes between repeated alerts. Leave blank to use the
              default (15 minutes).
            </p>
          </div>
          {data?.configured && (data?.updatedAt || data?.updatedBy) && (() => {
            const when = formatUpdatedAt(data.updatedAt);
            const who =
              data.updatedBy?.name ||
              data.updatedBy?.email ||
              (data.updatedBy?.id ? `user ${data.updatedBy.id.slice(0, 8)}` : null);
            return (
              <p
                className="text-[11px]"
                style={{ color: "var(--lux-text-muted)" }}
                data-testid="text-email-alert-webhook-updated-by"
              >
                Last updated
                {who ? (
                  <>
                    {" by "}
                    <span
                      style={{ color: "var(--lux-text)" }}
                      data-testid="text-email-alert-webhook-updater"
                      title={data.updatedBy?.email ?? undefined}
                    >
                      {who}
                    </span>
                  </>
                ) : null}
                {when ? (
                  <>
                    {" on "}
                    <span
                      style={{ color: "var(--lux-text)" }}
                      data-testid="text-email-alert-webhook-updated-at"
                    >
                      {when}
                    </span>
                  </>
                ) : null}
                .
              </p>
            );
          })()}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !url.trim()}
              data-testid="button-save-email-alert-webhook"
            >
              {saveMutation.isPending ? "Saving..." : "Save webhook"}
            </Button>
            {(data?.configured || data?.envFallback) && (() => {
              const dirty =
                url.trim() !== (data?.webhookUrl ?? "") ||
                cooldownMin.trim() !==
                  (typeof data?.cooldownMs === "number"
                    ? String(Math.round(data.cooldownMs / 60000))
                    : "");
              return (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => testMutation.mutate()}
                  disabled={testMutation.isPending || dirty}
                  title={
                    dirty
                      ? "Save your changes first — test sends to the saved webhook URL."
                      : "Sends a test payload to the saved webhook URL."
                  }
                  data-testid="button-test-email-alert-webhook"
                >
                  <Send className="w-3.5 h-3.5 mr-1.5" />
                  {testMutation.isPending ? "Sending..." : "Send test alert"}
                </Button>
              );
            })()}
            {data?.configured && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => clearMutation.mutate()}
                disabled={clearMutation.isPending}
                data-testid="button-clear-email-alert-webhook"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                {clearMutation.isPending ? "Clearing..." : "Clear"}
              </Button>
            )}
          </div>
          <div className="pt-2">
            <button
              type="button"
              onClick={() => setHistoryOpen((v) => !v)}
              className="flex items-center gap-1 text-xs"
              style={{ color: "var(--lux-text-muted)" }}
              data-testid="button-toggle-email-alert-webhook-history"
              aria-expanded={historyOpen}
            >
              {historyOpen ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
              Change history
            </button>
            {historyOpen && (
              <div
                className="mt-2"
                data-testid="section-email-alert-webhook-history"
              >
                {historyLoading ? (
                  <Skeleton className="h-16 w-full" />
                ) : !historyData || historyData.events.length === 0 ? (
                  <p
                    className="text-[11px]"
                    style={{ color: "var(--lux-text-muted)" }}
                    data-testid="text-email-alert-webhook-history-empty"
                  >
                    No changes recorded yet.
                  </p>
                ) : (
                  <ul
                    className="space-y-1.5"
                    data-testid="list-email-alert-webhook-history"
                  >
                    {historyData.events.map((ev) => {
                      const who =
                        ev.actor?.name ||
                        ev.actor?.email ||
                        (ev.actor?.id
                          ? `user ${ev.actor.id.slice(0, 8)}`
                          : "system");
                      const when = formatUpdatedAt(ev.createdAt) ?? "";
                      return (
                        <li
                          key={ev.id}
                          className="text-[11px] flex flex-wrap gap-x-2"
                          style={{ color: "var(--lux-text-muted)" }}
                          data-testid={`row-email-alert-webhook-history-${ev.id}`}
                        >
                          <span
                            style={{ color: "var(--lux-text)" }}
                            data-testid={`text-history-action-${ev.id}`}
                          >
                            {actionLabel(ev.action)}
                          </span>
                          {ev.host && (
                            <span data-testid={`text-history-host-${ev.id}`}>
                              host: {ev.host}
                            </span>
                          )}
                          <span data-testid={`text-history-actor-${ev.id}`}>
                            by{" "}
                            <span
                              style={{ color: "var(--lux-text)" }}
                              title={ev.actor?.email ?? undefined}
                            >
                              {who}
                            </span>
                          </span>
                          <span data-testid={`text-history-when-${ev.id}`}>
                            {when}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
