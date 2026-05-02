export function ImportPreview() {
  return (
    <div className="w-full space-y-4 p-6" style={{ color: "var(--lux-text)" }}>
      <div className="space-y-1">
        <div className="h-5 w-44 rounded" style={{ background: "var(--lux-text)", opacity: 0.15 }} />
        <div className="h-3 w-64 rounded" style={{ background: "var(--lux-text)", opacity: 0.08 }} />
      </div>

      <div className="flex items-center gap-6 py-2">
        {[
          { step: "1", label: "Source", active: true },
          { step: "2", label: "Map Fields", active: false },
          { step: "3", label: "Review", active: false },
          { step: "4", label: "Import", active: false },
        ].map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold" style={{
              background: s.active ? "var(--gradient-brand)" : "var(--lux-surface-alt)",
              color: s.active ? "white" : "var(--lux-text-muted)",
              border: s.active ? "none" : "1px solid var(--lux-border)",
            }}>
              {s.step}
            </div>
            <span className="text-xs font-medium" style={{ color: s.active ? "var(--lux-text)" : "var(--lux-text-muted)" }}>{s.label}</span>
            {i < 3 && <div className="w-8 h-px" style={{ background: "var(--lux-border)" }} />}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { name: "FreshBooks", desc: "Clients, invoices, expenses, time", icon: "📗" },
          { name: "QuickBooks", desc: "Chart of accounts, invoices, bills", icon: "📘" },
          { name: "CSV / Excel", desc: "Custom file upload with field mapping", icon: "📄" },
        ].map((s, i) => (
          <div key={i} className="rounded-xl p-4 space-y-2 cursor-pointer transition-all" style={{
            background: i === 0 ? "hsl(var(--primary) / 0.04)" : "var(--lux-surface-alt)",
            border: i === 0 ? "2px solid hsl(var(--primary) / 0.3)" : "1px solid var(--lux-border)",
          }}>
            <span className="text-2xl">{s.icon}</span>
            <p className="text-sm font-semibold">{s.name}</p>
            <p className="text-[10px]" style={{ color: "var(--lux-text-muted)" }}>{s.desc}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl p-4 space-y-3" style={{ background: "var(--lux-surface-alt)", border: "1px solid var(--lux-border)" }}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold" style={{ color: "var(--lux-text-secondary)" }}>Field Mapping Preview</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-semibold">Auto-detected</span>
        </div>
        {[
          { src: "Client Name", dest: "Client → Name" },
          { src: "Invoice #", dest: "Invoice → Number" },
          { src: "Amount Due", dest: "Invoice → Total" },
          { src: "Due Date", dest: "Invoice → Due Date" },
        ].map((m, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="flex-1 h-8 rounded px-3 flex items-center text-xs" style={{ background: "var(--lux-bg-muted)", border: "1px solid var(--lux-border)" }}>{m.src}</div>
            <span className="text-xs" style={{ color: "var(--lux-text-muted)" }}>→</span>
            <div className="flex-1 h-8 rounded px-3 flex items-center text-xs" style={{ background: "var(--lux-bg-muted)", border: "1px solid var(--lux-border)" }}>{m.dest}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export const importBenefits = [
  "Migrate from FreshBooks, QuickBooks, or CSV in minutes",
  "Intelligent field mapping auto-detects your data format",
  "Dry-run preview validates records before committing",
];
