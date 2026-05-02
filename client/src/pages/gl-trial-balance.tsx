import { useState, useMemo } from "react";
import { useUrlFilterState } from "@/lib/use-url-filter-state";
import { useQuery } from "@tanstack/react-query";
import { ErrorState } from "@/components/shared/error-state";
import { formatMoney } from "@/components/shared/format";
import { PageHelpLink } from "@/components/page-help-link";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { Scale, Download, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useDocumentTitle } from "@/lib/use-document-title";
import { Link } from "wouter";

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
  lines: unknown[];
}

const TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  ASSET: { bg: "rgba(34,197,94,0.12)", text: "#22c55e" },
  LIABILITY: { bg: "rgba(239,68,68,0.12)", text: "#ef4444" },
  EQUITY: { bg: "rgba(168,85,247,0.12)", text: "#a855f7" },
  REVENUE: { bg: "rgba(59,130,246,0.12)", text: "#3b82f6" },
  COST_OF_SERVICES: { bg: "rgba(245,158,11,0.12)", text: "#f59e0b" },
  EXPENSE: { bg: "rgba(245,158,11,0.12)", text: "#f59e0b" },
};

const TYPE_ORDER = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "COST_OF_SERVICES", "EXPENSE"];

function formatType(t: string) {
  return t.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function fmtMoney(v: number) {
  return formatMoney(v, "USD");
}

function fmt(d: Date) {
  return d.toISOString().split("T")[0];
}

export default function GLTrialBalancePage() {
  useDocumentTitle("Trial Balance");
  const [tbFilters, setTbFilter] = useUrlFilterState({ asOf: fmt(new Date()) });
  const asOfDate = tbFilters.asOf;
  const setAsOfDate = (v: string) => setTbFilter("asOf", v);

  const { data: accounts = [], isLoading, isError, refetch } = useQuery<AccountReport[]>({
    queryKey: ["/api/gl/report", "1900-01-01", asOfDate],
    queryFn: async () => {
      const params = new URLSearchParams({ endDate: asOfDate });
      const resp = await fetch(`/api/gl/report?${params}`, { credentials: "include" });
      if (!resp.ok) throw new Error("Failed to load report");
      return resp.json();
    },
  });

  const withBalance = useMemo(
    () => accounts.filter(a => parseFloat(a.balance) !== 0 || a.lines.length > 0),
    [accounts],
  );

  const grouped = useMemo(() => {
    const g: Record<string, AccountReport[]> = {};
    for (const a of withBalance) {
      if (!g[a.accountType]) g[a.accountType] = [];
      g[a.accountType].push(a);
    }
    for (const k of Object.keys(g)) {
      g[k].sort((a, b) => parseInt(a.accountNumber) - parseInt(b.accountNumber));
    }
    return g;
  }, [withBalance]);

  const computeDebitCredit = (a: AccountReport) => {
    const td = parseFloat(a.totalDebit) || 0;
    const tc = parseFloat(a.totalCredit) || 0;
    if (td > 0 || tc > 0) {
      return { debit: td, credit: tc };
    }
    const bal = parseFloat(a.balance) || 0;
    if (a.normalBalance === "DEBIT") {
      return bal >= 0 ? { debit: bal, credit: 0 } : { debit: 0, credit: -bal };
    }
    return bal >= 0 ? { debit: 0, credit: bal } : { debit: -bal, credit: 0 };
  };

  const grandTotalDebit = useMemo(
    () => withBalance.reduce((s, a) => s + (parseFloat(a.totalDebit) || 0), 0),
    [withBalance],
  );

  const grandTotalCredit = useMemo(
    () => withBalance.reduce((s, a) => s + (parseFloat(a.totalCredit) || 0), 0),
    [withBalance],
  );

  const handleExportCSV = () => {
    const rows: string[][] = [["Account #", "Account Name", "Type", "Debit Balance", "Credit Balance"]];
    for (const type of TYPE_ORDER) {
      const group = grouped[type];
      if (!group || group.length === 0) continue;
      for (const acct of group) {
        const { debit, credit } = computeDebitCredit(acct);
        rows.push([acct.accountNumber, acct.name, formatType(acct.accountType), debit.toFixed(2), credit.toFixed(2)]);
      }
    }
    rows.push(["", "", "TOTALS", grandTotalDebit.toFixed(2), grandTotalCredit.toFixed(2)]);
    const csv = rows.map(r => r.map(c => `"${(c || "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trial-balance-${asOfDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="px-6 lg:px-8 xl:px-10 py-6 space-y-6">
      <PageBreadcrumbs
        page="Trial Balance"
        showDashboard={false}
        items={[{ label: "Accounting", href: "/accounting", testId: "link-breadcrumb-accounting" }]}
      />
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(var(--lux-accent-rgb),0.15) 0%, rgba(var(--lux-accent-rgb),0.05) 100%)" }}>
            <Scale className="w-6 h-6" style={{ color: "var(--lux-accent)" }} />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--lux-text)" }} data-testid="text-page-title">
                Trial Balance
              </h1>
              <PageHelpLink />
            </div>
            <p className="text-sm mt-0.5" style={{ color: "var(--lux-text-muted)" }}>
              {withBalance.length} account{withBalance.length !== 1 ? "s" : ""} with balances
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleExportCSV} data-testid="button-export-csv">
          <Download className="w-4 h-4 mr-1.5" />
          Export CSV
        </Button>
      </div>

      <div className="rounded-xl border-0 p-4 flex items-center gap-3 flex-wrap" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
        <Calendar className="w-4 h-4" style={{ color: "var(--lux-text-muted)" }} />
        <span className="text-sm font-medium" style={{ color: "var(--lux-text-secondary)" }}>As of:</span>
        <Input
          type="date"
          value={asOfDate}
          onChange={(e) => setAsOfDate(e.target.value)}
          className="w-44 h-8 text-sm"
          data-testid="input-as-of-date"
        />
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => setAsOfDate(fmt(new Date()))}
          data-testid="button-today"
        >
          Today
        </Button>
      </div>

      {isError ? (
        <ErrorState title="Failed to load trial balance" onRetry={refetch} />
      ) : isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-12 rounded-lg animate-pulse" style={{ background: "var(--lux-border)" }} />
          ))}
        </div>
      ) : withBalance.length === 0 ? (
        <div className="rounded-xl border-0 p-12 text-center" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
          <Scale className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--lux-text-muted)" }} />
          <p className="text-sm font-medium" style={{ color: "var(--lux-text-muted)" }}>No account balances found</p>
          <p className="text-xs mt-1" style={{ color: "var(--lux-text-muted)" }}>Create some transactions to see your trial balance</p>
        </div>
      ) : (
        <div className="rounded-xl border-0 overflow-hidden" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: "2px solid var(--lux-border)", background: "var(--lux-table-header-bg)" }}>
                <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider w-[100px]" style={{ color: "var(--lux-text-muted)" }}>Account #</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Account Name</th>
                <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wider w-[140px]" style={{ color: "var(--lux-text-muted)" }}>Debit Balance</th>
                <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wider w-[140px]" style={{ color: "var(--lux-text-muted)" }}>Credit Balance</th>
              </tr>
            </thead>
            {TYPE_ORDER.map(type => {
              const group = grouped[type];
              if (!group || group.length === 0) return null;
              const colors = TYPE_COLORS[type] || TYPE_COLORS.EXPENSE;
              let groupDebit = 0;
              let groupCredit = 0;
              for (const a of group) {
                const dc = computeDebitCredit(a);
                groupDebit += dc.debit;
                groupCredit += dc.credit;
              }
              return (
                <tbody key={type}>
                  <tr style={{ background: colors.bg }}>
                    <td colSpan={4} className="px-4 py-2">
                      <span className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.text }}>
                        {formatType(type)}
                      </span>
                    </td>
                  </tr>
                  {group.map((acct, idx) => {
                    const { debit, credit } = computeDebitCredit(acct);
                    return (
                      <tr
                        key={acct.id}
                        style={{ borderBottom: idx < group.length - 1 ? "1px solid var(--lux-border)" : "none" }}
                        data-testid={`row-trial-balance-${acct.id}`}
                      >
                        <td className="px-4 py-2.5 font-sans tabular-nums text-sm font-semibold pl-8" style={{ color: "var(--lux-text-muted)" }}>
                          {acct.accountNumber}
                        </td>
                        <td className="px-4 py-2.5 text-sm font-medium" style={{ color: "var(--lux-text)" }}>
                          {acct.name}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-sm" style={{ color: debit > 0 ? "var(--lux-text)" : "var(--lux-text-muted)" }}>
                          {debit > 0 ? fmtMoney(debit) : "-"}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-sm" style={{ color: credit > 0 ? "var(--lux-text)" : "var(--lux-text-muted)" }}>
                          {credit > 0 ? fmtMoney(credit) : "-"}
                        </td>
                      </tr>
                    );
                  })}
                  <tr style={{ borderBottom: "2px solid var(--lux-border)" }}>
                    <td className="px-4 py-2 pl-8" />
                    <td className="px-4 py-2 text-xs font-semibold uppercase" style={{ color: colors.text }}>
                      {formatType(type)} Subtotal
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-sm font-bold" style={{ color: colors.text }}>
                      {groupDebit > 0 ? fmtMoney(groupDebit) : "-"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-sm font-bold" style={{ color: colors.text }}>
                      {groupCredit > 0 ? fmtMoney(groupCredit) : "-"}
                    </td>
                  </tr>
                </tbody>
              );
            })}
            <tfoot style={{ position: "sticky", bottom: 0, zIndex: 2 }}>
              <tr style={{ borderTop: "3px double var(--lux-border)", background: "var(--lux-bg)" }}>
                <td className="px-4 py-3" />
                <td className="px-4 py-3 text-sm font-bold uppercase tracking-wider" style={{ color: "var(--lux-text)" }}>
                  Total
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-sm font-bold" style={{ color: "var(--lux-text)" }} data-testid="text-total-debits">
                  {fmtMoney(grandTotalDebit)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-sm font-bold" style={{ color: "var(--lux-text)" }} data-testid="text-total-credits">
                  {fmtMoney(grandTotalCredit)}
                </td>
              </tr>
              <tr>
                <td colSpan={4} className="px-4 py-2 text-center">
                  <Badge
                    variant="secondary"
                    className="text-xs font-semibold"
                    style={Math.abs(grandTotalDebit - grandTotalCredit) < 0.01
                      ? { background: "rgba(34,197,94,0.12)", color: "#22c55e", border: "none" }
                      : { background: "rgba(239,68,68,0.12)", color: "#ef4444", border: "none" }
                    }
                    data-testid="badge-balance-status"
                  >
                    {Math.abs(grandTotalDebit - grandTotalCredit) < 0.01
                      ? "Balanced - Debits equal Credits"
                      : `Out of Balance by ${fmtMoney(Math.abs(grandTotalDebit - grandTotalCredit))}`
                    }
                  </Badge>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
