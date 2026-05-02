import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useUrlFilterState } from "@/lib/use-url-filter-state";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHelpLink } from "@/components/page-help-link";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
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
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Plus,
  Users,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Pencil,
  Trash2,
  Mail,
  Phone,
  MapPin,
  ChevronRight,
  Link,
  Copy,
  Eye,
  Globe,
  Star,
  UserPlus,
  MoreHorizontal,
  Contact,
  TrendingUp,
  AlertCircle,
  DollarSign,
  Briefcase,
  FileText,
  Clock,
  CreditCard,
  Send,
  BarChart3,
  Download,
  ExternalLink,
  LayoutDashboard,
  Receipt,
  Timer,
  CheckCircle2,
  XCircle,
  Info,
} from "lucide-react";
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
import type { Client, ClientContact } from "@shared/schema";
import { StatusBadge } from "@/components/shared/status-badge";
import { ActiveFilterBar, type FilterChipDescriptor } from "@/components/active-filter-chip";
import { MoneyDisplay } from "@/components/shared/money-display";
import { formatMoney } from "@/components/shared/format";
import { useBaseCurrency } from "@/hooks/use-base-currency";
import { EmptyState } from "@/components/shared/empty-state";
import { StatCard } from "@/components/shared/stat-card";
import { FormSection } from "@/components/shared/form-section";
import { DangerZone } from "@/components/shared/danger-zone";
import { DetailPanel } from "@/components/shared/detail-panel";
import { AvatarInitials } from "@/components/shared/avatar-initials";
import { AddressDisplay } from "@/components/shared/address-display";
import { AddressInput } from "@/components/shared/address-input";
import { CURRENCIES } from "../../../shared/currencies";
import { format, differenceInDays, parseISO } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { useDocumentTitle } from "@/lib/use-document-title";

interface ClientDetail {
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
}

type DetailTab = "overview" | "invoices" | "projects" | "time" | "contacts";

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

type SortField = "name" | "email" | "outstanding";
type SortDir = "asc" | "desc";

export default function ClientsPage() {
  useDocumentTitle("Clients");
  const { user } = useAuth();
  const baseCurrency = useBaseCurrency();
  const { toast } = useToast();
  const isAdmin = user?.role === "ADMIN";
  const canManage = user?.role === "ADMIN" || user?.role === "MANAGER";

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [website, setWebsite] = useState("");
  const [clientCurrency, setClientCurrency] = useState("USD");

  const [filters, setFilter] = useUrlFilterState({ q: "", sort: "name", dir: "asc" });
  const searchTerm = filters.q;
  const sortField = filters.sort as SortField;
  const sortDir = filters.dir as SortDir;
  const setSearchTerm = (v: string) => setFilter("q", v, { replace: true });
  const setSortField = (v: SortField) => setFilter("sort", v);
  const setSortDir = (v: SortDir) => setFilter("dir", v);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteClientId, setDeleteClientId] = useState<string | null>(null);
  const [deleteClientName, setDeleteClientName] = useState("");

  const [, navigate] = useLocation();
  const [stickyVisible, setStickyVisible] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const { data: clients, isLoading } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const { data: allInvoices } = useQuery<Array<{ id: string; clientId: string; total: string; paidAmount?: string; status: string; createdAt?: string }>>({
    queryKey: ["/api/invoices"],
  });

  const { data: canonicalAR } = useQuery<{ outstandingAR: number }>({
    queryKey: ["/api/ar/outstanding"],
  });

  const clientStats = useMemo(() => {
    const totalClients = clients?.length || 0;
    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 86400000);

    let activeClients = 0;
    let totalLifetimeValue = 0;

    if (allInvoices && clients) {
      const invoicesByClient = new Map<string, typeof allInvoices>();
      for (const inv of allInvoices) {
        if (!invoicesByClient.has(inv.clientId)) invoicesByClient.set(inv.clientId, []);
        invoicesByClient.get(inv.clientId)!.push(inv);
      }

      for (const client of clients) {
        const cInvoices = invoicesByClient.get(client.id) || [];
        const clientTotal = cInvoices.reduce((s, i) => s + Number(i.total || 0), 0);
        totalLifetimeValue += clientTotal;

        const clientOutstanding = cInvoices
          .filter(i => i.status !== "PAID" && i.status !== "VOID" && i.status !== "DRAFT")
          .reduce((s, i) => s + Number(i.total || 0) - Number(i.paidAmount || 0), 0);

        const hasRecentActivity = cInvoices.some(i => {
          const d = i.createdAt ? new Date(i.createdAt) : new Date(0);
          return d >= ninetyDaysAgo;
        }) || clientOutstanding > 0;
        if (hasRecentActivity) activeClients++;
      }
    }

    const avgLifetimeValue = totalClients > 0 ? totalLifetimeValue / totalClients : 0;
    const outstandingAR = canonicalAR?.outstandingAR ?? 0;
    return { totalClients, activeClients, avgLifetimeValue, outstandingAR };
  }, [clients, allInvoices, canonicalAR]);

  const createMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/clients", { name, email, phone, address, website: website || null, currency: clientCurrency });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      setCreateOpen(false);
      setName("");
      setEmail("");
      setPhone("");
      setAddress("");
      setWebsite("");
      setClientCurrency("USD");
      toast({ title: "Client created successfully" });
    },
    onError: (err: any) => {
      if (err.message?.includes("Upgrade to Professional")) {
        toast({
          title: "Client limit reached",
          description: "Your current plan supports up to 5 clients. Upgrade to Professional for unlimited clients.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/clients/${deleteClientId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      setDeleteOpen(false);
      setDeleteClientId(null);
      toast({ title: "Client deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Cannot delete", description: err.message, variant: "destructive" });
    },
  });

  function openDeleteConfirm(clientId: string, clientName: string, e?: React.MouseEvent) {
    if (e) e.stopPropagation();
    setDeleteClientId(clientId);
    setDeleteClientName(clientName);
    setDeleteOpen(true);
  }

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 inline-block" />;
    return sortDir === "asc"
      ? <ArrowUp className="w-3 h-3 ml-1 inline-block" />
      : <ArrowDown className="w-3 h-3 ml-1 inline-block" />;
  }

  const filtered = (clients || []).filter((c) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      c.name.toLowerCase().includes(term) ||
      (c.email && c.email.toLowerCase().includes(term)) ||
      (c.phone && c.phone.toLowerCase().includes(term))
    );
  });

  const clientOutstandingMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!allInvoices) return map;
    for (const inv of allInvoices) {
      if (inv.status === "PAID" || inv.status === "VOID" || inv.status === "DRAFT") continue;
      const cur = map.get(inv.clientId) || 0;
      map.set(inv.clientId, cur + Number(inv.total || 0) - Number(inv.paidAmount || 0));
    }
    return map;
  }, [allInvoices]);

  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sortField === "name") {
      cmp = a.name.localeCompare(b.name);
    } else if (sortField === "email") {
      cmp = (a.email || "").localeCompare(b.email || "");
    } else if (sortField === "outstanding") {
      cmp = (clientOutstandingMap.get(a.id) || 0) - (clientOutstandingMap.get(b.id) || 0);
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="px-6 lg:px-8 xl:px-10 py-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3">
            <h1
              className="text-2xl font-bold tracking-tight"
              style={{ color: "var(--lux-text)" }}
              data-testid="text-clients-title"
            >
              Clients
            </h1>
            <PageHelpLink />
          </div>
          <p className="text-sm mt-1" style={{ color: "var(--lux-text-muted)" }}>
            Manage your client relationships
          </p>
        </div>
        {canManage && (
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button
                data-testid="button-add-client"
                style={{ background: "var(--gradient-brand)" }}
                className="text-white"
              >
                <Plus className="w-4 h-4 mr-2" />
                New Client
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-2xl" style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}>
              <DialogHeader>
                <DialogTitle style={{ color: "var(--lux-text)" }}>New Client</DialogTitle>
              </DialogHeader>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  createMutation.mutate();
                }}
                className="space-y-5"
              >
                <FormSection title="Details">
                  <div className="space-y-2">
                    <label className="text-xs font-medium" style={{ color: "var(--lux-text-secondary)" }}>Company Name *</label>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      data-testid="input-client-name"
                    />
                  </div>
                </FormSection>

                <FormSection title="Contact">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium" style={{ color: "var(--lux-text-secondary)" }}>Email</label>
                      <Input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        data-testid="input-client-email"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium" style={{ color: "var(--lux-text-secondary)" }}>Phone</label>
                      <Input
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        data-testid="input-client-phone"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium" style={{ color: "var(--lux-text-secondary)" }}>Website</label>
                    <Input
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                      placeholder="example.com"
                      data-testid="input-client-website"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium" style={{ color: "var(--lux-text-secondary)" }}>Billing Currency</label>
                    <select
                      value={clientCurrency}
                      onChange={(e) => setClientCurrency(e.target.value)}
                      className="flex h-10 w-full rounded-md border px-3 py-2 text-sm"
                      style={{ background: "var(--color-surface-1)", borderColor: "var(--color-border-1)", color: "var(--color-text-1)" }}
                      data-testid="select-create-client-currency"
                    >
                      {CURRENCIES.map(c => (
                        <option key={c.code} value={c.code}>{c.symbol} {c.code} — {c.name}</option>
                      ))}
                    </select>
                  </div>
                </FormSection>

                <FormSection title="Address">
                  <AddressInput
                    value={address}
                    onChange={setAddress}
                  />
                </FormSection>

                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    className="text-white"
                    disabled={createMutation.isPending}
                    data-testid="button-submit-client"
                    style={{ background: "var(--gradient-brand)" }}
                  >
                    {createMutation.isPending ? "Creating..." : "Create"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {clients && clients.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={Users}
            label="Total Clients"
            value={`${clientStats.totalClients}`}
            subValue="all clients"
            color="var(--lux-accent)"
            testId="stat-total-clients"
          />
          <StatCard
            icon={CheckCircle2}
            label="Active Clients"
            value={`${clientStats.activeClients}`}
            subValue="last 90 days"
            color="#22c55e"
            testId="stat-active-clients"
          />
          <StatCard
            icon={DollarSign}
            label="Avg Lifetime Value"
            value={formatMoney(clientStats.avgLifetimeValue, baseCurrency)}
            subValue="per client"
            color="#3b82f6"
            testId="stat-avg-lifetime-value"
          />
          <StatCard
            icon={FileText}
            label="Outstanding AR"
            value={formatMoney(clientStats.outstandingAR, baseCurrency)}
            subValue={clientStats.outstandingAR > 0 ? "across all clients" : "all clear"}
            color={clientStats.outstandingAR > 0 ? "#f59e0b" : "#6b7280"}
            testId="stat-outstanding-ar"
          />
        </div>
      )}

      {(() => {
        const chips: FilterChipDescriptor[] = [];
        if (searchTerm) {
          chips.push({
            id: "search",
            label: `Search: "${searchTerm}"`,
            onClear: () => setSearchTerm(""),
          });
        }
        return <ActiveFilterBar chips={chips} />;
      })()}

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--lux-text-muted)" }} />
          <Input
            placeholder="Search clients..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
            data-testid="input-search-clients"
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => toggleSort("name")} data-testid="th-sort-name" className="text-xs gap-1">
          Name <SortIcon field="name" />
        </Button>
        <Button variant="outline" size="sm" onClick={() => toggleSort("email")} data-testid="th-sort-email" className="text-xs gap-1">
          Email <SortIcon field="email" />
        </Button>
      </div>

      {!clients?.length ? (
        <EmptyState
          icon={Users}
          title="No clients yet"
          description="Add your first client to get started with projects and invoicing."
          action={canManage ? () => setCreateOpen(true) : undefined}
          actionLabel="Add Client"
        />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No clients match your search"
          description="Try adjusting your search terms."
        />
      ) : (
        <div className="space-y-2">
          {sorted.map((client) => (
            <div
              key={client.id}
              className="rounded-lg border p-4 cursor-pointer transition-shadow hover:shadow-md"
              style={{
                background: "var(--lux-surface)",
                borderColor: "var(--lux-border)",
              }}
              onClick={() => navigate(`/clients/${client.id}`)}
              data-testid={`row-client-${client.id}`}
            >
              <div className="flex items-center gap-4">
                <AvatarInitials name={client.name} size="md" imageUrl={client.logoUrl} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-semibold text-sm truncate" style={{ color: "var(--lux-text)" }} data-testid={`text-client-name-${client.id}`}>
                      {client.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs" style={{ color: "var(--lux-text-muted)" }}>
                    {client.email && (
                      <span data-testid={`text-client-email-${client.id}`}>{client.email}</span>
                    )}
                    {client.email && client.phone && <span>•</span>}
                    {client.phone && (
                      <span data-testid={`text-client-phone-${client.id}`}>{client.phone}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0" data-testid={`cell-client-status-${client.id}`}>
                  <StatusBadge status="ACTIVE" size="xs" />
                  <ChevronRight size={16} style={{ color: "var(--lux-text-muted)" }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}>
          <AlertDialogHeader>
            <AlertDialogTitle style={{ color: "var(--lux-text)" }}>Delete Client</AlertDialogTitle>
            <AlertDialogDescription style={{ color: "var(--lux-text-muted)" }} data-testid="text-delete-description">
              Are you sure you want to delete "{deleteClientName}"? This action cannot be undone.
              The client must have no linked projects, invoices, or estimates.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              className="bg-red-600 hover:bg-red-700"
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
