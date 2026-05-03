import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { PageHelpLink } from "@/components/page-help-link";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Plus, FileStack, Send, CheckCircle, XCircle, Eye, Pencil, Trash2, Receipt, DollarSign, Banknote, ArrowLeft,
} from "lucide-react";
import { useLocation } from "wouter";
import { formatMoney, formatDate } from "@/components/shared/format";
import { useBaseCurrency } from "@/hooks/use-base-currency";
import { EmptyState } from "@/components/shared/empty-state";
import { useDocumentTitle } from "@/lib/use-document-title";

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "#6b7280",
  SUBMITTED: "#3b82f6",
  APPROVED: "#22c55e",
  REJECTED: "#ef4444",
  REIMBURSED: "#a855f7",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
      style={{ background: `${STATUS_COLORS[status] || "#6b7280"}15`, color: STATUS_COLORS[status] || "#6b7280" }}
      data-testid={`badge-status-${status.toLowerCase()}`}>
      {status}
    </span>
  );
}

export default function ExpenseReportsPage() {
  useDocumentTitle("Expense Reports");
  const { user } = useAuth();
  const baseCurrency = useBaseCurrency();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const isAdmin = user?.role === "ADMIN";
  const canManage = user?.role === "ADMIN" || user?.role === "MANAGER";

  const [showCreate, setShowCreate] = useState(false);
  const [editReport, setEditReport] = useState<any>(null);
  const [viewReport, setViewReport] = useState<any>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [showAddExpenses, setShowAddExpenses] = useState(false);

  const [formTitle, setFormTitle] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formPeriodStart, setFormPeriodStart] = useState("");
  const [formPeriodEnd, setFormPeriodEnd] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [selectedExpenseIds, setSelectedExpenseIds] = useState<Set<string>>(new Set());

  const queryKeyList = canManage ? "/api/expense-reports" : "/api/my/expense-reports";

  const { data: reports, isLoading } = useQuery<any[]>({
    queryKey: [queryKeyList],
  });

  const { data: myExpenses } = useQuery<any[]>({
    queryKey: ["/api/my/expenses"],
    enabled: showCreate || showAddExpenses,
  });

  const availableExpenses = (myExpenses || []).filter(
    (e: any) => e.status === "DRAFT" && !e.reportId
  );

  const createMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/expense-reports", {
        title: formTitle,
        description: formDescription || undefined,
        periodStart: formPeriodStart || undefined,
        periodEnd: formPeriodEnd || undefined,
        notes: formNotes || null,
        expenseIds: Array.from(selectedExpenseIds),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [queryKeyList] });
      queryClient.invalidateQueries({ queryKey: ["/api/my/expenses"] });
      resetForm();
      setShowCreate(false);
      toast({ title: "Expense report created" });
    },
    onError: (err: Error) => { toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/expense-reports/${editReport.id}`, {
        title: formTitle,
        description: formDescription || undefined,
        periodStart: formPeriodStart || undefined,
        periodEnd: formPeriodEnd || undefined,
        notes: formNotes || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [queryKeyList] });
      queryClient.invalidateQueries({ queryKey: ["/api/expense-reports", editReport.id] });
      resetForm();
      setEditReport(null);
      toast({ title: "Expense report updated" });
    },
    onError: (err: Error) => { toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  const submitMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("POST", `/api/expense-reports/${id}/submit`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [queryKeyList] });
      queryClient.invalidateQueries({ queryKey: [canManage ? "/api/expenses" : "/api/my/expenses"] });
      toast({ title: "Expense report submitted for approval" });
    },
    onError: (err: Error) => { toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("POST", `/api/expense-reports/${id}/approve`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expense-reports"] });
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      invalidateDetail();
      toast({ title: "Expense report approved" });
    },
    onError: (err: Error) => { toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  const rejectMutation = useMutation({
    mutationFn: async () => { await apiRequest("POST", `/api/expense-reports/${rejectId}/reject`, { reason: rejectReason }); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expense-reports"] });
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      setRejectId(null);
      setRejectReason("");
      invalidateDetail();
      toast({ title: "Expense report rejected" });
    },
    onError: (err: Error) => { toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  const reimburseMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("POST", `/api/expense-reports/${id}/reimburse`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expense-reports"] });
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      invalidateDetail();
      toast({ title: "Expense report marked as reimbursed" });
    },
    onError: (err: Error) => { toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  const addExpenseMutation = useMutation({
    mutationFn: async ({ reportId, expenseId }: { reportId: string; expenseId: string }) => {
      await apiRequest("POST", `/api/expense-reports/${reportId}/add-expense`, { expenseId });
    },
    onSuccess: () => {
      if (viewReport) queryClient.invalidateQueries({ queryKey: ["/api/expense-reports", viewReport.id] });
      queryClient.invalidateQueries({ queryKey: [queryKeyList] });
      queryClient.invalidateQueries({ queryKey: ["/api/my/expenses"] });
    },
    onError: (err: Error) => { toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  const removeExpenseMutation = useMutation({
    mutationFn: async ({ reportId, expenseId }: { reportId: string; expenseId: string }) => {
      await apiRequest("POST", `/api/expense-reports/${reportId}/remove-expense`, { expenseId });
    },
    onSuccess: () => {
      if (viewReport) queryClient.invalidateQueries({ queryKey: ["/api/expense-reports", viewReport.id] });
      queryClient.invalidateQueries({ queryKey: [queryKeyList] });
      queryClient.invalidateQueries({ queryKey: ["/api/my/expenses"] });
    },
    onError: (err: Error) => { toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  const { data: reportDetail } = useQuery<any>({
    queryKey: ["/api/expense-reports", viewReport?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/expense-reports/${viewReport.id}`);
      return res.json();
    },
    enabled: !!viewReport,
  });

  function invalidateDetail() {
    if (viewReport) {
      queryClient.invalidateQueries({ queryKey: ["/api/expense-reports", viewReport.id] });
    }
  }

  function resetForm() {
    setFormTitle("");
    setFormDescription("");
    setFormPeriodStart("");
    setFormPeriodEnd("");
    setFormNotes("");
    setSelectedExpenseIds(new Set());
  }

  function openEdit(report: any) {
    setFormTitle(report.title || "");
    setFormDescription(report.description || "");
    setFormPeriodStart(report.periodStart || "");
    setFormPeriodEnd(report.periodEnd || "");
    setFormNotes(report.notes || "");
    setEditReport(report);
  }

  function toggleExpense(id: string) {
    setSelectedExpenseIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedTotal = availableExpenses
    .filter((e: any) => selectedExpenseIds.has(e.id))
    .reduce((s: number, e: any) => s + e.amount, 0);

  if (isLoading) {
    return (
      <div className="px-6 lg:px-8 xl:px-10 py-6 space-y-6">
        <Skeleton className="h-10 w-60 rounded-lg" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    );
  }

  const pendingCount = (reports || []).filter(r => r.status === "SUBMITTED").length;
  const draftCount = (reports || []).filter(r => r.status === "DRAFT").length;
  const approvedCount = (reports || []).filter(r => r.status === "APPROVED").length;
  const totalAmount = (reports || []).reduce((s, r) => s + Number(r.totalAmount || 0), 0);

  const canEditReport = (status: string) => status === "DRAFT" || status === "REJECTED";

  return (
    <div className="px-6 lg:px-8 xl:px-10 py-6 space-y-6">
      <button
        onClick={() => setLocation("/expenses")}
        className="flex items-center gap-1 text-xs hover:underline w-fit"
        style={{ color: "var(--lux-text-muted)" }}
        data-testid="button-back-expenses"
      >
        <ArrowLeft className="w-3 h-3" /> Back to Expenses
      </button>
      <PageBreadcrumbs
        page="Reports"
        showDashboard={false}
        items={[{ label: "Expenses", href: "/expenses", testId: "button-crumb-expenses" }]}
      />
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--lux-text)" }} data-testid="text-expense-reports-title">Expense Reports</h1>
            <PageHelpLink />
          </div>
          <p className="text-sm mt-1" style={{ color: "var(--lux-text-muted)" }}>{canManage ? "Review and approve expense report submissions" : "Group your expenses into reports and submit for approval"}</p>
        </div>
        <Button className="text-white" style={{ background: "var(--gradient-brand)" }} onClick={() => { resetForm(); setShowCreate(true); }} data-testid="button-new-report">
          <Plus className="w-4 h-4 mr-2" /> New Report
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="rounded-xl p-4" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Total Reports</p>
          <p className="text-xl font-bold mt-1 tabular-nums" style={{ color: "var(--lux-text)" }}>{(reports || []).length}</p>
        </div>
        <div className="rounded-xl p-4" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Total Amount</p>
          <p className="text-xl font-bold mt-1 tabular-nums" style={{ color: "var(--lux-text)" }}>{formatMoney(totalAmount, baseCurrency)}</p>
        </div>
        {canManage && (
          <div className="rounded-xl p-4" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Pending Review</p>
            <p className="text-xl font-bold mt-1 tabular-nums" style={{ color: pendingCount > 0 ? "#3b82f6" : "var(--lux-text)" }}>{pendingCount}</p>
          </div>
        )}
        <div className="rounded-xl p-4" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>{canManage ? "Awaiting Reimbursement" : "Drafts"}</p>
          <p className="text-xl font-bold mt-1 tabular-nums" style={{ color: (canManage ? approvedCount : draftCount) > 0 ? "#f59e0b" : "var(--lux-text)" }}>{canManage ? approvedCount : draftCount}</p>
        </div>
      </div>

      <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
        <CardContent className="p-0">
          {!reports?.length ? (
            <div className="p-8">
              <EmptyState icon={FileStack} title="No expense reports" description="Create a report to group and submit expenses for approval." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: "var(--lux-table-header-bg)" }}>
                    <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Report</th>
                    {canManage && <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Submitted By</th>}
                    <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Period</th>
                    <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Expenses</th>
                    <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Total</th>
                    <th className="text-center px-4 py-3 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Status</th>
                    <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((r: any) => (
                    <tr key={r.id} className="border-t hover:bg-black/[0.02] dark:hover:bg-white/[0.02] cursor-pointer" style={{ borderColor: "var(--lux-border)" }} onClick={() => setViewReport(r)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target !== e.currentTarget) return; if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setViewReport(r); } }} data-testid={`row-report-${r.id}`}>
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>{r.title}</p>
                        {r.description && <p className="text-xs mt-0.5 truncate max-w-xs" style={{ color: "var(--lux-text-muted)" }}>{r.description}</p>}
                      </td>
                      {canManage && <td className="px-4 py-3 text-sm" style={{ color: "var(--lux-text-secondary)" }}>{r.userName || "—"}</td>}
                      <td className="px-4 py-3 text-sm tabular-nums" style={{ color: "var(--lux-text-secondary)" }}>
                        {r.periodStart && r.periodEnd ? `${formatDate(r.periodStart)} — ${formatDate(r.periodEnd)}` : r.periodStart ? formatDate(r.periodStart) : "—"}
                      </td>
                      <td className="px-4 py-3 text-sm text-right tabular-nums" style={{ color: "var(--lux-text)" }}>{r.expenseCount}</td>
                      <td className="px-4 py-3 text-sm text-right font-medium tabular-nums" style={{ color: "var(--lux-text)" }}>{formatMoney(r.totalAmount, baseCurrency)}</td>
                      <td className="px-4 py-3 text-center">
                        <StatusBadge status={r.status} />
                        {r.status === "REJECTED" && r.rejectionReason && (
                          <p className="text-[10px] mt-0.5 max-w-[160px] truncate" style={{ color: "#ef4444" }} title={r.rejectionReason} data-testid={`text-rejection-reason-${r.id}`}>
                            Reason: {r.rejectionReason}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setViewReport(r)} data-testid={`button-view-report-${r.id}`}>
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                          {canEditReport(r.status) && (
                            <Button size="sm" variant="ghost" onClick={() => openEdit(r)} data-testid={`button-edit-report-${r.id}`}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {r.status === "DRAFT" && (
                            <Button size="sm" variant="ghost" disabled={submitMutation.isPending} onClick={() => submitMutation.mutate(r.id)} data-testid={`button-submit-report-${r.id}`}>
                              <Send className="w-3.5 h-3.5" style={{ color: "#3b82f6" }} />
                            </Button>
                          )}
                          {canManage && r.status === "SUBMITTED" && (
                            <>
                              <Button size="sm" variant="ghost" disabled={approveMutation.isPending} onClick={() => approveMutation.mutate(r.id)} data-testid={`button-approve-report-${r.id}`}>
                                <CheckCircle className="w-3.5 h-3.5" style={{ color: "#22c55e" }} />
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => { setRejectId(r.id); setRejectReason(""); }} data-testid={`button-reject-report-${r.id}`}>
                                <XCircle className="w-3.5 h-3.5" style={{ color: "#ef4444" }} />
                              </Button>
                            </>
                          )}
                          {canManage && r.status === "APPROVED" && (
                            <Button size="sm" variant="ghost" disabled={reimburseMutation.isPending} onClick={() => reimburseMutation.mutate(r.id)} data-testid={`button-reimburse-report-${r.id}`}>
                              <Banknote className="w-3.5 h-3.5" style={{ color: "#a855f7" }} />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Report Dialog */}
      <Dialog open={showCreate} onOpenChange={(open) => { if (!open) { setShowCreate(false); resetForm(); } }}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto" style={{ background: "var(--lux-surface)" }}>
          <DialogHeader>
            <DialogTitle style={{ color: "var(--lux-text)" }}>New Expense Report</DialogTitle>
          </DialogHeader>
          <ReportForm
            formTitle={formTitle} setFormTitle={setFormTitle}
            formDescription={formDescription} setFormDescription={setFormDescription}
            formPeriodStart={formPeriodStart} setFormPeriodStart={setFormPeriodStart}
            formPeriodEnd={formPeriodEnd} setFormPeriodEnd={setFormPeriodEnd}
            formNotes={formNotes} setFormNotes={setFormNotes}
          />
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs font-bold" style={{ color: "var(--lux-text)" }}>Select Draft Expenses to Include</Label>
              {selectedExpenseIds.size > 0 && (
                <span className="text-xs tabular-nums font-bold" style={{ color: "var(--color-accent)" }}>
                  {selectedExpenseIds.size} selected · {formatMoney(selectedTotal, baseCurrency)}
                </span>
              )}
            </div>
            {availableExpenses.length === 0 ? (
              <div className="rounded-lg p-4 text-center" style={{ background: "var(--lux-surface-alt)" }}>
                <p className="text-sm" style={{ color: "var(--lux-text-muted)" }}>No draft expenses available. Create expenses first, then add them to a report.</p>
              </div>
            ) : (
              <ExpensePickerList expenses={availableExpenses} selectedIds={selectedExpenseIds} onToggle={toggleExpense} baseCurrency={baseCurrency} />
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => { setShowCreate(false); resetForm(); }}>Cancel</Button>
            <Button
              className="text-white"
              style={{ background: "var(--gradient-brand)" }}
              disabled={!formTitle.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate()}
              data-testid="button-save-report"
            >
              Create Report {selectedExpenseIds.size > 0 && `(${selectedExpenseIds.size} expenses)`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Report Dialog */}
      <Dialog open={!!editReport} onOpenChange={(open) => { if (!open) { setEditReport(null); resetForm(); } }}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto" style={{ background: "var(--lux-surface)" }}>
          <DialogHeader>
            <DialogTitle style={{ color: "var(--lux-text)" }}>Edit Expense Report</DialogTitle>
          </DialogHeader>
          <ReportForm
            formTitle={formTitle} setFormTitle={setFormTitle}
            formDescription={formDescription} setFormDescription={setFormDescription}
            formPeriodStart={formPeriodStart} setFormPeriodStart={setFormPeriodStart}
            formPeriodEnd={formPeriodEnd} setFormPeriodEnd={setFormPeriodEnd}
            formNotes={formNotes} setFormNotes={setFormNotes}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => { setEditReport(null); resetForm(); }}>Cancel</Button>
            <Button
              className="text-white"
              style={{ background: "var(--gradient-brand)" }}
              disabled={!formTitle.trim() || updateMutation.isPending}
              onClick={() => updateMutation.mutate()}
              data-testid="button-update-report"
            >
              Save Changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Report Detail Dialog */}
      <Dialog open={!!viewReport} onOpenChange={(open) => !open && setViewReport(null)}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto" style={{ background: "var(--lux-surface)" }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3" style={{ color: "var(--lux-text)" }}>
              <span className="truncate">{viewReport?.title || "Expense Report"}</span>
              {reportDetail && <StatusBadge status={reportDetail.status} />}
            </DialogTitle>
          </DialogHeader>
          {reportDetail && (
            <div className="space-y-4 pt-2">
              {/* Summary Card */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <SummaryItem label="Total" value={formatMoney(reportDetail.totalAmount, baseCurrency)} accent />
                <SummaryItem label="Expenses" value={String(reportDetail.expenseCount)} />
                <SummaryItem label="Period" value={reportDetail.periodStart ? `${formatDate(reportDetail.periodStart)} — ${formatDate(reportDetail.periodEnd || "...")}` : "—"} />
                <SummaryItem label="Submitted By" value={reportDetail.userName || "—"} />
              </div>

              {reportDetail.description && (
                <p className="text-sm" style={{ color: "var(--lux-text-secondary)" }}>{reportDetail.description}</p>
              )}

              {reportDetail.rejectionReason && (
                <div className="rounded-lg p-3" style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.15)" }}>
                  <p className="text-xs font-bold" style={{ color: "#ef4444" }}>Rejection Reason</p>
                  <p className="text-xs mt-1" style={{ color: "var(--lux-text)" }}>{reportDetail.rejectionReason}</p>
                </div>
              )}

              {/* Linked Expenses */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Linked Expenses</h4>
                  {canEditReport(reportDetail.status) && (
                    <Button size="sm" variant="outline" onClick={() => { setSelectedExpenseIds(new Set()); setShowAddExpenses(true); }} data-testid="button-add-expenses">
                      <Plus className="w-3.5 h-3.5 mr-1" /> Add Expenses
                    </Button>
                  )}
                </div>
                {!reportDetail.expenses?.length ? (
                  <div className="rounded-lg p-4 text-center" style={{ background: "var(--lux-surface-alt)", border: "1px solid var(--lux-border)" }}>
                    <p className="text-sm" style={{ color: "var(--lux-text-muted)" }}>No expenses linked yet.</p>
                  </div>
                ) : (
                  <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--lux-border)" }}>
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ background: "var(--lux-table-header-bg)" }}>
                          <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase" style={{ color: "var(--lux-text-muted)" }}>Date</th>
                          <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase" style={{ color: "var(--lux-text-muted)" }}>Vendor</th>
                          <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase" style={{ color: "var(--lux-text-muted)" }}>Category</th>
                          <th className="text-center px-3 py-2 text-[10px] font-semibold uppercase" style={{ color: "var(--lux-text-muted)" }}>Receipt</th>
                          <th className="text-right px-3 py-2 text-[10px] font-semibold uppercase" style={{ color: "var(--lux-text-muted)" }}>Amount</th>
                          <th className="text-center px-3 py-2 text-[10px] font-semibold uppercase" style={{ color: "var(--lux-text-muted)" }}>Status</th>
                          {canEditReport(reportDetail.status) && (
                            <th className="px-3 py-2 w-10"></th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {reportDetail.expenses.map((exp: any) => (
                          <tr key={exp.id} className="border-t" style={{ borderColor: "var(--lux-border)" }}>
                            <td className="px-3 py-2 tabular-nums" style={{ color: "var(--lux-text)" }}>{formatDate(exp.date)}</td>
                            <td className="px-3 py-2 font-medium" style={{ color: "var(--lux-text)" }}>
                              <div className="flex items-center gap-2">
                                {exp.receiptUrl && exp.receiptUrl.startsWith("/api/uploads/receipts/") && !exp.receiptUrl.endsWith(".pdf") && (
                                  <img src={exp.receiptUrl} alt="" className="w-6 h-6 rounded object-cover flex-shrink-0 hidden sm:block" style={{ border: "1px solid var(--lux-border)" }} />
                                )}
                                <span className="truncate">{exp.vendor || exp.description || "—"}</span>
                              </div>
                            </td>
                            <td className="px-3 py-2" style={{ color: "var(--lux-text-secondary)" }}>{exp.categoryName || "—"}</td>
                            <td className="px-3 py-2 text-center">
                              {exp.receiptUrl ? (
                                <a href={exp.receiptUrl} target="_blank" rel="noopener noreferrer" className="inline-flex">
                                  <Receipt className="w-3.5 h-3.5" style={{ color: "#a855f7" }} />
                                </a>
                              ) : (
                                <span className="text-xs" style={{ color: "var(--lux-text-muted)" }}>—</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right font-medium tabular-nums" style={{ color: "var(--lux-text)" }}>{formatMoney(exp.amount, baseCurrency)}</td>
                            <td className="px-3 py-2 text-center"><StatusBadge status={exp.status} /></td>
                            {canEditReport(reportDetail.status) && (
                              <td className="px-3 py-2 text-center">
                                <button
                                  onClick={() => removeExpenseMutation.mutate({ reportId: reportDetail.id, expenseId: exp.id })}
                                  className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10"
                                  title="Remove from report"
                                  data-testid={`button-remove-expense-${exp.id}`}
                                >
                                  <Trash2 className="w-3.5 h-3.5" style={{ color: "#ef4444" }} />
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {reportDetail.notes && (
                <div className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
                  <span className="font-bold">Notes:</span> {reportDetail.notes}
                </div>
              )}

              {/* Action Buttons */}
              {canManage && reportDetail.status === "SUBMITTED" && (
                <div className="flex items-center gap-2 pt-2 border-t" style={{ borderColor: "var(--lux-border)" }}>
                  <Button className="text-white flex-1" style={{ background: "#22c55e" }} onClick={() => approveMutation.mutate(reportDetail.id)} disabled={approveMutation.isPending} data-testid="button-approve-detail">
                    <CheckCircle className="w-4 h-4 mr-2" /> Approve Report
                  </Button>
                  <Button variant="outline" className="flex-1" style={{ color: "#ef4444", borderColor: "#ef4444" }} onClick={() => { setRejectId(reportDetail.id); setRejectReason(""); }} data-testid="button-reject-detail">
                    <XCircle className="w-4 h-4 mr-2" /> Reject
                  </Button>
                </div>
              )}

              {canManage && reportDetail.status === "APPROVED" && (
                <div className="pt-2 border-t" style={{ borderColor: "var(--lux-border)" }}>
                  <Button className="text-white w-full" style={{ background: "#a855f7" }} onClick={() => reimburseMutation.mutate(reportDetail.id)} disabled={reimburseMutation.isPending} data-testid="button-reimburse-detail">
                    <Banknote className="w-4 h-4 mr-2" /> Mark as Reimbursed
                  </Button>
                </div>
              )}

              {reportDetail.status === "DRAFT" && (
                <div className="flex items-center gap-2 pt-2 border-t" style={{ borderColor: "var(--lux-border)" }}>
                  <Button variant="outline" className="flex-1" onClick={() => { setViewReport(null); openEdit(reportDetail); }} data-testid="button-edit-detail">
                    <Pencil className="w-4 h-4 mr-2" /> Edit Report
                  </Button>
                  <Button className="text-white flex-1" style={{ background: "var(--gradient-brand)" }} onClick={() => { submitMutation.mutate(reportDetail.id); setViewReport(null); }} disabled={!reportDetail.expenseCount} data-testid="button-submit-detail">
                    <Send className="w-4 h-4 mr-2" /> Submit for Approval
                  </Button>
                </div>
              )}

              {reportDetail.status === "REJECTED" && (
                <div className="flex items-center gap-2 pt-2 border-t" style={{ borderColor: "var(--lux-border)" }}>
                  <Button variant="outline" className="flex-1" onClick={() => { setViewReport(null); openEdit(reportDetail); }} data-testid="button-edit-rejected">
                    <Pencil className="w-4 h-4 mr-2" /> Edit & Resubmit
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Add Expenses to Report Dialog */}
      <Dialog open={showAddExpenses} onOpenChange={(open) => { if (!open) setShowAddExpenses(false); }}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto" style={{ background: "var(--lux-surface)" }}>
          <DialogHeader>
            <DialogTitle style={{ color: "var(--lux-text)" }}>Add Expenses to Report</DialogTitle>
          </DialogHeader>
          {availableExpenses.length === 0 ? (
            <div className="rounded-lg p-4 text-center" style={{ background: "var(--lux-surface-alt)" }}>
              <p className="text-sm" style={{ color: "var(--lux-text-muted)" }}>No draft expenses available to add.</p>
            </div>
          ) : (
            <div className="space-y-1 max-h-80 overflow-y-auto rounded-lg" style={{ border: "1px solid var(--lux-border)" }}>
              {availableExpenses.map((exp: any) => (
                <div
                  key={exp.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
                  style={{ borderBottom: "1px solid var(--lux-border)" }}
                  data-testid={`expense-add-${exp.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium truncate" style={{ color: "var(--lux-text)" }}>{exp.vendor || exp.description || "Expense"}</span>
                      <span className="text-sm tabular-nums font-medium ml-2" style={{ color: "var(--lux-text)" }}>{formatMoney(exp.amount, baseCurrency)}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs" style={{ color: "var(--lux-text-muted)" }}>
                      <span>{formatDate(exp.date)}</span>
                      {exp.categoryName && <span>· {exp.categoryName}</span>}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-shrink-0"
                    onClick={() => {
                      if (viewReport) {
                        addExpenseMutation.mutate({ reportId: viewReport.id, expenseId: exp.id });
                      }
                    }}
                    disabled={addExpenseMutation.isPending}
                    data-testid={`button-add-expense-${exp.id}`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-end pt-2">
            <Button variant="outline" onClick={() => setShowAddExpenses(false)}>Done</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={!!rejectId} onOpenChange={(open) => !open && setRejectId(null)}>
        <DialogContent className="sm:max-w-sm" style={{ background: "var(--lux-surface)" }}>
          <DialogHeader>
            <DialogTitle style={{ color: "var(--lux-text)" }}>Reject Expense Report</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <Textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Reason for rejection..." rows={3} data-testid="input-report-reject-reason" />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRejectId(null)}>Cancel</Button>
              <Button style={{ background: "#ef4444", color: "#fff" }} disabled={!rejectReason.trim() || rejectMutation.isPending} onClick={() => rejectMutation.mutate()} data-testid="button-confirm-reject-report">
                Reject Report
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryItem({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg p-3" style={{ background: "var(--lux-surface-alt)", border: "1px solid var(--lux-border)" }}>
      <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>{label}</p>
      <p className="text-sm font-bold mt-1 tabular-nums truncate" style={{ color: accent ? "var(--color-accent)" : "var(--lux-text)" }}>{value}</p>
    </div>
  );
}

function ReportForm({
  formTitle, setFormTitle,
  formDescription, setFormDescription,
  formPeriodStart, setFormPeriodStart,
  formPeriodEnd, setFormPeriodEnd,
  formNotes, setFormNotes,
}: {
  formTitle: string; setFormTitle: (v: string) => void;
  formDescription: string; setFormDescription: (v: string) => void;
  formPeriodStart: string; setFormPeriodStart: (v: string) => void;
  formPeriodEnd: string; setFormPeriodEnd: (v: string) => void;
  formNotes: string; setFormNotes: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <Label className="text-xs" style={{ color: "var(--lux-text-muted)" }}>Report Title *</Label>
        <Input value={formTitle} onChange={e => setFormTitle(e.target.value)} placeholder="e.g., March 2026 Travel Expenses" className="mt-1" data-testid="input-report-title" />
      </div>
      <div>
        <Label className="text-xs" style={{ color: "var(--lux-text-muted)" }}>Description</Label>
        <Input value={formDescription} onChange={e => setFormDescription(e.target.value)} placeholder="Brief description (optional)" className="mt-1" data-testid="input-report-description" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs" style={{ color: "var(--lux-text-muted)" }}>Period Start</Label>
          <Input type="date" value={formPeriodStart} onChange={e => setFormPeriodStart(e.target.value)} className="mt-1" data-testid="input-report-period-start" />
        </div>
        <div>
          <Label className="text-xs" style={{ color: "var(--lux-text-muted)" }}>Period End</Label>
          <Input type="date" value={formPeriodEnd} onChange={e => setFormPeriodEnd(e.target.value)} className="mt-1" data-testid="input-report-period-end" />
        </div>
      </div>
      <div>
        <Label className="text-xs" style={{ color: "var(--lux-text-muted)" }}>Notes</Label>
        <Textarea value={formNotes} onChange={e => setFormNotes(e.target.value)} placeholder="Additional notes..." className="mt-1" rows={2} data-testid="input-report-notes" />
      </div>
    </div>
  );
}

function ExpensePickerList({ expenses, selectedIds, onToggle, baseCurrency }: { expenses: any[]; selectedIds: Set<string>; onToggle: (id: string) => void; baseCurrency: string }) {
  return (
    <div className="space-y-1 max-h-60 overflow-y-auto rounded-lg" style={{ border: "1px solid var(--lux-border)" }}>
      {expenses.map((exp: any) => (
        <div
          key={exp.id}
          className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
          style={{ borderBottom: "1px solid var(--lux-border)" }}
          onClick={() => onToggle(exp.id)}
          data-testid={`expense-pick-${exp.id}`}
        >
          <Checkbox checked={selectedIds.has(exp.id)} onCheckedChange={() => onToggle(exp.id)} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                {exp.receiptUrl && exp.receiptUrl.startsWith("/api/uploads/receipts/") && !exp.receiptUrl.endsWith(".pdf") && (
                  <img src={exp.receiptUrl} alt="" className="w-6 h-6 rounded object-cover flex-shrink-0" style={{ border: "1px solid var(--lux-border)" }} />
                )}
                <span className="text-sm font-medium truncate" style={{ color: "var(--lux-text)" }}>{exp.vendor || exp.description || "Expense"}</span>
              </div>
              <span className="text-sm tabular-nums font-medium ml-2" style={{ color: "var(--lux-text)" }}>{formatMoney(exp.amount, baseCurrency)}</span>
            </div>
            <div className="flex items-center gap-2 text-xs" style={{ color: "var(--lux-text-muted)" }}>
              <span>{formatDate(exp.date)}</span>
              {exp.categoryName && <span>· {exp.categoryName}</span>}
              {exp.projectName && <span>· {exp.projectName}</span>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
