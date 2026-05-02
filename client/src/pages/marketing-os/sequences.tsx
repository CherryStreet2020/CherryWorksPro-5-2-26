/**
 * Sprint 2n — Marketing OS Sequence editor (/marketing/sequences).
 *
 * Lists sequences for the active brand. Selecting one (or creating a new
 * one) opens the editor where a planner chains multiple email steps with
 * delay-in-days between them. Each focused step renders inside the
 * premium EmailPreview live, so the planner sees what the next message
 * will look like in an inbox.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Plus, Workflow, Pencil, Trash2, ChevronUp, ChevronDown, X, Users, Pause, Play, ArrowLeft, AlertTriangle } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useBrand } from "@/hooks/useBrand";
import { isMarketingOsEnabled } from "@/lib/featureFlags";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { EmailPreview } from "@/components/marketing-os/premium/email-preview";
import { MarketingOsTabs } from "@/components/marketing-os/marketing-os-tabs";
import { BrandBadge } from "@/components/marketing-os/brand-badge";
import type {
  MarketingSequence,
  MarketingSequenceStep,
  MarketingSequenceEnrollment,
  MarketingSequenceEnrollmentStatus,
  ContactSegment,
  ClientContact,
} from "@shared/schema";

type EnrollmentRow = MarketingSequenceEnrollment & {
  contactEmail: string | null;
  contactFirstName: string | null;
  contactLastName: string | null;
};

type StepDraft = {
  id?: string;
  delayDays: number;
  subject: string;
  body: string;
};

type SequenceWithSteps = MarketingSequence & { steps: MarketingSequenceStep[] };

type SequenceForm = {
  name: string;
  description: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
};

const EMPTY_FORM: SequenceForm = {
  name: "",
  description: "",
  fromName: "",
  fromEmail: "",
  replyTo: "",
};

function fmt(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const t = typeof d === "string" ? new Date(d) : d;
  return t.toLocaleString();
}

export default function SequencesPage() {
  const flagOn = isMarketingOsEnabled();
  const { activeBrand, brands, setActiveBrand } = useBrand();
  const brandId = activeBrand?.id ?? null;

  const { data: sequences = [], isLoading } = useQuery<MarketingSequence[]>({
    queryKey: ["/api/marketing/sequences", brandId],
    enabled: flagOn && !!brandId,
    queryFn: async () => {
      const res = await fetch(`/api/marketing/sequences?brandId=${encodeURIComponent(brandId!)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [managingId, setManagingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<MarketingSequence | null>(null);
  const [failuresFor, setFailuresFor] = useState<
    { sequence: MarketingSequence; stepIndex: number | null } | null
  >(null);

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
            <Workflow className="w-10 h-10 mx-auto mb-4" style={{ color: "var(--lux-text-muted)" }} />
            <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>Create a brand first</h2>
            <p className="text-sm mb-6" style={{ color: "var(--lux-text-muted)" }}>
              Sequences are organized by brand. Create at least one brand before drafting a sequence.
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
            <Workflow className="w-10 h-10 mx-auto mb-4" style={{ color: "var(--lux-text-muted)" }} />
            <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>Select a brand to view sequences</h2>
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

  const isEditingMode = creating || !!editingId;
  const isManagingMode = !!managingId;
  const managingSequence = useMemo(
    () => sequences.find((s) => s.id === managingId) ?? null,
    [sequences, managingId],
  );

  return (
    <div className="px-6 lg:px-8 xl:px-10 py-6 max-w-7xl mx-auto">
      <MarketingOsTabs />

      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--lux-text)" }} data-testid="text-page-title">
            Sequences
          </h1>
          <div className="mt-1">
            <BrandBadge />
          </div>
        </div>
        {!isEditingMode && !isManagingMode && (
          <Button onClick={() => { setCreating(true); setEditingId(null); }} data-testid="button-new-sequence">
            <Plus className="w-4 h-4 mr-1.5" />
            New Sequence
          </Button>
        )}
        {isManagingMode && (
          <Button
            variant="outline"
            onClick={() => setManagingId(null)}
            data-testid="button-back-to-sequences"
          >
            <ArrowLeft className="w-4 h-4 mr-1.5" />
            Back to Sequences
          </Button>
        )}
      </div>

      {isEditingMode ? (
        <SequenceEditor
          key={editingId ?? "new"}
          sequenceId={editingId}
          brandId={brandId!}
          brandFromName={activeBrand?.fromName ?? ""}
          brandFromEmail={activeBrand?.fromEmail ?? ""}
          brandReplyTo={activeBrand?.replyTo ?? ""}
          onClose={() => { setEditingId(null); setCreating(false); }}
        />
      ) : isManagingMode && managingSequence ? (
        <EnrollmentsPanel
          sequence={managingSequence}
          brandId={brandId!}
        />
      ) : (
        <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
          <CardContent className="p-0 overflow-x-auto">
            {isLoading ? (
              <div className="p-8 text-sm" style={{ color: "var(--lux-text-muted)" }} data-testid="status-loading">Loading sequences…</div>
            ) : sequences.length === 0 ? (
              <div className="text-center py-16" data-testid="empty-state-sequences">
                <Workflow className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--lux-text-muted)" }} />
                <p className="text-base mb-1" style={{ color: "var(--lux-text)" }}>No sequences yet</p>
                <p className="text-sm mb-4" style={{ color: "var(--lux-text-muted)" }}>
                  Chain multiple email steps with delays so a contact gets a structured follow-up.
                </p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead style={{ borderBottom: "1px solid var(--lux-border)" }}>
                  <tr>
                    <th className="px-4 py-2 text-left font-medium" style={{ color: "var(--lux-text-muted)" }}>Name</th>
                    <th className="px-4 py-2 text-left font-medium" style={{ color: "var(--lux-text-muted)" }}>Description</th>
                    <th className="px-4 py-2 text-left font-medium" style={{ color: "var(--lux-text-muted)" }}>Updated</th>
                    <th className="px-4 py-2 w-32 text-right font-medium" style={{ color: "var(--lux-text-muted)" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sequences.map((s) => (
                    <tr key={s.id} className="hover:bg-[var(--lux-bg)] transition-colors" style={{ borderBottom: "1px solid var(--lux-border)" }} data-testid={`row-sequence-${s.id}`}>
                      <td className="px-4 py-2 font-medium" style={{ color: "var(--lux-text)" }} data-testid={`text-sequence-name-${s.id}`}>{s.name}</td>
                      <td className="px-4 py-2" style={{ color: "var(--lux-text-muted)" }} data-testid={`text-sequence-desc-${s.id}`}>{s.description || "—"}</td>
                      <td className="px-4 py-2" style={{ color: "var(--lux-text-muted)" }}>{fmt(s.updatedAt)}</td>
                      <td className="px-4 py-2 text-right">
                        <div className="inline-flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => { setManagingId(s.id); setEditingId(null); setCreating(false); }} data-testid={`button-manage-sequence-${s.id}`} title="Manage enrollments">
                            <Users className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => { setEditingId(s.id); setCreating(false); }} data-testid={`button-edit-sequence-${s.id}`}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setFailuresFor({ sequence: s, stepIndex: null })}
                            title="View recipients who didn't receive a step in this sequence"
                            data-testid={`button-failures-sequence-${s.id}`}
                          >
                            <AlertTriangle className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setDeleting(s)} data-testid={`button-delete-sequence-${s.id}`}>
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
        <DeleteSequenceDialog sequence={deleting} brandId={brandId} onClose={() => setDeleting(null)} />
      )}

      <SequenceFailuresDialog
        sequence={failuresFor?.sequence ?? null}
        stepIndex={failuresFor?.stepIndex ?? null}
        onClose={() => setFailuresFor(null)}
      />
    </div>
  );
}

interface SequenceFailureRow {
  contactId: string | null;
  recipientEmail: string | null;
  contactFirstName: string | null;
  contactLastName: string | null;
  stepIndex: number | null;
  attemptNumber: number;
  status: "failed" | "permanent_failure";
  errorCode: string | null;
  errorMessage: string | null;
  attemptedAt: string;
  nextRetryAt: string | null;
}

function SequenceFailuresDialog({
  sequence,
  stepIndex,
  onClose,
}: {
  sequence: MarketingSequence | null;
  stepIndex: number | null;
  onClose: () => void;
}) {
  const open = !!sequence;
  const { data: rows = [], isLoading } = useQuery<SequenceFailureRow[]>({
    queryKey: ["/api/marketing/sequences", sequence?.id, "failures", stepIndex],
    enabled: open && !!sequence?.id,
    queryFn: async () => {
      const url = stepIndex === null
        ? `/api/marketing/sequences/${sequence!.id}/failures`
        : `/api/marketing/sequences/${sequence!.id}/failures?stepIndex=${stepIndex}`;
      const res = await fetch(url, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl" data-testid="dialog-sequence-failures">
        <DialogHeader>
          <DialogTitle>
            {stepIndex === null
              ? "Recipients who didn't receive a step"
              : `Recipients who didn't receive step ${stepIndex + 1}`}
          </DialogTitle>
          <DialogDescription>
            {sequence?.name}. Permanent failures are recipients we gave up on after retries
            were exhausted or the address was rejected. Pending retries are still being
            attempted automatically.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="text-sm text-muted-foreground" data-testid="status-sequence-failures-loading">
            Loading failures…
          </div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground" data-testid="status-no-sequence-failures">
            {stepIndex === null
              ? "Every enrolled contact received every step so far."
              : "Every enrolled contact received this step."}
          </div>
        ) : (
          <div className="max-h-[480px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-2 py-2">Recipient</th>
                  {stepIndex === null && <th className="px-2 py-2">Step</th>}
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
                    <tr key={`${r.contactId ?? "null"}-${r.stepIndex ?? "x"}-${i}`} className="border-t" data-testid={`row-sequence-failure-${i}`}>
                      <td className="px-2 py-2">
                        <div className="font-medium" data-testid={`text-sequence-failure-name-${i}`}>{name}</div>
                        {r.recipientEmail && (
                          <div className="text-xs text-muted-foreground">{r.recipientEmail}</div>
                        )}
                      </td>
                      {stepIndex === null && (
                        <td className="px-2 py-2" data-testid={`text-sequence-failure-step-${i}`}>
                          {r.stepIndex === null ? "—" : r.stepIndex + 1}
                        </td>
                      )}
                      <td className="px-2 py-2" data-testid={`text-sequence-failure-status-${i}`}>
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

function SequenceEditor({
  sequenceId, brandId, brandFromName, brandFromEmail, brandReplyTo, onClose,
}: {
  sequenceId: string | null;
  brandId: string;
  brandFromName: string;
  brandFromEmail: string;
  brandReplyTo: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const isCreating = !sequenceId;

  const { data, isLoading } = useQuery<SequenceWithSteps>({
    queryKey: ["/api/marketing/sequences", sequenceId],
    enabled: !!sequenceId,
    queryFn: async () => {
      const res = await fetch(`/api/marketing/sequences/${sequenceId}`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  const [form, setForm] = useState<SequenceForm>(EMPTY_FORM);
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [activeStepIdx, setActiveStepIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failuresStepIdx, setFailuresStepIdx] = useState<number | null>(null);

  useEffect(() => {
    if (isCreating) {
      setForm({
        ...EMPTY_FORM,
        fromName: brandFromName,
        fromEmail: brandFromEmail,
        replyTo: brandReplyTo,
      });
      setSteps([{ delayDays: 0, subject: "", body: "" }]);
      setActiveStepIdx(0);
    } else if (data) {
      setForm({
        name: data.name,
        description: data.description ?? "",
        fromName: data.fromName ?? "",
        fromEmail: data.fromEmail ?? "",
        replyTo: data.replyTo ?? "",
      });
      const loaded: StepDraft[] = (data.steps ?? []).map((s) => ({
        id: s.id,
        delayDays: s.delayDays,
        subject: s.subject ?? "",
        body: s.body ?? "",
      }));
      setSteps(loaded.length > 0 ? loaded : [{ delayDays: 0, subject: "", body: "" }]);
      setActiveStepIdx(0);
    }
  }, [isCreating, data, brandFromName, brandFromEmail, brandReplyTo]);

  const updateForm = <K extends keyof SequenceForm>(k: K, v: SequenceForm[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const updateStep = (idx: number, patch: Partial<StepDraft>) => {
    setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const addStep = () => {
    setSteps((prev) => {
      const next = [...prev, { delayDays: 3, subject: "", body: "" }];
      setActiveStepIdx(next.length - 1);
      return next;
    });
  };

  const removeStep = (idx: number) => {
    setSteps((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((_, i) => i !== idx);
      setActiveStepIdx(Math.min(activeStepIdx, next.length - 1));
      return next;
    });
  };

  const moveStep = (idx: number, dir: -1 | 1) => {
    setSteps((prev) => {
      const next = [...prev];
      const swap = idx + dir;
      if (swap < 0 || swap >= next.length) return prev;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      setActiveStepIdx(swap);
      return next;
    });
  };

  const activeStep = steps[activeStepIdx] ?? steps[0];

  const submit = async () => {
    const trimmed = form.name.trim();
    if (!trimmed) {
      toast({ title: "Sequence name is required", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      let id = sequenceId;
      const payload = {
        name: trimmed,
        description: form.description,
        fromName: form.fromName,
        fromEmail: form.fromEmail,
        replyTo: form.replyTo,
      };
      if (isCreating) {
        const res = await apiRequest("POST", "/api/marketing/sequences", { brandId, ...payload });
        const created = await res.json();
        id = created.id;
      } else {
        await apiRequest("PATCH", `/api/marketing/sequences/${sequenceId}`, payload);
      }
      if (id) {
        await apiRequest("PUT", `/api/marketing/sequences/${id}/steps`, {
          steps: steps.map((s, i) => ({
            stepOrder: i,
            delayDays: Math.max(0, Math.floor(Number(s.delayDays) || 0)),
            subject: s.subject,
            body: s.body,
          })),
        });
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/marketing/sequences"] });
      toast({ title: isCreating ? "Sequence created" : "Sequence saved" });
      onClose();
    } catch (e: unknown) {
      toast({
        title: isCreating ? "Failed to create sequence" : "Failed to save sequence",
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  if (!isCreating && isLoading) {
    return (
      <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
        <CardContent className="p-8 text-sm" style={{ color: "var(--lux-text-muted)" }} data-testid="status-sequence-loading">
          Loading sequence…
        </CardContent>
      </Card>
    );
  }

  const previewBody = activeStep?.body.trim() ||
    "Start typing this step's message and the inbox preview will mirror it live.";

  return (
    <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }} data-testid={isCreating ? "form-create-sequence" : "form-edit-sequence"}>
      <CardContent className="p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="sequence-name">Sequence name *</Label>
            <Input
              id="sequence-name"
              value={form.name}
              onChange={(e) => updateForm("name", e.target.value)}
              maxLength={200}
              placeholder="Lead nurture — week 1"
              data-testid="input-sequence-name"
            />
          </div>
          <div>
            <Label htmlFor="sequence-description">Description</Label>
            <Input
              id="sequence-description"
              value={form.description}
              onChange={(e) => updateForm("description", e.target.value)}
              maxLength={2000}
              placeholder="Internal note about who this is for"
              data-testid="input-sequence-description"
            />
          </div>
          <div>
            <Label htmlFor="sequence-from-name">From name</Label>
            <Input
              id="sequence-from-name"
              value={form.fromName}
              onChange={(e) => updateForm("fromName", e.target.value)}
              data-testid="input-sequence-from-name"
            />
          </div>
          <div>
            <Label htmlFor="sequence-from-email">From email</Label>
            <Input
              id="sequence-from-email"
              type="email"
              value={form.fromEmail}
              onChange={(e) => updateForm("fromEmail", e.target.value)}
              data-testid="input-sequence-from-email"
            />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="sequence-reply-to">Reply-to</Label>
            <Input
              id="sequence-reply-to"
              type="email"
              value={form.replyTo}
              onChange={(e) => updateForm("replyTo", e.target.value)}
              data-testid="input-sequence-reply-to"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--lux-text-muted)" }}>
                Steps ({steps.length})
              </h2>
              <Button size="sm" variant="outline" onClick={addStep} data-testid="button-add-step">
                <Plus className="w-3.5 h-3.5 mr-1" />
                Add step
              </Button>
            </div>
            <div className="space-y-2">
              {steps.map((s, i) => {
                const isActive = i === activeStepIdx;
                return (
                  <div
                    key={s.id ?? `new-${i}`}
                    className="rounded-lg border p-3 cursor-pointer transition-colors"
                    style={{
                      borderColor: isActive ? "var(--lux-accent)" : "var(--lux-border)",
                      background: isActive ? "rgba(var(--lux-accent-rgb), 0.06)" : "var(--lux-surface)",
                    }}
                    onClick={() => setActiveStepIdx(i)}
                    data-testid={`step-card-${i}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold" style={{ color: "var(--lux-text-muted)" }}>
                        Step {i + 1} · {i === 0 ? "Send immediately" : `Wait ${s.delayDays} day${s.delayDays === 1 ? "" : "s"}`}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); moveStep(i, -1); }}
                          disabled={i === 0}
                          className="p-1 disabled:opacity-30"
                          data-testid={`button-step-up-${i}`}
                          aria-label="Move step up"
                        >
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); moveStep(i, 1); }}
                          disabled={i === steps.length - 1}
                          className="p-1 disabled:opacity-30"
                          data-testid={`button-step-down-${i}`}
                          aria-label="Move step down"
                        >
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                        {s.id && (() => {
                          const persisted = data?.steps?.find((ps) => ps.id === s.id);
                          const persistedOrder = persisted?.stepOrder ?? null;
                          return (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (persistedOrder !== null) setFailuresStepIdx(persistedOrder);
                              }}
                              disabled={persistedOrder === null}
                              className="p-1 disabled:opacity-30"
                              data-testid={`button-step-failures-${i}`}
                              aria-label="View failures for this step"
                              title="View recipients who didn't receive this step"
                            >
                              <AlertTriangle className="w-3.5 h-3.5" />
                            </button>
                          );
                        })()}
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); removeStep(i); }}
                          disabled={steps.length <= 1}
                          className="p-1 disabled:opacity-30"
                          data-testid={`button-step-remove-${i}`}
                          aria-label="Remove step"
                        >
                          <X className="w-3.5 h-3.5" style={{ color: "var(--mc-red)" }} />
                        </button>
                      </div>
                    </div>
                    <div className="mt-1 text-sm font-medium truncate" style={{ color: "var(--lux-text)" }}>
                      {s.subject || "(no subject)"}
                    </div>
                  </div>
                );
              })}
            </div>

            {activeStep && (
              <div className="rounded-lg border p-4 space-y-3" style={{ borderColor: "var(--lux-border)" }} data-testid={`step-editor-${activeStepIdx}`}>
                <h3 className="text-sm font-semibold" style={{ color: "var(--lux-text)" }}>
                  Editing step {activeStepIdx + 1}
                </h3>
                <div>
                  <Label htmlFor="step-delay">Wait (days from previous step)</Label>
                  <Input
                    id="step-delay"
                    type="number"
                    min={0}
                    max={365}
                    value={activeStep.delayDays}
                    onChange={(e) => updateStep(activeStepIdx, { delayDays: Number(e.target.value) || 0 })}
                    disabled={activeStepIdx === 0}
                    data-testid={`input-step-delay-${activeStepIdx}`}
                  />
                  {activeStepIdx === 0 && (
                    <p className="text-xs mt-1" style={{ color: "var(--lux-text-muted)" }}>
                      The first step always sends immediately on enrollment.
                    </p>
                  )}
                </div>
                <div>
                  <Label htmlFor="step-subject">Subject line</Label>
                  <Input
                    id="step-subject"
                    value={activeStep.subject}
                    onChange={(e) => updateStep(activeStepIdx, { subject: e.target.value })}
                    maxLength={300}
                    data-testid={`input-step-subject-${activeStepIdx}`}
                  />
                </div>
                <div>
                  <Label htmlFor="step-body">Body</Label>
                  <Textarea
                    id="step-body"
                    value={activeStep.body}
                    onChange={(e) => updateStep(activeStepIdx, { body: e.target.value })}
                    rows={8}
                    maxLength={50_000}
                    data-testid={`input-step-body-${activeStepIdx}`}
                  />
                </div>
              </div>
            )}
          </div>

          <div>
            <div className="mb-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--lux-text-muted)" }}>
              Live preview · Step {activeStepIdx + 1}
            </div>
            <EmailPreview
              fromName={form.fromName || "Sender name"}
              fromEmail={form.fromEmail || "sender@example.com"}
              subject={activeStep?.subject || "(no subject)"}
              body={previewBody}
              ctaLabel="Reply"
              signatureName={form.replyTo ? `Reply: ${form.replyTo}` : "Reply"}
              signatureTitle={
                activeStepIdx === 0
                  ? "Sends on enrollment"
                  : `Waits ${activeStep?.delayDays ?? 0} day${(activeStep?.delayDays ?? 0) === 1 ? "" : "s"} after previous step`
              }
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t" style={{ borderColor: "var(--lux-border)" }}>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-sequence">Cancel</Button>
          <Button onClick={submit} disabled={busy} data-testid="button-save-sequence">
            {busy ? "Saving…" : isCreating ? "Create Sequence" : "Save Changes"}
          </Button>
        </div>
      </CardContent>
      <SequenceFailuresDialog
        sequence={failuresStepIdx !== null && data ? (data as MarketingSequence) : null}
        stepIndex={failuresStepIdx}
        onClose={() => setFailuresStepIdx(null)}
      />
    </Card>
  );
}

function DeleteSequenceDialog({
  sequence, brandId, onClose,
}: {
  sequence: MarketingSequence;
  brandId: string | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    try {
      await apiRequest("DELETE", `/api/marketing/sequences/${sequence.id}`);
      await queryClient.invalidateQueries({ queryKey: ["/api/marketing/sequences", brandId] });
      toast({ title: "Sequence deleted" });
      onClose();
    } catch (e: unknown) {
      toast({ title: "Failed to delete sequence", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <AlertDialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <AlertDialogContent data-testid="dialog-delete-sequence">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete "{sequence.name}"?</AlertDialogTitle>
          <AlertDialogDescription>This permanently removes the sequence and all its steps.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-cancel-delete-sequence">Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); remove(); }}
            disabled={busy}
            data-testid="button-confirm-delete-sequence"
            style={{ background: "var(--mc-red)" }}
          >
            {busy ? "Deleting…" : "Delete Sequence"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ── Task #208: Enrollments panel ────────────────────────────────────
function EnrollmentsPanel({ sequence, brandId }: { sequence: MarketingSequence; brandId: string }) {
  const { toast } = useToast();
  const [openEnrollContacts, setOpenEnrollContacts] = useState(false);
  const [openEnrollSegment, setOpenEnrollSegment] = useState(false);

  const { data: enrollments = [], isLoading } = useQuery<EnrollmentRow[]>({
    queryKey: ["/api/marketing/sequences", sequence.id, "enrollments"],
    queryFn: async () => {
      const res = await fetch(`/api/marketing/sequences/${sequence.id}/enrollments`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  const setStatus = async (id: string, status: MarketingSequenceEnrollmentStatus) => {
    try {
      await apiRequest("PATCH", `/api/marketing/sequences/${sequence.id}/enrollments/${id}`, { status });
      await queryClient.invalidateQueries({ queryKey: ["/api/marketing/sequences", sequence.id, "enrollments"] });
      toast({ title: status === "paused" ? "Enrollment paused" : "Enrollment resumed" });
    } catch (e: unknown) {
      toast({ title: "Update failed", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  };

  const remove = async (id: string) => {
    try {
      await apiRequest("DELETE", `/api/marketing/sequences/${sequence.id}/enrollments/${id}`);
      await queryClient.invalidateQueries({ queryKey: ["/api/marketing/sequences", sequence.id, "enrollments"] });
      toast({ title: "Contact removed from sequence" });
    } catch (e: unknown) {
      toast({ title: "Remove failed", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  };

  const formatName = (r: EnrollmentRow) => {
    const parts = [r.contactFirstName, r.contactLastName].filter(Boolean) as string[];
    return parts.join(" ") || r.contactEmail || r.prospectId;
  };

  return (
    <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }} data-testid="panel-enrollments">
      <CardContent className="p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold" style={{ color: "var(--lux-text)" }} data-testid="text-enrollments-heading">
              Enrollments — {sequence.name}
            </h2>
            <p className="text-sm" style={{ color: "var(--lux-text-muted)" }}>
              {enrollments.length} contact{enrollments.length === 1 ? "" : "s"} on this sequence
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setOpenEnrollSegment(true)} data-testid="button-enroll-segment">
              <Users className="w-4 h-4 mr-1.5" />
              Enroll segment
            </Button>
            <Button onClick={() => setOpenEnrollContacts(true)} data-testid="button-enroll-contacts">
              <Plus className="w-4 h-4 mr-1.5" />
              Enroll contacts
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="p-6 text-sm" style={{ color: "var(--lux-text-muted)" }} data-testid="status-enrollments-loading">
              Loading enrollments…
            </div>
          ) : enrollments.length === 0 ? (
            <div className="text-center py-12" data-testid="empty-state-enrollments">
              <Users className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--lux-text-muted)" }} />
              <p className="text-base mb-1" style={{ color: "var(--lux-text)" }}>No one is enrolled yet</p>
              <p className="text-sm" style={{ color: "var(--lux-text-muted)" }}>
                Enroll contacts directly or from a saved segment to start sending.
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead style={{ borderBottom: "1px solid var(--lux-border)" }}>
                <tr>
                  <th className="px-4 py-2 text-left font-medium" style={{ color: "var(--lux-text-muted)" }}>Contact</th>
                  <th className="px-4 py-2 text-left font-medium" style={{ color: "var(--lux-text-muted)" }}>Status</th>
                  <th className="px-4 py-2 text-left font-medium" style={{ color: "var(--lux-text-muted)" }}>Step</th>
                  <th className="px-4 py-2 text-left font-medium" style={{ color: "var(--lux-text-muted)" }}>Next send</th>
                  <th className="px-4 py-2 w-32 text-right font-medium" style={{ color: "var(--lux-text-muted)" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {enrollments.map((r) => (
                  <tr key={r.id} className="hover:bg-[var(--lux-bg)]" style={{ borderBottom: "1px solid var(--lux-border)" }} data-testid={`row-enrollment-${r.id}`}>
                    <td className="px-4 py-2" style={{ color: "var(--lux-text)" }} data-testid={`text-enrollment-name-${r.id}`}>
                      <div className="font-medium">{formatName(r)}</div>
                      {r.contactEmail && (
                        <div className="text-xs" style={{ color: "var(--lux-text-muted)" }}>{r.contactEmail}</div>
                      )}
                    </td>
                    <td className="px-4 py-2" data-testid={`text-enrollment-status-${r.id}`}>
                      <span className="text-xs uppercase tracking-wide" style={{ color: r.status === "active" ? "var(--lux-text)" : "var(--lux-text-muted)" }}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-2" style={{ color: "var(--lux-text-muted)" }}>
                      {r.currentStepIndex + 1}
                    </td>
                    <td className="px-4 py-2" style={{ color: "var(--lux-text-muted)" }}>
                      {fmt(r.nextSendAt)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="inline-flex gap-1">
                        {r.status === "active" ? (
                          <Button size="sm" variant="ghost" onClick={() => setStatus(r.id, "paused")} data-testid={`button-pause-enrollment-${r.id}`} title="Pause">
                            <Pause className="w-3.5 h-3.5" />
                          </Button>
                        ) : r.status === "paused" ? (
                          <Button size="sm" variant="ghost" onClick={() => setStatus(r.id, "active")} data-testid={`button-resume-enrollment-${r.id}`} title="Resume">
                            <Play className="w-3.5 h-3.5" />
                          </Button>
                        ) : null}
                        <Button size="sm" variant="ghost" onClick={() => remove(r.id)} data-testid={`button-remove-enrollment-${r.id}`} title="Remove">
                          <Trash2 className="w-3.5 h-3.5" style={{ color: "var(--mc-red)" }} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </CardContent>

      {openEnrollContacts && (
        <EnrollContactsDialog
          sequenceId={sequence.id}
          brandId={brandId}
          onClose={() => setOpenEnrollContacts(false)}
        />
      )}
      {openEnrollSegment && (
        <EnrollSegmentDialog
          sequenceId={sequence.id}
          brandId={brandId}
          onClose={() => setOpenEnrollSegment(false)}
        />
      )}
    </Card>
  );
}

function EnrollContactsDialog({
  sequenceId, brandId, onClose,
}: { sequenceId: string; brandId: string; onClose: () => void }) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const { data: contacts = [], isLoading } = useQuery<ClientContact[]>({
    queryKey: ["/api/marketing/contacts", brandId, search],
    queryFn: async () => {
      const sp = new URLSearchParams({ brandId, limit: "50" });
      if (search.trim()) sp.set("search", search.trim());
      const res = await fetch(`/api/marketing/contacts?${sp.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return Array.isArray(json) ? json : (json.contacts ?? json.rows ?? []);
    },
  });

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    if (selected.size === 0) {
      toast({ title: "Pick at least one contact", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const res = await apiRequest("POST", `/api/marketing/sequences/${sequenceId}/enrollments`, {
        prospectIds: Array.from(selected),
      });
      const result = await res.json();
      await queryClient.invalidateQueries({ queryKey: ["/api/marketing/sequences", sequenceId, "enrollments"] });
      toast({
        title: `Enrolled ${result.inserted} contact${result.inserted === 1 ? "" : "s"}`,
        description: result.skipped > 0 ? `${result.skipped} already enrolled or invalid` : undefined,
      });
      onClose();
    } catch (e: unknown) {
      toast({ title: "Enrollment failed", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl" data-testid="dialog-enroll-contacts">
        <DialogHeader>
          <DialogTitle>Enroll contacts</DialogTitle>
          <DialogDescription>Pick contacts from this brand to start on the sequence.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, company…"
            data-testid="input-enroll-search"
          />
          <div className="max-h-72 overflow-y-auto border rounded" style={{ borderColor: "var(--lux-border)" }}>
            {isLoading ? (
              <div className="p-4 text-sm" style={{ color: "var(--lux-text-muted)" }} data-testid="status-contacts-loading">Loading…</div>
            ) : contacts.length === 0 ? (
              <div className="p-4 text-sm" style={{ color: "var(--lux-text-muted)" }} data-testid="empty-state-contacts">No contacts match.</div>
            ) : (
              contacts.map((c) => {
                const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || c.id;
                return (
                  <label
                    key={c.id}
                    className="flex items-center gap-3 p-2 cursor-pointer hover:bg-[var(--lux-bg)]"
                    style={{ borderBottom: "1px solid var(--lux-border)" }}
                    data-testid={`row-pick-contact-${c.id}`}
                  >
                    <Checkbox
                      checked={selected.has(c.id)}
                      onCheckedChange={() => toggle(c.id)}
                      data-testid={`checkbox-pick-contact-${c.id}`}
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate" style={{ color: "var(--lux-text)" }}>{name}</div>
                      {c.email && <div className="text-xs truncate" style={{ color: "var(--lux-text-muted)" }}>{c.email}</div>}
                    </div>
                  </label>
                );
              })
            )}
          </div>
          <p className="text-xs" style={{ color: "var(--lux-text-muted)" }} data-testid="text-enroll-selected-count">
            {selected.size} selected
          </p>
          <p
            className="text-xs"
            style={{ color: "var(--lux-text-muted)" }}
            data-testid="text-contacts-enroll-preview"
          >
            {selected.size === 0
              ? "Pick contacts to see how many will be enrolled."
              : `≈ ${selected.size.toLocaleString()} contact${selected.size === 1 ? "" : "s"} will be enrolled (anyone already on this sequence is skipped)`}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-enroll-contacts">Cancel</Button>
          <Button onClick={submit} disabled={busy || selected.size === 0} data-testid="button-confirm-enroll-contacts">
            {busy ? "Enrolling…" : "Enroll"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EnrollSegmentDialog({
  sequenceId, brandId, onClose,
}: { sequenceId: string; brandId: string; onClose: () => void }) {
  const { toast } = useToast();
  const [segmentId, setSegmentId] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const { data: segments = [], isLoading } = useQuery<ContactSegment[]>({
    queryKey: ["/api/marketing/segments", brandId],
    queryFn: async () => {
      const sp = new URLSearchParams({ brandId });
      const res = await fetch(`/api/marketing/segments?${sp.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  // Task #293 — recipient-count preview that updates when the segment
  // selection changes. Mirrors the campaigns audience-preview pattern
  // and surfaces how many contacts will be newly enrolled (the rest are
  // already on the sequence and skipped by idempotent enrollment).
  const { data: preview, isFetching: previewFetching } = useQuery<{
    totalContacts: number;
    alreadyEnrolled: number;
    newContacts: number;
  }>({
    queryKey: ["/api/marketing/sequences", sequenceId, "enrollment-preview", segmentId],
    enabled: !!segmentId,
    queryFn: async () => {
      const sp = new URLSearchParams({ segmentId });
      const res = await fetch(
        `/api/marketing/sequences/${sequenceId}/enrollment-preview?${sp.toString()}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  const submit = async () => {
    if (!segmentId) {
      toast({ title: "Pick a segment", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const res = await apiRequest("POST", `/api/marketing/sequences/${sequenceId}/enrollments`, { segmentId });
      const result = await res.json();
      await queryClient.invalidateQueries({ queryKey: ["/api/marketing/sequences", sequenceId, "enrollments"] });
      toast({
        title: `Enrolled ${result.inserted} contact${result.inserted === 1 ? "" : "s"} from segment`,
        description: result.skipped > 0 ? `${result.skipped} already enrolled` : undefined,
      });
      onClose();
    } catch (e: unknown) {
      toast({ title: "Segment enrollment failed", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md" data-testid="dialog-enroll-segment">
        <DialogHeader>
          <DialogTitle>Enroll a saved segment</DialogTitle>
          <DialogDescription>Every contact currently in the segment will be enrolled.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {isLoading ? (
            <div className="text-sm" style={{ color: "var(--lux-text-muted)" }} data-testid="status-segments-loading">Loading segments…</div>
          ) : segments.length === 0 ? (
            <div className="text-sm" style={{ color: "var(--lux-text-muted)" }} data-testid="empty-state-segments">
              No saved segments for this brand. Build one on the Segments tab first.
            </div>
          ) : (
            <Select value={segmentId} onValueChange={setSegmentId}>
              <SelectTrigger data-testid="select-segment">
                <SelectValue placeholder="Pick a segment" />
              </SelectTrigger>
              <SelectContent>
                {segments.map((s) => (
                  <SelectItem key={s.id} value={s.id} data-testid={`option-segment-${s.id}`}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div
            className="text-xs"
            style={{ color: "var(--lux-text-muted)" }}
            data-testid="text-segment-enroll-preview"
          >
            {!segmentId
              ? "Pick a segment to see how many contacts will be enrolled."
              : preview === undefined
                ? previewFetching
                  ? "Calculating recipients…"
                  : "Recipient count unavailable"
                : preview.alreadyEnrolled > 0
                  ? `≈ ${preview.newContacts.toLocaleString()} contact${preview.newContacts === 1 ? "" : "s"} will be enrolled (${preview.alreadyEnrolled.toLocaleString()} already on this sequence)`
                  : `≈ ${preview.newContacts.toLocaleString()} contact${preview.newContacts === 1 ? "" : "s"} will be enrolled`}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-enroll-segment">Cancel</Button>
          <Button onClick={submit} disabled={busy || !segmentId} data-testid="button-confirm-enroll-segment">
            {busy ? "Enrolling…" : "Enroll segment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
