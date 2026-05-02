export function IntegrationsPreview() {
  return (
    <div className="w-full space-y-4 p-6" style={{ color: "var(--lux-text)" }}>
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="h-5 w-48 rounded" style={{ background: "var(--lux-text)", opacity: 0.15 }} />
          <div className="h-3 w-60 rounded" style={{ background: "var(--lux-text)", opacity: 0.08 }} />
        </div>
        <div className="h-9 w-28 rounded-lg" style={{ background: "var(--gradient-brand)", opacity: 0.6 }} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl p-4 space-y-3" style={{ background: "var(--lux-surface-alt)", border: "1px solid var(--lux-border)" }}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-secondary)" }}>API Key</span>
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">Active</span>
          </div>
          <div className="h-9 rounded-lg px-3 flex items-center gap-2 font-mono text-xs" style={{ background: "var(--lux-bg-muted)", border: "1px solid var(--lux-border)" }}>
            <span>cwpro_sk_••••••••••••a4f8</span>
          </div>
          <p className="text-[10px]" style={{ color: "var(--lux-text-muted)" }}>Last used 2 hours ago · 1,247 requests today</p>
        </div>
        <div className="rounded-xl p-4 space-y-3" style={{ background: "var(--lux-surface-alt)", border: "1px solid var(--lux-border)" }}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-secondary)" }}>Webhooks</span>
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">3 Active</span>
          </div>
          {[
            { event: "invoice.paid", url: "https://hooks.slack.com/..." },
            { event: "time_entry.submitted", url: "https://api.zapier.com/..." },
            { event: "client.created", url: "https://n8n.example.com/..." },
          ].map((w, i) => (
            <div key={i} className="flex items-center justify-between">
              <span className="text-[10px] font-mono" style={{ color: "var(--lux-text-muted)" }}>{w.event}</span>
              <span className="text-[9px] truncate max-w-[120px]" style={{ color: "var(--lux-text-muted)" }}>{w.url}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--lux-border)" }}>
        <div className="px-4 py-3" style={{ background: "var(--lux-surface-alt)" }}>
          <span className="text-xs font-semibold" style={{ color: "var(--lux-text-secondary)" }}>Available Integrations</span>
        </div>
        <div className="grid grid-cols-4 gap-px" style={{ background: "var(--lux-border)" }}>
          {[
            { name: "Slack", icon: "💬", status: "Connect" },
            { name: "Zapier", icon: "⚡", status: "Connected" },
            { name: "Google Sheets", icon: "📊", status: "Connect" },
            { name: "Stripe", icon: "💳", status: "Connected" },
            { name: "QuickBooks", icon: "📘", status: "Connect" },
            { name: "Xero", icon: "📗", status: "Connect" },
            { name: "HubSpot", icon: "🟠", status: "Connect" },
            { name: "Salesforce", icon: "☁️", status: "Connect" },
          ].map((int, i) => (
            <div key={i} className="p-3 flex items-center gap-2" style={{ background: "var(--lux-surface)" }}>
              <span className="text-lg">{int.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{int.name}</p>
                <p className="text-[9px]" style={{ color: int.status === "Connected" ? "#22c55e" : "var(--lux-text-muted)" }}>{int.status}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export const integrationsBenefits = [
  "REST API with full read/write access to all your data",
  "Real-time webhooks for invoice, time entry, and client events",
  "Connect Slack, Zapier, Google Sheets, and 20+ integrations",
];
