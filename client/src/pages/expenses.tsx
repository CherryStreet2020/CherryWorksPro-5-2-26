import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useUrlFilterState } from "@/lib/use-url-filter-state";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, getCSRFToken } from "@/lib/queryClient";
import { PageHelpLink } from "@/components/page-help-link";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { isValidInternalUrl } from "@/lib/url-validation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Plus, Receipt, DollarSign, Clock, CheckCircle, XCircle,
  Send, Filter, ChevronDown, ChevronUp, ChevronsUpDown, ChevronLeft, ChevronRight,
  Pencil, Trash2, Eye, FileDown, Upload, Link, X, BookOpen, Loader2, Sparkles,
  TrendingUp, AlertCircle, Wallet, Calculator, Search, Download, GripVertical,
  FileText, ZoomIn, ExternalLink, StickyNote, Tag, FolderOpen, ToggleLeft,
  ImageIcon, AlertTriangle,
} from "lucide-react";
import { formatMoney, formatDate } from "@/components/shared/format";
import { useBaseCurrency } from "@/hooks/use-base-currency";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { ActiveFilterBar, type FilterChipDescriptor } from "@/components/active-filter-chip";
import { useDocumentTitle } from "@/lib/use-document-title";

const STATUS_COLORS: Record<string, string> = {
  ALL: "#8b5cf6",
  DRAFT: "#6b7280",
  SUBMITTED: "#3b82f6",
  APPROVED: "#22c55e",
  REJECTED: "#ef4444",
  REIMBURSED: "#a855f7",
};

function ExpenseStatusBadge({ status }: { status: string }) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
      style={{ background: `${STATUS_COLORS[status] || "#6b7280"}15`, color: STATUS_COLORS[status] || "#6b7280" }}
    >
      {status}
    </span>
  );
}

export default function ExpensesPage() {
  useDocumentTitle("Expenses");
  const { user } = useAuth();
  const baseCurrency = useBaseCurrency();
  const { toast } = useToast();
  const isAdmin = user?.role === "ADMIN";
  const canManage = user?.role === "ADMIN" || user?.role === "MANAGER";

  const [showCreate, setShowCreate] = useState(false);
  const [editingExpense, setEditingExpense] = useState<any>(null);
  const [viewExpense, setViewExpense] = useState<any>(null);
  const [expFilters, setExpFilter] = useUrlFilterState({ status: "ALL", q: "" });
  const filterStatus = expFilters.status;
  const setFilterStatus = (v: string) => setExpFilter("status", v);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [receiptZoomUrl, setReceiptZoomUrl] = useState<string | null>(null);
  const [receiptDragOver, setReceiptDragOver] = useState(false);
  const [bundleDialogOpen, setBundleDialogOpen] = useState(false);
  const [bundleTitle, setBundleTitle] = useState("");
  const [bundlePurpose, setBundlePurpose] = useState("");

  const [formAmount, setFormAmount] = useState("");
  const [formSubtotal, setFormSubtotal] = useState("");
  const [formTaxAmount, setFormTaxAmount] = useState("");
  const [formTipAmount, setFormTipAmount] = useState("");
  const [formCurrency, setFormCurrency] = useState("USD");
  const [formPaymentMethod, setFormPaymentMethod] = useState("");
  const [formDate, setFormDate] = useState(new Date().toISOString().split("T")[0]);
  const [formVendor, setFormVendor] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formCategoryId, setFormCategoryId] = useState<string>("");
  const [formProjectId, setFormProjectId] = useState<string>("");
  const [formBillable, setFormBillable] = useState(false);
  const [formReimbursable, setFormReimbursable] = useState(true);
  const [formReceipts, setFormReceipts] = useState<{ url: string; filename: string }[]>([]);
  const [formNotes, setFormNotes] = useState("");
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [scanningReceipt, setScanningReceipt] = useState(false);
  const [scanLineItems, setScanLineItems] = useState<{ description: string; quantity: number; unitPrice: number; amount: number }[]>([]);
  const [showLineItems, setShowLineItems] = useState(false);
  const [totalOverridden, setTotalOverridden] = useState(false);

  const { data: expenseList, isLoading } = useQuery<any[]>({
    queryKey: [canManage ? "/api/expenses" : "/api/my/expenses"],
  });

  const { data: categories } = useQuery<any[]>({
    queryKey: ["/api/expense-categories"],
  });

  const { data: allProjects } = useQuery<any[]>({
    queryKey: canManage ? ["/api/projects"] : ["/api/time-entries/my-projects"],
  });

  const { data: orgSettings } = useQuery<any>({
    queryKey: ["/api/org/settings"],
  });

  const autoPostEnabled = orgSettings?.autoPostJournalEntries ?? false;
  const [glPostedIds, setGlPostedIds] = useState<Set<string>>(new Set());

  const postGlMutation = useMutation({
    mutationFn: async (expenseId: string) => {
      const res = await apiRequest("POST", `/api/expenses/${expenseId}/post-gl`);
      return { ...(await res.json()), expenseId };
    },
    onSuccess: (data: any) => {
      setGlPostedIds(prev => new Set([...prev, data.expenseId]));
      queryClient.invalidateQueries({ queryKey: ["/api/gl/journal-entries"] });
      toast({ title: "Posted to GL", description: data.message });
    },
    onError: (err: any) => {
      toast({ title: "GL posting failed", description: err.message, variant: "destructive" });
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!formCategoryId || formCategoryId === "none") {
        throw new Error("Category is required");
      }
      const primaryReceipt = formReceipts[0];
      const additionalReceipts = formReceipts.slice(1);
      await apiRequest("POST", "/api/expenses", {
        amount: parseFloat(formAmount) || 0,
        date: formDate,
        vendor: formVendor || undefined,
        description: formDescription || undefined,
        categoryId: formCategoryId,
        projectId: formProjectId && formProjectId !== "none" ? formProjectId : null,
        billable: formBillable,
        reimbursable: formReimbursable,
        currency: formCurrency || "USD",
        receiptUrl: primaryReceipt?.url || null,
        receiptFilename: primaryReceipt?.filename || null,
        additionalReceiptUrls: additionalReceipts.length > 0 ? JSON.stringify(additionalReceipts) : null,
        notes: formNotes || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [canManage ? "/api/expenses" : "/api/my/expenses"] });
      resetForm();
      setShowCreate(false);
      toast({ title: "Expense created" });
    },
    onError: (err: Error) => { toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const primaryReceipt = formReceipts[0];
      const additionalReceipts = formReceipts.slice(1);
      await apiRequest("PATCH", `/api/expenses/${editingExpense.id}`, {
        amount: parseFloat(formAmount) || 0,
        date: formDate,
        vendor: formVendor || undefined,
        description: formDescription || undefined,
        categoryId: formCategoryId && formCategoryId !== "none" ? formCategoryId : null,
        projectId: formProjectId && formProjectId !== "none" ? formProjectId : null,
        billable: formBillable,
        reimbursable: formReimbursable,
        currency: formCurrency || "USD",
        receiptUrl: primaryReceipt?.url || null,
        receiptFilename: primaryReceipt?.filename || null,
        additionalReceiptUrls: additionalReceipts.length > 0 ? JSON.stringify(additionalReceipts) : null,
        notes: formNotes || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [canManage ? "/api/expenses" : "/api/my/expenses"] });
      resetForm();
      setEditingExpense(null);
      toast({ title: "Expense updated" });
    },
    onError: (err: Error) => { toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/expenses/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [canManage ? "/api/expenses" : "/api/my/expenses"] });
      toast({ title: "Expense deleted" });
    },
    onError: (err: Error) => { toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  const submitMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("POST", `/api/expenses/${id}/submit`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [canManage ? "/api/expenses" : "/api/my/expenses"] });
      toast({ title: "Expense submitted for approval" });
    },
    onError: (err: Error) => { toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("POST", `/api/expenses/${id}/approve`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      toast({ title: "Expense approved" });
    },
    onError: (err: Error) => { toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  const rejectMutation = useMutation({
    mutationFn: async () => { await apiRequest("POST", `/api/expenses/${rejectId}/reject`, { reason: rejectReason }); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      setRejectId(null);
      setRejectReason("");
      toast({ title: "Expense rejected" });
    },
    onError: (err: Error) => { toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  const reimburseMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("POST", `/api/expenses/${id}/reimburse`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      toast({ title: "Expense marked as reimbursed" });
    },
    onError: (err: Error) => { toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  const bundleMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/expense-reports", {
        title: bundleTitle,
        description: bundlePurpose || undefined,
        expenseIds: Array.from(gridSelectedIds),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [canManage ? "/api/expenses" : "/api/my/expenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/expense-reports"] });
      setGridSelectedIds(new Set());
      setBundleDialogOpen(false);
      setBundleTitle("");
      setBundlePurpose("");
      toast({ title: "Expense report created" });
    },
    onError: (err: Error) => { toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  useEffect(() => {
    if (totalOverridden) return;
    const sub = parseFloat(formSubtotal) || 0;
    const tax = parseFloat(formTaxAmount) || 0;
    const tip = parseFloat(formTipAmount) || 0;
    const calc = sub + tax + tip;
    if (calc > 0) {
      setFormAmount(calc.toFixed(2));
    } else if (formSubtotal === "" && formTaxAmount === "" && formTipAmount === "") {
      setFormAmount("");
    }
  }, [formSubtotal, formTaxAmount, formTipAmount, totalOverridden]);

  function resetForm() {
    setFormAmount("");
    setFormSubtotal("");
    setFormTaxAmount("");
    setFormTipAmount("");
    setFormCurrency("USD");
    setFormPaymentMethod("");
    setFormDate(new Date().toISOString().split("T")[0]);
    setFormVendor("");
    setFormDescription("");
    setFormCategoryId("");
    setFormProjectId("");
    setFormBillable(false);
    setFormReimbursable(true);
    setFormReceipts([]);
    setUploadingReceipt(false);
    setFormNotes("");
    setScanLineItems([]);
    setShowLineItems(false);
    setTotalOverridden(false);
  }

  function openEdit(exp: any) {
    setFormAmount(String(exp.amount));
    setFormDate(exp.date);
    setFormVendor(exp.vendor || "");
    setFormDescription(exp.description || "");
    setFormCategoryId(exp.categoryId || "");
    setFormProjectId(exp.projectId || "");
    setFormBillable(exp.billable);
    setFormReimbursable(exp.reimbursable);
    const receipts: { url: string; filename: string }[] = [];
    if (exp.receiptUrl) receipts.push({ url: exp.receiptUrl, filename: exp.receiptFilename || "Receipt" });
    if (exp.additionalReceiptUrls) {
      try { receipts.push(...JSON.parse(exp.additionalReceiptUrls)); } catch {}
    }
    setFormReceipts(receipts);
    setFormNotes(exp.notes || "");
    setFormSubtotal("");
    setFormTaxAmount("");
    setFormTipAmount("");
    setFormCurrency(exp.currency || "USD");
    setFormPaymentMethod("");
    setScanLineItems([]);
    setShowLineItems(false);
    setTotalOverridden(true);
    setEditingExpense(exp);
  }

  const filtered = (expenseList || []).filter(e => filterStatus === "ALL" || e.status === filterStatus);

  const totalAmount = filtered.reduce((s, e) => s + e.amount, 0);
  const pendingCount = (expenseList || []).filter(e => e.status === "SUBMITTED").length;
  const draftCount = (expenseList || []).filter(e => e.status === "DRAFT").length;

  const luxStats = useMemo(() => {
    const all = expenseList || [];
    const totalAll = all.reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0);
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const thisMonthSum = all.filter((e: any) => (e.date || "").startsWith(monthKey)).reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0);
    const reimbursableSum = all.filter((e: any) => e.reimbursable && e.status !== "REIMBURSED").reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0);
    const avgExpense = all.length > 0 ? totalAll / all.length : 0;
    const statusCounts: Record<string, number> = { ALL: all.length, DRAFT: 0, SUBMITTED: 0, APPROVED: 0, REJECTED: 0, REIMBURSED: 0 };
    all.forEach((e: any) => { if (statusCounts[e.status] !== undefined) statusCounts[e.status]++; });
    return { totalAll, thisMonthSum, reimbursableSum, avgExpense, statusCounts };
  }, [expenseList]);

  type SortDir = "asc" | "desc";
  type SortSpec = { col: string; dir: SortDir };
  type ExpColumnFilter = {
    vendor?: string;
    description?: string;
    dateFrom?: string;
    dateTo?: string;
    amountMin?: string;
    amountMax?: string;
    status?: string;
    category?: string;
  };

  const EXP_COL_ORDER_KEY = "cw-exp-col-order";
  const defaultExpCols = ["select", "date", ...(canManage ? ["submittedBy"] : []), "vendor", "category", "project", "amount", "status", "flags", "actions"];
  const [gridSorts, setGridSorts] = useState<SortSpec[]>([]);
  const [gridColFilters, setGridColFilters] = useState<ExpColumnFilter>({});
  const [gridOpenFilter, setGridOpenFilter] = useState<string | null>(null);
  const [gridPage, setGridPage] = useState(0);
  const [gridPageSize, setGridPageSize] = useState(25);
  const gridSearchQuery = expFilters.q;
  const setGridSearchQuery = (v: string) => setExpFilter("q", v, { replace: true });
  const [gridColumnOrder, setGridColumnOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(EXP_COL_ORDER_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    return defaultExpCols;
  });
  const [gridColumnWidths, setGridColumnWidths] = useState<Record<string, number>>({});
  const [gridDragCol, setGridDragCol] = useState<string | null>(null);
  const [gridSelectedIds, setGridSelectedIds] = useState<Set<string>>(new Set());
  const resizingRef = useRef<{ col: string; startX: number; startW: number } | null>(null);

  useEffect(() => {
    try { localStorage.setItem(EXP_COL_ORDER_KEY, JSON.stringify(gridColumnOrder)); } catch {}
  }, [gridColumnOrder]);

  useEffect(() => {
    if (!gridOpenFilter) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-grid-filter-popup]") && !target.closest(`[data-testid="grid-filter-${gridOpenFilter}"]`)) {
        setGridOpenFilter(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [gridOpenFilter]);

  const gridFiltered = useMemo(() => {
    let result = filtered;
    if (gridSearchQuery) {
      const q = gridSearchQuery.toLowerCase();
      result = result.filter((e: any) => {
        const fields = [e.vendor || "", e.description || "", e.categoryName || "", e.projectName || "", e.date || "", String(e.amount), e.status || "", e.userName || ""];
        return fields.some(f => f.toLowerCase().includes(q));
      });
    }
    const cf = gridColFilters;
    result = result.filter((e: any) => {
      if (cf.vendor && !(e.vendor || "").toLowerCase().includes(cf.vendor.toLowerCase())) return false;
      if (cf.description && !(e.description || "").toLowerCase().includes(cf.description.toLowerCase())) return false;
      if (cf.dateFrom && e.date < cf.dateFrom) return false;
      if (cf.dateTo && e.date > cf.dateTo) return false;
      if (cf.amountMin && Number(e.amount) < Number(cf.amountMin)) return false;
      if (cf.amountMax && Number(e.amount) > Number(cf.amountMax)) return false;
      if (cf.status && cf.status !== "ALL" && e.status !== cf.status) return false;
      if (cf.category && !(e.categoryName || "").toLowerCase().includes(cf.category.toLowerCase())) return false;
      return true;
    });
    if (gridSorts.length > 0) {
      result = [...result].sort((a: any, b: any) => {
        for (const s of gridSorts) {
          let cmp = 0;
          if (s.col === "date") cmp = (a.date || "").localeCompare(b.date || "");
          else if (s.col === "vendor") cmp = (a.vendor || "").localeCompare(b.vendor || "");
          else if (s.col === "description") cmp = (a.description || "").localeCompare(b.description || "");
          else if (s.col === "amount") cmp = Number(a.amount) - Number(b.amount);
          else if (s.col === "status") cmp = (a.status || "").localeCompare(b.status || "");
          else if (s.col === "category") cmp = (a.categoryName || "").localeCompare(b.categoryName || "");
          else if (s.col === "project") cmp = (a.projectName || "").localeCompare(b.projectName || "");
          else if (s.col === "submittedBy") cmp = (a.userName || "").localeCompare(b.userName || "");
          if (cmp !== 0) return s.dir === "desc" ? -cmp : cmp;
        }
        return 0;
      });
    }
    return result;
  }, [filtered, gridSearchQuery, gridColFilters, gridSorts]);

  const paginatedExpenses = useMemo(() => {
    const start = gridPage * gridPageSize;
    return gridFiltered.slice(start, start + gridPageSize);
  }, [gridFiltered, gridPage, gridPageSize]);

  const expTotalPages = Math.ceil(gridFiltered.length / gridPageSize);

  useEffect(() => { setGridPage(0); }, [gridSearchQuery, gridColFilters, gridPageSize, filterStatus]);
  useEffect(() => {
    if (expTotalPages > 0 && gridPage >= expTotalPages) setGridPage(Math.max(0, expTotalPages - 1));
  }, [expTotalPages, gridPage]);

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
    if (paginatedExpenses.length === 0) return false;
    return paginatedExpenses.every((e: any) => gridSelectedIds.has(e.id));
  }, [paginatedExpenses, gridSelectedIds]);

  const gridHeaderIndeterminate = useMemo(() => {
    if (paginatedExpenses.length === 0) return false;
    const some = paginatedExpenses.some((e: any) => gridSelectedIds.has(e.id));
    return some && !gridHeaderChecked;
  }, [paginatedExpenses, gridSelectedIds, gridHeaderChecked]);

  const handleGridSelectAll = useCallback(() => {
    if (gridHeaderChecked) {
      setGridSelectedIds(new Set());
    } else {
      setGridSelectedIds(new Set(paginatedExpenses.map((e: any) => e.id)));
    }
  }, [gridHeaderChecked, paginatedExpenses]);

  const handleGridRowSelect = useCallback((id: string) => {
    setGridSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleExportExcel = useCallback(async () => {
    try {
      const XLSX = await import("xlsx");
      const data = gridFiltered.map((e: any) => ({
        Date: e.date || "",
        Vendor: e.vendor || "",
        Description: e.description || "",
        Category: e.categoryName || "",
        Project: e.projectName || "",
        Amount: Number(e.amount),
        Status: e.status || "",
        Billable: e.billable ? "Yes" : "No",
        Reimbursable: e.reimbursable ? "Yes" : "No",
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      ws["!cols"] = [{ wch: 12 }, { wch: 20 }, { wch: 30 }, { wch: 15 }, { wch: 20 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 12 }];
      for (let r = 1; r <= data.length; r++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c: 5 })];
        if (cell) cell.z = '$#,##0.00';
      }
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Expenses");
      XLSX.writeFile(wb, `expenses_${new Date().toISOString().split("T")[0]}.xlsx`);
      toast({ title: "Exported", description: `${data.length} expense(s) exported to Excel.` });
    } catch (err: any) {
      toast({ title: "Export failed", description: err?.message || "Could not export expenses.", variant: "destructive" });
    }
  }, [gridFiltered, toast]);

  const handleColumnDragStart = useCallback((col: string) => { setGridDragCol(col); }, []);
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
  const handleColumnDragEnd = useCallback(() => { setGridDragCol(null); }, []);

  const handleResizeStart = useCallback((col: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = gridColumnWidths[col] || getExpDefaultWidth(col);
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

  const hasGridFilters = gridSearchQuery || gridColFilters.vendor || gridColFilters.description
    || gridColFilters.dateFrom || gridColFilters.dateTo || gridColFilters.amountMin || gridColFilters.amountMax
    || (gridColFilters.status && gridColFilters.status !== "ALL") || gridColFilters.category;

  const clearAllGridFilters = useCallback(() => {
    setGridSearchQuery("");
    setGridColFilters({});
    setGridSorts([]);
  }, []);

  function getExpDefaultWidth(col: string): number {
    const map: Record<string, number> = {
      select: 44, date: 110, submittedBy: 140, vendor: 160, category: 120,
      project: 140, amount: 120, status: 110, flags: 130, actions: 160, description: 180,
    };
    return map[col] || 120;
  }

  const expColLabels: Record<string, string> = {
    select: "", date: "Date", submittedBy: "Submitted By", vendor: "Vendor",
    description: "Description", category: "Category", project: "Project",
    amount: "Amount", status: "Status", flags: "Flags", actions: "",
  };
  const expSortableCols = new Set(["date", "vendor", "category", "project", "amount", "status", "submittedBy"]);
  const expFilterableCols = new Set(["date", "vendor", "amount", "status", "category"]);

  const uniqueExpCategories = useMemo(() => {
    const cats = new Set<string>();
    (expenseList || []).forEach((e: any) => { if (e.categoryName) cats.add(e.categoryName); });
    return Array.from(cats).sort();
  }, [expenseList]);

  const handleReceiptFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    if (formReceipts.length + files.length > 10) {
      toast({ title: "Too many receipts", description: "Maximum 10 receipts per expense", variant: "destructive" });
      return;
    }
    setUploadingReceipt(true);
    try {
      const fd = new FormData();
      files.forEach(f => fd.append("receipt", f));
      const csrfToken = getCSRFToken();
      const res = await fetch("/api/expenses/upload-receipt", { method: "POST", body: fd, credentials: "include", headers: csrfToken ? { "X-CSRF-Token": csrfToken } : {} });
      if (!res.ok) { const err = await res.json().catch(() => ({ message: "Upload failed" })); throw new Error(err.message || "Upload failed"); }
      const data = await res.json();
      const uploaded: { url: string; filename: string }[] = data.files ? data.files : [data];
      setFormReceipts(prev => [...prev, ...uploaded]);
      toast({ title: `${uploaded.length} receipt${uploaded.length > 1 ? "s" : ""} uploaded` });
      const firstScannable = uploaded[0];
      if (firstScannable && formReceipts.length === 0) {
        setScanningReceipt(true);
        try {
          const csrfScan = getCSRFToken();
          const scanRes = await fetch("/api/expenses/scan-receipt", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(csrfScan ? { "X-CSRF-Token": csrfScan } : {}) },
            body: JSON.stringify({ receiptUrl: firstScannable.url }),
            credentials: "include",
          });
          if (scanRes.ok) {
            const ocrData = await scanRes.json();
            if (ocrData.vendor) setFormVendor(ocrData.vendor);
            if (ocrData.date) setFormDate(ocrData.date);
            if (ocrData.subtotal) setFormSubtotal(ocrData.subtotal);
            if (ocrData.taxAmount) setFormTaxAmount(ocrData.taxAmount);
            if (ocrData.tipAmount) setFormTipAmount(ocrData.tipAmount);
            if (ocrData.totalAmount) { setFormAmount(ocrData.totalAmount); setTotalOverridden(true); }
            if (ocrData.description) setFormDescription(ocrData.description);
            if (ocrData.suggestedCategoryId) setFormCategoryId(ocrData.suggestedCategoryId);
            if (ocrData.currency) setFormCurrency(ocrData.currency);
            if (ocrData.paymentMethod) setFormPaymentMethod(ocrData.paymentMethod);
            setScanLineItems(ocrData.lineItems && ocrData.lineItems.length > 0 ? ocrData.lineItems : []);
            if (ocrData.lineItems && ocrData.lineItems.length > 0) setShowLineItems(true);
            toast({ title: "Receipt scanned", description: "Fields auto-filled from receipt" });
          } else {
            const errData = await scanRes.json().catch(() => null);
            toast({ title: "Scan failed", description: errData?.message || "AI receipt scanning failed", variant: "destructive" });
          }
        } catch (err: any) {
          toast({ title: "Scan failed", description: err?.message || "Receipt uploaded but auto-fill is not available", variant: "destructive" });
        } finally {
          setScanningReceipt(false);
        }
      }
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploadingReceipt(false);
    }
  }, [formReceipts, toast]);

  const triggerAiScan = useCallback(async () => {
    const scanTarget = formReceipts[0];
    if (!scanTarget) return;
    setScanningReceipt(true);
    try {
      const csrfToken = getCSRFToken();
      const scanRes = await fetch("/api/expenses/scan-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}) },
        body: JSON.stringify({ receiptUrl: scanTarget.url }),
        credentials: "include",
      });
      if (scanRes.ok) {
        const ocrData = await scanRes.json();
        if (ocrData.vendor) setFormVendor(ocrData.vendor);
        if (ocrData.date) setFormDate(ocrData.date);
        if (ocrData.subtotal) setFormSubtotal(ocrData.subtotal);
        if (ocrData.taxAmount) setFormTaxAmount(ocrData.taxAmount);
        if (ocrData.tipAmount) setFormTipAmount(ocrData.tipAmount);
        if (ocrData.totalAmount) { setFormAmount(ocrData.totalAmount); setTotalOverridden(true); }
        if (ocrData.description) setFormDescription(ocrData.description);
        if (ocrData.suggestedCategoryId) setFormCategoryId(ocrData.suggestedCategoryId);
        if (ocrData.currency) setFormCurrency(ocrData.currency);
        if (ocrData.paymentMethod) setFormPaymentMethod(ocrData.paymentMethod);
        setScanLineItems(ocrData.lineItems && ocrData.lineItems.length > 0 ? ocrData.lineItems : []);
        if (ocrData.lineItems && ocrData.lineItems.length > 0) setShowLineItems(true);
        toast({ title: "Receipt scanned", description: "Fields auto-filled from receipt" });
      } else {
        const errData = await scanRes.json().catch(() => null);
        toast({ title: "Scan failed", description: errData?.message || "AI receipt scanning failed", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Scan failed", description: err?.message || "Could not scan receipt", variant: "destructive" });
    } finally {
      setScanningReceipt(false);
    }
  }, [formReceipts, toast]);

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

  const receiptPreviewUrl = formReceipts.length > 0 ? formReceipts[0].url : null;
  const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "CHF", "MXN"];
  const PAYMENT_METHODS = ["Credit Card", "Debit Card", "Cash", "Bank Transfer", "Corporate Card", "Check", "Other"];

  const formDialog = (
    <Dialog open={showCreate || !!editingExpense} onOpenChange={(open) => { if (!open) { setShowCreate(false); setEditingExpense(null); resetForm(); } }}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto p-0" style={{ background: "var(--lux-surface)" }}>
        <div className="relative px-6 pt-6 pb-4" style={{ background: "linear-gradient(135deg, rgba(var(--lux-accent-rgb),0.08) 0%, rgba(var(--lux-accent-rgb),0.02) 100%)" }}>
          <div className="flex items-center gap-3.5">
            <div className="relative">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(var(--lux-accent-rgb),0.18) 0%, rgba(168,85,247,0.12) 100%)" }}>
                {editingExpense ? <Pencil className="w-5 h-5" style={{ color: "var(--lux-accent)" }} /> : <Sparkles className="w-5 h-5" style={{ color: "var(--lux-accent)" }} />}
              </div>
              <div className="absolute -inset-1.5 rounded-xl opacity-30 blur-lg -z-10" style={{ background: "radial-gradient(circle, rgba(var(--lux-accent-rgb),0.4) 0%, transparent 70%)" }} />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold" style={{ color: "var(--lux-text)" }}>{editingExpense ? "Edit Expense" : "New Expense"}</DialogTitle>
              <p className="text-xs mt-0.5" style={{ color: "var(--lux-text-muted)" }}>
                {editingExpense ? "Update expense details and resubmit" : "Add a new expense with AI-powered receipt scanning"}
              </p>
            </div>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-px" style={{ background: "linear-gradient(90deg, var(--lux-accent), transparent 60%)", opacity: 0.25 }} />
        </div>

        <div className="px-6 pb-6">
          <div className="flex gap-6">
            <div className="flex-[3] space-y-5 min-w-0">

              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Receipt className="w-3.5 h-3.5" style={{ color: "#a855f7" }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Receipt</span>
                  <button
                    type="button"
                    className="ml-auto inline-flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-lg cursor-pointer transition-all hover:scale-[1.03] hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ background: "linear-gradient(135deg, #a855f7 0%, #7c3aed 50%, #6366f1 100%)", color: "white", boxShadow: "0 2px 8px rgba(168,85,247,0.3)" }}
                    onClick={() => triggerAiScan()}
                    disabled={scanningReceipt || formReceipts.length === 0}
                    data-testid="button-ai-scan"
                  >
                    {scanningReceipt ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    {scanningReceipt ? "Scanning..." : "AI Scan Receipt"}
                  </button>
                </div>
                <div className="space-y-3">
                  {formReceipts.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {formReceipts.map((r, i) => (
                        <div key={i} className="relative group rounded-xl overflow-hidden w-16 h-16 flex-shrink-0" style={{ border: "1px solid rgba(168,85,247,0.15)", background: "rgba(168,85,247,0.04)" }}>
                          {r.url.endsWith(".pdf") ? (
                            <div className="w-full h-full flex flex-col items-center justify-center gap-0.5" style={{ background: "rgba(168,85,247,0.08)" }}>
                              <FileText className="w-5 h-5" style={{ color: "#a855f7" }} />
                              <span className="text-[7px] truncate w-full px-1 text-center" style={{ color: "var(--lux-text-muted)" }}>{r.filename}</span>
                            </div>
                          ) : (
                            <img src={r.url} alt={r.filename} className="w-full h-full object-cover cursor-pointer" onClick={() => setReceiptZoomUrl(r.url)} data-testid={`img-receipt-thumb-${i}`} />
                          )}
                          <button type="button" onClick={() => setFormReceipts(prev => prev.filter((_, idx) => idx !== i))} className="absolute top-0.5 right-0.5 p-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: "rgba(239,68,68,0.9)" }} data-testid={`button-remove-receipt-${i}`} aria-label="Remove receipt">
                            <X className="w-2.5 h-2.5 text-white" />
                          </button>
                          {i === 0 && <div className="absolute bottom-0 left-0 right-0 py-0.5 text-center text-[7px] font-bold text-white" style={{ background: "rgba(168,85,247,0.85)" }}>PRIMARY</div>}
                        </div>
                      ))}
                    </div>
                  )}
                  {scanningReceipt && (
                    <div className="relative overflow-hidden flex items-center gap-3 p-3 rounded-xl" style={{ background: "linear-gradient(135deg, rgba(168,85,247,0.06) 0%, rgba(99,102,241,0.06) 100%)", border: "1px solid rgba(168,85,247,0.15)" }}>
                      <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_ease-in-out_infinite]" style={{ background: "linear-gradient(90deg, transparent, rgba(168,85,247,0.08), transparent)" }} />
                      <div className="relative">
                        <Sparkles className="w-5 h-5 animate-pulse" style={{ color: "#a855f7" }} />
                        <div className="absolute inset-0 animate-ping opacity-30"><Sparkles className="w-5 h-5" style={{ color: "#a855f7" }} /></div>
                      </div>
                      <div>
                        <span className="text-xs font-semibold" style={{ color: "#a855f7" }}>AI is reading your receipt...</span>
                        <p className="text-[10px] mt-0.5" style={{ color: "var(--lux-text-muted)" }}>Extracting vendor, amounts, line items, and more</p>
                      </div>
                      <Loader2 className="w-4 h-4 animate-spin ml-auto" style={{ color: "#a855f7" }} />
                    </div>
                  )}
                  <div
                    className="relative rounded-xl p-3 text-center transition-all duration-200 cursor-pointer group"
                    style={{ border: `2px dashed ${receiptDragOver ? "#a855f7" : "var(--lux-border)"}`, background: receiptDragOver ? "rgba(168,85,247,0.06)" : "var(--lux-bg)", display: formReceipts.length >= 10 ? "none" : undefined }}
                    onDragOver={(e) => { e.preventDefault(); setReceiptDragOver(true); }}
                    onDragLeave={() => setReceiptDragOver(false)}
                    onDrop={async (e) => { e.preventDefault(); setReceiptDragOver(false); const droppedFiles = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/") || f.type === "application/pdf"); if (droppedFiles.length === 0) { toast({ title: "Invalid file", description: "Please upload image or PDF files.", variant: "destructive" }); return; } await handleReceiptFiles(droppedFiles); }}
                    onClick={() => document.getElementById("receipt-file-input")?.click()}
                    data-testid="dropzone-receipt"
                  >
                    <input id="receipt-file-input" type="file" accept="image/*,.pdf" multiple className="hidden" disabled={uploadingReceipt} onChange={async (e) => { const files = Array.from(e.target.files || []); if (files.length === 0) return; await handleReceiptFiles(files); e.target.value = ""; }} data-testid="input-expense-receipt" />
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: receiptDragOver ? "rgba(168,85,247,0.15)" : "rgba(168,85,247,0.08)" }}>
                        {uploadingReceipt ? <Loader2 className="w-4 h-4 animate-spin" style={{ color: "#a855f7" }} /> : <Upload className="w-4 h-4" style={{ color: "#a855f7" }} />}
                      </div>
                      <div className="text-left">
                        <p className="text-xs font-semibold" style={{ color: receiptDragOver ? "#a855f7" : "var(--lux-text)" }}>
                          {uploadingReceipt ? "Uploading..." : formReceipts.length > 0 ? "Add more receipts" : "Drop receipts here or click to upload"}
                        </p>
                        <p className="text-[10px]" style={{ color: "var(--lux-text-muted)" }}>JPG, PNG, PDF · 10MB max · Up to 10 · {formReceipts.length}/10 attached</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="h-px" style={{ background: "var(--lux-border)", opacity: 0.6 }} />

              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Calculator className="w-3.5 h-3.5" style={{ color: "var(--lux-accent)" }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Amount Breakdown</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs font-medium" style={{ color: "var(--lux-text-secondary)" }}>Subtotal</Label>
                    <Input type="number" step="0.01" min="0" value={formSubtotal} onChange={e => { setFormSubtotal(e.target.value); setTotalOverridden(false); }} placeholder="0.00" className="mt-1" data-testid="input-expense-subtotal" />
                  </div>
                  <div>
                    <Label className="text-xs font-medium" style={{ color: "var(--lux-text-secondary)" }}>Tax Amount</Label>
                    <Input type="number" step="0.01" min="0" value={formTaxAmount} onChange={e => { setFormTaxAmount(e.target.value); setTotalOverridden(false); }} placeholder="0.00" className="mt-1" data-testid="input-expense-tax" />
                  </div>
                  <div>
                    <Label className="text-xs font-medium" style={{ color: "var(--lux-text-secondary)" }}>Tip Amount</Label>
                    <Input type="number" step="0.01" min="0" value={formTipAmount} onChange={e => { setFormTipAmount(e.target.value); setTotalOverridden(false); }} placeholder="0.00" className="mt-1" data-testid="input-expense-tip" />
                  </div>
                  <div>
                    <Label className="text-xs font-medium flex items-center gap-1" style={{ color: "var(--lux-text-secondary)" }}>
                      Total *
                      {!totalOverridden && (parseFloat(formSubtotal) > 0 || parseFloat(formTaxAmount) > 0 || parseFloat(formTipAmount) > 0) && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e" }}>auto</span>
                      )}
                    </Label>
                    <Input type="number" step="0.01" min="0" value={formAmount} onChange={e => { setFormAmount(e.target.value); setTotalOverridden(true); }} placeholder="0.00" className="mt-1" data-testid="input-expense-amount" />
                  </div>
                  <div>
                    <Label className="text-xs font-medium" style={{ color: "var(--lux-text-secondary)" }}>Currency</Label>
                    <Select value={formCurrency} onValueChange={setFormCurrency}>
                      <SelectTrigger className="mt-1" data-testid="select-expense-currency">
                        <SelectValue placeholder="USD" />
                      </SelectTrigger>
                      <SelectContent>
                        {CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs font-medium" style={{ color: "var(--lux-text-secondary)" }}>Date *</Label>
                    <Input type="date" value={formDate} onChange={e => setFormDate(e.target.value)} className="mt-1" data-testid="input-expense-date" />
                  </div>
                </div>
              </div>

              {scanLineItems.length > 0 && (
                <>
                  <div className="h-px" style={{ background: "var(--lux-border)", opacity: 0.6 }} />
                  <div>
                    <button type="button" className="flex items-center gap-2 mb-2 w-full text-left" onClick={() => setShowLineItems(!showLineItems)}>
                      <BookOpen className="w-3.5 h-3.5" style={{ color: "#f59e0b" }} />
                      <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Line Items ({scanLineItems.length})</span>
                      {showLineItems ? <ChevronUp className="w-3 h-3 ml-auto" style={{ color: "var(--lux-text-muted)" }} /> : <ChevronDown className="w-3 h-3 ml-auto" style={{ color: "var(--lux-text-muted)" }} />}
                    </button>
                    {showLineItems && (
                      <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--lux-border)" }}>
                        <table className="w-full text-xs">
                          <thead>
                            <tr style={{ background: "var(--lux-surface-alt)" }}>
                              <th className="text-left px-3 py-2 font-semibold" style={{ color: "var(--lux-text-muted)" }}>Description</th>
                              <th className="text-right px-3 py-2 font-semibold w-12" style={{ color: "var(--lux-text-muted)" }}>Qty</th>
                              <th className="text-right px-3 py-2 font-semibold w-20" style={{ color: "var(--lux-text-muted)" }}>Unit Price</th>
                              <th className="text-right px-3 py-2 font-semibold w-20" style={{ color: "var(--lux-text-muted)" }}>Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {scanLineItems.map((item, idx) => (
                              <tr key={idx} style={{ background: idx % 2 === 0 ? "transparent" : "rgba(var(--lux-accent-rgb),0.02)", borderTop: "1px solid var(--lux-border)" }}>
                                <td className="px-3 py-1.5" style={{ color: "var(--lux-text)" }}>{item.description}</td>
                                <td className="px-3 py-1.5 text-right" style={{ color: "var(--lux-text-secondary)" }}>{item.quantity}</td>
                                <td className="px-3 py-1.5 text-right" style={{ color: "var(--lux-text-secondary)" }}>${Number(item.unitPrice).toFixed(2)}</td>
                                <td className="px-3 py-1.5 text-right font-medium" style={{ color: "var(--lux-text)" }}>${Number(item.amount).toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              )}

              <div className="h-px" style={{ background: "var(--lux-border)", opacity: 0.6 }} />

              <div>
                <div className="flex items-center gap-2 mb-3">
                  <FileText className="w-3.5 h-3.5" style={{ color: "#3b82f6" }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Details</span>
                </div>
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs font-medium" style={{ color: "var(--lux-text-secondary)" }}>Vendor</Label>
                    <Input value={formVendor} onChange={e => setFormVendor(e.target.value)} placeholder="e.g., Uber, Delta Airlines, Amazon" className="mt-1" data-testid="input-expense-vendor" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs font-medium" style={{ color: "var(--lux-text-secondary)" }}>Description</Label>
                      <Input value={formDescription} onChange={e => setFormDescription(e.target.value)} placeholder="What was this expense for?" className="mt-1" data-testid="input-expense-description" />
                    </div>
                    <div>
                      <Label className="text-xs font-medium" style={{ color: "var(--lux-text-secondary)" }}>Payment Method</Label>
                      <Select value={formPaymentMethod} onValueChange={setFormPaymentMethod}>
                        <SelectTrigger className="mt-1" data-testid="select-expense-payment-method">
                          <SelectValue placeholder="Select method" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Not specified</SelectItem>
                          {PAYMENT_METHODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </div>

              <div className="h-px" style={{ background: "var(--lux-border)", opacity: 0.6 }} />

              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Tag className="w-3.5 h-3.5" style={{ color: "#22c55e" }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Classification</span>
                </div>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs font-medium" style={{ color: "var(--lux-text-secondary)" }}>Category *</Label>
                      <Select value={formCategoryId} onValueChange={setFormCategoryId}>
                        <SelectTrigger className={`mt-1 ${!formCategoryId || formCategoryId === "none" ? "border-orange-300" : ""}`} data-testid="select-expense-category">
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                        <SelectContent>
                          {(categories || []).map(c => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {(!formCategoryId || formCategoryId === "none") && (
                        <p className="text-[11px] mt-1 font-medium" style={{ color: "#f59e0b" }}>Category is required</p>
                      )}
                    </div>
                    <div>
                      <Label className="text-xs font-medium" style={{ color: "var(--lux-text-secondary)" }}>Project</Label>
                      <Select value={formProjectId} onValueChange={setFormProjectId}>
                        <SelectTrigger className="mt-1" data-testid="select-expense-project">
                          <SelectValue placeholder="Select project" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No Project</SelectItem>
                          {(allProjects || []).map((p: any) => (
                            <SelectItem key={p.id} value={p.id}>{p.name}{p.clientName ? ` — ${p.clientName}` : ""}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 pt-1">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: formBillable ? "rgba(34,197,94,0.06)" : "transparent", border: `1px solid ${formBillable ? "rgba(34,197,94,0.2)" : "var(--lux-border)"}`, transition: "all 0.2s" }}>
                      <Switch checked={formBillable} onCheckedChange={setFormBillable} data-testid="switch-expense-billable" />
                      <Label className="text-xs font-medium cursor-pointer" style={{ color: formBillable ? "#22c55e" : "var(--lux-text-muted)" }}>Billable</Label>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: formReimbursable ? "rgba(59,130,246,0.06)" : "transparent", border: `1px solid ${formReimbursable ? "rgba(59,130,246,0.2)" : "var(--lux-border)"}`, transition: "all 0.2s" }}>
                      <Switch checked={formReimbursable} onCheckedChange={setFormReimbursable} data-testid="switch-expense-reimbursable" />
                      <Label className="text-xs font-medium cursor-pointer" style={{ color: formReimbursable ? "#3b82f6" : "var(--lux-text-muted)" }}>Reimbursable</Label>
                    </div>
                  </div>
                </div>
              </div>

              <div className="h-px" style={{ background: "var(--lux-border)", opacity: 0.6 }} />

              <div>
                <div className="flex items-center gap-2 mb-3">
                  <StickyNote className="w-3.5 h-3.5" style={{ color: "#f59e0b" }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Notes</span>
                </div>
                <Textarea value={formNotes} onChange={e => setFormNotes(e.target.value)} placeholder="Additional notes, context, or details..." className="resize-none" rows={2} data-testid="input-expense-notes" />
              </div>

              <div className="flex justify-end gap-2 pt-3" style={{ borderTop: "1px solid var(--lux-border)" }}>
                <Button variant="outline" onClick={() => { setShowCreate(false); setEditingExpense(null); resetForm(); }} className="px-5">Cancel</Button>
                <Button
                  className="text-white px-6 transition-all duration-200 hover:scale-[1.03] hover:shadow-lg"
                  style={{ background: "var(--gradient-brand)" }}
                  disabled={!formAmount || Number(formAmount) <= 0 || !formDate || (editingExpense ? updateMutation.isPending : createMutation.isPending)}
                  onClick={() => editingExpense ? updateMutation.mutate() : createMutation.mutate()}
                  data-testid="button-save-expense"
                >
                  {(editingExpense ? updateMutation.isPending : createMutation.isPending) && <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />}
                  {editingExpense ? "Save Changes" : "Create Expense"}
                </Button>
              </div>
            </div>

            <div className="flex-[2] min-w-0 hidden sm:block">
              <div className="sticky top-0 space-y-3">
                <div className="flex items-center gap-2 mb-1">
                  <Eye className="w-3.5 h-3.5" style={{ color: "var(--lux-text-muted)" }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Receipt Preview</span>
                </div>
                <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--lux-border)", background: "var(--lux-bg)", minHeight: "280px" }}>
                  {receiptPreviewUrl ? (
                    receiptPreviewUrl.endsWith(".pdf") ? (
                      <div className="flex flex-col items-center justify-center gap-3 p-8" style={{ minHeight: "280px" }}>
                        <div className="w-16 h-16 rounded-xl flex items-center justify-center" style={{ background: "rgba(168,85,247,0.08)" }}>
                          <FileText className="w-8 h-8" style={{ color: "#a855f7" }} />
                        </div>
                        <p className="text-xs font-medium text-center" style={{ color: "var(--lux-text-secondary)" }}>{formReceipts[0]?.filename || "PDF Receipt"}</p>
                        <a href={receiptPreviewUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] font-semibold px-3 py-1.5 rounded-lg" style={{ background: "rgba(168,85,247,0.1)", color: "#a855f7" }}>
                          <ExternalLink className="w-3 h-3" /> Open PDF
                        </a>
                      </div>
                    ) : (
                      <img
                        src={receiptPreviewUrl}
                        alt="Receipt preview"
                        className="w-full object-contain cursor-pointer"
                        style={{ maxHeight: "400px" }}
                        onClick={() => setReceiptZoomUrl(receiptPreviewUrl)}
                        data-testid="img-receipt-preview"
                      />
                    )
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-3 p-8" style={{ minHeight: "280px" }}>
                      <div className="w-14 h-14 rounded-xl flex items-center justify-center" style={{ background: "rgba(var(--lux-accent-rgb),0.06)" }}>
                        <ImageIcon className="w-7 h-7" style={{ color: "var(--lux-text-muted)", opacity: 0.4 }} />
                      </div>
                      <p className="text-xs text-center" style={{ color: "var(--lux-text-muted)" }}>Upload a receipt to see preview</p>
                    </div>
                  )}
                </div>
                {formReceipts.length > 1 && (
                  <div className="flex flex-wrap gap-1.5">
                    {formReceipts.slice(1).map((r, i) => (
                      <div key={i} className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 group relative" style={{ border: "1px solid var(--lux-border)" }}>
                        {r.url.endsWith(".pdf") ? (
                          <div className="w-full h-full flex items-center justify-center" style={{ background: "rgba(168,85,247,0.06)" }}>
                            <FileText className="w-4 h-4" style={{ color: "#a855f7" }} />
                          </div>
                        ) : (
                          <img src={r.url} alt={r.filename} className="w-full h-full object-cover" />
                        )}
                      </div>
                    ))}
                    <span className="text-[10px] self-center pl-1" style={{ color: "var(--lux-text-muted)" }}>+{formReceipts.length - 1} more</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );

  const statCards = [
    { key: "total", label: "Total Expenses", value: formatMoney(luxStats.totalAll, baseCurrency), sub: `${(expenseList || []).length} total`, icon: DollarSign, color: "var(--lux-accent)", iconBg: "rgba(var(--lux-accent-rgb),0.08)", gradient: "linear-gradient(135deg, rgba(var(--lux-accent-rgb),0.08) 0%, rgba(var(--lux-accent-rgb),0.02) 100%)" },
    { key: "month", label: "This Month", value: formatMoney(luxStats.thisMonthSum, baseCurrency), sub: new Date().toLocaleString("default", { month: "long", year: "numeric" }), icon: TrendingUp, color: "#22c55e", gradient: "linear-gradient(135deg, rgba(34,197,94,0.08) 0%, rgba(34,197,94,0.02) 100%)" },
    { key: "pending", label: "Pending Approval", value: String(pendingCount), sub: pendingCount > 0 ? "awaiting review" : "all clear", icon: AlertCircle, color: "#3b82f6", gradient: "linear-gradient(135deg, rgba(59,130,246,0.08) 0%, rgba(59,130,246,0.02) 100%)", pulse: pendingCount > 0 },
    { key: "reimb", label: "Reimbursable", value: formatMoney(luxStats.reimbursableSum, baseCurrency), sub: "outstanding", icon: Wallet, color: "#a855f7", gradient: "linear-gradient(135deg, rgba(168,85,247,0.08) 0%, rgba(168,85,247,0.02) 100%)" },
    { key: "avg", label: "Average Expense", value: formatMoney(luxStats.avgExpense, baseCurrency), sub: "per entry", icon: Calculator, color: "#f59e0b", gradient: "linear-gradient(135deg, rgba(245,158,11,0.08) 0%, rgba(245,158,11,0.02) 100%)" },
  ];

  const STATUS_LABELS: Record<string, string> = { ALL: "All", DRAFT: "Draft", SUBMITTED: "Submitted", APPROVED: "Approved", REJECTED: "Rejected", REIMBURSED: "Reimbursed" };
  const STATUS_ICONS: Record<string, any> = { ALL: Receipt, DRAFT: BookOpen, SUBMITTED: Send, APPROVED: CheckCircle, REJECTED: XCircle, REIMBURSED: DollarSign };

  return (
    <div className="px-6 lg:px-8 xl:px-10 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(var(--lux-accent-rgb),0.15) 0%, rgba(var(--lux-accent-rgb),0.05) 100%)" }}>
              <Receipt className="w-6 h-6" style={{ color: "var(--lux-accent)" }} />
            </div>
            <div className="absolute -inset-1 rounded-xl opacity-40 blur-md -z-10" style={{ background: "radial-gradient(circle, rgba(var(--lux-accent-rgb),0.3) 0%, transparent 70%)" }} />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--lux-text)" }} data-testid="text-expenses-title">Expenses</h1>
              <PageHelpLink />
            </div>
            <p className="text-sm mt-0.5" style={{ color: "var(--lux-text-muted)" }}>{canManage ? "Review, approve, and manage all team expenses" : "Track, submit, and manage your expenses"}</p>
          </div>
        </div>
        <Button className="text-white shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.03]" style={{ background: "var(--gradient-brand)" }} onClick={() => { resetForm(); setShowCreate(true); }} data-testid="button-new-expense">
          <Plus className="w-4 h-4 mr-2" /> New Expense
        </Button>
      </div>
      <div className="h-px w-full" style={{ background: "linear-gradient(90deg, var(--lux-accent), transparent 60%)", opacity: 0.3 }} />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
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
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-transform duration-300 group-hover:scale-110${sc.pulse ? " animate-pulse" : ""}`} style={{ background: sc.iconBg || `${sc.color}15` }}>
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

      {(() => {
        const chips: FilterChipDescriptor[] = [];
        if (filterStatus !== "ALL") {
          chips.push({
            id: "status",
            label: `Status: ${STATUS_LABELS[filterStatus] || filterStatus}`,
            onClear: () => setFilterStatus("ALL"),
          });
        }
        if (gridSearchQuery) {
          chips.push({
            id: "search",
            label: `Search: "${gridSearchQuery}"`,
            onClear: () => setGridSearchQuery(""),
          });
        }
        return <ActiveFilterBar chips={chips} />;
      })()}

      <div className="flex items-center gap-1.5 flex-wrap rounded-xl p-1.5" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
        {["ALL", "DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "REIMBURSED"].map(s => {
          const Icon = STATUS_ICONS[s];
          const active = filterStatus === s;
          const cnt = luxStats.statusCounts[s] ?? 0;
          const col = STATUS_COLORS[s] || "var(--lux-accent)";
          return (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className="relative flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all duration-200 hover:scale-[1.02]"
              style={{
                background: active ? `${col}15` : "transparent",
                color: active ? col : "var(--lux-text-muted)",
                boxShadow: active ? `0 0 0 1px ${col}30, 0 1px 3px ${col}10` : "none",
              }}
              data-testid={`filter-${s.toLowerCase()}`}
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

      <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--lux-text-muted)" }} />
              <Input placeholder="Search all columns..." value={gridSearchQuery} onChange={e => setGridSearchQuery(e.target.value)}
                className="pl-9 h-9 text-sm" style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                data-testid="input-search-expenses" />
            </div>
            <Button variant="outline" size="sm" onClick={handleExportExcel}
              className="h-9 text-xs gap-1.5" style={{ borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
              disabled={gridFiltered.length === 0} data-testid="button-export-excel">
              <Download className="w-3.5 h-3.5" /> Export to Excel
            </Button>
            {gridSelectedIds.size > 0 && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs" style={{ background: "rgba(99,102,241,0.08)", color: "var(--lux-accent)" }}>
                <span className="font-medium tabular-nums">{gridSelectedIds.size} selected</span>
                <Button variant="default" size="sm" className="h-6 px-3 text-xs gap-1"
                  onClick={() => { setBundleTitle(""); setBundlePurpose(""); setBundleDialogOpen(true); }}
                  data-testid="button-bundle-report">
                  <FolderOpen className="w-3 h-3" /> Bundle into Expense Report
                </Button>
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" style={{ color: "var(--lux-text-muted)" }}
                  onClick={() => setGridSelectedIds(new Set())} data-testid="button-clear-selection">Clear</Button>
              </div>
            )}
            {hasGridFilters && (
              <Button variant="ghost" size="sm" onClick={clearAllGridFilters}
                className="text-xs h-9" style={{ color: "var(--lux-text-muted)" }} data-testid="button-clear-grid-filters">
                Clear all filters
              </Button>
            )}
            {gridSorts.length > 0 && (
              <div className="flex items-center gap-1.5 text-[10px] tabular-nums" style={{ color: "var(--lux-text-muted)" }}>
                Sorted by: {gridSorts.map(s => (
                  <Badge key={s.col} variant="secondary" className="text-[10px] px-1.5 py-0" style={{ background: "rgba(99,102,241,0.08)", color: "var(--lux-accent)", border: "none" }}>
                    {expColLabels[s.col]} {s.dir === "asc" ? "↑" : "↓"}
                  </Badge>
                ))}
                <span className="text-[9px]">(shift+click for multi-sort)</span>
              </div>
            )}
          </div>

          {filtered.length === 0 ? (
            <div className="p-8">
              <EmptyState icon={Receipt} title="No expenses" description={filterStatus !== "ALL" ? `No expenses with status "${filterStatus}"` : "Create your first expense to get started."} />
            </div>
          ) : gridFiltered.length === 0 ? (
            <div className="py-12 text-center">
              <Search className="w-8 h-8 mx-auto mb-3" style={{ color: "var(--lux-text-muted)", opacity: 0.4 }} />
              <p className="text-sm font-medium mb-1" style={{ color: "var(--lux-text)" }}>No matching expenses</p>
              <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>Try adjusting your search or filters.</p>
            </div>
          ) : (
            <>
              <div className="rounded-lg overflow-x-auto" style={{ border: "1px solid var(--lux-border)" }}>
                <table className="w-full border-collapse" style={{ minWidth: "900px" }}>
                  <thead>
                    <tr style={{ background: "var(--lux-bg)" }} className="sticky top-0 z-10">
                      {gridColumnOrder.filter(c => c !== "submittedBy" || isAdmin).map(col => {
                        const w = gridColumnWidths[col] || getExpDefaultWidth(col);
                        const sort = gridSorts.find(s => s.col === col);
                        const isSortable = expSortableCols.has(col);
                        const isFilterable = expFilterableCols.has(col);
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
                                  className="mx-auto" data-testid="checkbox-select-all-expenses" />
                              ) : (
                                <button
                                  className={`flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap ${isSortable ? "cursor-pointer hover:opacity-80" : "cursor-default"}`}
                                  style={{ color: sort ? "var(--lux-accent)" : "var(--lux-text-muted)", background: "none", border: "none", padding: 0 }}
                                  onClick={isSortable ? (e) => handleGridSort(col, e) : undefined}
                                  data-testid={`header-exp-${col}`}
                                >
                                  {expColLabels[col]}
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
                                      (col === "vendor" && gridColFilters.vendor) ||
                                      (col === "date" && (gridColFilters.dateFrom || gridColFilters.dateTo)) ||
                                      (col === "amount" && (gridColFilters.amountMin || gridColFilters.amountMax)) ||
                                      (col === "status" && gridColFilters.status && gridColFilters.status !== "ALL") ||
                                      (col === "category" && gridColFilters.category)
                                    ) ? "var(--lux-accent)" : "var(--lux-text-muted)",
                                    background: "none", border: "none",
                                  }}
                                  onClick={(e) => { e.stopPropagation(); setGridOpenFilter(filterOpen ? null : col); }}
                                  data-testid={`grid-filter-${col}`}
                                  aria-label={`Filter ${expColLabels[col]}`}
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
                                {col === "vendor" && (
                                  <Input placeholder="Filter vendor..." value={gridColFilters.vendor || ""}
                                    onChange={e => setGridColFilters(prev => ({ ...prev, vendor: e.target.value }))}
                                    className="h-8 text-xs" style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                                    autoFocus data-testid="filter-input-vendor" />
                                )}
                                {col === "date" && (
                                  <div className="space-y-2">
                                    <label className="text-[10px] font-medium uppercase" style={{ color: "var(--lux-text-muted)" }}>From</label>
                                    <Input type="date" value={gridColFilters.dateFrom || ""}
                                      onChange={e => setGridColFilters(prev => ({ ...prev, dateFrom: e.target.value }))}
                                      className="h-8 text-xs" style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                                      data-testid="filter-input-exp-date-from" />
                                    <label className="text-[10px] font-medium uppercase" style={{ color: "var(--lux-text-muted)" }}>To</label>
                                    <Input type="date" value={gridColFilters.dateTo || ""}
                                      onChange={e => setGridColFilters(prev => ({ ...prev, dateTo: e.target.value }))}
                                      className="h-8 text-xs" style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                                      data-testid="filter-input-exp-date-to" />
                                  </div>
                                )}
                                {col === "amount" && (
                                  <div className="space-y-2">
                                    <label className="text-[10px] font-medium uppercase" style={{ color: "var(--lux-text-muted)" }}>Min</label>
                                    <Input type="number" placeholder="0.00" value={gridColFilters.amountMin || ""}
                                      onChange={e => setGridColFilters(prev => ({ ...prev, amountMin: e.target.value }))}
                                      className="h-8 text-xs" style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                                      data-testid="filter-input-exp-amount-min" />
                                    <label className="text-[10px] font-medium uppercase" style={{ color: "var(--lux-text-muted)" }}>Max</label>
                                    <Input type="number" placeholder="99999.99" value={gridColFilters.amountMax || ""}
                                      onChange={e => setGridColFilters(prev => ({ ...prev, amountMax: e.target.value }))}
                                      className="h-8 text-xs" style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                                      data-testid="filter-input-exp-amount-max" />
                                  </div>
                                )}
                                {col === "status" && (
                                  <div className="space-y-1">
                                    {["ALL", "DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "REIMBURSED"].map(s => (
                                      <button key={s} className="w-full text-left px-2 py-1.5 rounded text-xs hover:opacity-80 transition-colors"
                                        style={{
                                          background: (gridColFilters.status || "ALL") === s ? "rgba(99,102,241,0.1)" : "transparent",
                                          color: (gridColFilters.status || "ALL") === s ? "var(--lux-accent)" : "var(--lux-text)",
                                          border: "none",
                                        }}
                                        onClick={() => { setGridColFilters(prev => ({ ...prev, status: s })); setGridOpenFilter(null); }}
                                        data-testid={`grid-filter-status-${s.toLowerCase()}`}>
                                        {s === "ALL" ? "All Statuses" : s.charAt(0) + s.slice(1).toLowerCase()}
                                      </button>
                                    ))}
                                  </div>
                                )}
                                {col === "category" && (
                                  <div className="space-y-2">
                                    <Input placeholder="Filter category..." value={gridColFilters.category || ""}
                                      onChange={e => setGridColFilters(prev => ({ ...prev, category: e.target.value }))}
                                      className="h-8 text-xs" style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                                      autoFocus data-testid="filter-input-exp-category" />
                                    {uniqueExpCategories.length > 0 && (
                                      <div className="max-h-[120px] overflow-y-auto space-y-0.5 mt-1">
                                        {uniqueExpCategories.map(cat => (
                                          <button key={cat} className="w-full text-left px-2 py-1 rounded text-xs hover:opacity-80"
                                            style={{ background: "transparent", color: "var(--lux-text)", border: "none" }}
                                            onClick={() => { setGridColFilters(prev => ({ ...prev, category: cat })); setGridOpenFilter(null); }}>
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
                                      if (col === "vendor") setGridColFilters(p => ({ ...p, vendor: "" }));
                                      if (col === "date") setGridColFilters(p => ({ ...p, dateFrom: "", dateTo: "" }));
                                      if (col === "amount") setGridColFilters(p => ({ ...p, amountMin: "", amountMax: "" }));
                                      if (col === "status") setGridColFilters(p => ({ ...p, status: "ALL" }));
                                      if (col === "category") setGridColFilters(p => ({ ...p, category: "" }));
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
                    {paginatedExpenses.map((exp: any) => {
                      const isSelected = gridSelectedIds.has(exp.id);
                      return (
                        <tr key={exp.id} data-testid={`row-expense-${exp.id}`} className="group transition-colors"
                          style={{ borderBottom: "1px solid var(--lux-border)", background: isSelected ? "rgba(99,102,241,0.04)" : "transparent" }}>
                          {gridColumnOrder.filter(c => c !== "submittedBy" || isAdmin).map(col => {
                            const w = gridColumnWidths[col] || getExpDefaultWidth(col);
                            const cellStyle = { width: `${w}px`, minWidth: `${w}px`, maxWidth: `${w}px`, padding: "8px 12px" };
                            if (col === "select") return (
                              <td key={col} style={{ ...cellStyle, textAlign: "center" as const }}>
                                <Checkbox checked={isSelected} onCheckedChange={() => handleGridRowSelect(exp.id)}
                                  data-testid={`checkbox-exp-row-${exp.id}`} />
                              </td>
                            );
                            if (col === "date") return (
                              <td key={col} className="text-sm tabular-nums" style={{ ...cellStyle, color: "var(--lux-text)" }}>
                                {formatDate(exp.date)}
                              </td>
                            );
                            if (col === "submittedBy") return (
                              <td key={col} className="text-sm" style={{ ...cellStyle, color: "var(--lux-text-secondary)" }}>
                                {exp.userName || "—"}
                              </td>
                            );
                            if (col === "vendor") return (
                              <td key={col} className="text-sm font-medium" style={{ ...cellStyle, color: "var(--lux-text)" }}>
                                <span className="truncate block">{exp.vendor || "—"}</span>
                              </td>
                            );
                            if (col === "category") return (
                              <td key={col} className="text-sm" style={{ ...cellStyle, color: "var(--lux-text-secondary)" }}>
                                {exp.categoryName || "—"}
                              </td>
                            );
                            if (col === "project") return (
                              <td key={col} className="text-sm" style={{ ...cellStyle, color: "var(--lux-text-secondary)" }}>
                                {exp.projectName || "—"}
                              </td>
                            );
                            if (col === "amount") return (
                              <td key={col} className="text-right tabular-nums text-sm font-medium" style={{ ...cellStyle, color: "var(--lux-text)" }}>
                                {formatMoney(exp.amount, (exp as any).currency || baseCurrency)}
                              </td>
                            );
                            if (col === "status") return (
                              <td key={col} style={{ ...cellStyle, textAlign: "center" as const }}>
                                <ExpenseStatusBadge status={exp.status} />
                                {exp.status === "REJECTED" && exp.rejectionReason && (
                                  <p className="text-[10px] mt-0.5 max-w-[160px] truncate" style={{ color: "#ef4444" }} title={exp.rejectionReason} data-testid={`text-rejection-reason-${exp.id}`}>
                                    Reason: {exp.rejectionReason}
                                  </p>
                                )}
                              </td>
                            );
                            if (col === "flags") return (
                              <td key={col} style={{ ...cellStyle, textAlign: "center" as const }}>
                                <div className="flex items-center justify-center gap-1">
                                  {exp.billable && <span title="Billable to client" className="text-[9px] font-bold px-1.5 py-0.5 rounded cursor-default" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e" }}>BILL</span>}
                                  {exp.reimbursable && <span title="Reimbursable" className="text-[9px] font-bold px-1.5 py-0.5 rounded cursor-default" style={{ background: "rgba(59,130,246,0.1)", color: "#3b82f6" }}>REIMB</span>}
                                  {exp.receiptUrl && <span title="Receipt attached" className="text-[9px] font-bold px-1.5 py-0.5 rounded cursor-default" style={{ background: "rgba(168,85,247,0.1)", color: "#a855f7" }}>RCPT</span>}
                                </div>
                              </td>
                            );
                            if (col === "actions") return (
                              <td key={col} style={{ ...cellStyle, textAlign: "right" as const }}>
                                <div className="flex items-center justify-end gap-1">
                                  <Button size="sm" variant="ghost" title="View Details" onClick={() => setViewExpense(exp)} data-testid={`button-view-${exp.id}`}>
                                    <Eye className="w-3.5 h-3.5" />
                                  </Button>
                                  {(exp.status === "DRAFT" || exp.status === "REJECTED") && !exp.reportId && (
                                    <>
                                      <Button size="sm" variant="ghost" title="Edit Expense" onClick={() => openEdit(exp)} data-testid={`button-edit-${exp.id}`}>
                                        <Pencil className="w-3.5 h-3.5" />
                                      </Button>
                                      <Button size="sm" variant="ghost" title="Submit for Approval" onClick={() => submitMutation.mutate(exp.id)} disabled={submitMutation.isPending} data-testid={`button-submit-${exp.id}`}>
                                        <Send className="w-3.5 h-3.5" style={{ color: "#3b82f6" }} />
                                      </Button>
                                    </>
                                  )}
                                  {exp.status === "DRAFT" && !exp.reportId && (
                                    <Button size="sm" variant="ghost" title="Delete Expense" onClick={() => deleteMutation.mutate(exp.id)} disabled={deleteMutation.isPending} data-testid={`button-delete-${exp.id}`}>
                                      <Trash2 className="w-3.5 h-3.5" style={{ color: "#ef4444" }} />
                                    </Button>
                                  )}
                                  {canManage && exp.status === "SUBMITTED" && (
                                    <>
                                      <Button size="sm" variant="ghost" title="Approve" onClick={() => approveMutation.mutate(exp.id)} disabled={approveMutation.isPending} data-testid={`button-approve-${exp.id}`}>
                                        <CheckCircle className="w-3.5 h-3.5" style={{ color: "#22c55e" }} />
                                      </Button>
                                      <Button size="sm" variant="ghost" title="Reject" onClick={() => { setRejectId(exp.id); setRejectReason(""); }} data-testid={`button-reject-${exp.id}`}>
                                        <XCircle className="w-3.5 h-3.5" style={{ color: "#ef4444" }} />
                                      </Button>
                                    </>
                                  )}
                                  {canManage && exp.status === "APPROVED" && exp.reimbursable && (
                                    <Button size="sm" variant="ghost" title="Mark as Reimbursed" onClick={() => reimburseMutation.mutate(exp.id)} disabled={reimburseMutation.isPending} data-testid={`button-reimburse-${exp.id}`}>
                                      <DollarSign className="w-3.5 h-3.5" style={{ color: "#a855f7" }} />
                                    </Button>
                                  )}
                                  {canManage && !autoPostEnabled && (exp.status === "APPROVED" || exp.status === "REIMBURSED") && !glPostedIds.has(exp.id) && (
                                    <Button size="sm" variant="ghost" onClick={() => postGlMutation.mutate(exp.id)} disabled={postGlMutation.isPending} data-testid={`button-post-gl-expense-${exp.id}`} title="Post to GL">
                                      <BookOpen className="w-3.5 h-3.5" />
                                    </Button>
                                  )}
                                  {canManage && !autoPostEnabled && (exp.status === "APPROVED" || exp.status === "REIMBURSED") && glPostedIds.has(exp.id) && (
                                    <span className="inline-flex items-center" title="Posted to GL" data-testid={`badge-gl-posted-expense-${exp.id}`}>
                                      <BookOpen className="w-3.5 h-3.5" style={{ color: "var(--lux-text-muted)" }} />
                                    </span>
                                  )}
                                </div>
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
                      data-testid="select-exp-page-size">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}>
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="tabular-nums">
                    {gridPage * gridPageSize + 1}–{Math.min((gridPage + 1) * gridPageSize, gridFiltered.length)} of {gridFiltered.length}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={gridPage === 0}
                    onClick={() => setGridPage(0)}
                    style={{ borderColor: "var(--lux-border)", color: "var(--lux-text-muted)" }} data-testid="button-exp-page-first" aria-label="First page">
                    <ChevronLeft className="w-3.5 h-3.5" /><ChevronLeft className="w-3.5 h-3.5 -ml-2" />
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={gridPage === 0}
                    onClick={() => setGridPage(p => p - 1)}
                    style={{ borderColor: "var(--lux-border)", color: "var(--lux-text-muted)" }} data-testid="button-exp-page-prev" aria-label="Previous page">
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </Button>
                  <span className="text-xs tabular-nums px-2" style={{ color: "var(--lux-text)" }}>
                    {gridPage + 1} / {expTotalPages || 1}
                  </span>
                  <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={gridPage >= expTotalPages - 1}
                    onClick={() => setGridPage(p => p + 1)}
                    style={{ borderColor: "var(--lux-border)", color: "var(--lux-text-muted)" }} data-testid="button-exp-page-next" aria-label="Next page">
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={gridPage >= expTotalPages - 1}
                    onClick={() => setGridPage(expTotalPages - 1)}
                    style={{ borderColor: "var(--lux-border)", color: "var(--lux-text-muted)" }} data-testid="button-exp-page-last" aria-label="Last page">
                    <ChevronRight className="w-3.5 h-3.5" /><ChevronRight className="w-3.5 h-3.5 -ml-2" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {formDialog}

      <Dialog open={!!viewExpense} onOpenChange={(open) => !open && setViewExpense(null)}>
        <DialogContent className="sm:max-w-md p-0 overflow-hidden" style={{ background: "var(--lux-surface)" }}>
          {viewExpense && (
            <>
              <div className="relative px-6 pt-6 pb-5" style={{ background: "linear-gradient(135deg, rgba(var(--lux-accent-rgb),0.1) 0%, rgba(var(--lux-accent-rgb),0.02) 100%)" }}>
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "var(--lux-text-muted)" }}>Expense Amount</p>
                    <p className="text-3xl font-bold tracking-tight tabular-nums" style={{ color: "var(--lux-text)" }} data-testid="text-detail-amount">
                      {formatMoney(viewExpense.amount, (viewExpense as any).currency || baseCurrency)}
                    </p>
                    {viewExpense.vendor && (
                      <p className="text-sm mt-1 font-medium" style={{ color: "var(--lux-text-secondary)" }}>{viewExpense.vendor}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <ExpenseStatusBadge status={viewExpense.status} />
                    <div className="flex items-center gap-1.5">
                      {viewExpense.billable && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e" }}>Billable</span>}
                      {viewExpense.reimbursable && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(59,130,246,0.12)", color: "#3b82f6" }}>Reimbursable</span>}
                    </div>
                  </div>
                </div>
                <div className="absolute bottom-0 left-0 right-0 h-px" style={{ background: "linear-gradient(90deg, var(--lux-accent), transparent 60%)", opacity: 0.25 }} />
              </div>

              <div className="px-6 pb-6 space-y-4 pt-4">
                <div className="space-y-0">
                  {[
                    { label: "Date", value: formatDate(viewExpense.date), icon: Clock },
                    { label: "Vendor", value: viewExpense.vendor, icon: FileText },
                    { label: "Description", value: viewExpense.description, icon: StickyNote },
                    { label: "Category", value: viewExpense.categoryName, icon: Tag },
                    { label: "Project", value: viewExpense.projectName, icon: FolderOpen },
                    { label: "Client", value: viewExpense.clientName, icon: DollarSign },
                    { label: "Submitted by", value: viewExpense.userName, icon: Send },
                  ].filter(r => r.value).map(r => {
                    const RowIcon = r.icon;
                    return (
                      <div key={r.label} className="flex items-center gap-3 py-2.5" style={{ borderBottom: "1px solid var(--lux-border)" }}>
                        <RowIcon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "var(--lux-text-muted)", opacity: 0.6 }} />
                        <span className="text-xs" style={{ color: "var(--lux-text-muted)" }}>{r.label}</span>
                        <span className="ml-auto text-sm font-medium text-right" style={{ color: "var(--lux-text)" }}>{r.value}</span>
                      </div>
                    );
                  })}
                </div>

                {(() => {
                  const allReceipts: { url: string; filename: string }[] = [];
                  if (viewExpense.receiptUrl) allReceipts.push({ url: viewExpense.receiptUrl, filename: viewExpense.receiptFilename || "Receipt" });
                  if (viewExpense.additionalReceiptUrls) { try { allReceipts.push(...JSON.parse(viewExpense.additionalReceiptUrls)); } catch {} }
                  if (allReceipts.length === 0) return null;
                  return (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Receipt className="w-3.5 h-3.5" style={{ color: "#a855f7" }} />
                        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>
                          {allReceipts.length === 1 ? "Attached Receipt" : `${allReceipts.length} Attached Receipts`}
                        </span>
                      </div>
                      <div className={allReceipts.length > 1 ? "grid grid-cols-2 gap-2" : ""}>
                        {allReceipts.map((r, i) => (
                          <div key={i}>
                            {r.url.startsWith("/api/uploads/receipts/") && !r.url.endsWith(".pdf") ? (
                              <div
                                className="relative rounded-xl overflow-hidden cursor-pointer group"
                                style={{ border: "1px solid rgba(168,85,247,0.2)", background: "var(--lux-bg)" }}
                                onClick={() => setReceiptZoomUrl(r.url)}
                                data-testid={`thumbnail-receipt-${i}`}
                              >
                                <img src={r.url} alt={r.filename} className="w-full max-h-40 object-contain transition-transform duration-300 group-hover:scale-[1.02]" style={{ background: "var(--lux-bg)" }} />
                                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200" style={{ background: "rgba(0,0,0,0.3)" }}>
                                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold text-white" style={{ background: "rgba(168,85,247,0.8)", backdropFilter: "blur(8px)" }}>
                                    <ZoomIn className="w-3.5 h-3.5" /> Zoom
                                  </div>
                                </div>
                                {i === 0 && allReceipts.length > 1 && <div className="absolute bottom-0 left-0 right-0 px-1 py-0.5 text-center text-[8px] font-bold text-white" style={{ background: "rgba(168,85,247,0.85)" }}>PRIMARY</div>}
                              </div>
                            ) : (
                              <div className="flex items-center gap-3 p-3 rounded-xl cursor-pointer hover:opacity-80" style={{ background: "rgba(168,85,247,0.04)", border: "1px solid rgba(168,85,247,0.15)" }} onClick={() => { if (isValidInternalUrl(r.url)) window.open(r.url, "_blank"); }}>
                                <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "rgba(168,85,247,0.1)" }}>
                                  <FileText className="w-5 h-5" style={{ color: "#a855f7" }} />
                                </div>
                                <span className="text-xs font-medium flex-1 truncate" style={{ color: "var(--lux-text)" }}>{r.filename}</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {viewExpense.notes && (
                  <div className="rounded-xl p-3" style={{ background: "rgba(245,158,11,0.04)", border: "1px solid rgba(245,158,11,0.12)" }}>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <StickyNote className="w-3 h-3" style={{ color: "#f59e0b" }} />
                      <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#f59e0b" }}>Notes</span>
                    </div>
                    <p className="text-xs leading-relaxed" style={{ color: "var(--lux-text)" }}>{viewExpense.notes}</p>
                  </div>
                )}

                {viewExpense.rejectionReason && (
                  <div className="rounded-xl p-4 relative overflow-hidden" style={{ background: "linear-gradient(135deg, rgba(239,68,68,0.06) 0%, rgba(239,68,68,0.02) 100%)", border: "1px solid rgba(239,68,68,0.2)" }}>
                    <div className="absolute top-0 left-0 w-1 h-full" style={{ background: "#ef4444" }} />
                    <div className="flex items-center gap-2 mb-2 pl-2">
                      <AlertTriangle className="w-4 h-4" style={{ color: "#ef4444" }} />
                      <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "#ef4444" }}>Rejection Reason</span>
                    </div>
                    <p className="text-sm pl-2 leading-relaxed" style={{ color: "var(--lux-text)" }}>{viewExpense.rejectionReason}</p>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {receiptZoomUrl && (
        <div
          className="fixed inset-0 flex items-center justify-center cursor-pointer"
          style={{ zIndex: "var(--z-modal)", background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)" }}
          onClick={() => setReceiptZoomUrl(null)}
          data-testid="receipt-zoom-overlay"
        >
          <div className="relative max-w-[90vw] max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <img src={receiptZoomUrl} alt="Receipt zoom" className="max-w-full max-h-[85vh] rounded-xl object-contain shadow-2xl" style={{ border: "2px solid rgba(168,85,247,0.3)" }} />
            <button
              className="absolute -top-3 -right-3 w-8 h-8 rounded-full flex items-center justify-center text-white shadow-lg transition-transform hover:scale-110"
              style={{ background: "rgba(239,68,68,0.9)" }}
              onClick={() => setReceiptZoomUrl(null)}
              data-testid="button-close-zoom"
              aria-label="Close zoom"
            >
              <X className="w-4 h-4" />
            </button>
            <button
              className="absolute bottom-3 right-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white shadow-lg transition-transform hover:scale-105"
              style={{ background: "rgba(168,85,247,0.8)", backdropFilter: "blur(8px)" }}
              onClick={() => window.open(receiptZoomUrl, "_blank")}
              data-testid="button-open-original"
            >
              <ExternalLink className="w-3.5 h-3.5" /> Open Original
            </button>
          </div>
        </div>
      )}

      <Dialog open={!!rejectId} onOpenChange={(open) => !open && setRejectId(null)}>
        <DialogContent className="sm:max-w-sm" style={{ background: "var(--lux-surface)" }}>
          <DialogHeader>
            <DialogTitle style={{ color: "var(--lux-text)" }}>Reject Expense</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <Textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Reason for rejection..." rows={3} data-testid="input-reject-reason" />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRejectId(null)}>Cancel</Button>
              <Button style={{ background: "#ef4444", color: "#fff" }} disabled={!rejectReason.trim() || rejectMutation.isPending} onClick={() => rejectMutation.mutate()} data-testid="button-confirm-reject">
                Reject
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={bundleDialogOpen} onOpenChange={(open) => { if (!open) { setBundleDialogOpen(false); setBundleTitle(""); setBundlePurpose(""); } }}>
        <DialogContent className="sm:max-w-lg" style={{ background: "var(--lux-surface)" }}>
          <DialogHeader>
            <DialogTitle style={{ color: "var(--lux-text)" }}>Bundle into Expense Report</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label className="text-xs font-semibold mb-1.5 block" style={{ color: "var(--lux-text-muted)" }}>Report Title *</Label>
              <Input value={bundleTitle} onChange={e => setBundleTitle(e.target.value)} placeholder="e.g. Q1 Travel Expenses" data-testid="input-bundle-title" />
            </div>
            <div>
              <Label className="text-xs font-semibold mb-1.5 block" style={{ color: "var(--lux-text-muted)" }}>Purpose</Label>
              <Textarea value={bundlePurpose} onChange={e => setBundlePurpose(e.target.value)} placeholder="Optional description or purpose..." rows={2} data-testid="input-bundle-purpose" />
            </div>
            <div className="rounded-lg p-3 space-y-1.5" style={{ background: "var(--lux-bg)", border: "1px solid var(--lux-border)" }}>
              <p className="text-xs font-semibold" style={{ color: "var(--lux-text-muted)" }}>Summary</p>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {(expenseList || []).filter(e => gridSelectedIds.has(e.id)).map((e: any) => (
                  <div key={e.id} className="flex items-center justify-between text-xs py-0.5" style={{ color: "var(--lux-text)" }}>
                    <span className="truncate mr-2">{e.vendor || e.description || "Expense"} — {formatDate(e.date)}</span>
                    <span className="font-mono tabular-nums flex-shrink-0">{formatMoney(Number(e.amount), baseCurrency)}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between pt-2 text-sm font-bold" style={{ borderTop: "1px solid var(--lux-border)", color: "var(--lux-text)" }}>
                <span>{gridSelectedIds.size} expense{gridSelectedIds.size !== 1 ? "s" : ""}</span>
                <span className="font-mono tabular-nums">
                  {formatMoney(
                    (expenseList || []).filter(e => gridSelectedIds.has(e.id)).reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0),
                    baseCurrency
                  )}
                </span>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setBundleDialogOpen(false)} data-testid="button-bundle-cancel">Cancel</Button>
              <Button disabled={!bundleTitle.trim() || bundleMutation.isPending} onClick={() => bundleMutation.mutate()} data-testid="button-bundle-submit">
                {bundleMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
                Create Report
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
