import { useState } from "react";
import { useLocation } from "wouter";
import { UpgradeWall } from "@/components/upgrade-wall";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { formatDate } from "@/components/shared/format";
import { CalendarCheck, Plus, Lock, Unlock, AlertTriangle, ArrowLeft } from "lucide-react";
import { useDocumentTitle } from "@/lib/use-document-title";
import { useBillingStatus } from "@/hooks/use-billing-status";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { TIER_RANK } from "@/lib/tier-config";

interface ClosePeriod {
  id: string;
  orgId: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  closedAt: string | null;
  closedByUserId: string | null;
  notes: string | null;
  createdAt: string;
}

export default function ClosePeriodsPage() {
  useDocumentTitle("Close Periods");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { planTier } = useBillingStatus();
  const isBusiness = (TIER_RANK[planTier] ?? 0) >= (TIER_RANK["BUSINESS"] ?? 3);

  const [showCreate, setShowCreate] = useState(false);
  const [confirmClose, setConfirmClose] = useState<ClosePeriod | null>(null);
  const [confirmReopen, setConfirmReopen] = useState<ClosePeriod | null>(null);
  const [formStart, setFormStart] = useState("");
  const [formEnd, setFormEnd] = useState("");
  const [formNotes, setFormNotes] = useState("");

  const { data: periods, isLoading } = useQuery<ClosePeriod[]>({
    queryKey: ["/api/close-periods"],
    enabled: isBusiness,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/close-periods", {
        periodStart: formStart,
        periodEnd: formEnd,
        notes: formNotes || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/close-periods"] });
      setShowCreate(false);
      setFormStart("");
      setFormEnd("");
      setFormNotes("");
      toast({ title: "Close period created" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const closeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/close-periods/${id}/close`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/close-periods"] });
      setConfirmClose(null);
      toast({ title: "Period closed" });
    },
    onError: (err: Error) => {
      toast({ title: "Cannot close period", description: err.message, variant: "destructive", duration: 8000 });
      setConfirmClose(null);
    },
  });

  const reopenMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/close-periods/${id}/reopen`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/close-periods"] });
      setConfirmReopen(null);
      toast({ title: "Period reopened" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setConfirmReopen(null);
    },
  });

  if (isLoading) {
    return (
      <div className="px-6 lg:px-8 xl:px-10 py-6 space-y-6">
        <Skeleton className="h-10 w-48 rounded-lg" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <>
    <div className="px-6 lg:px-8 xl:px-10 pt-6">
      <PageBreadcrumbs group="System" page="Close Periods" />
    </div>
    <UpgradeWall requiredTier="BUSINESS" featureName="Close Periods" description="Lock accounting periods to prevent backdated edits. Available on Business plans and above.">
    <div className="px-6 lg:px-8 xl:px-10 pt-2 pb-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(var(--lux-accent-rgb),0.18) 0%, rgba(168,85,247,0.12) 100%)" }}>
            <CalendarCheck className="w-5 h-5" style={{ color: "var(--lux-accent)" }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: "var(--lux-text)" }} data-testid="text-page-title">Close Periods</h1>
            <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>Manage accounting period closures</p>
          </div>
        </div>
        <Button onClick={() => { setFormStart(""); setFormEnd(""); setFormNotes(""); setShowCreate(true); }} data-testid="button-new-close-period">
          <Plus className="w-4 h-4 mr-1.5" /> New Close Period
        </Button>
      </div>

      {(!periods || periods.length === 0) ? (
        <Card style={{ background: "var(--lux-surface)", border: "1px solid var(--lux-border)" }}>
          <CardContent className="p-8">
            <EmptyState icon={CalendarCheck} title="No close periods" description="Create your first close period to lock accounting data." />
          </CardContent>
        </Card>
      ) : (
        <Card style={{ background: "var(--lux-surface)", border: "1px solid var(--lux-border)" }}>
          <div className="rounded-lg overflow-hidden">
            <table className="w-full border-collapse">
              <thead>
                <tr style={{ background: "var(--lux-bg)" }}>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)", borderBottom: "1px solid var(--lux-border)" }}>Period</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)", borderBottom: "1px solid var(--lux-border)" }}>Status</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)", borderBottom: "1px solid var(--lux-border)" }}>Closed At</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)", borderBottom: "1px solid var(--lux-border)" }}>Notes</th>
                  <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)", borderBottom: "1px solid var(--lux-border)" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {periods.map((p) => (
                  <tr key={p.id} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors" style={{ borderBottom: "1px solid var(--lux-border)" }} data-testid={`row-period-${p.id}`}>
                    <td className="px-4 py-3 text-sm font-medium" style={{ color: "var(--lux-text)" }}>
                      {formatDate(p.periodStart)} — {formatDate(p.periodEnd)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
                        style={{
                          background: p.status === "CLOSED" ? "rgba(107,114,128,0.1)" : "rgba(34,197,94,0.1)",
                          color: p.status === "CLOSED" ? "#6b7280" : "#22c55e",
                        }}
                        data-testid={`badge-status-${p.id}`}
                      >
                        {p.status === "CLOSED" ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: "var(--lux-text-muted)" }}>
                      {p.closedAt ? new Date(p.closedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs truncate max-w-[200px]" style={{ color: "var(--lux-text-muted)" }}>
                      {p.notes || "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {p.status === "OPEN" ? (
                        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setConfirmClose(p)} data-testid={`button-close-${p.id}`}>
                          <Lock className="w-3 h-3" /> Close Period
                        </Button>
                      ) : (
                        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-amber-600" onClick={() => setConfirmReopen(p)} data-testid={`button-reopen-${p.id}`}>
                          <Unlock className="w-3 h-3" /> Reopen
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Dialog open={showCreate} onOpenChange={(open) => !open && setShowCreate(false)}>
        <DialogContent className="sm:max-w-md" style={{ background: "var(--lux-surface)" }}>
          <DialogHeader>
            <DialogTitle style={{ color: "var(--lux-text)" }}>New Close Period</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label className="text-xs font-semibold mb-1.5 block" style={{ color: "var(--lux-text-muted)" }}>Period Start *</Label>
              <Input type="date" value={formStart} onChange={e => setFormStart(e.target.value)} data-testid="input-period-start" />
            </div>
            <div>
              <Label className="text-xs font-semibold mb-1.5 block" style={{ color: "var(--lux-text-muted)" }}>Period End *</Label>
              <Input type="date" value={formEnd} onChange={e => setFormEnd(e.target.value)} data-testid="input-period-end" />
            </div>
            <div>
              <Label className="text-xs font-semibold mb-1.5 block" style={{ color: "var(--lux-text-muted)" }}>Notes</Label>
              <Textarea value={formNotes} onChange={e => setFormNotes(e.target.value)} placeholder="Optional notes..." rows={2} data-testid="input-period-notes" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button disabled={!formStart || !formEnd || createMutation.isPending} onClick={() => createMutation.mutate()} data-testid="button-create-period">
                Create
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmClose} onOpenChange={(open) => !open && setConfirmClose(null)}>
        <DialogContent className="sm:max-w-sm" style={{ background: "var(--lux-surface)" }}>
          <DialogHeader>
            <DialogTitle style={{ color: "var(--lux-text)" }}>Close Period?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <p className="text-sm" style={{ color: "var(--lux-text)" }}>
              This will lock all time entries, invoices, and expenses within <strong>{confirmClose && formatDate(confirmClose.periodStart)} — {confirmClose && formatDate(confirmClose.periodEnd)}</strong>. All timesheets in this period must be approved.
            </p>
            <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg" style={{ background: "rgba(245,158,11,0.08)", color: "#f59e0b" }}>
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              This action can be reversed by reopening.
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmClose(null)}>Cancel</Button>
              <Button disabled={closeMutation.isPending} onClick={() => confirmClose && closeMutation.mutate(confirmClose.id)} data-testid="button-confirm-close">
                Close Period
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmReopen} onOpenChange={(open) => !open && setConfirmReopen(null)}>
        <DialogContent className="sm:max-w-sm" style={{ background: "var(--lux-surface)" }}>
          <DialogHeader>
            <DialogTitle style={{ color: "var(--lux-text)" }}>Reopen Period?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <p className="text-sm" style={{ color: "var(--lux-text)" }}>
              This will unlock <strong>{confirmReopen && formatDate(confirmReopen.periodStart)} — {confirmReopen && formatDate(confirmReopen.periodEnd)}</strong>, allowing modifications to time entries, invoices, and expenses in this period. This action is logged.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmReopen(null)}>Cancel</Button>
              <Button variant="destructive" disabled={reopenMutation.isPending} onClick={() => confirmReopen && reopenMutation.mutate(confirmReopen.id)} data-testid="button-confirm-reopen">
                Reopen Period
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
    </UpgradeWall>
    </>
  );
}
