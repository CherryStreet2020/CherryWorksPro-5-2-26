import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";
import { UpgradeWall } from "@/components/upgrade-wall";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { PageHelpLink } from "@/components/page-help-link";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { useBillingStatus } from "@/hooks/use-billing-status";
import { useToast } from "@/hooks/use-toast";
import type { BankConnection, BankTransaction, BankTransactionMatch, BankReconciliationLog } from "@shared/schema";
import { formatDate, formatMoney } from "@/components/shared/format";
import {
  Building2, Plus, RefreshCw, Trash2, AlertCircle,
  CheckCircle, XCircle, Landmark, CreditCard,
  Search, Calendar, EyeOff, ArrowUpDown, ArrowDownLeft, ArrowUpRight,
  Link2, Sparkles, Check, X, ExternalLink, ClipboardCheck,
  SkipForward, ChevronLeft, History, BarChart3,
  ChevronDown, ChevronUp, ChevronsUpDown, Filter, Download, GripVertical,
  ChevronRight, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { useDocumentTitle } from "@/lib/use-document-title";

type EnrichedMatch = BankTransactionMatch & { entityLabel: string; entityDetails: string };

function ConnectionStatusBadge({ status }: { status: string }) {
  if (status === "ACTIVE") {
    return (
      <Badge variant="secondary" className="text-[10px]" style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e", border: "none" }}>
        <CheckCircle className="w-3 h-3 mr-1" /> Active
      </Badge>
    );
  }
  if (status === "ERROR") {
    return (
      <Badge variant="secondary" className="text-[10px]" style={{ background: "rgba(239,68,68,0.12)", color: "#ef4444", border: "none" }}>
        <AlertCircle className="w-3 h-3 mr-1" /> Error
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="text-[10px]" style={{ background: "rgba(156,163,175,0.12)", color: "#9ca3af", border: "none" }}>
      <XCircle className="w-3 h-3 mr-1" /> Disconnected
    </Badge>
  );
}

const TX_STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  PENDING: { bg: "rgba(156,163,175,0.12)", color: "#9ca3af", label: "Pending" },
  MATCHED: { bg: "rgba(59,130,246,0.12)", color: "#3b82f6", label: "Matched" },
  RECONCILED: { bg: "rgba(34,197,94,0.12)", color: "#22c55e", label: "Reconciled" },
  IGNORED: { bg: "rgba(239,68,68,0.12)", color: "#ef4444", label: "Ignored" },
};

function TxStatusBadge({ status }: { status: string }) {
  const s = TX_STATUS_STYLES[status] || TX_STATUS_STYLES.PENDING;
  return (
    <Badge variant="secondary" className="text-[10px]" style={{ background: s.bg, color: s.color, border: "none" }}>
      {s.label}
    </Badge>
  );
}

function AccountTypeIcon({ type }: { type: string | null }) {
  if (type === "checking" || type === "savings") return <Landmark className="w-5 h-5" style={{ color: "var(--lux-text-muted)" }} />;
  if (type === "credit") return <CreditCard className="w-5 h-5" style={{ color: "var(--lux-text-muted)" }} />;
  return <Building2 className="w-5 h-5" style={{ color: "var(--lux-text-muted)" }} />;
}

function ConfidenceBadge({ confidence }: { confidence: string | null }) {
  const parsed = Number(confidence || 0);
  const val = Number.isNaN(parsed) ? 0 : parsed;
  let color = "#9ca3af";
  let label = "Low";
  if (val >= 85) { color = "#22c55e"; label = "High"; }
  else if (val >= 60) { color = "#f59e0b"; label = "Medium"; }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium tabular-nums" style={{ color }}>
      {val.toFixed(0)}% {label}
    </span>
  );
}

function SummaryCard({ label, value, total, color, icon: Icon }: { label: string; value: number; total: number; color: string; icon: any }) {
  const pct = total > 0 ? ((value / total) * 100).toFixed(1) : "0.0";
  return (
    <Card style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: `${color}15` }}>
            <Icon className="w-4 h-4" style={{ color }} />
          </div>
          <div>
            <div className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>{label}</div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-lg font-bold tabular-nums" style={{ color: "var(--lux-text)" }}>{value}</span>
              <span className="text-[10px] tabular-nums" style={{ color: "var(--lux-text-muted)" }}>{pct}%</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MatchReviewDialog({
  open, onClose, transaction,
}: {
  open: boolean; onClose: () => void; transaction: BankTransaction | null;
}) {
  const { toast } = useToast();
  const { data: matches = [], isLoading } = useQuery<EnrichedMatch[]>({
    queryKey: ["/api/bank-transactions", transaction?.id, "matches"],
    queryFn: async () => {
      if (!transaction) return [];
      const res = await fetch(`/api/bank-transactions/${transaction.id}/matches`, { credentials: "include" });
      return res.json();
    },
    enabled: open && !!transaction,
  });

  const acceptMutation = useMutation({
    mutationFn: async ({ txId, matchId }: { txId: number; matchId: number }) => {
      const res = await apiRequest("POST", `/api/bank-transactions/${txId}/accept-match`, { matchId });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Match accepted", description: "Transaction has been linked to the matched record." });
      queryClient.invalidateQueries({ queryKey: ["/api/bank-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bank-transaction-matches"] });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (matchId: number) => {
      const res = await apiRequest("DELETE", `/api/bank-transaction-matches/${matchId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bank-transactions", transaction?.id, "matches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bank-transaction-matches"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (!transaction) return null;
  const amt = Number(transaction.amount);
  const isCredit = amt > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl" style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" style={{ color: "var(--lux-text)" }}>
            <Link2 className="w-4 h-4" style={{ color: "var(--lux-accent)" }} />
            Suggested Matches
          </DialogTitle>
          <DialogDescription style={{ color: "var(--lux-text-muted)" }}>
            Review potential matches for this transaction
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg p-3 mb-3" style={{ background: "var(--lux-bg)", border: "1px solid var(--lux-border)" }}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>
              {transaction.description || "No description"}
            </span>
            <span className="text-sm font-semibold tabular-nums" style={{ color: isCredit ? "#22c55e" : "var(--lux-text)" }}>
              {isCredit ? "+" : ""}{formatMoney(Math.abs(amt))}
            </span>
          </div>
          <span className="text-xs tabular-nums" style={{ color: "var(--lux-text-muted)" }}>{formatDate(transaction.date)}</span>
        </div>
        {isLoading ? (
          <div className="space-y-2 py-4">{[1, 2].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>
        ) : matches.length === 0 ? (
          <div className="py-8 text-center">
            <Link2 className="w-8 h-8 mx-auto mb-3" style={{ color: "var(--lux-text-muted)", opacity: 0.4 }} />
            <p className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>No suggested matches</p>
            <p className="text-xs mt-1" style={{ color: "var(--lux-text-muted)" }}>No matching payments, invoices, or payouts were found.</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {matches.map((m) => (
              <div key={m.id} className="rounded-lg p-3 flex items-center gap-3"
                style={{ border: "1px solid var(--lux-border)", background: "var(--lux-bg)" }}
                data-testid={`match-suggestion-${m.id}`}>
                <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ background: "rgba(var(--lux-accent-rgb, 139,92,246), 0.1)" }}>
                  {m.entityType === "INVOICE_PAYMENT" ? (
                    <ExternalLink className="w-4 h-4" style={{ color: "var(--lux-accent)" }} />
                  ) : (
                    <ArrowUpRight className="w-4 h-4" style={{ color: "var(--lux-accent)" }} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>{m.entityLabel}</div>
                  {m.entityDetails && <div className="text-xs mt-0.5" style={{ color: "var(--lux-text-muted)" }}>{m.entityDetails}</div>}
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="secondary" className="text-[10px]" style={{ background: "rgba(156,163,175,0.08)", border: "none", color: "var(--lux-text-muted)" }}>
                      {m.matchType === "AUTO_PERFECT" ? "Exact" : m.matchType === "AUTO_FUZZY" ? "Fuzzy" : "Manual"}
                    </Badge>
                    <ConfidenceBadge confidence={m.confidence} />
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <Button size="sm" className="h-7 px-2.5 text-xs" style={{ background: "#22c55e", color: "#fff" }}
                    onClick={() => acceptMutation.mutate({ txId: transaction.id, matchId: m.id })}
                    disabled={acceptMutation.isPending} data-testid={`button-accept-match-${m.id}`}>
                    <Check className="w-3 h-3 mr-1" /> Accept
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" style={{ color: "var(--lux-text-muted)" }}
                    onClick={() => rejectMutation.mutate(m.id)}
                    disabled={rejectMutation.isPending} data-testid={`button-reject-match-${m.id}`} aria-label="Reject match">
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReconciliationWalkthrough({
  open, onClose, transactions, matchCountByTx, onMatchReview,
}: {
  open: boolean;
  onClose: () => void;
  transactions: BankTransaction[];
  matchCountByTx: Map<number, number>;
  onMatchReview: (tx: BankTransaction) => void;
}) {
  const { toast } = useToast();
  const [currentIndex, setCurrentIndex] = useState(0);
  const unmatchedTxs = useMemo(() =>
    transactions.filter(t => t.status === "PENDING" || t.status === "MATCHED"),
    [transactions]
  );

  const currentTx = unmatchedTxs[currentIndex];
  const total = unmatchedTxs.length;

  const reconcileMutation = useMutation({
    mutationFn: async (txId: number) => {
      const res = await apiRequest("POST", "/api/bank-reconciliation/batch", { transactionIds: [txId] });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Reconciled", description: "Transaction has been reconciled." });
      queryClient.invalidateQueries({ queryKey: ["/api/bank-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bank-reconciliation/logs"] });
      if (currentIndex >= total - 1) {
        onClose();
        setCurrentIndex(0);
      }
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const ignoreMutation = useMutation({
    mutationFn: async (txId: number) => {
      const res = await apiRequest("PATCH", `/api/bank-transactions/${txId}/status`, { status: "IGNORED" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bank-transactions"] });
      if (currentIndex >= total - 1) {
        onClose();
        setCurrentIndex(0);
      }
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleSkip = () => {
    if (currentIndex < total - 1) setCurrentIndex(i => i + 1);
    else onClose();
  };

  if (!open || total === 0) return null;
  if (!currentTx) { onClose(); return null; }

  const amt = Number(currentTx.amount);
  const isCredit = amt > 0;
  const mc = matchCountByTx.get(currentTx.id) || 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg" style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" style={{ color: "var(--lux-text)" }}>
            <ClipboardCheck className="w-4 h-4" style={{ color: "var(--lux-accent)" }} />
            Reconciliation Walkthrough
          </DialogTitle>
          <DialogDescription style={{ color: "var(--lux-text-muted)" }}>
            Transaction {currentIndex + 1} of {total}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg p-4" style={{ background: "var(--lux-bg)", border: "1px solid var(--lux-border)" }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium truncate" style={{ color: "var(--lux-text)" }}>
              {currentTx.description || "No description"}
            </span>
          </div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs tabular-nums" style={{ color: "var(--lux-text-muted)" }}>
              {formatDate(currentTx.date)}
            </span>
            <span className="text-base font-bold tabular-nums" style={{ color: isCredit ? "#22c55e" : "var(--lux-text)" }}>
              {isCredit ? "+" : ""}{formatMoney(Math.abs(amt))}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <TxStatusBadge status={currentTx.status} />
            {currentTx.matchedEntityType && (
              <span className="text-xs" style={{ color: "#3b82f6" }}>
                <Link2 className="w-3 h-3 inline mr-1" />
                Linked to {currentTx.matchedEntityType}
              </span>
            )}
            {mc > 0 && !currentTx.matchedEntityType && (
              <Button variant="ghost" size="sm" className="h-5 px-2 text-[10px]" style={{ color: "#f59e0b" }}
                onClick={() => { onClose(); onMatchReview(currentTx); }}>
                <Sparkles className="w-3 h-3 mr-1" />
                {mc} suggestion{mc > 1 ? "s" : ""} available
              </Button>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <Button variant="ghost" size="sm" disabled={currentIndex === 0}
            onClick={() => setCurrentIndex(i => i - 1)}
            style={{ color: "var(--lux-text-muted)" }} data-testid="button-walkthrough-prev">
            <ChevronLeft className="w-4 h-4 mr-1" /> Previous
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => ignoreMutation.mutate(currentTx.id)}
              disabled={ignoreMutation.isPending}
              className="text-xs" style={{ borderColor: "var(--lux-border)", color: "var(--lux-text-muted)" }}
              data-testid="button-walkthrough-ignore">
              <EyeOff className="w-3 h-3 mr-1" /> Ignore
            </Button>
            <Button variant="outline" size="sm" onClick={handleSkip}
              className="text-xs" style={{ borderColor: "var(--lux-border)", color: "var(--lux-text-muted)" }}
              data-testid="button-walkthrough-skip">
              <SkipForward className="w-3 h-3 mr-1" /> Skip
            </Button>
            <Button size="sm" onClick={() => reconcileMutation.mutate(currentTx.id)}
              disabled={reconcileMutation.isPending}
              className="text-xs" style={{ background: "#22c55e", color: "#fff" }}
              data-testid="button-walkthrough-reconcile">
              <CheckCircle className="w-3 h-3 mr-1" />
              {reconcileMutation.isPending ? "..." : "Reconcile"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function BankConnectionsPage() {
  useDocumentTitle("Banking");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { isProfessionalPlus } = useBillingStatus();
  const [activeTab, setActiveTab] = useState<"transactions" | "reconciliation">("transactions");
  const [deleteTarget, setDeleteTarget] = useState<BankConnection | null>(null);
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [connectionFilter, setConnectionFilter] = useState("ALL");
  const [matchReviewTx, setMatchReviewTx] = useState<BankTransaction | null>(null);
  const [walkthroughOpen, setWalkthroughOpen] = useState(false);
  const [selectedTxIds, setSelectedTxIds] = useState<Set<number>>(new Set());
  const stripeRef = useRef<Stripe | null>(null);

  type SortDir = "asc" | "desc";
  type SortSpec = { col: string; dir: SortDir };
  type ColumnFilter = {
    description?: string;
    dateFrom?: string;
    dateTo?: string;
    amountMin?: string;
    amountMax?: string;
    status?: string;
    category?: string;
  };
  const GRID_COL_ORDER_KEY = "cw-bank-tx-col-order";
  const defaultColumns = ["select", "date", "description", "account", "category", "amount", "status", "matches", "actions"];
  const [gridSorts, setGridSorts] = useState<SortSpec[]>([]);
  const [gridColumnFilters, setGridColumnFilters] = useState<ColumnFilter>({});
  const [gridOpenFilter, setGridOpenFilter] = useState<string | null>(null);
  const [gridPage, setGridPage] = useState(0);
  const [gridPageSize, setGridPageSize] = useState(25);
  const [gridColumnOrder, setGridColumnOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(GRID_COL_ORDER_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    return defaultColumns;
  });
  const [gridColumnWidths, setGridColumnWidths] = useState<Record<string, number>>({});
  const [gridDragCol, setGridDragCol] = useState<string | null>(null);
  const [gridSelectedIds, setGridSelectedIds] = useState<Set<number>>(new Set());
  const resizingRef = useRef<{ col: string; startX: number; startW: number } | null>(null);

  useEffect(() => {
    try { localStorage.setItem(GRID_COL_ORDER_KEY, JSON.stringify(gridColumnOrder)); } catch {}
  }, [gridColumnOrder]);

  useEffect(() => {
    if (!gridOpenFilter) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-grid-filter-popup]") && !target.closest(`[data-testid="filter-${gridOpenFilter}"]`)) {
        setGridOpenFilter(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [gridOpenFilter]);

  const { data: stripeConfig } = useQuery<{ publishableKey: string }>({
    queryKey: ["/api/stripe-config"],
  });

  const { data: connections = [], isLoading: loadingConns } = useQuery<BankConnection[]>({
    queryKey: ["/api/bank-connections"],
    enabled: isProfessionalPlus,
  });

  const { data: transactions = [], isLoading: loadingTxs } = useQuery<BankTransaction[]>({
    queryKey: ["/api/bank-transactions"],
    enabled: connections.length > 0,
  });

  const { data: allMatches = [] } = useQuery<BankTransactionMatch[]>({
    queryKey: ["/api/bank-transaction-matches"],
    queryFn: async () => {
      const res = await fetch("/api/bank-transaction-matches-by-org", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: connections.length > 0,
  });

  const { data: reconciliationLogs = [], isLoading: loadingLogs } = useQuery<BankReconciliationLog[]>({
    queryKey: ["/api/bank-reconciliation/logs"],
    queryFn: async () => {
      const res = await fetch("/api/bank-reconciliation/logs", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: activeTab === "reconciliation",
  });

  const matchCountByTx = useMemo(() => {
    const counts = new Map<number, number>();
    allMatches.forEach(m => counts.set(m.bankTransactionId, (counts.get(m.bankTransactionId) || 0) + 1));
    return counts;
  }, [allMatches]);

  const connectionMap = useMemo(() => {
    const m = new Map<number, BankConnection>();
    connections.forEach(c => m.set(c.id, c));
    return m;
  }, [connections]);

  const stats = useMemo(() => {
    const total = transactions.length;
    const matched = transactions.filter(t => t.status === "MATCHED").length;
    const reconciled = transactions.filter(t => t.status === "RECONCILED").length;
    const pending = transactions.filter(t => t.status === "PENDING").length;
    const ignored = transactions.filter(t => t.status === "IGNORED").length;
    const unmatched = pending;
    return { total, matched, reconciled, unmatched, pending, ignored };
  }, [transactions]);

  const filteredTransactions = useMemo(() => {
    let result = transactions.filter(tx => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const conn = connectionMap.get(tx.bankConnectionId);
        const acctLabel = conn ? `${conn.institutionName} ${conn.last4 || ""}`.toLowerCase() : "";
        const fields = [
          tx.description || "",
          tx.category || "",
          tx.date || "",
          String(tx.amount),
          tx.status || "",
          acctLabel,
        ];
        if (!fields.some(f => f.toLowerCase().includes(q))) return false;
      }
      if (dateFrom && tx.date < dateFrom) return false;
      if (dateTo && tx.date > dateTo) return false;
      if (statusFilter !== "ALL" && tx.status !== statusFilter) return false;
      if (connectionFilter !== "ALL" && tx.bankConnectionId !== Number(connectionFilter)) return false;

      const cf = gridColumnFilters;
      if (cf.description && !(tx.description || "").toLowerCase().includes(cf.description.toLowerCase())) return false;
      if (cf.dateFrom && tx.date < cf.dateFrom) return false;
      if (cf.dateTo && tx.date > cf.dateTo) return false;
      if (cf.amountMin && Math.abs(Number(tx.amount)) < Number(cf.amountMin)) return false;
      if (cf.amountMax && Math.abs(Number(tx.amount)) > Number(cf.amountMax)) return false;
      if (cf.status && cf.status !== "ALL" && tx.status !== cf.status) return false;
      if (cf.category && !(tx.category || "").toLowerCase().includes(cf.category.toLowerCase())) return false;
      return true;
    });

    if (gridSorts.length > 0) {
      result = [...result].sort((a, b) => {
        for (const s of gridSorts) {
          let cmp = 0;
          if (s.col === "date") cmp = (a.date || "").localeCompare(b.date || "");
          else if (s.col === "description") cmp = (a.description || "").localeCompare(b.description || "");
          else if (s.col === "amount") cmp = Number(a.amount) - Number(b.amount);
          else if (s.col === "status") cmp = (a.status || "").localeCompare(b.status || "");
          else if (s.col === "category") cmp = (a.category || "").localeCompare(b.category || "");
          if (cmp !== 0) return s.dir === "desc" ? -cmp : cmp;
        }
        return 0;
      });
    }
    return result;
  }, [transactions, searchQuery, dateFrom, dateTo, statusFilter, connectionFilter, gridColumnFilters, gridSorts, connectionMap]);

  const matchedNotReconciled = useMemo(() =>
    transactions.filter(t => t.status === "MATCHED"),
    [transactions]
  );

  const connectMutation = useMutation({
    mutationFn: async () => {
      if (!stripeConfig?.publishableKey) {
        throw new Error("Stripe is not configured. Please contact your administrator.");
      }
      if (!stripeRef.current) {
        stripeRef.current = await loadStripe(stripeConfig.publishableKey);
      }
      const stripe = stripeRef.current;
      if (!stripe) {
        throw new Error("Failed to load Stripe. Please refresh and try again.");
      }

      const res = await apiRequest("POST", "/api/bank-connections/connect");
      const { clientSecret, sessionId } = await res.json();

      const result = await stripe.collectFinancialConnectionsAccounts({ clientSecret });

      if (result.error) {
        throw new Error(result.error.message || "Bank connection was cancelled or failed.");
      }

      await apiRequest("POST", "/api/bank-connections/complete", { sessionId });
      return { sessionId };
    },
    onSuccess: () => {
      toast({ title: "Bank connected", description: "Your bank account has been linked successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/bank-connections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bank-transactions"] });
    },
    onError: (err: any) => {
      toast({ title: "Connection failed", description: err.message, variant: "destructive" });
    },
  });

  const syncMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/bank-connections/${id}/sync`);
      return res.json();
    },
    onSuccess: (data: { synced: number; matched?: number; pending?: boolean; message?: string }) => {
      if (data.pending && data.message) {
        toast({ title: "Sync pending", description: data.message });
      } else {
        const matchMsg = data.matched ? ` Found ${data.matched} potential match(es).` : "";
        toast({ title: "Sync complete", description: `Synced ${data.synced} new transaction(s).${matchMsg}` });
      }
      setSyncingId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/bank-connections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bank-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bank-transaction-matches"] });
    },
    onError: (err: any) => {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
      setSyncingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/bank-connections/${id}`),
    onSuccess: () => {
      toast({ title: "Disconnected", description: "Bank account has been removed." });
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["/api/bank-connections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bank-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bank-transaction-matches"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const ignoreMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("PATCH", `/api/bank-transactions/${id}/status`, { status: "IGNORED" });
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/bank-transactions"] }); },
    onError: (err: any) => { toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  const restoreMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("PATCH", `/api/bank-transactions/${id}/status`, { status: "PENDING" });
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/bank-transactions"] }); },
    onError: (err: any) => { toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  const autoMatchMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/banking/auto-match");
      return res.json();
    },
    onSuccess: (data: { matched: number; suggested: number; total: number }) => {
      toast({ title: "Auto-Match Complete", description: `${data.matched} matched, ${data.suggested} suggested out of ${data.total} pending transactions.` });
      queryClient.invalidateQueries({ queryKey: ["/api/bank-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bank-transaction-matches-by-org"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/banking"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const batchReconcileMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const res = await apiRequest("POST", "/api/bank-reconciliation/batch", { transactionIds: ids });
      return res.json();
    },
    onSuccess: (data: { reconciled: number }) => {
      toast({ title: "Batch reconciled", description: `${data.reconciled} transaction(s) reconciled.` });
      setSelectedTxIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/bank-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bank-reconciliation/logs"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleSync = (id: number) => {
    setSyncingId(id);
    syncMutation.mutate(id);
  };

  const toggleTxSelection = useCallback((id: number) => {
    setSelectedTxIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAllMatched = useCallback(() => {
    if (selectedTxIds.size === matchedNotReconciled.length) {
      setSelectedTxIds(new Set());
    } else {
      setSelectedTxIds(new Set(matchedNotReconciled.map(t => t.id)));
    }
  }, [matchedNotReconciled, selectedTxIds.size]);

  const hasFilters = searchQuery || dateFrom || dateTo || statusFilter !== "ALL" || connectionFilter !== "ALL"
    || gridColumnFilters.description || gridColumnFilters.dateFrom || gridColumnFilters.dateTo
    || gridColumnFilters.amountMin || gridColumnFilters.amountMax
    || (gridColumnFilters.status && gridColumnFilters.status !== "ALL")
    || gridColumnFilters.category;
  const hasConnections = connections.length > 0;

  const paginatedTransactions = useMemo(() => {
    const start = gridPage * gridPageSize;
    return filteredTransactions.slice(start, start + gridPageSize);
  }, [filteredTransactions, gridPage, gridPageSize]);

  const totalPages = Math.ceil(filteredTransactions.length / gridPageSize);

  useEffect(() => { setGridPage(0); }, [searchQuery, dateFrom, dateTo, statusFilter, connectionFilter, gridColumnFilters, gridPageSize]);
  useEffect(() => {
    if (totalPages > 0 && gridPage >= totalPages) setGridPage(Math.max(0, totalPages - 1));
  }, [totalPages, gridPage]);

  const handleGridSort = useCallback((col: string, e: React.MouseEvent) => {
    if (e.shiftKey) {
      setGridSorts(prev => {
        const idx = prev.findIndex(s => s.col === col);
        if (idx === -1) return [...prev, { col, dir: "asc" as SortDir }];
        if (prev[idx].dir === "asc") return prev.map((s, i) => i === idx ? { ...s, dir: "desc" as SortDir } : s);
        return prev.filter((_, i) => i !== idx);
      });
    } else {
      setGridSorts(prev => {
        const existing = prev.find(s => s.col === col);
        if (!existing) return [{ col, dir: "asc" }];
        if (existing.dir === "asc") return [{ col, dir: "desc" }];
        return [];
      });
    }
  }, []);

  const gridHeaderChecked = useMemo(() => {
    if (paginatedTransactions.length === 0) return false;
    const allSelected = paginatedTransactions.every(t => gridSelectedIds.has(t.id));
    return allSelected;
  }, [paginatedTransactions, gridSelectedIds]);

  const gridHeaderIndeterminate = useMemo(() => {
    if (paginatedTransactions.length === 0) return false;
    const someSelected = paginatedTransactions.some(t => gridSelectedIds.has(t.id));
    return someSelected && !gridHeaderChecked;
  }, [paginatedTransactions, gridSelectedIds, gridHeaderChecked]);

  const handleGridSelectAll = useCallback(() => {
    if (gridHeaderChecked) {
      setGridSelectedIds(new Set());
    } else {
      setGridSelectedIds(new Set(paginatedTransactions.map(t => t.id)));
    }
  }, [gridHeaderChecked, paginatedTransactions]);

  const handleGridRowSelect = useCallback((id: number) => {
    setGridSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleExportExcel = useCallback(async () => {
    try {
      const XLSX = await import("xlsx");
      const data = filteredTransactions.map(tx => {
        const conn = connectionMap.get(tx.bankConnectionId);
        return {
          Date: tx.date || "",
          Description: tx.description || "",
          Account: conn ? `${conn.institutionName}${conn.last4 ? ` ****${conn.last4}` : ""}` : "",
          Category: tx.category || "",
          Amount: Number(tx.amount),
          Status: tx.status || "",
        };
      });
      const ws = XLSX.utils.json_to_sheet(data);
      const colWidths = [{ wch: 12 }, { wch: 40 }, { wch: 25 }, { wch: 15 }, { wch: 14 }, { wch: 12 }];
      ws["!cols"] = colWidths;
      for (let r = 1; r <= data.length; r++) {
        const amtCell = ws[XLSX.utils.encode_cell({ r, c: 4 })];
        if (amtCell) amtCell.z = '$#,##0.00';
      }
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Transactions");
      XLSX.writeFile(wb, `transactions_${new Date().toISOString().split("T")[0]}.xlsx`);
      toast({ title: "Exported", description: `${data.length} transaction(s) exported to Excel.` });
    } catch (err: any) {
      toast({ title: "Export failed", description: err?.message || "Could not export transactions.", variant: "destructive" });
    }
  }, [filteredTransactions, connectionMap, toast]);

  const handleColumnDragStart = useCallback((col: string) => {
    setGridDragCol(col);
  }, []);

  const handleColumnDragOver = useCallback((e: React.DragEvent, targetCol: string) => {
    e.preventDefault();
    if (!gridDragCol || gridDragCol === targetCol) return;
    setGridColumnOrder(prev => {
      const next = [...prev];
      const fromIdx = next.indexOf(gridDragCol!);
      const toIdx = next.indexOf(targetCol);
      if (fromIdx === -1 || toIdx === -1) return prev;
      next.splice(fromIdx, 1);
      next.splice(toIdx, 0, gridDragCol!);
      return next;
    });
  }, [gridDragCol]);

  const handleColumnDragEnd = useCallback(() => {
    setGridDragCol(null);
  }, []);

  const handleResizeStart = useCallback((col: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = gridColumnWidths[col] || getDefaultWidth(col);
    resizingRef.current = { col, startX, startW };
    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const delta = ev.clientX - resizingRef.current.startX;
      const newW = Math.max(60, resizingRef.current.startW + delta);
      setGridColumnWidths(prev => ({ ...prev, [col]: newW }));
    };
    const onUp = () => {
      resizingRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [gridColumnWidths]);

  const clearAllGridFilters = useCallback(() => {
    setSearchQuery("");
    setDateFrom("");
    setDateTo("");
    setStatusFilter("ALL");
    setConnectionFilter("ALL");
    setGridColumnFilters({});
    setGridSorts([]);
  }, []);

  function getDefaultWidth(col: string): number {
    const map: Record<string, number> = {
      select: 44, date: 110, description: 280, account: 180,
      category: 120, amount: 130, status: 110, matches: 130, actions: 90,
    };
    return map[col] || 120;
  }

  const gridColLabels: Record<string, string> = {
    select: "", date: "Date", description: "Description", account: "Account",
    category: "Category", amount: "Amount", status: "Status", matches: "Matches", actions: "",
  };
  const sortableCols = new Set(["date", "description", "category", "amount", "status"]);
  const filterableCols = new Set(["date", "description", "amount", "status", "category"]);

  const uniqueCategories = useMemo(() => {
    const cats = new Set<string>();
    transactions.forEach(t => { if (t.category) cats.add(t.category); });
    return Array.from(cats).sort();
  }, [transactions]);

  return (
    <>
    <div className="px-6 lg:px-8 xl:px-10 pt-6">
      <PageBreadcrumbs group="Accounting" page="Banking" />
    </div>
    <UpgradeWall requiredTier="PROFESSIONAL" featureName="Banking" description="Connect bank accounts, auto-match transactions, and reconcile your books. Available on Professional plans and above.">
    <div className="px-6 lg:px-8 xl:px-10 pt-2 pb-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold" style={{ color: "var(--lux-text)" }} data-testid="text-page-title">Banking</h1>
            <PageHelpLink />
          </div>
          <p className="text-sm mt-1" style={{ color: "var(--lux-text-muted)" }}>Manage linked bank accounts, transactions, and reconciliation.</p>
        </div>
        <Button onClick={() => connectMutation.mutate()} disabled={connectMutation.isPending}
          data-testid="button-connect-bank" className="flex-shrink-0" style={{ background: "var(--lux-accent)", color: "#fff" }}>
          <Plus className="w-4 h-4 mr-2" />
          {connectMutation.isPending ? "Connecting..." : "Connect Bank Account"}
        </Button>
      </div>

      {loadingConns ? (
        <div className="space-y-3">
          {[1, 2].map(i => (
            <Card key={i} style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}>
              <CardContent className="p-5">
                <div className="flex items-center gap-4">
                  <Skeleton className="w-10 h-10 rounded-full" />
                  <div className="space-y-2 flex-1"><Skeleton className="h-4 w-48" /><Skeleton className="h-3 w-32" /></div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : !hasConnections ? (
        <Card style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}>
          <CardContent className="py-16 text-center">
            <div className="mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-4"
              style={{ background: "rgba(var(--lux-accent-rgb, 139,92,246), 0.1)" }}>
              <Building2 className="w-8 h-8" style={{ color: "var(--lux-accent)" }} />
            </div>
            <h3 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>No bank accounts connected</h3>
            <p className="text-sm mb-6 max-w-md mx-auto" style={{ color: "var(--lux-text-muted)" }}>
              Connect your bank account through Stripe Financial Connections to automatically import transactions and streamline reconciliation.
            </p>
            <Button onClick={() => connectMutation.mutate()} disabled={connectMutation.isPending}
              data-testid="button-connect-bank-empty" style={{ background: "var(--lux-accent)", color: "#fff" }}>
              <Plus className="w-4 h-4 mr-2" /> Connect Your First Bank Account
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-3">
            {connections.map(conn => (
              <Card key={conn.id} data-testid={`card-bank-connection-${conn.id}`}
                style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}>
                <CardContent className="p-5">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "var(--lux-bg)" }}>
                      <AccountTypeIcon type={conn.accountType} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-sm" style={{ color: "var(--lux-text)" }} data-testid={`text-institution-${conn.id}`}>{conn.institutionName}</span>
                        <ConnectionStatusBadge status={conn.status} />
                      </div>
                      <div className="flex items-center gap-3 text-xs" style={{ color: "var(--lux-text-muted)" }}>
                        {conn.accountName && <span>{conn.accountName}</span>}
                        {conn.last4 && <span className="tabular-nums">****{conn.last4}</span>}
                        {conn.accountType && <span className="capitalize">{conn.accountType}</span>}
                        <span>Connected {formatDate(conn.createdAt instanceof Date ? conn.createdAt.toISOString() : conn.createdAt)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 mt-2 sm:mt-0">
                      <Button variant="outline" size="sm" onClick={() => handleSync(conn.id)}
                        disabled={syncingId === conn.id || conn.status === "DISCONNECTED"}
                        data-testid={`button-sync-${conn.id}`} style={{ borderColor: "var(--lux-border)" }}>
                        <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${syncingId === conn.id ? "animate-spin" : ""}`} />
                        {syncingId === conn.id ? "Syncing..." : "Sync"}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setDeleteTarget(conn)}
                        data-testid={`button-disconnect-${conn.id}`}
                        className="text-red-500 hover:text-red-600" style={{ borderColor: "var(--lux-border)" }}
                        aria-label="Disconnect bank">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="flex items-center gap-1 rounded-lg p-1" style={{ background: "var(--lux-bg)", border: "1px solid var(--lux-border)" }}>
            <button
              onClick={() => setActiveTab("transactions")}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === "transactions" ? "" : "hover:opacity-80"}`}
              style={{
                background: activeTab === "transactions" ? "var(--lux-surface)" : "transparent",
                color: activeTab === "transactions" ? "var(--lux-text)" : "var(--lux-text-muted)",
                boxShadow: activeTab === "transactions" ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
              }}
              data-testid="tab-transactions"
            >
              <ArrowUpDown className="w-4 h-4" /> Transactions
            </button>
            <button
              onClick={() => setActiveTab("reconciliation")}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === "reconciliation" ? "" : "hover:opacity-80"}`}
              style={{
                background: activeTab === "reconciliation" ? "var(--lux-surface)" : "transparent",
                color: activeTab === "reconciliation" ? "var(--lux-text)" : "var(--lux-text-muted)",
                boxShadow: activeTab === "reconciliation" ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
              }}
              data-testid="tab-reconciliation"
            >
              <ClipboardCheck className="w-4 h-4" /> Reconciliation
            </button>
          </div>

          {activeTab === "transactions" && (
            <Card style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium flex items-center gap-2" style={{ color: "var(--lux-text)" }}>
                    <ArrowUpDown className="w-4 h-4" style={{ color: "var(--lux-accent)" }} />
                    Imported Transactions
                    {transactions.length > 0 && (
                      <span className="text-xs font-normal tabular-nums" style={{ color: "var(--lux-text-muted)" }}>
                        ({filteredTransactions.length}{hasFilters ? ` of ${transactions.length}` : ""})
                      </span>
                    )}
                  </CardTitle>
                  <div className="flex items-center gap-3 text-xs tabular-nums" style={{ color: "var(--lux-text-muted)" }}>
                    <span>{stats.pending} pending</span>
                    <span>{stats.matched} matched</span>
                    <span>{stats.reconciled} reconciled</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex flex-wrap items-center gap-3 mb-4">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--lux-text-muted)" }} />
                    <Input placeholder="Search all columns..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                      className="pl-9 h-9 text-sm" style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                      data-testid="input-search-transactions" />
                  </div>
                  <Button variant="outline" size="sm" onClick={handleExportExcel}
                    className="h-9 text-xs gap-1.5" style={{ borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                    disabled={filteredTransactions.length === 0} data-testid="button-export-excel">
                    <Download className="w-3.5 h-3.5" /> Export to Excel
                  </Button>
                  {gridSelectedIds.size > 0 && (
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs" style={{ background: "rgba(99,102,241,0.08)", color: "var(--lux-accent)" }}>
                      <span className="font-medium tabular-nums">{gridSelectedIds.size} selected</span>
                      <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" style={{ color: "var(--lux-text-muted)" }}
                        onClick={() => setGridSelectedIds(new Set())} data-testid="button-clear-selection">
                        Clear
                      </Button>
                    </div>
                  )}
                  {hasFilters && (
                    <Button variant="ghost" size="sm" onClick={clearAllGridFilters}
                      className="text-xs h-9" style={{ color: "var(--lux-text-muted)" }} data-testid="button-clear-filters">
                      Clear all filters
                    </Button>
                  )}
                  {gridSorts.length > 0 && (
                    <div className="flex items-center gap-1.5 text-[10px] tabular-nums" style={{ color: "var(--lux-text-muted)" }}>
                      Sorted by: {gridSorts.map((s, i) => (
                        <Badge key={s.col} variant="secondary" className="text-[10px] px-1.5 py-0" style={{ background: "rgba(99,102,241,0.08)", color: "var(--lux-accent)", border: "none" }}>
                          {gridColLabels[s.col]} {s.dir === "asc" ? "↑" : "↓"}
                        </Badge>
                      ))}
                      <span className="text-[9px]">(shift+click for multi-sort)</span>
                    </div>
                  )}
                </div>

                {loadingTxs ? (
                  <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
                ) : transactions.length === 0 ? (
                  <div className="py-12 text-center">
                    <ArrowUpDown className="w-8 h-8 mx-auto mb-3" style={{ color: "var(--lux-text-muted)", opacity: 0.4 }} />
                    <p className="text-sm font-medium mb-1" style={{ color: "var(--lux-text)" }}>No transactions imported yet</p>
                    <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>Click "Sync" on a connected account to pull in recent transactions.</p>
                  </div>
                ) : filteredTransactions.length === 0 ? (
                  <div className="py-12 text-center">
                    <Search className="w-8 h-8 mx-auto mb-3" style={{ color: "var(--lux-text-muted)", opacity: 0.4 }} />
                    <p className="text-sm font-medium mb-1" style={{ color: "var(--lux-text)" }}>No matching transactions</p>
                    <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>Try adjusting your search or filters.</p>
                  </div>
                ) : (
                  <>
                    <div className="rounded-lg overflow-x-auto" style={{ border: "1px solid var(--lux-border)" }}>
                      <table className="w-full border-collapse" style={{ minWidth: "900px" }}>
                        <thead>
                          <tr style={{ background: "var(--lux-bg)" }} className="sticky top-0 z-10">
                            {gridColumnOrder.filter(c => c !== "account" || connections.length > 1).map(col => {
                              const w = gridColumnWidths[col] || getDefaultWidth(col);
                              const sort = gridSorts.find(s => s.col === col);
                              const isSortable = sortableCols.has(col);
                              const isFilterable = filterableCols.has(col);
                              const filterOpen = gridOpenFilter === col;
                              const isAmount = col === "amount";
                              return (
                                <th key={col} className="relative select-none"
                                  style={{
                                    width: `${w}px`, minWidth: `${w}px`, maxWidth: `${w}px`,
                                    padding: "0", borderBottom: "1px solid var(--lux-border)",
                                    background: gridDragCol === col ? "rgba(99,102,241,0.06)" : "var(--lux-bg)",
                                  }}
                                  draggable={col !== "select" && col !== "actions"}
                                  onDragStart={() => handleColumnDragStart(col)}
                                  onDragOver={(e) => handleColumnDragOver(e, col)}
                                  onDragEnd={handleColumnDragEnd}
                                >
                                  <div className={`flex items-center gap-1 px-3 py-2.5 ${isAmount ? "justify-end" : ""}`}>
                                    {col !== "select" && col !== "actions" && (
                                      <GripVertical className="w-3 h-3 opacity-0 hover:opacity-40 cursor-grab flex-shrink-0 transition-opacity"
                                        style={{ color: "var(--lux-text-muted)" }} />
                                    )}
                                    {col === "select" ? (
                                      <Checkbox checked={gridHeaderIndeterminate ? "indeterminate" : gridHeaderChecked}
                                        onCheckedChange={handleGridSelectAll}
                                        className="mx-auto" data-testid="checkbox-select-all" />
                                    ) : (
                                      <button
                                        className={`flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap ${isSortable ? "cursor-pointer hover:opacity-80" : "cursor-default"}`}
                                        style={{ color: sort ? "var(--lux-accent)" : "var(--lux-text-muted)", background: "none", border: "none", padding: 0 }}
                                        onClick={isSortable ? (e) => handleGridSort(col, e) : undefined}
                                        data-testid={`header-${col}`}
                                      >
                                        {gridColLabels[col]}
                                        {isSortable && (
                                          sort ? (sort.dir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)
                                            : <ChevronsUpDown className="w-3 h-3 opacity-30" />
                                        )}
                                      </button>
                                    )}
                                    {isFilterable && (
                                      <button
                                        className="ml-auto flex-shrink-0 p-0.5 rounded hover:opacity-80 transition-colors"
                                        style={{
                                          color: (
                                            (col === "description" && gridColumnFilters.description) ||
                                            (col === "date" && (gridColumnFilters.dateFrom || gridColumnFilters.dateTo)) ||
                                            (col === "amount" && (gridColumnFilters.amountMin || gridColumnFilters.amountMax)) ||
                                            (col === "status" && gridColumnFilters.status && gridColumnFilters.status !== "ALL") ||
                                            (col === "category" && gridColumnFilters.category)
                                          ) ? "var(--lux-accent)" : "var(--lux-text-muted)",
                                          background: "none", border: "none",
                                        }}
                                        onClick={(e) => { e.stopPropagation(); setGridOpenFilter(filterOpen ? null : col); }}
                                        data-testid={`filter-${col}`}
                                        aria-label={`Filter ${gridColLabels[col]}`}
                                      >
                                        <Filter className="w-3 h-3" />
                                      </button>
                                    )}
                                  </div>
                                  {filterOpen && (
                                    <div className="absolute top-full left-0 z-50 mt-1 p-3 rounded-lg shadow-xl min-w-[200px]"
                                      data-grid-filter-popup
                                      style={{ background: "var(--lux-surface)", border: "1px solid var(--lux-border)" }}
                                      onClick={e => e.stopPropagation()}>
                                      {col === "description" && (
                                        <Input placeholder="Filter description..." value={gridColumnFilters.description || ""}
                                          onChange={e => setGridColumnFilters(prev => ({ ...prev, description: e.target.value }))}
                                          className="h-8 text-xs" style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                                          autoFocus data-testid="filter-input-description" />
                                      )}
                                      {col === "date" && (
                                        <div className="space-y-2">
                                          <label className="text-[10px] font-medium uppercase" style={{ color: "var(--lux-text-muted)" }}>From</label>
                                          <Input type="date" value={gridColumnFilters.dateFrom || ""}
                                            onChange={e => setGridColumnFilters(prev => ({ ...prev, dateFrom: e.target.value }))}
                                            className="h-8 text-xs" style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                                            data-testid="filter-input-date-from" />
                                          <label className="text-[10px] font-medium uppercase" style={{ color: "var(--lux-text-muted)" }}>To</label>
                                          <Input type="date" value={gridColumnFilters.dateTo || ""}
                                            onChange={e => setGridColumnFilters(prev => ({ ...prev, dateTo: e.target.value }))}
                                            className="h-8 text-xs" style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                                            data-testid="filter-input-date-to" />
                                        </div>
                                      )}
                                      {col === "amount" && (
                                        <div className="space-y-2">
                                          <label className="text-[10px] font-medium uppercase" style={{ color: "var(--lux-text-muted)" }}>Min</label>
                                          <Input type="number" placeholder="0.00" value={gridColumnFilters.amountMin || ""}
                                            onChange={e => setGridColumnFilters(prev => ({ ...prev, amountMin: e.target.value }))}
                                            className="h-8 text-xs" style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                                            data-testid="filter-input-amount-min" />
                                          <label className="text-[10px] font-medium uppercase" style={{ color: "var(--lux-text-muted)" }}>Max</label>
                                          <Input type="number" placeholder="99999.99" value={gridColumnFilters.amountMax || ""}
                                            onChange={e => setGridColumnFilters(prev => ({ ...prev, amountMax: e.target.value }))}
                                            className="h-8 text-xs" style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                                            data-testid="filter-input-amount-max" />
                                        </div>
                                      )}
                                      {col === "status" && (
                                        <div className="space-y-1">
                                          {["ALL", "PENDING", "MATCHED", "RECONCILED", "IGNORED"].map(s => (
                                            <button key={s} className="w-full text-left px-2 py-1.5 rounded text-xs hover:opacity-80 transition-colors"
                                              style={{
                                                background: (gridColumnFilters.status || "ALL") === s ? "rgba(99,102,241,0.1)" : "transparent",
                                                color: (gridColumnFilters.status || "ALL") === s ? "var(--lux-accent)" : "var(--lux-text)",
                                                border: "none",
                                              }}
                                              onClick={() => { setGridColumnFilters(prev => ({ ...prev, status: s })); setGridOpenFilter(null); }}
                                              data-testid={`filter-status-${s.toLowerCase()}`}>
                                              {s === "ALL" ? "All Statuses" : s.charAt(0) + s.slice(1).toLowerCase()}
                                            </button>
                                          ))}
                                        </div>
                                      )}
                                      {col === "category" && (
                                        <div className="space-y-2">
                                          <Input placeholder="Filter category..." value={gridColumnFilters.category || ""}
                                            onChange={e => setGridColumnFilters(prev => ({ ...prev, category: e.target.value }))}
                                            className="h-8 text-xs" style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                                            autoFocus data-testid="filter-input-category" />
                                          {uniqueCategories.length > 0 && (
                                            <div className="max-h-[120px] overflow-y-auto space-y-0.5 mt-1">
                                              {uniqueCategories.map(cat => (
                                                <button key={cat} className="w-full text-left px-2 py-1 rounded text-xs hover:opacity-80"
                                                  style={{ background: "transparent", color: "var(--lux-text)", border: "none" }}
                                                  onClick={() => { setGridColumnFilters(prev => ({ ...prev, category: cat })); setGridOpenFilter(null); }}
                                                  data-testid={`filter-category-${cat}`}>
                                                  {cat}
                                                </button>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      )}
                                      <div className="flex justify-end mt-2 pt-2" style={{ borderTop: "1px solid var(--lux-border)" }}>
                                        <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]"
                                          style={{ color: "var(--lux-text-muted)" }}
                                          onClick={() => {
                                            if (col === "description") setGridColumnFilters(p => ({ ...p, description: "" }));
                                            if (col === "date") setGridColumnFilters(p => ({ ...p, dateFrom: "", dateTo: "" }));
                                            if (col === "amount") setGridColumnFilters(p => ({ ...p, amountMin: "", amountMax: "" }));
                                            if (col === "status") setGridColumnFilters(p => ({ ...p, status: "ALL" }));
                                            if (col === "category") setGridColumnFilters(p => ({ ...p, category: "" }));
                                            setGridOpenFilter(null);
                                          }}>
                                          Clear
                                        </Button>
                                      </div>
                                    </div>
                                  )}
                                  {col !== "select" && col !== "actions" && (
                                    <div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500/30 transition-colors"
                                      onMouseDown={(e) => handleResizeStart(col, e)} />
                                  )}
                                </th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {paginatedTransactions.map(tx => {
                            const amt = Number(tx.amount);
                            const isCredit = amt > 0;
                            const conn = connectionMap.get(tx.bankConnectionId);
                            const matchCount = matchCountByTx.get(tx.id) || 0;
                            const isSelected = gridSelectedIds.has(tx.id);
                            return (
                              <tr key={tx.id} data-testid={`row-transaction-${tx.id}`} className="group transition-colors"
                                style={{
                                  borderBottom: "1px solid var(--lux-border)",
                                  background: isSelected ? "rgba(99,102,241,0.04)" : "transparent",
                                }}>
                                {gridColumnOrder.filter(c => c !== "account" || connections.length > 1).map(col => {
                                  const w = gridColumnWidths[col] || getDefaultWidth(col);
                                  const cellStyle = { width: `${w}px`, minWidth: `${w}px`, maxWidth: `${w}px`, padding: "8px 12px" };
                                  if (col === "select") return (
                                    <td key={col} style={{ ...cellStyle, textAlign: "center" as const }}>
                                      <Checkbox checked={isSelected} onCheckedChange={() => handleGridRowSelect(tx.id)}
                                        data-testid={`checkbox-row-${tx.id}`} />
                                    </td>
                                  );
                                  if (col === "date") return (
                                    <td key={col} className="text-sm tabular-nums" style={{ ...cellStyle, color: "var(--lux-text)" }}>
                                      {formatDate(tx.date)}
                                    </td>
                                  );
                                  if (col === "description") return (
                                    <td key={col} style={cellStyle}>
                                      <div className="flex items-center gap-2">
                                        {isCredit ? <ArrowDownLeft className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#22c55e" }} />
                                          : <ArrowUpRight className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#ef4444" }} />}
                                        <span className="text-sm truncate" style={{ color: "var(--lux-text)" }} data-testid={`text-description-${tx.id}`}>
                                          {tx.description || "No description"}
                                        </span>
                                      </div>
                                    </td>
                                  );
                                  if (col === "account") return (
                                    <td key={col} className="text-xs" style={{ ...cellStyle, color: "var(--lux-text-muted)" }}>
                                      {conn ? `${conn.institutionName}${conn.last4 ? ` ****${conn.last4}` : ""}` : "\u2014"}
                                    </td>
                                  );
                                  if (col === "category") return (
                                    <td key={col} className="text-xs capitalize" style={{ ...cellStyle, color: "var(--lux-text-muted)" }}>
                                      {tx.category || "\u2014"}
                                    </td>
                                  );
                                  if (col === "amount") return (
                                    <td key={col} className="text-right tabular-nums text-sm font-medium"
                                      style={{ ...cellStyle, color: isCredit ? "#22c55e" : "var(--lux-text)" }}>
                                      {isCredit ? "+" : ""}{formatMoney(Math.abs(amt))}
                                    </td>
                                  );
                                  if (col === "status") return (
                                    <td key={col} style={{ ...cellStyle, textAlign: "center" as const }}>
                                      <TxStatusBadge status={tx.status} />
                                    </td>
                                  );
                                  if (col === "matches") return (
                                    <td key={col} style={{ ...cellStyle, textAlign: "center" as const }}>
                                      {tx.status === "MATCHED" ? (
                                        <span className="inline-flex items-center gap-1 text-xs" style={{ color: "#3b82f6" }}><Link2 className="w-3 h-3" /> Linked</span>
                                      ) : matchCount > 0 ? (
                                        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" style={{ color: "#f59e0b" }}
                                          onClick={() => setMatchReviewTx(tx)} data-testid={`button-review-matches-${tx.id}`}>
                                          <Sparkles className="w-3 h-3 mr-1" />{matchCount} suggestion{matchCount > 1 ? "s" : ""}
                                        </Button>
                                      ) : (
                                        <span className="text-xs" style={{ color: "var(--lux-text-muted)" }}>{"\u2014"}</span>
                                      )}
                                    </td>
                                  );
                                  if (col === "actions") return (
                                    <td key={col} style={{ ...cellStyle, textAlign: "right" as const }}>
                                      {tx.status === "PENDING" && (
                                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                                          style={{ color: "var(--lux-text-muted)" }} onClick={() => ignoreMutation.mutate(tx.id)}
                                          disabled={ignoreMutation.isPending} data-testid={`button-ignore-${tx.id}`}>
                                          <EyeOff className="w-3 h-3 mr-1" /> Ignore
                                        </Button>
                                      )}
                                      {tx.status === "IGNORED" && (
                                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                                          style={{ color: "var(--lux-text-muted)" }} onClick={() => restoreMutation.mutate(tx.id)}
                                          disabled={restoreMutation.isPending} data-testid={`button-restore-${tx.id}`}>
                                          <RefreshCw className="w-3 h-3 mr-1" /> Restore
                                        </Button>
                                      )}
                                    </td>
                                  );
                                  return <td key={col} style={cellStyle} />;
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex items-center justify-between mt-3 px-1">
                      <div className="flex items-center gap-2 text-xs" style={{ color: "var(--lux-text-muted)" }}>
                        <span>Rows per page:</span>
                        <Select value={String(gridPageSize)} onValueChange={v => setGridPageSize(Number(v))}>
                          <SelectTrigger className="h-7 w-[70px] text-xs" style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                            data-testid="select-page-size">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}>
                            <SelectItem value="25">25</SelectItem>
                            <SelectItem value="50">50</SelectItem>
                            <SelectItem value="100">100</SelectItem>
                          </SelectContent>
                        </Select>
                        <span className="tabular-nums">
                          {gridPage * gridPageSize + 1}\u2013{Math.min((gridPage + 1) * gridPageSize, filteredTransactions.length)} of {filteredTransactions.length}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={gridPage === 0}
                          onClick={() => setGridPage(0)}
                          style={{ borderColor: "var(--lux-border)", color: "var(--lux-text-muted)" }} data-testid="button-page-first" aria-label="First page">
                          <ChevronLeft className="w-3.5 h-3.5" /><ChevronLeft className="w-3.5 h-3.5 -ml-2" />
                        </Button>
                        <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={gridPage === 0}
                          onClick={() => setGridPage(p => p - 1)}
                          style={{ borderColor: "var(--lux-border)", color: "var(--lux-text-muted)" }} data-testid="button-page-prev" aria-label="Previous page">
                          <ChevronLeft className="w-3.5 h-3.5" />
                        </Button>
                        <span className="text-xs tabular-nums px-2" style={{ color: "var(--lux-text)" }}>
                          {gridPage + 1} / {totalPages || 1}
                        </span>
                        <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={gridPage >= totalPages - 1}
                          onClick={() => setGridPage(p => p + 1)}
                          style={{ borderColor: "var(--lux-border)", color: "var(--lux-text-muted)" }} data-testid="button-page-next" aria-label="Next page">
                          <ChevronRight className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={gridPage >= totalPages - 1}
                          onClick={() => setGridPage(totalPages - 1)}
                          style={{ borderColor: "var(--lux-border)", color: "var(--lux-text-muted)" }} data-testid="button-page-last" aria-label="Last page">
                          <ChevronRight className="w-3.5 h-3.5" /><ChevronRight className="w-3.5 h-3.5 -ml-2" />
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {activeTab === "reconciliation" && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <SummaryCard label="Total Transactions" value={stats.total} total={stats.total} color="#6366f1" icon={BarChart3} />
                <SummaryCard label="Matched" value={stats.matched} total={stats.total} color="#3b82f6" icon={Link2} />
                <SummaryCard label="Reconciled" value={stats.reconciled} total={stats.total} color="#22c55e" icon={CheckCircle} />
                <SummaryCard label="Unmatched" value={stats.unmatched} total={stats.total} color="#f59e0b" icon={AlertCircle} />
              </div>

              <Card style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-medium flex items-center gap-2" style={{ color: "var(--lux-text)" }}>
                      <ClipboardCheck className="w-4 h-4" style={{ color: "var(--lux-accent)" }} />
                      Reconciliation Actions
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <Button size="sm" onClick={() => autoMatchMutation.mutate()}
                      disabled={autoMatchMutation.isPending || stats.pending === 0}
                      style={{ background: "#3b82f6", color: "#fff" }}
                      data-testid="button-run-auto-match">
                      <Zap className={`w-3.5 h-3.5 mr-1.5 ${autoMatchMutation.isPending ? "animate-pulse" : ""}`} />
                      {autoMatchMutation.isPending ? "Matching..." : "Run Auto-Match"}
                      {stats.pending > 0 && !autoMatchMutation.isPending && (
                        <Badge className="ml-2 text-[10px]" style={{ background: "rgba(255,255,255,0.2)", color: "#fff", border: "none" }}>
                          {stats.pending}
                        </Badge>
                      )}
                    </Button>
                    <Button size="sm" onClick={() => setWalkthroughOpen(true)}
                      disabled={stats.pending + stats.matched === 0}
                      style={{ background: "var(--lux-accent)", color: "#fff" }}
                      data-testid="button-start-reconciliation">
                      <ClipboardCheck className="w-3.5 h-3.5 mr-1.5" />
                      Start Reconciliation Walkthrough
                      {(stats.pending + stats.matched) > 0 && (
                        <Badge className="ml-2 text-[10px]" style={{ background: "rgba(255,255,255,0.2)", color: "#fff", border: "none" }}>
                          {stats.pending + stats.matched}
                        </Badge>
                      )}
                    </Button>
                    {matchedNotReconciled.length > 0 && (
                      <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: "var(--lux-bg)", border: "1px solid var(--lux-border)" }}>
                        <span className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
                          {matchedNotReconciled.length} matched transaction{matchedNotReconciled.length > 1 ? "s" : ""} ready to reconcile
                        </span>
                        <Button size="sm" variant="outline" className="h-7 text-xs"
                          style={{ borderColor: "var(--lux-border)" }}
                          onClick={() => batchReconcileMutation.mutate(matchedNotReconciled.map(t => t.id))}
                          disabled={batchReconcileMutation.isPending}
                          data-testid="button-batch-reconcile-all-matched">
                          <CheckCircle className="w-3 h-3 mr-1" style={{ color: "#22c55e" }} />
                          {batchReconcileMutation.isPending ? "Reconciling..." : "Reconcile All Matched"}
                        </Button>
                      </div>
                    )}
                  </div>

                  {matchedNotReconciled.length > 0 && (
                    <div className="mt-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium" style={{ color: "var(--lux-text)" }}>
                          Select transactions to batch reconcile
                        </span>
                        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={toggleAllMatched}
                          style={{ color: "var(--lux-text-muted)" }} data-testid="button-toggle-select-all">
                          {selectedTxIds.size === matchedNotReconciled.length ? "Deselect All" : "Select All"}
                        </Button>
                      </div>
                      <div className="rounded-lg overflow-x-auto" style={{ border: "1px solid var(--lux-border)" }}>
                        <Table>
                          <TableHeader>
                            <TableRow style={{ background: "var(--lux-bg)" }}>
                              <TableHead className="w-[40px]"></TableHead>
                              <TableHead className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Date</TableHead>
                              <TableHead className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Description</TableHead>
                              <TableHead className="text-xs font-medium text-right" style={{ color: "var(--lux-text-muted)" }}>Amount</TableHead>
                              <TableHead className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Linked To</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {matchedNotReconciled.map(tx => {
                              const amt = Number(tx.amount);
                              const isCredit = amt > 0;
                              return (
                                <TableRow key={tx.id} style={{ borderColor: "var(--lux-border)" }}
                                  data-testid={`row-reconcile-${tx.id}`}>
                                  <TableCell>
                                    <Checkbox
                                      checked={selectedTxIds.has(tx.id)}
                                      onCheckedChange={() => toggleTxSelection(tx.id)}
                                      data-testid={`checkbox-reconcile-${tx.id}`}
                                    />
                                  </TableCell>
                                  <TableCell className="text-sm tabular-nums" style={{ color: "var(--lux-text)" }}>{formatDate(tx.date)}</TableCell>
                                  <TableCell className="text-sm" style={{ color: "var(--lux-text)" }}>
                                    {tx.description || "No description"}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums text-sm font-medium"
                                    style={{ color: isCredit ? "#22c55e" : "var(--lux-text)" }}>
                                    {isCredit ? "+" : ""}{formatMoney(Math.abs(amt))}
                                  </TableCell>
                                  <TableCell className="text-xs" style={{ color: "#3b82f6" }}>
                                    <Link2 className="w-3 h-3 inline mr-1" />
                                    {tx.matchedEntityType || "Unknown"}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                      {selectedTxIds.size > 0 && (
                        <div className="flex items-center justify-end gap-2 mt-3">
                          <span className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
                            {selectedTxIds.size} selected
                          </span>
                          <Button size="sm" className="text-xs"
                            style={{ background: "#22c55e", color: "#fff" }}
                            onClick={() => batchReconcileMutation.mutate(Array.from(selectedTxIds))}
                            disabled={batchReconcileMutation.isPending}
                            data-testid="button-batch-reconcile-selected">
                            <CheckCircle className="w-3 h-3 mr-1" />
                            {batchReconcileMutation.isPending ? "Reconciling..." : `Reconcile ${selectedTxIds.size} Selected`}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2" style={{ color: "var(--lux-text)" }}>
                    <History className="w-4 h-4" style={{ color: "var(--lux-accent)" }} />
                    Reconciliation History
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  {loadingLogs ? (
                    <div className="space-y-2">{[1, 2].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
                  ) : reconciliationLogs.length === 0 ? (
                    <div className="py-8 text-center">
                      <History className="w-8 h-8 mx-auto mb-3" style={{ color: "var(--lux-text-muted)", opacity: 0.4 }} />
                      <p className="text-sm font-medium mb-1" style={{ color: "var(--lux-text)" }}>No reconciliation runs yet</p>
                      <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
                        Start a reconciliation to create your first log entry.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-lg overflow-x-auto" style={{ border: "1px solid var(--lux-border)" }}>
                      <Table>
                        <TableHeader>
                          <TableRow style={{ background: "var(--lux-bg)" }}>
                            <TableHead className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Date</TableHead>
                            <TableHead className="text-xs font-medium text-center" style={{ color: "var(--lux-text-muted)" }}>Total</TableHead>
                            <TableHead className="text-xs font-medium text-center" style={{ color: "var(--lux-text-muted)" }}>Matched</TableHead>
                            <TableHead className="text-xs font-medium text-center" style={{ color: "var(--lux-text-muted)" }}>Unmatched</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {reconciliationLogs.map(log => (
                            <TableRow key={log.id} style={{ borderColor: "var(--lux-border)" }}
                              data-testid={`row-recon-log-${log.id}`}>
                              <TableCell className="text-sm tabular-nums" style={{ color: "var(--lux-text)" }}>
                                {formatDate(log.reconciledAt instanceof Date ? log.reconciledAt.toISOString() : log.reconciledAt)}
                              </TableCell>
                              <TableCell className="text-center text-sm tabular-nums font-medium" style={{ color: "var(--lux-text)" }}>
                                {log.totalTransactions}
                              </TableCell>
                              <TableCell className="text-center text-sm tabular-nums" style={{ color: "#3b82f6" }}>
                                {log.matchedCount}
                              </TableCell>
                              <TableCell className="text-center text-sm tabular-nums" style={{ color: "#f59e0b" }}>
                                {log.unmatchedCount}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}>
          <AlertDialogHeader>
            <AlertDialogTitle style={{ color: "var(--lux-text)" }}>Disconnect Bank Account</AlertDialogTitle>
            <AlertDialogDescription style={{ color: "var(--lux-text-muted)" }}>
              This will remove the connection to {deleteTarget?.institutionName}
              {deleteTarget?.last4 ? ` (****${deleteTarget.last4})` : ""} and delete all imported transactions. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel style={{ borderColor: "var(--lux-border)", color: "var(--lux-text)" }}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              className="bg-red-600 hover:bg-red-700 text-white" data-testid="button-confirm-disconnect">
              {deleteMutation.isPending ? "Removing..." : "Disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <MatchReviewDialog open={!!matchReviewTx} onClose={() => setMatchReviewTx(null)} transaction={matchReviewTx} />

      <ReconciliationWalkthrough
        open={walkthroughOpen}
        onClose={() => setWalkthroughOpen(false)}
        transactions={transactions}
        matchCountByTx={matchCountByTx}
        onMatchReview={(tx) => { setWalkthroughOpen(false); setMatchReviewTx(tx); }}
      />
    </div>
    </UpgradeWall>
    </>
  );
}
