import { useState, useMemo, useRef, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FormSection } from "@/components/shared/form-section";
import { AddressInput } from "@/components/shared/address-input";
import { formatMoney } from "@/components/shared/format";
import { useBaseCurrency } from "@/hooks/use-base-currency";
import { CURRENCIES } from "../../../shared/currencies";
import type { Client, ClientContact } from "@shared/schema";
import { format, differenceInDays } from "date-fns";
import { useDocumentTitle } from "@/lib/use-document-title";
import {
  Plus, Pencil, Trash2, Mail, Phone, Globe, Star, UserPlus, MoreHorizontal,
  Contact, TrendingUp, AlertCircle, DollarSign, Briefcase, FileText, Clock,
  CreditCard, Send, Download, Eye, Copy, Link as LinkIcon, LayoutDashboard, Receipt,
  Timer, CheckCircle2, XCircle, Activity as ActivityIcon, StickyNote, Pin,
  ArrowLeft, ExternalLink,
} from "lucide-react";

interface ClientDetailData {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  website: string | null;
  logoUrl: string | null;
  orgId: string;
  createdAt: string;
  currency?: string;
  portalToken?: string;
  projects: Array<{ id: string; name: string; status: string; totalMinutes?: number; members?: Array<{ name: string }> }>;
  invoices: Array<{ id: string; number: string; total: string; paidAmount?: string; status: string; issuedDate?: string; dueDate?: string }>;
  recentTimeEntries: Array<{ id: string; date: string; minutes: number; projectName: string; userName: string; billable?: boolean; notes?: string }>;
  totalBilled: number;
  totalPaid: number;
  outstanding: number;
  hasOverdue: boolean;
  hasOverpayment?: boolean;
  healthScore?: number;
}

interface ClientNoteItem {
  id: string;
  body: string;
  isPinned: boolean;
  authorId: string;
  authorName: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ClientActivityItem {
  id: string;
  type: string;
  title: string;
  description: string | null;
  linkUrl: string | null;
  metadata: any;
  userId: string | null;
  userName: string | null;
  createdAt: string;
}

type DetailTab = "overview" | "invoices" | "projects" | "time" | "contacts" | "activity" | "notes";

const INVOICE_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  DRAFT: { bg: "rgba(107,114,128,0.1)", text: "#6b7280" },
  SENT: { bg: "rgba(59,130,246,0.1)", text: "#3b82f6" },
  OVERDUE: { bg: "rgba(239,68,68,0.1)", text: "#ef4444" },
  PARTIAL: { bg: "rgba(249,115,22,0.1)", text: "#f97316" },
  PAID: { bg: "rgba(34,197,94,0.1)", text: "#22c55e" },
  VOID: { bg: "rgba(75,85,99,0.15)", text: "#4b5563" },
};

const PROJECT_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  ACTIVE: { bg: "rgba(34,197,94,0.1)", text: "#22c55e" },
  COMPLETED: { bg: "rgba(59,130,246,0.1)", text: "#3b82f6" },
  ON_HOLD: { bg: "rgba(234,179,8,0.1)", text: "#eab308" },
};

const ACTIVITY_ICONS: Record<string, { icon: any; color: string; bg: string }> = {
  INVOICE_CREATED: { icon: FileText, color: "#3b82f6", bg: "rgba(59,130,246,0.1)" },
  PAYMENT_RECORDED: { icon: DollarSign, color: "#22c55e", bg: "rgba(34,197,94,0.1)" },
  CONTACT_ADDED: { icon: UserPlus, color: "#8b5cf6", bg: "rgba(139,92,246,0.1)" },
  PORTAL_REGENERATED: { icon: LinkIcon, color: "var(--lux-gold)", bg: "rgba(var(--lux-gold-rgb),0.1)" },
  NOTE_ADDED: { icon: StickyNote, color: "#f59e0b", bg: "rgba(245,158,11,0.1)" },
  TIME_LOGGED: { icon: Clock, color: "#22c55e", bg: "rgba(34,197,94,0.1)" },
};

function HealthGauge({ score, display }: { score: number; display?: number }) {
  const pct = Math.max(0, Math.min(100, score));
  const shown = Math.max(0, Math.min(100, display ?? score));
  const color = pct >= 75 ? "#22c55e" : pct >= 50 ? "var(--lux-gold)" : pct >= 25 ? "#f97316" : "#ef4444";
  const label = pct >= 75 ? "Excellent" : pct >= 50 ? "Healthy" : pct >= 25 ? "At Risk" : "Critical";
  const radius = 54;
  const circ = Math.PI * radius;
  const offset = circ - (pct / 100) * circ;
  return (
    <div className="flex flex-col items-center" data-testid="health-gauge">
      <div className="relative" style={{ width: 140, height: 80 }}>
        <svg width="140" height="80" viewBox="0 0 140 80">
          <path
            d="M 16 70 A 54 54 0 0 1 124 70"
            stroke="var(--lux-border)"
            strokeWidth="10"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M 16 70 A 54 54 0 0 1 124 70"
            stroke={color}
            strokeWidth="10"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 0.6s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-end pb-1">
          <span className="text-2xl font-bold tabular-nums" style={{ color }} data-testid="text-health-score">{shown}</span>
          <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>/ 100</span>
        </div>
      </div>
      <span className="text-xs font-semibold mt-1" style={{ color }} data-testid="text-health-label">{label}</span>
    </div>
  );
}

function computeHealthScore(d: ClientDetailData | undefined): number {
  if (!d) return 0;
  let score = 100;
  if (d.hasOverdue) score -= 30;
  const collectionRate = d.totalBilled > 0 ? d.totalPaid / d.totalBilled : 1;
  if (collectionRate < 0.5) score -= 25;
  else if (collectionRate < 0.8) score -= 10;
  if (d.outstanding > 10000) score -= 15;
  else if (d.outstanding > 5000) score -= 8;
  const hasRecentActivity = d.recentTimeEntries.length > 0 || d.invoices.some(i => {
    const iss = i.issuedDate ? new Date(i.issuedDate) : null;
    return iss && differenceInDays(new Date(), iss) <= 90;
  });
  if (!hasRecentActivity) score -= 20;
  if (d.projects.filter(p => p.status === "ACTIVE").length === 0) score -= 10;
  return Math.max(0, Math.min(100, score));
}

export default function ClientDetailPage() {
  const params = useParams<{ id: string }>();
  const clientId = params.id;
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const baseCurrency = useBaseCurrency();
  const { toast } = useToast();
  const canManage = user?.role === "ADMIN" || user?.role === "MANAGER";

  const { data: clientDetail, isLoading: detailLoading, isError: detailError } = useQuery<ClientDetailData>({
    queryKey: ["/api/clients", clientId],
    enabled: !!clientId,
    retry: false,
  });

  useDocumentTitle(clientDetail ? `${clientDetail.name} — Client` : "Client");

  const { data: contacts } = useQuery<ClientContact[]>({
    queryKey: ["/api/clients", clientId, "contacts"],
    enabled: !!clientId,
    queryFn: async () => {
      const res = await fetch(`/api/clients/${clientId}/contacts`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch contacts");
      return res.json();
    },
  });

  const { data: notes } = useQuery<ClientNoteItem[]>({
    queryKey: ["/api/clients", clientId, "notes"],
    enabled: !!clientId,
    queryFn: async () => {
      const res = await fetch(`/api/clients/${clientId}/notes`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch notes");
      return res.json();
    },
  });

  const [activityFilters, setActivityFilters] = useState<Record<string, boolean>>({});
  const [activityLimit, setActivityLimit] = useState<number>(50);
  const [timeRange, setTimeRange] = useState<"7d" | "30d" | "90d" | "month" | "all">("30d");
  const activeTypes = useMemo(
    () => Object.keys(activityFilters).filter(k => activityFilters[k]),
    [activityFilters]
  );
  const activityQueryKey = useMemo(
    () => ["/api/clients", clientId, "activities", { types: activeTypes.join(","), limit: activityLimit }],
    [clientId, activeTypes, activityLimit]
  );
  const { data: activities } = useQuery<ClientActivityItem[]>({
    queryKey: activityQueryKey,
    enabled: !!clientId,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("limit", String(activityLimit));
      if (activeTypes.length > 0) params.set("types", activeTypes.join(","));
      const res = await fetch(`/api/clients/${clientId}/activities?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch activities");
      return res.json();
    },
  });

  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editWebsite, setEditWebsite] = useState("");
  const [editCurrency, setEditCurrency] = useState("USD");

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteContactOpen, setDeleteContactOpen] = useState(false);
  const [deleteContactId, setDeleteContactId] = useState<string | null>(null);
  const [portalToken, setPortalToken] = useState<string | null>(null);

  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<ClientContact | null>(null);
  const [contactFirstName, setContactFirstName] = useState("");
  const [contactLastName, setContactLastName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactRole, setContactRole] = useState("");
  const [contactIsPrimary, setContactIsPrimary] = useState(false);
  const [contactNotes, setContactNotes] = useState("");

  const [createInvoiceOpen, setCreateInvoiceOpen] = useState(false);
  const [recordPaymentOpen, setRecordPaymentOpen] = useState(false);
  const [newInvDescription, setNewInvDescription] = useState("");
  const [newInvQty, setNewInvQty] = useState("1");
  const [newInvRate, setNewInvRate] = useState("");
  const [newInvLineItems, setNewInvLineItems] = useState<Array<{ description: string; quantity: number; rate: number }>>([]);
  const [newInvDiscount, setNewInvDiscount] = useState("");
  const [newInvTaxRate, setNewInvTaxRate] = useState("");
  const [newInvNotes, setNewInvNotes] = useState("");
  const [newInvIssueDate, setNewInvIssueDate] = useState<Date>(new Date());
  const [newInvDueDate, setNewInvDueDate] = useState<Date>(new Date(Date.now() + 30 * 86400000));
  const [newInvIssueDateOpen, setNewInvIssueDateOpen] = useState(false);
  const [newInvDueDateOpen, setNewInvDueDateOpen] = useState(false);

  const [payInvoiceId, setPayInvoiceId] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("CHECK");
  const [payDate, setPayDate] = useState<Date>(new Date());
  const [payDateOpen, setPayDateOpen] = useState(false);
  const [payReference, setPayReference] = useState("");
  const [payNotes, setPayNotes] = useState("");

  const [noteBody, setNoteBody] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteBody, setEditingNoteBody] = useState("");

  function invalidateClient() {
    queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId] });
    queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "activities"] });
  }

  const editMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/clients/${clientId}`, {
        name: editName,
        email: editEmail || null,
        phone: editPhone || null,
        address: editAddress || null,
        website: editWebsite || null,
        currency: editCurrency,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      invalidateClient();
      setIsEditing(false);
      toast({ title: "Client updated successfully" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => { await apiRequest("DELETE", `/api/clients/${clientId}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({ title: "Client deleted" });
      navigate("/clients");
    },
    onError: (err: any) => toast({ title: "Cannot delete", description: err.message, variant: "destructive" }),
  });

  const generatePortalLinkMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/clients/${clientId}/generate-portal-link`);
      return res.json();
    },
    onSuccess: (data: { portalToken: string }) => {
      setPortalToken(data.portalToken);
      invalidateClient();
      toast({ title: "Portal link generated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const saveContactMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        firstName: contactFirstName, lastName: contactLastName,
        email: contactEmail || null, phone: contactPhone || null,
        role: contactRole || null, isPrimary: contactIsPrimary, notes: contactNotes || null,
      };
      if (editingContact) {
        await apiRequest("PATCH", `/api/clients/${clientId}/contacts/${editingContact.id}`, payload);
      } else {
        await apiRequest("POST", `/api/clients/${clientId}/contacts`, payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "contacts"] });
      invalidateClient();
      setContactDialogOpen(false);
      resetContactForm();
      toast({ title: editingContact ? "Contact updated" : "Contact added" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteContactMutation = useMutation({
    mutationFn: async (contactId: string) => { await apiRequest("DELETE", `/api/clients/${clientId}/contacts/${contactId}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "contacts"] });
      toast({ title: "Contact deleted" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  function resetContactForm() {
    setEditingContact(null);
    setContactFirstName(""); setContactLastName(""); setContactEmail("");
    setContactPhone(""); setContactRole(""); setContactIsPrimary(false); setContactNotes("");
  }
  function openAddContact() { resetContactForm(); setContactDialogOpen(true); }
  function openEditContact(c: ClientContact) {
    setEditingContact(c);
    setContactFirstName(c.firstName); setContactLastName(c.lastName);
    setContactEmail(c.email || ""); setContactPhone(c.phone || "");
    setContactRole(c.role || ""); setContactIsPrimary(c.isPrimary); setContactNotes(c.notes || "");
    setContactDialogOpen(true);
  }
  function startEditing() {
    if (!clientDetail) return;
    setEditName(clientDetail.name);
    setEditEmail(clientDetail.email || "");
    setEditPhone(clientDetail.phone || "");
    setEditAddress(clientDetail.address || "");
    setEditWebsite(clientDetail.website || "");
    setEditCurrency(clientDetail.currency || "USD");
    setIsEditing(true);
  }

  const createInvoiceMutation = useMutation({
    mutationFn: async () => {
      const subtotal = newInvLineItems.reduce((s, li) => s + li.quantity * li.rate, 0);
      const discountAmount = newInvDiscount ? parseFloat(newInvDiscount) : 0;
      const taxRate = newInvTaxRate ? parseFloat(newInvTaxRate) : 0;
      await apiRequest("POST", "/api/invoices", {
        clientId,
        issuedDate: format(newInvIssueDate, "yyyy-MM-dd"),
        dueDate: format(newInvDueDate, "yyyy-MM-dd"),
        lineItems: newInvLineItems.map(li => ({ description: li.description, quantity: li.quantity, unitPrice: li.rate })),
        discountType: discountAmount > 0 ? "FIXED" : "NONE",
        discountValue: discountAmount,
        taxRate,
        notes: newInvNotes || null,
      });
    },
    onSuccess: () => {
      invalidateClient();
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ar/outstanding"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      setCreateInvoiceOpen(false);
      setNewInvLineItems([]); setNewInvDiscount(""); setNewInvTaxRate(""); setNewInvNotes("");
      toast({ title: "Invoice created successfully" });
    },
    onError: (err: any) => toast({ title: "Error creating invoice", description: err.message, variant: "destructive" }),
  });

  const recordPaymentMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/payments", {
        invoiceId: payInvoiceId,
        amount: parseFloat(payAmount),
        method: payMethod,
        date: format(payDate, "yyyy-MM-dd"),
        referenceNumber: payReference || null,
        notes: payNotes || null,
      });
    },
    onSuccess: () => {
      invalidateClient();
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ar/outstanding"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      setRecordPaymentOpen(false);
      setPayInvoiceId(""); setPayAmount(""); setPayReference(""); setPayNotes("");
      toast({ title: "Payment recorded successfully" });
    },
    onError: (err: any) => toast({ title: "Error recording payment", description: err.message, variant: "destructive" }),
  });

  const createNoteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/clients/${clientId}/notes`, { body: noteBody });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "notes"] });
      invalidateClient();
      setNoteBody("");
      toast({ title: "Note added" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateNoteMutation = useMutation({
    mutationFn: async (payload: { id: string; body?: string; isPinned?: boolean }) => {
      const { id, ...rest } = payload;
      await apiRequest("PATCH", `/api/clients/${clientId}/notes/${id}`, rest);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "notes"] });
      setEditingNoteId(null);
      setEditingNoteBody("");
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteNoteMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/clients/${clientId}/notes/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "notes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "activities"] });
      toast({ title: "Note deleted" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteActivityMutation = useMutation({
    mutationFn: async (activityId: string) => {
      await apiRequest("DELETE", `/api/clients/${clientId}/activities/${activityId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "activities"] });
      toast({ title: "Activity deleted" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  function handleDeleteActivity(rawId: string) {
    if (window.confirm("Delete this activity entry?")) {
      deleteActivityMutation.mutate(rawId);
    }
  }

  const healthScore = useMemo(() => {
    if (clientDetail && typeof clientDetail.healthScore === "number") return clientDetail.healthScore;
    return computeHealthScore(clientDetail);
  }, [clientDetail]);
  const [displayHealth, setDisplayHealth] = useState(0);
  useEffect(() => {
    const target = healthScore;
    let raf = 0;
    const start = performance.now();
    const from = displayHealth;
    const dur = 600;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplayHealth(Math.round(from + (target - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    
  }, [healthScore]);

  const mergedActivity = useMemo(() => {
    const items: Array<{ id: string; rawId: string; ts: string; icon: any; color: string; bg: string; title: string; subtitle: string; linkUrl?: string | null }> = [];
    (activities || []).forEach(a => {
      const meta = ACTIVITY_ICONS[a.type] || { icon: ActivityIcon, color: "var(--lux-accent)", bg: "rgba(var(--lux-gold-rgb),0.1)" };
      items.push({
        id: `a-${a.id}`,
        rawId: a.id,
        ts: a.createdAt,
        icon: meta.icon, color: meta.color, bg: meta.bg,
        title: a.title,
        subtitle: [a.description, a.userName].filter(Boolean).join(" • "),
        linkUrl: a.linkUrl,
      });
    });
    return items;
  }, [activities]);

  if (detailLoading) {
    return (
      <div className="px-6 lg:px-8 xl:px-10 py-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    );
  }

  if (detailError || !clientDetail) {
    return (
      <div className="px-6 lg:px-8 xl:px-10 py-10 flex flex-col items-center justify-center text-center gap-4" data-testid="state-client-not-found">
        <div className="text-lg font-semibold text-foreground">Client not found</div>
        <div className="text-sm text-muted-foreground max-w-md">
          This client may have been deleted, or you may not have access to it.
        </div>
        <Button variant="outline" onClick={() => navigate("/clients")} data-testid="button-back-to-clients">
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Clients
        </Button>
      </div>
    );
  }

  const tabs: Array<{ id: DetailTab; label: string; icon: any; count?: number }> = [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "invoices", label: "Invoices", icon: FileText, count: clientDetail.invoices.length },
    { id: "projects", label: "Projects", icon: Briefcase, count: clientDetail.projects.length },
    { id: "time", label: "Time & Billing", icon: Timer },
    { id: "contacts", label: "Contacts", icon: Contact, count: contacts?.length || 0 },
    { id: "activity", label: "Activity", icon: ActivityIcon, count: mergedActivity.length },
    { id: "notes", label: "Notes", icon: StickyNote, count: notes?.length || 0 },
  ];

  return (
    <div className="px-6 lg:px-8 xl:px-10 py-6 space-y-5">
      <PageBreadcrumbs
        page={clientDetail.name}
        showDashboard={false}
        items={[{ label: "Clients", href: "/clients", testId: "button-back-clients", withBackArrow: true }]}
      />

      <div className="grid grid-cols-1 xl:grid-cols-[380px,1fr] gap-5">
        <aside className="space-y-4">
          <div
            className="rounded-xl p-5 border"
            style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)", borderTop: "3px solid var(--lux-gold)", boxShadow: "var(--lux-card-shadow)" }}
            data-testid="hero-card"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-14 h-14 rounded-xl flex items-center justify-center text-lg font-bold text-white shrink-0"
                style={{ background: "var(--gradient-brand)" }}
                data-testid="hero-avatar"
              >
                {clientDetail.name.split(" ").map(w => w[0]).join("").substring(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-bold truncate" style={{ color: "var(--lux-text)" }} data-testid="hero-client-name">
                  {clientDetail.name}
                </h2>
                <span
                  className="inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
                  style={{
                    background: clientDetail.hasOverdue ? "rgba(239,68,68,0.12)" : "rgba(34,197,94,0.12)",
                    color: clientDetail.hasOverdue ? "#ef4444" : "#22c55e",
                  }}
                  data-testid="badge-client-status"
                >
                  {clientDetail.hasOverdue ? "AT RISK" : "ACTIVE"}
                </span>
              </div>
            </div>

            <div className="flex justify-center py-2 border-t border-b" style={{ borderColor: "var(--lux-border)" }}>
              <HealthGauge score={healthScore} display={displayHealth} />
            </div>

            <div className="flex flex-col gap-1.5 mt-3 text-xs" style={{ color: "var(--lux-text-muted)" }}>
              {clientDetail.email && <span className="flex items-center gap-2"><Mail className="w-3 h-3" />{clientDetail.email}</span>}
              {clientDetail.phone && <span className="flex items-center gap-2"><Phone className="w-3 h-3" />{clientDetail.phone}</span>}
              {clientDetail.website && (
                <a href={clientDetail.website.match(/^https?:\/\//) ? clientDetail.website : `https://${clientDetail.website}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:underline" style={{ color: "var(--lux-accent)" }}>
                  <Globe className="w-3 h-3" />{clientDetail.website}
                </a>
              )}
              <span className="flex items-center gap-2" data-testid="text-client-since">
                <Clock className="w-3 h-3" />
                Client since {(() => { try { return format(new Date(clientDetail.createdAt), "MMM d, yyyy"); } catch { return String(clientDetail.createdAt).slice(0, 10); } })()}
              </span>
              <span className="flex items-center gap-2" data-testid="text-last-activity">
                <ActivityIcon className="w-3 h-3" />
                Last activity {mergedActivity.length > 0
                  ? (() => { try { return format(new Date(mergedActivity[0].ts), "MMM d, yyyy"); } catch { return String(mergedActivity[0].ts).slice(0, 10); } })()
                  : "—"}
              </span>
            </div>

            {contacts && contacts.find(c => c.isPrimary) && (() => {
              const primary = contacts.find(c => c.isPrimary)!;
              return (
                <div
                  className="mt-3 rounded-lg border p-3"
                  style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)" }}
                  data-testid="primary-contact-card"
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <Star className="w-3 h-3 fill-current" style={{ color: "#f59e0b" }} />
                    <span className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Primary Contact</span>
                  </div>
                  <div className="text-xs font-semibold" style={{ color: "var(--lux-text)" }} data-testid="text-primary-contact-name">
                    {primary.firstName} {primary.lastName}
                  </div>
                  {primary.role && (
                    <div className="text-[10px] mt-0.5" style={{ color: "var(--lux-text-muted)" }}>{primary.role}</div>
                  )}
                  <div className="flex flex-col gap-1 mt-1.5 text-[11px]" style={{ color: "var(--lux-text-muted)" }}>
                    {primary.email && (
                      <a href={`mailto:${primary.email}`} className="flex items-center gap-1.5 hover:underline">
                        <Mail className="w-3 h-3" />{primary.email}
                      </a>
                    )}
                    {primary.phone && (
                      <a href={`tel:${primary.phone}`} className="flex items-center gap-1.5 hover:underline">
                        <Phone className="w-3 h-3" />{primary.phone}
                      </a>
                    )}
                  </div>
                </div>
              );
            })()}

            {healthScore < 50 && (
              <div
                className="mt-3 rounded-lg border p-3 flex items-start gap-2"
                style={{ background: "rgba(239,68,68,0.08)", borderColor: "rgba(239,68,68,0.35)" }}
                data-testid="health-warning-panel"
                role="alert"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#ef4444" }} />
                <div className="text-[11px]" style={{ color: "#ef4444" }}>
                  <div className="font-semibold mb-0.5">Client health needs attention</div>
                  <div style={{ color: "rgba(239,68,68,0.85)" }}>
                    Health score is {healthScore}. Review outstanding balances, overdue invoices, and recent activity.
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 mt-4">
              {[
                { label: "Revenue", value: formatMoney(clientDetail.totalBilled, baseCurrency), icon: TrendingUp, color: "var(--lux-accent)" },
                { label: "Outstanding", value: formatMoney(clientDetail.outstanding, baseCurrency), icon: AlertCircle, color: clientDetail.outstanding > 0 ? "#ef4444" : "var(--lux-text-muted)" },
                { label: "Collected", value: formatMoney(clientDetail.totalPaid, baseCurrency), icon: DollarSign, color: "#22c55e" },
                { label: "Projects", value: String(clientDetail.projects.length), icon: Briefcase, color: "#8b5cf6" },
              ].map(kpi => (
                <div key={kpi.label}
                  className="rounded-lg p-2.5 border"
                  style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)" }}
                  data-testid={`kpi-${kpi.label.toLowerCase().replace(/\s/g, "-")}`}
                >
                  <div className="flex items-center gap-1 mb-0.5">
                    <kpi.icon className="w-3 h-3" style={{ color: kpi.color }} />
                    <span className="text-[9px] font-medium uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>{kpi.label}</span>
                  </div>
                  <span className="text-sm font-bold" style={{ color: kpi.color }}>{kpi.value}</span>
                </div>
              ))}
            </div>
          </div>

          {canManage && (
            <TooltipProvider>
              <div
                className="flex flex-col gap-2 p-3 rounded-xl border"
                style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}
                data-testid="quick-actions-bar"
              >
                <Button size="sm" className="text-xs text-white h-8 justify-start" style={{ background: "var(--gradient-brand)" }} onClick={() => setCreateInvoiceOpen(true)} data-testid="button-quick-create-invoice">
                  <FileText className="w-3.5 h-3.5 mr-2" /> Create Invoice
                </Button>
                <Button variant="outline" size="sm" className="text-xs h-8 justify-start" onClick={() => {
                  const unpaid = clientDetail.invoices.filter(inv => !["DRAFT", "VOID", "PAID"].includes(inv.status));
                  if (unpaid.length > 0) setPayInvoiceId(unpaid[0].id);
                  setRecordPaymentOpen(true);
                }} data-testid="button-quick-record-payment">
                  <CreditCard className="w-3.5 h-3.5 mr-2" /> Record Payment
                </Button>
                <Button variant="outline" size="sm" className="text-xs h-8 justify-start" onClick={() => navigate("/time")} data-testid="button-quick-log-time">
                  <Clock className="w-3.5 h-3.5 mr-2" /> Log Time
                </Button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button variant="outline" size="sm" className="w-full text-xs h-8 justify-start opacity-50" disabled data-testid="button-quick-send-statement">
                        <Send className="w-3.5 h-3.5 mr-2" /> Send Statement
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Coming soon</TooltipContent>
                </Tooltip>
                <div className="flex gap-1.5 pt-1">
                  <Button variant="outline" size="sm" className="text-xs h-7 flex-1" onClick={startEditing} data-testid="button-edit-detail">
                    <Pencil className="w-3 h-3 mr-1" /> Edit
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="text-xs h-7" data-testid="button-more-actions" aria-label="More actions">
                        <MoreHorizontal className="w-3.5 h-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => {
                        const token = portalToken || clientDetail.portalToken;
                        if (token) window.open(`/portal/${token}`, "_blank");
                      }} data-testid="button-preview-portal">
                        <Eye className="w-3.5 h-3.5 mr-2" /> View Portal
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => {
                        const token = portalToken || clientDetail.portalToken;
                        if (token) {
                          navigator.clipboard.writeText(`${window.location.origin}/portal/${token}`);
                          toast({ title: "Portal link copied" });
                        }
                      }} data-testid="button-copy-portal-link">
                        <Copy className="w-3.5 h-3.5 mr-2" /> Copy Portal Link
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={generatePortalLinkMutation.isPending} onClick={() => generatePortalLinkMutation.mutate()} data-testid="button-regenerate-portal-link">
                        <LinkIcon className="w-3.5 h-3.5 mr-2" /> {generatePortalLinkMutation.isPending ? "Regenerating..." : "Regenerate Portal Link"}
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-red-600" onClick={() => setDeleteOpen(true)} data-testid="button-delete-detail" aria-label="Delete client">
                        <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete Client
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </TooltipProvider>
          )}
        </aside>

        <main className="space-y-4 min-w-0">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as DetailTab)}>
          <TabsList className="flex items-center gap-1 border-b overflow-x-auto bg-transparent p-0 h-auto rounded-none justify-start w-full" style={{ borderColor: "var(--lux-border)" }} data-testid="tab-bar">
            {tabs.map(tab => {
              const isActive = activeTab === tab.id;
              return (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  className="flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors -mb-px whitespace-nowrap bg-transparent data-[state=active]:shadow-none rounded-none"
                  style={{
                    borderColor: isActive ? "var(--lux-gold)" : "transparent",
                    color: isActive ? "var(--lux-gold)" : "var(--lux-text-muted)",
                    background: isActive ? `rgba(var(--lux-gold-rgb), 0.04)` : "transparent",
                  }}
                  data-testid={`tab-${tab.id}`}
                >
                  <tab.icon className="w-3.5 h-3.5" />
                  {tab.label}
                  {tab.count !== undefined && tab.count > 0 && (
                    <span
                      className="px-1.5 py-0.5 rounded-full text-[10px] font-bold"
                      style={{
                        background: isActive ? "rgba(var(--lux-gold-rgb), 0.12)" : "var(--lux-bg)",
                        color: isActive ? "var(--lux-gold)" : "var(--lux-text-muted)",
                      }}
                    >{tab.count}</span>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>

          {activeTab === "overview" && (
            <div className="space-y-4 lux-tab-content">
              <div className="rounded-lg border p-5" style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)", boxShadow: "var(--lux-card-shadow)" }} data-testid="financial-snapshot">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Financial Snapshot</h3>
                  <span className="text-[10px] font-semibold" style={{ color: "var(--lux-text-muted)" }}>
                    {clientDetail.totalBilled > 0 ? Math.round((clientDetail.totalPaid / clientDetail.totalBilled) * 100) : 0}% collected
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div data-testid="snapshot-billed">
                    <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--lux-text-muted)" }}>Total Billed</div>
                    <div className="text-xl font-bold tabular-nums" style={{ color: "var(--lux-text)" }} data-testid="text-detail-total-billed">{formatMoney(clientDetail.totalBilled, baseCurrency)}</div>
                  </div>
                  <div data-testid="snapshot-paid">
                    <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--lux-text-muted)" }}>Collected</div>
                    <div className="text-xl font-bold tabular-nums" style={{ color: "#22c55e" }} data-testid="text-detail-total-paid">{formatMoney(clientDetail.totalPaid, baseCurrency)}</div>
                  </div>
                  <div data-testid="snapshot-outstanding">
                    <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--lux-text-muted)" }}>Outstanding</div>
                    <div className="text-xl font-bold tabular-nums" style={{ color: clientDetail.outstanding > 0 ? "#ef4444" : "var(--lux-text-muted)" }} data-testid="text-detail-outstanding">{formatMoney(clientDetail.outstanding, baseCurrency)}</div>
                  </div>
                </div>
                {(() => {
                  const billed = clientDetail.totalBilled;
                  const paid = clientDetail.totalPaid;
                  const outstanding = Math.max(0, clientDetail.outstanding);
                  const total = Math.max(1, paid + outstanding);
                  const paidPct = (paid / total) * 100;
                  const outPct = (outstanding / total) * 100;
                  return (
                    <div data-testid="snapshot-bar">
                      <div className="flex w-full h-3 rounded-full overflow-hidden" style={{ background: "var(--lux-border)" }}>
                        {paidPct > 0 && (
                          <div className="h-full transition-all duration-500" style={{ width: `${paidPct}%`, background: "#22c55e" }} />
                        )}
                        {outPct > 0 && (
                          <div className="h-full transition-all duration-500" style={{ width: `${outPct}%`, background: "#ef4444" }} />
                        )}
                      </div>
                      <div className="flex items-center gap-4 mt-2 text-[10px]" style={{ color: "var(--lux-text-muted)" }}>
                        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: "#22c55e" }} />Paid {billed > 0 ? Math.round((paid / billed) * 100) : 0}%</span>
                        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: "#ef4444" }} />Outstanding {billed > 0 ? Math.round((outstanding / billed) * 100) : 0}%</span>
                        <span className="ml-auto flex items-center gap-1.5"><Briefcase className="w-3 h-3" />{clientDetail.projects.length} project{clientDetail.projects.length !== 1 ? "s" : ""}</span>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {(() => {
                const now = new Date();
                const aging = { current: 0, days30: 0, days60: 0, days90: 0 };
                clientDetail.invoices.forEach(inv => {
                  if (["DRAFT", "VOID", "PAID"].includes(inv.status)) return;
                  const outstanding = Number(inv.total) - Number(inv.paidAmount || 0);
                  if (outstanding <= 0) return;
                  const dueDate = inv.dueDate ? new Date(inv.dueDate + "T00:00:00") : null;
                  if (!dueDate || dueDate >= now) { aging.current += outstanding; return; }
                  const days = differenceInDays(now, dueDate);
                  if (days <= 30) aging.days30 += outstanding;
                  else if (days <= 60) aging.days60 += outstanding;
                  else aging.days90 += outstanding;
                });
                const hasAging = aging.current > 0 || aging.days30 > 0 || aging.days60 > 0 || aging.days90 > 0;
                if (!hasAging) return null;
                return (
                  <div className="rounded-lg border p-4" style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)" }} data-testid="ar-aging">
                    <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--lux-text-muted)" }}>AR Aging</h3>
                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { label: "Current", value: aging.current, color: "#22c55e" },
                        { label: "1-30 Days", value: aging.days30, color: "#f59e0b" },
                        { label: "31-60 Days", value: aging.days60, color: "#f97316" },
                        { label: "90+ Days", value: aging.days90, color: "#ef4444" },
                      ].map(bucket => (
                        <div key={bucket.label} className="text-center">
                          <div className="text-[10px] mb-1" style={{ color: "var(--lux-text-muted)" }}>{bucket.label}</div>
                          <div className="text-sm font-bold" style={{ color: bucket.value > 0 ? bucket.color : "var(--lux-text-muted)" }}>
                            {formatMoney(bucket.value, baseCurrency)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              <div className="rounded-lg border p-4" style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)" }} data-testid="recent-activity-timeline">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Recent Activity</h3>
                  {mergedActivity.length > 6 && (
                    <button className="text-[10px] hover:underline" style={{ color: "var(--lux-accent)" }} onClick={() => setActiveTab("activity")} data-testid="button-view-all-activity">View all</button>
                  )}
                </div>
                {mergedActivity.length === 0 ? (
                  <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>No recent activity.</p>
                ) : (
                  <div className="relative">
                    <div className="absolute left-[11px] top-2 bottom-2 w-px" style={{ background: "var(--lux-border)" }} />
                    <div className="space-y-3">
                      {mergedActivity.slice(0, 6).map(item => (
                        <div key={item.id} className="flex items-start gap-3 relative group">
                          <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 z-10" style={{ background: item.bg }}>
                            <item.icon className="w-3 h-3" style={{ color: item.color }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium" style={{ color: "var(--lux-text)" }}>{item.title}</div>
                            {item.subtitle && <div className="text-[10px]" style={{ color: "var(--lux-text-muted)" }}>{item.subtitle}</div>}
                          </div>
                          <span className="text-[10px] shrink-0" style={{ color: "var(--lux-text-muted)" }}>
                            {(() => { try { return format(new Date(item.ts), "MMM d"); } catch { return String(item.ts).slice(0, 10); } })()}
                          </span>
                          {canManage && (
                            <button
                              type="button"
                              onClick={() => handleDeleteActivity(item.rawId)}
                              disabled={deleteActivityMutation.isPending}
                              className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 p-1 rounded hover:bg-[rgba(var(--lux-gold-rgb),0.08)]"
                              style={{ color: "var(--lux-text-muted)" }}
                              title="Delete activity"
                              aria-label="Delete activity"
                              data-testid={`button-delete-activity-recent-${item.rawId}`}
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "invoices" && (
            <div className="space-y-4 lux-tab-content">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>
                    {clientDetail.invoices.length} invoice{clientDetail.invoices.length !== 1 ? "s" : ""}
                  </span>
                  <span className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
                    Total: {formatMoney(clientDetail.invoices.reduce((s, inv) => s + Number(inv.total), 0), baseCurrency)}
                  </span>
                </div>
                {canManage && (
                  <Button size="sm" className="text-xs text-white h-7" style={{ background: "var(--gradient-brand)" }} onClick={() => setCreateInvoiceOpen(true)} data-testid="tab-create-invoice">
                    <Plus className="w-3 h-3 mr-1" /> Create Invoice
                  </Button>
                )}
              </div>
              {clientDetail.invoices.length === 0 ? (
                <div className="text-center py-8">
                  <FileText className="w-8 h-8 mx-auto mb-2" style={{ color: "var(--lux-text-muted)" }} />
                  <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>No invoices yet</p>
                </div>
              ) : (
                <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--lux-border)" }}>
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ background: "var(--lux-bg)" }}>
                        <th className="text-left px-3 py-2 font-medium" style={{ color: "var(--lux-text-muted)" }}>Invoice #</th>
                        <th className="text-left px-3 py-2 font-medium" style={{ color: "var(--lux-text-muted)" }}>Status</th>
                        <th className="text-left px-3 py-2 font-medium" style={{ color: "var(--lux-text-muted)" }}>Issue Date</th>
                        <th className="text-left px-3 py-2 font-medium" style={{ color: "var(--lux-text-muted)" }}>Due Date</th>
                        <th className="text-right px-3 py-2 font-medium" style={{ color: "var(--lux-text-muted)" }}>Total</th>
                        <th className="text-right px-3 py-2 font-medium" style={{ color: "var(--lux-text-muted)" }}>Outstanding</th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {clientDetail.invoices.map(inv => {
                        const invOutstanding = Number(inv.total) - Number(inv.paidAmount || 0);
                        const statusColor = INVOICE_STATUS_COLORS[inv.status] || INVOICE_STATUS_COLORS.DRAFT;
                        return (
                          <tr key={inv.id} className="border-t hover:bg-black/[0.02] transition-colors" style={{ borderColor: "var(--lux-border)" }} data-testid={`detail-invoice-${inv.id}`}>
                            <td className="px-3 py-2.5 font-medium" style={{ color: "var(--lux-text)" }}>{inv.number}</td>
                            <td className="px-3 py-2.5">
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: statusColor.bg, color: statusColor.text }}>{inv.status}</span>
                            </td>
                            <td className="px-3 py-2.5" style={{ color: "var(--lux-text-secondary)" }}>
                              {inv.issuedDate ? (() => { try { return format(new Date(inv.issuedDate + "T00:00:00"), "MMM d, yyyy"); } catch { return inv.issuedDate; } })() : "—"}
                            </td>
                            <td className="px-3 py-2.5" style={{ color: "var(--lux-text-secondary)" }}>
                              {inv.dueDate ? (() => { try { return format(new Date(inv.dueDate + "T00:00:00"), "MMM d, yyyy"); } catch { return inv.dueDate; } })() : "—"}
                            </td>
                            <td className="px-3 py-2.5 text-right font-medium" style={{ color: "var(--lux-text)" }}>{formatMoney(Number(inv.total), baseCurrency)}</td>
                            <td className="px-3 py-2.5 text-right font-medium" style={{ color: invOutstanding > 0 ? "#ef4444" : "#22c55e" }}>
                              {formatMoney(Math.max(0, invOutstanding), baseCurrency)}
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-1 justify-end">
                                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => navigate(`/invoices/${inv.id}`)} data-testid={`invoice-view-${inv.id}`}>
                                  <Eye className="w-3 h-3" />
                                </Button>
                                {!["DRAFT", "VOID", "PAID"].includes(inv.status) && invOutstanding > 0 && (
                                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => {
                                    setPayInvoiceId(inv.id);
                                    setPayAmount(String(Math.max(0, invOutstanding).toFixed(2)));
                                    setRecordPaymentOpen(true);
                                  }} data-testid={`invoice-pay-${inv.id}`}>
                                    <DollarSign className="w-3 h-3" style={{ color: "#22c55e" }} />
                                  </Button>
                                )}
                                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => window.open(`/api/invoices/${inv.id}/pdf`, "_blank")} data-testid={`invoice-download-${inv.id}`}>
                                  <Download className="w-3 h-3" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === "projects" && (
            <div className="space-y-3 lux-tab-content">
              {clientDetail.projects.length === 0 ? (
                <div className="text-center py-8">
                  <Briefcase className="w-8 h-8 mx-auto mb-2" style={{ color: "var(--lux-text-muted)" }} />
                  <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>No projects yet</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3" data-testid="projects-grid">
                  {clientDetail.projects.map(proj => {
                    const statusColor = PROJECT_STATUS_COLORS[proj.status] || PROJECT_STATUS_COLORS.ACTIVE;
                    const hours = proj.totalMinutes ? Math.round(proj.totalMinutes / 60 * 10) / 10 : 0;
                    return (
                      <button
                        key={proj.id}
                        type="button"
                        onClick={() => navigate(`/projects/${proj.id}`)}
                        className="text-left rounded-xl border p-4 lux-card-interactive cursor-pointer group"
                        style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)", boxShadow: "var(--lux-card-shadow)" }}
                        data-testid={`detail-project-${proj.id}`}
                      >
                        <div className="flex items-start justify-between mb-3 gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold truncate transition-colors group-hover:text-[var(--lux-accent)]" style={{ color: "var(--lux-text)" }}>
                              {proj.name}
                            </div>
                            <div className="text-[10px] mt-0.5" style={{ color: "var(--lux-text-muted)" }}>
                              {hours}h logged
                            </div>
                          </div>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0" style={{ background: statusColor.bg, color: statusColor.text }}>
                            {proj.status.replace("_", " ")}
                          </span>
                        </div>
                        <div className="flex items-center justify-between pt-3 border-t" style={{ borderColor: "var(--lux-border)" }}>
                          <div className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--lux-text-muted)" }}>
                            <Clock className="w-3 h-3" />
                            <span className="tabular-nums">{hours}h</span>
                          </div>
                          <span className="text-[11px] font-medium inline-flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: "var(--lux-accent)" }}>
                            View <ExternalLink className="w-3 h-3" />
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === "time" && (
            <div className="space-y-4 lux-tab-content">
              {(() => {
                const now = new Date();
                const cutoff = (() => {
                  const d = new Date(now);
                  if (timeRange === "7d") d.setDate(d.getDate() - 7);
                  else if (timeRange === "30d") d.setDate(d.getDate() - 30);
                  else if (timeRange === "90d") d.setDate(d.getDate() - 90);
                  else if (timeRange === "month") { d.setDate(1); d.setHours(0, 0, 0, 0); }
                  else d.setFullYear(d.getFullYear() - 100);
                  return d;
                })();
                const ranged = clientDetail.recentTimeEntries.filter(te => {
                  try { return new Date(te.date + "T00:00:00") >= cutoff; } catch { return false; }
                });
                const totalMinutes = ranged.reduce((s, te) => s + te.minutes, 0);
                const billableMinutes = ranged.filter(te => te.billable !== false).reduce((s, te) => s + te.minutes, 0);
                const unbilledMinutes = totalMinutes - billableMinutes;
                const rangeLabel = timeRange === "7d" ? "Last 7 Days" : timeRange === "30d" ? "Last 30 Days" : timeRange === "90d" ? "Last 90 Days" : timeRange === "month" ? "This Month" : "All Time";
                return (
                  <>
                    <div className="flex flex-wrap items-center gap-1.5" data-testid="time-range-filter">
                      {[
                        { id: "7d", label: "7D" },
                        { id: "30d", label: "30D" },
                        { id: "90d", label: "90D" },
                        { id: "month", label: "Month" },
                        { id: "all", label: "All" },
                      ].map(r => {
                        const on = timeRange === r.id;
                        return (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => setTimeRange(r.id as any)}
                            className="px-2.5 py-1 rounded-full text-[11px] border transition-colors"
                            style={{
                              background: on ? "rgba(var(--lux-gold-rgb), 0.15)" : "transparent",
                              borderColor: on ? "var(--lux-gold)" : "var(--lux-border)",
                              color: on ? "var(--lux-gold)" : "var(--lux-text-muted)",
                            }}
                            data-testid={`filter-time-${r.id}`}
                          >
                            {r.label}
                          </button>
                        );
                      })}
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { label: `Total Hours (${rangeLabel})`, value: `${Math.round(totalMinutes / 60 * 10) / 10}h`, color: "var(--lux-text)" },
                        { label: "Billable Hours", value: `${Math.round(billableMinutes / 60 * 10) / 10}h`, color: "#22c55e" },
                        { label: "Non-Billable Hours", value: `${Math.round(unbilledMinutes / 60 * 10) / 10}h`, color: "#f59e0b" },
                      ].map(stat => (
                        <div key={stat.label} className="rounded-lg border p-3" style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)" }}>
                          <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--lux-text-muted)" }}>{stat.label}</div>
                          <div className="text-lg font-bold tabular-nums" style={{ color: stat.color }}>{stat.value}</div>
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}
              {clientDetail.recentTimeEntries.length === 0 ? (
                <div className="text-center py-8">
                  <Timer className="w-8 h-8 mx-auto mb-2" style={{ color: "var(--lux-text-muted)" }} />
                  <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>No time entries yet</p>
                </div>
              ) : (
                <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--lux-border)" }}>
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ background: "var(--lux-bg)" }}>
                        <th className="text-left px-3 py-2 font-medium" style={{ color: "var(--lux-text-muted)" }}>Date</th>
                        <th className="text-left px-3 py-2 font-medium" style={{ color: "var(--lux-text-muted)" }}>Team Member</th>
                        <th className="text-left px-3 py-2 font-medium" style={{ color: "var(--lux-text-muted)" }}>Project</th>
                        <th className="text-right px-3 py-2 font-medium" style={{ color: "var(--lux-text-muted)" }}>Hours</th>
                        <th className="text-center px-3 py-2 font-medium" style={{ color: "var(--lux-text-muted)" }}>Billable</th>
                        <th className="text-left px-3 py-2 font-medium" style={{ color: "var(--lux-text-muted)" }}>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {clientDetail.recentTimeEntries.map(te => (
                        <tr key={te.id} className="border-t hover:bg-black/[0.02] transition-colors" style={{ borderColor: "var(--lux-border)" }}>
                          <td className="px-3 py-2.5" style={{ color: "var(--lux-text-secondary)" }}>
                            {(() => { try { return format(new Date(te.date + "T00:00:00"), "MMM d"); } catch { return te.date; } })()}
                          </td>
                          <td className="px-3 py-2.5 font-medium" style={{ color: "var(--lux-text)" }}>{te.userName}</td>
                          <td className="px-3 py-2.5" style={{ color: "var(--lux-text-secondary)" }}>{te.projectName}</td>
                          <td className="px-3 py-2.5 text-right font-medium" style={{ color: "var(--lux-text)" }}>{Math.round(te.minutes / 60 * 10) / 10}h</td>
                          <td className="px-3 py-2.5 text-center">
                            {te.billable !== false ? <CheckCircle2 className="w-3.5 h-3.5 mx-auto" style={{ color: "#22c55e" }} /> : <XCircle className="w-3.5 h-3.5 mx-auto" style={{ color: "var(--lux-text-muted)" }} />}
                          </td>
                          <td className="px-3 py-2.5 max-w-[120px] truncate" style={{ color: "var(--lux-text-muted)" }}>{te.notes || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === "contacts" && (
            <div className="space-y-3 lux-tab-content">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>
                  {contacts?.length || 0} contact{(contacts?.length || 0) !== 1 ? "s" : ""}
                </span>
                {canManage && (
                  <Button variant="outline" size="sm" className="text-xs h-7" onClick={openAddContact} data-testid="button-add-contact">
                    <UserPlus className="w-3.5 h-3.5 mr-1" /> Add Contact
                  </Button>
                )}
              </div>
              {contacts && contacts.length > 0 ? (
                <div className="space-y-2">
                  {contacts.map(c => (
                    <div key={c.id} className="rounded-lg border p-3 transition-all hover:shadow-sm" style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)" }} data-testid={`contact-row-${c.id}`}>
                      <div className="flex items-start gap-3">
                        <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0" style={{ background: "var(--gradient-brand)" }}>
                          {c.firstName[0]}{c.lastName[0]}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            {c.isPrimary && <Star className="w-3 h-3 shrink-0 fill-current" style={{ color: "#f59e0b" }} data-testid={`contact-primary-${c.id}`} />}
                            <span className="text-sm font-medium truncate" style={{ color: "var(--lux-text)" }} data-testid={`contact-name-${c.id}`}>
                              {c.firstName} {c.lastName}
                            </span>
                            {c.role && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ background: "rgba(var(--lux-accent-rgb), 0.08)", color: "var(--lux-accent)" }} data-testid={`contact-role-${c.id}`}>
                                {c.role}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs" style={{ color: "var(--lux-text-muted)" }}>
                            {c.email && <span className="flex items-center gap-1" data-testid={`contact-email-${c.id}`}><Mail className="w-3 h-3" />{c.email}</span>}
                            {c.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{c.phone}</span>}
                          </div>
                          {c.notes && <p className="text-[10px] mt-1" style={{ color: "var(--lux-text-muted)" }}>{c.notes}</p>}
                        </div>
                        {canManage && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" data-testid={`contact-actions-${c.id}`} aria-label="Contact actions">
                                <MoreHorizontal className="w-3.5 h-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEditContact(c)} data-testid={`contact-edit-${c.id}`}>
                                <Pencil className="w-3.5 h-3.5 mr-2" /> Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem disabled={deleteContactMutation.isPending} onClick={() => { setDeleteContactId(c.id); setDeleteContactOpen(true); }} className="text-red-600" data-testid={`contact-delete-${c.id}`}>
                                <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Contact className="w-8 h-8 mx-auto mb-2" style={{ color: "var(--lux-text-muted)" }} />
                  <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>No contacts added yet.</p>
                  {canManage && (
                    <Button variant="outline" size="sm" className="mt-2 text-xs" onClick={openAddContact}>
                      <UserPlus className="w-3.5 h-3.5 mr-1" /> Add First Contact
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === "activity" && (
            <div className="rounded-lg border p-4 lux-tab-content" style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)" }} data-testid="activity-timeline">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Unified Timeline</h3>
              </div>
              <div className="flex flex-wrap gap-2 mb-4" data-testid="activity-filters">
                {[
                  { key: "INVOICE_CREATED", label: "Invoices" },
                  { key: "PAYMENT_RECORDED", label: "Payments" },
                  { key: "CONTACT_ADDED", label: "Contacts" },
                  { key: "PORTAL_REGENERATED", label: "Portal" },
                  { key: "NOTE_ADDED", label: "Notes" },
                ].map(({ key, label }) => {
                  const on = !!activityFilters[key];
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setActivityFilters(prev => ({ ...prev, [key]: !prev[key] }))}
                      className="px-2.5 py-1 rounded-full text-[11px] border transition-colors"
                      style={{
                        background: on ? "rgba(var(--lux-gold-rgb),0.15)" : "transparent",
                        borderColor: on ? "var(--lux-accent)" : "var(--lux-border)",
                        color: on ? "var(--lux-accent)" : "var(--lux-text-muted)",
                      }}
                      data-testid={`filter-activity-${key.toLowerCase()}`}
                    >
                      {label}
                    </button>
                  );
                })}
                {activeTypes.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setActivityFilters({})}
                    className="px-2.5 py-1 rounded-full text-[11px] border"
                    style={{ borderColor: "var(--lux-border)", color: "var(--lux-text-muted)" }}
                    data-testid="filter-activity-clear"
                  >
                    Clear
                  </button>
                )}
              </div>
              {mergedActivity.length === 0 ? (
                <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>No activity yet.</p>
              ) : (
                <div className="relative">
                  <div className="absolute left-[11px] top-2 bottom-2 w-px" style={{ background: "var(--lux-border)" }} />
                  <div className="space-y-3">
                    {mergedActivity.map(item => (
                      <div key={item.id} className="flex items-start gap-3 relative group" data-testid={`activity-item-${item.id}`}>
                        <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 z-10" style={{ background: item.bg }}>
                          <item.icon className="w-3 h-3" style={{ color: item.color }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-medium" style={{ color: "var(--lux-text)" }}>{item.title}</span>
                            {item.linkUrl && (
                              <a href={item.linkUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center" style={{ color: "var(--lux-accent)" }}>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                          {item.subtitle && <div className="text-[10px]" style={{ color: "var(--lux-text-muted)" }}>{item.subtitle}</div>}
                        </div>
                        <span className="text-[10px] shrink-0" style={{ color: "var(--lux-text-muted)" }}>
                          {(() => { try { return format(new Date(item.ts), "MMM d, yyyy"); } catch { return String(item.ts).slice(0, 10); } })()}
                        </span>
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => handleDeleteActivity(item.rawId)}
                            disabled={deleteActivityMutation.isPending}
                            className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 p-1 rounded hover:bg-[rgba(var(--lux-gold-rgb),0.08)]"
                            style={{ color: "var(--lux-text-muted)" }}
                            title="Delete activity"
                            aria-label="Delete activity"
                            data-testid={`button-delete-activity-${item.rawId}`}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {(activities?.length || 0) >= activityLimit && (
                <div className="flex justify-center mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setActivityLimit(n => n + 50)}
                    data-testid="button-load-more-activity"
                  >
                    Load more
                  </Button>
                </div>
              )}
            </div>
          )}

          {activeTab === "notes" && (
            <div className="space-y-4 lux-tab-content">
              {canManage && (
                <div className="rounded-lg border p-3" style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)" }}>
                  <Textarea
                    value={noteBody}
                    onChange={(e) => setNoteBody(e.target.value)}
                    placeholder="Add an internal note about this client..."
                    rows={3}
                    data-testid="input-note-body"
                  />
                  <div className="flex justify-end mt-2">
                    <Button size="sm" className="text-xs text-white h-8" style={{ background: "var(--gradient-brand)" }}
                      disabled={!noteBody.trim() || createNoteMutation.isPending}
                      onClick={() => createNoteMutation.mutate()}
                      data-testid="button-add-note"
                    >
                      <Plus className="w-3 h-3 mr-1" /> {createNoteMutation.isPending ? "Adding..." : "Add Note"}
                    </Button>
                  </div>
                </div>
              )}
              {!notes || notes.length === 0 ? (
                <div className="text-center py-8">
                  <StickyNote className="w-8 h-8 mx-auto mb-2" style={{ color: "var(--lux-text-muted)" }} />
                  <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>No notes yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {notes.map(n => (
                    <div key={n.id} className="rounded-lg border p-3" style={{
                      background: n.isPinned ? "rgba(var(--lux-gold-rgb),0.04)" : "var(--lux-bg)",
                      borderColor: n.isPinned ? "rgba(var(--lux-gold-rgb),0.3)" : "var(--lux-border)",
                    }} data-testid={`note-${n.id}`}>
                      <div className="flex items-start gap-2">
                        {n.isPinned && <Pin className="w-3 h-3 shrink-0 mt-0.5 fill-current" style={{ color: "var(--lux-accent)" }} />}
                        <div className="flex-1 min-w-0">
                          {editingNoteId === n.id ? (
                            <div className="space-y-2">
                              <Textarea value={editingNoteBody} onChange={(e) => setEditingNoteBody(e.target.value)} rows={3} data-testid={`input-edit-note-${n.id}`} />
                              <div className="flex gap-2 justify-end">
                                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setEditingNoteId(null); setEditingNoteBody(""); }}>Cancel</Button>
                                <Button size="sm" className="h-7 text-xs text-white" style={{ background: "var(--gradient-brand)" }}
                                  onClick={() => updateNoteMutation.mutate({ id: n.id, body: editingNoteBody })}
                                  disabled={updateNoteMutation.isPending}
                                  data-testid={`button-save-note-${n.id}`}
                                >Save</Button>
                              </div>
                            </div>
                          ) : (
                            <p className="text-xs whitespace-pre-wrap" style={{ color: "var(--lux-text)" }} data-testid={`text-note-body-${n.id}`}>{n.body}</p>
                          )}
                          <div className="flex items-center gap-2 mt-2 text-[10px]" style={{ color: "var(--lux-text-muted)" }}>
                            <span data-testid={`text-note-author-${n.id}`}>{n.authorName || "Unknown"}</span>
                            <span>•</span>
                            <span>{(() => { try { return format(new Date(n.createdAt), "MMM d, yyyy h:mm a"); } catch { return n.createdAt; } })()}</span>
                            {n.updatedAt !== n.createdAt && <span>(edited)</span>}
                          </div>
                        </div>
                        {(() => {
                          const isAuthor = user?.id === n.authorId;
                          const isAdmin = user?.role === "ADMIN";
                          const canEditDelete = isAuthor || isAdmin;
                          const canPin = canManage;
                          if (editingNoteId === n.id) return null;
                          if (!canPin && !canEditDelete) return null;
                          return (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" data-testid={`button-note-actions-${n.id}`}>
                                <MoreHorizontal className="w-3.5 h-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {canPin && (
                                <DropdownMenuItem onClick={() => updateNoteMutation.mutate({ id: n.id, isPinned: !n.isPinned })} data-testid={`button-pin-note-${n.id}`}>
                                  <Pin className="w-3.5 h-3.5 mr-2" /> {n.isPinned ? "Unpin" : "Pin"}
                                </DropdownMenuItem>
                              )}
                              {canEditDelete && (
                                <DropdownMenuItem onClick={() => { setEditingNoteId(n.id); setEditingNoteBody(n.body); }} data-testid={`button-edit-note-${n.id}`}>
                                  <Pencil className="w-3.5 h-3.5 mr-2" /> Edit
                                </DropdownMenuItem>
                              )}
                              {canEditDelete && (
                                <DropdownMenuItem className="text-red-600" onClick={() => deleteNoteMutation.mutate(n.id)} data-testid={`button-delete-note-${n.id}`}>
                                  <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                          );
                        })()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          </Tabs>
        </main>
      </div>

      <Dialog open={isEditing} onOpenChange={(o) => { if (!o) setIsEditing(false); }}>
        <DialogContent className="sm:max-w-2xl" style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}>
          <DialogHeader>
            <DialogTitle style={{ color: "var(--lux-text)" }}>Edit Client</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); editMutation.mutate(); }} className="space-y-5" data-testid="form-edit-client">
            <FormSection title="Details">
              <div className="space-y-2">
                <label className="text-xs font-medium" style={{ color: "var(--lux-text-secondary)" }}>Company Name *</label>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} required data-testid="input-edit-client-name" />
              </div>
            </FormSection>
            <FormSection title="Contact">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium" style={{ color: "var(--lux-text-secondary)" }}>Email</label>
                  <Input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} data-testid="input-edit-client-email" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium" style={{ color: "var(--lux-text-secondary)" }}>Phone</label>
                  <Input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} data-testid="input-edit-client-phone" />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium" style={{ color: "var(--lux-text-secondary)" }}>Website</label>
                <Input value={editWebsite} onChange={(e) => setEditWebsite(e.target.value)} placeholder="example.com" data-testid="input-edit-client-website" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium" style={{ color: "var(--lux-text-secondary)" }}>Billing Currency</label>
                <select value={editCurrency} onChange={(e) => setEditCurrency(e.target.value)} className="flex h-10 w-full rounded-md border px-3 py-2 text-sm" style={{ background: "var(--color-surface-1)", borderColor: "var(--color-border-1)", color: "var(--color-text-1)" }} data-testid="select-edit-client-currency">
                  {CURRENCIES.map(c => (<option key={c.code} value={c.code}>{c.symbol} {c.code} — {c.name}</option>))}
                </select>
              </div>
            </FormSection>
            <FormSection title="Address">
              <AddressInput value={editAddress} onChange={setEditAddress} />
            </FormSection>
            <div className="flex gap-2">
              <Button type="submit" className="flex-1 text-white" disabled={editMutation.isPending} data-testid="button-save-edit" style={{ background: "var(--gradient-brand)" }}>
                {editMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setIsEditing(false)} data-testid="button-cancel-edit">Cancel</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={createInvoiceOpen} onOpenChange={setCreateInvoiceOpen}>
        <DialogContent className="sm:max-w-xl overflow-x-hidden" style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}>
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "var(--gradient-brand)" }}>
                <FileText className="w-5 h-5 text-white" />
              </div>
              <div>
                <DialogTitle style={{ color: "var(--lux-text)" }}>Create Invoice</DialogTitle>
                <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>for {clientDetail.name}</p>
              </div>
            </div>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); if (newInvLineItems.length === 0) { toast({ title: "Add at least one line item", variant: "destructive" }); return; } createInvoiceMutation.mutate(); }} className="space-y-4 min-w-0" data-testid="form-create-invoice">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium" style={{ color: "var(--lux-text-secondary)" }}>Issue Date</label>
                <Popover open={newInvIssueDateOpen} onOpenChange={setNewInvIssueDateOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-left h-10 text-sm" data-testid="input-inv-issue-date">
                      {format(newInvIssueDate, "MMM d, yyyy")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={newInvIssueDate} onSelect={(d) => { if (d) { setNewInvIssueDate(d); setNewInvIssueDateOpen(false); } }} />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium" style={{ color: "var(--lux-text-secondary)" }}>Due Date</label>
                <Popover open={newInvDueDateOpen} onOpenChange={setNewInvDueDateOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-left h-10 text-sm" data-testid="input-inv-due-date">
                      {format(newInvDueDate, "MMM d, yyyy")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={newInvDueDate} onSelect={(d) => { if (d) { setNewInvDueDate(d); setNewInvDueDateOpen(false); } }} />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium" style={{ color: "var(--lux-text-secondary)" }}>Line Items</label>
              {newInvLineItems.map((li, i) => (
                <div key={i} className="flex items-center gap-2 text-xs px-3 py-2 rounded-md min-w-0" style={{ background: "var(--lux-bg)" }}>
                  <span className="flex-1 truncate min-w-0" style={{ color: "var(--lux-text)" }}>{li.description}</span>
                  <span style={{ color: "var(--lux-text-secondary)" }}>{li.quantity} x {formatMoney(li.rate, baseCurrency)}</span>
                  <span className="font-medium" style={{ color: "var(--lux-text)" }}>{formatMoney(li.quantity * li.rate, baseCurrency)}</span>
                  <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setNewInvLineItems(prev => prev.filter((_, j) => j !== i))}>
                    <Trash2 className="w-3 h-3" style={{ color: "#ef4444" }} />
                  </Button>
                </div>
              ))}
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1">
                  <Input placeholder="Description" value={newInvDescription} onChange={(e) => setNewInvDescription(e.target.value)} className="h-8 text-xs" data-testid="input-inv-line-desc" />
                </div>
                <div className="w-16 space-y-1">
                  <Input placeholder="Qty" type="number" value={newInvQty} onChange={(e) => setNewInvQty(e.target.value)} className="h-8 text-xs" data-testid="input-inv-line-qty" />
                </div>
                <div className="w-24 space-y-1">
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs" style={{ color: "var(--lux-text-muted)" }}>$</span>
                    <Input placeholder="Rate" type="number" step="0.01" value={newInvRate} onChange={(e) => setNewInvRate(e.target.value)} className="h-8 text-xs pl-5" data-testid="input-inv-line-rate" />
                  </div>
                </div>
                <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => {
                  if (!newInvDescription || !newInvRate) return;
                  setNewInvLineItems(prev => [...prev, { description: newInvDescription, quantity: parseFloat(newInvQty) || 1, rate: parseFloat(newInvRate) || 0 }]);
                  setNewInvDescription(""); setNewInvQty("1"); setNewInvRate("");
                }} data-testid="button-add-line-item">
                  <Plus className="w-3 h-3 mr-1" /> Add
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium" style={{ color: "var(--lux-text-secondary)" }}>Discount ($)</label>
                <div className="relative">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs" style={{ color: "var(--lux-text-muted)" }}>$</span>
                  <Input type="number" step="0.01" value={newInvDiscount} onChange={(e) => setNewInvDiscount(e.target.value)} className="pl-5" placeholder="0.00" data-testid="input-inv-discount" />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium" style={{ color: "var(--lux-text-secondary)" }}>Tax Rate (%)</label>
                <Input type="number" step="0.01" value={newInvTaxRate} onChange={(e) => setNewInvTaxRate(e.target.value)} placeholder="0" data-testid="input-inv-tax" />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium" style={{ color: "var(--lux-text-secondary)" }}>Notes</label>
              <Textarea value={newInvNotes} onChange={(e) => setNewInvNotes(e.target.value)} placeholder="Optional notes..." rows={2} data-testid="input-inv-notes" />
            </div>
            {newInvLineItems.length > 0 && (
              <div className="rounded-md p-3 text-xs space-y-1" style={{ background: "var(--lux-bg)" }}>
                <div className="flex justify-between"><span style={{ color: "var(--lux-text-secondary)" }}>Subtotal</span><span style={{ color: "var(--lux-text)" }}>{formatMoney(newInvLineItems.reduce((s, li) => s + li.quantity * li.rate, 0), baseCurrency)}</span></div>
                {newInvDiscount && parseFloat(newInvDiscount) > 0 && <div className="flex justify-between"><span style={{ color: "var(--lux-text-secondary)" }}>Discount</span><span style={{ color: "#ef4444" }}>-{formatMoney(parseFloat(newInvDiscount), baseCurrency)}</span></div>}
                {newInvTaxRate && parseFloat(newInvTaxRate) > 0 && <div className="flex justify-between"><span style={{ color: "var(--lux-text-secondary)" }}>Tax ({newInvTaxRate}%)</span><span style={{ color: "var(--lux-text)" }}>{formatMoney(Math.round((newInvLineItems.reduce((s, li) => s + li.quantity * li.rate, 0) - (parseFloat(newInvDiscount) || 0)) * (parseFloat(newInvTaxRate) || 0)) / 100, baseCurrency)}</span></div>}
                <div className="flex justify-between font-bold pt-1 border-t" style={{ borderColor: "var(--lux-border)" }}>
                  <span style={{ color: "var(--lux-text)" }}>Total</span>
                  <span style={{ color: "var(--lux-accent)" }}>{formatMoney((() => { const st = newInvLineItems.reduce((s, li) => s + li.quantity * li.rate, 0); const d = parseFloat(newInvDiscount) || 0; const t = parseFloat(newInvTaxRate) || 0; return Math.round((st - d + (st - d) * t / 100) * 100) / 100; })(), baseCurrency)}</span>
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <Button type="submit" className="flex-1 text-white" disabled={createInvoiceMutation.isPending} style={{ background: "var(--gradient-brand)" }} data-testid="button-submit-invoice">
                {createInvoiceMutation.isPending ? "Creating..." : "Create Invoice"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setCreateInvoiceOpen(false)}>Cancel</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={recordPaymentOpen} onOpenChange={setRecordPaymentOpen}>
        <DialogContent className="sm:max-w-md" style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}>
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "var(--gradient-brand)" }}>
                <CreditCard className="w-5 h-5 text-white" />
              </div>
              <div>
                <DialogTitle style={{ color: "var(--lux-text)" }}>Record Payment</DialogTitle>
                <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>for {clientDetail.name}</p>
              </div>
            </div>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); if (!payInvoiceId || !payAmount) { toast({ title: "Select an invoice and enter amount", variant: "destructive" }); return; } recordPaymentMutation.mutate(); }} className="space-y-4" data-testid="form-record-payment">
            <div className="space-y-1">
              <label className="text-xs font-medium" style={{ color: "var(--lux-text-secondary)" }}>Invoice</label>
              <select value={payInvoiceId} onChange={(e) => {
                setPayInvoiceId(e.target.value);
                const inv = clientDetail.invoices.find(i => i.id === e.target.value);
                if (inv) setPayAmount(String(Math.max(0, Number(inv.total) - Number(inv.paidAmount || 0)).toFixed(2)));
              }} className="flex h-10 w-full rounded-md border px-3 py-2 text-sm" style={{ background: "var(--color-surface-1)", borderColor: "var(--color-border-1)", color: "var(--color-text-1)" }} data-testid="select-pay-invoice">
                <option value="">Select invoice...</option>
                {clientDetail.invoices.filter(inv => !["DRAFT", "VOID", "PAID"].includes(inv.status)).map(inv => (
                  <option key={inv.id} value={inv.id}>{inv.number} — {formatMoney(Math.max(0, Number(inv.total) - Number(inv.paidAmount || 0)), baseCurrency)} outstanding</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium" style={{ color: "var(--lux-text-secondary)" }}>Amount</label>
                <div className="relative">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs" style={{ color: "var(--lux-text-muted)" }}>$</span>
                  <Input type="number" step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} className="pl-5" required data-testid="input-pay-amount" />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium" style={{ color: "var(--lux-text-secondary)" }}>Method</label>
                <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className="flex h-10 w-full rounded-md border px-3 py-2 text-sm" style={{ background: "var(--color-surface-1)", borderColor: "var(--color-border-1)", color: "var(--color-text-1)" }} data-testid="select-pay-method">
                  <option value="CHECK">Check</option>
                  <option value="ACH">ACH</option>
                  <option value="WIRE">Wire</option>
                  <option value="CREDIT_CARD">Credit Card</option>
                  <option value="CASH">Cash</option>
                  <option value="STRIPE">Stripe</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium" style={{ color: "var(--lux-text-secondary)" }}>Date</label>
              <Popover open={payDateOpen} onOpenChange={setPayDateOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left h-10 text-sm" data-testid="input-pay-date">
                    {format(payDate, "MMM d, yyyy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={payDate} onSelect={(d) => { if (d) { setPayDate(d); setPayDateOpen(false); } }} />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium" style={{ color: "var(--lux-text-secondary)" }}>Reference Number</label>
              <Input value={payReference} onChange={(e) => setPayReference(e.target.value)} placeholder={payMethod === "CHECK" ? "Check #" : payMethod === "ACH" ? "ACH trace #" : payMethod === "WIRE" ? "Wire reference #" : "Reference #"} data-testid="input-pay-reference" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium" style={{ color: "var(--lux-text-secondary)" }}>Notes</label>
              <Textarea value={payNotes} onChange={(e) => setPayNotes(e.target.value)} placeholder="Optional notes..." rows={2} data-testid="input-pay-notes" />
            </div>
            <div className="flex gap-2">
              <Button type="submit" className="flex-1 text-white" disabled={recordPaymentMutation.isPending} style={{ background: "var(--gradient-brand)" }} data-testid="button-submit-payment">
                {recordPaymentMutation.isPending ? "Recording..." : "Record Payment"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setRecordPaymentOpen(false)}>Cancel</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}>
          <AlertDialogHeader>
            <AlertDialogTitle style={{ color: "var(--lux-text)" }}>Delete Client</AlertDialogTitle>
            <AlertDialogDescription style={{ color: "var(--lux-text-muted)" }} data-testid="text-delete-description">
              Are you sure you want to delete "{clientDetail.name}"? This action cannot be undone.
              The client must have no linked projects, invoices, or estimates.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteMutation.mutate()} className="bg-red-600 hover:bg-red-700" data-testid="button-confirm-delete">
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteContactOpen} onOpenChange={setDeleteContactOpen}>
        <AlertDialogContent style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}>
          <AlertDialogHeader>
            <AlertDialogTitle style={{ color: "var(--lux-text)" }}>Delete Contact</AlertDialogTitle>
            <AlertDialogDescription style={{ color: "var(--lux-text-muted)" }} data-testid="text-delete-contact-description">
              Are you sure you want to delete this contact? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-contact">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (deleteContactId) deleteContactMutation.mutate(deleteContactId); setDeleteContactOpen(false); }} className="bg-red-600 hover:bg-red-700" data-testid="button-confirm-delete-contact">
              {deleteContactMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={contactDialogOpen} onOpenChange={(open) => { if (!open) { setContactDialogOpen(false); resetContactForm(); } }}>
        <DialogContent style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}>
          <DialogHeader>
            <DialogTitle style={{ color: "var(--lux-text)" }}>{editingContact ? "Edit Contact" : "Add Contact"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); saveContactMutation.mutate(); }} className="space-y-4" data-testid="form-contact">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium" style={{ color: "var(--lux-text-secondary)" }}>First Name *</label>
                <Input value={contactFirstName} onChange={(e) => setContactFirstName(e.target.value)} required data-testid="input-contact-first-name" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium" style={{ color: "var(--lux-text-secondary)" }}>Last Name *</label>
                <Input value={contactLastName} onChange={(e) => setContactLastName(e.target.value)} required data-testid="input-contact-last-name" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium" style={{ color: "var(--lux-text-secondary)" }}>Email</label>
                <Input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} data-testid="input-contact-email" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium" style={{ color: "var(--lux-text-secondary)" }}>Phone</label>
                <Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} data-testid="input-contact-phone" />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium" style={{ color: "var(--lux-text-secondary)" }}>Role</label>
              <select value={contactRole} onChange={(e) => setContactRole(e.target.value)} className="flex h-10 w-full rounded-md border px-3 py-2 text-sm" style={{ background: "var(--color-surface-1)", borderColor: "var(--color-border-1)", color: "var(--color-text-1)" }} data-testid="select-contact-role">
                <option value="">No role</option>
                <option value="Primary">Primary</option>
                <option value="Billing">Billing</option>
                <option value="Project Sponsor">Project Sponsor</option>
                <option value="Technical">Technical</option>
                <option value="Executive">Executive</option>
              </select>
              <p className="text-xs mt-1" style={{ color: "var(--lux-text-muted)" }}>
                Contacts with role "Billing" will be CC'd on invoice emails.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="contact-primary" checked={contactIsPrimary} onChange={(e) => setContactIsPrimary(e.target.checked)} className="rounded" data-testid="checkbox-contact-primary" />
              <label htmlFor="contact-primary" className="text-sm" style={{ color: "var(--lux-text-secondary)" }}>Primary contact</label>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium" style={{ color: "var(--lux-text-secondary)" }}>Notes</label>
              <Input value={contactNotes} onChange={(e) => setContactNotes(e.target.value)} placeholder="Optional notes" data-testid="input-contact-notes" />
            </div>
            <div className="flex gap-2">
              <Button type="submit" className="flex-1 text-white" disabled={saveContactMutation.isPending} data-testid="button-save-contact" style={{ background: "var(--gradient-brand)" }}>
                {saveContactMutation.isPending ? "Saving..." : editingContact ? "Save Changes" : "Add Contact"}
              </Button>
              <Button type="button" variant="outline" onClick={() => { setContactDialogOpen(false); resetContactForm(); }} data-testid="button-cancel-contact">Cancel</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
