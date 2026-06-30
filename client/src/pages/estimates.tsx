import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { PageHelpLink } from "@/components/page-help-link";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
import {
  Plus, Send, Check, X, FileCheck, FileText, Copy, Search, Clock, AlertTriangle,
  ArrowUpDown, ArrowUp, ArrowDown, Download, Trash2, Eye, Save, ExternalLink, Mail,
  ChevronRight, TrendingUp, DollarSign, BarChart3, BookOpen, XCircle, CheckCircle, Timer,
  CalendarIcon, ChevronsUpDown, ArrowLeft,
} from "lucide-react";
import { useLocation } from "wouter";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { StatusBadge } from "@/components/shared/status-badge";
import { ActiveFilterBar, type FilterChipDescriptor } from "@/components/active-filter-chip";
import { DateDisplay } from "@/components/shared/date-display";
import { EmptyState } from "@/components/shared/empty-state";
import { MoneyDisplay } from "@/components/shared/money-display";
import { formatMoney } from "@/components/shared/format";
import { SendEmailModal } from "@/components/shared/send-email-modal";
import { useBaseCurrency } from "@/hooks/use-base-currency";
import { useDocumentTitle } from "@/lib/use-document-title";
import { useUrlFilterState } from "@/lib/use-url-filter-state";

const STATUS_TABS = ["All", "DRAFT", "SENT", "ACCEPTED", "INVOICED", "DECLINED", "EXPIRED"] as const;

const STATUS_COLORS: Record<string, string> = {
  ALL: "#8b5cf6",
  DRAFT: "#6b7280",
  SENT: "#3b82f6",
  ACCEPTED: "#22c55e",
  INVOICED: "#10b981",
  DECLINED: "#ef4444",
  EXPIRED: "#f59e0b",
};

const STATUS_LABELS: Record<string, string> = { ALL: "All", DRAFT: "Draft", SENT: "Sent", ACCEPTED: "Accepted", INVOICED: "Invoiced", DECLINED: "Declined", EXPIRED: "Expired" };
const STATUS_ICONS: Record<string, any> = { ALL: FileCheck, DRAFT: BookOpen, SENT: Send, ACCEPTED: CheckCircle, INVOICED: FileText, DECLINED: XCircle, EXPIRED: Timer };

interface EstimateLine {
  description: string;
  quantity: number;
  unitRate: number;
}

type SortField = "number" | "clientName" | "status" | "issuedDate" | "expiryDate" | "total";
type SortDir = "asc" | "desc";

function getExpiryBadge(expiryDate: string | null) {
  if (!expiryDate) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const expiry = new Date(expiryDate + "T00:00:00");
  const diffDays = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return (
      <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" data-testid="badge-expired">
        <AlertTriangle className="w-3 h-3 mr-1" />
        Expired
      </Badge>
    );
  }
  if (diffDays <= 7) {
    return (
      <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" data-testid="badge-expiring-soon">
        <Clock className="w-3 h-3 mr-1" />
        Expiring Soon
      </Badge>
    );
  }
  return null;
}

function exportEstimatesToExcel(estimates: any[], baseCurrency: string) {
  const headers = ["Number", "Client", "Status", "Issued Date", "Expiry Date", "Subtotal", "Discount", "Tax", "Total", "Notes"];
  const rows = estimates.map((est: any) => [
    est.number,
    est.clientName || "",
    est.status,
    est.issuedDate || "",
    est.expiryDate || "",
    Number(est.subtotal || 0).toFixed(2),
    Number(est.discountAmount || 0).toFixed(2),
    Number(est.taxAmount || 0).toFixed(2),
    Number(est.total || 0).toFixed(2),
    (est.notes || "").replace(/"/g, '""'),
  ]);
  const csv = [headers, ...rows].map((r) => r.map((c: string) => `"${c}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `estimates_${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

interface ConversionPreview {
  estimateId: string;
  estimateNumber: string;
  clientId: string;
  invoiceNumber: string;
  issuedDate: string;
  dueDate: string;
  paymentTermsDays: number;
  lines: { description: string; quantity: string; unitRate: string; amount: string }[];
  subtotal: string;
  discountType: string;
  discountValue: string;
  discountAmount: string;
  taxRate: string;
  taxAmount: string;
  total: string;
  notes: string | null;
}

function ConvertToInvoiceModal({
  estimateId,
  open,
  onOpenChange,
  baseCurrency,
  onConverted,
}: {
  estimateId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  baseCurrency: string;
  onConverted: () => void;
}) {
  const { toast } = useToast();
  const [editMode, setEditMode] = useState(false);
  const [editDueDate, setEditDueDate] = useState("");
  const [dueDatePopoverOpen, setDueDatePopoverOpen] = useState(false);

  const { data: preview, isLoading } = useQuery<ConversionPreview>({
    queryKey: ["/api/estimates", estimateId, "conversion-preview"],
    queryFn: async () => {
      const res = await fetch(`/api/estimates/${estimateId}/conversion-preview`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    enabled: !!estimateId && open,
  });

  useEffect(() => {
    if (preview) setEditDueDate(preview.dueDate);
  }, [preview]);

  const convertMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/estimates/${estimateId}/convert-to-invoice`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      toast({ title: "Invoice created from estimate" });
      onOpenChange(false);
      onConverted();
    },
    onError: (err: any) => {
      toast({ title: "Failed to convert", description: err.message, variant: "destructive" });
    },
  });

  const fmt = (v: string | number) => formatMoney(Number(v), baseCurrency);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" style={{ color: "var(--lux-text)" }}>
            <FileText className="w-5 h-5" style={{ color: "var(--lux-accent)" }} />
            Convert Estimate to Invoice
          </DialogTitle>
        </DialogHeader>

        {isLoading || !preview ? (
          <div className="space-y-3 py-4">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-sm" style={{ color: "var(--lux-text-muted)" }}>
              <span>From Estimate <strong style={{ color: "var(--lux-text)" }}>#{preview.estimateNumber}</strong></span>
              <span>→ Invoice <strong style={{ color: "var(--lux-text)" }}>#{preview.invoiceNumber}</strong></span>
            </div>

            <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--lux-border)" }}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: "var(--lux-card-bg)" }}>
                    <th className="text-left px-3 py-2 font-medium" style={{ color: "var(--lux-text-muted)" }}>Description</th>
                    <th className="text-right px-3 py-2 font-medium" style={{ color: "var(--lux-text-muted)" }}>Qty</th>
                    <th className="text-right px-3 py-2 font-medium" style={{ color: "var(--lux-text-muted)" }}>Rate</th>
                    <th className="text-right px-3 py-2 font-medium" style={{ color: "var(--lux-text-muted)" }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.lines.map((line, i) => (
                    <tr key={i} style={{ borderTop: "1px solid var(--lux-border)" }}>
                      <td className="px-3 py-2" style={{ color: "var(--lux-text)" }}>{line.description || "—"}</td>
                      <td className="text-right px-3 py-2" style={{ color: "var(--lux-text)" }}>{Number(line.quantity)}</td>
                      <td className="text-right px-3 py-2" style={{ color: "var(--lux-text)" }}>{fmt(line.unitRate)}</td>
                      <td className="text-right px-3 py-2" style={{ color: "var(--lux-text)" }}>{fmt(line.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-1.5 text-sm px-1">
              <div className="flex justify-between" style={{ color: "var(--lux-text-muted)" }}>
                <span>Subtotal</span>
                <span style={{ color: "var(--lux-text)" }}>{fmt(preview.subtotal)}</span>
              </div>
              {Number(preview.discountAmount) > 0 && (
                <div className="flex justify-between" style={{ color: "var(--lux-text-muted)" }}>
                  <span>Discount {preview.discountType === "PERCENTAGE" ? `(${preview.discountValue}%)` : ""}</span>
                  <span style={{ color: "#ef4444" }}>−{fmt(preview.discountAmount)}</span>
                </div>
              )}
              {Number(preview.taxRate) > 0 && (
                <div className="flex justify-between" style={{ color: "var(--lux-text-muted)" }}>
                  <span>Tax ({preview.taxRate}%)</span>
                  <span style={{ color: "var(--lux-text)" }}>{fmt(preview.taxAmount)}</span>
                </div>
              )}
              <div className="flex justify-between pt-1.5 font-bold" style={{ borderTop: "1px solid var(--lux-border)", color: "var(--lux-text)" }}>
                <span>Total</span>
                <span>{fmt(preview.total)}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Issue Date</span>
                <p style={{ color: "var(--lux-text)" }}>{preview.issuedDate}</p>
              </div>
              <div>
                <span className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Due Date</span>
                {editMode ? (
                  <Popover open={dueDatePopoverOpen} onOpenChange={setDueDatePopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="w-full justify-start text-left h-8 text-xs mt-0.5" data-testid="input-edit-due-date">
                        <CalendarIcon className="w-3 h-3 mr-1" />
                        {editDueDate}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={editDueDate ? new Date(editDueDate + "T00:00:00") : undefined}
                        onSelect={(date) => {
                          if (date) {
                            setEditDueDate(format(date, "yyyy-MM-dd"));
                            setDueDatePopoverOpen(false);
                          }
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                ) : (
                  <p style={{ color: "var(--lux-text)" }}>{preview.dueDate} <span style={{ color: "var(--lux-text-muted)" }}>({preview.paymentTermsDays}d terms)</span></p>
                )}
              </div>
            </div>

            {!editMode && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                style={{ color: "var(--lux-accent)" }}
                onClick={() => setEditMode(true)}
                data-testid="button-edit-before-creating"
              >
                <Eye className="w-3 h-3 mr-1" /> Edit before creating
              </Button>
            )}

            <div className="flex gap-3 pt-2">
              <Button
                className="flex-1"
                style={{ background: "var(--gradient-brand)", color: "#fff" }}
                onClick={() => convertMutation.mutate()}
                disabled={convertMutation.isPending}
                data-testid="button-confirm-convert"
              >
                {convertMutation.isPending ? "Creating..." : "Create Invoice"}
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => onOpenChange(false)}
                data-testid="button-cancel-convert"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function EstimatesPage() {
  useDocumentTitle("Estimates");
  const { toast } = useToast();
  const baseCurrency = useBaseCurrency();
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState("");
  const [issuedDate, setIssuedDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [expiryDate, setExpiryDate] = useState(format(new Date(Date.now() + 30 * 86400000), "yyyy-MM-dd"));
  const [issueDatePopoverOpen, setIssueDatePopoverOpen] = useState(false);
  const [expiryDatePopoverOpen, setExpiryDatePopoverOpen] = useState(false);
  const [detailExpiryPopoverOpen, setDetailExpiryPopoverOpen] = useState(false);
  const [clientComboOpen, setClientComboOpen] = useState(false);
  const [formTouched, setFormTouched] = useState(false);
  const [taxRate, setTaxRate] = useState("0");
  const [discountValue, setDiscountValue] = useState("0");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<EstimateLine[]>([
    { description: "", quantity: 1, unitRate: 0 },
  ]);
  const [filters, setFilter] = useUrlFilterState({
    status: "All",
    q: "",
    sort: "number",
    dir: "desc",
  });
  const [hubFilter, setHubFilter] = useState<{ label: string } | null>(null);
  const activeTab = filters.status;
  const searchQuery = filters.q;
  const sortField = filters.sort as SortField;
  const sortDir = filters.dir as SortDir;
  const setActiveTab = (v: string) => setFilter("status", v);
  const setSearchQuery = (v: string) => setFilter("q", v, { replace: true });
  const [sendEmailOpen, setSendEmailOpen] = useState(false);
  const [sendEstimate, setSendEstimate] = useState<any>(null);
  const [convertEstimateId, setConvertEstimateId] = useState<string | null>(null);
  const [convertModalOpen, setConvertModalOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [pdfPreviewId, setPdfPreviewId] = useState<string | null>(null);
  const [detailNotes, setDetailNotes] = useState("");
  const [detailExpiryDate, setDetailExpiryDate] = useState("");
  const [detailTaxRate, setDetailTaxRate] = useState("0");
  const [detailDiscountValue, setDetailDiscountValue] = useState("0");
  const detailPanelRef = useRef<HTMLDivElement>(null);

  const { data: estimates = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/estimates"],
  });

  const { data: clients = [] } = useQuery<any[]>({
    queryKey: ["/api/clients"],
  });

  const { data: orgSettings } = useQuery<any>({
    queryKey: ["/api/org/settings"],
  });

  const { data: detailEstimate, isLoading: detailLoading } = useQuery<any>({
    queryKey: ["/api/estimates", detailId],
    enabled: !!detailId,
  });

  useEffect(() => {
    if (detailEstimate) {
      setDetailNotes(detailEstimate.notes || "");
      setDetailExpiryDate(detailEstimate.expiryDate || "");
      setDetailTaxRate(String(detailEstimate.taxRate || "0"));
      setDetailDiscountValue(String(detailEstimate.discountValue || "0"));
    }
  }, [detailEstimate]);

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/estimates", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
      setOpen(false);
      resetForm();
      toast({ title: "Estimate created" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to create estimate", description: err.message, variant: "destructive" });
    },
  });

  const sendMutation = useMutation({
    mutationFn: async (params: { id: string; emailTo?: string; emailSubject?: string; emailBody?: string }) => {
      const res = await apiRequest("POST", `/api/estimates/${params.id}/send`, {
        emailTo: params.emailTo,
        emailSubject: params.emailSubject,
        emailBody: params.emailBody,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
      setSendEmailOpen(false);
      setSendEstimate(null);
      if (data?.emailSent) {
        toast({ title: "Estimate sent", description: `Emailed to ${data.toEmail}${data.cc?.length ? ` (cc ${data.cc.length})` : ""}` });
      } else if (data?.emailError) {
        toast({ title: "Marked sent — but the email failed", description: data.emailError, variant: "destructive" });
      } else {
        toast({ title: "Estimate sent" });
      }
    },
    onError: (err: any) => {
      // apiRequest throws "NNN: <body>"; surface the human message (e.g. NO_RECIPIENT).
      let desc = typeof err?.message === "string" ? err.message : "Please try again.";
      const sep = desc.indexOf(": ");
      const rest = sep >= 0 ? desc.slice(sep + 2) : desc;
      try { const p = JSON.parse(rest); if (p?.message) desc = p.message; } catch { /* not JSON */ }
      toast({ title: "Couldn't send estimate", description: desc, variant: "destructive" });
    },
  });

  const acceptMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/estimates/${id}/accept`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
      toast({ title: "Estimate accepted" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to accept", description: err.message, variant: "destructive" });
    },
  });

  const declineMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/estimates/${id}/decline`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
      toast({ title: "Estimate declined" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to decline", description: err.message, variant: "destructive" });
    },
  });

  const openConvertModal = (id: string) => {
    setConvertEstimateId(id);
    setConvertModalOpen(true);
  };

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/estimates/${id}/duplicate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
      toast({ title: "Estimate duplicated" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to duplicate", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/estimates/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
      toast({ title: "Estimate deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to delete", description: err.message, variant: "destructive" });
    },
  });

  const updateEstimateMutation = useMutation({
    mutationFn: (data: { id: string; updates: any }) =>
      apiRequest("PATCH", `/api/estimates/${data.id}`, data.updates),
    onSuccess: (_data: any, variables: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/estimates", variables.id] });
      toast({ title: "Estimate updated" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to update", description: err.message, variant: "destructive" });
    },
  });

  function resetForm() {
    setClientId("");
    setIssuedDate(format(new Date(), "yyyy-MM-dd"));
    setExpiryDate(format(new Date(Date.now() + 30 * 86400000), "yyyy-MM-dd"));
    setTaxRate("0");
    setDiscountValue("0");
    setNotes("");
    setLines([{ description: "", quantity: 1, unitRate: 0 }]);
    setFormTouched(false);
  }

  function addLine() {
    setLines([...lines, { description: "", quantity: 1, unitRate: 0 }]);
  }

  function updateLine(idx: number, field: keyof EstimateLine, value: any) {
    const updated = [...lines];
    updated[idx] = { ...updated[idx], [field]: value };
    setLines(updated);
  }

  function removeLine(idx: number) {
    if (lines.length <= 1) return;
    setLines(lines.filter((_, i) => i !== idx));
  }

  function handleSubmit() {
    setFormTouched(true);
    const validLines = lines.filter((l) => l.description.trim());
    if (!clientId || validLines.length === 0) {
      toast({ title: "Client and at least one line required", variant: "destructive" });
      return;
    }
    createMutation.mutate({
      clientId,
      issuedDate,
      expiryDate: expiryDate || null,
      taxRate: Number(taxRate),
      discountType: Number(discountValue) > 0 ? "PERCENT" : "NONE",
      discountValue: Number(discountValue),
      notes: notes || null,
      lines: validLines,
    });
  }

  const lineTotal = lines.reduce((sum, l) => sum + l.quantity * l.unitRate, 0);

  const estimateStats = useMemo(() => {
    const totalCount = estimates.length;
    const totalValue = estimates.reduce((sum: number, e: any) => sum + Number(e.total || 0), 0);
    const pendingValue = estimates
      .filter((e: any) => e.status === "SENT" || e.status === "DRAFT")
      .reduce((sum: number, e: any) => sum + Number(e.total || 0), 0);
    const acceptedValue = estimates
      .filter((e: any) => e.status === "ACCEPTED")
      .reduce((sum: number, e: any) => sum + Number(e.total || 0), 0);
    const sentCount = estimates.filter((e: any) => ["SENT", "ACCEPTED", "DECLINED", "INVOICED"].includes(e.status)).length;
    const acceptedCount = estimates.filter((e: any) => e.status === "ACCEPTED" || e.status === "INVOICED").length;
    const conversionRate = sentCount > 0 ? Math.round((acceptedCount / sentCount) * 100) : null;
    const avgValue = totalCount > 0 ? totalValue / totalCount : 0;
    const statusCounts: Record<string, number> = { ALL: totalCount, DRAFT: 0, SENT: 0, ACCEPTED: 0, INVOICED: 0, DECLINED: 0, EXPIRED: 0 };
    estimates.forEach((e: any) => { if (statusCounts[e.status] !== undefined) statusCounts[e.status]++; });
    return { totalCount, totalValue, pendingValue, acceptedValue, conversionRate, avgValue, statusCounts };
  }, [estimates]);

  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setFilter("dir", sortDir === "asc" ? "desc" : "asc");
    } else {
      setFilter("sort", field);
      setFilter("dir", "asc");
    }
  }, [sortField, sortDir, setFilter]);

  const filteredEstimates = useMemo(() => {
    let result = [...estimates];
    if (activeTab !== "All") {
      result = result.filter((est: any) => est.status === activeTab);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (est: any) =>
          (est.number && est.number.toLowerCase().includes(q)) ||
          (est.clientName && est.clientName.toLowerCase().includes(q))
      );
    }
    result.sort((a: any, b: any) => {
      let valA: any, valB: any;
      switch (sortField) {
        case "number": valA = a.number || ""; valB = b.number || ""; break;
        case "clientName": valA = a.clientName || ""; valB = b.clientName || ""; break;
        case "status": valA = a.status || ""; valB = b.status || ""; break;
        case "issuedDate": valA = a.issuedDate || ""; valB = b.issuedDate || ""; break;
        case "expiryDate": valA = a.expiryDate || ""; valB = b.expiryDate || ""; break;
        case "total": valA = Number(a.total || 0); valB = Number(b.total || 0); break;
        default: valA = ""; valB = "";
      }
      if (typeof valA === "number") {
        return sortDir === "asc" ? valA - valB : valB - valA;
      }
      return sortDir === "asc" ? valA.localeCompare(valB) : valB.localeCompare(valA);
    });
    return result;
  }, [estimates, activeTab, searchQuery, sortField, sortDir]);

  const allChecked = filteredEstimates.length > 0 && filteredEstimates.every((e: any) => selectedIds.has(e.id));

  function toggleAll() {
    if (allChecked) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredEstimates.map((e: any) => e.id)));
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
      await apiRequest("DELETE", `/api/estimates/${id}`);
    }
    queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
    setSelectedIds(new Set());
    toast({ title: `${ids.length} estimate(s) deleted` });
  }

  function handleBulkExport() {
    const selected = estimates.filter((e: any) => selectedIds.has(e.id));
    exportEstimatesToExcel(selected, baseCurrency);
    toast({ title: `Exported ${selected.length} estimate(s)` });
  }

  function handleSaveDetailNotes() {
    if (!detailId) return;
    updateEstimateMutation.mutate({
      id: detailId,
      updates: { notes: detailNotes || null },
    });
  }

  function handleSaveDetailFields() {
    if (!detailId) return;
    updateEstimateMutation.mutate({
      id: detailId,
      updates: {
        expiryDate: detailExpiryDate || null,
        taxRate: Number(detailTaxRate),
        discountType: Number(detailDiscountValue) > 0 ? "PERCENT" : "NONE",
        discountValue: Number(detailDiscountValue),
      },
    });
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-40" />;
    return sortDir === "asc"
      ? <ArrowUp className="w-3 h-3 ml-1" />
      : <ArrowDown className="w-3 h-3 ml-1" />;
  }

  const detailClient = detailEstimate ? clients.find((c: any) => c.id === detailEstimate.clientId) : null;

  const statCards = [
    { key: "total", label: "Total Estimates", value: String(estimateStats.totalCount), sub: `${estimateStats.totalCount} total`, icon: FileCheck, color: "var(--lux-accent)", iconBg: "rgba(var(--lux-accent-rgb),0.08)", gradient: "linear-gradient(135deg, rgba(var(--lux-accent-rgb),0.08) 0%, rgba(var(--lux-accent-rgb),0.02) 100%)" },
    { key: "pending", label: "Pending Value", value: formatMoney(estimateStats.pendingValue, baseCurrency), sub: "draft & sent", icon: Clock, color: "#f59e0b", gradient: "linear-gradient(135deg, rgba(245,158,11,0.08) 0%, rgba(245,158,11,0.02) 100%)" },
    { key: "accepted", label: "Accepted Value", value: formatMoney(estimateStats.acceptedValue, baseCurrency), sub: "won proposals", icon: TrendingUp, color: "#22c55e", gradient: "linear-gradient(135deg, rgba(34,197,94,0.08) 0%, rgba(34,197,94,0.02) 100%)" },
    { key: "value", label: "Total Value", value: formatMoney(estimateStats.totalValue, baseCurrency), sub: "all estimates", icon: DollarSign, color: "#8b5cf6", gradient: "linear-gradient(135deg, rgba(139,92,246,0.08) 0%, rgba(139,92,246,0.02) 100%)" },
    { key: "rate", label: "Conversion Rate", value: estimateStats.conversionRate !== null ? `${estimateStats.conversionRate}%` : "—", sub: estimateStats.conversionRate !== null ? "accepted / total sent" : "no estimates sent yet", icon: BarChart3, color: "#3b82f6", gradient: "linear-gradient(135deg, rgba(59,130,246,0.08) 0%, rgba(59,130,246,0.02) 100%)" },
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

  return (
    <div className="flex gap-0 relative">
      <div className={`flex-1 px-6 lg:px-8 xl:px-10 py-6 space-y-6 transition-all duration-300 ${detailId ? "mr-[440px]" : ""}`}>
        <PageBreadcrumbs group="Billing" page="Estimates" />
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
                <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--lux-text)" }} data-testid="text-page-title">
                  Estimates & Proposals
                </h1>
                <PageHelpLink />
              </div>
              <p className="text-sm mt-0.5" style={{ color: "var(--lux-text-muted)" }}>
                Create and manage estimates for clients
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
                    onClick={() => exportEstimatesToExcel(filteredEstimates, baseCurrency)}
                    data-testid="button-export-estimates"
                  >
                    <Download className="w-4 h-4 mr-2" /> Export
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Export estimates to CSV/Excel</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button className="text-white shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.03]" style={{ background: "var(--gradient-brand)" }} data-testid="button-new-estimate">
                  <Plus className="w-4 h-4 mr-2" /> New Estimate
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[90vw] lg:max-w-[85vw] xl:max-w-[80vw] max-h-[90vh] overflow-y-auto p-0" style={{ background: "var(--lux-surface)" }}>
                <div className="relative px-6 pt-6 pb-4" style={{ background: "linear-gradient(135deg, rgba(var(--lux-accent-rgb),0.08) 0%, rgba(var(--lux-accent-rgb),0.02) 100%)" }}>
                  <div className="flex items-center gap-3.5">
                    <div className="relative">
                      <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(var(--lux-accent-rgb),0.18) 0%, rgba(168,85,247,0.12) 100%)" }}>
                        <FileCheck className="w-5 h-5" style={{ color: "var(--lux-accent)" }} />
                      </div>
                      <div className="absolute -inset-1.5 rounded-xl opacity-30 blur-lg -z-10" style={{ background: "radial-gradient(circle, rgba(var(--lux-accent-rgb),0.4) 0%, transparent 70%)" }} />
                    </div>
                    <div>
                      <DialogTitle className="text-lg font-bold" style={{ color: "var(--lux-text)" }}>Create Estimate</DialogTitle>
                      <p className="text-xs mt-0.5" style={{ color: "var(--lux-text-muted)" }}>Build a new estimate or proposal for your client</p>
                    </div>
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 h-px" style={{ background: "linear-gradient(90deg, var(--lux-accent), transparent 60%)", opacity: 0.25 }} />
                </div>
                <div className="px-6 pb-6">
                <div className="space-y-6">
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <FileCheck className="w-3.5 h-3.5" style={{ color: "var(--lux-accent)" }} />
                      <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Client & Dates</span>
                    </div>
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label>Client</Label>
                          <Popover open={clientComboOpen} onOpenChange={setClientComboOpen}>
                            <PopoverTrigger asChild>
                              <Button variant="outline" role="combobox" aria-expanded={clientComboOpen}
                                className="w-full justify-between h-9 text-sm font-normal"
                                style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: clientId ? "var(--lux-text)" : "var(--lux-text-muted)" }}
                                data-testid="select-estimate-client">
                                {clientId ? clients.find((c: any) => c.id === clientId)?.name || "Select client" : "Select client"}
                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-full p-0" align="start">
                              <Command>
                                <CommandInput placeholder="Search clients..." />
                                <CommandList>
                                  <CommandEmpty>No clients found.</CommandEmpty>
                                  <CommandGroup>
                                    {clients.map((c: any) => (
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
                          {formTouched && !clientId && (
                            <p className="text-[11px] mt-1 font-medium" style={{ color: "#ef4444" }}>This field is required</p>
                          )}
                        </div>
                        <div>
                          <Label>Issue Date</Label>
                          <Popover open={issueDatePopoverOpen} onOpenChange={setIssueDatePopoverOpen}>
                            <PopoverTrigger asChild>
                              <Button variant="outline" className="w-full justify-start text-left font-normal h-9 text-sm"
                                style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: issuedDate ? "var(--lux-text)" : "var(--lux-text-muted)" }}
                                data-testid="input-estimate-issue-date">
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {issuedDate ? format(new Date(issuedDate + "T00:00:00"), "MMM d, yyyy") : "Pick a date"}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar mode="single" selected={issuedDate ? new Date(issuedDate + "T00:00:00") : undefined}
                                onSelect={(day) => { if (day) { setIssuedDate(format(day, "yyyy-MM-dd")); setIssueDatePopoverOpen(false); } }} />
                            </PopoverContent>
                          </Popover>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label>Expiry Date</Label>
                          <Popover open={expiryDatePopoverOpen} onOpenChange={setExpiryDatePopoverOpen}>
                            <PopoverTrigger asChild>
                              <Button variant="outline" className="w-full justify-start text-left font-normal h-9 text-sm"
                                style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: expiryDate ? "var(--lux-text)" : "var(--lux-text-muted)" }}
                                data-testid="input-estimate-expiry-date">
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {expiryDate ? format(new Date(expiryDate + "T00:00:00"), "MMM d, yyyy") : "Pick a date"}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar mode="single" selected={expiryDate ? new Date(expiryDate + "T00:00:00") : undefined}
                                onSelect={(day) => { if (day) { setExpiryDate(format(day, "yyyy-MM-dd")); setExpiryDatePopoverOpen(false); } }} />
                            </PopoverContent>
                          </Popover>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="h-px" style={{ background: "var(--lux-border)", opacity: 0.6 }} />
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <DollarSign className="w-3.5 h-3.5" style={{ color: "#22c55e" }} />
                      <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Pricing</span>
                    </div>
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label>Tax Rate (%)</Label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium" style={{ color: "var(--lux-text-muted)" }}>%</span>
                            <Input
                              type="number"
                              step="0.01"
                              value={taxRate}
                              onChange={(e) => setTaxRate(e.target.value)}
                              className="pl-7 tabular-nums text-right h-8 text-sm"
                              style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                              data-testid="input-estimate-tax-rate"
                            />
                          </div>
                        </div>
                        <div>
                          <Label>Discount (%)</Label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium" style={{ color: "var(--lux-text-muted)" }}>%</span>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              max="100"
                              value={discountValue}
                              onChange={(e) => setDiscountValue(e.target.value)}
                              className="pl-7 tabular-nums text-right h-8 text-sm"
                              style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                              data-testid="input-estimate-discount"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="h-px" style={{ background: "var(--lux-border)", opacity: 0.6 }} />
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <FileText className="w-3.5 h-3.5" style={{ color: "#3b82f6" }} />
                      <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Additional Notes</span>
                    </div>
                    <Textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Optional notes..."
                      style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                      data-testid="input-estimate-notes"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                      <Label>Line Items</Label>
                      <Button size="sm" variant="outline" onClick={addLine} data-testid="button-add-estimate-line">
                        <Plus className="w-3 h-3 mr-1" /> Add Line
                      </Button>
                    </div>
                    <div className="space-y-2">
                      {lines.map((line, idx) => (
                        <div key={idx} className="flex gap-2 items-end">
                          <div className="flex-1">
                            <Input
                              placeholder="Description"
                              value={line.description}
                              onChange={(e) => updateLine(idx, "description", e.target.value)}
                              style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                              data-testid={`input-estimate-line-desc-${idx}`}
                            />
                          </div>
                          <div className="w-20">
                            <Input
                              type="number"
                              placeholder="Qty"
                              value={line.quantity}
                              onChange={(e) => updateLine(idx, "quantity", Number(e.target.value))}
                              style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                              data-testid={`input-estimate-line-qty-${idx}`}
                            />
                          </div>
                          <div className="w-28">
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium" style={{ color: "var(--lux-text-muted)" }}>$</span>
                              <Input
                                type="number"
                                step="0.01"
                                placeholder="Rate"
                                value={line.unitRate}
                                onChange={(e) => updateLine(idx, "unitRate", Number(e.target.value))}
                                className="pl-7 tabular-nums text-right h-8 text-sm"
                                style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                                data-testid={`input-estimate-line-rate-${idx}`}
                              />
                            </div>
                          </div>
                          <div className="w-24 text-right text-sm font-medium pt-2" data-testid={`text-estimate-line-amount-${idx}`}>
                            {formatMoney(line.quantity * line.unitRate, baseCurrency)}
                          </div>
                          {lines.length > 1 && (
                            <Button size="sm" variant="ghost" onClick={() => removeLine(idx)} data-testid={`button-remove-estimate-line-${idx}`} aria-label="Remove line item">
                              <X className="w-3 h-3" />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                    {formTouched && lines.every((l) => !l.description.trim()) && (
                      <p className="text-[11px] mt-1 font-medium" style={{ color: "#ef4444" }}>At least one line item is required</p>
                    )}
                    <div className="text-right text-sm font-bold mt-2" data-testid="text-estimate-subtotal">
                      Subtotal: {formatMoney(lineTotal, baseCurrency)}
                    </div>
                  </div>
                  <Button
                    className="w-full text-white shadow-lg hover:shadow-xl transition-all duration-200 hover:scale-[1.03]"
                    style={{ background: "var(--gradient-brand)" }}
                    onClick={handleSubmit}
                    disabled={createMutation.isPending}
                    data-testid="button-submit-estimate"
                  >
                    {createMutation.isPending ? "Creating..." : "Create Estimate"}
                  </Button>
                </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="h-px w-full" style={{ background: "linear-gradient(90deg, var(--lux-accent), transparent 60%)", opacity: 0.3 }} />

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4" data-testid="estimate-stats-row">
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
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center transition-transform duration-300 group-hover:scale-110" style={{ background: (sc as any).iconBg || `${sc.color}15` }}>
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

        <div className="flex items-center gap-1.5 flex-wrap rounded-xl p-1.5" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }} data-testid="filter-status-tabs">
          {["ALL", "DRAFT", "SENT", "ACCEPTED", "INVOICED", "DECLINED", "EXPIRED"].map(s => {
            const Icon = STATUS_ICONS[s];
            const active = activeTab === (s === "ALL" ? "All" : s);
            const cnt = estimateStats.statusCounts[s] ?? 0;
            const col = STATUS_COLORS[s] || "var(--lux-accent)";
            return (
              <button
                key={s}
                onClick={() => { setActiveTab(s === "ALL" ? "All" : s); setSelectedIds(new Set()); setHubFilter(null); }}
                className="relative flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all duration-200 hover:scale-[1.02]"
                style={{
                  background: active ? `${col}15` : "transparent",
                  color: active ? col : "var(--lux-text-muted)",
                  boxShadow: active ? `0 0 0 1px ${col}30, 0 1px 3px ${col}10` : "none",
                }}
                data-testid={`button-filter-${s.toLowerCase()}`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{STATUS_LABELS[s]}</span>
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

        {(() => {
          const chips: FilterChipDescriptor[] = [];
          if (activeTab !== "All" && activeTab !== "ALL") {
            chips.push({
              id: "hub-filter",
              label: hubFilter?.label || `Status: ${STATUS_LABELS[activeTab] || activeTab}`,
              onClear: () => { setActiveTab("All"); setHubFilter(null); },
            });
          }
          if (searchQuery) {
            chips.push({
              id: "search",
              label: `Search: "${searchQuery}"`,
              onClear: () => setSearchQuery(""),
            });
          }
          return <ActiveFilterBar chips={chips} />;
        })()}

        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--lux-text-muted)" }} />
          <Input
            placeholder="Search by estimate number or client..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 text-sm"
            style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
            data-testid="input-search-estimates"
          />
        </div>

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
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="destructive" data-testid="button-bulk-delete">
                    <Trash2 className="w-3 h-3 mr-1" /> Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {selectedIds.size} Estimate(s)</AlertDialogTitle>
                    <AlertDialogDescription>
                      This action cannot be undone. All selected estimates and their line items will be permanently deleted.
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

        <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
          <CardContent className="p-4">
            {filteredEstimates.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
                  style={{ background: "var(--lux-bg)" }}
                >
                  <FileCheck className="w-8 h-8" style={{ color: "var(--lux-text-muted)" }} />
                </div>
                <h3 className="text-lg font-semibold mb-1" style={{ color: "var(--lux-text)" }}>
                  {estimates.length === 0 ? "No estimates yet" : "No estimates match your filters"}
                </h3>
                <p className="text-sm mb-4" style={{ color: "var(--lux-text-muted)" }}>
                  {estimates.length === 0 ? "Create your first estimate to get started with client proposals" : "Try adjusting your search or status filter"}
                </p>
                {estimates.length === 0 && (
                  <Button onClick={() => setOpen(true)} data-testid="button-empty-create">
                    <Plus className="w-4 h-4 mr-2" /> Create Estimate
                  </Button>
                )}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allChecked}
                        onCheckedChange={toggleAll}
                        aria-label="Select all estimates"
                        data-testid="checkbox-select-all"
                      />
                    </TableHead>
                    <TableHead>
                      <button className="flex items-center text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }} onClick={() => handleSort("number")} data-testid="sort-number">
                        Number <SortIcon field="number" />
                      </button>
                    </TableHead>
                    <TableHead>
                      <button className="flex items-center text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }} onClick={() => handleSort("clientName")} data-testid="sort-client">
                        Client <SortIcon field="clientName" />
                      </button>
                    </TableHead>
                    <TableHead>
                      <button className="flex items-center text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }} onClick={() => handleSort("status")} data-testid="sort-status">
                        Status <SortIcon field="status" />
                      </button>
                    </TableHead>
                    <TableHead>
                      <button className="flex items-center text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }} onClick={() => handleSort("issuedDate")} data-testid="sort-issued">
                        Issued <SortIcon field="issuedDate" />
                      </button>
                    </TableHead>
                    <TableHead>
                      <button className="flex items-center text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }} onClick={() => handleSort("expiryDate")} data-testid="sort-expiry">
                        Expiry <SortIcon field="expiryDate" />
                      </button>
                    </TableHead>
                    <TableHead className="text-right">
                      <button className="flex items-center text-[11px] font-semibold uppercase tracking-wider ml-auto" style={{ color: "var(--lux-text-muted)" }} onClick={() => handleSort("total")} data-testid="sort-total">
                        Total <SortIcon field="total" />
                      </button>
                    </TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEstimates.map((est: any) => {
                    const expiryBadge = (est.status === "SENT" || est.status === "DRAFT") ? getExpiryBadge(est.expiryDate) : null;
                    const isSelected = selectedIds.has(est.id);
                    const isActive = detailId === est.id;
                    return (
                      <TableRow
                        key={est.id}
                        className={`cursor-pointer transition-colors ${isActive ? "ring-1 ring-inset" : ""}`}
                        style={{
                          background: isActive ? "var(--lux-bg)" : undefined,
                          borderLeftWidth: isActive ? "3px" : undefined,
                          borderLeftColor: isActive ? STATUS_COLORS[est.status] || "#8b5cf6" : undefined,
                        }}
                        onClick={() => setDetailId(est.id === detailId ? null : est.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.target !== e.currentTarget) return; if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDetailId(est.id === detailId ? null : est.id); } }}
                        data-testid={`row-estimate-${est.id}`}
                      >
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleOne(est.id)}
                            aria-label="Select estimate"
                            data-testid={`checkbox-estimate-${est.id}`}
                          />
                        </TableCell>
                        <TableCell className="font-sans tabular-nums text-sm font-medium" data-testid={`text-estimate-number-${est.id}`}>
                          {est.number}
                        </TableCell>
                        <TableCell data-testid={`text-estimate-client-${est.id}`}>
                          {est.clientName}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 flex-wrap">
                            <StatusBadge status={est.status} />
                            {expiryBadge}
                          </div>
                        </TableCell>
                        <TableCell><DateDisplay value={est.issuedDate} /></TableCell>
                        <TableCell><DateDisplay value={est.expiryDate} /></TableCell>
                        <TableCell className="text-right" data-testid={`text-estimate-total-${est.id}`}>
                          <MoneyDisplay currency={baseCurrency} value={est.total} color="neutral" size="sm" />
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1">
                            {est.status === "ACCEPTED" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs gap-1"
                                style={{ color: "var(--lux-accent)" }}
                                onClick={() => openConvertModal(est.id)}
                                title="Convert to Invoice"
                                data-testid={`button-convert-${est.id}`}
                              >
                                <FileText className="w-3.5 h-3.5" /> Convert
                              </Button>
                            )}
                            <ChevronRight className="w-4 h-4" style={{ color: "var(--lux-text-muted)", transform: isActive ? "rotate(90deg)" : undefined, transition: "transform 0.2s" }} />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {detailId && (
        <div
          ref={detailPanelRef}
          className="fixed right-0 top-0 bottom-0 w-[440px] border-l overflow-y-auto z-40 animate-in slide-in-from-right-8 duration-300"
          style={{
            background: "var(--lux-surface)",
            borderColor: "var(--lux-border)",
          }}
          data-testid="detail-panel"
        >
          <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b"
            style={{
              background: "var(--lux-surface)",
              borderColor: "var(--lux-border)",
            }}
          >
            <h2 className="font-bold text-lg" style={{ color: "var(--lux-text)" }}>
              {detailEstimate?.number || "Loading..."}
            </h2>
            <div className="flex items-center gap-1">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="sm" variant="ghost" onClick={() => setPdfPreviewId(detailId)} data-testid="button-detail-pdf" aria-label="Preview PDF">
                      <Eye className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Preview PDF</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              {detailEstimate?.publicToken && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          navigator.clipboard.writeText(`${window.location.origin}/e/${detailEstimate.publicToken}`);
                          toast({ title: "Public link copied" });
                        }}
                        data-testid="button-detail-copy-link"
                        aria-label="Copy public link"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Copy public link</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              <Button size="sm" variant="ghost" onClick={() => setDetailId(null)} data-testid="button-close-detail" aria-label="Close detail panel">
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {detailLoading ? (
            <div className="p-5 space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-8 rounded animate-pulse" style={{ background: "var(--lux-bg)" }} />
              ))}
            </div>
          ) : detailEstimate ? (
            <div className="p-5 space-y-5">
              <div className="flex items-center gap-2 flex-wrap">
                <StatusBadge status={detailEstimate.status} />
                {(detailEstimate.status === "SENT" || detailEstimate.status === "DRAFT") && getExpiryBadge(detailEstimate.expiryDate)}
              </div>

              <div className="space-y-3">
                <div>
                  <span className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Client</span>
                  <p className="font-semibold" style={{ color: "var(--lux-text)" }}>{detailEstimate.clientName}</p>
                  {(detailClient?.email || detailEstimate.clientEmail) && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <Mail className="w-3 h-3" style={{ color: "var(--lux-text-muted)" }} />
                      <span className="text-xs" style={{ color: "var(--lux-text-muted)" }}>{detailClient?.email || detailEstimate.clientEmail}</span>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              className="ml-1 hover:opacity-70"
                              onClick={() => {
                                navigator.clipboard.writeText(detailClient?.email || detailEstimate.clientEmail || "");
                                toast({ title: "Email copied" });
                              }}
                              data-testid="button-copy-client-email"
                              aria-label="Copy email"
                            >
                              <Copy className="w-3 h-3" style={{ color: "var(--lux-text-muted)" }} />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>Copy email</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Issued</span>
                    <p className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>
                      <DateDisplay value={detailEstimate.issuedDate} />
                    </p>
                  </div>
                  <div>
                    <span className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Expiry</span>
                    {(detailEstimate.status === "DRAFT" || detailEstimate.status === "SENT") ? (
                      <Popover open={detailExpiryPopoverOpen} onOpenChange={setDetailExpiryPopoverOpen}>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="w-full justify-start text-left font-normal h-8 text-sm mt-0.5"
                            style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: detailExpiryDate ? "var(--lux-text)" : "var(--lux-text-muted)" }}
                            data-testid="input-detail-expiry">
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {detailExpiryDate ? format(new Date(detailExpiryDate + "T00:00:00"), "MMM d, yyyy") : "Pick a date"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar mode="single" selected={detailExpiryDate ? new Date(detailExpiryDate + "T00:00:00") : undefined}
                            onSelect={(day) => { if (day) { setDetailExpiryDate(format(day, "yyyy-MM-dd")); setDetailExpiryPopoverOpen(false); } }} />
                        </PopoverContent>
                      </Popover>
                    ) : (
                      <p className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>
                        <DateDisplay value={detailEstimate.expiryDate} />
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div
                className="rounded-lg p-4 space-y-2"
                style={{ background: "var(--lux-bg)" }}
              >
                <span className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Line Items</span>
                {(detailEstimate.lines || []).map((line: any, idx: number) => (
                  <div key={line.id || idx} className="flex justify-between items-center text-sm py-1" style={{ borderBottom: idx < (detailEstimate.lines || []).length - 1 ? "1px solid var(--lux-border)" : "none" }}>
                    <div className="flex-1 min-w-0 pr-2">
                      <span className="font-medium" style={{ color: "var(--lux-text)" }}>{line.description}</span>
                      <span className="text-xs ml-2" style={{ color: "var(--lux-text-muted)" }}>
                        {Number(line.quantity)} × {formatMoney(Number(line.unitRate), baseCurrency)}
                      </span>
                    </div>
                    <span className="font-semibold tabular-nums whitespace-nowrap" style={{ color: "var(--lux-text)" }}>
                      {formatMoney(Number(line.amount), baseCurrency)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span style={{ color: "var(--lux-text-muted)" }}>Subtotal</span>
                  <span className="font-medium tabular-nums" style={{ color: "var(--lux-text)" }}>{formatMoney(Number(detailEstimate.subtotal || 0), baseCurrency)}</span>
                </div>
                {Number(detailEstimate.discountAmount || 0) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span style={{ color: "var(--lux-text-muted)" }}>
                      Discount {detailEstimate.discountType === "PERCENT" ? `(${detailEstimate.discountValue}%)` : ""}
                    </span>
                    <span className="font-medium text-red-500 tabular-nums">-{formatMoney(Number(detailEstimate.discountAmount), baseCurrency)}</span>
                  </div>
                )}
                {Number(detailEstimate.taxAmount || 0) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span style={{ color: "var(--lux-text-muted)" }}>Tax ({detailEstimate.taxRate}%)</span>
                    <span className="font-medium tabular-nums" style={{ color: "var(--lux-text)" }}>{formatMoney(Number(detailEstimate.taxAmount), baseCurrency)}</span>
                  </div>
                )}
                <div className="flex justify-between pt-2 border-t" style={{ borderColor: "var(--lux-border)" }}>
                  <span className="font-bold" style={{ color: "var(--lux-text)" }}>Total</span>
                  <span className="font-bold text-lg tabular-nums" style={{ color: "var(--lux-accent)" }}>
                    {formatMoney(Number(detailEstimate.total || 0), baseCurrency)}
                  </span>
                </div>
              </div>

              {(detailEstimate.status === "DRAFT" || detailEstimate.status === "SENT") && (
                <div className="space-y-3 rounded-lg p-4 border" style={{ borderColor: "var(--lux-border)" }}>
                  <span className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Edit Pricing</span>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Tax Rate (%)</Label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium" style={{ color: "var(--lux-text-muted)" }}>%</span>
                        <Input
                          type="number"
                          step="0.01"
                          value={detailTaxRate}
                          onChange={(e) => setDetailTaxRate(e.target.value)}
                          className="pl-7 tabular-nums text-right h-8 text-sm"
                          style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                          data-testid="input-detail-tax"
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Discount (%)</Label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium" style={{ color: "var(--lux-text-muted)" }}>%</span>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          value={detailDiscountValue}
                          onChange={(e) => setDetailDiscountValue(e.target.value)}
                          className="pl-7 tabular-nums text-right h-8 text-sm"
                          style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                          data-testid="input-detail-discount"
                        />
                      </div>
                    </div>
                  </div>
                  <Button size="sm" onClick={handleSaveDetailFields} disabled={updateEstimateMutation.isPending} data-testid="button-save-detail-pricing">
                    <Save className="w-3 h-3 mr-1" /> Save Changes
                  </Button>
                </div>
              )}

              <div className="space-y-2">
                <span className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Notes</span>
                <Textarea
                  value={detailNotes}
                  onChange={(e) => setDetailNotes(e.target.value)}
                  placeholder="Add notes to this estimate..."
                  className="min-h-[80px] text-sm"
                  style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                  data-testid="input-detail-notes"
                />
                <Button size="sm" variant="outline" onClick={handleSaveDetailNotes} disabled={updateEstimateMutation.isPending} data-testid="button-save-detail-notes">
                  <Save className="w-3 h-3 mr-1" /> Save Notes
                </Button>
              </div>

              <div className="space-y-2 pt-3 border-t" style={{ borderColor: "var(--lux-border)" }}>
                <span className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Actions</span>
                <div className="flex flex-wrap gap-2">
                  {detailEstimate.status === "DRAFT" && (
                    <Button
                      size="sm"
                      onClick={() => { setSendEstimate(detailEstimate); setSendEmailOpen(true); }}
                      disabled={sendMutation.isPending}
                      data-testid={`button-send-estimate-${detailEstimate.id}`}
                    >
                      <Send className="w-3 h-3 mr-1" /> Send
                    </Button>
                  )}
                  {detailEstimate.status === "SENT" && (
                    <>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="outline" disabled={acceptMutation.isPending} data-testid={`button-accept-estimate-${detailEstimate.id}`}>
                            <Check className="w-3 h-3 mr-1" /> Accept
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Accept Estimate</AlertDialogTitle>
                            <AlertDialogDescription>Accept Estimate #{detailEstimate.number}?</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => acceptMutation.mutate(detailEstimate.id)}>Accept</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="outline" disabled={declineMutation.isPending} data-testid={`button-decline-estimate-${detailEstimate.id}`}>
                            <X className="w-3 h-3 mr-1" /> Decline
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Decline Estimate</AlertDialogTitle>
                            <AlertDialogDescription>Decline Estimate #{detailEstimate.number}?</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => declineMutation.mutate(detailEstimate.id)} className="bg-red-600 hover:bg-red-700">Decline</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </>
                  )}
                  {detailEstimate.status === "ACCEPTED" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openConvertModal(detailEstimate.id)}
                      data-testid={`button-convert-estimate-${detailEstimate.id}`}
                    >
                      <FileText className="w-3 h-3 mr-1" /> Convert to Invoice
                    </Button>
                  )}
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => duplicateMutation.mutate(detailEstimate.id)}
                          disabled={duplicateMutation.isPending}
                          data-testid={`button-duplicate-estimate-${detailEstimate.id}`}
                        >
                          <Copy className="w-3 h-3 mr-1" /> Duplicate
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Create a copy of this estimate</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setPdfPreviewId(detailEstimate.id)}
                          data-testid={`button-pdf-estimate-${detailEstimate.id}`}
                        >
                          <Download className="w-3 h-3 mr-1" /> PDF
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Download or preview PDF</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="destructive" data-testid={`button-delete-estimate-${detailEstimate.id}`}>
                        <Trash2 className="w-3 h-3 mr-1" /> Delete
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Estimate</AlertDialogTitle>
                        <AlertDialogDescription>Permanently delete estimate #{detailEstimate.number}? This cannot be undone.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => {
                            deleteMutation.mutate(detailEstimate.id);
                            setDetailId(null);
                          }}
                          className="bg-red-600 hover:bg-red-700"
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {pdfPreviewId && (
        <Dialog open={!!pdfPreviewId} onOpenChange={() => setPdfPreviewId(null)}>
          <DialogContent className="sm:max-w-[90vw] lg:max-w-[85vw] xl:max-w-[80vw] h-[85vh] p-0 overflow-hidden">
            <DialogHeader className="px-6 pt-5 pb-3 border-b" style={{ borderColor: "var(--lux-border)" }}>
              <DialogTitle className="flex items-center justify-between">
                <span>Estimate PDF Preview</span>
                <a
                  href={`/api/estimates/${pdfPreviewId}/pdf`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-normal underline"
                  style={{ color: "var(--lux-accent)" }}
                  data-testid="link-download-pdf"
                >
                  Download PDF
                </a>
              </DialogTitle>
            </DialogHeader>
            <div className="flex-1 h-full pb-4 px-2">
              <iframe
                src={`/api/estimates/${pdfPreviewId}/pdf`}
                className="w-full h-full rounded-lg border"
                style={{ borderColor: "var(--lux-border)", minHeight: "70vh" }}
                title="Estimate PDF"
                data-testid="iframe-pdf-preview"
              />
            </div>
          </DialogContent>
        </Dialog>
      )}

      {sendEstimate && (
        <SendEmailModal
          open={sendEmailOpen}
          onClose={() => { setSendEmailOpen(false); setSendEstimate(null); }}
          onSend={(emailData) => {
            sendMutation.mutate({
              id: sendEstimate.id,
              emailTo: emailData.to,
              emailSubject: emailData.subject,
              emailBody: emailData.body,
            });
          }}
          isPending={sendMutation.isPending}
          type="estimate"
          number={sendEstimate.number}
          clientName={sendEstimate.clientName || ""}
          clientEmail={sendEstimate.clientEmail || clients.find((c: any) => c.id === sendEstimate.clientId)?.email || ""}
          clientId={sendEstimate.clientId}
          orgName={orgSettings?.name || "Cherry Street Consulting"}
          total={String(sendEstimate.total)}
          expiryDate={sendEstimate.expiryDate}
          currency={baseCurrency}
        />
      )}

      <ConvertToInvoiceModal
        estimateId={convertEstimateId}
        open={convertModalOpen}
        onOpenChange={(v) => { setConvertModalOpen(v); if (!v) setConvertEstimateId(null); }}
        baseCurrency={baseCurrency}
        onConverted={() => setDetailId(null)}
      />
    </div>
  );
}
