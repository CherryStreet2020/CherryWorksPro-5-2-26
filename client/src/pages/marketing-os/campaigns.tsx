/**
 * Sprint 2n — Marketing OS Campaign builder (/marketing/campaigns).
 *
 * Lists all campaign drafts for the active brand, and lets a planner
 * compose a single email — subject, sender, body, reply-to, send time —
 * with the premium EmailPreview rendered live alongside the form.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Plus, Mail, Pencil, Trash2, AlertTriangle, Send } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useBrand } from "@/hooks/useBrand";
import { isMarketingOsEnabled } from "@/lib/featureFlags";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { EmailPreview } from "@/components/marketing-os/premium/email-preview";
import { MarketingOsTabs } from "@/components/marketing-os/marketing-os-tabs";
import { BrandBadge } from "@/components/marketing-os/brand-badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { MarketingCampaign, ContactSegment, CampaignAudienceType } from "@shared/schema";

function fmt(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const t = typeof d === "string" ? new Date(d) : d;
  return t.toLocaleString();
}

function toDatetimeLocal(d: string | Date | null | undefined): string {
  if (!d) return "";
  const t = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(t.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
}

type FormState = {
  name: string;
  subject: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  body: string;
  sendAt: string;
  audienceType: CampaignAudienceType;
  audienceSegmentId: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  subject: "",
  fromName: "",
  fromEmail: "",
  replyTo: "",
  body: "",
  sendAt: "",
  audienceType: "all",
  audienceSegmentId: "",
};

export default function CampaignsPage() {
  const flagOn = isMarketingOsEnabled();
  const { activeBrand, brands, setActiveBrand } = useBrand();
  const brandId = activeBrand?.id ?? null;
  const { toast } = useToast();

  const { data: campaigns = [], isLoading } = useQuery<MarketingCampaign[]>({
    queryKey: ["/api/marketing/campaigns", brandId],
    enabled: flagOn && !!brandId,
    queryFn: async () => {
      const res = await fetch(`/api/marketing/campaigns?brandId=${encodeURIComponent(brandId!)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  // Task #234 — Saved segments for the audience picker. Loaded for the
  // active brand so the picker only shows segments the campaign can target.
  const { data: segments = [] } = useQuery<ContactSegment[]>({
    queryKey: ["/api/marketing/segments", brandId],
    enabled: flagOn && !!brandId,
    queryFn: async () => {
      const res = await fetch(
        `/api/marketing/segments?brandId=${encodeURIComponent(brandId!)}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<MarketingCampaign | null>(null);
  const [failuresFor, setFailuresFor] = useState<MarketingCampaign | null>(null);
  // Sprint 2p — Send-now confirmation dialog target.
  const [sendingNow, setSendingNow] = useState<MarketingCampaign | null>(null);
  const [sendBusy, setSendBusy] = useState(false);

  const editingCampaign = useMemo(
    () => campaigns.find((c) => c.id === editingId) ?? null,
    [campaigns, editingId],
  );

  // Hydrate form when entering edit mode or starting a new draft.
  useEffect(() => {
    if (editingCampaign) {
      setForm({
        name: editingCampaign.name,
        subject: editingCampaign.subject ?? "",
        fromName: editingCampaign.fromName ?? "",
        fromEmail: editingCampaign.fromEmail ?? "",
        replyTo: editingCampaign.replyTo ?? "",
        body: editingCampaign.body ?? "",
        sendAt: toDatetimeLocal(editingCampaign.sendAt),
        audienceType: (editingCampaign.audienceType as CampaignAudienceType) ?? "all",
        audienceSegmentId: editingCampaign.audienceSegmentId ?? "",
      });
    } else if (creating) {
      setForm({
        ...EMPTY_FORM,
        fromName: activeBrand?.fromName ?? "",
        fromEmail: activeBrand?.fromEmail ?? "",
        replyTo: activeBrand?.replyTo ?? "",
      });
    }
  }, [editingCampaign, creating, activeBrand]);

  if (!flagOn) {
    return (
      <div className="p-10 text-center text-sm" style={{ color: "var(--lux-text-muted)" }} data-testid="status-flag-off">
        Marketing is available on the Business plan. Upgrade anytime from Settings → Plan.
      </div>
    );
  }

  if (brands && brands.length === 0) {
    return (
      <div className="px-6 lg:px-8 xl:px-10 py-6 max-w-3xl mx-auto">
        <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
          <CardContent className="p-12 text-center" data-testid="empty-state-no-brands">
            <Mail className="w-10 h-10 mx-auto mb-4" style={{ color: "var(--lux-text-muted)" }} />
            <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>Create a brand first</h2>
            <p className="text-sm mb-6" style={{ color: "var(--lux-text-muted)" }}>
              Campaigns are organized by brand. Create at least one brand before drafting a campaign.
            </p>
            <Button asChild data-testid="link-create-brand">
              <Link href="/settings/brands">Go to Brands</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (brands && brands.length > 0 && !activeBrand) {
    return (
      <div className="px-6 lg:px-8 xl:px-10 py-6 max-w-3xl mx-auto">
        <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
          <CardContent className="p-12 text-center" data-testid="empty-state-select-brand">
            <Mail className="w-10 h-10 mx-auto mb-4" style={{ color: "var(--lux-text-muted)" }} />
            <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>Select a brand to view campaigns</h2>
            <div className="flex flex-wrap justify-center gap-2">
              {brands.map((b) => (
                <Button key={b.id} variant="outline" onClick={() => setActiveBrand(b.id)} data-testid={`button-pick-brand-${b.id}`}>
                  {b.name}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isEditingMode = creating || !!editingCampaign;

  const closeEditor = () => {
    setEditingId(null);
    setCreating(false);
    setForm(EMPTY_FORM);
  };

  const submit = async () => {
    const trimmedName = form.name.trim();
    if (!trimmedName) {
      toast({ title: "Campaign name is required", variant: "destructive" });
      return;
    }
    if (form.audienceType === "segment" && !form.audienceSegmentId) {
      toast({ title: "Pick a segment for this campaign's audience", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const sendAtIso = form.sendAt ? new Date(form.sendAt).toISOString() : null;
      const payload = {
        name: trimmedName,
        subject: form.subject,
        fromName: form.fromName,
        fromEmail: form.fromEmail,
        replyTo: form.replyTo,
        body: form.body,
        sendAt: sendAtIso,
        audienceType: form.audienceType,
        audienceSegmentId: form.audienceType === "segment" ? form.audienceSegmentId : null,
      };
      if (creating) {
        await apiRequest("POST", "/api/marketing/campaigns", { brandId, ...payload });
      } else if (editingCampaign) {
        await apiRequest("PATCH", `/api/marketing/campaigns/${editingCampaign.id}`, payload);
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/marketing/campaigns"] });
      toast({ title: creating ? "Campaign created" : "Campaign saved" });
      closeEditor();
    } catch (e: unknown) {
      toast({
        title: creating ? "Failed to create campaign" : "Failed to save campaign",
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-6 lg:px-8 xl:px-10 py-6 max-w-7xl mx-auto">
      <MarketingOsTabs />

      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--lux-text)" }} data-testid="text-page-title">
            Campaigns
          </h1>
          <div className="mt-1">
            <BrandBadge />
          </div>
        </div>
        {!isEditingMode && (
          <Button onClick={() => { setCreating(true); setEditingId(null); }} data-testid="button-new-campaign">
            <Plus className="w-4 h-4 mr-1.5" />
            New Campaign
          </Button>
        )}
      </div>

      {isEditingMode ? (
        <CampaignEditor
          form={form}
          setForm={setForm}
          onCancel={closeEditor}
          onSubmit={submit}
          busy={busy}
          mode={creating ? "create" : "edit"}
          segments={segments}
          brandId={brandId}
        />
      ) : (
        <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
          <CardContent className="p-0 overflow-x-auto">
            {isLoading ? (
              <div className="p-8 text-sm" style={{ color: "var(--lux-text-muted)" }} data-testid="status-loading">Loading campaigns…</div>
            ) : campaigns.length === 0 ? (
              <div className="text-center py-16" data-testid="empty-state-campaigns">
                <Mail className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--lux-text-muted)" }} />
                <p className="text-base mb-1" style={{ color: "var(--lux-text)" }}>No campaigns yet</p>
                <p className="text-sm mb-4" style={{ color: "var(--lux-text-muted)" }}>
                  Draft a single-send email and watch a live preview render alongside.
                </p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead style={{ borderBottom: "1px solid var(--lux-border)" }}>
                  <tr>
                    <th className="px-4 py-2 text-left font-medium" style={{ color: "var(--lux-text-muted)" }}>Name</th>
                    <th className="px-4 py-2 text-left font-medium" style={{ color: "var(--lux-text-muted)" }}>Subject</th>
                    <th className="px-4 py-2 text-left font-medium" style={{ color: "var(--lux-text-muted)" }}>From</th>
                    <th className="px-4 py-2 text-left font-medium" style={{ color: "var(--lux-text-muted)" }}>Audience</th>
                    <th className="px-4 py-2 text-left font-medium" style={{ color: "var(--lux-text-muted)" }}>Send time</th>
                    <th className="px-4 py-2 text-left font-medium" style={{ color: "var(--lux-text-muted)" }}>Updated</th>
                    <th className="px-4 py-2 w-32 text-right font-medium" style={{ color: "var(--lux-text-muted)" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c) => (
                    <tr key={c.id} className="hover:bg-[var(--lux-bg)] transition-colors" style={{ borderBottom: "1px solid var(--lux-border)" }} data-testid={`row-campaign-${c.id}`}>
                      <td className="px-4 py-2 font-medium" style={{ color: "var(--lux-text)" }} data-testid={`text-campaign-name-${c.id}`}>{c.name}</td>
                      <td className="px-4 py-2" style={{ color: "var(--lux-text)" }} data-testid={`text-campaign-subject-${c.id}`}>{c.subject || "—"}</td>
                      <td className="px-4 py-2" style={{ color: "var(--lux-text-muted)" }}>
                        {c.fromName || c.fromEmail || "—"}
                      </td>
                      <td
                        className="px-4 py-2"
                        style={{ color: "var(--lux-text-muted)" }}
                        data-testid={`text-campaign-audience-${c.id}`}
                      >
                        {c.audienceType === "segment"
                          ? (segments.find((s) => s.id === c.audienceSegmentId)?.name ?? "Segment (deleted)")
                          : "All brand contacts"}
                      </td>
                      <td className="px-4 py-2" style={{ color: "var(--lux-text-muted)" }} data-testid={`text-campaign-sendat-${c.id}`}>{fmt(c.sendAt)}</td>
                      <td className="px-4 py-2" style={{ color: "var(--lux-text-muted)" }}>{fmt(c.updatedAt)}</td>
                      <td className="px-4 py-2 text-right">
                        <div className="inline-flex gap-1">
                          {!c.sentAt && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setSendingNow(c)}
                              title="Send now"
                              data-testid={`button-send-now-campaign-${c.id}`}
                            >
                              <Send className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => { setEditingId(c.id); setCreating(false); }} data-testid={`button-edit-campaign-${c.id}`}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setFailuresFor(c)}
                            title="View recipients who did not receive this campaign"
                            data-testid={`button-failures-campaign-${c.id}`}
                          >
                            <AlertTriangle className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setDeleting(c)} data-testid={`button-delete-campaign-${c.id}`}>
                            <Trash2 className="w-3.5 h-3.5" style={{ color: "var(--mc-red)" }} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}

      {deleting && (
        <DeleteCampaignDialog campaign={deleting} brandId={brandId} onClose={() => setDeleting(null)} />
      )}

      <CampaignFailuresDialog
        campaign={failuresFor}
        onClose={() => setFailuresFor(null)}
      />

      <SendNowDialog
        campaign={sendingNow}
        busy={sendBusy}
        onCancel={() => { if (!sendBusy) setSendingNow(null); }}
        onConfirm={async () => {
          if (!sendingNow) return;
          setSendBusy(true);
          try {
            const res = await apiRequest(
              "POST",
              `/api/marketing/campaigns/${sendingNow.id}/send-now`,
            );
            const body = (await res.json()) as {
              sentCount: number;
              failedCount: number;
            };
            await queryClient.invalidateQueries({
              queryKey: ["/api/marketing/campaigns"],
            });
            toast({
              title: `Sent to ${body.sentCount} recipient${body.sentCount === 1 ? "" : "s"}`,
              description:
                body.failedCount > 0
                  ? `${body.failedCount} failed — open the failures dialog for details.`
                  : undefined,
            });
            setSendingNow(null);
          } catch (err: unknown) {
            toast({
              title: "Failed to send campaign",
              description: err instanceof Error ? err.message : "",
              variant: "destructive",
            });
          } finally {
            setSendBusy(false);
          }
        }}
      />
    </div>
  );
}

// Sprint 2p — Send Now confirmation dialog. Fetches the live audience
// preview for the campaign's brand + audience selection so admins see
// the exact recipient count (and the org's large-audience warning)
// before dispatching. Confirm button stays disabled until the count
// resolves.
function SendNowDialog({
  campaign,
  busy,
  onCancel,
  onConfirm,
}: {
  campaign: MarketingCampaign | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const open = !!campaign;
  const previewParamsReady =
    !!campaign &&
    (campaign.audienceType === "all" ||
      (campaign.audienceType === "segment" && !!campaign.audienceSegmentId));

  const { data: preview, isFetching: previewLoading } = useQuery<{
    count: number;
    threshold: number;
    isLarge: boolean;
  }>({
    queryKey: [
      "/api/marketing/campaigns/audience-preview",
      campaign?.brandId ?? null,
      campaign?.audienceType ?? null,
      campaign?.audienceType === "segment" ? campaign.audienceSegmentId : null,
    ],
    enabled: open && previewParamsReady,
    queryFn: async () => {
      const params = new URLSearchParams({
        brandId: campaign!.brandId,
        audienceType: campaign!.audienceType,
      });
      if (campaign!.audienceType === "segment" && campaign!.audienceSegmentId) {
        params.set("segmentId", campaign!.audienceSegmentId);
      }
      const res = await fetch(
        `/api/marketing/campaigns/audience-preview?${params.toString()}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  const audienceCount = preview?.count;
  const countLoaded = audienceCount !== undefined;
  const recipientWord =
    audienceCount === 1 ? "recipient" : "recipients";

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <AlertDialogContent data-testid="dialog-send-now-campaign">
        <AlertDialogHeader>
          <AlertDialogTitle data-testid="text-send-now-title">
            {countLoaded
              ? `Send '${campaign?.name}' to ${audienceCount} ${recipientWord} now?`
              : `Send '${campaign?.name}' now?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            This dispatches the campaign immediately. You can't undo a send.
            {preview?.isLarge && (
              <span
                className="block mt-2 text-amber-700 dark:text-amber-400"
                data-testid="text-send-now-large-warning"
              >
                Heads up — this audience is larger than your org's threshold of{" "}
                {preview.threshold}. Double-check the segment before sending.
              </span>
            )}
            {!countLoaded && previewLoading && (
              <span
                className="block mt-2 text-xs text-muted-foreground"
                data-testid="status-send-now-loading-count"
              >
                Loading recipient count…
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            disabled={busy}
            data-testid="button-cancel-send-now"
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={busy || !countLoaded}
            data-testid="button-confirm-send-now"
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
          >
            {busy ? "Sending…" : "Send now"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

interface CampaignFailureRow {
  contactId: string | null;
  recipientEmail: string | null;
  contactFirstName: string | null;
  contactLastName: string | null;
  attemptNumber: number;
  status: "failed" | "permanent_failure";
  errorCode: string | null;
  errorMessage: string | null;
  attemptedAt: string;
  nextRetryAt: string | null;
}

function CampaignFailuresDialog({
  campaign,
  onClose,
}: {
  campaign: MarketingCampaign | null;
  onClose: () => void;
}) {
  const open = !!campaign;
  const { data: rows = [], isLoading } = useQuery<CampaignFailureRow[]>({
    queryKey: ["/api/marketing/campaigns", campaign?.id, "failures"],
    enabled: open && !!campaign?.id,
    queryFn: async () => {
      const res = await fetch(`/api/marketing/campaigns/${campaign!.id}/failures`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl" data-testid="dialog-campaign-failures">
        <DialogHeader>
          <DialogTitle>Recipients who didn't receive this campaign</DialogTitle>
          <DialogDescription>
            {campaign?.name}. Permanent failures are recipients we gave up on after retries
            were exhausted or the address was rejected. Pending retries are still being
            attempted automatically.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="text-sm text-muted-foreground" data-testid="status-failures-loading">
            Loading failures…
          </div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground" data-testid="status-no-failures">
            Every recipient received this campaign.
          </div>
        ) : (
          <div className="max-h-[480px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-2 py-2">Recipient</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Attempts</th>
                  <th className="px-2 py-2">Reason</th>
                  <th className="px-2 py-2">Next retry</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const name = [r.contactFirstName, r.contactLastName]
                    .filter(Boolean)
                    .join(" ") || r.recipientEmail || "Unknown";
                  return (
                    <tr key={`${r.contactId ?? "null"}-${i}`} className="border-t" data-testid={`row-failure-${r.contactId ?? i}`}>
                      <td className="px-2 py-2">
                        <div className="font-medium" data-testid={`text-failure-name-${i}`}>{name}</div>
                        {r.recipientEmail && (
                          <div className="text-xs text-muted-foreground">{r.recipientEmail}</div>
                        )}
                      </td>
                      <td className="px-2 py-2" data-testid={`text-failure-status-${i}`}>
                        {r.status === "permanent_failure" ? "Gave up" : "Pending retry"}
                      </td>
                      <td className="px-2 py-2">{r.attemptNumber}</td>
                      <td className="px-2 py-2 text-xs">
                        <code>{r.errorCode ?? "—"}</code>
                      </td>
                      <td className="px-2 py-2 text-xs text-muted-foreground">
                        {r.nextRetryAt ? new Date(r.nextRetryAt).toLocaleString() : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CampaignEditor({
  form, setForm, onCancel, onSubmit, busy, mode, segments, brandId,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  onCancel: () => void;
  onSubmit: () => void;
  busy: boolean;
  mode: "create" | "edit";
  segments: ContactSegment[];
  brandId: string | null;
}) {
  const update = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm({ ...form, [k]: v });

  // Task #264 — Live recipient-count preview that refetches when the
  // brand, audience type, or selected segment changes. Wait for a
  // segment to be picked before issuing a request in 'segment' mode.
  const previewEnabled =
    !!brandId &&
    (form.audienceType === "all" ||
      (form.audienceType === "segment" && !!form.audienceSegmentId));
  const { data: audiencePreview, isFetching: previewFetching } = useQuery<{
    count: number;
    threshold: number;
    isLarge: boolean;
  }>({
    queryKey: [
      "/api/marketing/campaigns/audience-preview",
      brandId,
      form.audienceType,
      form.audienceType === "segment" ? form.audienceSegmentId : null,
    ],
    enabled: previewEnabled,
    queryFn: async () => {
      const params = new URLSearchParams({
        brandId: brandId!,
        audienceType: form.audienceType,
      });
      if (form.audienceType === "segment" && form.audienceSegmentId) {
        params.set("segmentId", form.audienceSegmentId);
      }
      const res = await fetch(
        `/api/marketing/campaigns/audience-preview?${params.toString()}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  const previewBody = form.body.trim() ||
    "Start typing your message and it will appear here, just like an inbox preview.";

  return (
    <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }} data-testid={mode === "create" ? "form-create-campaign" : "form-edit-campaign"}>
      <CardContent className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6">
          <div className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--lux-text-muted)" }}>
              {mode === "create" ? "New campaign" : "Edit campaign"}
            </h2>
            <div>
              <Label htmlFor="campaign-name">Campaign name *</Label>
              <Input
                id="campaign-name"
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
                maxLength={200}
                placeholder="Q2 product launch"
                data-testid="input-campaign-name"
              />
            </div>
            <div>
              <Label htmlFor="campaign-subject">Subject line</Label>
              <Input
                id="campaign-subject"
                value={form.subject}
                onChange={(e) => update("subject", e.target.value)}
                maxLength={300}
                placeholder="Quick check-in 👋"
                data-testid="input-campaign-subject"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="campaign-from-name">From name</Label>
                <Input
                  id="campaign-from-name"
                  value={form.fromName}
                  onChange={(e) => update("fromName", e.target.value)}
                  maxLength={200}
                  placeholder="Mira from CherryWorks"
                  data-testid="input-campaign-from-name"
                />
              </div>
              <div>
                <Label htmlFor="campaign-from-email">From email</Label>
                <Input
                  id="campaign-from-email"
                  type="email"
                  value={form.fromEmail}
                  onChange={(e) => update("fromEmail", e.target.value)}
                  maxLength={320}
                  placeholder="mira@cherryworks.app"
                  data-testid="input-campaign-from-email"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="campaign-reply-to">Reply-to</Label>
              <Input
                id="campaign-reply-to"
                type="email"
                value={form.replyTo}
                onChange={(e) => update("replyTo", e.target.value)}
                maxLength={320}
                placeholder="hello@cherryworks.app"
                data-testid="input-campaign-reply-to"
              />
            </div>
            <div>
              <Label htmlFor="campaign-send-at">Send time</Label>
              <Input
                id="campaign-send-at"
                type="datetime-local"
                value={form.sendAt}
                onChange={(e) => update("sendAt", e.target.value)}
                data-testid="input-campaign-send-at"
              />
            </div>
            <div className="space-y-2">
              <Label>Audience</Label>
              <RadioGroup
                value={form.audienceType}
                onValueChange={(v) => {
                  const next = v as CampaignAudienceType;
                  setForm({
                    ...form,
                    audienceType: next,
                    audienceSegmentId: next === "all" ? "" : form.audienceSegmentId,
                  });
                }}
                className="flex flex-col gap-2"
                data-testid="radiogroup-campaign-audience"
              >
                <div className="flex items-start gap-2">
                  <RadioGroupItem value="all" id="audience-all" data-testid="radio-audience-all" />
                  <div className="-mt-0.5">
                    <Label htmlFor="audience-all" className="font-medium">All brand contacts</Label>
                    <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
                      Send to every undeleted contact in this brand.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <RadioGroupItem value="segment" id="audience-segment" data-testid="radio-audience-segment" />
                  <div className="-mt-0.5 flex-1">
                    <Label htmlFor="audience-segment" className="font-medium">A saved segment</Label>
                    <p className="text-xs mb-2" style={{ color: "var(--lux-text-muted)" }}>
                      Resolved live at send time, so segment edits take effect.
                    </p>
                    {form.audienceType === "segment" && (
                      segments.length === 0 ? (
                        <p
                          className="text-xs"
                          style={{ color: "var(--mc-red)" }}
                          data-testid="status-no-segments"
                        >
                          No segments yet for this brand. Create one in the Segments tab first.
                        </p>
                      ) : (
                        <Select
                          value={form.audienceSegmentId || undefined}
                          onValueChange={(v) => update("audienceSegmentId", v)}
                        >
                          <SelectTrigger data-testid="select-audience-segment">
                            <SelectValue placeholder="Choose a segment…" />
                          </SelectTrigger>
                          <SelectContent>
                            {segments.map((s) => (
                              <SelectItem key={s.id} value={s.id} data-testid={`option-segment-${s.id}`}>
                                {s.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )
                    )}
                  </div>
                </div>
              </RadioGroup>
              <div
                className="text-xs mt-2"
                style={{ color: "var(--lux-text-muted)" }}
                data-testid="text-audience-preview"
              >
                {previewEnabled
                  ? audiencePreview === undefined
                    ? previewFetching
                      ? "Calculating recipients…"
                      : "Recipient count unavailable"
                    : `≈ ${audiencePreview.count.toLocaleString()} recipient${audiencePreview.count === 1 ? "" : "s"}`
                  : form.audienceType === "segment"
                    ? "Pick a segment to see the recipient count."
                    : ""}
              </div>
              {/* Task #294 — Soft warning when the audience is very large
                  so admins double-check before sending an accidental blast. */}
              {previewEnabled && audiencePreview?.isLarge && (
                <div
                  className="mt-2 flex items-start gap-2 rounded-md border px-3 py-2 text-xs"
                  style={{
                    background: "rgba(245, 158, 11, 0.08)",
                    borderColor: "rgba(245, 158, 11, 0.4)",
                    color: "rgb(146, 64, 14)",
                  }}
                  role="alert"
                  data-testid="warning-audience-large"
                >
                  <AlertTriangle
                    className="w-4 h-4 mt-0.5 flex-shrink-0"
                    style={{ color: "rgb(217, 119, 6)" }}
                    aria-hidden="true"
                  />
                  <span>
                    This will email{" "}
                    <strong data-testid="text-warning-large-count">
                      {audiencePreview.count.toLocaleString()}
                    </strong>{" "}
                    people — double-check before scheduling.
                  </span>
                </div>
              )}
            </div>
            <div>
              <Label htmlFor="campaign-body">Body</Label>
              <Textarea
                id="campaign-body"
                value={form.body}
                onChange={(e) => update("body", e.target.value)}
                rows={8}
                maxLength={50_000}
                placeholder="Just wanted to follow up on our last conversation…"
                data-testid="input-campaign-body"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t" style={{ borderColor: "var(--lux-border)" }}>
              <Button variant="outline" onClick={onCancel} data-testid="button-cancel-campaign">Cancel</Button>
              <Button onClick={onSubmit} disabled={busy} data-testid="button-save-campaign">
                {busy ? "Saving…" : mode === "create" ? "Create Campaign" : "Save Changes"}
              </Button>
            </div>
          </div>
          <div>
            <div className="mb-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--lux-text-muted)" }}>
              Live preview
            </div>
            <EmailPreview
              fromName={form.fromName || "Sender name"}
              fromEmail={form.fromEmail || "sender@example.com"}
              subject={form.subject || "(no subject)"}
              body={previewBody}
              ctaLabel="Reply"
              signatureName={form.replyTo ? `Reply: ${form.replyTo}` : "Reply"}
              signatureTitle={form.sendAt ? `Scheduled ${new Date(form.sendAt).toLocaleString()}` : "Send time not set"}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DeleteCampaignDialog({
  campaign, brandId, onClose,
}: {
  campaign: MarketingCampaign;
  brandId: string | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    try {
      await apiRequest("DELETE", `/api/marketing/campaigns/${campaign.id}`);
      await queryClient.invalidateQueries({ queryKey: ["/api/marketing/campaigns", brandId] });
      toast({ title: "Campaign deleted" });
      onClose();
    } catch (e: unknown) {
      toast({ title: "Failed to delete campaign", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <AlertDialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <AlertDialogContent data-testid="dialog-delete-campaign">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete "{campaign.name}"?</AlertDialogTitle>
          <AlertDialogDescription>This permanently removes the campaign draft.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-cancel-delete-campaign">Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); remove(); }}
            disabled={busy}
            data-testid="button-confirm-delete-campaign"
            style={{ background: "var(--mc-red)" }}
          >
            {busy ? "Deleting…" : "Delete Campaign"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
