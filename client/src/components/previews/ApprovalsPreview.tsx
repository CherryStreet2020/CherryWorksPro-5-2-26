export function ApprovalsPreview() {
  return (
    <div className="w-full space-y-4 p-6" style={{ color: "var(--lux-text)" }}>
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="h-5 w-40 rounded" style={{ background: "var(--lux-text)", opacity: 0.15 }} />
          <div className="h-3 w-56 rounded" style={{ background: "var(--lux-text)", opacity: 0.08 }} />
        </div>
        <div className="flex gap-2">
          <div className="h-8 px-3 rounded-lg flex items-center text-[10px] font-semibold" style={{ background: "rgba(245,158,11,0.1)", color: "#f59e0b" }}>4 Pending</div>
          <div className="h-8 px-3 rounded-lg flex items-center text-[10px] font-semibold" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e" }}>12 Approved</div>
        </div>
      </div>

      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--lux-border)" }}>
        <div className="px-4 py-3 grid grid-cols-5 gap-2 text-[10px] font-semibold uppercase tracking-wider" style={{ background: "var(--lux-surface-alt)", color: "var(--lux-text-muted)" }}>
          <span>Team Member</span>
          <span>Week</span>
          <span className="text-right">Hours</span>
          <span className="text-right">Amount</span>
          <span className="text-right">Status</span>
        </div>
        {[
          { name: "Sarah Chen", week: "Apr 7–13", hours: "42.5", amount: "$6,375.00", status: "Pending" },
          { name: "Marcus Rivera", week: "Apr 7–13", hours: "38.0", amount: "$5,700.00", status: "Pending" },
          { name: "Emily Watson", week: "Apr 7–13", hours: "40.0", amount: "$6,000.00", status: "Pending" },
          { name: "James Park", week: "Apr 7–13", hours: "36.5", amount: "$5,475.00", status: "Pending" },
          { name: "Sarah Chen", week: "Mar 31–Apr 6", hours: "40.0", amount: "$6,000.00", status: "Approved" },
          { name: "Marcus Rivera", week: "Mar 31–Apr 6", hours: "41.0", amount: "$6,150.00", status: "Approved" },
        ].map((r, i) => (
          <div key={i} className="px-4 py-3 grid grid-cols-5 gap-2 items-center" style={{ borderTop: "1px solid var(--lux-border)" }}>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold" style={{ background: "var(--lux-surface-alt)", color: "var(--lux-text-muted)" }}>
                {r.name.split(" ").map(n => n[0]).join("")}
              </div>
              <span className="text-xs font-medium truncate">{r.name}</span>
            </div>
            <span className="text-xs" style={{ color: "var(--lux-text-muted)" }}>{r.week}</span>
            <span className="text-xs text-right tabular-nums">{r.hours}h</span>
            <span className="text-xs text-right tabular-nums font-medium">{r.amount}</span>
            <div className="flex justify-end">
              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full" style={{
                background: r.status === "Approved" ? "rgba(34,197,94,0.1)" : "rgba(245,158,11,0.1)",
                color: r.status === "Approved" ? "#22c55e" : "#f59e0b",
              }}>{r.status}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export const approvalsBenefits = [
  "Review and approve team member timesheets before invoicing",
  "Bulk approve or reject with one click across all team members",
  "Full approval history with timestamps and manager notes",
];
