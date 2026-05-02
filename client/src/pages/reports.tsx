import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { PageHelpLink } from "@/components/page-help-link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line, AreaChart, Area,
} from "recharts";
import {
  Download, TrendingUp, Clock, DollarSign, FileText, Users, BarChart3,
  AlertTriangle, Briefcase, UserCheck, ShieldCheck, Wallet, Receipt,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { formatMoney, formatHoursMinutes, formatPercent, formatHours, formatRate, getCurrencySymbol, formatDate } from "@/components/shared/format";
import { useBaseCurrency } from "@/hooks/use-base-currency";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { MoneyDisplay } from "@/components/shared/money-display";
import { useDocumentTitle } from "@/lib/use-document-title";
import { ActiveFilterBar, type FilterChipDescriptor } from "@/components/active-filter-chip";

const REPORT_REGISTRY: Record<string, string[]> = {
  financial: ["Revenue by Month", "Cash Flow", "Client Revenue Ranking", "Collections Efficiency"],
  receivables: ["AR Aging", "Overdue Detail", "Unbilled Time"],
  operations: ["Project Profitability", "Budget Burn", "WIP Aging"],
  team: ["Utilization", "Team Member Hours", "Timesheet Compliance", "Labor Summary"],
  payouts: ["Payout Detail", "1099 Export"],
  expenses: ["By Category", "By Project", "By Team Member"],
};
const REPORT_COUNT = Object.values(REPORT_REGISTRY).reduce((s, arr) => s + arr.length, 0);

const CHART_COLORS = ["#cf3339", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#6b7280"];
const AGING_BUCKETS = ["0-30", "31-60", "61-90", "90+"];

const WORKER_TYPE_LABELS: Record<string, string> = {
  "INDEPENDENT": "1099 Independent",
  "W2_EMPLOYEE": "W-2 Employee",
  "CORP_TO_CORP": "Corp-to-Corp",
};

function SectionCard({ children, title, actions }: { children: React.ReactNode; title: string; actions?: React.ReactNode }) {
  return (
    <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>{title}</h3>
          {actions}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function isValidReportUrl(url: string): boolean {
  try {
    if (url.startsWith("/api/")) return true;
    const parsed = new URL(url, window.location.origin);
    return parsed.origin === window.location.origin;
  } catch {
    return false;
  }
}

function capChartData<T>(data: T[] | undefined, maxPoints: number = 1000): T[] {
  if (!data) return [];
  if (data.length <= maxPoints) return data;
  return data.slice(0, maxPoints);
}

function CsvButton({ url, testId }: { url: string; testId: string }) {
  return (
    <Button size="sm" variant="outline" data-testid={testId} onClick={() => {
      if (isValidReportUrl(url)) window.open(url, "_blank");
    }}>
      <Download className="w-3.5 h-3.5 mr-1.5" /> Export CSV
    </Button>
  );
}

function ReportTable({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--lux-border)" }}>
      <table className="w-full text-sm">
        <thead>
          <tr style={{ background: "var(--lux-table-header-bg)" }}>
            {headers.map((h, i) => (
              <th key={i} className={`${i === 0 ? "text-left" : "text-right"} px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider`} style={{ color: "var(--lux-text-muted)" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Td({ children, align, bold, color }: { children: React.ReactNode; align?: "left" | "right"; bold?: boolean; color?: string }) {
  return (
    <td className={`px-4 py-2.5 ${align === "right" ? "text-right" : "text-left"} ${bold ? "font-medium" : ""} tabular-nums`} style={{ color: color || "var(--lux-text)", borderTop: "1px solid var(--lux-border)" }}>
      {children}
    </td>
  );
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg px-3 py-2 text-xs shadow-lg" style={{ background: "var(--lux-surface)", border: "1px solid var(--lux-border)" }}>
      <p className="font-semibold mb-1" style={{ color: "var(--lux-text)" }}>{label}</p>
      {payload.map((entry: any, i: number) => (
        <p key={i} style={{ color: entry.color }}>{entry.name}: {formatMoney(entry.value)}</p>
      ))}
    </div>
  );
}

export default function ReportsPage() {
  useDocumentTitle("Reports");
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const canSeeCosts = user?.role === "ADMIN" || user?.role === "MANAGER";
  const today = new Date().toISOString().split("T")[0];
  const yearStart = today.slice(0, 4) + "-01-01";
  const [category, setCategory] = useState("financial");
  const [profitStart, setProfitStart] = useState(yearStart);
  const [profitEnd, setProfitEnd] = useState(today);
  const [wipIncludeUnapproved, setWipIncludeUnapproved] = useState(false);
  const [exportStart, setExportStart] = useState(yearStart);
  const [exportEnd, setExportEnd] = useState(today);
  const [payoutStart, setPayoutStart] = useState(yearStart);
  const [payoutEnd, setPayoutEnd] = useState(today);

  const baseCurrency = useBaseCurrency();
  const q0 = useQuery<any>({ queryKey: ["/api/reports"], placeholderData: keepPreviousData });
  const report = q0.data;
  const q1 = useQuery<any[]>({ queryKey: ["/api/reports/utilization"], placeholderData: keepPreviousData });
  const utilization = q1.data;
  const q2 = useQuery<any>({
    queryKey: ["/api/reports/profitability", profitStart, profitEnd],
    queryFn: async () => { const res = await apiRequest("GET", `/api/reports/profitability?startDate=${profitStart}&endDate=${profitEnd}`); return res.json(); },
    placeholderData: keepPreviousData,
  });
  const profitabilityData = q2.data;
  const profitability = profitabilityData?.rows as any[] | undefined;
  const unapprovedHours = profitabilityData?.unapprovedHours || 0;
  const projectsWithUnapproved = profitabilityData?.projectsWithUnapproved || 0;
  const q3 = useQuery<any>({
    queryKey: ["/api/reports/wip-aging", wipIncludeUnapproved],
    queryFn: async () => { const res = await apiRequest("GET", `/api/reports/wip-aging?includeUnapproved=${wipIncludeUnapproved}`); return res.json(); },
    placeholderData: keepPreviousData,
  });
  const wipAging = q3.data;
  const q4 = useQuery<any[]>({ queryKey: ["/api/reports/client-revenue"], placeholderData: keepPreviousData });
  const clientRevenue = q4.data;
  const q5 = useQuery<any[]>({ queryKey: ["/api/reports/cash-flow"], placeholderData: keepPreviousData });
  const cashFlow = q5.data;
  const q6 = useQuery<any>({ queryKey: ["/api/reports/collections-efficiency"], placeholderData: keepPreviousData });
  const collections = q6.data;
  const q7 = useQuery<any[]>({ queryKey: ["/api/reports/budget-burn"], placeholderData: keepPreviousData });
  const budgetBurn = q7.data;
  const q8 = useQuery<any[]>({ queryKey: ["/api/reports/overdue-detail"], placeholderData: keepPreviousData });
  const overdueDetail = q8.data;
  const q9 = useQuery<any>({ queryKey: ["/api/reports/timesheet-compliance"], placeholderData: keepPreviousData });
  const compliance = q9.data;
  const q10 = useQuery<any[]>({ queryKey: ["/api/reports/labor-summary"], placeholderData: keepPreviousData });
  const laborSummary = q10.data;
  const q11 = useQuery<any>({
    queryKey: ["/api/reports/payout-detail", payoutStart, payoutEnd],
    queryFn: async () => { const res = await apiRequest("GET", `/api/reports/payout-detail?startDate=${payoutStart}&endDate=${payoutEnd}`); return res.json(); },
    placeholderData: keepPreviousData,
  });
  const payoutDetail = q11.data;
  const q12 = useQuery<any[]>({ queryKey: ["/api/reports/expenses-by-category"], placeholderData: keepPreviousData });
  const expensesByCategory = q12.data;
  const q13 = useQuery<any[]>({ queryKey: ["/api/reports/expenses-by-project"], placeholderData: keepPreviousData });
  const expensesByProject = q13.data;
  const q14 = useQuery<any[]>({ queryKey: ["/api/reports/expenses-by-user"], placeholderData: keepPreviousData });
  const expensesByUser = q14.data;

  const buildDateRangeChips = (
  id: string,
  start: string,
  end: string,
  reset: () => void,
): FilterChipDescriptor[] => {
    if (start === yearStart && end === today) return [];
    return [{
      id: `${id}-date-range`,
      label: `${formatDate(start)} – ${formatDate(end)}`,
      onClear: reset,
    }];
  };
  const profitChips = buildDateRangeChips("profitability", profitStart, profitEnd, () => {
    setProfitStart(yearStart);
    setProfitEnd(today);
  });
  const payoutChips = buildDateRangeChips("payouts", payoutStart, payoutEnd, () => {
    setPayoutStart(yearStart);
    setPayoutEnd(today);
  });
  const exportChips = buildDateRangeChips("export-1099", exportStart, exportEnd, () => {
    setExportStart(yearStart);
    setExportEnd(today);
  });

  const allQueries = [q0, q1, q2, q3, q4, q5, q6, q7, q8, q9, q10, q11, q12, q13, q14];
  const anyFetching = allQueries.some(q => q.isFetching);
  const initialLoading = report === undefined && q0.isLoading;

  if (initialLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-10 w-60 rounded-lg" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    );
  }

  const categories = [
    { id: "financial", label: "Financial", icon: DollarSign },
    { id: "receivables", label: "Receivables", icon: FileText },
    { id: "operations", label: "Operations", icon: Briefcase },
    { id: "team", label: "Team", icon: Users },
    ...(isAdmin ? [{ id: "payouts", label: "Payouts & Tax", icon: Wallet }] : []),
    { id: "expenses", label: "Expenses", icon: Receipt },
  ];

  return (
    <div className="px-6 lg:px-8 xl:px-10 py-6 space-y-6">
      {anyFetching && (
        <div className="fixed top-0 left-0 right-0 z-50 h-1 overflow-hidden" data-testid="refetch-progress-bar">
          <div className="h-full w-1/3 rounded-r animate-pulse" style={{ background: "var(--color-accent)", animation: "reports-slide 1.2s ease-in-out infinite" }} />
          <style>{`@keyframes reports-slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(400%); } }`}</style>
        </div>
      )}
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--lux-text)" }} data-testid="text-reports-title">Reports</h1>
          <PageHelpLink />
        </div>
        <p className="text-sm mt-1" style={{ color: "var(--lux-text-muted)" }}>{REPORT_COUNT} reports across financial, receivables, operations, team, tax, and expense categories</p>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {categories.map(cat => {
          const Icon = cat.icon;
          const active = category === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${active ? "shadow-sm" : ""}`}
              style={{
                background: active ? "var(--lux-surface)" : "transparent",
                color: active ? "var(--color-accent)" : "var(--lux-text-muted)",
                border: active ? "1px solid var(--color-accent)" : "1px solid transparent",
              }}
              data-testid={`category-${cat.id}`}
            >
              <Icon className="w-4 h-4" />
              {cat.label}
            </button>
          );
        })}
      </div>

      {category === "financial" && (
        <Tabs defaultValue="revenue" className="space-y-4">
          <TabsList>
            <TabsTrigger value="revenue">Revenue</TabsTrigger>
            <TabsTrigger value="cashflow">Cash Flow</TabsTrigger>
            <TabsTrigger value="client-revenue">Client Revenue</TabsTrigger>
            <TabsTrigger value="collections">Collections</TabsTrigger>
          </TabsList>

          <TabsContent value="revenue">
            <SectionCard title="Revenue by Month (Invoiced vs Paid)" actions={<CsvButton url="/api/reports/revenue/csv" testId="btn-csv-revenue" />}>
              {!report?.revenueByMonth?.length ? (
                <EmptyState icon={BarChart3} title="No revenue data" description="Revenue data will appear once invoices are created." />
              ) : (() => {
                const revenueData = capChartData(report.revenueByMonth);
                const revenueMax = Math.max(
                  ...revenueData.map((d: any) => Math.max(Number(d.invoiced) || 0, Number(d.paid) || 0))
                );
                const yAxisMax = Math.max(500, Math.ceil(revenueMax * 1.15 / 500) * 500);
                return (
                <ResponsiveContainer width="100%" height={350}>
                  <BarChart data={revenueData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--lux-border)" />
                    <XAxis dataKey="month" tick={{ fill: "var(--lux-text-muted)", fontSize: 11 }} tickLine={false} />
                    <YAxis domain={[0, yAxisMax]} allowDataOverflow={false} tickCount={6} tick={{ fill: "var(--lux-text-muted)", fontSize: 11 }} tickFormatter={(v) => formatMoney(v, baseCurrency)} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="invoiced" name="Invoiced" fill="#cf3339" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="paid" name="Paid" fill="#22c55e" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                );
              })()}
            </SectionCard>
          </TabsContent>

          <TabsContent value="cashflow">
            <SectionCard title="Cash Flow (Payments In vs Payouts Out)">
              {!cashFlow?.length ? (
                <EmptyState icon={DollarSign} title="No cash flow data" description="Cash flow will appear once payments and payouts are recorded." />
              ) : (
                <ResponsiveContainer width="100%" height={350}>
                  <AreaChart data={cashFlow}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--lux-border)" />
                    <XAxis dataKey="month" tick={{ fill: "var(--lux-text-muted)", fontSize: 11 }} tickLine={false} />
                    <YAxis tick={{ fill: "var(--lux-text-muted)", fontSize: 11 }} tickFormatter={(v) => formatMoney(v, baseCurrency)} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Area type="monotone" dataKey="cashIn" stroke="#22c55e" fill="#22c55e" fillOpacity={0.15} name="Cash In" />
                    <Area type="monotone" dataKey="cashOut" stroke="#ef4444" fill="#ef4444" fillOpacity={0.15} name="Cash Out" />
                    <Line type="monotone" dataKey="runningNet" stroke="#3b82f6" strokeWidth={2} dot={false} name="Running Net" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </SectionCard>
          </TabsContent>

          <TabsContent value="client-revenue">
            <SectionCard title="Client Revenue Ranking">
              {!clientRevenue?.length ? (
                <EmptyState icon={Users} title="No client data" description="Client revenue will appear once invoices are sent." />
              ) : (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <ResponsiveContainer width="100%" height={280}>
                      <PieChart>
                        <Pie data={clientRevenue.slice(0, 6).map(c => ({ name: c.clientName, value: c.totalInvoiced }))} cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={3} dataKey="value" label={false}>
                          {clientRevenue.slice(0, 6).map((_, i) => (<Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />))}
                        </Pie>
                        <Tooltip formatter={(value: number) => formatMoney(value, baseCurrency)} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="space-y-2">
                      {clientRevenue.slice(0, 6).map((c: any, i: number) => (
                        <div key={i} className="flex items-center justify-between p-2 rounded" style={{ background: "var(--lux-surface-alt)" }}>
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                            <span className="text-sm" style={{ color: "var(--lux-text)" }}>{c.clientName}</span>
                          </div>
                          <div className="text-right">
                            <span className="text-sm tabular-nums font-medium" style={{ color: "var(--lux-text)" }}>{formatMoney(c.totalInvoiced, baseCurrency)}</span>
                            <span className="text-xs ml-2" style={{ color: "var(--lux-text-muted)" }}>{formatPercent(c.revenuePercent)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <ReportTable headers={["Client", "Invoices", "Invoiced", "Paid", "Outstanding", "% of Revenue"]}>
                    {clientRevenue.map((c: any, i: number) => (
                      <tr key={i}>
                        <Td bold>{c.clientName}</Td>
                        <Td align="right">{c.invoiceCount}</Td>
                        <Td align="right">{formatMoney(c.totalInvoiced, baseCurrency)}</Td>
                        <Td align="right" color="#22c55e">{formatMoney(c.totalPaid, baseCurrency)}</Td>
                        <Td align="right" color={c.totalOutstanding > 0 ? "#f59e0b" : undefined}>{formatMoney(c.totalOutstanding, baseCurrency)}</Td>
                        <Td align="right">{formatPercent(c.revenuePercent)}</Td>
                      </tr>
                    ))}
                  </ReportTable>
                </div>
              )}
            </SectionCard>
          </TabsContent>

          <TabsContent value="collections">
            <SectionCard title="Collections Efficiency">
              {!collections?.invoiceCount ? (
                <EmptyState icon={Clock} title="No collection data" description="Collection efficiency will appear once invoices are paid." />
              ) : (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="rounded-xl p-5" style={{ background: "var(--lux-surface-alt)" }}>
                      <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Avg Days to Collect</p>
                      <p className="text-3xl font-bold mt-2" style={{ color: collections.overallAvgDays <= 30 ? "#22c55e" : collections.overallAvgDays <= 60 ? "#f59e0b" : "#ef4444" }}>{collections.overallAvgDays} days</p>
                      <p className="text-xs mt-1" style={{ color: "var(--lux-text-muted)" }}>Across {collections.invoiceCount} paid invoices</p>
                    </div>
                  </div>
                  <ReportTable headers={["Client", "Avg Days", "Invoices Paid"]}>
                    {collections.byClient.map((c: any, i: number) => (
                      <tr key={i}>
                        <Td bold>{c.clientName}</Td>
                        <Td align="right" color={c.avgDaysToCollect <= 30 ? "#22c55e" : c.avgDaysToCollect <= 60 ? "#f59e0b" : "#ef4444"}>{c.avgDaysToCollect} days</Td>
                        <Td align="right">{c.invoiceCount}</Td>
                      </tr>
                    ))}
                  </ReportTable>
                </div>
              )}
            </SectionCard>
          </TabsContent>
        </Tabs>
      )}

      {category === "receivables" && (
        <Tabs defaultValue="aging" className="space-y-4">
          <TabsList>
            <TabsTrigger value="aging">AR Aging</TabsTrigger>
            <TabsTrigger value="overdue">Overdue Detail</TabsTrigger>
            <TabsTrigger value="unbilled">Unbilled Time</TabsTrigger>
          </TabsList>

          <TabsContent value="aging">
            <SectionCard title="Accounts Receivable Aging" actions={
              <div className="flex gap-2">
                <CsvButton url="/api/reports/ar-aging/csv" testId="btn-csv-ar" />
                <Button size="sm" variant="outline" data-testid="btn-pdf-ar" onClick={() => {
                  if (isValidReportUrl("/api/reports/ar-aging/pdf")) window.open("/api/reports/ar-aging/pdf", "_blank");
                }}>
                  <Download className="w-3.5 h-3.5 mr-1.5" /> Export PDF
                </Button>
              </div>
            }>
              {!report?.arAging?.length ? (
                <EmptyState icon={DollarSign} title="No outstanding invoices" description="All invoices have been paid." />
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie data={report.arAging.filter((a: any) => a.amount > 0)} cx="50%" cy="50%" innerRadius={50} outerRadius={90} dataKey="amount" nameKey="bucket">
                        {report.arAging.map((_: any, i: number) => (<Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />))}
                      </Pie>
                      <Tooltip formatter={(value: number) => formatMoney(value, baseCurrency)} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-3">
                    {report.arAging.map((bucket: any, i: number) => (
                      <div key={i} className="flex items-center justify-between p-3 rounded-lg" style={{ background: "var(--lux-surface-alt)" }}>
                        <div className="flex items-center gap-3">
                          <div className="w-3 h-3 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                          <div>
                            <p className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>{bucket.bucket}</p>
                            <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>{bucket.count} invoice{bucket.count !== 1 ? "s" : ""}</p>
                          </div>
                        </div>
                        <span className="text-sm font-bold tabular-nums" style={{ color: "var(--lux-text)" }}>{formatMoney(bucket.amount, baseCurrency)}</span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between p-3 rounded-lg mt-1" style={{ background: "var(--lux-surface)", borderTop: "2px solid var(--lux-border)" }} data-testid="text-ar-aging-total">
                      <span className="text-sm font-bold" style={{ color: "var(--lux-text)" }}>Total Outstanding</span>
                      <span className="text-sm font-bold tabular-nums" style={{ color: "var(--lux-text)" }}>
                        {formatMoney(report.arAging.reduce((s: number, b: any) => s + (Number(b.amount) || 0), 0), baseCurrency)}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </SectionCard>
          </TabsContent>

          <TabsContent value="overdue">
            <SectionCard title="Overdue Invoice Detail">
              {!overdueDetail?.length ? (
                <EmptyState icon={AlertTriangle} title="No overdue invoices" description="All invoices are current." />
              ) : (
                <div className="space-y-4">
                  <div className="rounded-xl p-4" style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.15)" }}>
                    <p className="text-sm font-medium" style={{ color: "#ef4444" }}>
                      {overdueDetail.length} overdue invoice{overdueDetail.length !== 1 ? "s" : ""} totaling {formatMoney(overdueDetail.reduce((s: number, i: any) => s + i.outstanding, 0), baseCurrency)}
                    </p>
                  </div>
                  <ReportTable headers={["Invoice", "Client", "Total", "Paid", "Outstanding", "Days Overdue"]}>
                    {overdueDetail.map((inv: any) => (
                      <tr key={inv.id}>
                        <Td bold>{inv.number}</Td>
                        <Td>{inv.clientName}</Td>
                        <Td align="right">{formatMoney(inv.total, baseCurrency)}</Td>
                        <Td align="right">{formatMoney(inv.paidAmount, baseCurrency)}</Td>
                        <Td align="right" color="#ef4444" bold>{formatMoney(inv.outstanding, baseCurrency)}</Td>
                        <Td align="right" color={inv.daysOverdue > 60 ? "#ef4444" : inv.daysOverdue > 30 ? "#f59e0b" : "var(--lux-text)"}>{inv.daysOverdue}d</Td>
                      </tr>
                    ))}
                  </ReportTable>
                </div>
              )}
            </SectionCard>
          </TabsContent>

          <TabsContent value="unbilled">
            <SectionCard title="Unbilled Time by Project">
              {!report?.unbilledTime?.length ? (
                <EmptyState icon={Clock} title="No unbilled time" description="All time entries have been billed." />
              ) : (
                <ReportTable headers={["Project", "Client", "Hours", "Amount"]}>
                  {report.unbilledTime.map((item: any, i: number) => (
                    <tr key={i}>
                      <Td bold>{item.projectName}</Td>
                      <Td>{item.clientName}</Td>
                      <Td align="right">{formatHoursMinutes(item.totalMinutes)}</Td>
                      <Td align="right" color="var(--color-accent)" bold>{formatMoney(item.totalAmount, baseCurrency)}</Td>
                    </tr>
                  ))}
                </ReportTable>
              )}
            </SectionCard>
          </TabsContent>
        </Tabs>
      )}

      {category === "operations" && (
        <Tabs defaultValue={canSeeCosts ? "profitability" : "budget"} className="space-y-4">
          <TabsList>
            {canSeeCosts && <TabsTrigger value="profitability">Profitability</TabsTrigger>}
            <TabsTrigger value="budget">Budget Burn</TabsTrigger>
            <TabsTrigger value="wip">WIP Aging</TabsTrigger>
          </TabsList>

          {canSeeCosts && <TabsContent value="profitability" className="space-y-3">
            <ActiveFilterBar chips={profitChips} testId="filter-bar-profitability" />
            <SectionCard title="Project Profitability" actions={
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <Label className="text-xs" style={{ color: "var(--lux-text-muted)" }}>From</Label>
                  <Input type="date" value={profitStart} onChange={e => setProfitStart(e.target.value)} className="h-8 text-xs w-36" data-testid="input-profitability-start" />
                </div>
                <div className="flex items-center gap-1.5">
                  <Label className="text-xs" style={{ color: "var(--lux-text-muted)" }}>To</Label>
                  <Input type="date" value={profitEnd} onChange={e => setProfitEnd(e.target.value)} className="h-8 text-xs w-36" data-testid="input-profitability-end" />
                </div>
                <CsvButton url={`/api/reports/profitability/csv?startDate=${profitStart}&endDate=${profitEnd}`} testId="btn-csv-profit" />
              </div>
            }>
              {unapprovedHours > 0 && (
                <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg mb-4" style={{ background: "rgba(234,179,8,0.1)", border: "1px solid rgba(234,179,8,0.3)" }} data-testid="banner-unapproved-hours">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: "#eab308" }} />
                  <span className="text-sm" style={{ color: "#ca8a04" }}>
                    {unapprovedHours.toFixed(1)} hours across {projectsWithUnapproved} project{projectsWithUnapproved !== 1 ? "s" : ""} are not yet approved and excluded from this report.
                  </span>
                </div>
              )}
              {!profitability?.length ? (
                <EmptyState icon={TrendingUp} title="No project data" description="Profitability data will appear once projects have revenue and costs." />
              ) : (
                <ReportTable headers={["Project", "Client", "Revenue", "Cost", "Profit", "Margin"]}>
                  {profitability.map((row: any) => (
                    <tr key={row.projectId}>
                      <Td bold>{row.projectName}</Td>
                      <Td>{row.clientName}</Td>
                      <Td align="right"><MoneyDisplay currency={baseCurrency} value={row.revenue} /></Td>
                      <Td align="right"><MoneyDisplay currency={baseCurrency} value={row.cost} /></Td>
                      <Td align="right"><MoneyDisplay currency={baseCurrency} value={row.profit} color="auto" /></Td>
                      <Td align="right" color={row.margin >= 0 ? "#22c55e" : "#ef4444"} bold>{formatPercent(row.margin * 100)}</Td>
                    </tr>
                  ))}
                </ReportTable>
              )}
            </SectionCard>
          </TabsContent>}

          <TabsContent value="budget">
            <SectionCard title="Budget Burn by Project">
              {!budgetBurn?.length ? (
                <EmptyState icon={Briefcase} title="No project data" description="Budget burn will appear once projects have budgets set." />
              ) : (
                <div className="space-y-3">
                  {budgetBurn.map((p: any) => (
                    <div key={p.projectId} className="rounded-lg p-4" style={{ background: "var(--lux-surface-alt)" }}>
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <p className="text-sm font-semibold" style={{ color: "var(--lux-text)" }}>{p.projectName}</p>
                          <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>{p.clientName} · {p.status}</p>
                        </div>
                        <div className="text-right">
                          {p.budgetHours > 0 ? (
                            <>
                              <p className="text-sm font-bold tabular-nums" style={{ color: p.overBudget ? "#ef4444" : p.burnPercent > 80 ? "#f59e0b" : "#22c55e" }}>{formatPercent(p.burnPercent)}</p>
                              <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>{formatHours(p.totalHours)}h / {formatHours(p.budgetHours)}h</p>
                            </>
                          ) : (
                            <>
                              <p className="text-sm font-medium tabular-nums" style={{ color: "var(--lux-text)" }}>{formatHours(p.totalHours)}h</p>
                              <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>No budget set</p>
                            </>
                          )}
                        </div>
                      </div>
                      {p.budgetHours > 0 && <Progress value={Math.min(p.burnPercent, 100)} className="h-2" />}
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </TabsContent>

          <TabsContent value="wip">
            <SectionCard title="WIP / Unbilled Time Aging" actions={
              <div className="flex items-center gap-3">
                <Label htmlFor="wip-unapproved" className="text-xs" style={{ color: "var(--lux-text-muted)" }}>Include unapproved</Label>
                <Switch id="wip-unapproved" checked={wipIncludeUnapproved} onCheckedChange={setWipIncludeUnapproved} />
                <CsvButton url={`/api/reports/wip-aging/csv?includeUnapproved=${wipIncludeUnapproved}`} testId="btn-csv-wip" />
              </div>
            }>
              {!wipAging || wipAging.totalEntries === 0 ? (
                <EmptyState icon={Clock} title="No unbilled time entries" description="WIP aging data will appear once there are unbilled time entries." />
              ) : (
                <div className="space-y-6">
                  {[
                    { title: "By Team Member", data: wipAging.byTeamMember },
                    { title: "By Client", data: wipAging.byClient },
                    { title: "By Project", data: wipAging.byProject },
                  ].map(({ title, data }) => (
                    <div key={title}>
                      <h4 className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: "var(--lux-text-muted)" }}>{title}</h4>
                      <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--lux-border)" }}>
                        <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
                          <colgroup>
                            <col style={{ width: "auto" }} />
                            <col style={{ width: "120px" }} />
                            <col style={{ width: "120px" }} />
                            <col style={{ width: "120px" }} />
                            <col style={{ width: "120px" }} />
                            <col style={{ width: "120px" }} />
                          </colgroup>
                          <thead>
                            <tr style={{ background: "var(--lux-table-header-bg)" }}>
                              <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Name</th>
                              {AGING_BUCKETS.map(b => (
                                <th key={b} className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>{b}d</th>
                              ))}
                              <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(data).map(([name, buckets]: [string, any]) => {
                              const total = AGING_BUCKETS.reduce((s, b) => s + (buckets[b] || 0), 0);
                              return (
                                <tr key={name}>
                                  <Td bold>{name}</Td>
                                  {AGING_BUCKETS.map(b => (<Td key={b} align="right">{formatMoney(buckets[b] || 0, baseCurrency)}</Td>))}
                                  <Td align="right" color="var(--color-accent)" bold>{formatMoney(total, baseCurrency)}</Td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </TabsContent>
        </Tabs>
      )}

      {category === "team" && (
        <Tabs defaultValue="utilization" className="space-y-4">
          <TabsList>
            <TabsTrigger value="utilization">Utilization</TabsTrigger>
            <TabsTrigger value="hours">Team Member Hours</TabsTrigger>
            <TabsTrigger value="compliance">Timesheet Compliance</TabsTrigger>
            {canSeeCosts && <TabsTrigger value="labor">Labor Summary</TabsTrigger>}
          </TabsList>

          <TabsContent value="utilization">
            <SectionCard title="Team Member Utilization" actions={<CsvButton url="/api/reports/utilization/csv" testId="btn-csv-util" />}>
              {!utilization?.length ? (
                <EmptyState icon={Users} title="No approved timesheets" description="Utilization data will appear once timesheets are approved." />
              ) : (
                <div className="space-y-4">
                  {utilization.map((u: any) => (
                    <div key={u.userId} className="rounded-lg p-4" style={{ background: "var(--lux-surface-alt)" }}>
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <p className="text-sm font-semibold" style={{ color: "var(--lux-text)" }}>{u.name}</p>
                          <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>{formatHoursMinutes(u.totalBillable)} billable / {formatHoursMinutes(u.totalBillable + u.totalNonBillable)} total</p>
                        </div>
                        <p className="text-lg font-bold tabular-nums" style={{ color: u.overallUtilization >= 0.7 ? "#22c55e" : u.overallUtilization >= 0.5 ? "#f59e0b" : "#ef4444" }}>{formatPercent(u.overallUtilization * 100)}</p>
                      </div>
                      <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "var(--lux-border)" }}>
                        <div className="h-full rounded-full" style={{ width: `${Math.min(u.overallUtilization * 100, 100)}%`, background: u.overallUtilization >= 0.7 ? "#22c55e" : u.overallUtilization >= 0.5 ? "#f59e0b" : "#ef4444" }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </TabsContent>

          <TabsContent value="hours">
            <SectionCard title="Hours by Team Member">
              {!report?.hoursByTeamMember?.length ? (
                <EmptyState icon={Users} title="No team member data" description="Team member hours will appear once time is logged." />
              ) : (
                <ResponsiveContainer width="100%" height={350}>
                  <BarChart data={capChartData(report.hoursByTeamMember)} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--lux-border)" />
                    <XAxis type="number" tick={{ fill: "var(--lux-text-muted)", fontSize: 11 }} tickFormatter={v => formatHoursMinutes(v)} />
                    <YAxis dataKey="name" type="category" width={120} tick={{ fill: "var(--lux-text-muted)", fontSize: 11 }} />
                    <Tooltip formatter={(value: number, name: string) => [formatHoursMinutes(value), name === "billableMinutes" ? "Billable" : "Non-Billable"]} />
                    <Legend formatter={v => v === "billableMinutes" ? "Billable" : "Non-Billable"} />
                    <Bar dataKey="billableMinutes" name="billableMinutes" fill="#cf3339" stackId="a" />
                    <Bar dataKey="nonBillableMinutes" name="nonBillableMinutes" fill="#94a3b8" stackId="a" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </SectionCard>
          </TabsContent>

          <TabsContent value="compliance">
            <SectionCard title="Timesheet Compliance (Last 8 Weeks)">
              {!compliance?.teamMembers?.length ? (
                <EmptyState icon={UserCheck} title="No compliance data" description="Compliance data will appear once team members are active." />
              ) : (
                <div className="space-y-3">
                  {compliance.teamMembers.map((c: any) => (
                    <div key={c.teamMemberId} className="rounded-lg p-4" style={{ background: "var(--lux-surface-alt)" }}>
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <p className="text-sm font-semibold" style={{ color: "var(--lux-text)" }}>{c.teamMemberName}</p>
                          <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>{WORKER_TYPE_LABELS[c.workerType] || c.workerType}</p>
                        </div>
                        <p className="text-lg font-bold tabular-nums" style={{ color: c.complianceRate >= 80 ? "#22c55e" : c.complianceRate >= 50 ? "#f59e0b" : "#ef4444" }}>{formatPercent(c.complianceRate)}</p>
                      </div>
                      <div className="flex gap-1 mt-2">
                        {c.weeks.map((w: any, i: number) => (
                          <div key={i} className="flex-1 h-6 rounded text-[9px] font-medium flex items-center justify-center" title={`Week of ${formatDate(w.weekStart)}: ${w.status}`} style={{
                            background: w.status === "APPROVED" ? "rgba(34,197,94,0.15)" : w.status === "SUBMITTED" ? "rgba(59,130,246,0.15)" : w.status === "REJECTED" ? "rgba(239,68,68,0.15)" : "var(--lux-border)",
                            color: w.status === "APPROVED" ? "#22c55e" : w.status === "SUBMITTED" ? "#3b82f6" : w.status === "REJECTED" ? "#ef4444" : "var(--lux-text-muted)",
                          }}>
                            {w.status === "APPROVED" ? "✓" : w.status === "SUBMITTED" ? "●" : w.status === "REJECTED" ? "✗" : "—"}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </TabsContent>

          {canSeeCosts && <TabsContent value="labor">
            <SectionCard title="Labor Summary by Worker Type">
              {!laborSummary?.length ? (
                <EmptyState icon={Users} title="No labor data" description="Labor data will appear once team members log time." />
              ) : (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {laborSummary.map((row: any, i: number) => (
                      <div key={i} className="rounded-xl p-5" style={{ background: "var(--lux-surface-alt)" }}>
                        <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>{WORKER_TYPE_LABELS[row.workerType] || row.workerType}</p>
                        <p className="text-2xl font-bold mt-1" style={{ color: "var(--lux-text)" }}>{row.activeCount} <span className="text-sm font-normal" style={{ color: "var(--lux-text-muted)" }}>active</span></p>
                        <div className="mt-2 space-y-1 text-xs" style={{ color: "var(--lux-text-muted)" }}>
                          <p>{formatHours(row.totalHours)}h total · {formatHours(row.billableHours)}h billable</p>
                          <p>Utilization: <span style={{ color: row.utilization >= 70 ? "#22c55e" : "#f59e0b" }}>{formatPercent(row.utilization)}</span></p>
                          <p>Total cost: <span className="tabular-nums">{formatMoney(row.totalCost, baseCurrency)}</span></p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <ReportTable headers={["Worker Type", "Headcount", "Active", "Hours", "Billable", "Utilization", "Cost"]}>
                    {laborSummary.map((row: any, i: number) => (
                      <tr key={i}>
                        <Td bold>{WORKER_TYPE_LABELS[row.workerType] || row.workerType}</Td>
                        <Td align="right">{row.headcount}</Td>
                        <Td align="right">{row.activeCount}</Td>
                        <Td align="right">{formatHours(row.totalHours)}h</Td>
                        <Td align="right">{formatHours(row.billableHours)}h</Td>
                        <Td align="right" color={row.utilization >= 70 ? "#22c55e" : "#f59e0b"}>{formatPercent(row.utilization)}</Td>
                        <Td align="right" bold>{formatMoney(row.totalCost, baseCurrency)}</Td>
                      </tr>
                    ))}
                  </ReportTable>
                </div>
              )}
            </SectionCard>
          </TabsContent>}
        </Tabs>
      )}

      {category === "payouts" && isAdmin && (
        <Tabs defaultValue="payout-detail" className="space-y-4">
          <TabsList>
            <TabsTrigger value="payout-detail">Payout Detail</TabsTrigger>
            <TabsTrigger value="export1099">1099 Export</TabsTrigger>
          </TabsList>

          <TabsContent value="payout-detail" className="space-y-3">
            <ActiveFilterBar chips={payoutChips} testId="filter-bar-payouts" />
            <SectionCard title="Payout History" actions={
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <Label className="text-xs" style={{ color: "var(--lux-text-muted)" }}>From</Label>
                  <Input type="date" value={payoutStart} onChange={e => setPayoutStart(e.target.value)} className="h-8 text-xs w-36" data-testid="input-payouts-start" />
                </div>
                <div className="flex items-center gap-1.5">
                  <Label className="text-xs" style={{ color: "var(--lux-text-muted)" }}>To</Label>
                  <Input type="date" value={payoutEnd} onChange={e => setPayoutEnd(e.target.value)} className="h-8 text-xs w-36" data-testid="input-payouts-end" />
                </div>
              </div>
            }>
              {!payoutDetail?.payouts?.length && !payoutDetail?.summary?.length ? (
                <EmptyState icon={Wallet} title="No payout data" description="Payout data will appear once payouts are recorded." />
              ) : (
                <div className="space-y-6">
                  {payoutDetail.summary?.length > 0 && (
                    <ReportTable headers={["Independent", "Worker Type", "Payouts", "Total Paid"]}>
                      {payoutDetail.summary.map((c: any) => (
                        <tr key={c.teamMemberId}>
                          <Td bold>{c.name}</Td>
                          <Td>{WORKER_TYPE_LABELS[c.workerType] || c.workerType}</Td>
                          <Td align="right">{c.count}</Td>
                          <Td align="right" color="#22c55e" bold>{formatMoney(c.totalPaid, baseCurrency)}</Td>
                        </tr>
                      ))}
                    </ReportTable>
                  )}
                  <h4 className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>All Payouts</h4>
                  <ReportTable headers={["Date", "Independent", "Amount", "Method", "Status", "Reference"]}>
                    {payoutDetail.payouts.slice(0, 50).map((p: any) => (
                      <tr key={p.id}>
                        <Td>{formatDate(p.payoutDate)}</Td>
                        <Td bold>{p.teamMemberName}</Td>
                        <Td align="right" bold>{formatMoney(p.amount, baseCurrency)}</Td>
                        <Td align="right">{p.paymentMethod}</Td>
                        <Td align="right" color={p.status === "COMPLETED" ? "#22c55e" : p.status === "PENDING" ? "#f59e0b" : "#ef4444"}>{p.status}</Td>
                        <Td align="right">{p.referenceNumber || "—"}</Td>
                      </tr>
                    ))}
                  </ReportTable>
                </div>
              )}
            </SectionCard>
          </TabsContent>

          <TabsContent value="export1099" className="space-y-3">
            <ActiveFilterBar chips={exportChips} testId="filter-bar-export-1099" />
            <SectionCard title="1099 Totals Export">
              <div className="space-y-4">
                <p className="text-sm" style={{ color: "var(--lux-text-secondary)" }}>
                  Export a CSV of total paid amounts per 1099-eligible team member for a given date range.
                </p>
                <div className="flex items-end gap-3 flex-wrap">
                  <div>
                    <Label className="text-xs" style={{ color: "var(--lux-text-muted)" }}>From</Label>
                    <Input type="date" value={exportStart} onChange={e => setExportStart(e.target.value)} className="h-8 text-xs w-36 mt-1" data-testid="input-1099-start" />
                  </div>
                  <div>
                    <Label className="text-xs" style={{ color: "var(--lux-text-muted)" }}>To</Label>
                    <Input type="date" value={exportEnd} onChange={e => setExportEnd(e.target.value)} className="h-8 text-xs w-36 mt-1" data-testid="input-1099-end" />
                  </div>
                  <Button size="sm" style={{ background: "var(--color-accent)", color: "#fff" }} onClick={() => {
                    const url = `/api/reports/1099-export?startDate=${encodeURIComponent(exportStart)}&endDate=${encodeURIComponent(exportEnd)}`;
                    if (isValidReportUrl(url)) window.open(url, "_blank");
                  }}>
                    <Download className="w-3.5 h-3.5 mr-1.5" /> Export CSV
                  </Button>
                </div>
              </div>
            </SectionCard>
          </TabsContent>
        </Tabs>
      )}

      {/* EXPENSES */}
      {category === "expenses" && (
        <Tabs defaultValue="by-category" className="space-y-4">
          <TabsList>
            <TabsTrigger value="by-category">By Category</TabsTrigger>
            <TabsTrigger value="by-project">By Project</TabsTrigger>
            <TabsTrigger value="by-team-member">By Team Member</TabsTrigger>
          </TabsList>

          <TabsContent value="by-category">
            <SectionCard title="Expenses by Category">
              {!expensesByCategory?.length ? (
                <EmptyState icon={Receipt} title="No expense data" description="Expense data will appear once expenses are created." />
              ) : (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <ResponsiveContainer width="100%" height={280}>
                      <PieChart>
                        <Pie
                          data={expensesByCategory.map(c => ({ name: c.categoryName || "Uncategorized", value: Number(c.totalAmount) }))}
                          cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={3} dataKey="value" label={false}
                        >
                          {expensesByCategory.map((_, i) => (<Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />))}
                        </Pie>
                        <Tooltip formatter={(value: number) => formatMoney(value, baseCurrency)} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="space-y-2">
                      {expensesByCategory.map((c: any, i: number) => (
                        <div key={i} className="flex items-center justify-between p-2 rounded" style={{ background: "var(--lux-surface-alt)" }}>
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                            <span className="text-sm" style={{ color: "var(--lux-text)" }}>{c.categoryName || "Uncategorized"}</span>
                          </div>
                          <div className="text-right">
                            <span className="text-sm tabular-nums font-medium" style={{ color: "var(--lux-text)" }}>{formatMoney(Number(c.totalAmount), baseCurrency)}</span>
                            <span className="text-xs ml-2" style={{ color: "var(--lux-text-muted)" }}>{c.count}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <ReportTable headers={["Category", "Count", "Total", "Billable", "Reimbursable"]}>
                    {expensesByCategory.map((c: any, i: number) => (
                      <tr key={i}>
                        <Td bold>{c.categoryName || "Uncategorized"}</Td>
                        <Td align="right">{c.count}</Td>
                        <Td align="right" bold>{formatMoney(Number(c.totalAmount), baseCurrency)}</Td>
                        <Td align="right" color="#22c55e">{formatMoney(Number(c.billableAmount), baseCurrency)}</Td>
                        <Td align="right" color="#3b82f6">{formatMoney(Number(c.reimbursableAmount), baseCurrency)}</Td>
                      </tr>
                    ))}
                  </ReportTable>
                </div>
              )}
            </SectionCard>
          </TabsContent>

          <TabsContent value="by-project">
            <SectionCard title="Expenses by Project">
              {!expensesByProject?.length ? (
                <EmptyState icon={Receipt} title="No project expenses" description="Expenses linked to projects will appear here." />
              ) : (
                <ReportTable headers={["Project", "Client", "Count", "Total", "Billable"]}>
                  {expensesByProject.map((p: any, i: number) => (
                    <tr key={i}>
                      <Td bold>{p.projectName || "No Project"}</Td>
                      <Td>{p.clientName || "—"}</Td>
                      <Td align="right">{p.count}</Td>
                      <Td align="right" bold>{formatMoney(Number(p.totalAmount), baseCurrency)}</Td>
                      <Td align="right" color="#22c55e">{formatMoney(Number(p.billableAmount), baseCurrency)}</Td>
                    </tr>
                  ))}
                </ReportTable>
              )}
            </SectionCard>
          </TabsContent>

          <TabsContent value="by-team-member">
            <SectionCard title="Expenses by Team Member">
              {!expensesByUser?.length ? (
                <EmptyState icon={Receipt} title="No team member expenses" description="Team member expense data will appear once expenses are submitted." />
              ) : (
                <ReportTable headers={["Team Member", "Count", "Total", "Reimbursable"]}>
                  {expensesByUser.map((u: any, i: number) => (
                    <tr key={i}>
                      <Td bold>{u.userName || "Unknown"}</Td>
                      <Td align="right">{u.count}</Td>
                      <Td align="right" bold>{formatMoney(Number(u.totalAmount), baseCurrency)}</Td>
                      <Td align="right" color="#3b82f6">{formatMoney(Number(u.reimbursableAmount), baseCurrency)}</Td>
                    </tr>
                  ))}
                </ReportTable>
              )}
            </SectionCard>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
