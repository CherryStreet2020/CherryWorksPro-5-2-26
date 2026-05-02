import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { ErrorState } from "@/components/shared/error-state";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { PageHelpLink } from "@/components/page-help-link";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { Calendar } from "@/components/ui/calendar";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, CreditCard, DollarSign, Pencil, Trash2, RotateCcw, Search,
  ArrowUpDown, ArrowUp, ArrowDown, BookOpen, Download, X, Save,
  ChevronRight, Calendar as CalendarIcon, Hash, Mail, Copy, TrendingUp, Clock, BarChart3,
  CheckCircle, AlertTriangle, Wallet, Ban, RefreshCw, Layers, Check, ChevronsUpDown,
  ClipboardList,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import type { Payment, Invoice } from "@shared/schema";
import { StatusBadge } from "@/components/shared/status-badge";
import { ActiveFilterBar, type FilterChipDescriptor } from "@/components/active-filter-chip";
import { DateDisplay } from "@/components/shared/date-display";
import { EmptyState } from "@/components/shared/empty-state";
import { MoneyDisplay } from "@/components/shared/money-display";
import { formatMoney } from "@/components/shared/format";
import { useBaseCurrency } from "@/hooks/use-base-currency";
import { useDocumentTitle } from "@/lib/use-document-title";
import { useUrlFilterState } from "@/lib/use-url-filter-state";

interface PaymentWithDetails extends Payment {
  invoiceNumber: string;
  clientName: string;
}

interface InvoiceOption extends Invoice {
  clientName: string;
}

type SortField = "date" | "amount" | "method" | "clientName" | "invoiceNumber" | "status";
type SortDir = "asc" | "desc";


const STATUS_COLORS: Record<string, string> = {
  ALL: "#8b5cf6",
  PENDING: "#f59e0b",
  CLEARED: "#22c55e",
  RECONCILED: "#3b82f6",
  VOIDED: "#6b7280",
  REFUNDED: "#ef4444",
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  ALL: "All",
  PENDING: "Pending",
  CLEARED: "Cleared",
  RECONCILED: "Reconciled",
  VOIDED: "Voided",
  REFUNDED: "Refunded",
};

const STATUS_ICONS: Record<string, any> = {
  ALL: Layers,
  PENDING: Clock,
  CLEARED: CheckCircle,
  RECONCILED: BookOpen,
  VOIDED: Ban,
  REFUNDED: RefreshCw,
};

function PaymentStatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] || "#6b7280";
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
      style={{ background: `${color}15`, color }}
      data-testid={`badge-payment-status-${status}`}
    >
      {PAYMENT_STATUS_LABELS[status] || status}
    </span>
  );
}

function exportPaymentsToCSV(payments: PaymentWithDetails[], baseCurrency: string) {
  const headers = ["Invoice", "Client", "Date", "Method", "Amount", "Status", "Reference", "Notes"];
  const rows = payments.map((p) => [
    p.invoiceNumber,
    p.clientName,
    p.date,
    p.method,
    Number(p.amount).toFixed(2),
    (p as any).status || "CLEARED",
    (p as any).referenceNumber || "",
    (p.notes || "").replace(/"/g, '""'),
  ]);
  const csv = [headers, ...rows].map((r) => r.map((c: string) => `"${c}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `payments_${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function PaymentsPage() {
  useDocumentTitle("Payments");
  const { user } = useAuth();
  const baseCurrency = useBaseCurrency();
  const { toast } = useToast();
  const isAdmin = user?.role === "ADMIN";
  const canManage = user?.role === "ADMIN" || user?.role === "MANAGER";
  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<PaymentWithDetails | null>(null);
  const [invoiceId, setInvoiceId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [method, setMethod] = useState("CHECK");
  const [notes, setNotes] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editMethod, setEditMethod] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editReferenceNumber, setEditReferenceNumber] = useState("");

  const [filters, setFilter, setFilters] = useUrlFilterState({
    q: "",
    method: "ALL",
    status: "All",
    from: "",
    to: "",
    sort: "date",
    dir: "desc",
  });
  const searchTerm = filters.q;
  const methodFilter = filters.method;
  const statusTab = filters.status;
  const dateFrom = filters.from;
  const dateTo = filters.to;
  const sortField = filters.sort as SortField;
  const sortDir = filters.dir as SortDir;
  const setSearchTerm = (v: string) => setFilter("q", v, { replace: true });
  const setMethodFilter = (v: string) => setFilter("method", v);
  const setStatusTab = (v: string) => setFilter("status", v);
  const setDateFrom = (v: string) => setFilter("from", v);
  const setDateTo = (v: string) => setFilter("to", v);

  const [hubFilter, setHubFilter] = useState<{ key: string; label: string } | null>(() => {
    if (typeof window === "undefined") return null;
    const period = new URLSearchParams(window.location.search).get("period");
    if (period === "this-month") return { key: "this-month", label: "Payments this month" };
    return null;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const period = params.get("period");
    if (period !== "this-month") return;
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const pad = (n: number) => String(n).padStart(2, "0");
    const fmtLocal = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const from = fmtLocal(new Date(y, m, 1));
    const to = fmtLocal(new Date(y, m + 1, 0));
    params.delete("period");
    const remaining = params.toString();
    const newUrl =
      window.location.pathname +
      (remaining ? `?${remaining}` : "") +
      window.location.hash;
    window.history.replaceState(null, "", newUrl);
    setFilters({ from, to }, { replace: true });
    
  }, []);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailNotes, setDetailNotes] = useState("");
  const detailPanelRef = useRef<HTMLDivElement>(null);

  const [datePopoverOpen, setDatePopoverOpen] = useState(false);
  const [editDatePopoverOpen, setEditDatePopoverOpen] = useState(false);
  const [dateFromPopoverOpen, setDateFromPopoverOpen] = useState(false);
  const [dateToPopoverOpen, setDateToPopoverOpen] = useState(false);
  const [invoiceComboOpen, setInvoiceComboOpen] = useState(false);
  const [formTouched, setFormTouched] = useState(false);

  const [arFilterTab, setArFilterTab] = useState("ALL");
  const [arSearch, setArSearch] = useState("");
  const [arSelectedIds, setArSelectedIds] = useState<Set<string>>(new Set());
  const [bulkPayOpen, setBulkPayOpen] = useState(false);
  const [bulkMethod, setBulkMethod] = useState("CHECK");
  const [bulkDate, setBulkDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [bulkReference, setBulkReference] = useState("");
  const [bulkNotes, setBulkNotes] = useState("");
  const [bulkDatePopoverOpen, setBulkDatePopoverOpen] = useState(false);
  const [bulkPaying, setBulkPaying] = useState(false);

  const { data: payments, isLoading, isError: paymentsError, error: paymentsQueryError, refetch: refetchPayments } = useQuery<PaymentWithDetails[]>({
    queryKey: ["/api/payments"],
  });

  const { data: unpaidInvoices } = useQuery<InvoiceOption[]>({
    queryKey: ["/api/invoices/unpaid"],
  });

  const { data: allInvoices } = useQuery<any[]>({
    queryKey: ["/api/invoices"],
  });

  const { data: orgSettings } = useQuery<any>({
    queryKey: ["/api/org/settings"],
  });

  const autoPostEnabled = orgSettings?.autoPostJournalEntries ?? false;
  const [glPostedIds, setGlPostedIds] = useState<Set<string>>(new Set());

  const detailPayment = useMemo(() => {
    if (!detailId || !payments) return null;
    return payments.find((p) => p.id === detailId) || null;
  }, [detailId, payments]);

  const { data: glPostStatus } = useQuery<{ posted: boolean; journalEntryId?: number; postedAt?: string }>({
    queryKey: ["/api/gl/posted-status", detailId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/gl/posted-status?paymentId=${detailId}`);
      return res.json();
    },
    enabled: !!detailId,
  });

  useEffect(() => {
    if (detailPayment) {
      setDetailNotes(detailPayment.notes || "");
    }
  }, [detailPayment]);

  const postGlMutation = useMutation({
    mutationFn: async (paymentId: string) => {
      const res = await apiRequest("POST", `/api/payments/${paymentId}/post-gl`);
      return { ...(await res.json()), paymentId };
    },
    onSuccess: (data: any) => {
      setGlPostedIds(prev => new Set([...prev, data.paymentId]));
      queryClient.invalidateQueries({ queryKey: ["/api/gl/journal-entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gl/posted-status", data.paymentId] });
      toast({ title: "Posted to GL", description: data.message });
    },
    onError: (err: any) => {
      toast({ title: "GL posting failed", description: err.message, variant: "destructive" });
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/payments", {
        invoiceId,
        amount,
        date,
        method,
        referenceNumber: referenceNumber || undefined,
        notes: notes || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices/unpaid"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ar/outstanding"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      setOpen(false);
      setInvoiceId("");
      setAmount("");
      setNotes("");
      setReferenceNumber("");
      setFormTouched(false);
      toast({ title: "Payment recorded" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPayment) return;
      await apiRequest("PATCH", `/api/payments/${selectedPayment.id}`, {
        date: editDate,
        method: editMethod,
        notes: editNotes || null,
        referenceNumber: editReferenceNumber || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      setEditOpen(false);
      toast({ title: "Payment updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPayment) return;
      await apiRequest("DELETE", `/api/payments/${selectedPayment.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices/unpaid"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ar/outstanding"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      setDeleteOpen(false);
      if (detailId === selectedPayment?.id) setDetailId(null);
      toast({ title: "Payment deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const refundMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPayment) return;
      await apiRequest("POST", `/api/payments/${selectedPayment.id}/refund`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices/unpaid"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ar/outstanding"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      setRefundOpen(false);
      toast({ title: "Payment refunded" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await apiRequest("PATCH", `/api/payments/${id}/status`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      toast({ title: "Status updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const saveDetailNotesMutation = useMutation({
    mutationFn: async () => {
      if (!detailId) return;
      await apiRequest("PATCH", `/api/payments/${detailId}`, { notes: detailNotes || null });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      toast({ title: "Notes saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  function openEdit(payment: PaymentWithDetails) {
    setSelectedPayment(payment);
    setEditDate(payment.date);
    setEditMethod(payment.method);
    setEditNotes(payment.notes || "");
    setEditReferenceNumber((payment as any).referenceNumber || "");
    setEditOpen(true);
  }

  function openDelete(payment: PaymentWithDetails) {
    setSelectedPayment(payment);
    setDeleteOpen(true);
  }

  function openRefund(payment: PaymentWithDetails) {
    setSelectedPayment(payment);
    setRefundOpen(true);
  }

  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setFilter("dir", sortDir === "asc" ? "desc" : "asc");
    } else {
      setFilter("sort", field);
      setFilter("dir", "desc");
    }
  }, [sortField, sortDir, setFilter]);

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 inline opacity-40" />;
    return sortDir === "asc"
      ? <ArrowUp className="w-3 h-3 ml-1 inline" />
      : <ArrowDown className="w-3 h-3 ml-1 inline" />;
  }

  const filteredPayments = useMemo(() => {
    if (!payments) return [];
    let list = [...payments];

    if (statusTab !== "All") {
      list = list.filter((p) => ((p as any).status || "CLEARED") === statusTab);
    }

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      list = list.filter(
        (p) =>
          p.invoiceNumber.toLowerCase().includes(term) ||
          p.clientName.toLowerCase().includes(term)
      );
    }

    if (methodFilter !== "ALL") {
      list = list.filter((p) => p.method === methodFilter);
    }

    if (dateFrom) {
      list = list.filter((p) => p.date >= dateFrom);
    }
    if (dateTo) {
      list = list.filter((p) => p.date <= dateTo);
    }

    list.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "date": cmp = a.date.localeCompare(b.date); break;
        case "amount": cmp = Number(a.amount) - Number(b.amount); break;
        case "method": cmp = a.method.localeCompare(b.method); break;
        case "clientName": cmp = a.clientName.localeCompare(b.clientName); break;
        case "invoiceNumber": cmp = a.invoiceNumber.localeCompare(b.invoiceNumber); break;
        case "status": cmp = ((a as any).status || "CLEARED").localeCompare((b as any).status || "CLEARED"); break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return list;
  }, [payments, searchTerm, methodFilter, dateFrom, dateTo, sortField, sortDir, statusTab]);

  const { data: canonicalAR } = useQuery<{ outstandingAR: number }>({
    queryKey: ["/api/ar/outstanding"],
  });

  const nowForMonth = new Date();
  const monthStartStr = `${nowForMonth.getFullYear()}-${String(nowForMonth.getMonth() + 1).padStart(2, "0")}-01`;
  const monthEndStr = nowForMonth.toISOString().split("T")[0];
  const { data: canonicalCollected } = useQuery<{ collected: number }>({
    queryKey: ["/api/canonical/collected", monthStartStr, monthEndStr],
    queryFn: () => fetch(`/api/canonical/collected?startDate=${monthStartStr}&endDate=${monthEndStr}`, { credentials: "include" }).then(r => r.json()),
  });

  const enhancedStats = useMemo(() => {
    const totalOutstanding = canonicalAR?.outstandingAR ?? 0;
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const overdueAmount = (unpaidInvoices || []).filter(i => new Date(i.dueDate + "T00:00:00") < now).reduce((s, i) => s + Number(i.total) - Number(i.paidAmount), 0);
    const kpiPayments = (payments || []).filter(p => {
      if (dateFrom && p.date < dateFrom) return false;
      if (dateTo && p.date > dateTo) return false;
      return true;
    });
    const collectedThisMonth = canonicalCollected?.collected ?? 0;
    const paidCount = kpiPayments.filter(p => Number(p.amount) > 0).length;
    const collectionRate = paidCount > 0 ? 100 : 0;

    let avgDaysToPay: number | null = null;
    let paidInvoiceCount = 0;
    if (allInvoices && payments) {
      const paidInvoices = allInvoices.filter((i: any) => (i.status === "PAID" || (i.status === "PARTIAL" && Number(i.paidAmount) > 0)) && i.issuedDate);
      paidInvoiceCount = paidInvoices.length;
      if (paidInvoices.length > 0) {
        let totalDays = 0;
        let countedInvoices = 0;
        for (const inv of paidInvoices) {
          const issued = new Date((inv as any).issuedDate + "T00:00:00");
          const matchingPayments = kpiPayments.filter(p => p.invoiceId === inv.id);
          const lastPayment = matchingPayments.sort((a, b) => b.date.localeCompare(a.date))[0];
          let paidDate: Date | null = null;
          if (lastPayment) {
            const payDate = new Date(lastPayment.date + "T00:00:00");
            const payDays = Math.round((payDate.getTime() - issued.getTime()) / 86400000);
            if (payDays > 0) {
              paidDate = payDate;
            }
          }
          if (!paidDate && (inv as any).paidAt) {
            paidDate = new Date((inv as any).paidAt + "T00:00:00");
          }
          if (!paidDate && (inv as any).updatedAt) {
            paidDate = new Date((inv as any).updatedAt);
          }
          if (paidDate) {
            const days = Math.round((paidDate.getTime() - issued.getTime()) / 86400000);
            if (days >= 0) {
              totalDays += days;
              countedInvoices++;
            }
          }
        }
        if (countedInvoices > 0) {
          avgDaysToPay = Math.round(totalDays / countedInvoices);
        }
      }
    }

    return { totalOutstanding, overdueAmount, collectedThisMonth, collectionRate, avgDaysToPay, paidInvoiceCount };
  }, [unpaidInvoices, payments, allInvoices, canonicalAR, canonicalCollected, dateFrom, dateTo]);

  function getInvoiceDueStatus(dueDate: string) {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const due = new Date(dueDate + "T00:00:00");
    const diffDays = Math.floor((due.getTime() - now.getTime()) / 86400000);
    if (diffDays < -30) return { label: "Past Due 30+", color: "#ef4444", daysText: `${Math.abs(diffDays)}d overdue`, daysColor: "#ef4444" };
    if (diffDays < 0) return { label: "Overdue", color: "#f97316", daysText: `${Math.abs(diffDays)}d overdue`, daysColor: "#ef4444" };
    if (diffDays <= 7) return { label: "Due Soon", color: "#f59e0b", daysText: diffDays === 0 ? "Due today" : `Due in ${diffDays}d`, daysColor: "var(--lux-text-muted)" };
    return { label: "Current", color: "#22c55e", daysText: `Due in ${diffDays}d`, daysColor: "var(--lux-text-muted)" };
  }

  const outstandingInvoices = useMemo(() => {
    if (!unpaidInvoices) return [];
    let list = unpaidInvoices.map(inv => {
      const remaining = Number(inv.total) - Number(inv.paidAmount);
      const dueStatus = getInvoiceDueStatus(inv.dueDate);
      const now = new Date(); now.setHours(0, 0, 0, 0);
      const due = new Date(inv.dueDate + "T00:00:00");
      const diffDays = Math.floor((due.getTime() - now.getTime()) / 86400000);
      return { ...inv, remaining, dueStatus, diffDays };
    });
    if (arFilterTab === "OVERDUE") list = list.filter(i => i.diffDays < 0);
    else if (arFilterTab === "DUE_WEEK") list = list.filter(i => i.diffDays >= 0 && i.diffDays <= 7);
    else if (arFilterTab === "DUE_MONTH") list = list.filter(i => i.diffDays >= 0 && i.diffDays <= 30);
    else if (arFilterTab === "PARTIAL") list = list.filter(i => Number(i.paidAmount) > 0);
    if (arSearch) {
      const term = arSearch.toLowerCase();
      list = list.filter(i => i.number.toLowerCase().includes(term) || i.clientName.toLowerCase().includes(term));
    }
    return list;
  }, [unpaidInvoices, arFilterTab, arSearch]);

  const arTabCounts = useMemo(() => {
    if (!unpaidInvoices) return { ALL: 0, OVERDUE: 0, DUE_WEEK: 0, DUE_MONTH: 0, PARTIAL: 0 } as Record<string, number>;
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const counts: Record<string, number> = { ALL: unpaidInvoices.length, OVERDUE: 0, DUE_WEEK: 0, DUE_MONTH: 0, PARTIAL: 0 };
    unpaidInvoices.forEach(inv => {
      const due = new Date(inv.dueDate + "T00:00:00");
      const diff = Math.floor((due.getTime() - now.getTime()) / 86400000);
      if (diff < 0) counts.OVERDUE++;
      if (diff >= 0 && diff <= 7) counts.DUE_WEEK++;
      if (diff >= 0 && diff <= 30) counts.DUE_MONTH++;
      if (Number(inv.paidAmount) > 0) counts.PARTIAL++;
    });
    return counts;
  }, [unpaidInvoices]);

  const filteredTotal = useMemo(() => {
    return filteredPayments.reduce((sum, p) => sum + Number(p.amount), 0);
  }, [filteredPayments]);

  const allChecked = filteredPayments.length > 0 && filteredPayments.every((p) => selectedIds.has(p.id));

  function toggleAll() {
    if (allChecked) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredPayments.map((p) => p.id)));
    }
  }

  function toggleOne(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  }

  async function handleBulkDelete() {
    const ids = Array.from(selectedIds);
    for (const id of ids) {
      await apiRequest("DELETE", `/api/payments/${id}`);
    }
    queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
    queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
    queryClient.invalidateQueries({ queryKey: ["/api/invoices/unpaid"] });
    queryClient.invalidateQueries({ queryKey: ["/api/ar/outstanding"] });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
    setSelectedIds(new Set());
    toast({ title: `${ids.length} payment(s) deleted` });
  }

  async function handleBulkMarkCleared() {
    const ids = Array.from(selectedIds);
    for (const id of ids) {
      await apiRequest("PATCH", `/api/payments/${id}/status`, { status: "CLEARED" });
    }
    queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
    setSelectedIds(new Set());
    toast({ title: `${ids.length} payment(s) marked as cleared` });
  }

  function handleBulkExport() {
    if (!payments) return;
    const selected = payments.filter((p) => selectedIds.has(p.id));
    exportPaymentsToCSV(selected, baseCurrency);
    toast({ title: `Exported ${selected.length} payment(s)` });
  }

  function handlePayInvoice(inv: typeof outstandingInvoices[number]) {
    setInvoiceId(inv.id);
    setAmount(inv.remaining.toFixed(2));
    setDate(format(new Date(), "yyyy-MM-dd"));
    setOpen(true);
  }

  async function handleBulkPayment() {
    setBulkPaying(true);
    try {
      const ids = Array.from(arSelectedIds);
      for (const invId of ids) {
        const inv = unpaidInvoices?.find(i => i.id === invId);
        if (!inv) continue;
        const remaining = Number(inv.total) - Number(inv.paidAmount);
        await apiRequest("POST", "/api/payments", {
          invoiceId: invId,
          amount: remaining.toFixed(2),
          date: bulkDate,
          method: bulkMethod,
          referenceNumber: bulkReference || undefined,
          notes: bulkNotes || undefined,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices/unpaid"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      setBulkPayOpen(false);
      setArSelectedIds(new Set());
      setBulkMethod("CHECK");
      setBulkReference("");
      setBulkNotes("");
      toast({ title: `${ids.length} payment(s) recorded` });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setBulkPaying(false);
    }
  }

  const methodOptions = ["ALL", "ACH", "BANK_TRANSFER", "WIRE", "CHECK", "STRIPE", "CASH", "CREDIT_CARD", "DEBIT_CARD", "OTHER"];

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: 0, PENDING: 0, CLEARED: 0, RECONCILED: 0, VOIDED: 0, REFUNDED: 0 };
    (payments || []).forEach(p => {
      const s = (p as any).status || "CLEARED";
      counts.ALL++;
      if (counts[s] !== undefined) counts[s]++;
    });
    return counts;
  }, [payments]);

  const statCards = [
    { key: "outstanding", label: "Total Outstanding AR", value: formatMoney(enhancedStats.totalOutstanding, baseCurrency), sub: `${(unpaidInvoices || []).filter((i: any) => ["SENT", "PARTIAL"].includes(i.status)).length} open invoices`, icon: DollarSign, color: "var(--lux-accent)", iconBg: "rgba(var(--lux-accent-rgb),0.08)", gradient: "linear-gradient(135deg, rgba(var(--lux-accent-rgb),0.08) 0%, rgba(var(--lux-accent-rgb),0.02) 100%)" },
    { key: "overdue", label: "Overdue Amount", value: formatMoney(enhancedStats.overdueAmount, baseCurrency), sub: enhancedStats.overdueAmount > 0 ? "requires attention" : "no overdue", icon: AlertTriangle, color: "#ef4444", gradient: "linear-gradient(135deg, rgba(239,68,68,0.08) 0%, rgba(239,68,68,0.02) 100%)", pulse: enhancedStats.overdueAmount > 0 },
    { key: "collected", label: "Collected This Month", value: formatMoney(enhancedStats.collectedThisMonth, baseCurrency), sub: new Date().toLocaleString("default", { month: "long", year: "numeric" }), icon: TrendingUp, color: "#22c55e", gradient: "linear-gradient(135deg, rgba(34,197,94,0.08) 0%, rgba(34,197,94,0.02) 100%)" },
    { key: "avgdays", label: "Avg Days to Pay", value: enhancedStats.paidInvoiceCount > 0 && enhancedStats.avgDaysToPay !== null ? `${enhancedStats.avgDaysToPay}` : "\u2014", sub: enhancedStats.paidInvoiceCount > 0 ? `across ${enhancedStats.paidInvoiceCount} invoice${enhancedStats.paidInvoiceCount !== 1 ? "s" : ""} with payments` : "no invoices with payments", icon: Clock, color: "#3b82f6", gradient: "linear-gradient(135deg, rgba(59,130,246,0.08) 0%, rgba(59,130,246,0.02) 100%)" },
    { key: "rate", label: "Collection Rate", value: `${enhancedStats.collectionRate}%`, sub: "paid on time", icon: BarChart3, color: "#8b5cf6", gradient: "linear-gradient(135deg, rgba(139,92,246,0.08) 0%, rgba(139,92,246,0.02) 100%)" },
  ];

  if (isLoading) {
    return (
      <div className="px-6 lg:px-8 xl:px-10 py-6 space-y-6">
        <div className="flex items-center gap-4"><Skeleton className="h-12 w-12 rounded-xl" /><div><Skeleton className="h-7 w-40 rounded-lg" /><Skeleton className="h-4 w-56 rounded-md mt-1.5" /></div></div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
        <Skeleton className="h-12 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  if (paymentsError) {
    return (
      <div className="px-6 lg:px-8 xl:px-10 py-6">
        <ErrorState title="Failed to load payments" description="We couldn't load payment data. Please try again." onRetry={refetchPayments} error={paymentsQueryError as Error} showDashboardLink />
      </div>
    );
  }

  return (
    <div className="flex gap-0 relative">
      <div className={`flex-1 px-6 lg:px-8 xl:px-10 py-6 space-y-6 transition-all duration-300 ${detailId ? "mr-[440px]" : ""}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(var(--lux-accent-rgb),0.15) 0%, rgba(var(--lux-accent-rgb),0.05) 100%)" }}>
                <Wallet className="w-6 h-6" style={{ color: "var(--lux-accent)" }} />
              </div>
              <div className="absolute -inset-1 rounded-xl opacity-40 blur-md -z-10" style={{ background: "radial-gradient(circle, rgba(var(--lux-accent-rgb),0.3) 0%, transparent 70%)" }} />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--lux-text)" }} data-testid="text-payments-title">
                  Payments
                </h1>
                <PageHelpLink />
              </div>
              <p className="text-sm mt-0.5" style={{ color: "var(--lux-text-muted)" }}>
                Track and manage all payments
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => exportPaymentsToCSV(filteredPayments, baseCurrency)}
                    data-testid="button-export-payments"
                  >
                    <Download className="w-4 h-4 mr-2" /> Export
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Export payments to CSV</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {canManage && (
              <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setFormTouched(false); }}>
                <DialogTrigger asChild>
                  <Button data-testid="button-record-payment" className="text-white shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.03]" style={{ background: "var(--gradient-brand)" }}>
                    <Plus className="w-4 h-4 mr-2" />
                    Record Payment
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[90vw] lg:max-w-[85vw] xl:max-w-[80vw] max-h-[90vh] overflow-y-auto p-0" style={{ background: "var(--lux-surface)" }}>
                  <div className="relative px-6 pt-6 pb-4" style={{ background: "linear-gradient(135deg, rgba(var(--lux-accent-rgb),0.08) 0%, rgba(var(--lux-accent-rgb),0.02) 100%)" }}>
                    <div className="flex items-center gap-3.5">
                      <div className="relative">
                        <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(var(--lux-accent-rgb),0.18) 0%, rgba(168,85,247,0.12) 100%)" }}>
                          <Plus className="w-5 h-5" style={{ color: "var(--lux-accent)" }} />
                        </div>
                        <div className="absolute -inset-1.5 rounded-xl opacity-30 blur-lg -z-10" style={{ background: "radial-gradient(circle, rgba(var(--lux-accent-rgb),0.4) 0%, transparent 70%)" }} />
                      </div>
                      <div>
                        <DialogTitle className="text-lg font-bold" style={{ color: "var(--lux-text)" }}>Record Payment</DialogTitle>
                        <p className="text-xs mt-0.5" style={{ color: "var(--lux-text-muted)" }}>Record a new payment against an invoice</p>
                      </div>
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 h-px" style={{ background: "linear-gradient(90deg, var(--lux-accent), transparent 60%)", opacity: 0.25 }} />
                  </div>
                  <div className="px-6 pb-6">
                  <form onSubmit={(e) => { e.preventDefault(); setFormTouched(true); if (!invoiceId || !amount || !date) return; createMutation.mutate(); }} className="space-y-4">
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <CreditCard className="w-3.5 h-3.5" style={{ color: "var(--lux-accent)" }} />
                        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Invoice Details</span>
                      </div>
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label>Invoice *</Label>
                          <Popover open={invoiceComboOpen} onOpenChange={setInvoiceComboOpen}>
                            <PopoverTrigger asChild>
                              <Button variant="outline" role="combobox" aria-expanded={invoiceComboOpen}
                                className="w-full justify-between h-9 text-sm font-normal"
                                style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: invoiceId ? "var(--lux-text)" : "var(--lux-text-muted)" }}
                                data-testid="select-payment-invoice">
                                {invoiceId ? (() => { const inv = unpaidInvoices?.find(i => i.id === invoiceId); return inv ? `${inv.number} - ${inv.clientName} (${formatMoney(Number(inv.total) - Number(inv.paidAmount), baseCurrency)} due)` : "Select invoice"; })() : "Select invoice"}
                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-full p-0" align="start">
                              <Command>
                                <CommandInput placeholder="Search invoices..." />
                                <CommandList>
                                  <CommandEmpty>No invoices found.</CommandEmpty>
                                  <CommandGroup>
                                    {unpaidInvoices?.map(inv => {
                                      const remaining = Number(inv.total) - Number(inv.paidAmount);
                                      return (
                                        <CommandItem key={inv.id} value={`${inv.number} ${inv.clientName}`} onSelect={() => {
                                          setInvoiceId(inv.id);
                                          setAmount(remaining.toFixed(2));
                                          setInvoiceComboOpen(false);
                                        }}>
                                          <Check className={cn("mr-2 h-4 w-4", invoiceId === inv.id ? "opacity-100" : "opacity-0")} />
                                          {inv.number} - {inv.clientName} ({formatMoney(remaining, baseCurrency)} due)
                                        </CommandItem>
                                      );
                                    })}
                                  </CommandGroup>
                                </CommandList>
                              </Command>
                            </PopoverContent>
                          </Popover>
                          {formTouched && !invoiceId && (
                            <p className="text-[11px] mt-1 font-medium" style={{ color: "#ef4444" }}>This field is required</p>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>Amount ($) *</Label>
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium" style={{ color: "var(--lux-text-muted)" }}>$</span>
                              <Input type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required className="pl-7 tabular-nums text-right h-8 text-sm" style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }} data-testid="input-payment-amount" />
                            </div>
                            {formTouched && !amount && (
                              <p className="text-[11px] mt-1 font-medium" style={{ color: "#ef4444" }}>This field is required</p>
                            )}
                            {amount && invoiceId && (() => {
                              const viewInvoice = unpaidInvoices?.find(i => i.id === invoiceId);
                              if (!viewInvoice) return null;
                              const remaining = Number(viewInvoice.total) - Number(viewInvoice.paidAmount);
                              return Number(amount) > remaining ? (
                                <p className="text-[11px] mt-1 font-medium" style={{ color: "#f59e0b" }}>Amount exceeds remaining balance of ${remaining.toFixed(2)}</p>
                              ) : null;
                            })()}
                          </div>
                          <div className="space-y-2">
                            <Label>Reference Number</Label>
                            <Input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} placeholder={({
                              CHECK: "Check #", ACH: "ACH trace #", WIRE: "Wire reference #",
                              CREDIT_CARD: "Last 4 or auth code", CASH: "Receipt #",
                              BANK_TRANSFER: "Transfer reference #", DEBIT_CARD: "Last 4 or auth code",
                            } as Record<string, string>)[method] || "Reference #"} style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }} data-testid="input-payment-reference" />
                          </div>
                        </div>
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <CalendarIcon className="w-3.5 h-3.5" style={{ color: "#3b82f6" }} />
                        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Payment Info</span>
                      </div>
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>Date *</Label>
                            <Popover open={datePopoverOpen} onOpenChange={setDatePopoverOpen}>
                              <PopoverTrigger asChild>
                                <Button variant="outline" className="w-full justify-start text-left font-normal h-9 text-sm"
                                  style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: date ? "var(--lux-text)" : "var(--lux-text-muted)" }}
                                  data-testid="input-payment-date">
                                  <CalendarIcon className="mr-2 h-4 w-4" />
                                  {date ? format(new Date(date + "T00:00:00"), "MMM d, yyyy") : "Pick a date"}
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-0" align="start">
                                <Calendar mode="single" selected={date ? new Date(date + "T00:00:00") : undefined}
                                  onSelect={(day) => { if (day) { setDate(format(day, "yyyy-MM-dd")); setDatePopoverOpen(false); } }} />
                              </PopoverContent>
                            </Popover>
                            {formTouched && !date && (
                              <p className="text-[11px] mt-1 font-medium" style={{ color: "#ef4444" }}>This field is required</p>
                            )}
                          </div>
                          <div className="space-y-2">
                            <Label>Method</Label>
                            <Select value={method} onValueChange={setMethod}>
                              <SelectTrigger style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }} data-testid="select-payment-method">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="CHECK">Check</SelectItem>
                                <SelectItem value="WIRE">Wire Transfer</SelectItem>
                                <SelectItem value="ACH">ACH</SelectItem>
                                <SelectItem value="BANK_TRANSFER">Bank Transfer</SelectItem>
                                <SelectItem value="CREDIT_CARD">Credit Card</SelectItem>
                                <SelectItem value="DEBIT_CARD">Debit Card</SelectItem>
                                <SelectItem value="CASH">Cash</SelectItem>
                                <SelectItem value="OTHER">Other</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label>Notes</Label>
                          <Textarea rows={3} placeholder="Add payment notes, reference numbers, or memo..."
                            value={notes} onChange={(e) => setNotes(e.target.value)}
                            style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                            data-testid="input-payment-notes" />
                        </div>
                      </div>
                    </div>
                    <Button
                      type="submit"
                      className="w-full text-white transition-all duration-200 hover:scale-[1.03] hover:shadow-lg"
                      disabled={createMutation.isPending || !invoiceId || !amount}
                      data-testid="button-submit-payment"
                      style={{ background: "var(--gradient-brand)" }}
                    >
                      {createMutation.isPending ? "Recording..." : "Record Payment"}
                    </Button>
                  </form>
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>

        <div className="h-px w-full" style={{ background: "linear-gradient(90deg, var(--lux-accent), transparent 60%)", opacity: 0.3 }} />

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4" data-testid="payment-stats-row">
          {statCards.map(sc => {
            const Icon = sc.icon;
            return (
              <div
                key={sc.key}
                className="group relative rounded-xl p-4 transition-all duration-300 hover:-translate-y-0.5 cursor-default overflow-hidden"
                style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}
                data-testid={`stat-card-${sc.key}`}
              >
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-xl" style={{ background: sc.gradient }} />
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>{sc.label}</p>
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-transform duration-300 group-hover:scale-110${(sc as any).pulse ? " animate-pulse" : ""}`} style={{ background: (sc as any).iconBg || `${sc.color}15` }}>
                      <Icon className="w-4 h-4" style={{ color: sc.color }} />
                    </div>
                  </div>
                  <p className="text-xl font-bold tracking-tight" style={{ color: "var(--lux-text)" }}>{sc.value}</p>
                  <p className="text-[11px] mt-1" style={{ color: "var(--lux-text-muted)" }}>{sc.sub}</p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "rgba(var(--lux-accent-rgb),0.08)" }}>
                <ClipboardList className="w-5 h-5" style={{ color: "var(--lux-accent)" }} />
              </div>
              <div>
                <h2 className="text-lg font-bold tracking-tight" style={{ color: "var(--lux-text)" }} data-testid="text-outstanding-title">Outstanding Invoices</h2>
                <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>Invoices awaiting payment</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap rounded-xl p-1.5" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }} data-testid="ar-filter-tabs">
            {([
              { key: "ALL", label: "All", icon: Layers },
              { key: "OVERDUE", label: "Overdue", icon: AlertTriangle },
              { key: "DUE_WEEK", label: "Due This Week", icon: Clock },
              { key: "DUE_MONTH", label: "Due ≤ 30 Days", icon: CalendarIcon },
              { key: "PARTIAL", label: "Partially Paid", icon: CreditCard },
            ] as const).map(tab => {
              const TabIcon = tab.icon;
              const active = arFilterTab === tab.key;
              const cnt = arTabCounts[tab.key] ?? 0;
              const col = tab.key === "OVERDUE" ? "#ef4444" : tab.key === "DUE_WEEK" ? "#f59e0b" : tab.key === "DUE_MONTH" ? "#3b82f6" : tab.key === "PARTIAL" ? "#a855f7" : "#8b5cf6";
              return (
                <button key={tab.key} onClick={() => { setArFilterTab(tab.key); setArSelectedIds(new Set()); }}
                  className="relative flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all duration-200 hover:scale-[1.02]"
                  style={{ background: active ? `${col}15` : "transparent", color: active ? col : "var(--lux-text-muted)", boxShadow: active ? `0 0 0 1px ${col}30, 0 1px 3px ${col}10` : "none" }}
                  data-testid={`ar-filter-${tab.key.toLowerCase()}`}>
                  <TabIcon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                  {cnt > 0 && <span className="ml-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-bold leading-none" style={{ background: active ? `${col}25` : "var(--lux-border)", color: active ? col : "var(--lux-text-muted)" }}>{cnt}</span>}
                </button>
              );
            })}
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--lux-text-muted)" }} />
            <Input placeholder="Search by invoice # or client..." value={arSearch} onChange={(e) => setArSearch(e.target.value)}
              className="pl-9 h-9 text-sm" style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
              data-testid="input-ar-search" />
          </div>

          {outstandingInvoices.length === 0 ? (
            <div className="rounded-xl p-8 text-center" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
              <CheckCircle className="w-10 h-10 mx-auto mb-3" style={{ color: "#22c55e", opacity: 0.5 }} />
              <p className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>All caught up!</p>
              <p className="text-xs mt-1" style={{ color: "var(--lux-text-muted)" }}>No outstanding invoices to display.</p>
            </div>
          ) : (
            <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow style={{ background: "var(--lux-table-header-bg)" }}>
                        <TableHead className="w-10">
                          <Checkbox checked={outstandingInvoices.length > 0 && outstandingInvoices.every(i => arSelectedIds.has(i.id))}
                            onCheckedChange={(v) => { if (v) { setArSelectedIds(new Set(outstandingInvoices.map(i => i.id))); } else { setArSelectedIds(new Set()); } }}
                            aria-label="Select all outstanding invoices"
                            data-testid="checkbox-select-all-ar" />
                        </TableHead>
                        <TableHead><span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Invoice #</span></TableHead>
                        <TableHead><span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Client</span></TableHead>
                        <TableHead><span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Amount Due</span></TableHead>
                        <TableHead><span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Due Date</span></TableHead>
                        <TableHead><span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Status</span></TableHead>
                        <TableHead className="w-24"><span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Action</span></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {outstandingInvoices.map(inv => (
                        <TableRow key={inv.id} data-testid={`row-ar-${inv.id}`}>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Checkbox checked={arSelectedIds.has(inv.id)}
                              onCheckedChange={() => { const next = new Set(arSelectedIds); if (next.has(inv.id)) next.delete(inv.id); else next.add(inv.id); setArSelectedIds(next); }}
                              aria-label="Select invoice"
                              data-testid={`checkbox-ar-${inv.id}`} />
                          </TableCell>
                          <TableCell><span className="text-sm font-medium tabular-nums" style={{ color: "var(--lux-text)" }}>{inv.number}</span></TableCell>
                          <TableCell><span className="text-sm" style={{ color: "var(--lux-text)" }}>{inv.clientName}</span></TableCell>
                          <TableCell>
                            <span className="text-sm font-bold tabular-nums" style={{ color: "var(--lux-text)" }}>
                              {formatMoney(inv.remaining, baseCurrency)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div>
                              <span className="text-sm" style={{ color: "var(--lux-text)" }}>{format(new Date(inv.dueDate + "T00:00:00"), "MMM d, yyyy")}</span>
                              <p className="text-[10px] font-medium" style={{ color: inv.dueStatus.daysColor }}>{inv.dueStatus.daysText}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
                              style={{ background: `${inv.dueStatus.color}15`, color: inv.dueStatus.color }}>
                              {inv.dueStatus.label}
                            </span>
                          </TableCell>
                          <TableCell>
                            {canManage && (
                              <Button size="sm" className="h-7 px-3 text-xs text-white transition-all hover:scale-[1.03] hover:shadow-lg"
                                style={{ background: "var(--gradient-brand)" }}
                                onClick={() => handlePayInvoice(inv)}
                                data-testid={`button-pay-${inv.id}`}>
                                Pay
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="px-5 py-3 flex items-center justify-between border-t" style={{ borderColor: "var(--lux-border)", background: "var(--lux-table-header-bg)" }}>
                  <span className="text-sm font-medium" style={{ color: "var(--lux-text-secondary)" }}>{outstandingInvoices.length} invoice{outstandingInvoices.length !== 1 ? "s" : ""}</span>
                  <span className="text-sm font-bold tabular-nums" style={{ color: "#ef4444" }}>
                    Total Due: {formatMoney(outstandingInvoices.reduce((s, i) => s + i.remaining, 0), baseCurrency)}
                  </span>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {arSelectedIds.size > 0 && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 px-6 py-3 rounded-xl shadow-2xl animate-in slide-in-from-bottom-4"
            style={{ background: "var(--lux-surface)", border: "1px solid var(--lux-border)", boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}
            data-testid="bulk-pay-bar">
            <div>
              <span className="text-sm font-bold" style={{ color: "var(--lux-text)" }}>{arSelectedIds.size} invoice{arSelectedIds.size !== 1 ? "s" : ""} selected</span>
              <span className="text-sm ml-2 tabular-nums" style={{ color: "var(--lux-text-muted)" }}>
                Total: {formatMoney((unpaidInvoices || []).filter(i => arSelectedIds.has(i.id)).reduce((s, i) => s + Number(i.total) - Number(i.paidAmount), 0), baseCurrency)}
              </span>
            </div>
            <Button className="text-white transition-all hover:scale-[1.03] hover:shadow-lg" style={{ background: "var(--gradient-brand)" }}
              onClick={() => setBulkPayOpen(true)} data-testid="button-bulk-pay">
              Record Bulk Payment
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setArSelectedIds(new Set())} aria-label="Clear selection"><X className="w-4 h-4" /></Button>
          </div>
        )}

        <div className="flex items-center gap-3 pt-2">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "rgba(34,197,94,0.08)" }}>
            <CreditCard className="w-5 h-5" style={{ color: "#22c55e" }} />
          </div>
          <div>
            <h2 className="text-lg font-bold tracking-tight" style={{ color: "var(--lux-text)" }} data-testid="text-history-title">Payment History</h2>
            <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>All recorded payments and transactions</p>
          </div>
          <div className="flex-1 h-px" style={{ background: "linear-gradient(90deg, var(--lux-border), transparent)" }} />
        </div>

        <div className="flex items-center gap-1.5 flex-wrap rounded-xl p-1.5" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }} data-testid="filter-status-tabs">
          {(["ALL", "PENDING", "CLEARED", "RECONCILED", "VOIDED", "REFUNDED"] as const).map(s => {
            const Icon = STATUS_ICONS[s];
            const active = statusTab === (s === "ALL" ? "All" : s);
            const cnt = statusCounts[s] ?? 0;
            const col = STATUS_COLORS[s] || "var(--lux-accent)";
            return (
              <button
                key={s}
                onClick={() => { setStatusTab(s === "ALL" ? "All" : s); setSelectedIds(new Set()); setHubFilter(null); }}
                className="relative flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all duration-200 hover:scale-[1.02]"
                style={{
                  background: active ? `${col}15` : "transparent",
                  color: active ? col : "var(--lux-text-muted)",
                  boxShadow: active ? `0 0 0 1px ${col}30, 0 1px 3px ${col}10` : "none",
                }}
                data-testid={`button-filter-${s.toLowerCase()}`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{PAYMENT_STATUS_LABELS[s]}</span>
                {cnt > 0 && (
                  <span
                    className="ml-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-bold leading-none"
                    style={{ background: active ? `${col}25` : "var(--lux-border)", color: active ? col : "var(--lux-text-muted)" }}
                  >
                    {cnt}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
          <CardContent className="p-4 space-y-4">
            {(() => {
              const methodLabel = (m: string) => m === "BANK_TRANSFER" ? "Bank Transfer" : m === "CREDIT_CARD" ? "Credit Card" : m === "DEBIT_CARD" ? "Debit Card" : (m.charAt(0) + m.slice(1).toLowerCase());
              const fmtDate = (d: string) => {
                try { return format(new Date(d + "T00:00:00"), "MMM d, yyyy"); } catch { return d; }
              };
              const chips: FilterChipDescriptor[] = [];
              if (dateFrom || dateTo) {
                const isHubRange = hubFilter && (() => {
                  const now = new Date();
                  const y = now.getFullYear(); const m = now.getMonth();
                  const pad = (n: number) => String(n).padStart(2, "0");
                  const fmtLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
                  return hubFilter.key === "this-month" && dateFrom === fmtLocal(new Date(y, m, 1)) && dateTo === fmtLocal(new Date(y, m + 1, 0));
                })();
                const label = isHubRange
                  ? hubFilter!.label
                  : dateFrom && dateTo
                    ? `Date: ${fmtDate(dateFrom)} – ${fmtDate(dateTo)}`
                    : dateFrom
                      ? `Date from: ${fmtDate(dateFrom)}`
                      : `Date to: ${fmtDate(dateTo)}`;
                chips.push({
                  id: "hub-filter",
                  label,
                  onClear: () => { setDateFrom(""); setDateTo(""); setHubFilter(null); },
                });
              }
              if (statusTab !== "All") {
                chips.push({
                  id: "status",
                  label: `Status: ${statusTab}`,
                  onClear: () => setStatusTab("All"),
                });
              }
              if (searchTerm) {
                chips.push({
                  id: "search",
                  label: `Search: "${searchTerm}"`,
                  onClear: () => setSearchTerm(""),
                });
              }
              if (methodFilter !== "ALL") {
                chips.push({
                  id: "method",
                  label: `Method: ${methodLabel(methodFilter)}`,
                  onClear: () => setMethodFilter("ALL"),
                });
              }
              return <ActiveFilterBar chips={chips} />;
            })()}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--lux-text-muted)" }} />
                <Input
                  placeholder="Search by invoice # or client name..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 h-9 text-sm"
                  style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                  data-testid="input-payment-search"
                />
              </div>
              <Select value={methodFilter} onValueChange={setMethodFilter}>
                <SelectTrigger className="w-[160px]" style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }} data-testid="select-method-filter">
                  <SelectValue placeholder="Method" />
                </SelectTrigger>
                <SelectContent>
                  {methodOptions.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m === "ALL" ? "All Methods" : m === "BANK_TRANSFER" ? "Bank Transfer" : m === "CREDIT_CARD" ? "Credit Card" : m === "DEBIT_CARD" ? "Debit Card" : m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Popover open={dateFromPopoverOpen} onOpenChange={setDateFromPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-[150px] justify-start text-left font-normal h-9 text-sm"
                    style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: dateFrom ? "var(--lux-text)" : "var(--lux-text-muted)" }}
                    data-testid="input-date-from">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateFrom ? format(new Date(dateFrom + "T00:00:00"), "MMM d, yyyy") : "From"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={dateFrom ? new Date(dateFrom + "T00:00:00") : undefined}
                    onSelect={(day) => { if (day) { setDateFrom(format(day, "yyyy-MM-dd")); setDateFromPopoverOpen(false); } }} />
                </PopoverContent>
              </Popover>
              <Popover open={dateToPopoverOpen} onOpenChange={setDateToPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-[150px] justify-start text-left font-normal h-9 text-sm"
                    style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: dateTo ? "var(--lux-text)" : "var(--lux-text-muted)" }}
                    data-testid="input-date-to">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateTo ? format(new Date(dateTo + "T00:00:00"), "MMM d, yyyy") : "To"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={dateTo ? new Date(dateTo + "T00:00:00") : undefined}
                    onSelect={(day) => { if (day) { setDateTo(format(day, "yyyy-MM-dd")); setDateToPopoverOpen(false); } }} />
                </PopoverContent>
              </Popover>
            </div>
          </CardContent>
        </Card>

        {selectedIds.size > 0 && (
          <div
            className="flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg animate-in slide-in-from-bottom-2"
            style={{
              background: "var(--lux-surface)",
              borderColor: "var(--lux-border)",
            }}
            data-testid="bulk-action-bar"
          >
            <span className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>
              {selectedIds.size} selected
            </span>
            <div className="flex gap-2 ml-auto">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="sm" variant="outline" onClick={handleBulkExport} data-testid="button-bulk-export">
                      <Download className="w-3 h-3 mr-1" /> Export
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Export selected to CSV</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="sm" variant="outline" onClick={handleBulkMarkCleared} data-testid="button-bulk-mark-cleared">
                      <CheckCircle className="w-3 h-3 mr-1" /> Mark Cleared
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Mark all selected as cleared</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="destructive" data-testid="button-bulk-delete">
                    <Trash2 className="w-3 h-3 mr-1" /> Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {selectedIds.size} Payment(s)</AlertDialogTitle>
                    <AlertDialogDescription>
                      This action cannot be undone. All selected payments will be permanently deleted and invoice balances will be recalculated.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleBulkDelete} className="bg-red-600 hover:bg-red-700">
                      Delete All
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())} data-testid="button-clear-selection" aria-label="Clear selection">
                <X className="w-3 h-3" />
              </Button>
            </div>
          </div>
        )}

        {!filteredPayments.length ? (
          <Card
            className="border-0"
            style={{
              background: "var(--lux-surface)",
              boxShadow: "var(--lux-card-shadow)",
            }}
          >
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
                style={{ background: "var(--lux-surface)" }}
              >
                <CreditCard className="w-8 h-8" style={{ color: "var(--lux-text-muted)" }} />
              </div>
              <h3 className="text-lg font-semibold mb-1" style={{ color: "var(--lux-text)" }}>
                {payments?.length ? "No payments match your filters" : "No payments yet"}
              </h3>
              <p className="text-sm mb-4" style={{ color: "var(--lux-text-muted)" }}>
                {payments?.length ? "Try adjusting your search, method filter, or date range" : "Record your first payment against an invoice to get started"}
              </p>
              {!payments?.length && canManage && (
                <Button onClick={() => setOpen(true)} data-testid="button-empty-create" style={{ background: "var(--gradient-brand)" }} className="text-white transition-all duration-200 hover:scale-[1.03] hover:shadow-lg">
                  <Plus className="w-4 h-4 mr-2" /> Record Payment
                </Button>
              )}
            </div>
          </Card>
        ) : (
          <Card
            className="border-0"
            style={{
              background: "var(--lux-surface)",
              boxShadow: "var(--lux-card-shadow)",
            }}
          >
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow style={{ background: "var(--lux-table-header-bg)" }}>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={allChecked}
                          onCheckedChange={toggleAll}
                          aria-label="Select all payments"
                          data-testid="checkbox-select-all"
                        />
                      </TableHead>
                      <TableHead>
                        <button className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }} onClick={() => handleSort("invoiceNumber")} data-testid="button-sort-invoice">
                          Invoice / Client <SortIcon field="invoiceNumber" />
                        </button>
                      </TableHead>
                      <TableHead>
                        <button className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }} onClick={() => handleSort("status")} data-testid="button-sort-status">
                          Status <SortIcon field="status" />
                        </button>
                      </TableHead>
                      <TableHead>
                        <button className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }} onClick={() => handleSort("date")} data-testid="button-sort-date">
                          Date <SortIcon field="date" />
                        </button>
                      </TableHead>
                      <TableHead>
                        <button className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }} onClick={() => handleSort("method")} data-testid="button-sort-method">
                          Method <SortIcon field="method" />
                        </button>
                      </TableHead>
                      <TableHead>
                        <button className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }} onClick={() => handleSort("amount")} data-testid="button-sort-amount">
                          Amount <SortIcon field="amount" />
                        </button>
                      </TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredPayments.map((payment) => {
                      const isRefund = Number(payment.amount) < 0;
                      const isActive = detailId === payment.id;
                      const isSelected = selectedIds.has(payment.id);
                      const paymentStatus = (payment as any).status || "CLEARED";
                      return (
                        <TableRow
                          key={payment.id}
                          className={`cursor-pointer transition-colors ${isActive ? "ring-1 ring-inset" : ""}`}
                          style={{
                            background: isActive ? "var(--lux-hover)" : undefined,
                          }}
                          onClick={() => setDetailId(payment.id === detailId ? null : payment.id)}
                          data-testid={`row-payment-${payment.id}`}
                        >
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleOne(payment.id)}
                              aria-label="Select payment"
                              data-testid={`checkbox-payment-${payment.id}`}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div
                                className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0"
                                style={{
                                  background: isRefund ? "rgba(239,68,68,0.1)" : "rgba(34,197,94,0.1)",
                                  color: isRefund ? "#ef4444" : "#22c55e",
                                }}
                              >
                                <DollarSign className="w-4 h-4" />
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-medium" style={{ color: "var(--lux-text)" }} data-testid={`text-payment-invoice-${payment.id}`}>
                                  {payment.invoiceNumber}
                                </p>
                                <p className="text-xs" style={{ color: "var(--lux-text-muted)" }} data-testid={`text-payment-client-${payment.id}`}>
                                  {payment.clientName}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <PaymentStatusBadge status={paymentStatus} />
                          </TableCell>
                          <TableCell data-testid={`text-payment-date-${payment.id}`}>
                            <DateDisplay value={payment.date} />
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={payment.method} size="xs" />
                          </TableCell>
                          <TableCell data-testid={`text-payment-amount-${payment.id}`}>
                            <MoneyDisplay
                              value={Math.abs(Number(payment.amount))}
                              currency={baseCurrency}
                              color={isRefund ? "negative" : "positive"}
                              size="sm"
                            />
                          </TableCell>
                          <TableCell>
                            <ChevronRight className="w-4 h-4" style={{ color: "var(--lux-text-muted)", transform: isActive ? "rotate(90deg)" : undefined, transition: "transform 0.2s" }} />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <div
                className="px-5 py-3 flex items-center justify-between gap-4 border-t"
                style={{ borderColor: "var(--lux-border)", background: "var(--lux-table-header-bg)" }}
                data-testid="row-payment-summary"
              >
                <span className="text-sm font-medium" style={{ color: "var(--lux-text-secondary)" }}>
                  {filteredPayments.length} payment{filteredPayments.length !== 1 ? "s" : ""}
                </span>
                <span className="text-sm font-bold tabular-nums" style={{ color: filteredTotal >= 0 ? "#22c55e" : "#ef4444" }} data-testid="text-payment-total">
                  Total: {formatMoney(filteredTotal, baseCurrency)}
                </span>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {detailId && detailPayment && (
        <div
          ref={detailPanelRef}
          className="fixed right-0 top-0 bottom-0 w-[440px] border-l overflow-y-auto z-40 animate-in slide-in-from-right-8 duration-300"
          style={{
            background: "var(--lux-surface)",
            borderColor: "var(--lux-border)",
          }}
          data-testid="detail-panel"
        >
          <div className="sticky top-0 z-10 border-b relative"
            style={{ borderColor: "var(--lux-border)" }}
          >
            <div className="flex items-center justify-between px-5 py-4"
              style={{ background: "linear-gradient(135deg, rgba(var(--lux-accent-rgb),0.08) 0%, rgba(var(--lux-accent-rgb),0.02) 100%)" }}>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(var(--lux-accent-rgb),0.18) 0%, rgba(168,85,247,0.12) 100%)" }}>
                    <DollarSign className="w-5 h-5" style={{ color: "var(--lux-accent)" }} />
                  </div>
                  <div className="absolute -inset-1 rounded-xl opacity-30 blur-md -z-10" style={{ background: "radial-gradient(circle, rgba(var(--lux-accent-rgb),0.4) 0%, transparent 70%)" }} />
                </div>
                <div>
                  <h2 className="font-bold text-lg" style={{ color: "var(--lux-text)" }}>
                    Payment Details
                  </h2>
                  <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
                    {detailPayment.invoiceNumber} · {detailPayment.clientName}
                  </p>
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setDetailId(null)} data-testid="button-close-detail" aria-label="Close detail panel">
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="absolute bottom-0 left-0 right-0 h-px" style={{ background: "linear-gradient(90deg, var(--lux-accent), transparent 60%)", opacity: 0.25 }} />
          </div>

          <div className="p-5 space-y-5">
            <div className="flex items-center gap-2 flex-wrap">
              <PaymentStatusBadge status={(detailPayment as any).status || "CLEARED"} />
              {Number(detailPayment.amount) < 0 && (
                <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                  <AlertTriangle className="w-3 h-3 mr-1" /> Refund
                </Badge>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg p-3 text-center" style={{ background: "var(--lux-bg)" }}>
                <p className="text-xs font-medium uppercase tracking-wider mb-1" style={{ color: "var(--lux-text-muted)" }}>Amount</p>
                <p className="text-lg font-bold tabular-nums" style={{ color: Number(detailPayment.amount) < 0 ? "#ef4444" : "#22c55e" }}>
                  {formatMoney(Math.abs(Number(detailPayment.amount)), baseCurrency)}
                </p>
              </div>
              <div className="rounded-lg p-3 text-center" style={{ background: "var(--lux-bg)" }}>
                <p className="text-xs font-medium uppercase tracking-wider mb-1" style={{ color: "var(--lux-text-muted)" }}>Method</p>
                <p className="text-sm font-semibold" style={{ color: "var(--lux-text)" }}>{detailPayment.method}</p>
              </div>
              <div className="rounded-lg p-3 text-center" style={{ background: "var(--lux-bg)" }}>
                <p className="text-xs font-medium uppercase tracking-wider mb-1" style={{ color: "var(--lux-text-muted)" }}>Date</p>
                <p className="text-sm font-semibold" style={{ color: "var(--lux-text)" }}>
                  <DateDisplay value={detailPayment.date} />
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <span className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Invoice</span>
                <p className="font-semibold" style={{ color: "var(--lux-text)" }}>{detailPayment.invoiceNumber}</p>
              </div>
              <div>
                <span className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Client</span>
                <p className="font-semibold" style={{ color: "var(--lux-text)" }}>{detailPayment.clientName}</p>
              </div>
              {(detailPayment as any).referenceNumber && (
                <div>
                  <span className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Reference Number</span>
                  <div className="flex items-center gap-1">
                    <Hash className="w-3 h-3" style={{ color: "var(--lux-text-muted)" }} />
                    <p className="font-medium text-sm" style={{ color: "var(--lux-text)" }}>{(detailPayment as any).referenceNumber}</p>
                  </div>
                </div>
              )}
              {detailPayment.provider && detailPayment.provider !== "MANUAL" && (
                <div>
                  <span className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Provider</span>
                  <p className="font-medium text-sm" style={{ color: "var(--lux-text)" }}>{detailPayment.provider}</p>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Clock className="w-3.5 h-3.5" style={{ color: "var(--lux-accent)" }} />
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Timeline</span>
              </div>
              <div className="relative pl-5 space-y-3">
                <div className="absolute left-[7px] top-1 bottom-1 w-px" style={{ background: "var(--lux-border)" }} />
                <div className="relative flex items-start gap-3">
                  <div className="absolute left-[-13px] top-1.5 w-2.5 h-2.5 rounded-full border-2" style={{ borderColor: "#22c55e", background: "var(--lux-surface)" }} />
                  <div>
                    <p className="text-xs font-semibold" style={{ color: "var(--lux-text)" }}>Payment Recorded</p>
                    <p className="text-[11px]" style={{ color: "var(--lux-text-muted)" }}>
                      {new Date(detailPayment.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </div>
                {(glPostStatus?.posted || glPostedIds.has(detailPayment.id)) && (
                  <div className="relative flex items-start gap-3">
                    <div className="absolute left-[-13px] top-1.5 w-2.5 h-2.5 rounded-full border-2" style={{ borderColor: "#3b82f6", background: "var(--lux-surface)" }} />
                    <div>
                      <p className="text-xs font-semibold" style={{ color: "var(--lux-text)" }}>Posted to GL</p>
                      <p className="text-[11px]" style={{ color: "var(--lux-text-muted)" }}>
                        {glPostStatus?.postedAt
                          ? new Date(glPostStatus.postedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })
                          : "Journal entry created"}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 rounded-lg p-3" style={{ background: (glPostStatus?.posted || glPostedIds.has(detailPayment.id)) ? "rgba(34,197,94,0.06)" : "rgba(245,158,11,0.06)", border: `1px solid ${(glPostStatus?.posted || glPostedIds.has(detailPayment.id)) ? "rgba(34,197,94,0.15)" : "rgba(245,158,11,0.15)"}` }} data-testid="gl-posted-status">
              <BookOpen className="w-4 h-4 flex-shrink-0" style={{ color: (glPostStatus?.posted || glPostedIds.has(detailPayment.id)) ? "#22c55e" : "#f59e0b" }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-semibold" style={{ color: "var(--lux-text)" }}>GL Status</p>
                  <Badge className="text-[10px] px-1.5 py-0" style={{ background: (glPostStatus?.posted || glPostedIds.has(detailPayment.id)) ? "rgba(34,197,94,0.15)" : "rgba(245,158,11,0.15)", color: (glPostStatus?.posted || glPostedIds.has(detailPayment.id)) ? "#22c55e" : "#f59e0b", border: "none" }}>
                    {(glPostStatus?.posted || glPostedIds.has(detailPayment.id)) ? "Posted to GL" : "Not yet posted"}
                  </Badge>
                </div>
                {glPostStatus?.posted && glPostStatus.journalEntryId && (
                  <div className="mt-1">
                    <a href="/gl/journal-entries" className="text-[11px] font-medium hover:underline" style={{ color: "var(--lux-accent)" }} data-testid="link-journal-entry">
                      Journal Entry #{glPostStatus.journalEntryId} →
                    </a>
                    {glPostStatus.postedAt && (
                      <span className="text-[10px] ml-2" style={{ color: "var(--lux-text-muted)" }}>
                        {new Date(glPostStatus.postedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {canManage && (
              <div className="space-y-2 rounded-lg p-4 border" style={{ borderColor: "var(--lux-border)" }}>
                <span className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Update Status</span>
                <Select
                  value={(detailPayment as any).status || "CLEARED"}
                  onValueChange={(val) => updateStatusMutation.mutate({ id: detailPayment.id, status: val })}
                >
                  <SelectTrigger className="h-9" style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }} data-testid="select-detail-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PENDING">Pending</SelectItem>
                    <SelectItem value="CLEARED">Cleared</SelectItem>
                    <SelectItem value="RECONCILED">Reconciled</SelectItem>
                    <SelectItem value="VOIDED">Voided</SelectItem>
                    <SelectItem value="REFUNDED">Refunded</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <span className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Notes</span>
              <Textarea
                value={detailNotes}
                onChange={(e) => setDetailNotes(e.target.value)}
                placeholder="Add internal notes..."
                className="min-h-[80px] text-sm"
                style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                data-testid="input-detail-notes"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => saveDetailNotesMutation.mutate()}
                disabled={saveDetailNotesMutation.isPending}
                data-testid="button-save-detail-notes"
              >
                <Save className="w-3 h-3 mr-1" /> Save Notes
              </Button>
            </div>

            {canManage && (
              <div className="space-y-2 pt-3 border-t" style={{ borderColor: "var(--lux-border)" }}>
                <span className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Actions</span>
                <div className="flex flex-wrap gap-2">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button size="sm" variant="outline" onClick={() => openEdit(detailPayment)} data-testid={`button-edit-payment-${detailPayment.id}`}>
                          <Pencil className="w-3 h-3 mr-1" /> Edit
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Edit payment details</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  {detailPayment.provider === "MANUAL" && Number(detailPayment.amount) > 0 && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button size="sm" variant="outline" onClick={() => openRefund(detailPayment)} data-testid={`button-refund-payment-${detailPayment.id}`}>
                            <RotateCcw className="w-3 h-3 mr-1" /> Refund
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Create a refund for this payment</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                  {!autoPostEnabled && Number(detailPayment.amount) > 0 && !glPostedIds.has(detailPayment.id) && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => postGlMutation.mutate(detailPayment.id)}
                            disabled={postGlMutation.isPending}
                            data-testid={`button-post-gl-payment-${detailPayment.id}`}
                          >
                            <BookOpen className="w-3 h-3 mr-1" /> Post GL
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Post journal entry to General Ledger</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button size="sm" variant="destructive" onClick={() => openDelete(detailPayment)} data-testid={`button-delete-payment-${detailPayment.id}`}>
                          <Trash2 className="w-3 h-3 mr-1" /> Delete
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Permanently delete this payment</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <Dialog open={bulkPayOpen} onOpenChange={(v) => { setBulkPayOpen(v); if (!v) { setBulkMethod("CHECK"); setBulkReference(""); setBulkNotes(""); } }}>
        <DialogContent className="sm:max-w-[90vw] lg:max-w-[85vw] xl:max-w-[80vw] max-h-[90vh] overflow-y-auto p-0" style={{ background: "var(--lux-surface)" }}>
          <div className="relative px-6 pt-6 pb-4" style={{ background: "linear-gradient(135deg, rgba(var(--lux-accent-rgb),0.08) 0%, rgba(var(--lux-accent-rgb),0.02) 100%)" }}>
            <div className="flex items-center gap-3.5">
              <div className="relative">
                <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(var(--lux-accent-rgb),0.18) 0%, rgba(168,85,247,0.12) 100%)" }}>
                  <Layers className="w-5 h-5" style={{ color: "var(--lux-accent)" }} />
                </div>
                <div className="absolute -inset-1.5 rounded-xl opacity-30 blur-lg -z-10" style={{ background: "radial-gradient(circle, rgba(var(--lux-accent-rgb),0.4) 0%, transparent 70%)" }} />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold" style={{ color: "var(--lux-text)" }}>Bulk Payment</DialogTitle>
                <p className="text-xs mt-0.5" style={{ color: "var(--lux-text-muted)" }}>Record payments for {arSelectedIds.size} selected invoices</p>
              </div>
            </div>
            <div className="absolute bottom-0 left-0 right-0 h-px" style={{ background: "linear-gradient(90deg, var(--lux-accent), transparent 60%)", opacity: 0.25 }} />
          </div>
          <div className="px-6 pb-6 space-y-6">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <ClipboardList className="w-3.5 h-3.5" style={{ color: "var(--lux-accent)" }} />
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Selected Invoices</span>
              </div>
              <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--lux-border)" }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: "var(--lux-bg)" }}>
                      <th className="text-left px-3 py-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Invoice</th>
                      <th className="text-left px-3 py-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Client</th>
                      <th className="text-right px-3 py-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(unpaidInvoices || []).filter(i => arSelectedIds.has(i.id)).map(inv => (
                      <tr key={inv.id} style={{ borderTop: "1px solid var(--lux-border)" }}>
                        <td className="px-3 py-2 font-medium tabular-nums" style={{ color: "var(--lux-text)" }}>{inv.number}</td>
                        <td className="px-3 py-2" style={{ color: "var(--lux-text-secondary)" }}>{inv.clientName}</td>
                        <td className="px-3 py-2 text-right font-bold tabular-nums" style={{ color: "var(--lux-text)" }}>
                          {formatMoney(Number(inv.total) - Number(inv.paidAmount), baseCurrency)}
                        </td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: "2px solid var(--lux-border)", background: "var(--lux-bg)" }}>
                      <td colSpan={2} className="px-3 py-2 font-bold text-right" style={{ color: "var(--lux-text)" }}>Total</td>
                      <td className="px-3 py-2 text-right font-bold tabular-nums" style={{ color: "var(--lux-accent)" }}>
                        {formatMoney((unpaidInvoices || []).filter(i => arSelectedIds.has(i.id)).reduce((s, i) => s + Number(i.total) - Number(i.paidAmount), 0), baseCurrency)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-3">
                <CalendarIcon className="w-3.5 h-3.5" style={{ color: "#3b82f6" }} />
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Payment Details</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Date</Label>
                  <Popover open={bulkDatePopoverOpen} onOpenChange={setBulkDatePopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-start text-left font-normal h-9 text-sm"
                        style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                        data-testid="input-bulk-date">
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {bulkDate ? format(new Date(bulkDate + "T00:00:00"), "MMM d, yyyy") : "Pick a date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={bulkDate ? new Date(bulkDate + "T00:00:00") : undefined}
                        onSelect={(day) => { if (day) { setBulkDate(format(day, "yyyy-MM-dd")); setBulkDatePopoverOpen(false); } }} />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-2">
                  <Label>Method</Label>
                  <Select value={bulkMethod} onValueChange={setBulkMethod}>
                    <SelectTrigger style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }} data-testid="select-bulk-method">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CHECK">Check</SelectItem>
                      <SelectItem value="WIRE">Wire Transfer</SelectItem>
                      <SelectItem value="ACH">ACH</SelectItem>
                      <SelectItem value="BANK_TRANSFER">Bank Transfer</SelectItem>
                      <SelectItem value="CREDIT_CARD">Credit Card</SelectItem>
                      <SelectItem value="DEBIT_CARD">Debit Card</SelectItem>
                      <SelectItem value="CASH">Cash</SelectItem>
                      <SelectItem value="OTHER">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 mt-4">
                <div className="space-y-2">
                  <Label>Reference Number</Label>
                  <Input value={bulkReference} onChange={(e) => setBulkReference(e.target.value)} placeholder="Reference #"
                    style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                    data-testid="input-bulk-reference" />
                </div>
              </div>
              <div className="space-y-2 mt-4">
                <Label>Notes</Label>
                <Textarea rows={3} placeholder="Add payment notes..." value={bulkNotes} onChange={(e) => setBulkNotes(e.target.value)}
                  style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                  data-testid="input-bulk-notes" />
              </div>
            </div>
            <Button className="w-full text-white transition-all duration-200 hover:scale-[1.03] hover:shadow-lg"
              style={{ background: "var(--gradient-brand)" }}
              disabled={bulkPaying}
              onClick={handleBulkPayment}
              data-testid="button-submit-bulk-pay">
              {bulkPaying ? "Recording Payments..." : `Record ${arSelectedIds.size} Payment${arSelectedIds.size !== 1 ? "s" : ""}`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-[90vw] lg:max-w-[85vw] xl:max-w-[80vw] max-h-[90vh] overflow-y-auto p-0" style={{ background: "var(--lux-surface)" }}>
          <div className="relative px-6 pt-6 pb-4" style={{ background: "linear-gradient(135deg, rgba(var(--lux-accent-rgb),0.08) 0%, rgba(var(--lux-accent-rgb),0.02) 100%)" }}>
            <div className="flex items-center gap-3.5">
              <div className="relative">
                <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(var(--lux-accent-rgb),0.18) 0%, rgba(168,85,247,0.12) 100%)" }}>
                  <Pencil className="w-5 h-5" style={{ color: "var(--lux-accent)" }} />
                </div>
                <div className="absolute -inset-1.5 rounded-xl opacity-30 blur-lg -z-10" style={{ background: "radial-gradient(circle, rgba(var(--lux-accent-rgb),0.4) 0%, transparent 70%)" }} />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold" style={{ color: "var(--lux-text)" }}>Edit Payment</DialogTitle>
                <p className="text-xs mt-0.5" style={{ color: "var(--lux-text-muted)" }}>Update payment details</p>
              </div>
            </div>
            <div className="absolute bottom-0 left-0 right-0 h-px" style={{ background: "linear-gradient(90deg, var(--lux-accent), transparent 60%)", opacity: 0.25 }} />
          </div>
          <div className="px-6 pb-6">
          <form onSubmit={(e) => { e.preventDefault(); updateMutation.mutate(); }} className="space-y-4">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <CreditCard className="w-3.5 h-3.5" style={{ color: "var(--lux-accent)" }} />
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Payment Details</span>
              </div>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Date *</Label>
                    <Popover open={editDatePopoverOpen} onOpenChange={setEditDatePopoverOpen}>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="w-full justify-start text-left font-normal h-9 text-sm"
                          style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: editDate ? "var(--lux-text)" : "var(--lux-text-muted)" }}
                          data-testid="input-edit-payment-date">
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {editDate ? format(new Date(editDate + "T00:00:00"), "MMM d, yyyy") : "Pick a date"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={editDate ? new Date(editDate + "T00:00:00") : undefined}
                          onSelect={(day) => { if (day) { setEditDate(format(day, "yyyy-MM-dd")); setEditDatePopoverOpen(false); } }} />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="space-y-2">
                    <Label>Reference Number</Label>
                    <Input value={editReferenceNumber} onChange={(e) => setEditReferenceNumber(e.target.value)} placeholder={({
                      CHECK: "Check #", ACH: "ACH trace #", WIRE: "Wire reference #",
                      CREDIT_CARD: "Last 4 or auth code", CASH: "Receipt #",
                      BANK_TRANSFER: "Transfer reference #", DEBIT_CARD: "Last 4 or auth code",
                    } as Record<string, string>)[editMethod] || "Reference #"} style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }} data-testid="input-edit-payment-reference" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Method</Label>
                    <Select value={editMethod} onValueChange={setEditMethod}>
                      <SelectTrigger style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }} data-testid="select-edit-payment-method">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CHECK">Check</SelectItem>
                        <SelectItem value="WIRE">Wire Transfer</SelectItem>
                        <SelectItem value="ACH">ACH</SelectItem>
                        <SelectItem value="BANK_TRANSFER">Bank Transfer</SelectItem>
                        <SelectItem value="CREDIT_CARD">Credit Card</SelectItem>
                        <SelectItem value="DEBIT_CARD">Debit Card</SelectItem>
                        <SelectItem value="CASH">Cash</SelectItem>
                        <SelectItem value="OTHER">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Textarea rows={3} placeholder="Add payment notes, reference numbers, or memo..."
                    value={editNotes} onChange={(e) => setEditNotes(e.target.value)}
                    style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                    data-testid="input-edit-payment-notes" />
                </div>
              </div>
            </div>
            <Button
              type="submit"
              className="w-full text-white transition-all duration-200 hover:scale-[1.03] hover:shadow-lg"
              disabled={updateMutation.isPending}
              data-testid="button-submit-edit-payment"
              style={{ background: "var(--gradient-brand)" }}
            >
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </form>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Payment</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this payment of {selectedPayment ? formatMoney(selectedPayment.amount, baseCurrency) : ""}? The invoice balance will be recalculated.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-payment">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              className="bg-red-600 hover:bg-red-700"
              data-testid="button-confirm-delete-payment"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={refundOpen} onOpenChange={setRefundOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Refund Payment</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to refund this {selectedPayment?.method} payment of {selectedPayment ? formatMoney(selectedPayment.amount, baseCurrency) : ""}?
              A negative payment will be created and the invoice status will be recalculated.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-refund">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => refundMutation.mutate()}
              className="bg-red-600 hover:bg-red-700"
              data-testid="button-confirm-refund"
            >
              {refundMutation.isPending ? "Refunding..." : "Refund"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
