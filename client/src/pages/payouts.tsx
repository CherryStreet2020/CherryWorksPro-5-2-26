import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/page-header";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { StatCard } from "@/components/shared/stat-card";
import { FormSection } from "@/components/shared/form-section";
import { AvatarInitials } from "@/components/shared/avatar-initials";
import { StatusBadge } from "@/components/shared/status-badge";
import { ActiveFilterBar, type FilterChipDescriptor } from "@/components/active-filter-chip";
import { formatMoney, formatDate, formatRelativeDate, formatHours } from "@/components/shared/format";
import { useBaseCurrency } from "@/hooks/use-base-currency";
import {
  DollarSign, Clock, Users, Plus, Search, ChevronDown, ChevronRight, XCircle, Zap, Send, Download, AlertTriangle, X, ArrowLeft,
} from "lucide-react";
import { CostRateInlineEditor } from "@/components/shared/cost-rate-inline-editor";
import { Link, useLocation } from "wouter";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import { useDocumentTitle } from "@/lib/use-document-title";
import { useUrlFilterState } from "@/lib/use-url-filter-state";
import { ErrorState } from "@/components/shared/error-state";

interface TeamMemberSummary {
  teamMemberId: string;
  teamMemberName: string;
  teamMemberEmail: string;
  paymentMethod: string | null;
  totalMinutes: number;
  paidMinutes: number;
  unpaidMinutes: number;
  totalHours: number;
  paidHours: number;
  unpaidHours: number;
  unpaidTimeValue: number;
  pendingPayoutAmount: number;
  amountOwed: number;
  totalPaidOut: number;
  lastPayoutDate: string | null;
  costRateMissing?: boolean;
  costRateMissingProjects?: { projectId: string; projectName: string }[];
  noDerivableCostRate?: boolean;
}

interface Payout {
  id: string;
  orgId: string;
  teamMemberId: string;
  amount: string;
  payoutDate: string;
  paymentMethod: string;
  referenceNumber: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  notes: string | null;
  status: string;
  stripeTransferId: string | null;
  stripeTransferStatus: string | null;
  teamMemberName?: string;
  createdAt: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

interface UnpaidEntry {
  id: string;
  date: string;
  minutes: number;
  billable: boolean;
  notes: string | null;
  projectId: string;
  invoiced: boolean;
  // Payout value of this entry (hours × snapshot-preferring cost rate, rounded
  // to the cent server-side). The dialog sums these for the selected entries so
  // the Amount field matches what the server records for the same selection.
  value: number;
}

export default function PayoutsPage() {
  useDocumentTitle("Payouts");
  const baseCurrency = useBaseCurrency();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [filters, setFilter] = useUrlFilterState({ q: "", status: "ALL" });
  const [hubFilter, setHubFilter] = useState<{ label: string } | null>(null);
  const search = filters.q;
  const statusFilter = filters.status;
  const setSearch = (v: string) => setFilter("q", v, { replace: true });
  const setStatusFilter = (v: string) => setFilter("status", v);
  const [payoutDialogOpen, setPayoutDialogOpen] = useState(false);
  const [selectedTeamMember, setSelectedTeamMember] = useState<TeamMemberSummary | null>(null);
  const [expandedPayoutId, setExpandedPayoutId] = useState<string | null>(null);
  const [costRateWarningDismissed, setCostRateWarningDismissed] = useState(false);

  const [payTeamMemberId, setPayTeamMemberId] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payDate, setPayDate] = useState(new Date().toISOString().split("T")[0]);
  const [payMethod, setPayMethod] = useState("");
  const [payReference, setPayReference] = useState("");
  const [payPeriodStart, setPayPeriodStart] = useState("");
  const [payPeriodEnd, setPayPeriodEnd] = useState("");
  const [payNotes, setPayNotes] = useState("");
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(new Set());

  const { data: summary, isLoading: summaryLoading, isError: summaryError, refetch: refetchSummary } = useQuery<TeamMemberSummary[]>({
    queryKey: ["/api/payouts/summary"],
  });

  const { data: payouts, isLoading: payoutsLoading, isError: payoutsError, refetch: refetchPayouts } = useQuery<Payout[]>({
    queryKey: ["/api/payouts"],
  });

  const { data: unpaidEntries } = useQuery<UnpaidEntry[]>({
    queryKey: ["/api/payouts/team-member", payTeamMemberId, "unpaid"],
    enabled: !!payTeamMemberId,
    queryFn: async () => {
      const res = await fetch(`/api/payouts/team-member/${payTeamMemberId}/unpaid`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch unpaid entries");
      return res.json();
    },
  });

  const createPayoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/payouts", {
        teamMemberId: payTeamMemberId,
        amount: effectiveAmount,
        payoutDate: payDate,
        paymentMethod: payMethod,
        referenceNumber: payReference || null,
        periodStart: effectivePeriodStart || null,
        periodEnd: effectivePeriodEnd || null,
        notes: payNotes || null,
        // Only link entries that belong to the current member's selection. If the
        // selection collapsed (e.g. after switching members) selectedPayout is
        // null and this is an ad-hoc payout, not a phantom itemized one.
        timeEntryIds: selectedPayout ? Array.from(selectedEntryIds) : [],
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payouts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payouts/summary"] });
      setPayoutDialogOpen(false);
      resetForm();
      toast({ title: "Payment recorded successfully" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const voidPayoutMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("PATCH", `/api/payouts/${id}`, { status: "VOID" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payouts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payouts/summary"] });
      toast({ title: "Payment voided" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const executePayoutMutation = useMutation({
    mutationFn: async (payoutId: string) => {
      const res = await apiRequest("POST", `/api/payouts/${payoutId}/execute`);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/payouts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payouts/summary"] });
      toast({ title: "Payment sent", description: `Transfer ${data.transferId} initiated via Stripe Connect.` });
    },
    onError: (err: Error) => {
      toast({ title: "Transfer failed", description: err.message, variant: "destructive" });
    },
  });

  const bulkExecuteMutation = useMutation({
    mutationFn: async () => {
      const pendingIds = filteredPayouts.filter(p => p.status === "PENDING" && !p.stripeTransferId).map(p => p.id);
      const res = await apiRequest("POST", "/api/payouts/execute-bulk", { payoutIds: pendingIds });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/payouts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payouts/summary"] });
      const succeeded = data.results?.filter((r: any) => r.success).length || 0;
      const failed = data.results?.filter((r: any) => !r.success).length || 0;
      toast({ title: "Bulk payment complete", description: `${succeeded} sent, ${failed} skipped or failed.` });
    },
    onError: (err: Error) => {
      toast({ title: "Bulk payment failed", description: err.message, variant: "destructive" });
    },
  });

  function resetForm() {
    setPayTeamMemberId("");
    setPayAmount("");
    setPayDate(new Date().toISOString().split("T")[0]);
    setPayMethod("");
    setPayReference("");
    setPayPeriodStart("");
    setPayPeriodEnd("");
    setPayNotes("");
    setSelectedEntryIds(new Set());
    setSelectedTeamMember(null);
  }

  function openPayoutForTeamMember(c: TeamMemberSummary) {
    setSelectedTeamMember(c);
    setPayTeamMemberId(c.teamMemberId);
    // Pre-fill the UNPAID TIME value only — never the combined balance, which
    // also includes already-pending payouts and would double-pay them. For an
    // itemized payout the server re-derives the total from the selected lines.
    setPayAmount(String(c.unpaidTimeValue));
    setPayMethod(c.paymentMethod || "");
    setPayoutDialogOpen(true);
  }

  function toggleEntrySelection(id: string) {
    setSelectedEntryIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // When the admin checks specific time entries, the payout is itemized: the
  // server derives the recorded amount from exactly those entries (and ignores
  // the typed amount), so the dialog must show the same thing. Sum the selected
  // entries' per-line values (each already rounded to the cent server-side) and
  // span their dates. Filtering against the CURRENT member's unpaidEntries means
  // a selection left over from another member collapses to null (and is dropped
  // from the submit below) rather than booking a phantom payout.
  const selectedPayout = useMemo(() => {
    if (!unpaidEntries) return null;
    const selected = unpaidEntries.filter(e => selectedEntryIds.has(e.id));
    if (selected.length === 0) return null;
    const amount = round2(selected.reduce((s, e) => s + (e.value || 0), 0));
    const dates = selected.map(e => e.date).sort();
    return { amount, count: selected.length, start: dates[0], end: dates[dates.length - 1] };
  }, [unpaidEntries, selectedEntryIds]);

  // The amount + period that will actually be recorded. When entries are
  // selected these are derived (and the inputs below are disabled); otherwise
  // they are the ad-hoc values the admin typed. Computed for display + submit
  // only — never written back into the ad-hoc form state, so clearing the
  // selection instantly restores whatever the admin had entered by hand.
  const effectiveAmount = selectedPayout ? selectedPayout.amount.toFixed(2) : payAmount;
  const effectivePeriodStart = selectedPayout ? selectedPayout.start : payPeriodStart;
  const effectivePeriodEnd = selectedPayout ? selectedPayout.end : payPeriodEnd;

  const totalUnpaidTimeValue = summary?.reduce((s, c) => s + c.unpaidTimeValue, 0) || 0;
  const totalPendingPayoutAmount = summary?.reduce((s, c) => s + c.pendingPayoutAmount, 0) || 0;
  const totalOwed = totalUnpaidTimeValue + totalPendingPayoutAmount;
  const totalPaidAllTime = summary?.reduce((s, c) => s + c.totalPaidOut, 0) || 0;
  const teamMembersWithBalance = summary?.filter(c => c.amountOwed > 0).length || 0;
  const totalUnpaidHours = summary?.reduce((s, c) => s + c.unpaidHours, 0) || 0;
  const unpaidTeamMemberCount = summary?.filter(c => c.unpaidHours > 0).length || 0;
  const pendingPayoutsCount = payouts?.filter(p => p.status === "PENDING" && !p.stripeTransferId).length || 0;

  const membersMissingCostRate = useMemo(
    () => (summary || []).filter(c => c.costRateMissing && (c.costRateMissingProjects?.length || 0) > 0),
    [summary],
  );
  const missingProjectCount = useMemo(() => {
    const ids = new Set<string>();
    for (const m of membersMissingCostRate) {
      for (const p of m.costRateMissingProjects || []) ids.add(p.projectId);
    }
    return ids.size;
  }, [membersMissingCostRate]);
  const membersNeedingDecision = useMemo(
    () => membersMissingCostRate.filter(m => m.noDerivableCostRate),
    [membersMissingCostRate],
  );
  const missingSignature = useMemo(
    () => membersMissingCostRate
      .map(m => `${m.teamMemberId}:${(m.costRateMissingProjects || []).map(p => p.projectId).sort().join(",")}`)
      .sort()
      .join("|"),
    [membersMissingCostRate],
  );
  useEffect(() => {
    setCostRateWarningDismissed(false);
  }, [missingSignature]);
  const showCostRateWarning = membersMissingCostRate.length > 0 && !costRateWarningDismissed;

  const filteredPayouts = useMemo(() => {
    if (!payouts) return [];
    let result = [...payouts];
    if (statusFilter !== "ALL") result = result.filter(p => p.status === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      const nameMap: Record<string, string> = {};
      summary?.forEach(c => { nameMap[c.teamMemberId] = c.teamMemberName.toLowerCase(); });
      result = result.filter(p =>
        nameMap[p.teamMemberId]?.includes(q) || p.paymentMethod?.toLowerCase().includes(q) || p.referenceNumber?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [payouts, statusFilter, search, summary]);

  const teamMemberName = (id: string) => {
    const fromPayout = payouts?.find((p: any) => p.teamMemberId === id);
    if (fromPayout?.teamMemberName && fromPayout.teamMemberName !== "Unknown") return fromPayout.teamMemberName;
    return summary?.find(c => c.teamMemberId === id)?.teamMemberName || "Unknown";
  };

  if (summaryLoading) {
    return (
      <div className="px-6 lg:px-8 xl:px-10 py-6 space-y-6">
        <div className="flex items-center gap-4"><Skeleton className="h-12 w-12 rounded-xl" /><div><Skeleton className="h-7 w-40 rounded-lg" /><Skeleton className="h-4 w-56 rounded-md mt-1.5" /></div></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (summaryError || payoutsError) {
    return (
      <div className="px-6 lg:px-8 xl:px-10 py-6">
        <ErrorState title="Failed to load team member payments" description="We couldn't load payment data. Please try again." onRetry={() => { refetchSummary(); refetchPayouts(); }} />
      </div>
    );
  }

  return (
    <div className="px-6 lg:px-8 xl:px-10 py-6 space-y-6">
      <PageBreadcrumbs group="Management" page="Payouts" />
      <PageHeader
        icon={DollarSign}
        title="Payouts"
        subtitle="Track and record team member payments"
        actions={
          <div className="flex items-center gap-2">
            {pendingPayoutsCount > 0 && (
              <Button
                variant="outline"
                onClick={() => bulkExecuteMutation.mutate()}
                disabled={bulkExecuteMutation.isPending}
                data-testid="button-pay-all-pending"
              >
                <Send className="w-4 h-4 mr-2" />
                {bulkExecuteMutation.isPending ? "Sending..." : `Pay All Pending (${pendingPayoutsCount})`}
              </Button>
            )}
            <Button
              className="text-white"
              style={{ background: "var(--gradient-brand)" }}
              onClick={() => { resetForm(); setPayoutDialogOpen(true); }}
              data-testid="button-new-payout"
            >
              <Plus className="w-4 h-4 mr-2" /> Record Payment
            </Button>
          </div>
        }
      />

      {showCostRateWarning && (
        <div
          role="alert"
          data-testid="alert-cost-rate-missing"
          className="rounded-xl border p-4 flex gap-3 items-start"
          style={{
            background: "rgba(245,158,11,0.08)",
            borderColor: "rgba(245,158,11,0.4)",
          }}
        >
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: "#f59e0b" }} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold" style={{ color: "var(--lux-text)" }} data-testid="text-cost-rate-warning-title">
              Missing cost rate{missingProjectCount === 1 ? "" : "s"} blocking accurate payouts
            </p>
            <p className="text-xs mt-1" style={{ color: "var(--lux-text-muted)" }}>
              {membersMissingCostRate.length} team member{membersMissingCostRate.length === 1 ? "" : "s"} {membersMissingCostRate.length === 1 ? "has" : "have"} unpaid time on {missingProjectCount} project{missingProjectCount === 1 ? "" : "s"} without a cost rate. Set a cost rate before invoicing or paying out so amounts are correct.
            </p>
            {membersNeedingDecision.length > 0 && (
              <p
                className="text-xs mt-1 font-medium"
                style={{ color: "#b45309" }}
                data-testid="text-cost-rate-needs-decision"
              >
                {membersNeedingDecision.length} of these {membersNeedingDecision.length === 1 ? "has" : "have"} no rate on file anywhere — pick a fresh cost rate for them rather than relying on a past snapshot.
              </p>
            )}
            <ul className="mt-2 space-y-1.5">
              {membersMissingCostRate.slice(0, 5).map(m => (
                <li key={m.teamMemberId} className="text-xs" data-testid={`item-cost-rate-missing-${m.teamMemberId}`}>
                  <span className="font-medium" style={{ color: "var(--lux-text)" }}>{m.teamMemberName}:</span>{" "}
                  {(m.costRateMissingProjects || []).map((p, i) => (
                    <span key={p.projectId}>
                      {i > 0 && ", "}
                      <Link
                        href={`/projects/${p.projectId}`}
                        className="underline hover:opacity-80"
                        style={{ color: "#b45309" }}
                        data-testid={`link-fix-cost-rate-${p.projectId}`}
                      >
                        {p.projectName}
                      </Link>
                      <CostRateInlineEditor
                        projectId={p.projectId}
                        userId={m.teamMemberId}
                        teamMemberName={m.teamMemberName}
                        projectName={p.projectName}
                        baseCurrency={baseCurrency}
                      />
                    </span>
                  ))}
                </li>
              ))}
              {membersMissingCostRate.length > 5 && (
                <li className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
                  …and {membersMissingCostRate.length - 5} more team member{membersMissingCostRate.length - 5 === 1 ? "" : "s"}
                </li>
              )}
            </ul>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={() => setCostRateWarningDismissed(true)}
            aria-label="Dismiss missing cost rate warning"
            data-testid="button-dismiss-cost-rate-warning"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Clock}
          label="Unpaid Time Value"
          value={formatMoney(totalUnpaidTimeValue, baseCurrency)}
          color="#3b82f6"
          subValue={`${formatHours(totalUnpaidHours)}h across ${unpaidTeamMemberCount} team member${unpaidTeamMemberCount !== 1 ? "s" : ""}`}
          tooltip="Sum of (unpaid hours × cost rate) for time entries not yet linked to any payment."
          testId="stat-card-unpaid-time-value"
        />
        <StatCard
          icon={Send}
          label="Pending Payments"
          value={formatMoney(totalPendingPayoutAmount, baseCurrency)}
          color="#f59e0b"
          subValue={`${pendingPayoutsCount} payment${pendingPayoutsCount !== 1 ? "s" : ""} queued`}
          tooltip="Sum of recorded payments in PENDING status — approved but not yet executed."
          testId="stat-card-pending-payouts"
        />
        <StatCard
          icon={DollarSign}
          label="Total Owed"
          value={formatMoney(totalOwed, baseCurrency)}
          color="#ef4444"
          subValue={`${teamMembersWithBalance} team member${teamMembersWithBalance !== 1 ? "s" : ""} with balance`}
          tooltip="Unpaid Time Value + Pending Payouts. The total amount the firm owes across all team members."
          testId="stat-card-total-owed"
        />
        <StatCard
          icon={DollarSign}
          label="Total Paid (All Time)"
          value={formatMoney(totalPaidAllTime, baseCurrency)}
          color="#22c55e"
          tooltip="Sum of all completed payments to date."
          testId="stat-card-total-paid"
        />
      </div>

      <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
        <CardContent className="p-5">
          <h2 className="text-sm font-bold uppercase tracking-wider mb-4" style={{ color: "var(--lux-text-secondary)" }}>
            Outstanding Balances
          </h2>
          {(!summary || summary.length === 0) ? (
            <p className="text-sm py-8 text-center" style={{ color: "var(--lux-text-muted)" }}>No active team members found</p>
          ) : (
            <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
              {summary.filter(c => c.unpaidTimeValue > 0).sort((a, b) => b.unpaidTimeValue - a.unpaidTimeValue).map(c => (
                <div
                  key={c.teamMemberId}
                  className="flex items-center gap-3 p-3 rounded-lg transition-colors"
                  style={{ background: "var(--lux-bg)", border: "1px solid var(--lux-border)" }}
                >
                  <AvatarInitials name={c.teamMemberName} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: "var(--lux-text)" }}>{c.teamMemberName}</p>
                    <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
                      {formatHours(c.unpaidHours)}h unpaid · Last paid {c.lastPayoutDate ? formatRelativeDate(c.lastPayoutDate) : "Never"}
                    </p>
                  </div>
                  <div className="text-right mr-3">
                    <p className="text-sm font-bold tabular-nums" style={{ color: "#f59e0b" }}>{formatMoney(c.unpaidTimeValue, baseCurrency)}</p>
                    {c.paymentMethod && (
                      <p className="text-[10px]" style={{ color: "var(--lux-text-muted)" }}>via {c.paymentMethod}</p>
                    )}
                  </div>
                  <Button size="sm" className="text-white" style={{ background: "var(--gradient-brand)" }} onClick={() => openPayoutForTeamMember(c)} data-testid={`button-pay-${c.teamMemberId}`}>
                    Pay
                  </Button>
                </div>
              ))}
              {summary.filter(c => c.unpaidTimeValue <= 0).length > 0 && (
                <p className="text-xs pt-2" style={{ color: "var(--lux-text-muted)" }}>
                  {summary.filter(c => c.unpaidTimeValue <= 0).length} team member(s) with no unpaid time
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
        <CardContent className="p-5">
          {(() => {
            const statusLabels: Record<string, string> = {
              COMPLETED: "Completed",
              PENDING: "Pending",
              VOID: "Void",
            };
            const chips: FilterChipDescriptor[] = [];
            if (statusFilter !== "ALL") {
              chips.push({
                id: "hub-filter",
                label: hubFilter?.label || `Status: ${statusLabels[statusFilter] || statusFilter}`,
                onClear: () => { setStatusFilter("ALL"); setHubFilter(null); },
              });
            }
            if (search) {
              chips.push({
                id: "search",
                label: `Search: "${search}"`,
                onClear: () => setSearch(""),
              });
            }
            return <ActiveFilterBar chips={chips} className="mb-4" />;
          })()}
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-secondary)" }}>
              Payment History
            </h2>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: "var(--lux-text-muted)" }} />
                <Input className="pl-8 h-8 w-48 text-sm" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} aria-label="Search payments" />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={() => {
                  if (!filteredPayouts.length) return;
                  const headers = ["Date","Team Member","Amount","Method","Status","Reference","Notes"];
                  const rows = filteredPayouts.map(p => [
                    p.payoutDate || "",
                    teamMemberName(p.teamMemberId),
                    Number(p.amount).toFixed(2),
                    p.paymentMethod || "",
                    p.status || "",
                    p.referenceNumber || "",
                    (p.notes || "").replace(/"/g, '""'),
                  ]);
                  const csv = [headers.join(","), ...rows.map(r => r.map(v => `"${v}"`).join(","))].join("\n");
                  const blob = new Blob([csv], { type: "text/csv" });
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = `payouts-${new Date().toISOString().slice(0,10)}.csv`;
                  a.click();
                  URL.revokeObjectURL(a.href);
                }}
                disabled={!filteredPayouts.length}
                data-testid="button-export-payouts-csv"
              >
                <Download className="w-3.5 h-3.5" /> Export CSV
              </Button>
              <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setHubFilter(null); }}>
                <SelectTrigger className="h-8 w-[120px] text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All</SelectItem>
                  <SelectItem value="COMPLETED">Completed</SelectItem>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="VOID">Void</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {payoutsLoading ? (
            <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>
          ) : filteredPayouts.length === 0 ? (
            <p className="text-sm py-8 text-center" style={{ color: "var(--lux-text-muted)" }}>No payments recorded yet</p>
          ) : (
            <div className="space-y-1 max-h-[480px] overflow-y-auto pr-1">
              {filteredPayouts.map(p => (
                <div key={p.id}>
                  <div
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors hover:opacity-90"
                    style={{ background: "var(--lux-bg)", border: "1px solid var(--lux-border)" }}
                    onClick={() => setExpandedPayoutId(expandedPayoutId === p.id ? null : p.id)}
                  >
                    {expandedPayoutId === p.id ? <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--lux-text-muted)" }} /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--lux-text-muted)" }} />}
                    <AvatarInitials name={teamMemberName(p.teamMemberId)} size="xs" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>{teamMemberName(p.teamMemberId)}</span>
                      {p.periodStart && p.periodEnd && (
                        <span className="text-xs ml-2" style={{ color: "var(--lux-text-muted)" }}>
                          {formatDate(p.periodStart)} – {formatDate(p.periodEnd)}
                        </span>
                      )}
                    </div>
                    <StatusBadge status={p.status} size="xs" />
                    <StatusBadge status={p.paymentMethod?.toUpperCase() || "OTHER"} size="xs" />
                    {p.stripeTransferStatus && (
                      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{
                        background: p.stripeTransferStatus === "paid" ? "rgba(34,197,94,0.1)" : p.stripeTransferStatus === "failed" ? "rgba(239,68,68,0.1)" : "rgba(245,158,11,0.1)",
                        color: p.stripeTransferStatus === "paid" ? "#22c55e" : p.stripeTransferStatus === "failed" ? "#ef4444" : "#f59e0b",
                      }}>
                        <Zap className="w-2.5 h-2.5" />
                        {p.stripeTransferStatus === "paid" ? "Sent" : p.stripeTransferStatus === "failed" ? "Failed" : "Sending"}
                      </span>
                    )}
                    <span className="text-sm font-bold tabular-nums min-w-[80px] text-right" style={{ color: "var(--lux-text)" }}>
                      {formatMoney(Number(p.amount), baseCurrency)}
                    </span>
                    <span className="text-xs min-w-[70px] text-right" style={{ color: "var(--lux-text-muted)" }}>
                      {formatDate(p.payoutDate)}
                    </span>
                    {p.status === "PENDING" && !p.stripeTransferId && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={e => { e.stopPropagation(); executePayoutMutation.mutate(p.id); }} disabled={executePayoutMutation.isPending} data-testid={`button-execute-payout-${p.id}`} aria-label="Execute payout">
                            <Send className="w-3.5 h-3.5 text-blue-500" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Send via Stripe Connect</TooltipContent>
                      </Tooltip>
                    )}
                    {(p.status === "COMPLETED" || p.status === "PENDING") && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={e => { e.stopPropagation(); voidPayoutMutation.mutate(p.id); }} aria-label="Void payout">
                            <XCircle className="w-3.5 h-3.5 text-red-400" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Void this payment</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                  {expandedPayoutId === p.id && (
                    <div className="ml-8 mt-1 mb-2 p-3 rounded-lg text-xs space-y-1" style={{ background: "var(--lux-bg)", border: "1px dashed var(--lux-border)" }}>
                      {p.referenceNumber && <p><strong>Reference:</strong> {p.referenceNumber}</p>}
                      {p.stripeTransferId && <p><strong>Stripe Transfer:</strong> {p.stripeTransferId}</p>}
                      {p.notes && <p><strong>Notes:</strong> {p.notes}</p>}
                      <p style={{ color: "var(--lux-text-muted)" }}>Created {formatDate(p.createdAt)}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={payoutDialogOpen} onOpenChange={v => { if (!v) { setPayoutDialogOpen(false); resetForm(); } else setPayoutDialogOpen(true); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto overflow-x-hidden" style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}>
          <DialogHeader>
            <DialogTitle style={{ color: "var(--lux-text)" }}>
              Record Payment{selectedTeamMember ? ` — ${selectedTeamMember.teamMemberName}` : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2 min-w-0">
            <FormSection title="Team Member">
              {selectedTeamMember ? (
                <div className="flex items-center gap-2 p-2 rounded-lg min-w-0" style={{ background: "var(--lux-bg)" }}>
                  <div className="shrink-0"><AvatarInitials name={selectedTeamMember.teamMemberName} size="sm" /></div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: "var(--lux-text)" }}>{selectedTeamMember.teamMemberName}</p>
                    <p className="text-xs truncate" style={{ color: "var(--lux-text-muted)" }}>{selectedTeamMember.teamMemberEmail}</p>
                  </div>
                </div>
              ) : summary && summary.length === 0 ? (
                <p className="text-sm py-2 px-3 rounded-lg" style={{ color: "var(--lux-text-muted)", background: "var(--lux-bg)" }} data-testid="text-no-team-members">
                  No team members found. Add team members to record payments.
                </p>
              ) : (
                <Select value={payTeamMemberId} onValueChange={v => { setPayTeamMemberId(v); setSelectedEntryIds(new Set()); }}>
                  <SelectTrigger data-testid="select-payout-team-member"><SelectValue placeholder="Select team member" /></SelectTrigger>
                  <SelectContent>
                    {summary?.map(c => (
                      <SelectItem key={c.teamMemberId} value={c.teamMemberId}>{c.teamMemberName} — {formatMoney(c.unpaidTimeValue, baseCurrency)} unpaid</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormSection>

            <FormSection title="Payment Details">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Amount *</Label>
                  <Input type="number" min="0" step="0.01" value={effectiveAmount} onChange={e => setPayAmount(e.target.value)} placeholder="0.00" disabled={!!selectedPayout} data-testid="input-payout-amount" />
                  {selectedPayout && (
                    <p className="text-[11px] leading-tight" style={{ color: "var(--lux-text-muted)" }}>
                      Total of {selectedPayout.count} selected time {selectedPayout.count === 1 ? "entry" : "entries"}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Date *</Label>
                  <Input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} data-testid="input-payout-date" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Method *</Label>
                  <Select value={payMethod} onValueChange={setPayMethod}>
                    <SelectTrigger data-testid="select-payout-method"><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="STRIPE_CONNECT">Stripe Connect</SelectItem>
                      <SelectItem value="ACH">ACH</SelectItem>
                      <SelectItem value="Zelle">Zelle</SelectItem>
                      <SelectItem value="Check">Check</SelectItem>
                      <SelectItem value="Wire">Wire</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Reference #</Label>
                  <Input value={payReference} onChange={e => setPayReference(e.target.value)} placeholder="Check #, trace ID" data-testid="input-payout-reference" />
                </div>
              </div>
            </FormSection>

            <FormSection title="Period">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">From</Label>
                  <Input type="date" value={effectivePeriodStart} onChange={e => setPayPeriodStart(e.target.value)} disabled={!!selectedPayout} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">To</Label>
                  <Input type="date" value={effectivePeriodEnd} onChange={e => setPayPeriodEnd(e.target.value)} disabled={!!selectedPayout} />
                </div>
              </div>
              {selectedPayout && (
                <p className="text-[11px] leading-tight pt-1" style={{ color: "var(--lux-text-muted)" }}>
                  Set from the dates of the selected time entries
                </p>
              )}
            </FormSection>

            {unpaidEntries && unpaidEntries.length > 0 && (
              <FormSection title={`Link Time Entries (${unpaidEntries.length} unpaid)`}>
                <div className="max-h-40 overflow-y-auto overflow-x-hidden space-y-1 rounded-lg p-2" style={{ background: "var(--lux-bg)", border: "1px solid var(--lux-border)" }}>
                  <div className="flex items-center gap-2 pb-1 mb-1" style={{ borderBottom: "1px solid var(--lux-border)" }}>
                    <Checkbox
                      checked={selectedEntryIds.size === unpaidEntries.length}
                      onCheckedChange={v => {
                        if (v) setSelectedEntryIds(new Set(unpaidEntries.map(e => e.id)));
                        else setSelectedEntryIds(new Set());
                      }}
                    />
                    <span className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Select All</span>
                  </div>
                  {unpaidEntries.map(e => (
                    <div key={e.id} className="flex items-center gap-2 py-0.5 min-w-0">
                      <Checkbox checked={selectedEntryIds.has(e.id)} onCheckedChange={() => toggleEntrySelection(e.id)} />
                      <span className="text-xs tabular-nums shrink-0" style={{ color: "var(--lux-text-muted)" }}>{formatDate(e.date)}</span>
                      <span className="text-xs font-medium shrink-0" style={{ color: "var(--lux-text)" }}>{Math.round(e.minutes / 60 * 100) / 100}h</span>
                      <span className="text-xs truncate flex-1 min-w-0" style={{ color: "var(--lux-text-muted)" }} title={e.notes || undefined}>{e.notes || "—"}</span>
                      <span className="text-xs font-semibold tabular-nums shrink-0" style={{ color: "var(--lux-text)" }}>{formatMoney(e.value, baseCurrency)}</span>
                      {e.invoiced && <StatusBadge status="BILLED" size="xs" />}
                    </div>
                  ))}
                </div>
              </FormSection>
            )}

            <FormSection title="Notes">
              <Input value={payNotes} onChange={e => setPayNotes(e.target.value)} placeholder="Optional notes" data-testid="input-payout-notes" />
            </FormSection>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => { setPayoutDialogOpen(false); resetForm(); }}>Cancel</Button>
              <Button
                className="text-white"
                style={{ background: "var(--gradient-brand)" }}
                onClick={() => createPayoutMutation.mutate()}
                disabled={!payTeamMemberId || !(Number(effectiveAmount) > 0) || !payDate || !payMethod || createPayoutMutation.isPending}
                data-testid="button-submit-payout"
              >
                {createPayoutMutation.isPending ? "Recording..." : "Record Payment"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
