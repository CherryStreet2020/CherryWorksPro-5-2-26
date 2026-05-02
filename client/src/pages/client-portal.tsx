import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Building2, FileText, DollarSign, Download, Check, X,
  CreditCard, AlertCircle, Clock, AlertTriangle, Cherry, Moon, Sun,
} from "lucide-react";

interface PortalInvoice {
  id: string;
  number: string;
  status: string;
  issuedDate: string;
  dueDate: string;
  total: string;
  paidAmount: string;
  publicToken: string | null;
}

interface PortalEstimate {
  id: string;
  number: string;
  status: string;
  issuedDate: string;
  expiryDate: string | null;
  total: string;
  publicToken: string | null;
}

interface PortalPayment {
  id: string;
  invoiceId: string;
  amount: string;
  method: string;
  date: string;
  invoiceNumber: string;
}

interface PortalData {
  client: { name: string; email: string | null; phone: string | null; address: string | null };
  org: { name: string; logoUrl: string | null; email: string | null; phone: string | null; website: string | null } | null;
  invoices: PortalInvoice[];
  estimates: PortalEstimate[];
  payments: PortalPayment[];
  totalBilled: string;
  totalPaid: string;
  outstanding: string;
}

function formatCurrency(v: number | string, currency: string = "USD") {
  const num = Number(v);
  if (isNaN(num)) return "$0.00";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
  } catch {
    return `${currency} ${num.toFixed(2)}`;
  }
}

function formatDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function isOverdue(inv: PortalInvoice): boolean {
  if (inv.status !== "SENT" && inv.status !== "PARTIAL") return false;
  const due = new Date(inv.dueDate + "T23:59:59");
  return new Date() > due;
}

function daysOverdue(inv: PortalInvoice): number {
  const due = new Date(inv.dueDate + "T23:59:59");
  const diff = Math.floor((Date.now() - due.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
}

function invoiceBalance(inv: PortalInvoice): number {
  return Number(inv.total) - Number(inv.paidAmount);
}

function statusColor(status: string) {
  switch (status) {
    case "PAID": return { bg: "rgba(34,197,94,0.1)", text: "#22c55e" };
    case "SENT": return { bg: "rgba(59,130,246,0.1)", text: "#3b82f6" };
    case "PARTIAL": return { bg: "rgba(245,158,11,0.1)", text: "#f59e0b" };
    case "DRAFT": return { bg: "rgba(148,163,184,0.1)", text: "#94a3b8" };
    case "VOID": return { bg: "rgba(148,163,184,0.1)", text: "#94a3b8" };
    default: return { bg: "rgba(148,163,184,0.1)", text: "#94a3b8" };
  }
}

function estimateStatusColor(status: string) {
  switch (status) {
    case "ACCEPTED": return { bg: "rgba(34,197,94,0.1)", text: "#22c55e" };
    case "SENT": return { bg: "rgba(59,130,246,0.1)", text: "#3b82f6" };
    case "DECLINED": return { bg: "rgba(239,68,68,0.1)", text: "#ef4444" };
    default: return { bg: "rgba(148,163,184,0.1)", text: "#94a3b8" };
  }
}

export default function ClientPortalPage({ token }: { token: string }) {
  const [activeTab, setActiveTab] = useState("invoices");
  const [selectedInvoice, setSelectedInvoice] = useState<PortalInvoice | null>(null);

  const [isDark, setIsDark] = useState(() => {
    try { return localStorage.getItem('portal-theme') !== 'light'; } catch { return true; }
  });

  useEffect(() => {
    try { localStorage.setItem('portal-theme', isDark ? 'dark' : 'light'); } catch {}
    const id = 'portal-dark-theme';
    let s = document.getElementById(id) as HTMLStyleElement | null;
    if (isDark) {
      if (!s) { s = document.createElement('style'); s.id = id; document.head.appendChild(s); }
      s.textContent = `
        :root { --background: 222.2 84% 4.9% !important; --foreground: 210 40% 98% !important; --card: 217 33% 17% !important; --card-foreground: 210 40% 98% !important; --popover: 222.2 84% 4.9% !important; --popover-foreground: 210 40% 98% !important; --secondary: 217.2 32.6% 17.5% !important; --secondary-foreground: 210 40% 98% !important; --muted: 217.2 32.6% 17.5% !important; --muted-foreground: 215 20.2% 65.1% !important; --accent: 217.2 32.6% 17.5% !important; --accent-foreground: 210 40% 98% !important; --border: 217.2 32.6% 25% !important; --input: 217.2 32.6% 25% !important; --ring: 212.7 26.8% 83.9% !important; --card-border: 217.2 32.6% 25% !important; }
        body { background-color: #0f172a !important; color: #e2e8f0 !important; }
        [data-testid="portal-page"] { background: #0f172a !important; }
        [data-testid="portal-page"] .bg-card { background-color: hsl(217 33% 17%) !important; }
        [data-testid="portal-page"] .border-card-border { border-color: hsl(217.2 32.6% 25%) !important; }
        [data-testid="portal-page"] .text-card-foreground { color: #e2e8f0 !important; }
        [data-testid="portal-page"] .text-muted-foreground { color: #94a3b8 !important; }
        [data-testid="portal-page"] .bg-muted { background-color: hsl(217.2 32.6% 17.5%) !important; }
        [data-testid="portal-page"] table { color: #e2e8f0 !important; }
        [data-testid="portal-page"] th { color: #94a3b8 !important; }
        [data-testid="portal-page"] td { color: #cbd5e1 !important; }
        [data-testid="portal-page"] button[data-state="active"] { background: #1e293b !important; color: #e2e8f0 !important; }
        [data-testid="portal-page"] p[style] { color: #94a3b8 !important; } [data-testid="portal-page"] span[style]:not([data-testid*="badge"]):not([data-testid*="status"]):not([data-testid*="payment"]):not([data-testid*="overdue"]):not([data-testid*="stat-label"]) { color: #94a3b8 !important; }
        [data-testid="portal-page"] h1 { color: #f1f5f9 !important; }
        [data-testid="portal-page"] [style*="borderTop"] { border-color: #334155 !important; }
        [data-testid="portal-page"] [style*="var(--lux"] { background: #1e293b !important; }
      `;
    } else if (s) { s.remove(); }
    return () => { const el = document.getElementById(id); if (el) el.remove(); };
  }, [isDark]);


  const { data, isLoading, error } = useQuery<PortalData>({
    queryKey: ["/api/public/portal", token],
    enabled: !!token,
    retry: false,
  });

  const acceptMutation = useMutation({
    mutationFn: async (publicToken: string) => {
      await apiRequest("POST", `/api/public/estimates/${publicToken}/accept`);
    },
  });

  const declineMutation = useMutation({
    mutationFn: async (publicToken: string) => {
      await apiRequest("POST", `/api/public/estimates/${publicToken}/decline`);
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen" style={{ background: "var(--lux-bg, #f8fafc)" }}>
        <div className="max-w-5xl mx-auto p-6 space-y-6">
          <Skeleton className="h-16 w-64" />
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)}
          </div>
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--lux-bg, #f8fafc)" }}>
        <Card className="max-w-md w-full mx-4" data-testid="card-portal-not-found">
          <CardContent className="py-12 text-center">
            <AlertCircle className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-xl font-semibold mb-2" data-testid="text-portal-error">Portal Not Found</h2>
            <p className="text-sm text-muted-foreground">This portal link is invalid or has expired.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const overdueInvoices = data.invoices.filter(inv => isOverdue(inv)).sort((a, b) => daysOverdue(b) - daysOverdue(a));
  const overdueAmount = overdueInvoices.reduce((sum, inv) => sum + invoiceBalance(inv), 0);
  const sortedInvoices = [...data.invoices].sort((a, b) => {
    const aOverdue = isOverdue(a) ? 1 : 0;
    const bOverdue = isOverdue(b) ? 1 : 0;
    if (bOverdue !== aOverdue) return bOverdue - aOverdue;
    return b.issuedDate.localeCompare(a.issuedDate);
  });

  const invoicePayments = selectedInvoice
    ? data.payments.filter(p => p.invoiceId === selectedInvoice.id)
    : [];

  return (
    <div className="min-h-screen" style={{ background: "var(--lux-bg, #f8fafc)" }} data-testid="portal-page">
      <div style={{ background: "var(--gradient-hero, linear-gradient(135deg, #1e293b, #0f172a))", color: "white" }}>
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            {data.org?.logoUrl ? (
              <img src={data.org.logoUrl} alt={data.org.name || "Logo"} className="w-10 h-10 rounded-xl object-contain" style={{ background: "transparent" }} />
            ) : (
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "var(--gradient-brand)" }}>
                <img src="/brand/cherry-icon-red.png" alt="CherryAI" className="w-8 h-8" style={{ objectFit: "contain", filter: "brightness(10)" }} />
              </div>
            )}
            <div>
              <h1 className="text-lg font-bold" data-testid="text-org-name">{data.org?.name || "Client Portal"}</h1>
              {data.org?.website && <p className="text-xs" style={{ color: "rgba(255,255,255,0.7)" }}>{data.org.website}</p>}
            </div>
          </div>
          <div className="text-right" style={{ display: "flex", alignItems: "center", gap: "12px" }}><button onClick={() => setIsDark(!isDark)} style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "8px", padding: "6px 8px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }} title={isDark ? "Switch to light mode" : "Switch to dark mode"}>{isDark ? <Sun className="w-4 h-4 text-yellow-300" /> : <Moon className="w-4 h-4 text-white" />}</button><div>
            <p className="text-sm font-medium" data-testid="text-client-name">{data.client.name}</p>
            {data.client.email && <p className="text-xs" style={{ color: "rgba(255,255,255,0.7)" }}>{data.client.email}</p>}</div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-6 space-y-6">

        {/* Overdue Alert */}
        {overdueInvoices.length > 0 && (
          <div className="rounded-lg px-5 py-4 flex items-start gap-3" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }} data-testid="alert-overdue">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: "#ef4444" }} />
            <div>
              <p className="text-sm font-semibold" style={{ color: "#ef4444" }}>
                {overdueInvoices.length} overdue invoice{overdueInvoices.length > 1 ? "s" : ""} — {formatCurrency(overdueAmount)} past due
              </p>
              <p className="text-xs mt-1" style={{ color: "#dc2626" }}>
                {overdueInvoices.map(inv => `${inv.number} (${daysOverdue(inv)}d overdue)`).join(", ")}
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card className="border-0" style={{ boxShadow: "var(--lux-card-shadow, 0 2px 8px rgba(0,0,0,0.06))" }} data-testid="card-total-billed">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <FileText className="w-4 h-4" style={{ color: "var(--lux-text-muted)" }} />
                <span className="text-[11px] font-medium uppercase tracking-wider" data-testid="stat-label-billed" style={{ color: "var(--lux-text-muted)" }}>Total Billed</span>
              </div>
              <p className="text-xl font-bold" style={{ color: "var(--lux-text)" }} data-testid="text-total-billed">{formatCurrency(data.totalBilled)}</p>
            </CardContent>
          </Card>
          <Card className="border-0" style={{ boxShadow: "var(--lux-card-shadow, 0 2px 8px rgba(0,0,0,0.06))" }} data-testid="card-total-paid">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Check className="w-4 h-4" style={{ color: "#22c55e" }} />
                <span className="text-[11px] font-medium uppercase tracking-wider" data-testid="stat-label-paid" style={{ color: "#4ade80" }}>Total Paid</span>
              </div>
              <p className="text-xl font-bold" style={{ color: "#22c55e" }} data-testid="text-total-paid">{formatCurrency(data.totalPaid)}</p>
            </CardContent>
          </Card>
          <Card className="border-0" style={{ boxShadow: "var(--lux-card-shadow, 0 2px 8px rgba(0,0,0,0.06))" }} data-testid="card-outstanding">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="w-4 h-4" style={{ color: "#f59e0b" }} />
                <span className="text-[11px] font-medium uppercase tracking-wider" data-testid="stat-label-outstanding" style={{ color: "#fbbf24" }}>Outstanding</span>
              </div>
              <p className="text-xl font-bold" style={{ color: Number(data.outstanding) > 0 ? "#f59e0b" : "var(--lux-text)" }} data-testid="text-outstanding">
                {formatCurrency(data.outstanding)}
              </p>
            </CardContent>
          </Card>
          <Card className="border-0" style={{ boxShadow: "var(--lux-card-shadow, 0 2px 8px rgba(0,0,0,0.06))" }} data-testid="card-overdue">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="w-4 h-4" style={{ color: overdueAmount > 0 ? "#ef4444" : "var(--lux-text-muted)" }} />
                <span className="text-[11px] font-medium uppercase tracking-wider" data-testid="stat-label-overdue" style={{ color: "#f87171" }}>Overdue</span>
              </div>
              <p className="text-xl font-bold" style={{ color: overdueAmount > 0 ? "#ef4444" : "var(--lux-text)" }} data-testid="text-overdue-amount">
                {formatCurrency(overdueAmount)}
              </p>
              {overdueInvoices.length > 0 && (
                <p className="text-[10px] mt-1" style={{ color: "#ef4444" }}>{overdueInvoices.length} invoice{overdueInvoices.length > 1 ? "s" : ""}</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList data-testid="tabs-portal">
            <TabsTrigger value="invoices" data-testid="tab-invoices">
              <FileText className="w-4 h-4 mr-1" /> Invoices ({data.invoices.length})
            </TabsTrigger>
            <TabsTrigger value="estimates" data-testid="tab-estimates">
              <Building2 className="w-4 h-4 mr-1" /> Estimates ({data.estimates.length})
            </TabsTrigger>
            <TabsTrigger value="payments" data-testid="tab-payments">
              <DollarSign className="w-4 h-4 mr-1" /> Payments ({data.payments.length})
            </TabsTrigger>
          </TabsList>

          {/* Invoices Tab */}
          <TabsContent value="invoices">
            <Card>
              <CardContent className="p-0">
                {sortedInvoices.length === 0 ? (
                  <div className="py-12 text-center" data-testid="text-no-invoices">
                    <FileText className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">No invoices yet</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Invoice</TableHead>
                          <TableHead>Issued</TableHead>
                          <TableHead>Due Date</TableHead>
                          <TableHead>Total</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Balance</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sortedInvoices.map((inv) => {
                          const overdue = isOverdue(inv);
                          const balance = invoiceBalance(inv);
                          const sc = statusColor(inv.status);
                          return (
                            <TableRow
                              key={inv.id}
                              className="cursor-pointer hover:bg-muted/50"
                              style={overdue ? { background: "rgba(239,68,68,0.04)" } : undefined}
                              onClick={() => setSelectedInvoice(inv)}
                              data-testid={`row-invoice-${inv.id}`}
                            >
                              <TableCell className="font-semibold" data-testid={`text-invoice-number-${inv.id}`}>
                                {inv.number}
                              </TableCell>
                              <TableCell className="text-sm" data-testid={`text-invoice-date-${inv.id}`}>
                                {formatDate(inv.issuedDate)}
                              </TableCell>
                              <TableCell className="text-sm" data-testid={`text-invoice-due-${inv.id}`}>
                                <span style={{ color: overdue ? "#ef4444" : undefined, fontWeight: overdue ? 600 : undefined }}>
                                  {formatDate(inv.dueDate)}
                                </span>
                                {overdue && (
                                  <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }} data-testid={`badge-overdue-${inv.id}`}>
                                    {daysOverdue(inv)}d overdue
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="font-medium" data-testid={`text-invoice-total-${inv.id}`}>
                                {formatCurrency(inv.total)}
                              </TableCell>
                              <TableCell>
                                <span className="text-xs font-semibold px-2 py-1 rounded-full" style={{ background: sc.bg, color: sc.text }} data-testid={`badge-invoice-status-${inv.id}`}>
                                  {overdue ? "OVERDUE" : inv.status}
                                </span>
                              </TableCell>
                              <TableCell data-testid={`text-invoice-balance-${inv.id}`}>
                                <span style={{ color: balance > 0 ? (overdue ? "#ef4444" : "#f59e0b") : "#22c55e", fontWeight: 600 }}>
                                  {formatCurrency(balance)}
                                </span>
                              </TableCell>
                              <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                                {inv.publicToken && (
                                  <Button variant="outline" size="sm" asChild data-testid={`button-download-pdf-${inv.id}`}>
                                    <a href={`/api/public/invoices/${inv.publicToken}/pdf`} target="_blank" rel="noopener noreferrer">
                                      <Download className="w-4 h-4 mr-1" /> PDF
                                    </a>
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Estimates Tab */}
          <TabsContent value="estimates">
            <Card>
              <CardContent className="p-0">
                {data.estimates.length === 0 ? (
                  <div className="py-12 text-center" data-testid="text-no-estimates">
                    <Building2 className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">No estimates yet</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Number</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Total</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.estimates.map((est) => {
                          const ec = estimateStatusColor(est.status);
                          return (
                            <TableRow key={est.id} data-testid={`row-estimate-${est.id}`}>
                              <TableCell className="font-semibold" data-testid={`text-estimate-number-${est.id}`}>{est.number}</TableCell>
                              <TableCell className="text-sm" data-testid={`text-estimate-date-${est.id}`}>{formatDate(est.issuedDate)}</TableCell>
                              <TableCell className="font-medium" data-testid={`text-estimate-total-${est.id}`}>{formatCurrency(est.total)}</TableCell>
                              <TableCell>
                                <span className="text-xs font-semibold px-2 py-1 rounded-full" style={{ background: ec.bg, color: ec.text }} data-testid={`badge-estimate-status-${est.id}`}>
                                  {est.status}
                                </span>
                              </TableCell>
                              <TableCell className="text-right">
                                {est.status === "SENT" && est.publicToken && (
                                  <div className="flex items-center justify-end gap-2">
                                    <Button size="sm" onClick={() => acceptMutation.mutate(est.publicToken!)} disabled={acceptMutation.isPending} className="text-white" style={{ background: "#22c55e" }} data-testid={`button-accept-estimate-${est.id}`}>
                                      <Check className="w-4 h-4 mr-1" /> Accept
                                    </Button>
                                    <Button variant="outline" size="sm" onClick={() => declineMutation.mutate(est.publicToken!)} disabled={declineMutation.isPending} data-testid={`button-decline-estimate-${est.id}`}>
                                      <X className="w-4 h-4 mr-1" /> Decline
                                    </Button>
                                  </div>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Payments Tab */}
          <TabsContent value="payments">
            <Card>
              <CardContent className="p-0">
                {data.payments.length === 0 ? (
                  <div className="py-12 text-center" data-testid="text-no-payments">
                    <DollarSign className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">No payments recorded yet</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Amount</TableHead>
                          <TableHead>Method</TableHead>
                          <TableHead>Invoice</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {[...data.payments].sort((a, b) => b.date.localeCompare(a.date)).map((pmt) => (
                          <TableRow key={pmt.id} data-testid={`row-payment-${pmt.id}`}>
                            <TableCell className="text-sm" data-testid={`text-payment-date-${pmt.id}`}>{formatDate(pmt.date)}</TableCell>
                            <TableCell className="font-semibold" style={{ color: "#22c55e" }} data-testid={`text-payment-amount-${pmt.id}`}>{formatCurrency(pmt.amount)}</TableCell>
                            <TableCell>
                              <span className="text-xs font-semibold px-2 py-1 rounded-full" style={{ background: "rgba(59,130,246,0.1)", color: "#3b82f6" }} data-testid={`text-payment-method-${pmt.id}`}>{pmt.method}</span>
                            </TableCell>
                            <TableCell className="text-sm" data-testid={`text-payment-invoice-${pmt.id}`}>{pmt.invoiceNumber}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="text-center py-4">
          <p className="text-xs" style={{ color: "var(--lux-text-muted, #94a3b8)" }}>
            Powered by CherryWorks Pro • {data.org?.name}
            {data.org?.phone && ` • ${data.org.phone}`}
            {data.org?.email && ` • ${data.org.email}`}
          </p>
        </div>
      </div>

      {/* Invoice Detail Dialog */}
      <Dialog open={!!selectedInvoice} onOpenChange={(open) => !open && setSelectedInvoice(null)}>
        <DialogContent className="max-w-xl" style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}>
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between" style={{ color: "var(--lux-text)" }}>
              <span>Invoice {selectedInvoice?.number}</span>
              {selectedInvoice && (
                <span className="text-xs font-semibold px-2 py-1 rounded-full" style={{ ...(() => { const sc = statusColor(selectedInvoice.status); return { background: sc.bg, color: sc.text }; })() }}>
                  {isOverdue(selectedInvoice) ? "OVERDUE" : selectedInvoice.status}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          {selectedInvoice && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Issued</p>
                  <p className="font-medium" style={{ color: "var(--lux-text)" }}>{formatDate(selectedInvoice.issuedDate)}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Due Date</p>
                  <p className="font-medium" style={{ color: isOverdue(selectedInvoice) ? "#ef4444" : "var(--lux-text)" }}>
                    {formatDate(selectedInvoice.dueDate)}
                    {isOverdue(selectedInvoice) && ` (${daysOverdue(selectedInvoice)}d overdue)`}
                  </p>
                </div>
              </div>

              <div className="rounded-lg p-4" style={{ background: "var(--lux-bg, #f8fafc)", border: "1px solid var(--lux-border)" }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm" style={{ color: "var(--lux-text-muted)" }}>Total</span>
                  <span className="text-lg font-bold" style={{ color: "var(--lux-text)" }}>{formatCurrency(selectedInvoice.total)}</span>
                </div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm" style={{ color: "var(--lux-text-muted)" }}>Paid</span>
                  <span className="text-sm font-semibold" style={{ color: "#22c55e" }}>{formatCurrency(selectedInvoice.paidAmount)}</span>
                </div>
                <div className="flex items-center justify-between pt-2" style={{ borderTop: "1px solid var(--lux-border, #e2e8f0)" }}>
                  <span className="text-sm font-semibold" style={{ color: "var(--lux-text)" }}>Balance Due</span>
                  <span className="text-lg font-bold" style={{ color: invoiceBalance(selectedInvoice) > 0 ? (isOverdue(selectedInvoice) ? "#ef4444" : "#f59e0b") : "#22c55e" }}>
                    {formatCurrency(invoiceBalance(selectedInvoice))}
                  </span>
                </div>
              </div>

              {invoicePayments.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--lux-text-muted)" }}>Payment History</p>
                  <div className="space-y-1">
                    {invoicePayments.map(pmt => (
                      <div key={pmt.id} className="flex items-center justify-between py-1.5 px-3 rounded text-sm" style={{ background: "var(--lux-bg, #f8fafc)" }}>
                        <div>
                          <span style={{ color: "var(--lux-text)" }}>{formatDate(pmt.date)}</span>
                          <span className="ml-2 text-xs" style={{ color: "var(--lux-text-muted)" }}>{pmt.method}</span>
                        </div>
                        <span className="font-semibold" style={{ color: "#22c55e" }}>{formatCurrency(pmt.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedInvoice.publicToken && (
                <div className="flex justify-end pt-2">
                  <Button variant="outline" asChild data-testid="button-dialog-download-pdf">
                    <a href={`/api/public/invoices/${selectedInvoice.publicToken}/pdf`} target="_blank" rel="noopener noreferrer">
                      <Download className="w-4 h-4 mr-1" /> Download PDF
                    </a>
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
