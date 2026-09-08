import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatMoney, formatDate, formatHours } from "@/components/shared/format";
import { FileSpreadsheet, FileText } from "lucide-react";

interface Line { entryId: string; date: string; project: string; client: string; hours: number; rate: number; amount: number; billable: boolean; invoiced: boolean; notes: string | null }
interface Payout { id: string; payoutDate: string; amount: number; status: string; paymentMethod: string | null; referenceNumber: string | null; periodStart: string | null; periodEnd: string | null; notes: string | null; lines: Line[]; unlinkedAmount: number }
interface Statement { generatedAt: string; member: { id: string; name: string; email: string | null }; outstanding: { total: number; hours: number; lines: Line[] }; payouts: Payout[]; paidTotal: number }

function LinesTable({ lines, testId }: { lines: Line[]; testId: string }) {
  return (
    <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid var(--lux-border)" }}>
      <table className="w-full text-xs" data-testid={testId}>
        <thead>
          <tr style={{ color: "var(--lux-text-muted)", background: "var(--lux-bg)" }}>
            {["Date", "Client", "Project", "Hours", "Rate", "Amount", "Invoiced", "Notes"].map((h, i) => (
              <th key={h} className={`px-2 py-1.5 font-semibold ${i >= 3 && i <= 5 ? "text-right" : "text-left"}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.entryId} style={{ borderTop: "1px solid var(--lux-border)", color: "var(--lux-text)" }}>
              <td className="px-2 py-1.5 whitespace-nowrap">{formatDate(l.date)}</td>
              <td className="px-2 py-1.5">{l.client}</td>
              <td className="px-2 py-1.5">{l.project}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{formatHours(l.hours)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney(l.rate)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{formatMoney(l.amount)}</td>
              <td className="px-2 py-1.5">{l.invoiced ? "Yes" : "No"}</td>
              <td className="px-2 py-1.5 max-w-[220px] truncate" title={l.notes ?? ""} style={{ color: "var(--lux-text-muted)" }}>{l.notes ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Every timesheet line behind a team member's outstanding balance and behind each
 * recorded payout — the same numbers the Payouts page and the member's own
 * earnings view show — with Excel and PDF downloads served by the API.
 */
export function PayoutStatementDialog({ teamMemberId, open, onOpenChange }: { teamMemberId: string | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { data, isLoading, error } = useQuery<Statement>({
    queryKey: ["/api/payouts/team-member", teamMemberId, "statement"],
    enabled: open && !!teamMemberId,
    queryFn: async () => {
      const res = await fetch(`/api/payouts/team-member/${teamMemberId}/statement`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load the payout statement");
      return res.json();
    },
  });
  const base = teamMemberId ? `/api/payouts/team-member/${teamMemberId}/statement` : "";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto" data-testid="payout-statement-dialog">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-3">
            <span>{data ? `${data.member.name} — payout statement` : "Payout statement"}</span>
            {teamMemberId && (
              <span className="ml-auto flex gap-2">
                <a href={`${base}.xlsx`} download><Button size="sm" variant="outline" data-testid="button-statement-xlsx"><FileSpreadsheet className="w-4 h-4 mr-1" /> Excel</Button></a>
                <a href={`${base}.pdf`} download><Button size="sm" variant="outline" data-testid="button-statement-pdf"><FileText className="w-4 h-4 mr-1" /> PDF</Button></a>
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        {isLoading && <div className="space-y-2"><Skeleton className="h-6 w-1/3" /><Skeleton className="h-32 w-full" /></div>}
        {error && <p className="text-sm" style={{ color: "var(--lux-danger, #f87171)" }}>{(error as Error).message}</p>}
        {data && (
          <div className="space-y-6">
            <section>
              <div className="flex items-baseline justify-between mb-2">
                <h3 className="text-sm font-bold" style={{ color: "var(--lux-text)" }}>Outstanding — what is owed now</h3>
                <p className="text-sm" style={{ color: "var(--lux-text-muted)" }}>{formatHours(data.outstanding.hours)}h · <span className="font-bold" style={{ color: "var(--lux-text)" }} data-testid="statement-outstanding-total">{formatMoney(data.outstanding.total)}</span></p>
              </div>
              {data.outstanding.lines.length === 0
                ? <p className="text-sm py-3" style={{ color: "var(--lux-text-muted)" }}>No unpaid time.</p>
                : <LinesTable lines={data.outstanding.lines} testId="statement-outstanding-lines" />}
            </section>
            <section>
              <div className="flex items-baseline justify-between mb-2">
                <h3 className="text-sm font-bold" style={{ color: "var(--lux-text)" }}>Paid — what each payout covered</h3>
                <p className="text-sm" style={{ color: "var(--lux-text-muted)" }}>{data.payouts.length} payout(s) · completed total <span className="font-bold" style={{ color: "var(--lux-text)" }} data-testid="statement-paid-total">{formatMoney(data.paidTotal)}</span></p>
              </div>
              {data.payouts.length === 0 && <p className="text-sm py-3" style={{ color: "var(--lux-text-muted)" }}>No payouts recorded yet.</p>}
              <div className="space-y-3">
                {data.payouts.map((p) => (
                  <details key={p.id} className="rounded-lg p-3" style={{ background: "var(--lux-bg)", border: "1px solid var(--lux-border)" }} data-testid={`statement-payout-${p.id}`}>
                    <summary className="cursor-pointer flex flex-wrap items-center gap-3 text-sm" style={{ color: "var(--lux-text)" }}>
                      <span className="font-semibold">{formatDate(p.payoutDate)}</span>
                      <span className="font-bold tabular-nums">{formatMoney(p.amount)}</span>
                      <StatusBadge status={p.status} />
                      {p.paymentMethod && <span style={{ color: "var(--lux-text-muted)" }}>via {p.paymentMethod}</span>}
                      {p.referenceNumber && <span style={{ color: "var(--lux-text-muted)" }}>ref {p.referenceNumber}</span>}
                      <span className="ml-auto text-xs" style={{ color: "var(--lux-text-muted)" }}>{p.lines.length} line(s){p.periodStart ? ` · ${formatDate(p.periodStart)} – ${p.periodEnd ? formatDate(p.periodEnd) : "?"}` : ""}</span>
                    </summary>
                    <div className="mt-3 space-y-2">
                      {p.notes && <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>{p.notes}</p>}
                      {p.lines.length === 0
                        ? <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>Recorded without linked time entries.</p>
                        : <LinesTable lines={p.lines} testId={`statement-payout-lines-${p.id}`} />}
                      {p.lines.length > 0 && p.unlinkedAmount !== 0 && <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>Amount not linked to time: {formatMoney(p.unlinkedAmount)}</p>}
                    </div>
                  </details>
                ))}
              </div>
            </section>
            <p className="text-[11px]" style={{ color: "var(--lux-text-muted)" }}>Outstanding values use the same rate and rounding as the Record Payment dialog and the member's earnings view. Paid lines show the amount recorded when the payout was booked.</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
