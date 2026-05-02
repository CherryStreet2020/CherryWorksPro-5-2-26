export function BankingPreview() {
  return (
    <div className="w-full space-y-4 p-6" style={{ color: "var(--lux-text)" }}>
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="h-5 w-40 rounded" style={{ background: "var(--lux-text)", opacity: 0.15 }} />
          <div className="h-3 w-56 rounded" style={{ background: "var(--lux-text)", opacity: 0.08 }} />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-36 rounded-lg" style={{ background: "var(--gradient-brand)", opacity: 0.6 }} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Checking ••4821", bal: "$24,830.50", icon: "🏦" },
          { label: "Savings ••7193", bal: "$142,500.00", icon: "💰" },
          { label: "Business ••0362", bal: "$8,420.75", icon: "🏛️" },
        ].map((a, i) => (
          <div key={i} className="rounded-xl p-4 space-y-2" style={{ background: "var(--lux-surface-alt)", border: "1px solid var(--lux-border)" }}>
            <div className="flex items-center gap-2">
              <span className="text-lg">{a.icon}</span>
              <span className="text-xs font-medium" style={{ color: "var(--lux-text-secondary)" }}>{a.label}</span>
            </div>
            <p className="text-lg font-bold tabular-nums">{a.bal}</p>
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
              <span className="text-[10px]" style={{ color: "var(--lux-text-muted)" }}>Connected</span>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--lux-border)" }}>
        <div className="px-4 py-3 flex items-center justify-between" style={{ background: "var(--lux-surface-alt)" }}>
          <span className="text-xs font-semibold" style={{ color: "var(--lux-text-secondary)" }}>Recent Transactions</span>
          <div className="flex gap-2">
            <div className="h-6 w-16 rounded" style={{ background: "var(--lux-text)", opacity: 0.06 }} />
            <div className="h-6 w-16 rounded" style={{ background: "var(--lux-text)", opacity: 0.06 }} />
          </div>
        </div>
        {[
          { desc: "AWS Cloud Services", amt: "-$1,249.00", cat: "Software", matched: true },
          { desc: "Client Payment — Acme Corp", amt: "+$8,500.00", cat: "Revenue", matched: true },
          { desc: "Office Depot — Supplies", amt: "-$342.18", cat: "Office", matched: false },
          { desc: "Stripe Payout", amt: "+$4,200.00", cat: "Revenue", matched: true },
          { desc: "WeWork Monthly", amt: "-$950.00", cat: "Rent", matched: false },
        ].map((t, i) => (
          <div key={i} className="px-4 py-3 flex items-center justify-between" style={{ borderTop: "1px solid var(--lux-border)" }}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: t.amt.startsWith("+") ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)", color: t.amt.startsWith("+") ? "#22c55e" : "#ef4444" }}>
                {t.amt.startsWith("+") ? "↓" : "↑"}
              </div>
              <div>
                <p className="text-sm font-medium">{t.desc}</p>
                <p className="text-[10px]" style={{ color: "var(--lux-text-muted)" }}>{t.cat}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className={`text-sm font-semibold tabular-nums ${t.amt.startsWith("+") ? "text-green-600" : ""}`} style={t.amt.startsWith("+") ? {} : { color: "var(--lux-text)" }}>{t.amt}</span>
              {t.matched ? (
                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">Matched</span>
              ) : (
                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(245,158,11,0.1)", color: "#f59e0b" }}>Review</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export const bankingBenefits = [
  "Auto-import transactions from connected bank accounts",
  "Smart matching engine links transactions to invoices & expenses",
  "One-click bank reconciliation with GL posting",
];
