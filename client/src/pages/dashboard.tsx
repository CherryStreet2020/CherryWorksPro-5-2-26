import { useState } from "react";
import { ErrorState } from "@/components/shared/error-state";
import { PageHelpLink } from "@/components/page-help-link";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLocation } from "wouter";
import {
  DollarSign,
  TrendingUp,
  AlertTriangle,
  AlertCircle,
  Clock,
  FileText,
  FolderKanban,
  Plus,
  FilePlus,
  Bell,
  Briefcase,
  CheckCircle,
  CreditCard,
  ArrowRight,
  Users,
  Mail,
  Ban,
  Wallet,
  ClipboardList,
  XCircle,
  UserPlus,
  Send,
  ThumbsUp,
  ThumbsDown,
  RefreshCw,
  Link2,
  Settings,
  Download,
  Repeat,
  Activity,
  Building2,
  type LucideIcon,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Legend,
} from "recharts";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { MoneyDisplay } from "@/components/shared/money-display";
import { DateDisplay } from "@/components/shared/date-display";
import { EmptyState } from "@/components/shared/empty-state";
import { AvatarInitials } from "@/components/shared/avatar-initials";
import { formatMoney, formatHoursMinutes, formatRelativeDate, getCurrencySymbol, formatPercent, formatHours } from "@/components/shared/format";
import { useBaseCurrency } from "@/hooks/use-base-currency";
import { useDocumentTitle } from "@/lib/use-document-title";
import { MailboxReconnectBanner } from "@/components/mailbox-reconnect-banner";
import { EmailFailureAlertsCard } from "@/components/email-failure-alerts-card";
import { MarketingOsTelemetryCard } from "@/components/marketing-os-telemetry-card";

interface DashboardStats {
  totalRevenue: number;
  totalCollected: number;
  totalOutstanding: number;
  overdueAmount: number;
  unbilledHours: number;
  unbilledValue: number;
  totalClients: number;
  activeProjects: number;
  pendingInvoices: number;
  revenueByMonth: Array<{ month: string; invoiced: number; collected: number }>;
  topClients: Array<{ name: string; revenue: number; outstanding: number }>;
  recentTimeEntries: Array<{
    id: string;
    userName: string;
    projectName: string;
    minutes: number;
    date: string;
    billable: boolean;
  }>;
  recentInvoices: Array<{
    id: string;
    number: string;
    clientName: string;
    total: string;
    paidAmount: string;
    status: string;
    issuedDate: string;
    dueDate: string;
  }>;
  recentPayments: Array<{
    invoiceNumber: string;
    clientName: string;
    amount: string;
    date: string;
    method: string;
  }>;
  utilizationThisWeek: number;
  teamMemberUtilization: Array<{
    name: string;
    billableHours: number;
    totalHours: number;
    utilization: number;
  }>;
  arAgingBuckets: {
    current: number;
    days30: number;
    days60: number;
    days90plus: number;
  };
  overdueInvoices: Array<{
    id: string;
    number: string;
    clientName: string;
    amount: number;
    daysOverdue: number;
  }>;
  unbilledByProject: Array<{
    projectName: string;
    clientName: string;
    minutes: number;
    value: number;
  }>;
  activeProjectsList: Array<{
    id: string;
    name: string;
    clientName: string;
    memberCount: number;
  }>;
}

type DrillDownType = "revenue" | "collected" | "outstanding" | "overdue" | "unbilled" | "projects" | "pending";

function DrillDownTable({ children, footer }: { children: any; footer?: any }) {
  return (
    <div className="overflow-x-auto -mx-6">
      <table className="w-full text-sm">
        {children}
      </table>
      {footer}
    </div>
  );
}

function ThRow({ children }: { children: any }) {
  return (
    <tr style={{ background: "var(--lux-table-header-bg)" }}>
      {children}
    </tr>
  );
}

function Th({ children, align }: { children: any; align?: "left" | "right" }) {
  return (
    <th className={`${align === "right" ? "text-right" : "text-left"} px-6 py-2 font-semibold text-xs uppercase tracking-wider`} style={{ color: "var(--lux-text-muted)" }}>
      {children}
    </th>
  );
}

function Td({ children, align, bold, color }: { children: any; align?: "left" | "right"; bold?: boolean; color?: string }) {
  return (
    <td className={`${align === "right" ? "text-right" : "text-left"} px-6 py-3 ${bold ? "font-semibold" : ""}`} style={{ color: color || "var(--lux-text)" }}>
      {children}
    </td>
  );
}

function RevenueDetail({ invoices, navigate, currency }: { invoices?: DashboardStats["recentInvoices"]; navigate: (path: string) => void; currency?: string }) {
  if (!invoices?.length) return <EmptyState icon={FileText} title="No invoices" description="No invoice data to show." />;
  const sorted = [...invoices].sort((a, b) => Number(b.total) - Number(a.total));
  const total = sorted.reduce((s, i) => s + Number(i.total), 0);
  return (
    <DrillDownTable
      footer={
        <div className="flex items-center justify-between px-6 py-3 border-t" style={{ borderColor: "var(--lux-border)" }}>
          <span className="text-sm font-bold" style={{ color: "var(--lux-text)" }}>Total</span>
          <MoneyDisplay value={total} size="sm" currency={currency} />
        </div>
      }
    >
      <thead><ThRow><Th>Invoice</Th><Th>Client</Th><Th>Date</Th><Th align="right">Total</Th><Th>Status</Th></ThRow></thead>
      <tbody>
        {sorted.map((inv) => (
          <tr key={inv.id} className="border-t cursor-pointer hover:bg-black/5 dark:hover:bg-white/5" style={{ borderColor: "var(--lux-border)" }} onClick={() => navigate("/invoices")} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target !== e.currentTarget) return; if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/invoices"); } }} data-testid={`drilldown-revenue-${inv.id}`}>
            <Td bold>{inv.number}</Td>
            <Td>{inv.clientName}</Td>
            <Td><DateDisplay value={inv.issuedDate} /></Td>
            <Td align="right"><MoneyDisplay value={inv.total} currency={currency} /></Td>
            <Td><StatusBadge status={inv.status} size="xs" /></Td>
          </tr>
        ))}
      </tbody>
    </DrillDownTable>
  );
}

function CollectedDetail({ payments, navigate, currency }: { payments?: DashboardStats["recentPayments"]; navigate: (path: string) => void; currency?: string }) {
  if (!payments?.length) return <EmptyState icon={CreditCard} title="No payments" description="No payments recorded yet." />;
  const total = payments.reduce((s, p) => s + Number(p.amount), 0);
  return (
    <DrillDownTable
      footer={
        <div className="flex items-center justify-between px-6 py-3 border-t" style={{ borderColor: "var(--lux-border)" }}>
          <span className="text-sm font-bold" style={{ color: "var(--lux-text)" }}>Total Collected</span>
          <MoneyDisplay value={total} color="positive" size="sm" currency={currency} />
        </div>
      }
    >
      <thead><ThRow><Th>Invoice</Th><Th>Client</Th><Th>Date</Th><Th align="right">Amount</Th><Th>Method</Th></ThRow></thead>
      <tbody>
        {payments.map((pay, idx) => (
          <tr key={idx} className="border-t cursor-pointer hover:bg-black/5 dark:hover:bg-white/5" style={{ borderColor: "var(--lux-border)" }} onClick={() => navigate("/payments")} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target !== e.currentTarget) return; if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/payments"); } }} data-testid={`drilldown-collected-${idx}`}>
            <Td bold>{pay.invoiceNumber}</Td>
            <Td>{pay.clientName}</Td>
            <Td><DateDisplay value={pay.date} /></Td>
            <Td align="right"><MoneyDisplay value={pay.amount} color="positive" currency={currency} /></Td>
            <Td><StatusBadge status={pay.method} size="xs" /></Td>
          </tr>
        ))}
      </tbody>
    </DrillDownTable>
  );
}

function OutstandingDetail({ invoices, navigate, currency }: { invoices?: DashboardStats["recentInvoices"]; navigate: (path: string) => void; currency?: string }) {
  if (!invoices?.length) return <EmptyState icon={AlertTriangle} title="No outstanding" description="All invoices are paid." />;
  const rows = invoices
    .map(inv => ({
      ...inv,
      outstanding: Number(inv.total) - Number(inv.paidAmount),
      daysSince: inv.issuedDate ? Math.floor((Date.now() - new Date(inv.issuedDate).getTime()) / (1000 * 60 * 60 * 24)) : 0,
    }))
    .filter(r => r.outstanding > 0)
    .sort((a, b) => b.outstanding - a.outstanding);
  if (!rows.length) return <EmptyState icon={CheckCircle} title="All paid" description="No outstanding invoices." />;
  const total = rows.reduce((s, r) => s + r.outstanding, 0);
  return (
    <DrillDownTable
      footer={
        <div className="flex items-center justify-between px-6 py-3 border-t" style={{ borderColor: "var(--lux-border)" }}>
          <span className="text-sm font-bold" style={{ color: "var(--lux-text)" }}>Total Outstanding</span>
          <MoneyDisplay value={total} color="negative" size="sm" currency={currency} />
        </div>
      }
    >
      <thead><ThRow><Th>Invoice</Th><Th>Client</Th><Th align="right">Total</Th><Th align="right">Paid</Th><Th align="right">Outstanding</Th><Th align="right">Days</Th></ThRow></thead>
      <tbody>
        {rows.map((inv) => (
          <tr key={inv.id} className="border-t cursor-pointer hover:bg-black/5 dark:hover:bg-white/5" style={{ borderColor: "var(--lux-border)" }} onClick={() => navigate("/invoices")} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target !== e.currentTarget) return; if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/invoices"); } }} data-testid={`drilldown-outstanding-${inv.id}`}>
            <Td bold>{inv.number}</Td>
            <Td>{inv.clientName}</Td>
            <Td align="right"><MoneyDisplay value={inv.total} currency={currency} /></Td>
            <Td align="right"><MoneyDisplay value={inv.paidAmount} color="positive" currency={currency} /></Td>
            <Td align="right"><MoneyDisplay value={inv.outstanding} color="negative" currency={currency} /></Td>
            <Td align="right">{inv.daysSince}d</Td>
          </tr>
        ))}
      </tbody>
    </DrillDownTable>
  );
}

function OverdueDetail({ invoices, navigate, currency }: { invoices?: DashboardStats["overdueInvoices"]; navigate: (path: string) => void; currency?: string }) {
  if (!invoices?.length) return <EmptyState icon={CheckCircle} title="No overdue" description="All invoices are current." />;
  const total = invoices.reduce((s, i) => s + i.amount, 0);
  return (
    <DrillDownTable
      footer={
        <div className="flex items-center justify-between px-6 py-3 border-t" style={{ borderColor: "var(--lux-border)" }}>
          <span className="text-sm font-bold" style={{ color: "var(--lux-text)" }}>Total Overdue</span>
          <MoneyDisplay value={total} color="negative" size="sm" currency={currency} />
        </div>
      }
    >
      <thead><ThRow><Th>Invoice</Th><Th>Client</Th><Th align="right">Amount Due</Th><Th align="right">Days Overdue</Th></ThRow></thead>
      <tbody>
        {invoices.map((inv) => (
          <tr key={inv.id} className="border-t cursor-pointer hover:bg-black/5 dark:hover:bg-white/5" style={{ borderColor: "var(--lux-border)" }} onClick={() => navigate("/invoices")} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target !== e.currentTarget) return; if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/invoices"); } }} data-testid={`drilldown-overdue-${inv.id}`}>
            <Td bold>{inv.number}</Td>
            <Td>{inv.clientName}</Td>
            <Td align="right"><MoneyDisplay value={inv.amount} color="negative" currency={currency} /></Td>
            <Td align="right" bold color="#ef4444">{inv.daysOverdue}d</Td>
          </tr>
        ))}
      </tbody>
    </DrillDownTable>
  );
}

function UnbilledDetail({ stats, navigate, currency }: { stats?: DashboardStats; navigate: (path: string) => void; currency?: string }) {
  const rows = stats?.unbilledByProject || [];
  if (!rows.length) return <EmptyState icon={Clock} title="No unbilled time" description="All billable time has been invoiced." />;
  const totalMinutes = rows.reduce((s, r) => s + r.minutes, 0);
  const totalValue = rows.reduce((s, r) => s + r.value, 0);
  return (
    <DrillDownTable
      footer={
        <div className="flex items-center justify-between px-6 py-3 border-t" style={{ borderColor: "var(--lux-border)" }}>
          <div>
            <span className="text-sm font-bold" style={{ color: "var(--lux-text)" }}>Total: {formatHoursMinutes(totalMinutes)}</span>
          </div>
          <div className="flex items-center gap-3">
            <MoneyDisplay value={totalValue} size="sm" currency={currency} />
            <Button size="sm" onClick={() => navigate("/time")} data-testid="drilldown-unbilled-generate">
              Generate Invoice <ArrowRight className="w-3 h-3 ml-1" />
            </Button>
          </div>
        </div>
      }
    >
      <thead><ThRow><Th>Project</Th><Th>Client</Th><Th align="right">Hours</Th><Th align="right">Est. Amount</Th></ThRow></thead>
      <tbody>
        {rows.map((row, idx) => (
          <tr key={idx} className="border-t" style={{ borderColor: "var(--lux-border)" }} data-testid={`drilldown-unbilled-${idx}`}>
            <Td bold>{row.projectName}</Td>
            <Td>{row.clientName}</Td>
            <Td align="right">{formatHoursMinutes(row.minutes)}</Td>
            <Td align="right"><MoneyDisplay value={row.value} currency={currency} /></Td>
          </tr>
        ))}
      </tbody>
    </DrillDownTable>
  );
}

function ProjectsDetail({ stats, navigate }: { stats?: DashboardStats; navigate: (path: string) => void }) {
  const rows = stats?.activeProjectsList || [];
  if (!rows.length) return <EmptyState icon={FolderKanban} title="No active projects" description="No active projects right now." />;
  return (
    <DrillDownTable>
      <thead><ThRow><Th>Project</Th><Th>Client</Th><Th align="right">Members</Th></ThRow></thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.id} className="border-t cursor-pointer hover:bg-black/5 dark:hover:bg-white/5" style={{ borderColor: "var(--lux-border)" }} onClick={() => navigate(`/projects/${p.id}`)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target !== e.currentTarget) return; if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/projects/${p.id}`); } }} data-testid={`drilldown-project-${p.id}`}>
            <Td bold>{p.name}</Td>
            <Td>{p.clientName}</Td>
            <Td align="right">
              <span className="inline-flex items-center gap-1">
                <Users className="w-3 h-3" style={{ color: "var(--lux-text-muted)" }} />
                {p.memberCount}
              </span>
            </Td>
          </tr>
        ))}
      </tbody>
    </DrillDownTable>
  );
}

function PendingDetail({ invoices, navigate, currency }: { invoices?: DashboardStats["recentInvoices"]; navigate: (path: string) => void; currency?: string }) {
  const pending = (invoices || []).filter(i => i.status === "SENT");
  if (!pending.length) return <EmptyState icon={FileText} title="No pending invoices" description="All invoices are paid or drafted." />;
  const total = pending.reduce((s, i) => s + Number(i.total), 0);
  return (
    <DrillDownTable
      footer={
        <div className="flex items-center justify-between px-6 py-3 border-t" style={{ borderColor: "var(--lux-border)" }}>
          <span className="text-sm font-bold" style={{ color: "var(--lux-text)" }}>Total Pending</span>
          <MoneyDisplay value={total} size="sm" currency={currency} />
        </div>
      }
    >
      <thead><ThRow><Th>Invoice</Th><Th>Client</Th><Th>Sent</Th><Th align="right">Total</Th><Th align="right">Days Since Sent</Th></ThRow></thead>
      <tbody>
        {pending.map((inv) => {
          const daysSince = inv.issuedDate ? Math.floor((Date.now() - new Date(inv.issuedDate).getTime()) / (1000 * 60 * 60 * 24)) : 0;
          return (
            <tr key={inv.id} className="border-t cursor-pointer hover:bg-black/5 dark:hover:bg-white/5" style={{ borderColor: "var(--lux-border)" }} onClick={() => navigate("/invoices")} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target !== e.currentTarget) return; if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/invoices"); } }} data-testid={`drilldown-pending-${inv.id}`}>
              <Td bold>{inv.number}</Td>
              <Td>{inv.clientName}</Td>
              <Td><DateDisplay value={inv.issuedDate} /></Td>
              <Td align="right"><MoneyDisplay value={inv.total} currency={currency} /></Td>
              <Td align="right">{daysSince}d</Td>
            </tr>
          );
        })}
      </tbody>
    </DrillDownTable>
  );
}

interface ActivityFeedItem {
  id: number;
  action: string;
  entityType: string;
  entityId: string;
  details: any;
  userName: string;
  createdAt: string;
}

const ACTIVITY_CONFIG: Record<string, {
  Icon: LucideIcon;
  color: string;
  format: (details: any, userName: string) => { title: string; subtitle: string };
}> = {
  INVOICE_CREATED: {
    Icon: FileText,
    color: "#3b82f6",
    format: (d, u) => ({ title: `Invoice ${d.number || ""} generated`, subtitle: u }),
  },
  INVOICE_SENT: {
    Icon: Mail,
    color: "#3b82f6",
    format: (d, u) => ({ title: `Invoice ${d.number || ""} sent`, subtitle: d.clientName ? `${formatMoney(d.total || 0)} · ${d.clientName}` : u }),
  },
  INVOICE_VOIDED: {
    Icon: Ban,
    color: "#ef4444",
    format: (d, u) => ({ title: `Invoice ${d.number || ""} voided`, subtitle: u }),
  },
  INVOICE_GENERATE_OVERRIDE_UNAPPROVED: {
    Icon: AlertTriangle,
    color: "#f59e0b",
    format: (d, u) => ({ title: `Invoice generated with unapproved time`, subtitle: `${d.unapprovedEntries || 0} unapproved entries included` }),
  },
  PAYMENT_RECORDED: {
    Icon: Wallet,
    color: "#22c55e",
    format: (d, u) => ({ title: `Payment ${formatMoney(d.amount || 0)} received`, subtitle: d.invoiceNumber ? `Invoice ${d.invoiceNumber}` : u }),
  },
  PAYMENT_REFUNDED: {
    Icon: CreditCard,
    color: "#ef4444",
    format: (d, u) => ({ title: `Refund issued`, subtitle: d.amount ? formatMoney(d.amount) : u }),
  },
  TIMESHEET_SUBMITTED: {
    Icon: ClipboardList,
    color: "#3b82f6",
    format: (d, u) => ({ title: `Timesheet submitted`, subtitle: u }),
  },
  TIMESHEET_APPROVED: {
    Icon: CheckCircle,
    color: "#22c55e",
    format: (d, u) => ({ title: `Timesheet approved`, subtitle: u }),
  },
  TIMESHEET_REJECTED: {
    Icon: XCircle,
    color: "#ef4444",
    format: (d, u) => ({ title: `Timesheet rejected`, subtitle: d.reason ? `${u} · "${d.reason}"` : u }),
  },
  USER_INVITED: {
    Icon: UserPlus,
    color: "#8b5cf6",
    format: (d) => ({ title: `New team member invited`, subtitle: `${d.name || ""} · ${d.email || ""}` }),
  },
  ESTIMATE_SENT: {
    Icon: Send,
    color: "#3b82f6",
    format: (d, u) => ({ title: `Estimate ${d.number || ""} sent`, subtitle: u }),
  },
  ESTIMATE_ACCEPTED: {
    Icon: ThumbsUp,
    color: "#22c55e",
    format: (d, u) => ({ title: `Estimate ${d.number || ""} accepted`, subtitle: d.clientName || u }),
  },
  ESTIMATE_DECLINED: {
    Icon: ThumbsDown,
    color: "#ef4444",
    format: (d, u) => ({ title: `Estimate ${d.number || ""} declined`, subtitle: d.clientName || u }),
  },
  ESTIMATE_CONVERTED_TO_INVOICE: {
    Icon: RefreshCw,
    color: "#22c55e",
    format: (d, u) => ({ title: `Estimate converted to invoice`, subtitle: d.number || u }),
  },
  CLIENT_PORTAL_GENERATED: {
    Icon: Link2,
    color: "#3b82f6",
    format: (d, u) => ({ title: `Client portal link generated`, subtitle: d.clientName || u }),
  },
  ORG_SETTINGS_UPDATED: {
    Icon: Settings,
    color: "var(--lux-text-muted)",
    format: (d, u) => ({ title: `Organization settings updated`, subtitle: u }),
  },
  IMPORT_EXECUTED: {
    Icon: Download,
    color: "#22c55e",
    format: (d, u) => ({ title: `FreshBooks import completed`, subtitle: u }),
  },
  RECURRING_INVOICE_GENERATED: {
    Icon: Repeat,
    color: "#3b82f6",
    format: (d, u) => ({ title: `Recurring invoice generated`, subtitle: d.number || u }),
  },
  EXPENSE_CREATED: {
    Icon: DollarSign,
    color: "#f59e0b",
    format: (d, u) => ({ title: `Expense created`, subtitle: d.vendor ? `${formatMoney(d.amount || 0)} · ${d.vendor}` : `${formatMoney(d.amount || 0)} · ${u}` }),
  },
  EXPENSE_SUBMITTED: {
    Icon: Send,
    color: "#3b82f6",
    format: (d, u) => ({ title: `Expense submitted for approval`, subtitle: `${formatMoney(d.amount || 0)} · ${u}` }),
  },
  EXPENSE_APPROVED: {
    Icon: CheckCircle,
    color: "#22c55e",
    format: (d, u) => ({ title: `Expense approved`, subtitle: `${formatMoney(d.amount || 0)} · ${u}` }),
  },
  EXPENSE_REJECTED: {
    Icon: XCircle,
    color: "#ef4444",
    format: (d, u) => ({ title: `Expense rejected`, subtitle: d.reason ? `${formatMoney(d.amount || 0)} · "${d.reason}"` : `${formatMoney(d.amount || 0)} · ${u}` }),
  },
  EXPENSE_REPORT_SUBMITTED: {
    Icon: FileText,
    color: "#3b82f6",
    format: (d, u) => ({ title: `Expense report submitted`, subtitle: d.title ? `${d.title} · ${formatMoney(d.totalAmount || 0)}` : u }),
  },
  EXPENSE_REPORT_APPROVED: {
    Icon: CheckCircle,
    color: "#22c55e",
    format: (d, u) => ({ title: `Expense report approved`, subtitle: d.title ? `${d.title} · ${formatMoney(d.totalAmount || 0)}` : u }),
  },
  PAYOUT_AUTO_CREATED: {
    Icon: Wallet,
    color: "#a855f7",
    format: (d, u) => ({ title: `Auto-payout created`, subtitle: d.teamMemberName ? `${formatMoney(d.amount || 0)} · ${d.teamMemberName}` : `${formatMoney(d.amount || 0)} · ${u}` }),
  },
  PAYOUT_RECORDED: {
    Icon: Wallet,
    color: "#22c55e",
    format: (d, u) => ({ title: `Payout recorded`, subtitle: d.teamMemberName ? `${formatMoney(d.amount || 0)} · ${d.teamMemberName}` : `${formatMoney(d.amount || 0)} · ${u}` }),
  },
  REPORT_RUN_PROFITABILITY: {
    Icon: TrendingUp,
    color: "var(--lux-text-muted)",
    format: (d, u) => ({ title: `Profitability report run`, subtitle: `${d.projectCount || 0} projects · ${u}` }),
  },
};

const DEFAULT_ACTIVITY_CONFIG = {
  Icon: Activity as LucideIcon,
  color: "var(--lux-text-muted)",
  format: (d: any, u: string, action?: string) => ({
    title: ((action || d.action || "Activity").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c: string) => c.toUpperCase())) + (d.number ? ` ${d.number}` : "") + (d.amount ? ` · ${formatMoney(d.amount)}` : ""),
    subtitle: d.clientName || d.teamMemberName || d.vendor || d.title || u,
  }),
};

function safeParseJson(val: any): Record<string, any> {
  if (typeof val === "object" && val !== null) return val;
  try {
    return JSON.parse(val || "{}");
  } catch {
    return {};
  }
}

function ActivityItem({ item }: { item: ActivityFeedItem }) {
  const config = ACTIVITY_CONFIG[item.action] || DEFAULT_ACTIVITY_CONFIG;
  const details = safeParseJson(item.details);
  const { title, subtitle } = config === DEFAULT_ACTIVITY_CONFIG
    ? DEFAULT_ACTIVITY_CONFIG.format(details, item.userName, item.action)
    : config.format(details, item.userName);
  const IconComp = config.Icon;

  return (
    <div className="flex items-start gap-3 py-3 px-5" style={{ borderBottom: "1px solid var(--lux-border)" }} data-testid={`activity-item-${item.id}`}>
      <div className="flex-shrink-0 mt-0.5 w-7 h-7 rounded-full flex items-center justify-center" style={{ background: `${config.color}15` }}>
        <IconComp className="w-3.5 h-3.5" style={{ color: config.color }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>{title}</p>
        <p className="text-xs truncate" style={{ color: "var(--lux-text-muted)" }}>{subtitle}</p>
      </div>
      <span className="text-xs flex-shrink-0 whitespace-nowrap" style={{ color: "var(--lux-text-muted)" }}>
        {formatRelativeDate(item.createdAt)}
      </span>
    </div>
  );
}

function TeamMemberDashboard() {
  const { user } = useAuth();
  const baseCurrency = useBaseCurrency();
  const [, navigate] = useLocation();
  const { data: myData, isLoading } = useQuery<any>({ queryKey: ["/api/dashboard/my"] });
  const { data: earningsData } = useQuery<any>({ queryKey: ["/api/my/earnings"] });

  if (isLoading) {
    return (
      <div className="px-6 lg:px-8 xl:px-10 py-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      </div>
    );
  }

  const hours = myData?.hoursThisWeek || { billable: 0, nonBillable: 0, total: 0 };
  const utilPct = hours.total > 0 ? Math.round((hours.billable / hours.total) * 100) : 0;
  const earnings = myData?.earnings || {
    unbilled: { hours: 0, amount: 0, byProject: [] },
    billedAwaiting: { hours: 0, amount: 0, items: [], nextPaymentDate: null },
    paid: { hours: 0, amount: 0, items: [] },
    totalOutstanding: 0,
  };

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return "—";
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function daysFromNow(dateStr: string | null): string {
    if (!dateStr) return "";
    const now = new Date();
    const target = new Date(dateStr + "T12:00:00");
    const diff = Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (diff < 0) return `${Math.abs(diff)}d overdue`;
    if (diff === 0) return "Due today";
    return `in ${diff} days`;
  }

  return (
    <div className="px-6 lg:px-8 xl:px-10 py-6 space-y-6">
      <div>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--lux-text)" }} data-testid="text-dashboard-title">My Dashboard</h1>
          <PageHelpLink />
        </div>
        <p className="text-sm mt-1" style={{ color: "var(--lux-text-muted)" }}>Your weekly overview, activity, and earnings</p>
      </div>

      {/* ── Row 1: This Week Stats ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard icon={Clock} label="Hours This Week" value={formatHoursMinutes(Math.round(hours.total * 60))} color="#3b82f6" testId="card-my-hours" />
        <StatCard icon={DollarSign} label="Billable Hours" value={formatHoursMinutes(Math.round(hours.billable * 60))} color="#22c55e" testId="card-my-billable" />
        <StatCard icon={CheckCircle} label="Utilization" value={formatPercent(utilPct)} color="#f59e0b" testId="card-my-utilization" />
      </div>

      {/* ── W-2 Employee Payroll Notice ── */}
      {(user as any)?.workerType === "W2_EMPLOYEE" && (
        <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }} data-testid="card-payroll-notice">
          <CardContent className="p-5">
            <div className="rounded-lg px-4 py-3" style={{ background: "rgba(59,130,246,0.05)", border: "1px solid rgba(59,130,246,0.15)" }}>
              <p className="text-sm font-medium" style={{ color: "#3b82f6" }}>Paid via Payroll</p>
              <p className="text-xs mt-1" style={{ color: "var(--lux-text-muted)" }}>
                Your compensation is handled through your employer's payroll system. Contact your administrator or HR department for payment details.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Row 2: My Earnings (1099 / C2C only) ── */}
      {(user as any)?.workerType !== "W2_EMPLOYEE" && (
      <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }} data-testid="card-my-earnings">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold" style={{ color: "var(--lux-text)" }}>My Earnings</h3>
            {earnings.billedAwaiting.nextPaymentDate && (
              <span className="text-xs px-2 py-1 rounded-full" style={{ background: "rgba(59,130,246,0.1)", color: "#3b82f6" }} data-testid="badge-next-payment">
                Next payment expected {daysFromNow(earnings.billedAwaiting.nextPaymentDate)}
              </span>
            )}
          </div>

          {earnings.costRateMissing && (
            <div className="rounded-lg px-3 py-2 mb-3 flex items-center gap-2" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)" }} data-testid="warning-cost-rate-missing">
              <span className="text-xs" style={{ color: "#f59e0b" }}>Cost rate not set — ask your admin to configure your pay rate</span>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
            <div className="rounded-lg px-4 py-3" style={{ background: "var(--lux-surface-alt)" }} data-testid="stat-unbilled">
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Unbilled</p>
              <p className="text-lg font-bold tabular-nums" style={{ color: "#f59e0b" }} data-testid="text-unbilled-amount">{formatMoney(earnings.unbilled.amount, baseCurrency)}</p>
              <p className="text-xs" style={{ color: "var(--lux-text-muted)" }} data-testid="text-unbilled-hours">{formatHours(earnings.unbilled.hours)}h not yet invoiced</p>
            </div>
            <div className="rounded-lg px-4 py-3" style={{ background: "var(--lux-surface-alt)" }} data-testid="stat-billed-awaiting">
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Billed — Awaiting Payment</p>
              <p className="text-lg font-bold tabular-nums" style={{ color: "#3b82f6" }}>{formatMoney(earnings.billedAwaiting.amount, baseCurrency)}</p>
              <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>{formatHours(earnings.billedAwaiting.hours)}h invoiced to client</p>
            </div>
            <div className="rounded-lg px-4 py-3" style={{ background: "var(--lux-surface-alt)" }} data-testid="stat-paid">
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Paid</p>
              <p className="text-lg font-bold tabular-nums" style={{ color: "#22c55e" }}>{formatMoney(earnings.paid.amount, baseCurrency)}</p>
              <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>{formatHours(earnings.paid.hours)}h total paid</p>
            </div>
          </div>

          {earnings.unbilled.byProject.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-semibold mb-2" style={{ color: "var(--lux-text-secondary)" }}>Unbilled by Project</p>
              <div className="space-y-1">
                {earnings.unbilled.byProject.map((p: any, i: number) => (
                  <div key={i} className="flex items-center justify-between py-1.5 px-3 rounded" style={{ background: "var(--lux-surface-alt)" }}>
                    <span className="text-sm" style={{ color: "var(--lux-text)" }}>{p.projectName}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs tabular-nums" style={{ color: "var(--lux-text-muted)" }}>{formatHours(p.hours)}h</span>
                      <span className="text-sm font-semibold tabular-nums" style={{ color: "#f59e0b" }}>{formatMoney(p.amount, baseCurrency)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {earnings.billedAwaiting.items.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-semibold mb-2" style={{ color: "var(--lux-text-secondary)" }}>Billed — Awaiting Payment</p>
              <div className="space-y-1">
                {earnings.billedAwaiting.items.map((item: any, i: number) => (
                  <div key={i} className="flex items-center justify-between py-1.5 px-3 rounded" style={{ background: "var(--lux-surface-alt)" }}>
                    <div>
                      <span className="text-sm" style={{ color: "var(--lux-text)" }}>{item.projectName}</span>
                      <span className="text-xs ml-2" style={{ color: "var(--lux-text-muted)" }}>
                        Due {formatDate(item.invoiceDueDate)}
                        {item.invoiceDueDate && <span className="ml-1" style={{ color: new Date(item.invoiceDueDate) < new Date() ? "#ef4444" : "#3b82f6" }}>({daysFromNow(item.invoiceDueDate)})</span>}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs tabular-nums" style={{ color: "var(--lux-text-muted)" }}>{formatHours(item.hours)}h</span>
                      <span className="text-sm font-semibold tabular-nums" style={{ color: "#3b82f6" }}>{formatMoney(item.amount, baseCurrency)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {earnings.paid.items.length > 0 && (
            <div>
              <p className="text-xs font-semibold mb-2" style={{ color: "var(--lux-text-secondary)" }}>Recently Paid</p>
              <div className="space-y-1">
                {earnings.paid.items.slice(0, 5).map((item: any, i: number) => (
                  <div key={i} className="flex items-center justify-between py-1.5 px-3 rounded" style={{ background: "var(--lux-surface-alt)" }}>
                    <div>
                      <span className="text-sm" style={{ color: "var(--lux-text)" }}>{item.projectName}</span>
                      {item.paidDate && <span className="text-xs ml-2" style={{ color: "var(--lux-text-muted)" }}>Paid {formatDate(item.paidDate)}</span>}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs tabular-nums" style={{ color: "var(--lux-text-muted)" }}>{formatHours(item.hours)}h</span>
                      <span className="text-sm font-semibold tabular-nums" style={{ color: "#22c55e" }}>{formatMoney(item.amount, baseCurrency)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {earnings.unbilled.amount === 0 && earnings.billedAwaiting.amount === 0 && earnings.paid.amount === 0 && (
            <p className="text-xs text-center py-4" style={{ color: "var(--lux-text-muted)" }}>
              No earnings data yet. Log billable time and get invoiced to see your earnings here.
            </p>
          )}
        </CardContent>
      </Card>
      )}

      {/* ── Row 3: Timesheet + Projects ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }} data-testid="card-timesheet-status">
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--lux-text)" }}>Timesheet Status</h3>
            <div className="flex items-center gap-3">
              {myData?.timesheetStatus ? (
                <StatusBadge status={myData.timesheetStatus} />
              ) : (
                <span className="text-sm" style={{ color: "var(--lux-text-muted)" }}>No timesheet</span>
              )}
              {myData?.timesheetStatus === "DRAFT" && (
                <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>Submit your timesheet for approval</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }} data-testid="card-my-projects">
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--lux-text)" }}>My Projects</h3>
            {myData?.myProjects?.length ? (
              <div className="space-y-1">
                {myData.myProjects.map((p: any) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => navigate(`/projects/${p.id}`)}
                    className="w-full flex items-center justify-between gap-3 py-2 px-3 rounded-lg text-left hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                    data-testid={`link-my-project-${p.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: "var(--lux-text)" }} data-testid={`text-my-project-name-${p.id}`}>{p.name}</p>
                      {p.clientName && (
                        <p className="text-xs truncate" style={{ color: "var(--lux-text-muted)" }} data-testid={`text-my-project-client-${p.id}`}>{p.clientName}</p>
                      )}
                    </div>
                    {p.status && <StatusBadge status={p.status} size="xs" />}
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={FolderKanban}
                title="No projects yet"
                description="You haven't been assigned to any projects. Once an admin adds you, they'll show up here."
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Row 4: Quick Actions ── */}
      <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }} data-testid="card-quick-actions">
        <CardContent className="p-5">
          <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--lux-text)" }}>Quick Actions</h3>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" onClick={() => navigate("/time")} data-testid="button-quick-log-time">
              <Clock className="w-4 h-4 mr-1" /> Log Time
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate("/profile")} data-testid="button-quick-profile">
              <Briefcase className="w-4 h-4 mr-1" /> My Profile
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Row 4b: Payout History ── */}
      <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }} data-testid="card-payout-history">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold" style={{ color: "var(--lux-text)" }}>Payout History</h3>
            {earningsData && (
              <div className="flex items-center gap-3">
                <span className="text-xs px-2 py-1 rounded-full" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e" }}>
                  Total received: {formatMoney(earningsData.totalEarned || 0, baseCurrency)}
                </span>
                {earningsData.pendingPayout > 0 && (
                  <span className="text-xs px-2 py-1 rounded-full" style={{ background: "rgba(245,158,11,0.1)", color: "#f59e0b" }}>
                    Pending: {formatMoney(earningsData.pendingPayout, baseCurrency)}
                  </span>
                )}
              </div>
            )}
          </div>
          {earningsData?.payoutHistory?.length > 0 ? (
            <div className="space-y-2">
              {earningsData.payoutHistory.slice(0, 10).map((p: any) => (
                <div key={p.id} className="flex items-center justify-between py-2 px-3 rounded-lg" style={{ background: "var(--lux-surface-alt)" }}>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "rgba(34,197,94,0.12)" }}>
                      <DollarSign className="w-4 h-4" style={{ color: "#22c55e" }} />
                    </div>
                    <div>
                      <p className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>
                        {formatMoney(Number(p.amount), baseCurrency)}
                      </p>
                      <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
                        via {p.paymentMethod}
                        {p.periodStart && p.periodEnd && (
                          <span> · {formatDate(p.periodStart)} – {formatDate(p.periodEnd)}</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <StatusBadge status={p.status} size="xs" />
                    <p className="text-xs mt-0.5" style={{ color: "var(--lux-text-muted)" }}>
                      {formatDate(p.payoutDate)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-center py-6" style={{ color: "var(--lux-text-muted)" }}>
              No payouts recorded yet. Once your time is billed and paid, payouts will appear here.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Row 5: Recent Entries ── */}
      {myData?.recentEntries?.length > 0 && (
        <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }} data-testid="card-recent-entries">
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--lux-text)" }}>Recent Time Entries</h3>
            <div className="space-y-2">
              {myData.recentEntries.slice(0, 8).map((e: any) => (
                <div key={e.id} className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: "var(--lux-border)" }}>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>{e.projectName}</span>
                    <DateDisplay value={e.date} />
                  </div>
                  <span className="text-sm tabular-nums" style={{ color: "var(--lux-text)" }}>{formatHoursMinutes(e.minutes)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function AdminDashboard() {
  const { toast } = useToast();
  const { user } = useAuth();
  const baseCurrency = useBaseCurrency();
  const [, navigate] = useLocation();
  const isAdmin = user?.role === "ADMIN";
  const [drillDown, setDrillDown] = useState<{ title: string; type: DrillDownType } | null>(null);

  const { data: stats, isLoading, isError: statsError, error: statsQueryError, refetch: refetchStats } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard"],
  });
  const { data: activity } = useQuery<ActivityFeedItem[]>({
    queryKey: ["/api/dashboard/activity"],
  });
  const { data: kpis } = useQuery<any>({
    queryKey: ["/api/reports/executive-kpis"],
  });
  const { data: cashFlow } = useQuery<any[]>({
    queryKey: ["/api/reports/cash-flow"],
  });
  const { data: clientRevenue } = useQuery<any[]>({
    queryKey: ["/api/reports/client-revenue"],
  });
  const { data: bankingStats } = useQuery<{
    connectedAccounts: number;
    activeConnections: number;
    totalTransactions: number;
    unreconciled: number;
    matched: number;
    reconciled: number;
    lastSync: string | null;
  }>({
    queryKey: ["/api/dashboard/banking"],
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const { data: glReconcile } = useQuery<{
    ar_subledger_total: string;
    gl_1200_balance: string;
    diff: string;
  }>({
    queryKey: ["/api/gl/reconcile"],
  });

  if (isLoading) {
    return (
      <div className="px-6 lg:px-8 xl:px-10 py-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-80 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
      </div>
    );
  }

  if (statsError) {
    return (
      <div className="px-6 lg:px-8 xl:px-10 py-6">
        <ErrorState title="Failed to load dashboard" description="We couldn't load dashboard data. Please try again." onRetry={refetchStats} error={statsQueryError as Error} />
      </div>
    );
  }

  const overdueCount = stats?.overdueInvoices?.length || 0;

  const sym = getCurrencySymbol(baseCurrency);
  function kpiMoney(val: number): string {
    return formatMoney(val, baseCurrency);
  }

  function ChartTooltip({ active, payload, label, formatter }: any) {
    if (!active || !payload?.length) return null;
    return (
      <div className="rounded-lg px-3 py-2 text-xs shadow-lg" style={{ background: "var(--lux-surface)", border: "1px solid var(--lux-border)" }}>
        <p className="font-semibold mb-1" style={{ color: "var(--lux-text)" }}>{label}</p>
        {payload.map((entry: any, i: number) => (
          <p key={i} style={{ color: entry.color }}>
            {entry.name}: {formatter ? formatter(entry.value) : formatMoney(entry.value, baseCurrency)}
          </p>
        ))}
      </div>
    );
  }

  const revenueData = (stats?.revenueByMonth || []).slice(-12);
  const cashFlowData = (cashFlow || []).slice(-12);
  const topClients = (clientRevenue || []).slice(0, 5);
  const clientPieData = topClients.map((c: any) => ({ name: c.clientName, value: c.totalInvoiced }));
  const otherRevenue = (clientRevenue || []).slice(5).reduce((s: number, c: any) => s + c.totalInvoiced, 0);
  if (otherRevenue > 0) clientPieData.push({ name: "Other", value: Math.round(otherRevenue * 100) / 100 });
  const PIE_COLORS = ["#cf3339", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#6b7280"];

  const arData = stats?.arAgingBuckets
    ? [
        { name: "Current", value: stats.arAgingBuckets.current, fill: "#22c55e" },
        { name: "1-30", value: stats.arAgingBuckets.days30, fill: "#f59e0b" },
        { name: "31-60", value: stats.arAgingBuckets.days60, fill: "#f97316" },
        { name: "90+", value: stats.arAgingBuckets.days90plus, fill: "#ef4444" },
      ].filter(d => d.value > 0)
    : [];

  return (
    <div className="px-6 lg:px-8 xl:px-10 py-6 space-y-6">
      <div>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--lux-text)" }} data-testid="text-dashboard-title">Dashboard</h1>
          <PageHelpLink />
        </div>
        <p className="text-sm mt-1" style={{ color: "var(--lux-text-muted)" }}>Executive overview of your firm's performance</p>
      </div>

      <MailboxReconnectBanner />


      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <div className="lux-kpi-card rounded-xl p-4 cursor-pointer hover:shadow-md transition-shadow" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }} onClick={() => setDrillDown({ title: "Total Revenue", type: "revenue" })} data-testid="kpi-revenue" role="region" aria-label={`Revenue MTD: ${kpiMoney(kpis?.revenueThisMonth || 0)}`}>
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Revenue (MTD)</p>
          <p className="text-xl font-bold mt-1" style={{ color: "#22c55e" }}>{kpiMoney(kpis?.revenueThisMonth || 0)}</p>
          {kpis?.revenueChange !== 0 && kpis?.revenueLastMonth !== 0 ? (
            <p className="text-[10px] mt-1" style={{ color: (kpis?.revenueChange || 0) >= 0 ? "#22c55e" : "#ef4444" }}>
              {(kpis?.revenueChange || 0) >= 0 ? "↑" : "↓"} {formatPercent(Math.abs(kpis?.revenueChange || 0))} vs same period last month
            </p>
          ) : kpis?.revenueLastMonth === 0 ? (
            <p className="text-[10px] mt-1" style={{ color: "var(--lux-text-muted)" }}>— no data for same period last month</p>
          ) : null}
        </div>
        <div className="lux-kpi-card rounded-xl p-4 cursor-pointer hover:shadow-md transition-shadow" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }} onClick={() => setDrillDown({ title: "Collected Payments", type: "collected" })} data-testid="kpi-collected" role="region" aria-label={`Collected MTD: ${kpiMoney(kpis?.collectedThisMonth || 0)}`}>
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Collected (MTD)</p>
          <p className="text-xl font-bold mt-1" style={{ color: "#3b82f6" }}>{kpiMoney(kpis?.collectedThisMonth || 0)}</p>
        </div>
        <div className="lux-kpi-card rounded-xl p-4 cursor-pointer hover:shadow-md transition-shadow" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }} onClick={() => setDrillDown({ title: "Outstanding Invoices", type: "outstanding" })} data-testid="kpi-outstanding" role="region" aria-label={`Outstanding: ${kpiMoney(kpis?.totalOutstanding || 0)}`}>
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Outstanding</p>
          <p className="text-xl font-bold mt-1" style={{ color: "#f59e0b" }}>{kpiMoney(kpis?.totalOutstanding || 0)}</p>
        </div>
        <div className="lux-kpi-card rounded-xl p-4 cursor-pointer hover:shadow-md transition-shadow" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }} onClick={() => setDrillDown({ title: "Overdue Invoices", type: "overdue" })} data-testid="kpi-overdue" role="region" aria-label={`Overdue: ${kpiMoney(kpis?.overdueAmount || 0)}`}>
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Overdue</p>
          <p className="text-xl font-bold mt-1" style={{ color: "#ef4444" }}>{kpiMoney(kpis?.overdueAmount || 0)}</p>
          {(kpis?.overdueCount || 0) > 0 && (
            <p className="text-[10px] mt-1" style={{ color: "#ef4444" }}>{kpis?.overdueCount} invoice{kpis?.overdueCount !== 1 ? "s" : ""}</p>
          )}
        </div>
        <div className="lux-kpi-card rounded-xl p-4" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }} data-testid="kpi-net-cash" role="region" aria-label={`Net Cash MTD: ${kpiMoney(kpis?.netCashThisMonth || 0)}`}>
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Net Cash (MTD)</p>
          <p className="text-xl font-bold mt-1" style={{ color: (kpis?.netCashThisMonth || 0) >= 0 ? "#22c55e" : "#ef4444" }}>{kpiMoney(kpis?.netCashThisMonth || 0)}</p>
          <p className="text-[10px] mt-1" style={{ color: "var(--lux-text-muted)" }}>In − Out</p>
        </div>
        <div className="lux-kpi-card rounded-xl p-4" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }} data-testid="kpi-team" role="region" aria-label={`Team: ${kpis?.teamActive || 0} active`}>
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Team</p>
          <p className="text-xl font-bold mt-1" style={{ color: "var(--lux-text)" }}>{kpis?.teamActive || 0}</p>
          <p className="text-[10px] mt-1" style={{ color: "var(--lux-text-muted)" }}>{kpis?.teamIndependents || 0} independents · {kpis?.teamEmployees || 0} W-2</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }} data-testid="chart-revenue-trend">
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--lux-text)" }}>Revenue Trend</h3>
            {revenueData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={revenueData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--lux-border)" />
                  <XAxis dataKey="month" tick={{ fill: "var(--lux-text-muted)", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: "var(--lux-text-muted)", fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => formatMoney(v, baseCurrency)} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="invoiced" stroke="#cf3339" strokeWidth={2} dot={false} name="Invoiced" />
                  <Line type="monotone" dataKey="collected" stroke="#3b82f6" strokeWidth={2} dot={false} name="Collected" />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState icon={TrendingUp} title="No revenue data yet" description="Send your first invoice to see trends here." />
            )}
          </CardContent>
        </Card>

        <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }} data-testid="chart-cash-flow">
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--lux-text)" }}>Cash Flow</h3>
            {cashFlowData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={cashFlowData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--lux-border)" />
                  <XAxis dataKey="month" tick={{ fill: "var(--lux-text-muted)", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: "var(--lux-text-muted)", fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => formatMoney(v, baseCurrency)} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="cashIn" stroke="#22c55e" fill="#22c55e" fillOpacity={0.15} strokeWidth={2} name="Cash In" />
                  <Area type="monotone" dataKey="cashOut" stroke="#ef4444" fill="#ef4444" fillOpacity={0.15} strokeWidth={2} name="Cash Out" />
                  <Line type="monotone" dataKey="runningNet" stroke="#3b82f6" strokeWidth={2} dot={false} name="Running Net" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState icon={DollarSign} title="No cash flow data yet" description="Record your first payment or payout to see cash flow trends here." />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }} data-testid="chart-client-revenue">
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--lux-text)" }}>Revenue by Client</h3>
            {clientPieData.length > 0 ? (
              <div className="flex items-center gap-4">
                <ResponsiveContainer width="50%" height={220}>
                  <PieChart>
                    <Pie data={clientPieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value" label={false}>
                      {clientPieData.map((_: any, i: number) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => formatMoney(value, baseCurrency)} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-2">
                  {clientPieData.map((c: any, i: number) => (
                    <div key={i} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                        <span className="text-xs truncate max-w-[120px]" style={{ color: "var(--lux-text)" }}>{c.name}</span>
                      </div>
                      <span className="text-xs tabular-nums" style={{ color: "var(--lux-text-muted)" }}>{formatMoney(c.value, baseCurrency)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <EmptyState icon={Users} title="No client data" description="Client revenue will appear once invoices are sent." />
            )}
          </CardContent>
        </Card>

        <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }} data-testid="chart-ar-aging">
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--lux-text)" }}>Accounts Receivable Aging</h3>
            {arData.length > 0 ? (
              <div className="flex items-center gap-4">
                <ResponsiveContainer width="50%" height={220}>
                  <PieChart>
                    <Pie data={arData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value" label={false}>
                      {arData.map((d: any, i: number) => (
                        <Cell key={i} fill={d.fill} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => formatMoney(value, baseCurrency)} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-2">
                  {arData.map((d: any, i: number) => (
                    <div key={i} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: d.fill }} />
                        <span className="text-xs" style={{ color: "var(--lux-text)" }}>{d.name}</span>
                      </div>
                      <span className="text-xs tabular-nums" style={{ color: "var(--lux-text-muted)" }}>{formatMoney(d.value, baseCurrency)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <EmptyState icon={DollarSign} title="No outstanding receivables" description="AR aging will appear once invoices are sent." />
            )}
          </CardContent>
        </Card>
      </div>

      {isAdmin && <EmailFailureAlertsCard />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }} data-testid="chart-utilization">
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--lux-text)" }}>Team Utilization</h3>
            {stats?.teamMemberUtilization && stats.teamMemberUtilization.length > 0 ? (
              <div className="space-y-3">
                {stats.teamMemberUtilization.map((c, idx) => (
                  <div key={idx}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <AvatarInitials name={c.name} size="xs" />
                        <span className="text-xs font-medium" style={{ color: "var(--lux-text)" }}>{c.name}</span>
                      </div>
                      <span className="text-xs tabular-nums" style={{ color: c.utilization >= 70 ? "#22c55e" : c.utilization >= 40 ? "#f59e0b" : "#ef4444" }}>
                        {formatHours(c.billableHours)}h / {formatHours(c.totalHours)}h ({formatPercent(c.utilization)})
                      </span>
                    </div>
                    <Progress value={Math.min(c.utilization, 100)} className="h-2" />
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={Users} title="No utilization data" description="Utilization will appear once team members log time." />
            )}
          </CardContent>
        </Card>

        <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }} data-testid="card-pending-actions">
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--lux-text)" }}>Needs Attention</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-lg cursor-pointer hover:shadow-sm transition-shadow" style={{ background: "var(--lux-surface-alt)" }} onClick={() => navigate("/approvals")}>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "rgba(59,130,246,0.1)" }}>
                    <ClipboardList className="w-4 h-4" style={{ color: "#3b82f6" }} />
                  </div>
                  <div>
                    <p className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>Pending Timesheets</p>
                    <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>Awaiting your review</p>
                  </div>
                </div>
                <span className="text-lg font-bold" style={{ color: (kpis?.pendingTimesheets || 0) > 0 ? "#3b82f6" : "var(--lux-text-muted)" }}>{kpis?.pendingTimesheets || 0}</span>
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg cursor-pointer hover:shadow-sm transition-shadow" style={{ background: "var(--lux-surface-alt)" }} onClick={() => navigate("/payouts")}>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "rgba(249,115,22,0.1)" }}>
                    <Wallet className="w-4 h-4" style={{ color: "#f97316" }} />
                  </div>
                  <div>
                    <p className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>Pending Payouts</p>
                    <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>{formatMoney(kpis?.pendingPayoutsAmount || 0, baseCurrency)} to pay</p>
                  </div>
                </div>
                <span className="text-lg font-bold" style={{ color: (kpis?.pendingPayoutsCount || 0) > 0 ? "#f97316" : "var(--lux-text-muted)" }}>{kpis?.pendingPayoutsCount || 0}</span>
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg cursor-pointer hover:shadow-sm transition-shadow" style={{ background: "var(--lux-surface-alt)" }} onClick={() => setDrillDown({ title: "Overdue Invoices", type: "overdue" })}>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "rgba(239,68,68,0.1)" }}>
                    <AlertCircle className="w-4 h-4" style={{ color: "#ef4444" }} />
                  </div>
                  <div>
                    <p className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>Overdue Invoices</p>
                    <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>{formatMoney(kpis?.overdueAmount || 0, baseCurrency)} past due</p>
                  </div>
                </div>
                <span className="text-lg font-bold" style={{ color: (kpis?.overdueCount || 0) > 0 ? "#ef4444" : "var(--lux-text-muted)" }}>{kpis?.overdueCount || 0}</span>
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg cursor-pointer hover:shadow-sm transition-shadow" style={{ background: "var(--lux-surface-alt)" }} onClick={() => setDrillDown({ title: "Unbilled Time", type: "unbilled" })}>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "rgba(234,179,8,0.1)" }}>
                    <Clock className="w-4 h-4" style={{ color: "#eab308" }} />
                  </div>
                  <div>
                    <p className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>Unbilled Hours</p>
                    <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>{formatMoney(kpis?.unbilledValue || 0, baseCurrency)} in unbilled work</p>
                  </div>
                </div>
                <span className="text-lg font-bold" style={{ color: (kpis?.unbilledHours || 0) > 0 ? "#eab308" : "var(--lux-text-muted)" }}>{formatHours(kpis?.unbilledHours || 0)}h</span>
              </div>

              {glReconcile && Number(glReconcile.diff) !== 0 && (
                <div className="flex items-center justify-between p-3 rounded-lg cursor-pointer hover:shadow-sm transition-shadow" style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.2)" }} onClick={() => navigate("/gl")} data-testid="warning-gl-reconcile">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "rgba(239,68,68,0.1)" }}>
                      <AlertTriangle className="w-4 h-4" style={{ color: "#ef4444" }} />
                    </div>
                    <div>
                      <p className="text-sm font-medium" style={{ color: "#ef4444" }}>GL Reconciliation Mismatch</p>
                      <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>AR sub-ledger: {glReconcile.ar_subledger_total} vs GL 1200: {glReconcile.gl_1200_balance} (diff: {glReconcile.diff})</p>
                    </div>
                  </div>
                </div>
              )}

              {bankingStats && bankingStats.connectedAccounts > 0 && (
                <div className="flex items-center justify-between p-3 rounded-lg cursor-pointer hover:shadow-sm transition-shadow" style={{ background: "var(--lux-surface-alt)" }} onClick={() => navigate("/banking")}>
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "rgba(139,92,246,0.1)" }}>
                      <Building2 className="w-4 h-4" style={{ color: "#8b5cf6" }} />
                    </div>
                    <div>
                      <p className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>Unreconciled Transactions</p>
                      <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>{bankingStats.connectedAccounts} account{bankingStats.connectedAccounts !== 1 ? "s" : ""} linked</p>
                    </div>
                  </div>
                  <span className="text-lg font-bold" style={{ color: bankingStats.unreconciled > 0 ? "#8b5cf6" : "var(--lux-text-muted)" }}>{bankingStats.unreconciled}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }} data-testid="card-activity-feed">
        <CardContent className="p-5">
          <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--lux-text)" }}>Recent Activity</h3>
          {activity && activity.length > 0 ? (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {activity.slice(0, 15).map((item) => {
                const config = ACTIVITY_CONFIG[item.action] || DEFAULT_ACTIVITY_CONFIG;
                const details = safeParseJson(item.details);
                const { title, subtitle } = config === DEFAULT_ACTIVITY_CONFIG
                  ? DEFAULT_ACTIVITY_CONFIG.format(details, item.userName, item.action)
                  : config.format(details, item.userName);
                const Icon = config.Icon;
                return (
                  <div key={item.id} className="flex items-start gap-3 py-2 border-b" style={{ borderColor: "var(--lux-border)" }}>
                    <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: `${config.color}15` }}>
                      <Icon className="w-3.5 h-3.5" style={{ color: config.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium" style={{ color: "var(--lux-text)" }}>{title}</p>
                      <p className="text-[10px]" style={{ color: "var(--lux-text-muted)" }}>{subtitle}</p>
                    </div>
                    <DateDisplay value={item.createdAt} relative />
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState icon={Activity} title="No activity yet" description="Actions like sending invoices and approving timesheets will appear here." />
          )}
        </CardContent>
      </Card>

      {user?.role === "ADMIN" && <MarketingOsTelemetryCard />}

      <Dialog open={!!drillDown} onOpenChange={(open) => !open && setDrillDown(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto p-0" style={{ background: "var(--lux-surface)" }} data-testid="dialog-drilldown">
          <DialogHeader className="px-6 pt-6 pb-3">
            <DialogTitle style={{ color: "var(--lux-text)" }} data-testid="text-drilldown-title">{drillDown?.title}</DialogTitle>
          </DialogHeader>
          <div className="px-6 pb-6">
            {drillDown?.type === "revenue" && <RevenueDetail invoices={stats?.recentInvoices} navigate={navigate} currency={baseCurrency} />}
            {drillDown?.type === "collected" && <CollectedDetail payments={stats?.recentPayments} navigate={navigate} currency={baseCurrency} />}
            {drillDown?.type === "outstanding" && <OutstandingDetail invoices={stats?.recentInvoices} navigate={navigate} currency={baseCurrency} />}
            {drillDown?.type === "overdue" && <OverdueDetail invoices={stats?.overdueInvoices} navigate={navigate} currency={baseCurrency} />}
            {drillDown?.type === "unbilled" && <UnbilledDetail stats={stats} navigate={navigate} currency={baseCurrency} />}
            {drillDown?.type === "projects" && <ProjectsDetail stats={stats} navigate={navigate} />}
            {drillDown?.type === "pending" && <PendingDetail invoices={stats?.recentInvoices} navigate={navigate} currency={baseCurrency} />}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function DashboardPage() {
  useDocumentTitle("Dashboard");
  const { user } = useAuth();
  if (user?.role === "TEAM_MEMBER") return <TeamMemberDashboard />;
  return <AdminDashboard />;
}
