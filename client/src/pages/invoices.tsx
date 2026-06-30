import { useState, useMemo, useCallback, useEffect } from "react";
import { ErrorState } from "@/components/shared/error-state";
import { Link } from "wouter";
import { PageHelpLink } from "@/components/page-help-link";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { InvoiceDetailRows, type DetailItem } from "@/components/shared/invoice-detail-rows";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Calendar as CalendarWidget } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
import { useToast } from "@/hooks/use-toast";
import {
  Plus,
  FileText,
  Send,
  Download,
  Eye,
  Trash2,
  Pencil,
  Ban,
  Link2,
  Check,
  RefreshCw,
  Search,
  Copy,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  DollarSign,
  BookOpen,
  History,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  AlertTriangle,
  Calendar as CalendarIcon,
  ChevronsUpDown,
  Printer,
  Mail,
  ClipboardCopy,
  ExternalLink,
  StickyNote,
  CheckCircle,
  Clock,
  XCircle,
  Layers,
  FilePlus,
  FileCheck,
} from "lucide-react";
import type { Client, Invoice, InvoiceLine, InvoiceRevision, Payment } from "@shared/schema";
import { BlankInvoiceDialog } from "@/components/blank-invoice-dialog";
import { StatusBadge } from "@/components/shared/status-badge";
import { ActiveFilterBar, type FilterChipDescriptor } from "@/components/active-filter-chip";
import { MoneyDisplay } from "@/components/shared/money-display";
import { DateDisplay } from "@/components/shared/date-display";
import { EmptyState } from "@/components/shared/empty-state";
import { StatCard } from "@/components/shared/stat-card";
import { FormSection } from "@/components/shared/form-section";
import { DangerZone } from "@/components/shared/danger-zone";
import { DetailPanel } from "@/components/shared/detail-panel";
import { formatMoney, formatHours, formatPercent, formatRate, formatDate } from "@/components/shared/format";
import { SendEmailModal } from "@/components/shared/send-email-modal";
import { useDocumentTitle } from "@/lib/use-document-title";
import { useUrlFilterState } from "@/lib/use-url-filter-state";

const STATUS_COLORS: Record<string, string> = {
  All: "#8b5cf6",
  DRAFT: "#6b7280",
  SENT: "#3b82f6",
  PARTIAL: "#f59e0b",
  PAID: "#22c55e",
  OVERDUE: "#ef4444",
  VOID: "#71717a",
};

const STATUS_LABELS: Record<string, string> = {
  All: "All",
  DRAFT: "Draft",
  SENT: "Sent",
  PARTIAL: "Partial",
  PAID: "Paid",
  OVERDUE: "Overdue",
  VOID: "Void",
};

const STATUS_ICONS: Record<string, any> = {
  All: Layers,
  DRAFT: FileText,
  SENT: Send,
  PARTIAL: Clock,
  PAID: CheckCircle,
  OVERDUE: AlertTriangle,
  VOID: XCircle,
};

interface InvoiceWithDetails extends Invoice {
  clientName: string;
  clientEmail: string;
  clientLogoUrl: string | null;
  lines: InvoiceLine[];
}

interface PaymentWithDetails extends Payment {
  invoiceNumber: string;
  clientName: string;
}

function isOverdue(inv: InvoiceWithDetails): boolean {
  return ["SENT", "PARTIAL"].includes(inv.status) && !!inv.dueDate && new Date(inv.dueDate) < new Date();
}

function daysOverdue(inv: InvoiceWithDetails): number {
  if (!inv.dueDate) return 0;
  const diff = Math.floor((Date.now() - new Date(inv.dueDate).getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
}

function getPaymentTerms(issued: string | null | undefined, due: string | null | undefined): string {
  if (!issued || !due) return "—";
  const issuedDate = new Date(issued);
  const dueDate = new Date(due);
  const diffDays = Math.round((dueDate.getTime() - issuedDate.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return "Due on Receipt";
  if (diffDays <= 10) return "Net 10";
  if (diffDays <= 15) return "Net 15";
  if (diffDays <= 20) return "Net 20";
  if (diffDays <= 30) return "Net 30";
  if (diffDays <= 45) return "Net 45";
  if (diffDays <= 60) return "Net 60";
  if (diffDays <= 90) return "Net 90";
  return `Net ${diffDays}`;
}

/** apiRequest throws errors shaped "NNN: <body>" where body is often JSON.
 *  Surface the human-readable message instead of the raw status+JSON blob. */
function friendlyError(err: any): string {
  const m = typeof err?.message === "string" ? err.message : "Something went wrong. Please try again.";
  const sep = m.indexOf(": ");
  const rest = sep >= 0 ? m.slice(sep + 2) : m;
  try {
    const parsed = JSON.parse(rest);
    if (parsed && typeof parsed.message === "string") return parsed.message;
  } catch {
    /* not JSON — fall through */
  }
  return m;
}

type SortField = "number" | "clientName" | "total" | "dueDate" | "status";
type SortDir = "asc" | "desc";
type DateFilter = "all" | "due-this-week" | "due-this-month" | "overdue-30";

const STATUS_TABS = ["All", "DRAFT", "SENT", "OVERDUE", "PARTIAL", "PAID", "VOID"] as const;

export default function InvoicesPage({ initialInvoiceId }: { initialInvoiceId?: string } = {}) {
  useDocumentTitle("Invoices");
  const { user } = useAuth();
  const { toast } = useToast();
  const [genOpen, setGenOpen] = useState(false);
  const [blankOpen, setBlankOpen] = useState(false);
  const [clientId, setClientId] = useState("");
  const [includeUnapproved, setIncludeUnapproved] = useState(true);
  const [dueDate, setDueDate] = useState("");
  const [genCurrency, setGenCurrency] = useState("");
  const [genExchangeRate, setGenExchangeRate] = useState("1");
  const [viewInvoice, setViewInvoice] = useState<InvoiceWithDetails | null>(null);
  const [initialIdHandled, setInitialIdHandled] = useState(false);
  const [expandedRevision, setExpandedRevision] = useState<string | null>(null);

  const [addLineOpen, setAddLineOpen] = useState(false);
  const [lineDesc, setLineDesc] = useState("");
  const [lineQty, setLineQty] = useState("");
  const [lineRate, setLineRate] = useState("");

  const [editLineId, setEditLineId] = useState<string | null>(null);
  const [editDesc, setEditDesc] = useState("");
  const [editQty, setEditQty] = useState("");
  const [editRate, setEditRate] = useState("");

  const [discountType, setDiscountType] = useState("NONE");
  const [discountValue, setDiscountValue] = useState("0");
  const [taxRate, setTaxRate] = useState("0");

  const [filters, setFilter] = useUrlFilterState({
    q: "",
    status: "All",
    client: "all",
    sort: "number",
    dir: "desc",
    date: "all",
  });
  const [hubFilter, setHubFilter] = useState<{ label: string } | null>(null);
  const searchTerm = filters.q;
  const statusFilter = filters.status;
  const clientFilter = filters.client;
  const sortField = filters.sort as SortField;
  const sortDir = filters.dir as SortDir;
  const dateFilter = filters.date as DateFilter;
  const setSearchTerm = (v: string) => setFilter("q", v, { replace: true });
  const setStatusFilter = (v: string) => setFilter("status", v);
  const setClientFilter = (v: string) => setFilter("client", v);
  const setDateFilter = (v: DateFilter) => setFilter("date", v);

  const [linkCopied, setLinkCopied] = useState(false);
  const [sendEmailOpen, setSendEmailOpen] = useState(false);
  const [isResendMode, setIsResendMode] = useState(false);
  // Task #467: per-org dismissal of the "upload your logo" banner that
  // appears on the invoice viewer when the org has no logo set. Read on
  // mount so a refresh doesn't re-show a previously-dismissed banner.
  const [uploadLogoBannerDismissed, setUploadLogoBannerDismissed] = useState(false);

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("CHECK");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split("T")[0]);
  const [paymentNotes, setPaymentNotes] = useState("");

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState("");
  const [pdfPreviewTitle, setPdfPreviewTitle] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [dueDatePopoverOpen, setDueDatePopoverOpen] = useState(false);
  const [paymentDatePopoverOpen, setPaymentDatePopoverOpen] = useState(false);
  const [clientComboOpen, setClientComboOpen] = useState(false);
  const [genFormTouched, setGenFormTouched] = useState(false);

  const { data: invoices, isLoading, isError: invoicesError, error: invoicesQueryError, refetch: refetchInvoices } = useQuery<InvoiceWithDetails[]>({
    queryKey: ["/api/invoices"],
  });

  const { data: clientsList } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const { data: allPayments } = useQuery<PaymentWithDetails[]>({
    queryKey: ["/api/payments"],
  });

  const { data: orgSettings } = useQuery<any>({
    queryKey: ["/api/org/settings"],
  });

  const { data: revisions } = useQuery<InvoiceRevision[]>({
    queryKey: ["/api/invoices", viewInvoice?.id, "revisions"],
    enabled: !!viewInvoice,
    queryFn: async () => {
      const res = await fetch(`/api/invoices/${viewInvoice!.id}/revisions`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch revisions");
      return res.json();
    },
  });

  const { data: invoiceDetails } = useQuery<{
    showTimeEntryDetails: boolean;
    override: boolean | null;
    orgDefault: boolean;
    lineDetails: Record<string, DetailItem[]>;
  }>({
    queryKey: ["/api/invoices", viewInvoice?.id, "details"],
    enabled: !!viewInvoice,
    queryFn: async () => {
      const res = await fetch(`/api/invoices/${viewInvoice!.id}/details`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch invoice details");
      return res.json();
    },
  });

  const toggleInvoiceDetailsMutation = useMutation({
    mutationFn: async ({ invoiceId, value }: { invoiceId: string; value: boolean | null }) => {
      const res = await apiRequest("PATCH", `/api/invoices/${invoiceId}`, { showTimeEntryDetails: value });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices", viewInvoice?.id, "details"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const { data: canonicalAR } = useQuery<{ outstandingAR: number }>({
    queryKey: ["/api/ar/outstanding"],
  });

  const kpiStats = useMemo(() => {
    if (!invoices) return { totalInvoiced: 0, outstandingAR: 0, overdueAmount: 0, paidThisMonth: 0, collectionRate: 0 };
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    let totalInvoiced = 0;
    let overdueAmount = 0;
    let totalSentValue = 0;
    let totalPaidValue = 0;

    for (const inv of invoices) {
      if (inv.status === "VOID") continue;
      totalInvoiced += Number(inv.total);
      const outstanding = Number(inv.total) - Number(inv.paidAmount);
      if (["SENT", "PARTIAL", "PAID"].includes(inv.status)) {
        totalSentValue += Number(inv.total);
        totalPaidValue += Number(inv.paidAmount);
      }
      if (["SENT", "PARTIAL"].includes(inv.status)) {
        if (isOverdue(inv)) {
          overdueAmount += outstanding;
        }
      }
    }

    let paidThisMonth = 0;
    if (allPayments) {
      for (const p of allPayments) {
        if (new Date(p.date) >= thisMonthStart) {
          paidThisMonth += Number(p.amount);
        }
      }
    }

    const collectionRate = totalSentValue > 0 ? Math.round((totalPaidValue / totalSentValue) * 100) : 0;
    const outstandingAR = canonicalAR?.outstandingAR ?? 0;

    return { totalInvoiced, outstandingAR, overdueAmount, paidThisMonth, collectionRate };
  }, [invoices, allPayments, canonicalAR]);

  const statusCounts = useMemo(() => {
    if (!invoices) return {} as Record<string, number>;
    const counts: Record<string, number> = { All: invoices.length };
    for (const inv of invoices) {
      counts[inv.status] = (counts[inv.status] || 0) + 1;
    }
    counts["OVERDUE"] = invoices.filter(inv => isOverdue(inv)).length;
    return counts;
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    if (!invoices) return [];
    let filtered = [...invoices];

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (inv) =>
          inv.number.toLowerCase().includes(term) ||
          inv.clientName.toLowerCase().includes(term),
      );
    }

    if (statusFilter === "OVERDUE") {
      filtered = filtered.filter((inv) => isOverdue(inv));
    } else if (statusFilter === "OPEN") {
      filtered = filtered.filter((inv) => !["DRAFT", "VOID", "PAID"].includes(inv.status));
    } else if (statusFilter !== "All") {
      filtered = filtered.filter((inv) => inv.status === statusFilter);
    }

    if (clientFilter !== "all") {
      filtered = filtered.filter((inv) => inv.clientId === clientFilter);
    }

    if (dateFilter !== "all") {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (dateFilter === "due-this-week") {
        const endOfWeek = new Date(today);
        endOfWeek.setDate(today.getDate() + (7 - today.getDay()));
        filtered = filtered.filter((inv) => {
          if (!inv.dueDate) return false;
          const d = new Date(inv.dueDate + "T00:00:00");
          return d >= today && d <= endOfWeek;
        });
      } else if (dateFilter === "due-this-month") {
        filtered = filtered.filter((inv) => {
          if (!inv.dueDate) return false;
          const d = new Date(inv.dueDate + "T00:00:00");
          return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
        });
      } else if (dateFilter === "overdue-30") {
        const thirtyDaysAgo = new Date(today);
        thirtyDaysAgo.setDate(today.getDate() - 30);
        filtered = filtered.filter((inv) => {
          if (!inv.dueDate || inv.status === "PAID" || inv.status === "VOID") return false;
          const d = new Date(inv.dueDate + "T00:00:00");
          return d < thirtyDaysAgo;
        });
      }
    }

    filtered.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "number":
          cmp = a.number.localeCompare(b.number);
          break;
        case "clientName":
          cmp = a.clientName.localeCompare(b.clientName);
          break;
        case "total":
          cmp = Number(a.total) - Number(b.total);
          break;
        case "dueDate":
          cmp = (a.dueDate || "").localeCompare(b.dueDate || "");
          break;
        case "status":
          cmp = a.status.localeCompare(b.status);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return filtered;
  }, [invoices, searchTerm, statusFilter, clientFilter, sortField, sortDir, dateFilter]);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setFilter("dir", sortDir === "asc" ? "desc" : "asc");
    } else {
      setFilter("sort", field);
      setFilter("dir", "asc");
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-40" />;
    return sortDir === "asc" ? (
      <ArrowUp className="w-3 h-3 ml-1" />
    ) : (
      <ArrowDown className="w-3 h-3 ml-1" />
    );
  }

  const handleExportExcel = useCallback(async () => {
    try {
      const XLSX = await import("xlsx");
      const data = filteredInvoices.map((inv) => ({
        "Invoice #": inv.number,
        Client: inv.clientName,
        Status: inv.status,
        Issued: inv.issuedDate ? formatDate(inv.issuedDate) : "",
        Due: inv.dueDate ? formatDate(inv.dueDate) : "",
        Total: Number(inv.total).toFixed(2),
        Outstanding: inv.status === "VOID" ? "0.00" : (Number(inv.total) - Number(inv.paidAmount)).toFixed(2),
        Paid: Number(inv.paidAmount).toFixed(2),
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      const colWidths = Object.keys(data[0] || {}).map((k) => ({ wch: Math.max(k.length, 14) }));
      ws["!cols"] = colWidths;
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Invoices");
      XLSX.writeFile(wb, `invoices_${new Date().toISOString().split("T")[0]}.xlsx`);
      toast({ title: "Exported", description: `${data.length} invoice(s) exported to Excel.` });
    } catch (err: any) {
      toast({ title: "Export failed", description: err?.message || "Could not export invoices.", variant: "destructive" });
    }
  }, [filteredInvoices, toast]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === filteredInvoices.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredInvoices.map((inv) => inv.id)));
    }
  }, [filteredInvoices, selectedIds.size]);

  const orgBaseCurrency = orgSettings?.baseCurrency || "USD";

  const generateMutation = useMutation({
    mutationFn: async () => {
      const effectiveCurrency = genCurrency || orgBaseCurrency;
      const payload: any = {
        clientId,
        includeUnapproved,
        dueDate:
          dueDate ||
          new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
            .toISOString()
            .split("T")[0],
        currency: effectiveCurrency,
      };
      if (effectiveCurrency !== orgBaseCurrency) {
        payload.exchangeRate = genExchangeRate;
      }
      const res = await apiRequest("POST", "/api/invoices/generate", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ar/outstanding"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      setGenOpen(false);
      setClientId("");
      setDueDate("");
      setGenCurrency("");
      setGenExchangeRate("1");
      setGenFormTouched(false);
      toast({ title: "Invoice generated from unbilled time" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const sendMutation = useMutation({
    mutationFn: async (params: { invoiceId: string; emailTo?: string; emailSubject?: string; emailBody?: string }) => {
      const res = await apiRequest("POST", `/api/invoices/${params.invoiceId}/send`, {
        emailTo: params.emailTo,
        emailSubject: params.emailSubject,
        emailBody: params.emailBody,
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ar/outstanding"] });
      if (data?.emailSent) {
        toast({ title: "Invoice sent", description: `Emailed to ${data.toEmail}${data.cc?.length ? ` (cc ${data.cc.length})` : ""}` });
      } else if (data?.emailError) {
        toast({ title: "Marked sent — but the email failed", description: data.emailError, variant: "destructive" });
      } else {
        toast({ title: "Invoice sent" });
      }
      setSendEmailOpen(false);
      setViewInvoice(null);
    },
    onError: (err: any) => {
      toast({ title: "Couldn't send invoice", description: friendlyError(err), variant: "destructive" });
    },
  });

  const resendMutation = useMutation({
    mutationFn: async (params: { invoiceId: string; emailTo?: string; emailSubject?: string; emailBody?: string }) => {
      const res = await apiRequest("POST", `/api/invoices/${params.invoiceId}/resend`, {
        emailTo: params.emailTo,
        emailSubject: params.emailSubject,
        emailBody: params.emailBody,
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      if (data?.emailSent) {
        toast({ title: "Invoice resent", description: `Emailed to ${data.toEmail}${data.cc?.length ? ` (cc ${data.cc.length})` : ""}` });
      } else {
        toast({ title: "Couldn't resend", description: data?.emailError || "The email was not delivered.", variant: "destructive" });
      }
      setSendEmailOpen(false);
      setViewInvoice(null);
    },
    onError: (err: any) => {
      toast({ title: "Couldn't resend invoice", description: friendlyError(err), variant: "destructive" });
    },
  });

  const voidMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      await apiRequest("POST", `/api/invoices/${invoiceId}/void`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      setViewInvoice(null);
      toast({ title: "Invoice voided" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      const res = await apiRequest("POST", `/api/invoices/${invoiceId}/duplicate`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      toast({ title: "Invoice duplicated as DRAFT" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const autoPostEnabled = orgSettings?.autoPostJournalEntries ?? false;

  const { data: glPostedStatus } = useQuery<{ posted: boolean }>({
    queryKey: ["/api/gl/posted-status", "INVOICE", viewInvoice?.id],
    enabled: !!viewInvoice && ["SENT", "PARTIAL", "PAID"].includes(viewInvoice.status) && !autoPostEnabled,
    queryFn: async () => {
      const res = await fetch(`/api/gl/posted-status?sourceType=INVOICE&sourceRef=${viewInvoice!.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to check GL status");
      return res.json();
    },
  });

  const repostGlMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      const res = await apiRequest("POST", `/api/invoices/${invoiceId}/repost-gl`);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/gl/journal-entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gl/posted-status"] });
      toast({ title: "Posted to GL", description: data.message });
    },
    onError: (err: any) => {
      toast({ title: "GL posting failed", description: err.message, variant: "destructive" });
    },
  });

  const recordPaymentMutation = useMutation({
    mutationFn: async () => {
      if (!viewInvoice) return;
      await apiRequest("POST", "/api/payments", {
        invoiceId: viewInvoice.id,
        amount: paymentAmount,
        method: paymentMethod,
        date: paymentDate,
        notes: paymentNotes || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      setPaymentOpen(false);
      setPaymentAmount("");
      setPaymentNotes("");
      toast({ title: "Payment recorded successfully" });
      refreshViewInvoice();
    },
    onError: (err: Error) => {
      toast({ title: "Error recording payment", description: err.message, variant: "destructive" });
    },
  });

  const addLineMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      const res = await apiRequest("POST", `/api/invoices/${invoiceId}/lines`, {
        description: lineDesc,
        quantity: lineQty,
        unitRate: lineRate,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      setAddLineOpen(false);
      setLineDesc("");
      setLineQty("");
      setLineRate("");
      toast({ title: "Line item added" });
      refreshViewInvoice();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const editLineMutation = useMutation({
    mutationFn: async ({ invoiceId, lineId }: { invoiceId: string; lineId: string }) => {
      const res = await apiRequest("PUT", `/api/invoices/${invoiceId}/lines/${lineId}`, {
        description: editDesc,
        quantity: editQty,
        unitRate: editRate,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      setEditLineId(null);
      toast({ title: "Line item updated" });
      refreshViewInvoice();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteLineMutation = useMutation({
    mutationFn: async ({ invoiceId, lineId }: { invoiceId: string; lineId: string }) => {
      await apiRequest("DELETE", `/api/invoices/${invoiceId}/lines/${lineId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      toast({ title: "Line item removed" });
      refreshViewInvoice();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateNotesMutation = useMutation({
    mutationFn: async ({ invoiceId, notes }: { invoiceId: string; notes: string }) => {
      const res = await apiRequest("PATCH", `/api/invoices/${invoiceId}`, { notes: notes || null });
      return res.json();
    },
    onSuccess: (data: InvoiceWithDetails) => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      setViewInvoice(data);
      toast({ title: "Notes saved" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateDiscountTaxMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      const res = await apiRequest("PATCH", `/api/invoices/${invoiceId}`, {
        discountType,
        discountValue,
        taxRate,
      });
      return res.json();
    },
    onSuccess: (data: InvoiceWithDetails) => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      setViewInvoice(data);
      toast({ title: "Discount and tax updated" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  function refreshViewInvoice() {
    setTimeout(() => {
      const current = queryClient.getQueryData<InvoiceWithDetails[]>(["/api/invoices"]);
      if (current && viewInvoice) {
        const updated = current.find((inv) => inv.id === viewInvoice.id);
        if (updated) setViewInvoice(updated);
      }
    }, 500);
  }

  function openViewInvoice(inv: InvoiceWithDetails) {
    setViewInvoice(inv);
    setExpandedRevision(null);
    setDiscountType(inv.discountType || "NONE");
    setDiscountValue(String(Number(inv.discountValue || 0)));
    setTaxRate(String(Number(inv.taxRate || 0)));
    setEditLineId(null);
    setAddLineOpen(false);
    setPaymentOpen(false);
    setInternalNotes((inv as any).notes || "");
  }

  // Task #467: hydrate the upload-logo banner dismissal flag from
  // localStorage once we know the org id. Re-runs when the org changes
  // (e.g. user switches orgs without a hard reload).
  useEffect(() => {
    const orgId = (orgSettings as any)?.id;
    if (!orgId) return;
    try {
      const dismissed = window.localStorage.getItem(`cherry.uploadLogoBannerDismissed:${orgId}`);
      setUploadLogoBannerDismissed(dismissed === "1");
    } catch {
      // localStorage may be unavailable (private mode, SSR) — fall back to showing the banner.
      setUploadLogoBannerDismissed(false);
    }
  }, [(orgSettings as any)?.id]);

  useEffect(() => {
    if (initialInvoiceId && invoices && !initialIdHandled) {
      const target = invoices.find((inv) => inv.id === initialInvoiceId);
      if (target) {
        openViewInvoice(target);
      }
      setInitialIdHandled(true);
    }
  }, [initialInvoiceId, invoices, initialIdHandled]);

  const invoicePayments = useMemo(() => {
    if (!viewInvoice || !allPayments) return [];
    return allPayments.filter((p) => p.invoiceId === viewInvoice.id);
  }, [viewInvoice, allPayments]);

  const handleBulkSend = useCallback(async () => {
    const drafts = filteredInvoices.filter((inv) => inv.status === "DRAFT" && selectedIds.has(inv.id));
    if (!drafts.length) {
      toast({ title: "No DRAFT invoices selected" });
      return;
    }
    let sent = 0, emailFailed = 0, skipped = 0, failed = 0;
    for (const inv of drafts) {
      try {
        const res = await apiRequest("POST", `/api/invoices/${inv.id}/send`, {});
        const data = await res.json().catch(() => ({} as any));
        // 2xx → the invoice was marked Sent; emailSent says whether the email went.
        if (data?.emailSent) sent++; else emailFailed++;
      } catch (err: any) {
        // 422 NO_RECIPIENT → skipped (no email on file); anything else → failed.
        if (typeof err?.message === "string" && err.message.includes("NO_RECIPIENT")) skipped++;
        else failed++;
      }
    }
    queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
    queryClient.invalidateQueries({ queryKey: ["/api/ar/outstanding"] });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
    setSelectedIds(new Set());
    const parts = [`${sent} sent`];
    if (emailFailed) parts.push(`${emailFailed} marked sent (email failed)`);
    if (skipped) parts.push(`${skipped} skipped (no email on file)`);
    if (failed) parts.push(`${failed} failed`);
    toast({ title: parts.join(" · "), variant: (emailFailed || skipped || failed) ? "destructive" : undefined });
  }, [filteredInvoices, selectedIds, toast]);

  const handleBulkVoid = useCallback(async () => {
    const toVoid = filteredInvoices.filter((inv) => selectedIds.has(inv.id) && inv.status !== "VOID");
    if (!toVoid.length) return;
    for (const inv of toVoid) {
      try {
        await apiRequest("POST", `/api/invoices/${inv.id}/void`);
      } catch {}
    }
    queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
    queryClient.invalidateQueries({ queryKey: ["/api/ar/outstanding"] });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
    setSelectedIds(new Set());
    toast({ title: `${toVoid.length} invoice(s) voided` });
  }, [filteredInvoices, selectedIds, toast]);

  const handleBulkDownloadPdf = useCallback(() => {
    const selected = filteredInvoices.filter((inv) => selectedIds.has(inv.id));
    for (const inv of selected) {
      const a = document.createElement("a");
      a.href = `/api/invoices/${inv.id}/pdf`;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.click();
    }
    toast({ title: `Opening ${selected.length} PDF(s)` });
  }, [filteredInvoices, selectedIds, toast]);

  const handleBulkDelete = useCallback(async () => {
    const drafts = filteredInvoices.filter((inv) => inv.status === "DRAFT" && selectedIds.has(inv.id));
    if (!drafts.length) {
      toast({ title: "Only DRAFT invoices can be deleted" });
      return;
    }
    let deleted = 0;
    for (const inv of drafts) {
      try {
        await apiRequest("DELETE", `/api/invoices/${inv.id}`);
        deleted++;
      } catch {}
    }
    queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
    queryClient.invalidateQueries({ queryKey: ["/api/ar/outstanding"] });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
    setSelectedIds(new Set());
    toast({ title: `${deleted} invoice(s) deleted` });
  }, [filteredInvoices, selectedIds, toast]);

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

  if (invoicesError) {
    return (
      <div className="px-6 lg:px-8 xl:px-10 py-6">
        <ErrorState title="Failed to load invoices" description="We couldn't load invoice data. Please try again." onRetry={refetchInvoices} error={invoicesQueryError as Error} showDashboardLink />
      </div>
    );
  }

  const isAdmin = user?.role === "ADMIN";
  const canManage = user?.role === "ADMIN" || user?.role === "MANAGER";
  const isDraft = viewInvoice?.status === "DRAFT";
  const isEditable = viewInvoice ? ["DRAFT", "SENT", "PARTIAL", "PAID"].includes(viewInvoice.status) : false;
  const allSelected = filteredInvoices.length > 0 && selectedIds.size === filteredInvoices.length;

  const invoiceStatCards = [
    { key: "total-invoiced", label: "Total Invoiced", value: formatMoney(kpiStats.totalInvoiced, "USD"), sub: `${invoices?.length || 0} invoices`, icon: DollarSign, color: "var(--lux-accent)", iconBg: "rgba(var(--lux-accent-rgb),0.08)", gradient: "linear-gradient(135deg, rgba(var(--lux-accent-rgb),0.08) 0%, rgba(var(--lux-accent-rgb),0.02) 100%)" },
    { key: "outstanding", label: "Outstanding AR", value: formatMoney(kpiStats.outstandingAR, "USD"), sub: "accounts receivable", icon: FileText, color: "#f59e0b", gradient: "linear-gradient(135deg, rgba(245,158,11,0.08) 0%, rgba(245,158,11,0.02) 100%)" },
    { key: "overdue", label: "Overdue Amount", value: formatMoney(kpiStats.overdueAmount, "USD"), sub: kpiStats.overdueAmount > 0 ? "needs attention" : "all clear", icon: AlertTriangle, color: kpiStats.overdueAmount > 0 ? "#ef4444" : "#6b7280", gradient: "linear-gradient(135deg, rgba(239,68,68,0.08) 0%, rgba(239,68,68,0.02) 100%)", pulse: kpiStats.overdueAmount > 0 },
    { key: "paid-month", label: "Paid This Month", value: formatMoney(kpiStats.paidThisMonth, "USD"), sub: new Date().toLocaleString("default", { month: "long", year: "numeric" }), icon: CalendarIcon, color: "#22c55e", gradient: "linear-gradient(135deg, rgba(34,197,94,0.08) 0%, rgba(34,197,94,0.02) 100%)" },
    { key: "collection", label: "Collection Rate", value: `${kpiStats.collectionRate}%`, sub: "All-time · paid vs sent", icon: TrendingUp, color: kpiStats.collectionRate >= 80 ? "#22c55e" : kpiStats.collectionRate >= 50 ? "#f59e0b" : "#ef4444", gradient: "linear-gradient(135deg, rgba(34,197,94,0.08) 0%, rgba(34,197,94,0.02) 100%)" },
  ];

  return (
    <div className="px-6 lg:px-8 xl:px-10 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(var(--lux-accent-rgb),0.15) 0%, rgba(var(--lux-accent-rgb),0.05) 100%)" }}>
              <FileText className="w-6 h-6" style={{ color: "var(--lux-accent)" }} />
            </div>
            <div className="absolute -inset-1 rounded-xl opacity-40 blur-md -z-10" style={{ background: "radial-gradient(circle, rgba(var(--lux-accent-rgb),0.3) 0%, transparent 70%)" }} />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1
                className="text-2xl font-bold tracking-tight"
                style={{ color: "var(--lux-text)" }}
                data-testid="text-invoices-title"
              >
                Invoices
              </h1>
              <PageHelpLink />
            </div>
            <p className="text-sm mt-0.5" style={{ color: "var(--lux-text-muted)" }}>
              Generate and manage invoices
            </p>
          </div>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Link href="/invoices/recurring">
              <Button variant="outline" data-testid="button-recurring-templates">
                <RefreshCw className="w-4 h-4 mr-2" />
                Recurring
              </Button>
            </Link>
            <Button
              variant="outline"
              onClick={() => setBlankOpen(true)}
              data-testid="button-blank-invoice"
            >
              <FilePlus className="w-4 h-4 mr-2" />
              Create Blank Invoice
            </Button>
            <Button
              className="text-white shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.03]"
              style={{ background: "var(--gradient-brand)" }}
              onClick={() => { setDueDate(format(new Date(Date.now() + 30 * 86400000), "yyyy-MM-dd")); setGenFormTouched(false); setClientId(""); setGenCurrency(""); setGenExchangeRate("1"); setGenOpen(true); }}
              data-testid="button-generate-invoice"
            >
              <Plus className="w-4 h-4 mr-2" />
              Generate Invoice
            </Button>
          </div>
        )}
      </div>
      <div className="h-px w-full" style={{ background: "linear-gradient(90deg, var(--lux-accent), transparent 60%)", opacity: 0.3 }} />

      <BlankInvoiceDialog
        open={blankOpen}
        onOpenChange={setBlankOpen}
        onCreated={(inv) => openViewInvoice(inv)}
        defaultCurrency={orgSettings?.baseCurrency || "USD"}
      />

      {/* Generate Invoice Modal */}
      <Dialog open={genOpen} onOpenChange={(open) => { setGenOpen(open); if (!open) setGenFormTouched(false); }}>
        <DialogContent className="sm:max-w-[90vw] lg:max-w-[85vw] xl:max-w-[80vw] max-h-[90vh] overflow-y-auto p-0" style={{ background: "var(--lux-surface)" }}>
          <div className="relative px-6 pt-6 pb-4" style={{ background: "linear-gradient(135deg, rgba(var(--lux-accent-rgb),0.08) 0%, rgba(var(--lux-accent-rgb),0.02) 100%)" }}>
            <div className="flex items-center gap-3.5">
              <div className="relative">
                <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(var(--lux-accent-rgb),0.18) 0%, rgba(168,85,247,0.12) 100%)" }}>
                  <FileText className="w-5 h-5" style={{ color: "var(--lux-accent)" }} />
                </div>
                <div className="absolute -inset-1.5 rounded-xl opacity-30 blur-lg -z-10" style={{ background: "radial-gradient(circle, rgba(var(--lux-accent-rgb),0.4) 0%, transparent 70%)" }} />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold" style={{ color: "var(--lux-text)" }}>Generate Invoice from Unbilled Time</DialogTitle>
                <p className="text-xs mt-0.5" style={{ color: "var(--lux-text-muted)" }}>Create an invoice from tracked time entries</p>
              </div>
            </div>
            <div className="absolute bottom-0 left-0 right-0 h-px" style={{ background: "linear-gradient(90deg, var(--lux-accent), transparent 60%)", opacity: 0.25 }} />
          </div>
          <div className="px-6 pb-6">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setGenFormTouched(true);
                if (!clientId) return;
                generateMutation.mutate();
              }}
              className="space-y-6"
            >
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <DollarSign className="w-3.5 h-3.5" style={{ color: "var(--lux-accent)" }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Client</span>
                </div>
                <Popover open={clientComboOpen} onOpenChange={setClientComboOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" role="combobox" aria-expanded={clientComboOpen}
                      className="w-full justify-between h-9 text-sm font-normal"
                      style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: clientId ? "var(--lux-text)" : "var(--lux-text-muted)" }}
                      data-testid="select-invoice-client">
                      {clientId ? clientsList?.find(c => c.id === clientId)?.name || "Select client" : "Select client"}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-full p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search clients..." />
                      <CommandList>
                        <CommandEmpty>No clients found.</CommandEmpty>
                        <CommandGroup>
                          {clientsList?.map(c => (
                            <CommandItem key={c.id} value={c.name} onSelect={() => { setClientId(c.id); setClientComboOpen(false); }}>
                              <Check className={cn("mr-2 h-4 w-4", clientId === c.id ? "opacity-100" : "opacity-0")} />
                              {c.name}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                {genFormTouched && !clientId && (
                  <p className="text-[11px] mt-1 font-medium" style={{ color: "#ef4444" }}>This field is required</p>
                )}
              </div>
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <CalendarIcon className="w-3.5 h-3.5" style={{ color: "var(--lux-accent)" }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Due Date</span>
                </div>
                <Popover open={dueDatePopoverOpen} onOpenChange={setDueDatePopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-left font-normal h-9 text-sm"
                      style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: dueDate ? "var(--lux-text)" : "var(--lux-text-muted)" }}
                      data-testid="input-invoice-due-date">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dueDate ? format(new Date(dueDate + "T00:00:00"), "MMM d, yyyy") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarWidget mode="single" selected={dueDate ? new Date(dueDate + "T00:00:00") : undefined}
                      onSelect={(day) => { if (day) { setDueDate(format(day, "yyyy-MM-dd")); setDueDatePopoverOpen(false); } }} />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <DollarSign className="w-3.5 h-3.5" style={{ color: "var(--lux-accent)" }} />
                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Currency</span>
                  </div>
                  <Select value={genCurrency || orgBaseCurrency} onValueChange={(v) => { setGenCurrency(v); if (v === orgBaseCurrency) setGenExchangeRate("1"); }}>
                    <SelectTrigger style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }} data-testid="select-gen-currency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["USD","EUR","GBP","CAD","AUD","JPY","CHF","CNY","INR","MXN","BRL","SGD","HKD","NZD","SEK","NOK","DKK","ZAR"].map(c => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <ArrowUpDown className="w-3.5 h-3.5" style={{ color: "var(--lux-accent)" }} />
                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Exchange Rate</span>
                  </div>
                  <Input
                    type="number"
                    step="0.000001"
                    min="0.000001"
                    value={genExchangeRate}
                    onChange={(e) => setGenExchangeRate(e.target.value)}
                    disabled={(genCurrency || orgBaseCurrency) === orgBaseCurrency}
                    style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                    data-testid="input-gen-exchange-rate"
                  />
                  {(genCurrency || orgBaseCurrency) !== orgBaseCurrency && genExchangeRate && (
                    <p className="text-[10px] mt-1" style={{ color: "var(--lux-text-muted)" }}>
                      1 {genCurrency || orgBaseCurrency} = {genExchangeRate} {orgBaseCurrency}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 py-2">
                <Checkbox
                  id="include-unapproved-inv"
                  checked={includeUnapproved}
                  onCheckedChange={(v) => setIncludeUnapproved(!!v)}
                  data-testid="checkbox-include-unapproved"
                />
                <Label htmlFor="include-unapproved-inv" className="text-sm cursor-pointer" style={{ color: "var(--lux-text)" }}>
                  Include unapproved time entries
                </Label>
              </div>
              <Button
                type="submit"
                className="w-full text-white transition-all duration-200 hover:scale-[1.03] hover:shadow-lg"
                disabled={generateMutation.isPending}
                data-testid="button-submit-invoice"
                style={{ background: "var(--gradient-brand)" }}
              >
                {generateMutation.isPending ? "Generating..." : "Generate Invoice"}
              </Button>
            </form>
          </div>
        </DialogContent>
      </Dialog>

      {/* KPI STAT CARDS */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4" data-testid="kpi-stat-cards">
        {invoiceStatCards.map(sc => {
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

      {/* STATUS TABS */}
      <div className="flex items-center gap-1.5 flex-wrap rounded-xl p-1.5" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
        {STATUS_TABS.map(tab => {
          const Icon = STATUS_ICONS[tab];
          const active = statusFilter === tab;
          const cnt = statusCounts[tab] ?? 0;
          const col = STATUS_COLORS[tab] || "var(--lux-accent)";
          return (
            <button
              key={tab}
              onClick={() => { setStatusFilter(tab); setHubFilter(null); }}
              className="relative flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all duration-200 hover:scale-[1.02]"
              style={{
                background: active ? `${col}15` : "transparent",
                color: active ? col : "var(--lux-text-muted)",
                boxShadow: active ? `0 0 0 1px ${col}30, 0 1px 3px ${col}10` : "none",
              }}
              data-testid={`button-filter-${tab.toLowerCase()}`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{STATUS_LABELS[tab]}</span>
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

      <div className="flex flex-col gap-4">
        {(() => {
          const dateLabels: Record<string, string> = {
            "due-this-week": "Due this week",
            "due-this-month": "Due this month",
            "overdue-30": "Overdue 30+",
          };
          const chips: FilterChipDescriptor[] = [];
          if (statusFilter !== "All") {
            chips.push({
              id: "hub-filter",
              label: hubFilter?.label || `Status: ${STATUS_LABELS[statusFilter] || statusFilter}`,
              onClear: () => { setStatusFilter("All"); setHubFilter(null); },
            });
          }
          if (searchTerm) {
            chips.push({
              id: "search",
              label: `Search: "${searchTerm}"`,
              onClear: () => setSearchTerm(""),
            });
          }
          if (clientFilter !== "all") {
            const clientName = clientsList?.find((c) => c.id === clientFilter)?.name || "Selected client";
            chips.push({
              id: "client",
              label: `Client: ${clientName}`,
              onClear: () => setClientFilter("all"),
            });
          }
          if (dateFilter !== "all") {
            chips.push({
              id: "date",
              label: `Date: ${dateLabels[dateFilter] || dateFilter}`,
              onClear: () => setDateFilter("all"),
            });
          }
          return <ActiveFilterBar chips={chips} />;
        })()}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--lux-text-muted)" }} />
            <Input
              placeholder="Search by invoice # or client..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 h-9 text-sm"
              style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
              data-testid="input-search-invoices"
            />
          </div>
          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger className="w-[180px]" style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }} data-testid="select-filter-client">
              <SelectValue placeholder="All Clients" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Clients</SelectItem>
              {clientsList?.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportExcel}
            className="h-9 text-xs gap-1.5"
            style={{ borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
            disabled={filteredInvoices.length === 0}
            data-testid="button-export-excel"
          >
            <Download className="w-3.5 h-3.5" /> Export to Excel
          </Button>
        </div>

        {/* DATE QUICK FILTERS */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>
            Quick:
          </span>
          {([
            { key: "all", label: "All Dates" },
            { key: "due-this-week", label: "Due This Week" },
            { key: "due-this-month", label: "Due This Month" },
            { key: "overdue-30", label: "Overdue 30+" },
          ] as { key: DateFilter; label: string }[]).map((f) => (
            <Button
              key={f.key}
              variant={dateFilter === f.key ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setDateFilter(f.key)}
              data-testid={`button-date-filter-${f.key}`}
              style={dateFilter === f.key ? { background: "var(--color-accent)" } : undefined}
            >
              {f.label}
            </Button>
          ))}
        </div>
      </div>

      {/* BULK ACTIONS BAR */}
      {selectedIds.size > 0 && (
        <div
          className="flex items-center gap-3 px-4 py-3 rounded-lg"
          style={{
            background: "rgba(99,102,241,0.08)",
            backdropFilter: "blur(12px)",
            border: "1px solid var(--lux-border)",
          }}
          data-testid="bulk-actions-bar"
        >
          <span className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>
            {selectedIds.size} selected
          </span>
          <div className="flex gap-2 ml-auto">
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1.5"
              onClick={handleBulkSend}
              title="Send Selected (DRAFT invoices)"
              data-testid="button-bulk-send"
            >
              <Send className="w-3.5 h-3.5" /> Send Selected
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1.5"
              onClick={handleBulkDownloadPdf}
              title="Download PDFs"
              data-testid="button-bulk-download"
            >
              <Download className="w-3.5 h-3.5" /> Download PDFs
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs gap-1.5 border-red-500/30 text-red-500 hover:bg-red-500/10"
                  title="Void Selected"
                  data-testid="button-bulk-void"
                >
                  <Ban className="w-3.5 h-3.5" /> Void Selected
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Void {selectedIds.size} Invoice(s)</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to void {selectedIds.size} selected invoice(s)? This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleBulkVoid} className="bg-red-600 hover:bg-red-700" data-testid="confirm-bulk-void">
                    Void All
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs gap-1.5 border-red-500/30 text-red-500 hover:bg-red-500/10"
                  title="Delete Selected (DRAFT only)"
                  data-testid="button-bulk-delete"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete Selected
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Draft Invoices</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete selected DRAFT invoices. Non-draft invoices will be skipped. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleBulkDelete} className="bg-red-600 hover:bg-red-700" data-testid="confirm-bulk-delete">
                    Delete Drafts
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={() => setSelectedIds(new Set())}
              data-testid="button-clear-selection"
            >
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* PDF PREVIEW MODAL */}
      <Dialog open={pdfPreviewOpen} onOpenChange={setPdfPreviewOpen}>
        <DialogContent className="sm:max-w-[90vw] lg:max-w-[85vw] xl:max-w-[80vw]" style={{ height: "80vh" }}>
          <DialogHeader>
            <DialogTitle>{pdfPreviewTitle}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0" style={{ height: "calc(80vh - 120px)" }}>
            <iframe
              src={pdfPreviewUrl}
              className="w-full h-full rounded-md"
              style={{ border: "1px solid var(--lux-border)" }}
              title="Invoice PDF Preview"
              data-testid="iframe-pdf-preview"
            />
          </div>
          <DialogFooter className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                const link = document.createElement("a");
                link.href = pdfPreviewUrl;
                link.download = `${pdfPreviewTitle}.pdf`;
                link.click();
              }}
              data-testid="button-pdf-download"
            >
              <Download className="w-4 h-4 mr-2" /> Download
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const iframe = document.querySelector('[data-testid="iframe-pdf-preview"]') as HTMLIFrameElement;
                if (iframe?.contentWindow) iframe.contentWindow.print();
              }}
              data-testid="button-pdf-print"
            >
              <Printer className="w-4 h-4 mr-2" /> Print
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DetailPanel
        open={!!viewInvoice}
        onClose={() => setViewInvoice(null)}
        title={viewInvoice ? `Invoice ${viewInvoice.number}` : ""}
        subtitle={viewInvoice?.clientName}
        avatar={viewInvoice?.clientName}
        avatarImage={viewInvoice?.clientLogoUrl}
        actions={
          viewInvoice ? (
            <div className="flex items-center gap-1.5">
              <StatusBadge status={viewInvoice.status} />
              {isOverdue(viewInvoice) && <StatusBadge status="OVERDUE" />}
              {viewInvoice.sourceEstimateId && (
                <a
                  href="/estimates"
                  className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded no-underline hover:opacity-80 transition-opacity"
                  style={{ background: "rgba(139,92,246,0.12)", color: "#8b5cf6" }}
                  data-testid={`badge-from-estimate-detail-${viewInvoice.id}`}
                >
                  <FileCheck className="w-2.5 h-2.5" />
                  From estimate
                </a>
              )}
            </div>
          ) : undefined
        }
      >
        {viewInvoice && (
          <div className="space-y-5">
            {isOverdue(viewInvoice) && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-md text-xs" style={{ background: "rgba(239,68,68,0.08)", color: "#ef4444" }} data-testid="badge-overdue">
                Overdue by {daysOverdue(viewInvoice)} days
              </div>
            )}

            {/* CLIENT HEADER WITH EMAIL + PAYMENT TERMS */}
            <FormSection title="Client & Terms">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs mb-0.5" style={{ color: "var(--lux-text-muted)" }}>Client</p>
                  <p className="font-medium" style={{ color: "var(--lux-text)" }}>{viewInvoice.clientName}</p>
                </div>
                <div>
                  <p className="text-xs mb-0.5" style={{ color: "var(--lux-text-muted)" }}>Payment Terms</p>
                  <p className="font-medium" style={{ color: "var(--lux-text)" }} data-testid="text-payment-terms">
                    {getPaymentTerms(viewInvoice.issuedDate, viewInvoice.dueDate)}
                  </p>
                </div>
                {viewInvoice.clientEmail && (
                  <div className="col-span-2">
                    <p className="text-xs mb-0.5" style={{ color: "var(--lux-text-muted)" }}>Client Email</p>
                    <div className="flex items-center gap-2">
                      <span className="text-sm" style={{ color: "var(--lux-text)" }} data-testid="text-client-email">
                        {viewInvoice.clientEmail}
                      </span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        title="Copy Email"
                        aria-label="Copy email"
                        onClick={() => {
                          navigator.clipboard.writeText(viewInvoice.clientEmail);
                          toast({ title: "Email copied to clipboard" });
                        }}
                        data-testid="button-copy-client-email"
                      >
                        <ClipboardCopy className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </FormSection>

            <FormSection title="Summary">
              <div className="grid grid-cols-3 gap-3">
                <StatCard
                  label="Total"
                  value={formatMoney(viewInvoice.total, viewInvoice.currency || "USD")}
                />
                <StatCard
                  label="Paid"
                  value={formatMoney(viewInvoice.paidAmount, viewInvoice.currency || "USD")}
                  color="#22c55e"
                />
                <StatCard
                  label="Outstanding"
                  value={formatMoney(viewInvoice.status.toLowerCase() === "void" ? 0 : Number(viewInvoice.total) - Number(viewInvoice.paidAmount), viewInvoice.currency || "USD")}
                  color={viewInvoice.status.toLowerCase() === "void" ? undefined : (Number(viewInvoice.total) - Number(viewInvoice.paidAmount) > 0 ? "#f59e0b" : undefined)}
                />
              </div>
            </FormSection>

            <FormSection title="Details">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs mb-0.5" style={{ color: "var(--lux-text-muted)" }}>Issued</p>
                  <DateDisplay value={viewInvoice.issuedDate} />
                </div>
                <div>
                  <p className="text-xs mb-0.5" style={{ color: "var(--lux-text-muted)" }}>Due</p>
                  <DateDisplay value={viewInvoice.dueDate} />
                </div>
              </div>
            </FormSection>

            {/* PUBLIC INVOICE URL */}
            {viewInvoice.publicToken && (
              <FormSection title="Public Invoice Link">
                <div className="flex items-center gap-2">
                  <a
                    href={`${window.location.origin}/i/${viewInvoice.publicToken}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm underline truncate flex-1"
                    style={{ color: "var(--color-accent)" }}
                    data-testid="link-public-invoice"
                  >
                    {window.location.origin}/i/{viewInvoice.publicToken}
                  </a>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0"
                    title="Copy Link"
                    aria-label="Copy link"
                    onClick={() => {
                      const link = `${window.location.origin}/i/${viewInvoice.publicToken}`;
                      navigator.clipboard.writeText(link);
                      setLinkCopied(true);
                      setTimeout(() => setLinkCopied(false), 2000);
                      toast({ title: "View link copied to clipboard" });
                    }}
                    data-testid="button-copy-public-link"
                  >
                    {linkCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0"
                    title="Open in New Tab"
                    aria-label="Open in new tab"
                    onClick={() => window.open(`${window.location.origin}/i/${viewInvoice.publicToken}`, "_blank")}
                    data-testid="button-open-public-link"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </FormSection>
            )}

            {/* Task #467: nudge admins (the only ones who land in this view)
                to upload an org logo when their PDFs are rendering without
                one. The dismissal persists in localStorage per-org so it
                doesn't nag forever. The customer-facing public invoice
                page (client/src/pages/public-invoice.tsx) intentionally
                does NOT show this banner.

                Task #468: only show this prompt once the org has at least
                one invoice or one client — i.e. they're actually about to
                send something branded. Brand-new orgs with no data yet
                shouldn't see the nag from day one. The hasInvoices /
                hasClients flags come from /api/org/settings. */}
            {orgSettings
              && !orgSettings.logoUrl
              && !uploadLogoBannerDismissed
              && (orgSettings.hasInvoices || orgSettings.hasClients) && (
              <div
                className="flex items-start gap-3 px-3 py-2.5 rounded-md text-xs"
                style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)", color: "#92400e" }}
                data-testid="banner-upload-logo-prompt"
              >
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "#f59e0b" }} />
                <div className="flex-1">
                  <p className="font-medium" style={{ color: "var(--lux-text)" }}>
                    Add your organization logo
                  </p>
                  <p className="mt-0.5" style={{ color: "var(--lux-text-muted)" }}>
                    Your invoice PDFs and emails will look more professional with a logo at the top.
                  </p>
                  <Link
                    href="/settings"
                    className="inline-block mt-1.5 text-xs font-medium underline"
                    style={{ color: "var(--color-accent)" }}
                    data-testid="link-upload-logo"
                  >
                    Upload logo in settings →
                  </Link>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 shrink-0"
                  onClick={() => {
                    try {
                      const orgKey = (orgSettings as any)?.id || "default";
                      window.localStorage.setItem(`cherry.uploadLogoBannerDismissed:${orgKey}`, "1");
                    } catch {}
                    setUploadLogoBannerDismissed(true);
                  }}
                  aria-label="Dismiss"
                  title="Dismiss"
                  data-testid="button-dismiss-upload-logo-banner"
                >
                  <XCircle className="w-3.5 h-3.5" />
                </Button>
              </div>
            )}

            <FormSection title="Line Items">
              {viewInvoice && invoiceDetails && (
                <div
                  className="flex items-center justify-between gap-4 mb-3 px-3 py-2.5 rounded-lg"
                  style={{ background: "var(--lux-surface-alt)", border: "1px solid var(--lux-border)" }}
                  data-testid="row-toggle-time-entry-details"
                >
                  <div className="flex flex-col">
                    <span className="text-xs font-semibold" style={{ color: "var(--lux-text)" }}>
                      Show worklog detail under each line
                    </span>
                    <span className="text-[11px]" style={{ color: "var(--lux-text-muted)" }}>
                      {invoiceDetails.override === null
                        ? `Using org default (${invoiceDetails.orgDefault ? "on" : "off"})`
                        : `Overridden for this invoice (${invoiceDetails.override ? "on" : "off"})`}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={!!invoiceDetails.showTimeEntryDetails}
                      disabled={toggleInvoiceDetailsMutation.isPending}
                      onCheckedChange={(checked) => {
                        toggleInvoiceDetailsMutation.mutate({ invoiceId: viewInvoice.id, value: checked });
                      }}
                      data-testid="switch-show-time-entry-details"
                    />
                    {invoiceDetails.override !== null && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        disabled={toggleInvoiceDetailsMutation.isPending}
                        onClick={() => toggleInvoiceDetailsMutation.mutate({ invoiceId: viewInvoice.id, value: null })}
                        data-testid="button-clear-time-entry-details-override"
                      >
                        Use default
                      </Button>
                    )}
                  </div>
                </div>
              )}
              <div
                className="rounded-lg overflow-hidden overflow-x-auto"
                style={{ border: "1px solid var(--lux-border)" }}
              >
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: "var(--lux-table-header-bg)" }}>
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Description</th>
                      <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Qty</th>
                      <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Rate</th>
                      <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Amount</th>
                      {isEditable && canManage && <th className="w-20 px-2 py-2.5"></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {viewInvoice.lines?.flatMap((line) => {
                      const detailItems =
                        invoiceDetails?.showTimeEntryDetails && !line.isHeader
                          ? invoiceDetails.lineDetails?.[line.id]
                          : undefined;
                      const detailRow = detailItems && detailItems.length > 0 ? (
                        <InvoiceDetailRows
                          key={`details-${line.id}`}
                          items={detailItems}
                          colSpan={isEditable && canManage ? 5 : 4}
                          testIdPrefix={`inapp-detail-${line.id}`}
                        />
                      ) : null;
                      const lineRow = line.isHeader ? (
                        <tr key={line.id} style={{ borderTop: "1px solid var(--lux-border)" }} data-testid={`row-header-${line.id}`}>
                          <td colSpan={isEditable && canManage ? 5 : 4} className="px-4 py-2 text-sm font-bold" style={{ color: "var(--lux-text)", background: "var(--lux-surface-alt)" }}>{line.description}</td>
                        </tr>
                      ) : (
                      <tr key={line.id} style={{ borderTop: "1px solid var(--lux-border)" }} data-testid={`row-line-${line.id}`}>
                        {editLineId === line.id ? (
                          <>
                            <td className="px-4 py-2">
                              <Input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} className="h-8 text-sm" style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }} data-testid="input-edit-line-desc" />
                            </td>
                            <td className="px-4 py-2">
                              <Input type="number" step="0.01" min="0" value={editQty} onChange={(e) => setEditQty(e.target.value)} className="h-8 text-sm text-right w-20" style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }} data-testid="input-edit-line-qty" />
                            </td>
                            <td className="px-4 py-2">
                              <div className="relative">
                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm font-medium" style={{ color: "var(--lux-text-muted)" }}>$</span>
                                <Input type="number" step="0.01" min="0" value={editRate} onChange={(e) => setEditRate(e.target.value)} className="pl-6 tabular-nums text-right h-8 text-sm w-24" style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }} data-testid="input-edit-line-rate" />
                              </div>
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums text-sm" style={{ color: "var(--lux-text)" }}>
                              <MoneyDisplay value={Number(editQty || 0) * Number(editRate || 0)} currency={viewInvoice?.currency || "USD"} />
                            </td>
                            <td className="px-2 py-2">
                              <div className="flex gap-1">
                                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" data-testid="button-save-line" disabled={editLineMutation.isPending} onClick={() => editLineMutation.mutate({ invoiceId: viewInvoice.id, lineId: line.id })}>Save</Button>
                                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditLineId(null)}>Cancel</Button>
                              </div>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-4 py-2.5" style={{ color: "var(--lux-text)" }}>{line.description}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: "var(--lux-text)" }}>{formatHours(line.quantity)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: "var(--lux-text)" }}><MoneyDisplay value={line.unitRate} currency={viewInvoice?.currency || "USD"} size="xs" /></td>
                            <td className="px-4 py-2.5 text-right font-medium tabular-nums" style={{ color: "var(--lux-text)" }} data-testid={`text-line-amount-${line.id}`}><MoneyDisplay value={line.amount} currency={viewInvoice?.currency || "USD"} size="xs" /></td>
                            {isEditable && canManage && (
                              <td className="px-2 py-2.5">
                                <div className="flex gap-1">
                                  <Button size="icon" variant="ghost" className="h-7 w-7" title="Edit Line Item" aria-label="Edit line item" data-testid={`button-edit-line-${line.id}`} onClick={() => { setEditLineId(line.id); setEditDesc(line.description); setEditQty(String(Number(line.quantity))); setEditRate(String(Number(line.unitRate))); }}>
                                    <Pencil className="w-3.5 h-3.5" />
                                  </Button>
                                  <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500" title="Delete Line Item" aria-label="Delete line item" data-testid={`button-delete-line-${line.id}`} disabled={deleteLineMutation.isPending} onClick={() => deleteLineMutation.mutate({ invoiceId: viewInvoice.id, lineId: line.id })}>
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              </td>
                            )}
                          </>
                        )}
                      </tr>
                      );
                      return detailRow ? [lineRow, detailRow] : [lineRow];
                    })}
                    {(() => {
                      const unallocated = invoiceDetails?.showTimeEntryDetails
                        ? invoiceDetails.lineDetails?.["__unallocated__"]
                        : undefined;
                      if (!unallocated || unallocated.length === 0) return null;
                      const cs = isEditable && canManage ? 5 : 4;
                      return (
                        <>
                          <tr
                            key="unallocated-header"
                            style={{ borderTop: "1px solid var(--lux-border)" }}
                            data-testid="row-unallocated-worklog-header"
                          >
                            <td
                              colSpan={cs}
                              className="px-4 py-2 text-sm font-bold uppercase tracking-wider"
                              style={{
                                color: "var(--lux-text)",
                                background: "var(--lux-surface-alt)",
                              }}
                            >
                              Additional worklog (unbilled time for this client)
                            </td>
                          </tr>
                          <InvoiceDetailRows
                            key="unallocated-rows"
                            items={unallocated}
                            colSpan={cs}
                            testIdPrefix="inapp-detail-unallocated"
                          />
                        </>
                      );
                    })()}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: "1px solid var(--lux-border)" }}>
                      <td colSpan={isEditable && canManage ? 4 : 3} className="px-4 py-2 text-right text-sm" style={{ color: "var(--lux-text-muted)" }}>Subtotal</td>
                      <td className="px-4 py-2 text-right font-medium tabular-nums text-sm" data-testid="text-invoice-subtotal"><MoneyDisplay value={viewInvoice.subtotal || 0} currency={viewInvoice?.currency || "USD"} /></td>
                    </tr>
                    {Number(viewInvoice.discountAmount || 0) > 0 && (
                      <tr style={{ borderTop: "1px solid var(--lux-border)" }}>
                        <td colSpan={isEditable && canManage ? 4 : 3} className="px-4 py-2 text-right text-sm" style={{ color: "var(--lux-text-muted)" }}>
                          Discount{viewInvoice.discountType === "PERCENT" ? ` (${formatPercent(viewInvoice.discountValue)})` : ""}
                        </td>
                        <td className="px-4 py-2 text-right font-medium tabular-nums text-sm" data-testid="text-invoice-discount"><MoneyDisplay value={-(Number(viewInvoice.discountAmount || 0))} currency={viewInvoice?.currency || "USD"} color="negative" /></td>
                      </tr>
                    )}
                    {Number(viewInvoice.taxAmount || 0) > 0 && (
                      <tr style={{ borderTop: "1px solid var(--lux-border)" }}>
                        <td colSpan={isEditable && canManage ? 4 : 3} className="px-4 py-2 text-right text-sm" style={{ color: "var(--lux-text-muted)" }}>
                          Tax ({formatPercent(viewInvoice.taxRate || 0)})
                        </td>
                        <td className="px-4 py-2 text-right font-medium tabular-nums text-sm" data-testid="text-invoice-tax"><MoneyDisplay value={viewInvoice.taxAmount || 0} currency={viewInvoice?.currency || "USD"} /></td>
                      </tr>
                    )}
                    <tr style={{ borderTop: "2px solid var(--lux-border)" }}>
                      <td colSpan={isEditable && canManage ? 4 : 3} className="px-4 py-3 text-right font-bold text-sm" style={{ color: "var(--lux-text)" }}>Total</td>
                      <td className="px-4 py-3 text-right font-bold text-base tabular-nums" style={{ color: "var(--color-accent)" }} data-testid="text-invoice-total"><MoneyDisplay value={viewInvoice.total} currency={viewInvoice?.currency || "USD"} size="lg" /></td>
                    </tr>
                    {Number(viewInvoice.paidAmount) > 0 && (
                      <>
                        <tr style={{ borderTop: "1px solid var(--lux-border)" }}>
                          <td colSpan={isEditable && canManage ? 4 : 3} className="px-4 py-2 text-right text-sm" style={{ color: "var(--lux-text-muted)" }}>Paid</td>
                          <td className="px-4 py-2 text-right font-medium tabular-nums" data-testid="text-invoice-paid"><MoneyDisplay value={viewInvoice.paidAmount} currency={viewInvoice?.currency || "USD"} color="positive" /></td>
                        </tr>
                        <tr style={{ borderTop: "1px solid var(--lux-border)" }}>
                          <td colSpan={isEditable && canManage ? 4 : 3} className="px-4 py-2 text-right text-sm font-bold" style={{ color: "var(--lux-text)" }}>Outstanding</td>
                          <td className="px-4 py-2 text-right font-bold tabular-nums" style={{ color: "var(--color-accent)" }} data-testid="text-invoice-outstanding"><MoneyDisplay value={viewInvoice.status.toLowerCase() === "void" ? 0 : Number(viewInvoice.total) - Number(viewInvoice.paidAmount)} currency={viewInvoice?.currency || "USD"} /></td>
                        </tr>
                      </>
                    )}
                  </tfoot>
                </table>
              </div>
            </FormSection>

            {/* RECORD PAYMENT — DEDICATED SECTION */}
            {["SENT", "PARTIAL"].includes(viewInvoice.status) && canManage && (
              <FormSection title="Record Payment">
                {!paymentOpen ? (
                  <Button
                    onClick={() => {
                      const outstanding = Number(viewInvoice.total) - Number(viewInvoice.paidAmount || 0);
                      setPaymentAmount(outstanding.toFixed(2));
                      setPaymentDate(new Date().toISOString().split("T")[0]);
                      setPaymentMethod("CHECK");
                      setPaymentNotes("");
                      setPaymentOpen(true);
                    }}
                    style={{ background: "var(--gradient-brand)" }}
                    className="text-white"
                    data-testid="button-record-payment"
                    title="Record Payment"
                  >
                    <DollarSign className="w-4 h-4 mr-2" /> Record Payment
                  </Button>
                ) : (
                  <form onSubmit={(e) => { e.preventDefault(); recordPaymentMutation.mutate(); }} className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium">Amount *</Label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium" style={{ color: "var(--lux-text-muted)" }}>$</span>
                          <Input
                            type="number"
                            step="0.01"
                            min="0.01"
                            value={paymentAmount}
                            onChange={(e) => setPaymentAmount(e.target.value)}
                            required
                            className="pl-7 tabular-nums text-right h-8 text-sm"
                            style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                            data-testid="input-payment-amount"
                          />
                        </div>
                        {(() => {
                          const outstanding = Number(viewInvoice.total) - Number(viewInvoice.paidAmount || 0);
                          const overMax = Number(paymentAmount) > outstanding;
                          return (
                            <p className="text-[11px]" style={{ color: overMax ? "#ef4444" : "var(--lux-text-muted)" }}>
                              {overMax ? `Exceeds outstanding balance of ${formatMoney(outstanding, viewInvoice?.currency || "USD")}` : `Outstanding: ${formatMoney(outstanding, viewInvoice?.currency || "USD")}`}
                            </p>
                          );
                        })()}
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium">Method</Label>
                        <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                          <SelectTrigger style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }} data-testid="select-payment-method">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="CHECK">Check</SelectItem>
                            <SelectItem value="WIRE">Wire Transfer</SelectItem>
                            <SelectItem value="ACH">ACH</SelectItem>
                            <SelectItem value="STRIPE">Stripe</SelectItem>
                            <SelectItem value="CASH">Cash</SelectItem>
                            <SelectItem value="OTHER">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Date</Label>
                      <Popover open={paymentDatePopoverOpen} onOpenChange={setPaymentDatePopoverOpen}>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="w-full justify-start text-left font-normal h-9 text-sm"
                            style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: paymentDate ? "var(--lux-text)" : "var(--lux-text-muted)" }}
                            data-testid="input-payment-date">
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {paymentDate ? format(new Date(paymentDate + "T00:00:00"), "MMM d, yyyy") : "Pick a date"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <CalendarWidget mode="single" selected={paymentDate ? new Date(paymentDate + "T00:00:00") : undefined}
                            onSelect={(day) => { if (day) { setPaymentDate(format(day, "yyyy-MM-dd")); setPaymentDatePopoverOpen(false); } }} />
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Notes (optional)</Label>
                      <Input
                        value={paymentNotes}
                        onChange={(e) => setPaymentNotes(e.target.value)}
                        placeholder="e.g., Check #1234"
                        style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                        data-testid="input-payment-notes"
                      />
                    </div>
                    <div className="flex gap-2 justify-end">
                      <Button type="button" variant="ghost" size="sm" onClick={() => setPaymentOpen(false)}>
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        size="sm"
                        className="text-white"
                        style={{ background: "var(--gradient-brand)" }}
                        disabled={recordPaymentMutation.isPending || !paymentAmount || Number(paymentAmount) <= 0 || !paymentDate || Number(paymentAmount) > (Number(viewInvoice.total) - Number(viewInvoice.paidAmount || 0))}
                        data-testid="button-submit-payment"
                      >
                        {recordPaymentMutation.isPending ? "Recording..." : "Record Payment"}
                      </Button>
                    </div>
                  </form>
                )}
              </FormSection>
            )}

            {invoicePayments.length > 0 && (
              <FormSection title="Payment History">
                <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--lux-border)" }}>
                  <table className="w-full text-sm" data-testid="table-payment-history">
                    <thead>
                      <tr style={{ background: "var(--lux-table-header-bg)" }}>
                        <th className="text-left px-4 py-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Date</th>
                        <th className="text-right px-4 py-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Amount</th>
                        <th className="text-left px-4 py-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Method</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoicePayments.map((p) => (
                        <tr key={p.id} style={{ borderTop: "1px solid var(--lux-border)" }} data-testid={`row-payment-${p.id}`}>
                          <td className="px-4 py-2"><DateDisplay value={p.date} /></td>
                          <td className="px-4 py-2 text-right"><MoneyDisplay value={p.amount} currency={viewInvoice?.currency || "USD"} color={Number(p.amount) < 0 ? "negative" : "positive"} /></td>
                          <td className="px-4 py-2"><StatusBadge status={p.method || p.provider} size="xs" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </FormSection>
            )}

            {isEditable && canManage && (
              <FormSection title="Edit Line Items">
                <div className="space-y-3">
                  {!addLineOpen && (
                    <Button size="sm" variant="outline" onClick={() => setAddLineOpen(true)} data-testid="button-add-line">
                      <Plus className="w-3.5 h-3.5 mr-1" /> Add Line
                    </Button>
                  )}
                  {addLineOpen && (
                    <div className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-5 space-y-1">
                        <Label className="text-xs">Description</Label>
                        <Input value={lineDesc} onChange={(e) => setLineDesc(e.target.value)} className="h-8 text-sm" style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }} data-testid="input-new-line-desc" />
                      </div>
                      <div className="col-span-2 space-y-1">
                        <Label className="text-xs">Qty</Label>
                        <Input type="number" step="0.01" min="0" value={lineQty} onChange={(e) => setLineQty(e.target.value)} className="h-8 text-sm" style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }} data-testid="input-new-line-qty" />
                      </div>
                      <div className="col-span-2 space-y-1">
                        <Label className="text-xs">Rate</Label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium" style={{ color: "var(--lux-text-muted)" }}>$</span>
                          <Input type="number" step="0.01" min="0" value={lineRate} onChange={(e) => setLineRate(e.target.value)} className="pl-7 tabular-nums text-right h-8 text-sm" style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }} data-testid="input-new-line-rate" />
                        </div>
                      </div>
                      <div className="col-span-3 flex gap-1">
                        <Button size="sm" className="h-8 text-white" style={{ background: "var(--gradient-brand)" }} disabled={addLineMutation.isPending || !lineDesc || !lineQty || !lineRate} onClick={() => addLineMutation.mutate(viewInvoice.id)} data-testid="button-submit-new-line">Add</Button>
                        <Button size="sm" variant="ghost" className="h-8" onClick={() => { setAddLineOpen(false); setLineDesc(""); setLineQty(""); setLineRate(""); }}>Cancel</Button>
                      </div>
                    </div>
                  )}

                  <div className="border-t pt-3" style={{ borderColor: "var(--lux-border)" }}>
                    <p className="text-sm font-semibold mb-2" style={{ color: "var(--lux-text)" }}>Discount &amp; Tax</p>
                    <div className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-3 space-y-1">
                        <Label className="text-xs">Discount Type</Label>
                        <Select value={discountType} onValueChange={setDiscountType}>
                          <SelectTrigger className="h-8 text-sm" style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }} data-testid="select-discount-type"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="NONE">None</SelectItem>
                            <SelectItem value="PERCENT">Percent</SelectItem>
                            <SelectItem value="FIXED">Fixed</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-3 space-y-1">
                        <Label className="text-xs">{discountType === "PERCENT" ? "Discount %" : "Discount $"}</Label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium" style={{ color: "var(--lux-text-muted)" }}>{discountType === "PERCENT" ? "%" : "$"}</span>
                          <Input type="number" step="0.01" min="0" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} className="pl-7 tabular-nums text-right h-8 text-sm" style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }} disabled={discountType === "NONE"} data-testid="input-discount-value" />
                        </div>
                      </div>
                      <div className="col-span-3 space-y-1">
                        <Label className="text-xs">Tax %</Label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium" style={{ color: "var(--lux-text-muted)" }}>%</span>
                          <Input type="number" step="0.01" min="0" max="100" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} className="pl-7 tabular-nums text-right h-8 text-sm" style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }} data-testid="input-tax-rate" />
                        </div>
                      </div>
                      <div className="col-span-3">
                        <Button size="sm" className="h-8 w-full text-white" style={{ background: "var(--gradient-brand)" }} disabled={updateDiscountTaxMutation.isPending} onClick={() => updateDiscountTaxMutation.mutate(viewInvoice.id)} data-testid="button-apply-discount-tax">Apply</Button>
                      </div>
                    </div>
                  </div>
                </div>
              </FormSection>
            )}

            {/* INTERNAL NOTES SECTION */}
            <FormSection title="Internal Notes">
              <div className="space-y-2">
                <Textarea
                  value={internalNotes}
                  onChange={(e) => setInternalNotes(e.target.value)}
                  placeholder="Add internal notes about this invoice (not visible to client)..."
                  className="text-sm min-h-[60px]"
                  style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                  data-testid="textarea-internal-notes"
                />
                <div className="flex items-center justify-between">
                  <p className="text-[10px]" style={{ color: "var(--lux-text-muted)" }}>
                    <StickyNote className="w-3 h-3 inline mr-1" />
                    Internal only — not visible on client-facing invoice
                  </p>
                  {canManage && internalNotes !== ((viewInvoice as any).notes || "") && (
                    <Button
                      size="sm"
                      className="h-7 text-xs text-white"
                      style={{ background: "var(--gradient-brand)" }}
                      disabled={updateNotesMutation.isPending}
                      onClick={() => updateNotesMutation.mutate({ invoiceId: viewInvoice.id, notes: internalNotes })}
                      data-testid="button-save-notes"
                    >
                      {updateNotesMutation.isPending ? "Saving..." : "Save Notes"}
                    </Button>
                  )}
                </div>
              </div>
            </FormSection>

            <FormSection title="Actions">
              <div className="flex gap-2 flex-wrap">
                <Button
                  variant="outline"
                  onClick={() => {
                    setPdfPreviewUrl(`/api/invoices/${viewInvoice.id}/pdf`);
                    setPdfPreviewTitle(`Invoice ${viewInvoice.number}`);
                    setPdfPreviewOpen(true);
                  }}
                  data-testid="button-download-pdf"
                  title="Preview & Download PDF"
                >
                  <Download className="w-4 h-4 mr-2" /> Download PDF
                </Button>
                {viewInvoice.publicToken && (
                  <Button
                    variant="outline"
                    data-testid="button-copy-view-link"
                    title="Copy View Link"
                    onClick={() => {
                      const link = `${window.location.origin}/i/${viewInvoice.publicToken}`;
                      navigator.clipboard.writeText(link);
                      setLinkCopied(true);
                      setTimeout(() => setLinkCopied(false), 2000);
                      toast({ title: "View link copied to clipboard" });
                    }}
                  >
                    {linkCopied ? <Check className="w-4 h-4 mr-2" /> : <Link2 className="w-4 h-4 mr-2" />}
                    {linkCopied ? "Copied!" : "View Link"}
                  </Button>
                )}
                {["SENT", "PARTIAL", "PAID"].includes(viewInvoice.status) && canManage && (
                  <Button variant="outline" onClick={() => { setIsResendMode(true); setSendEmailOpen(true); }} disabled={resendMutation.isPending} data-testid="button-resend-invoice" title="Resend Email">
                    <RefreshCw className="w-4 h-4 mr-2" /> {resendMutation.isPending ? "Sending..." : "Resend Email"}
                  </Button>
                )}
                {canManage && (
                  <Button variant="outline" onClick={(e) => { e.stopPropagation(); duplicateMutation.mutate(viewInvoice.id); setViewInvoice(null); }} disabled={duplicateMutation.isPending} data-testid="button-duplicate-invoice" title="Duplicate Invoice">
                    <Copy className="w-4 h-4 mr-2" /> Duplicate
                  </Button>
                )}
                {["SENT", "PARTIAL", "PAID"].includes(viewInvoice.status) && canManage && !autoPostEnabled && glPostedStatus && !glPostedStatus.posted && (
                  <Button
                    variant="outline"
                    onClick={() => repostGlMutation.mutate(viewInvoice.id)}
                    disabled={repostGlMutation.isPending}
                    data-testid="button-repost-gl"
                    title="Post to GL"
                  >
                    <BookOpen className="w-4 h-4 mr-2" /> {repostGlMutation.isPending ? "Posting..." : "Post to GL"}
                  </Button>
                )}
                {["SENT", "PARTIAL", "PAID"].includes(viewInvoice.status) && canManage && !autoPostEnabled && glPostedStatus?.posted && (
                  <span className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md" style={{ background: "var(--lux-bg-muted)", color: "var(--lux-text-muted)" }} data-testid="badge-gl-posted" title="Posted to GL">
                    <BookOpen className="w-3 h-3" /> Posted to GL
                  </span>
                )}
                {isDraft && canManage && (
                  <Button
                    disabled={sendMutation.isPending}
                    data-testid="button-send-invoice"
                    style={{ background: "var(--gradient-brand)" }}
                    className="text-white"
                    onClick={() => { setIsResendMode(false); setSendEmailOpen(true); }}
                    title="Send Invoice"
                  >
                    <Send className="w-4 h-4 mr-2" /> Send Invoice
                  </Button>
                )}
              </div>
            </FormSection>

            {revisions && revisions.length > 0 && (
              <FormSection title={`Revision History (${revisions.length})`}>
                <div className="space-y-2">
                  {revisions.map((rev) => {
                    const snap = rev.snapshot as any;
                    const isExpanded = expandedRevision === rev.id;
                    return (
                      <div key={rev.id} className="rounded-md overflow-hidden" style={{ border: "1px solid var(--lux-border)" }} data-testid={`revision-row-${rev.id}`}>
                        <button
                          type="button"
                          className="w-full flex items-center justify-between px-3 py-2 text-left"
                          style={{ background: "var(--lux-bg)" }}
                          onClick={() => setExpandedRevision(isExpanded ? null : rev.id)}
                          data-testid={`revision-toggle-${rev.id}`}
                          title="Revision History"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <History className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--lux-text-muted)" }} />
                            <span className="text-sm font-medium" style={{ color: "var(--lux-text)" }} data-testid={`revision-number-${rev.id}`}>
                              Rev #{rev.revisionNumber}
                            </span>
                            {rev.reason && (
                              <span className="text-xs truncate" style={{ color: "var(--lux-text-muted)" }} data-testid={`revision-reason-${rev.id}`}>
                                {rev.reason}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-xs tabular-nums" style={{ color: "var(--lux-text-muted)" }}>
                              {formatDate(rev.createdAt instanceof Date ? rev.createdAt.toISOString() : rev.createdAt)} {new Date(rev.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </span>
                            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" style={{ color: "var(--lux-text-muted)" }} /> : <ChevronDown className="w-3.5 h-3.5" style={{ color: "var(--lux-text-muted)" }} />}
                          </div>
                        </button>
                        {isExpanded && snap && (
                          <div className="px-3 py-3 space-y-3" style={{ borderTop: "1px solid var(--lux-border)", background: "var(--color-surface-1)" }}>
                            <div className="grid grid-cols-2 gap-3 text-xs">
                              <div>
                                <span style={{ color: "var(--lux-text-muted)" }}>Total: </span>
                                <span className="font-medium tabular-nums" style={{ color: "var(--lux-text)" }}>{formatMoney(snap.total, snap.currency || viewInvoice.currency || "USD")}</span>
                              </div>
                              <div>
                                <span style={{ color: "var(--lux-text-muted)" }}>Subtotal: </span>
                                <span className="font-medium tabular-nums" style={{ color: "var(--lux-text)" }}>{formatMoney(snap.subtotal, snap.currency || viewInvoice.currency || "USD")}</span>
                              </div>
                              {snap.discountAmount && Number(snap.discountAmount) > 0 && (
                                <div>
                                  <span style={{ color: "var(--lux-text-muted)" }}>Discount: </span>
                                  <span className="tabular-nums" style={{ color: "var(--lux-text)" }}>{formatMoney(snap.discountAmount, snap.currency || viewInvoice.currency || "USD")}</span>
                                </div>
                              )}
                              {snap.taxAmount && Number(snap.taxAmount) > 0 && (
                                <div>
                                  <span style={{ color: "var(--lux-text-muted)" }}>Tax: </span>
                                  <span className="tabular-nums" style={{ color: "var(--lux-text)" }}>{formatMoney(snap.taxAmount, snap.currency || viewInvoice.currency || "USD")}</span>
                                </div>
                              )}
                              <div>
                                <span style={{ color: "var(--lux-text-muted)" }}>Issued: </span>
                                <span style={{ color: "var(--lux-text)" }}>{formatDate(snap.issuedDate)}</span>
                              </div>
                              <div>
                                <span style={{ color: "var(--lux-text-muted)" }}>Due: </span>
                                <span style={{ color: "var(--lux-text)" }}>{formatDate(snap.dueDate)}</span>
                              </div>
                            </div>
                            {snap.lines && snap.lines.length > 0 && (
                              <div className="rounded-md overflow-hidden" style={{ border: "1px solid var(--lux-border)" }}>
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr style={{ background: "var(--lux-table-header-bg)" }}>
                                      <th className="text-left px-3 py-1.5 font-semibold" style={{ color: "var(--lux-text-muted)" }}>Description</th>
                                      <th className="text-right px-3 py-1.5 font-semibold" style={{ color: "var(--lux-text-muted)" }}>Qty</th>
                                      <th className="text-right px-3 py-1.5 font-semibold" style={{ color: "var(--lux-text-muted)" }}>Rate</th>
                                      <th className="text-right px-3 py-1.5 font-semibold" style={{ color: "var(--lux-text-muted)" }}>Amount</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {snap.lines.map((sl: any, idx: number) => (
                                      sl.isHeader ? (
                                        <tr key={idx} style={{ borderTop: "1px solid var(--lux-border)" }}>
                                          <td colSpan={4} className="px-3 py-1.5 font-bold" style={{ color: "var(--lux-text)", background: "var(--lux-surface-alt)" }}>{sl.description}</td>
                                        </tr>
                                      ) : (
                                        <tr key={idx} style={{ borderTop: "1px solid var(--lux-border)" }}>
                                          <td className="px-3 py-1.5" style={{ color: "var(--lux-text)" }}>{sl.description}</td>
                                          <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: "var(--lux-text)" }}>{Number(sl.quantity).toFixed(2)}</td>
                                          <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: "var(--lux-text)" }}>{formatMoney(sl.unitRate, snap.currency || viewInvoice.currency || "USD")}</td>
                                          <td className="px-3 py-1.5 text-right tabular-nums font-medium" style={{ color: "var(--lux-text)" }}>{formatMoney(sl.amount, snap.currency || viewInvoice.currency || "USD")}</td>
                                        </tr>
                                      )
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                            {snap.notes && (
                              <div className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
                                Notes: {snap.notes}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </FormSection>
            )}

            {isAdmin && viewInvoice.status !== "VOID" && viewInvoice.status !== "DRAFT" && (
              <DangerZone description="Voiding an invoice is permanent and cannot be undone. A reversing journal entry will be created in the General Ledger.">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm" disabled={voidMutation.isPending} data-testid="button-void-invoice">
                      <Ban className="w-3.5 h-3.5 mr-1" /> Void Invoice
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Void Invoice #{viewInvoice.number}</AlertDialogTitle>
                      <AlertDialogDescription asChild>
                        <div className="space-y-2">
                          <p>Are you sure you want to void this invoice? This action cannot be undone.</p>
                          <p className="font-medium text-red-600">A reversing journal entry will automatically be posted to the General Ledger to offset the original entry.</p>
                          {viewInvoice.status === "PAID" && (
                            <p className="font-medium text-amber-600">This invoice has recorded payments. Voiding will reverse the AR entry but payment records will remain for reconciliation.</p>
                          )}
                        </div>
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => voidMutation.mutate(viewInvoice.id)} className="bg-red-600 hover:bg-red-700" data-testid="confirm-void-invoice">Void Invoice</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </DangerZone>
            )}
          </div>
        )}
      </DetailPanel>

      {!filteredInvoices.length ? (
        <EmptyState
          icon={FileText}
          title={invoices?.length ? "No invoices found" : "No invoices yet"}
          description={invoices?.length ? "Try adjusting your filters" : "Create your first invoice to start billing clients"}
          action={canManage ? () => setGenOpen(true) : undefined}
          actionLabel="Create Invoice"
        />
      ) : (
        <div
          className="rounded-lg overflow-hidden"
          style={{
            background: "var(--lux-surface)",
            boxShadow: "var(--lux-card-shadow)",
            border: "1px solid var(--lux-border)",
          }}
        >
          <Table>
            <TableHeader>
              <TableRow style={{ background: "var(--lux-table-header-bg)" }}>
                {canManage && (
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={toggleSelectAll}
                      aria-label="Select all invoices"
                      data-testid="checkbox-select-all"
                    />
                  </TableHead>
                )}
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("number")} data-testid="th-sort-number">
                  <span className="flex items-center text-[11px] font-semibold uppercase tracking-wider">Invoice # <SortIcon field="number" /></span>
                </TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("clientName")} data-testid="th-sort-client">
                  <span className="flex items-center text-[11px] font-semibold uppercase tracking-wider">Client <SortIcon field="clientName" /></span>
                </TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("status")} data-testid="th-sort-status">
                  <span className="flex items-center text-[11px] font-semibold uppercase tracking-wider">Status <SortIcon field="status" /></span>
                </TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("dueDate")} data-testid="th-sort-due">
                  <span className="flex items-center text-[11px] font-semibold uppercase tracking-wider">Due Date <SortIcon field="dueDate" /></span>
                </TableHead>
                <TableHead className="cursor-pointer select-none text-right" onClick={() => toggleSort("total")} data-testid="th-sort-total">
                  <span className="flex items-center justify-end text-[11px] font-semibold uppercase tracking-wider">Total <SortIcon field="total" /></span>
                </TableHead>
                <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider">Outstanding</TableHead>
                {canManage && <TableHead className="w-24 text-[11px] font-semibold uppercase tracking-wider">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredInvoices.map((inv) => {
                const outstanding = inv.status.toLowerCase() === "void" ? 0 : Number(inv.total) - Number(inv.paidAmount);
                return (
                  <TableRow
                    key={inv.id}
                    className="cursor-pointer"
                    style={{ borderColor: "var(--lux-border)" }}
                    onClick={() => openViewInvoice(inv)}
                    data-testid={`row-invoice-${inv.id}`}
                  >
                    {canManage && (
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(inv.id)}
                          onCheckedChange={() => toggleSelect(inv.id)}
                          aria-label="Select invoice"
                          data-testid={`checkbox-select-${inv.id}`}
                        />
                      </TableCell>
                    )}
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span className="font-sans tabular-nums font-semibold text-sm" style={{ color: "var(--lux-text)" }}>{inv.number}</span>
                        {inv.sourceEstimateId && (
                          <a
                            href="/estimates"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded no-underline hover:opacity-80 transition-opacity"
                            style={{ background: "rgba(139,92,246,0.12)", color: "#8b5cf6" }}
                            data-testid={`badge-from-estimate-${inv.id}`}
                          >
                            <FileCheck className="w-2.5 h-2.5" />
                            From estimate
                          </a>
                        )}
                      </div>
                    </TableCell>
                    <TableCell style={{ color: "var(--lux-text-secondary)" }}>{inv.clientName}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <StatusBadge status={inv.status} size="xs" />
                        {isOverdue(inv) && <StatusBadge status="OVERDUE" size="xs" />}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <DateDisplay value={inv.dueDate} />
                        {isOverdue(inv) && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }} data-testid={`badge-overdue-${inv.id}`}>
                            {daysOverdue(inv)}d overdue
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right"><MoneyDisplay value={inv.total} currency={inv.currency || "USD"} /></TableCell>
                    <TableCell className="text-right">
                      {outstanding > 0 ? <MoneyDisplay value={outstanding} currency={inv.currency || "USD"} color="negative" /> : <span style={{ color: "var(--lux-text-muted)" }}>—</span>}
                    </TableCell>
                    {canManage && (
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); openViewInvoice(inv); }} title="View Details" aria-label="View details" data-testid={`button-view-invoice-${inv.id}`}>
                            <Eye className="w-4 h-4" />
                          </Button>
                          {["SENT", "PARTIAL"].includes(inv.status) && (
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                openViewInvoice(inv);
                                const outstanding = Number(inv.total) - Number(inv.paidAmount || 0);
                                setPaymentAmount(outstanding.toFixed(2));
                                setPaymentDate(new Date().toISOString().split("T")[0]);
                                setPaymentMethod("CHECK");
                                setPaymentNotes("");
                                setTimeout(() => setPaymentOpen(true), 300);
                              }}
                              title="Record Payment"
                              aria-label="Record payment"
                              data-testid={`button-pay-${inv.id}`}
                            >
                              <DollarSign className="w-4 h-4" />
                            </Button>
                          )}
                          <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); duplicateMutation.mutate(inv.id); }} disabled={duplicateMutation.isPending} title="Duplicate Invoice" aria-label="Duplicate invoice" data-testid={`button-duplicate-${inv.id}`}>
                            <Copy className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {viewInvoice && (
        <SendEmailModal
          open={sendEmailOpen}
          onClose={() => { setSendEmailOpen(false); setIsResendMode(false); }}
          onSend={(emailData) => {
            const params = {
              invoiceId: viewInvoice.id,
              emailTo: emailData.to,
              emailSubject: emailData.subject,
              emailBody: emailData.body,
            };
            if (isResendMode) resendMutation.mutate(params);
            else sendMutation.mutate(params);
          }}
          isPending={isResendMode ? resendMutation.isPending : sendMutation.isPending}
          isResend={isResendMode}
          type="invoice"
          number={viewInvoice.number}
          clientName={viewInvoice.clientName}
          clientEmail={viewInvoice.clientEmail}
          clientId={viewInvoice.clientId}
          orgName={orgSettings?.name || "Cherry Street Consulting"}
          total={String(viewInvoice.total)}
          dueDate={viewInvoice.dueDate}
          currency={viewInvoice.currency || "USD"}
        />
      )}
    </div>
  );
}
