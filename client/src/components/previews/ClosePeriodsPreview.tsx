export function ClosePeriodsPreview() {
  return (
    <div className="w-full space-y-4 p-6" style={{ color: "var(--lux-text)" }}>
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="h-5 w-44 rounded" style={{ background: "var(--lux-text)", opacity: 0.15 }} />
          <div className="h-3 w-72 rounded" style={{ background: "var(--lux-text)", opacity: 0.08 }} />
        </div>
        <div className="h-9 w-32 rounded-lg" style={{ background: "var(--gradient-brand)", opacity: 0.6 }} />
      </div>

      <div className="grid grid-cols-4 gap-3">
        {[
          { month: "Jan 2026", status: "Closed", color: "#22c55e" },
          { month: "Feb 2026", status: "Closed", color: "#22c55e" },
          { month: "Mar 2026", status: "Closed", color: "#22c55e" },
          { month: "Apr 2026", status: "Open", color: "#f59e0b" },
        ].map((p, i) => (
          <div key={i} className="rounded-xl p-3 space-y-2 text-center" style={{ background: "var(--lux-surface-alt)", border: "1px solid var(--lux-border)" }}>
            <p className="text-xs font-semibold">{p.month}</p>
            <div className="flex items-center justify-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: p.color }} />
              <span className="text-[10px] font-medium" style={{ color: p.color }}>{p.status}</span>
            </div>
            {p.status === "Closed" && (
              <div className="text-[9px]" style={{ color: "var(--lux-text-muted)" }}>🔒 Locked</div>
            )}
          </div>
        ))}
      </div>

      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--lux-border)" }}>
        <div className="px-4 py-3 flex items-center justify-between" style={{ background: "var(--lux-surface-alt)" }}>
          <span className="text-xs font-semibold" style={{ color: "var(--lux-text-secondary)" }}>Period Close Checklist — March 2026</span>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">Complete</span>
        </div>
        {[
          { task: "All time entries approved", done: true },
          { task: "All invoices finalized & sent", done: true },
          { task: "Bank reconciliation completed", done: true },
          { task: "Expense reports approved", done: true },
          { task: "GL journal entries balanced", done: true },
          { task: "Revenue recognition posted", done: true },
        ].map((t, i) => (
          <div key={i} className="px-4 py-2.5 flex items-center gap-3" style={{ borderTop: "1px solid var(--lux-border)" }}>
            <div className="w-5 h-5 rounded flex items-center justify-center text-[10px]" style={{
              background: t.done ? "rgba(34,197,94,0.1)" : "var(--lux-surface-alt)",
              color: t.done ? "#22c55e" : "var(--lux-text-muted)",
              border: t.done ? "none" : "1px solid var(--lux-border)",
            }}>
              {t.done ? "✓" : ""}
            </div>
            <span className="text-xs" style={{ color: t.done ? "var(--lux-text)" : "var(--lux-text-muted)" }}>{t.task}</span>
          </div>
        ))}
      </div>

      <div className="rounded-xl p-4 space-y-2" style={{ background: "rgba(34,197,94,0.04)", border: "1px solid rgba(34,197,94,0.2)" }}>
        <div className="flex items-center gap-2">
          <span className="text-sm">📋</span>
          <span className="text-xs font-semibold text-green-700">Audit Trail</span>
        </div>
        <p className="text-[10px]" style={{ color: "var(--lux-text-muted)" }}>
          Every period close is logged with who closed it, when, and what was included — providing a complete audit trail for compliance.
        </p>
      </div>
    </div>
  );
}

export const closePeriodsBenefits = [
  "Lock completed months to prevent accidental backdated edits",
  "Pre-close checklist ensures all entries are finalized",
  "Full audit trail of who closed each period and when",
];
