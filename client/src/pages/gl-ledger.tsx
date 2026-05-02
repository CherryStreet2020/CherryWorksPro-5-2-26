import { useState, useMemo, useEffect } from "react";
import { useUrlFilterState } from "@/lib/use-url-filter-state";
import { useQuery } from "@tanstack/react-query";
import { ErrorState } from "@/components/shared/error-state";
import { formatMoney } from "@/components/shared/format";
import { PageHelpLink } from "@/components/page-help-link";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { Link } from "wouter";
import {
  Landmark, ChevronDown, ChevronRight, Download, Printer,
  Calendar, ArrowUpDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useDocumentTitle } from "@/lib/use-document-title";

interface LedgerLine {
  lineId: number;
  journalEntryId: number;
  entryDate: string;
  sourceType: string | null;
  sourceId: number | null;
  entryMemo: string | null;
  lineMemo: string | null;
  debit: string;
  credit: string;
  runningBalance: string;
}

interface AccountReport {
  id: number;
  accountNumber: string;
  name: string;
  accountType: string;
  normalBalance: string;
  isActive: boolean;
  totalDebit: string;
  totalCredit: string;
  balance: string;
  lines: LedgerLine[];
}

const TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  ASSET: { bg: "rgba(34,197,94,0.12)", text: "#22c55e" },
  LIABILITY: { bg: "rgba(239,68,68,0.12)", text: "#ef4444" },
  EQUITY: { bg: "rgba(168,85,247,0.12)", text: "#a855f7" },
  REVENUE: { bg: "rgba(59,130,246,0.12)", text: "#3b82f6" },
  COST_OF_SERVICES: { bg: "rgba(245,158,11,0.12)", text: "#f59e0b" },
  EXPENSE: { bg: "rgba(245,158,11,0.12)", text: "#f59e0b" },
};

function formatType(t: string) {
  return t.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function fmtMoney(v: string | number) {
  return formatMoney(v, "USD");
}

const NATURAL_CREDIT_TYPES = new Set(["REVENUE", "LIABILITY", "EQUITY"]);

function periodLabel(balance: number, normalBalance: string): string {
  if (balance === 0) return "Dr";
  if (normalBalance === "CREDIT") return balance > 0 ? "Cr" : "Dr";
  return balance > 0 ? "Dr" : "Cr";
}

function groupPeriodLabel(balance: number, type: string): string {
  if (balance === 0) return "Dr";
  if (NATURAL_CREDIT_TYPES.has(type)) return balance > 0 ? "Cr" : "Dr";
  return balance > 0 ? "Dr" : "Cr";
}

function fmtDate(d: string) {
  const parts = d.split("-");
  if (parts.length === 3) return `${parts[1]}/${parts[2]}/${parts[0]}`;
  return d;
}

function getQuickRange(key: string): { startDate: string; endDate: string } {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = now.getMonth();
  if (key === "this-month") {
    const start = new Date(yyyy, mm, 1);
    const end = new Date(yyyy, mm + 1, 0);
    return { startDate: fmt(start), endDate: fmt(end) };
  }
  if (key === "last-quarter") {
    const qStart = Math.floor(mm / 3) * 3;
    const start = new Date(yyyy, qStart - 3, 1);
    const end = new Date(yyyy, qStart, 0);
    return { startDate: fmt(start), endDate: fmt(end) };
  }
  if (key === "last-year") {
    return { startDate: `${yyyy - 1}-01-01`, endDate: `${yyyy - 1}-12-31` };
  }
  if (key === "ytd") {
    return { startDate: `${yyyy}-01-01`, endDate: fmt(now) };
  }
  return { startDate: "", endDate: "" };
}

function fmt(d: Date) {
  return d.toISOString().split("T")[0];
}

export default function GLLedgerPage() {
  useDocumentTitle("General Ledger");
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = now.getMonth();
  const hadStartDateInUrl = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("startDate");
  const [glFilters, setGlFilter, setGlFilters] = useUrlFilterState({
    startDate: fmt(new Date(yyyy, mm, 1)),
    endDate: fmt(new Date(yyyy, mm + 1, 0)),
    range: hadStartDateInUrl ? "custom" : "this-month",
  });
  const startDate = glFilters.startDate;
  const endDate = glFilters.endDate;
  const activeQuick = glFilters.range;
  const setStartDate = (v: string) => setGlFilter("startDate", v);
  const setEndDate = (v: string) => setGlFilter("endDate", v);
  const setActiveQuick = (v: string) => setGlFilter("range", v);
  const [expandedAccounts, setExpandedAccounts] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (startDate) params.set("startDate", startDate); else params.delete("startDate");
    if (endDate) params.set("endDate", endDate); else params.delete("endDate");
    const qs = params.toString();
    const newUrl = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
    if (newUrl !== window.location.pathname + window.location.search + window.location.hash) {
      window.history.replaceState(null, "", newUrl);
    }
  }, [startDate, endDate]);

  const { data: accounts = [], isLoading, isError, refetch } = useQuery<AccountReport[]>({
    queryKey: ["/api/gl/report", startDate, endDate],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      const resp = await fetch(`/api/gl/report?${params}`, { credentials: "include" });
      if (!resp.ok) throw new Error("Failed to load report");
      return resp.json();
    },
  });

  const accountsWithActivity = useMemo(
    () => accounts.filter(a => a.lines.length > 0 || parseFloat(a.balance) !== 0),
    [accounts],
  );

  const sortedAccounts = useMemo(
    () => [...accountsWithActivity].sort((a, b) => parseInt(a.accountNumber) - parseInt(b.accountNumber)),
    [accountsWithActivity],
  );

  const groupedByType = useMemo(() => {
    const groups: Record<string, AccountReport[]> = {};
    for (const a of sortedAccounts) {
      const key = a.accountType;
      if (!groups[key]) groups[key] = [];
      groups[key].push(a);
    }
    return groups;
  }, [sortedAccounts]);

  const typeOrder = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "COST_OF_SERVICES", "EXPENSE"];

  const toggleAccount = (id: number) => {
    setExpandedAccounts(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const applyQuick = (key: string) => {
    if (key === "custom") {
      setActiveQuick(key);
      return;
    }
    const range = getQuickRange(key);
    setGlFilters({ range: key, startDate: range.startDate, endDate: range.endDate });
  };

  const totalDebit = useMemo(() => sortedAccounts.reduce((s, a) => s + parseFloat(a.totalDebit), 0), [sortedAccounts]);
  const totalCredit = useMemo(() => sortedAccounts.reduce((s, a) => s + parseFloat(a.totalCredit), 0), [sortedAccounts]);

  const handleExportCSV = () => {
    const rows: string[][] = [["Account #", "Account Name", "Type", "Date", "Source", "Memo", "Debit", "Credit", "Balance"]];
    for (const acct of sortedAccounts) {
      if (acct.lines.length === 0) {
        rows.push([acct.accountNumber, acct.name, formatType(acct.accountType), "", "", "", "", "", acct.balance]);
      }
      for (const line of acct.lines) {
        rows.push([
          acct.accountNumber, acct.name, formatType(acct.accountType),
          line.entryDate, line.sourceType || "Manual", line.entryMemo || line.lineMemo || "",
          line.debit, line.credit, line.runningBalance,
        ]);
      }
    }
    const csv = rows.map(r => r.map(c => `"${(c || "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `general-ledger-${startDate}-to-${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => window.print();

  return (
    <div className="px-6 lg:px-8 xl:px-10 py-6 space-y-6">
      <PageBreadcrumbs
        page="General Ledger"
        showDashboard={false}
        items={[{ label: "Accounting", href: "/accounting", testId: "link-breadcrumb-accounting" }]}
      />
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(var(--lux-accent-rgb),0.15) 0%, rgba(var(--lux-accent-rgb),0.05) 100%)" }}>
            <Landmark className="w-6 h-6" style={{ color: "var(--lux-accent)" }} />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--lux-text)" }} data-testid="text-page-title">
                General Ledger
              </h1>
              <PageHelpLink />
            </div>
            <p className="text-sm mt-0.5" style={{ color: "var(--lux-text-muted)" }}>
              {sortedAccounts.length} account{sortedAccounts.length !== 1 ? "s" : ""} with activity
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExportCSV} data-testid="button-export-csv">
            <Download className="w-4 h-4 mr-1.5" />
            Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={handlePrint} data-testid="button-print">
            <Printer className="w-4 h-4 mr-1.5" />
            Print
          </Button>
        </div>
      </div>

      <div className="rounded-xl border-0 p-4 space-y-3" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
        <div className="flex items-center gap-2 flex-wrap">
          <Calendar className="w-4 h-4" style={{ color: "var(--lux-text-muted)" }} />
          <span className="text-sm font-medium" style={{ color: "var(--lux-text-secondary)" }}>Period:</span>
          {[
            { key: "this-month", label: "This Month" },
            { key: "last-quarter", label: "Last Quarter" },
            { key: "ytd", label: "Year to Date" },
            { key: "last-year", label: "Last Year" },
            { key: "custom", label: "Custom" },
          ].map(q => (
            <Button
              key={q.key}
              variant={activeQuick === q.key ? "default" : "outline"}
              size="sm"
              style={activeQuick === q.key ? { background: "var(--gradient-brand)" } : { borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
              className={`h-7 text-xs ${activeQuick === q.key ? "text-white" : ""}`}
              onClick={() => applyQuick(q.key)}
              data-testid={`button-filter-${q.key}`}
            >
              {q.label}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>From</label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => { setStartDate(e.target.value); setActiveQuick("custom"); }}
              className="w-40 h-8 text-sm"
              data-testid="input-start-date"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>To</label>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => { setEndDate(e.target.value); setActiveQuick("custom"); }}
              className="w-40 h-8 text-sm"
              data-testid="input-end-date"
            />
          </div>
        </div>
      </div>

      {isError ? (
        <ErrorState title="Failed to load ledger" onRetry={refetch} />
      ) : isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-14 rounded-lg animate-pulse" style={{ background: "var(--lux-border)" }} />
          ))}
        </div>
      ) : sortedAccounts.length === 0 ? (
        <div className="rounded-xl border-0 p-12 text-center" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
          <ArrowUpDown className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--lux-text-muted)" }} />
          <p className="text-sm font-medium" style={{ color: "var(--lux-text-muted)" }}>No transactions found for this period</p>
          <p className="text-xs mt-1" style={{ color: "var(--lux-text-muted)" }}>Try adjusting the date range or create some transactions first</p>
        </div>
      ) : (
        <div className="space-y-6">
          {typeOrder.map(type => {
            const group = groupedByType[type];
            if (!group || group.length === 0) return null;
            const colors = TYPE_COLORS[type] || TYPE_COLORS.EXPENSE;
            const groupDebit = group.reduce((s, a) => s + parseFloat(a.totalDebit), 0);
            const groupCredit = group.reduce((s, a) => s + parseFloat(a.totalCredit), 0);
            const groupBalance = group.reduce((s, a) => s + parseFloat(a.balance), 0);
            return (
              <div key={type} className="space-y-1">
                <div className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ background: colors.bg }}>
                  <span className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.text }}>
                    {formatType(type)}
                  </span>
                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <span className="text-[10px] uppercase tracking-wider mr-1" style={{ color: colors.text, opacity: 0.7 }}>Dr</span>
                      <span className="text-xs font-bold tabular-nums" style={{ color: colors.text }}>{fmtMoney(groupDebit)}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] uppercase tracking-wider mr-1" style={{ color: colors.text, opacity: 0.7 }}>Cr</span>
                      <span className="text-xs font-bold tabular-nums" style={{ color: colors.text }}>{fmtMoney(groupCredit)}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] uppercase tracking-wider mr-1" style={{ color: colors.text, opacity: 0.7 }}>Period</span>
                      <span className="text-sm font-bold tabular-nums" style={{ color: colors.text }}>{fmtMoney(Math.abs(groupBalance))}</span>
                      <span className="text-[10px] ml-0.5 font-semibold" style={{ color: colors.text, opacity: 0.7 }}>{groupPeriodLabel(groupBalance, type)}</span>
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border-0 overflow-hidden" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
                  {group.map((acct, idx) => {
                    const isExpanded = expandedAccounts.has(acct.id);
                    const hasLines = acct.lines.length > 0;
                    return (
                      <div key={acct.id}>
                        {idx > 0 && <div style={{ borderTop: "1px solid var(--lux-border)" }} />}
                        <div
                          className={`flex items-center px-4 py-3 ${hasLines ? "cursor-pointer hover:bg-black/[0.02] dark:hover:bg-white/[0.02]" : ""} transition-colors`}
                          onClick={() => hasLines && toggleAccount(acct.id)}
                          data-testid={`row-ledger-account-${acct.id}`}
                        >
                          <div className="w-6 flex-shrink-0">
                            {hasLines && (
                              isExpanded
                                ? <ChevronDown className="w-4 h-4" style={{ color: "var(--lux-text-muted)" }} />
                                : <ChevronRight className="w-4 h-4" style={{ color: "var(--lux-text-muted)" }} />
                            )}
                          </div>
                          <span className="w-20 font-sans tabular-nums text-sm font-semibold flex-shrink-0" style={{ color: "var(--lux-text-muted)" }}>
                            {acct.accountNumber}
                          </span>
                          <span className="flex-1 text-sm font-medium" style={{ color: "var(--lux-text)" }}>
                            {acct.name}
                          </span>
                          {hasLines && (
                            <Badge variant="secondary" className="text-[10px] mr-3" style={{ background: "var(--lux-border)", color: "var(--lux-text-muted)" }}>
                              {acct.lines.length} txn{acct.lines.length !== 1 ? "s" : ""}
                            </Badge>
                          )}
                          <span className="w-36 text-right tabular-nums text-sm font-semibold" style={{ color: "var(--lux-text)" }} title="Period activity">
                            {fmtMoney(Math.abs(parseFloat(acct.balance)))}
                            <span className="text-[10px] ml-0.5 font-medium" style={{ color: "var(--lux-text-muted)" }}>{periodLabel(parseFloat(acct.balance), acct.normalBalance)}</span>
                          </span>
                        </div>
                        {isExpanded && hasLines && (
                          <div style={{ background: "var(--lux-bg)" }}>
                            <div className="border-t" style={{ borderColor: "var(--lux-border)" }}>
                              <table className="w-full text-sm">
                                <thead>
                                  <tr style={{ borderBottom: "1px solid var(--lux-border)" }}>
                                    <th className="text-left px-4 py-2 text-[11px] font-semibold uppercase tracking-wider pl-14" style={{ color: "var(--lux-text-muted)" }}>Date</th>
                                    <th className="text-left px-4 py-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Type</th>
                                    <th className="text-left px-4 py-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Transaction #</th>
                                    <th className="text-left px-4 py-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Memo</th>
                                    <th className="text-right px-4 py-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Debit</th>
                                    <th className="text-right px-4 py-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Credit</th>
                                    <th className="text-right px-4 py-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Running Bal</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {acct.lines.map((line, li) => (
                                    <tr
                                      key={line.lineId}
                                      style={{ borderBottom: li < acct.lines.length - 1 ? "1px solid var(--lux-border)" : "none" }}
                                      data-testid={`row-ledger-line-${line.lineId}`}
                                    >
                                      <td className="px-4 py-2 pl-14 tabular-nums text-xs" style={{ color: "var(--lux-text-secondary)" }}>
                                        {fmtDate(line.entryDate)}
                                      </td>
                                      <td className="px-4 py-2">
                                        <Badge
                                          variant="secondary"
                                          className="text-[10px] font-semibold"
                                          style={{
                                            background: line.sourceType ? "rgba(59,130,246,0.1)" : "rgba(168,85,247,0.1)",
                                            color: line.sourceType ? "#3b82f6" : "#a855f7",
                                            border: "none",
                                          }}
                                        >
                                          {line.sourceType || "Manual"}
                                        </Badge>
                                      </td>
                                      <td className="px-4 py-2 font-sans tabular-nums text-xs" style={{ color: "var(--lux-text-muted)" }}>
                                        JE-{line.journalEntryId}
                                      </td>
                                      <td className="px-4 py-2 text-xs max-w-[200px] truncate" style={{ color: "var(--lux-text-secondary)" }}>
                                        {line.lineMemo || line.entryMemo || "-"}
                                      </td>
                                      <td className="px-4 py-2 text-right tabular-nums text-xs" style={{ color: parseFloat(line.debit) > 0 ? "var(--lux-text)" : "var(--lux-text-muted)" }}>
                                        {parseFloat(line.debit) > 0 ? fmtMoney(line.debit) : "-"}
                                      </td>
                                      <td className="px-4 py-2 text-right tabular-nums text-xs" style={{ color: parseFloat(line.credit) > 0 ? "var(--lux-text)" : "var(--lux-text-muted)" }}>
                                        {parseFloat(line.credit) > 0 ? fmtMoney(line.credit) : "-"}
                                      </td>
                                      <td className="px-4 py-2 text-right tabular-nums text-xs font-semibold" style={{ color: "var(--lux-text)" }}>
                                        {fmtMoney(line.runningBalance)}
                                      </td>
                                    </tr>
                                  ))}
                                  <tr style={{ borderTop: "2px solid var(--lux-border)" }}>
                                    <td colSpan={4} className="px-4 py-2 pl-14 text-xs font-semibold uppercase" style={{ color: "var(--lux-text-muted)" }}>
                                      Account Total
                                    </td>
                                    <td className="px-4 py-2 text-right tabular-nums text-xs font-bold" style={{ color: "var(--lux-text)" }}>
                                      {fmtMoney(acct.totalDebit)}
                                    </td>
                                    <td className="px-4 py-2 text-right tabular-nums text-xs font-bold" style={{ color: "var(--lux-text)" }}>
                                      {fmtMoney(acct.totalCredit)}
                                    </td>
                                    <td className="px-4 py-2 text-right tabular-nums text-xs font-bold" style={{ color: colors.text }}>
                                      {fmtMoney(acct.balance)}
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          <div className="rounded-xl border-0 p-4" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold uppercase tracking-wider" style={{ color: "var(--lux-text)" }}>Grand Totals</span>
              <div className="flex items-center gap-8">
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Total Debits</p>
                  <p className="tabular-nums text-sm font-bold" style={{ color: "var(--lux-text)" }} data-testid="text-total-debits">{fmtMoney(totalDebit)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Total Credits</p>
                  <p className="tabular-nums text-sm font-bold" style={{ color: "var(--lux-text)" }} data-testid="text-total-credits">{fmtMoney(totalCredit)}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
