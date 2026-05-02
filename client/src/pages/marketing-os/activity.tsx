/**
 * Sprint 2f — Marketing OS Activity firehose (/marketing/activity).
 *
 * Brand-scoped read view of every contact-activity row for the active
 * brand. Hits GET /api/marketing/activities?brandId=...&types=...
 * &from=...&to=...&limit=... so the brandId is REQUIRED (R6) and the
 * date window is capped server-side at 365 days (R5).
 *
 * The brand chip is read-only — switching brands happens via the global
 * brand switcher in the topbar. This keeps the firehose URL simple and
 * avoids two competing sources of truth for "which brand am I in".
 *
 * Each row shows:
 *   • activity-type chip (color-coded label + icon)
 *   • contact name (links to /marketing/contacts/:id)
 *   • actor name (or "system" when actorId is null)
 *   • payload preview, expandable
 *   • Delete (admin) wrapped in an AlertDialog (R10)
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Trash2, Activity as ActivityIcon } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useBrand } from "@/hooks/useBrand";
import { isMarketingOsEnabled } from "@/lib/featureFlags";
import { Card, CardContent } from "@/components/ui/card";
import { SectionCard } from "@/components/marketing-os/premium/section-card";
import { Filter as FilterIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { MarketingOsTabs } from "@/components/marketing-os/marketing-os-tabs";
import { BrandBadge } from "@/components/marketing-os/brand-badge";
import { ACTIVITY_TYPE_LABELS } from "./contact-detail";
import type { ContactActivity } from "@shared/schema";

type ActivityRow = ContactActivity & {
  contactName: string | null;
  actorName: string | null;
};

const TYPE_FILTER_OPTIONS = [
  "", // all
  "note", "call", "meeting", "email_manual",
  "contact_created", "tag_added", "tag_removed",
  "segment_added", "segment_removed", "imported",
] as const;

export default function ActivityFirehosePage() {
  const flagOn = isMarketingOsEnabled();
  const { activeBrand } = useBrand();
  const { toast } = useToast();

  const [typeFilter, setTypeFilter] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [limit, setLimit] = useState<number>(100);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<string | null>(null);

  const brandId = activeBrand?.id ?? null;

  const queryKey = useMemo(
    () => ["/api/marketing/activities", brandId, typeFilter, from, to, limit],
    [brandId, typeFilter, from, to, limit],
  );

  const { data: rows = [], isLoading, error } = useQuery<ActivityRow[]>({
    queryKey,
    enabled: flagOn && !!brandId,
    queryFn: async () => {
      const sp = new URLSearchParams();
      sp.set("brandId", brandId!);
      if (typeFilter) sp.set("types", typeFilter);
      if (from) sp.set("from", new Date(from).toISOString());
      if (to)   sp.set("to",   new Date(to).toISOString());
      sp.set("limit", String(limit));
      const res = await fetch(`/api/marketing/activities?${sp.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
  });

  const onDelete = async (id: string) => {
    setDeleting(id);
    try {
      await apiRequest("DELETE", `/api/marketing/activities/${id}`);
      await queryClient.invalidateQueries({ queryKey: ["/api/marketing/activities"] });
      toast({ title: "Activity deleted" });
    } catch (e: unknown) {
      toast({
        title: "Delete failed",
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      });
    } finally {
      setDeleting(null);
    }
  };

  if (!flagOn) {
    return (
      <div className="p-10 text-center text-sm" style={{ color: "var(--lux-text-muted)" }} data-testid="status-flag-off">
        Marketing is available on the Business plan. Upgrade anytime from Settings → Plan.
      </div>
    );
  }

  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpanded(next);
  };

  return (
    <div className="px-6 lg:px-8 xl:px-10 py-6 max-w-6xl mx-auto" data-testid="page-marketing-activity">
      <MarketingOsTabs />

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold" style={{ color: "var(--lux-text)" }} data-testid="text-page-title">
          Activity
        </h1>
        <BrandBadge />
      </div>

      <SectionCard
        icon={<FilterIcon className="w-4 h-4" />}
        title="Filters"
        subtitle="Narrow the activity firehose"
        className="mb-4"
      >
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
          <div>
            <Label htmlFor="f-type">Type</Label>
            <Select value={typeFilter || "__all__"} onValueChange={(v) => setTypeFilter(v === "__all__" ? "" : v)}>
              <SelectTrigger data-testid="select-type-filter"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__" data-testid="option-type-all">All types</SelectItem>
                {TYPE_FILTER_OPTIONS.filter(Boolean).map((t) => (
                  <SelectItem key={t} value={t} data-testid={`option-type-${t}`}>
                    {ACTIVITY_TYPE_LABELS[t]?.label ?? t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="f-from">From</Label>
            <Input id="f-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="input-from" />
          </div>
          <div>
            <Label htmlFor="f-to">To</Label>
            <Input id="f-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} data-testid="input-to" />
          </div>
          <div>
            <Label htmlFor="f-limit">Limit</Label>
            <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
              <SelectTrigger data-testid="select-limit"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[25, 50, 100, 200].map((n) => (
                  <SelectItem key={n} value={String(n)} data-testid={`option-limit-${n}`}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </SectionCard>

      {!brandId && (
        <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
          <CardContent className="p-8 text-center text-sm" style={{ color: "var(--lux-text-muted)" }} data-testid="status-no-brand">
            Select a brand from the topbar to view activity.
          </CardContent>
        </Card>
      )}

      {brandId && isLoading && (
        <div className="p-8 text-center text-sm" style={{ color: "var(--lux-text-muted)" }} data-testid="status-loading">
          Loading activity…
        </div>
      )}

      {brandId && error && (
        <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
          <CardContent className="p-6 text-center text-sm" style={{ color: "var(--lux-text-muted)" }} data-testid="status-error">
            {error instanceof Error ? error.message : "Failed to load activity."}
          </CardContent>
        </Card>
      )}

      {brandId && !isLoading && !error && rows.length === 0 && (
        <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
          <CardContent className="p-8 text-center text-sm" style={{ color: "var(--lux-text-muted)" }} data-testid="empty-state-firehose">
            No activity yet for this brand. Log a note from a contact's page or run an import.
          </CardContent>
        </Card>
      )}

      {brandId && rows.length > 0 && (
        <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
          <CardContent className="p-4">
            <ol className="space-y-2" data-testid="list-firehose">
              {rows.map((a) => {
                const meta = ACTIVITY_TYPE_LABELS[a.type] ?? { label: a.type, icon: ActivityIcon };
                const Icon = meta.icon;
                const payload = (a.payload ?? {}) as Record<string, unknown>;
                const hasPayload = Object.keys(payload).length > 0;
                const isOpen = expanded.has(a.id);
                return (
                  <li key={a.id} className="flex gap-3 py-2 border-b" style={{ borderColor: "var(--lux-border)" }} data-testid={`firehose-row-${a.id}`}>
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                      style={{ background: "var(--lux-bg)", border: "1px solid var(--lux-border)" }}
                    >
                      <Icon className="w-3.5 h-3.5" style={{ color: "var(--lux-text-muted)" }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap text-sm">
                        <span
                          className="px-1.5 py-0.5 rounded text-[11px]"
                          style={{ background: "var(--lux-bg)", border: "1px solid var(--lux-border)", color: "var(--lux-text)" }}
                          data-testid={`chip-type-${a.id}`}
                        >
                          {meta.label}
                        </span>
                        {a.contactName && a.prospectId && (
                          <Link
                            href={`/marketing/contacts/${a.prospectId}`}
                            className="font-medium underline"
                            style={{ color: "var(--lux-text)" }}
                            data-testid={`link-contact-${a.id}`}
                          >
                            {a.contactName}
                          </Link>
                        )}
                        <span style={{ color: "var(--lux-text-muted)" }} data-testid={`text-actor-${a.id}`}>
                          · {a.actorName ?? "system"}
                        </span>
                        <span className="ml-auto text-[11px]" style={{ color: "var(--lux-text-muted)" }} data-testid={`text-time-${a.id}`}>
                          {new Date(a.occurredAt ?? a.createdAt).toLocaleString()}
                        </span>
                      </div>
                      {hasPayload && (
                        <button
                          type="button"
                          onClick={() => toggle(a.id)}
                          className="text-[11px] inline-flex items-center gap-1 mt-1"
                          style={{ color: "var(--lux-text-muted)" }}
                          data-testid={`button-toggle-payload-${a.id}`}
                        >
                          {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                          {isOpen ? "Hide details" : "Show details"}
                        </button>
                      )}
                      {isOpen && hasPayload && (
                        <pre
                          className="mt-1 p-2 rounded text-[11px] overflow-x-auto whitespace-pre-wrap"
                          style={{ background: "var(--lux-bg)", border: "1px solid var(--lux-border)", color: "var(--lux-text)" }}
                          data-testid={`payload-${a.id}`}
                        >
                          {JSON.stringify(payload, null, 2)}
                        </pre>
                      )}
                      <div className="mt-1">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={deleting === a.id}
                              className="h-6 px-2 text-[11px]"
                              data-testid={`button-delete-${a.id}`}
                            >
                              <Trash2 className="w-3 h-3 mr-1" />
                              {deleting === a.id ? "Deleting…" : "Delete"}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent data-testid="dialog-confirm-delete">
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete this activity?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This permanently removes the entry from the firehose and the contact's timeline. This cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => onDelete(a.id)}
                                data-testid="button-confirm-delete"
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
