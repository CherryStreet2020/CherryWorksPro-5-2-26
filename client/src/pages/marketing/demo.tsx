import { useEffect, useRef } from "react";
import { Link } from "wouter";
import { ArrowRight, ArrowDown, Check, TrendingUp, Clock, FileText, Receipt, ScanLine, BarChart3, BookOpen, Landmark, Link2, DollarSign, CreditCard, Webhook, Key, Shield, Zap, Building2, Globe, ClipboardCheck, Users, Send, Upload, Sparkles, Gauge, MessageSquare, Bot, X, Download, Database } from "lucide-react";
import { SEO } from "@/components/seo";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { MarketingFooter } from "@/components/marketing/marketing-footer";

function useFadeIn() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { el.classList.add("fade-in-visible"); obs.disconnect(); } }, { threshold: 0.12 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return ref;
}

function GlassCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl overflow-hidden ${className}`} style={{ background: "rgba(30,41,60,1)", backdropFilter: "blur(20px)", border: "1px solid rgba(100,116,139,0.4)", boxShadow: "0 25px 80px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1)" }}>
      {children}
    </div>
  );
}

function MockupChrome({ url, children }: { url: string; children: React.ReactNode }) {
  return (
    <GlassCard>
      <div className="flex items-center px-4 py-2" style={{ background: "rgba(7,13,24,0.9)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex gap-1.5 mr-4">
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: "#ff5f57" }} />
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: "#febc2e" }} />
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: "#28c840" }} />
        </div>
        <div className="flex-1 flex justify-center">
          <span className="text-[11px] px-6 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.25)", border: "1px solid rgba(255,255,255,0.04)" }}>{url}</span>
        </div>
      </div>
      <div className="p-5 md:p-6" style={{ background: "#0f172a" }}>{children}</div>
    </GlassCard>
  );
}

function SectionBadge({ num, color }: { num: string; color: string }) {
  return (
    <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold mb-4" style={{ background: `${color}15`, color, border: `1px solid ${color}30` }}>
      {num}
    </div>
  );
}

function SectionCTA({ text = "Try it free", href = "/signup" }: { text?: string; href?: string }) {
  return (
    <div className="mt-8 text-center">
      <Link href={href}>
        <span className="inline-flex items-center gap-2 px-6 py-3 text-sm font-bold text-white rounded-xl cursor-pointer transition-all hover:scale-[1.03]" style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)", boxShadow: "0 4px 20px rgba(207,51,57,0.3)" }} data-testid={`cta-section-${text.toLowerCase().replace(/\s+/g, "-")}`}>
          {text} <ArrowRight className="w-4 h-4" />
        </span>
      </Link>
    </div>
  );
}

function DashboardSection() {
  const ref = useFadeIn();
  const kpis = [
    { label: "Revenue MTD", value: "$47,850", change: "+12.3%", positive: true, color: "#22c55e" },
    { label: "Collected", value: "$38,200", change: "+8.7%", positive: true, color: "#3b82f6" },
    { label: "Outstanding", value: "$12,650", change: "3 invoices", positive: false, color: "#f59e0b" },
    { label: "Utilization", value: "91%", change: "+4.2%", positive: true, color: "#a855f7" },
  ];
  const chartBars = [
    { month: "Oct", invoiced: 65, collected: 58 },
    { month: "Nov", invoiced: 72, collected: 65 },
    { month: "Dec", invoiced: 58, collected: 52 },
    { month: "Jan", invoiced: 80, collected: 70 },
    { month: "Feb", invoiced: 85, collected: 78 },
    { month: "Mar", invoiced: 92, collected: 82 },
  ];
  const team = [
    { name: "AM", pct: 95, color: "#22c55e" },
    { name: "JS", pct: 88, color: "#3b82f6" },
    { name: "RT", pct: 92, color: "#a855f7" },
    { name: "CN", pct: 78, color: "#f59e0b" },
    { name: "MP", pct: 84, color: "#ec4899" },
  ];
  return (
    <section className="pt-4 md:pt-8 pb-8 md:pb-12" style={{ background: "#0a0f1c" }}>
      <div ref={ref} className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 fade-in-section">
        <SectionBadge num="04" color="#22c55e" />
        <h2 className="text-3xl md:text-4xl font-bold text-white mb-3" data-testid="demo-section-dashboard">Smart Dashboard</h2>
        <p className="text-lg mb-10" style={{ color: "rgba(255,255,255,0.5)" }}>Your entire business at a glance. Real-time KPIs, revenue trends, and team utilization.</p>
        <MockupChrome url="cherryworkspro.com/dashboard">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {kpis.map((k, i) => (
              <div key={i} className="rounded-xl p-3.5" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
                <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "rgba(255,255,255,0.65)" }}>{k.label}</p>
                <p className="text-xl font-bold text-white">{k.value}</p>
                <div className="flex items-center gap-1 mt-1">
                  {k.positive && <TrendingUp className="w-3 h-3" style={{ color: k.color }} />}
                  <span className="text-[11px] font-semibold" style={{ color: k.color }}>{k.change}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 rounded-xl p-4" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
              <p className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: "rgba(255,255,255,0.5)" }}>Revenue Trend (6 months)</p>
              <div className="flex items-end gap-2 h-28">
                {chartBars.map((b, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                    <div className="w-full flex gap-0.5 items-end" style={{ height: "100px" }}>
                      <div className="flex-1 rounded-t" style={{ height: `${b.invoiced}%`, background: "rgba(59,130,246,0.3)", border: "1px solid rgba(59,130,246,0.4)" }} />
                      <div className="flex-1 rounded-t" style={{ height: `${b.collected}%`, background: "rgba(34,197,94,0.3)", border: "1px solid rgba(34,197,94,0.4)" }} />
                    </div>
                    <span className="text-[9px] font-bold" style={{ color: "rgba(255,255,255,0.5)" }}>{b.month}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-4 mt-3">
                <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded" style={{ background: "rgba(59,130,246,0.5)" }} /><span className="text-[10px]" style={{ color: "rgba(255,255,255,0.5)" }}>Invoiced</span></div>
                <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded" style={{ background: "rgba(34,197,94,0.5)" }} /><span className="text-[10px]" style={{ color: "rgba(255,255,255,0.5)" }}>Collected</span></div>
              </div>
            </div>
            <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
              <p className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: "rgba(255,255,255,0.5)" }}>Team Utilization</p>
              <div className="space-y-2.5">
                {team.map((t, i) => (
                  <div key={i}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white" style={{ background: `${t.color}30` }}>{t.name}</div>
                      <span className="text-[11px] font-bold" style={{ color: t.color }}>{t.pct}%</span>
                    </div>
                    <div className="w-full h-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.12)" }}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${t.pct}%`, background: t.color }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </MockupChrome>
        <SectionCTA text="Try the Dashboard" />
      </div>
    </section>
  );
}

function TimeTrackingSection() {
  const ref = useFadeIn();
  const rows = [
    { name: "A. Morgan", proj: "Client Alpha", svc: "UX Design", hours: [8, 7.5, 8, 6, 8, 4, 0], color: "#22c55e" },
    { name: "J. Smith", proj: "Client Alpha", svc: "Development", hours: [8, 8, 7, 8, 8, 3, 0], color: "#3b82f6" },
    { name: "R. Torres", proj: "Project Beta", svc: "Backend API", hours: [6, 8, 8, 8, 6, 4, 0], color: "#a855f7" },
    { name: "M. Patel", proj: "Project Beta", svc: "QA Testing", hours: [4, 3, 4, 3.5, 4, 0, 0], color: "#ec4899" },
    { name: "C. Nakamura", proj: "Project Gamma", svc: "Consulting", hours: [8, 8, 6, 4, 8, 2, 0], color: "#f59e0b" },
  ];
  return (
    <section className="py-8 md:py-12" style={{ background: "#0a0f1c" }}>
      <div ref={ref} className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 fade-in-section">
        <SectionBadge num="01" color="#8b5cf6" />
        <h2 className="text-3xl md:text-4xl font-bold text-white mb-3" data-testid="demo-section-time">Time Tracking</h2>
        <p className="text-lg mb-10" style={{ color: "rgba(255,255,255,0.5)" }}>Week, month, and day views. Floating timer. One-click cell entry. Every hour accounted for.</p>
        <MockupChrome url="cherryworkspro.com/time">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm font-bold text-white">Weekly Timesheet</p>
              <p className="text-[11px] mt-0.5" style={{ color: "rgba(255,255,255,0.5)" }}>Mar 23 – Mar 29, 2026</p>
            </div>
            <div className="flex items-center gap-2">
              {["Week", "Month", "Day"].map((v, i) => (
                <span key={i} className="text-[11px] px-2 py-1 rounded-lg" style={{ background: i === 0 ? "rgba(207,51,57,0.15)" : "transparent", color: i === 0 ? "#f87171" : "rgba(255,255,255,0.5)" }}>{v}</span>
              ))}
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg ml-2" style={{ background: "rgba(207,51,57,0.12)", border: "1px solid rgba(207,51,57,0.2)", boxShadow: "0 0 12px rgba(207,51,57,0.15)" }}>
                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-[11px] font-bold" style={{ color: "#f87171" }}>2:34:15</span>
              </div>
            </div>
          </div>
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.12)" }}>
            <div className="grid grid-cols-[1fr_0.8fr_0.7fr_repeat(7,0.5fr)_0.6fr] gap-0.5 text-center px-3 py-2" style={{ background: "rgba(255,255,255,0.10)" }}>
              {["MEMBER", "PROJECT", "SERVICE", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "TOTAL"].map(d => (
                <span key={d} className="text-[9px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.5)" }}>{d}</span>
              ))}
            </div>
            {rows.map((r, ri) => {
              const total = r.hours.reduce((a, b) => a + b, 0);
              return (
                <div key={ri} className="grid grid-cols-[1fr_0.8fr_0.7fr_repeat(7,0.5fr)_0.6fr] gap-0.5 items-center px-3 py-2" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                  <span className="text-[11px] font-medium text-white truncate">{r.name}</span>
                  <span className="text-[11px] font-medium truncate" style={{ color: r.color }}>{r.proj}</span>
                  <span className="text-[10px] truncate" style={{ color: "rgba(255,255,255,0.5)" }}>{r.svc}</span>
                  {r.hours.map((h, ci) => (
                    <span key={ci} className="text-[11px] text-center font-medium" style={{ color: h > 0 ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.15)" }}>{h > 0 ? h : "—"}</span>
                  ))}
                  <span className="text-[11px] text-center font-bold" style={{ color: "#22c55e" }}>{total}h</span>
                </div>
              );
            })}
            <div className="grid grid-cols-[1fr_0.8fr_0.7fr_repeat(7,0.5fr)_0.6fr] gap-0.5 items-center px-3 py-2" style={{ background: "rgba(255,255,255,0.08)", borderTop: "2px solid rgba(255,255,255,0.12)" }}>
              <span className="text-[11px] font-bold text-white col-span-3">DAILY TOTAL</span>
              {[34, 34.5, 33, 29.5, 34, 13, 0].map((d, i) => (
                <span key={i} className="text-[11px] text-center font-bold" style={{ color: d >= 30 ? "#22c55e" : d > 0 ? "#f59e0b" : "rgba(255,255,255,0.15)" }}>{d || "—"}</span>
              ))}
              <span className="text-[11px] text-center font-bold" style={{ color: "#22c55e" }}>178h</span>
            </div>
          </div>
          <div className="flex items-center justify-between mt-3">
            <div className="flex items-center gap-2">
              <span className="text-[11px] px-2.5 py-1 rounded-lg font-semibold" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e" }}>173h billable</span>
              <span className="text-[11px] px-2.5 py-1 rounded-lg font-semibold" style={{ background: "rgba(107,114,128,0.1)", color: "#9ca3af" }}>5h internal</span>
            </div>
            <button className="text-[11px] px-4 py-1.5 rounded-lg font-bold" style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.2)" }}>Approve All</button>
          </div>
        </MockupChrome>
        <SectionCTA text="Try Time Tracking" />
      </div>
    </section>
  );
}

function InvoicingSection() {
  const ref = useFadeIn();
  const lines = [
    { desc: "Consulting — Strategy", hrs: "40", rate: "$150.00", amt: "$6,000.00" },
    { desc: "Development — Frontend", hrs: "20", rate: "$175.00", amt: "$3,500.00" },
    { desc: "QA & Testing", hrs: "12", rate: "$125.00", amt: "$1,500.00" },
    { desc: "Project Management", hrs: "8", rate: "$160.00", amt: "$1,280.00" },
  ];
  const subtotal = 12280;
  const tax = subtotal * 0.08;
  const total = subtotal + tax;
  return (
    <section className="py-8 md:py-12" style={{ background: "#0a0f1c" }}>
      <div ref={ref} className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 fade-in-section">
        <SectionBadge num="02" color="#eab308" />
        <h2 className="text-3xl md:text-4xl font-bold text-white mb-3" data-testid="demo-section-invoicing">Invoicing</h2>
        <p className="text-lg mb-10" style={{ color: "rgba(255,255,255,0.5)" }}>From billable hours to cash collected. Multi-currency, Stripe integration, PDF export.</p>
        <MockupChrome url="cherryworkspro.com/invoices/CW-2026-048">
          <div className="relative">
            <div className="absolute top-4 right-4 z-10 px-5 py-2 rounded-lg text-sm font-black uppercase tracking-wider" style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e", border: "2px solid rgba(34,197,94,0.3)", transform: "rotate(12deg)", boxShadow: "0 4px 20px rgba(34,197,94,0.15)" }}>PAID</div>
            <div className="flex items-start justify-between mb-6">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-6 h-6 rounded flex items-center justify-center" style={{ background: "#cf3339" }}>
                    <span className="text-[10px] font-black text-white">CW</span>
                  </div>
                  <span className="text-sm font-bold text-white">CherryWorks Pro</span>
                </div>
                <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.5)" }}>Invoice #CW-2026-048</p>
                <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.5)" }}>Date: March 29, 2026</p>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-semibold text-white">Bill To:</p>
                <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.65)" }}>Client Account #4821</p>
                <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.65)" }}>Due: April 28, 2026</p>
              </div>
            </div>
            <div className="rounded-lg overflow-hidden mb-4" style={{ border: "1px solid rgba(255,255,255,0.12)" }}>
              <div className="grid grid-cols-4 px-3 py-2" style={{ background: "rgba(255,255,255,0.10)" }}>
                {["Description", "Hours", "Rate", "Amount"].map(h => (
                  <span key={h} className="text-[10px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.5)" }}>{h}</span>
                ))}
              </div>
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-4 px-3 py-2" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                  <span className="text-[12px] text-white">{l.desc}</span>
                  <span className="text-[12px] font-mono" style={{ color: "rgba(255,255,255,0.6)" }}>{l.hrs}</span>
                  <span className="text-[12px] font-mono" style={{ color: "rgba(255,255,255,0.6)" }}>{l.rate}</span>
                  <span className="text-[12px] font-mono font-semibold text-white">{l.amt}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-end">
              <div className="w-56 space-y-1.5">
                <div className="flex justify-between text-[12px]"><span style={{ color: "rgba(255,255,255,0.65)" }}>Subtotal</span><span className="text-white font-mono">${subtotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span></div>
                <div className="flex justify-between text-[12px]"><span style={{ color: "rgba(255,255,255,0.65)" }}>Tax (8%)</span><span className="text-white font-mono">${tax.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span></div>
                <div className="flex justify-between text-sm font-bold pt-1.5" style={{ borderTop: "2px solid rgba(255,255,255,0.1)" }}><span className="text-white">Total</span><span style={{ color: "#22c55e" }}>${total.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span></div>
              </div>
            </div>
          </div>
        </MockupChrome>
        <SectionCTA text="Try Invoicing" />
      </div>
    </section>
  );
}

function ExpenseSection() {
  const ref = useFadeIn();
  const expenses = [
    { vendor: "JetBlue Airways", category: "Travel", amount: "$1,245.00", status: "Approved", statusColor: "#22c55e", catColor: "#3b82f6" },
    { vendor: "Adobe Creative Cloud", category: "Software", amount: "$899.00", status: "Approved", statusColor: "#22c55e", catColor: "#8b5cf6" },
    { vendor: "Conference Room Rental", category: "Office", amount: "$475.00", status: "Pending", statusColor: "#f59e0b", catColor: "#06b6d4" },
    { vendor: "Client Dinner", category: "Meals", amount: "$328.50", status: "Pending", statusColor: "#f59e0b", catColor: "#f97316" },
    { vendor: "Office Supplies", category: "Office", amount: "$185.00", status: "Approved", statusColor: "#22c55e", catColor: "#06b6d4" },
  ];
  const categories = [
    { name: "Travel", pct: 40, color: "#3b82f6" },
    { name: "Software", pct: 28, color: "#8b5cf6" },
    { name: "Office", pct: 20, color: "#06b6d4" },
    { name: "Meals", pct: 12, color: "#f97316" },
  ];
  return (
    <section className="py-8 md:py-12" style={{ background: "#0d1321" }}>
      <div ref={ref} className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 fade-in-section">
        <SectionBadge num="09" color="#f97316" />
        <h2 className="text-3xl md:text-4xl font-bold text-white mb-3" data-testid="demo-section-expenses">Expense Management</h2>
        <p className="text-lg mb-10" style={{ color: "rgba(255,255,255,0.5)" }}>Upload receipts, categorize, submit for approval, and track reimbursements.</p>
        <MockupChrome url="cherryworkspro.com/expenses">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <p className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: "rgba(255,255,255,0.5)" }}>Recent Expenses</p>
              <div className="space-y-2">
                {expenses.map((e, i) => (
                  <div key={i} className="rounded-xl px-4 py-3 flex items-center justify-between" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${e.catColor}15` }}>
                        <Receipt className="w-4 h-4" style={{ color: e.catColor }} />
                      </div>
                      <div>
                        <p className="text-[12px] font-semibold text-white">{e.vendor}</p>
                        <p className="text-[10px]" style={{ color: e.catColor }}>{e.category}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[12px] font-bold font-mono text-white">{e.amount}</span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${e.statusColor}12`, color: e.statusColor }}>{e.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: "rgba(255,255,255,0.5)" }}>By Category</p>
              <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
                <div className="flex h-4 rounded-full overflow-hidden mb-4">
                  {categories.map((c, i) => (
                    <div key={i} style={{ width: `${c.pct}%`, background: c.color }} />
                  ))}
                </div>
                <div className="space-y-2">
                  {categories.map((c, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded" style={{ background: c.color }} />
                        <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.8)" }}>{c.name}</span>
                      </div>
                      <span className="text-[11px] font-bold" style={{ color: c.color }}>{c.pct}%</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl p-4 mt-3" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
                <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "rgba(255,255,255,0.5)" }}>Total This Month</p>
                <p className="text-xl font-bold text-white">$3,132.50</p>
                <p className="text-[10px] mt-0.5" style={{ color: "#22c55e" }}>3 approved · 2 pending</p>
              </div>
            </div>
          </div>
        </MockupChrome>
        <SectionCTA text="Try Expense Tracking" />
      </div>
    </section>
  );
}

function AIReceiptSection() {
  const ref = useFadeIn();
  const fields = [
    { label: "Vendor", value: "The Capital Grille", confidence: "99%" },
    { label: "Date", value: "March 18, 2026 · 7:42 PM", confidence: "99%" },
    { label: "Category", value: "Meals & Entertainment", confidence: "97%" },
    { label: "Amount (Total)", value: "$168.28", confidence: "99%" },
    { label: "Tax", value: "$11.08", confidence: "98%" },
    { label: "Payment Method", value: "Corporate Amex ****3019", confidence: "96%" },
  ];
  return (
    <section className="py-8 md:py-12" style={{ background: "#0d1321" }}>
      <div ref={ref} className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 fade-in-section">
        <SectionBadge num="10" color="#ec4899" />
        <h2 className="text-3xl md:text-4xl font-bold text-white mb-3" data-testid="demo-section-ai-receipt">AI Receipt Scanner</h2>
        <p className="text-lg mb-10" style={{ color: "rgba(255,255,255,0.5)" }}>Upload a receipt photo or PDF. AI extracts every field instantly.</p>
        <MockupChrome url="cherryworkspro.com/expenses/new">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="rounded-xl p-6 flex flex-col items-center justify-center" style={{ background: "rgba(255,255,255,0.08)", border: "2px dashed rgba(255,255,255,0.1)", minHeight: "340px" }}>
              <div className="w-full max-w-[220px] px-5 pt-4 pb-0 mb-3 font-mono relative" style={{ background: "#faf9f6", boxShadow: "0 8px 30px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)", transform: "rotate(-1.5deg)" }}>
                <div className="text-center mb-2">
                  <p className="text-[11px] font-bold tracking-[2px]" style={{ color: "#1a1a1a" }}>THE CAPITAL GRILLE</p>
                  <p className="text-[8px] mt-0.5" style={{ color: "#6b6b6b" }}>155 E 42nd St, New York, NY</p>
                  <p className="text-[8px]" style={{ color: "#6b6b6b" }}>(212) 953-2000</p>
                </div>
                <div className="my-1.5" style={{ borderTop: "1px dashed #c0b8a8" }} />
                <div className="flex justify-between text-[8px] mb-1" style={{ color: "#555" }}><span>03/18/2026  7:42 PM</span></div>
                <div className="flex justify-between text-[8px] mb-1" style={{ color: "#555" }}><span>Server: Michelle R.</span><span>Table 14</span></div>
                <div className="my-1.5" style={{ borderTop: "1px dashed #c0b8a8" }} />
                <div className="space-y-0.5">
                  {[
                    { item: "1 Wagyu Filet 8oz", price: "$62.00" },
                    { item: "1 Lobster Mac & Cheese", price: "$28.00" },
                    { item: "1 Caesar Salad", price: "$16.00" },
                    { item: "2 Cab Sauv (glass)", price: "$34.00" },
                    { item: "1 Sparkling Water", price: "$8.00" },
                  ].map((line, li) => (
                    <div key={li} className="flex justify-between text-[8px]" style={{ color: "#333" }}>
                      <span>{line.item}</span><span>{line.price}</span>
                    </div>
                  ))}
                </div>
                <div className="my-1.5" style={{ borderTop: "1px dashed #c0b8a8" }} />
                <div className="flex justify-between text-[8px]" style={{ color: "#555" }}><span>Subtotal</span><span>$148.00</span></div>
                <div className="flex justify-between text-[8px]" style={{ color: "#555" }}><span>Tax 7.5%</span><span>$11.08</span></div>
                <div className="flex justify-between text-[8px]" style={{ color: "#555" }}><span>Tip</span><span>$9.20</span></div>
                <div className="my-1.5" style={{ borderTop: "1px dashed #c0b8a8" }} />
                <div className="flex justify-between text-[9px] font-bold" style={{ color: "#111" }}><span>TOTAL</span><span>$168.28</span></div>
                <div className="mt-1.5 text-center pb-3">
                  <p className="text-[7px]" style={{ color: "#888" }}>AMEX ****3019</p>
                  <p className="text-[7px] mt-0.5" style={{ color: "#999" }}>THANK YOU FOR DINING WITH US</p>
                </div>
                <div className="w-full h-3 -mb-px" style={{ background: "linear-gradient(180deg, #faf9f6 0%, #f0ede6 100%)", clipPath: "polygon(0% 0%, 4% 100%, 8% 0%, 12% 100%, 16% 0%, 20% 100%, 24% 0%, 28% 100%, 32% 0%, 36% 100%, 40% 0%, 44% 100%, 48% 0%, 52% 100%, 56% 0%, 60% 100%, 64% 0%, 68% 100%, 72% 0%, 76% 100%, 80% 0%, 84% 100%, 88% 0%, 92% 100%, 96% 0%, 100% 100%)" }} />
              </div>
              <p className="text-[10px] font-semibold" style={{ color: "rgba(255,255,255,0.5)" }}>Uploaded Receipt</p>
            </div>
            <div>
              <div className="flex items-center justify-between mb-4">
                <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.5)" }}>AI-Extracted Data</p>
                <span className="text-[10px] font-bold px-3 py-1 rounded-full" style={{ background: "rgba(236,72,153,0.12)", color: "#ec4899", border: "1px solid rgba(236,72,153,0.2)" }}>98% Confidence</span>
              </div>
              <div className="space-y-2">
                {fields.map((f, i) => (
                  <div key={i} className="rounded-xl px-4 py-3 flex items-center justify-between" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.5)" }}>{f.label}</p>
                      <p className="text-[13px] font-semibold text-white mt-0.5">{f.value}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5" style={{ color: "#22c55e" }} />
                      <span className="text-[10px] font-bold" style={{ color: "#22c55e" }}>{f.confidence}</span>
                    </div>
                  </div>
                ))}
              </div>
              <button className="w-full mt-4 py-2.5 rounded-xl text-[12px] font-bold" style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.2)" }}>Save & Attach to Expense</button>
            </div>
          </div>
        </MockupChrome>
        <SectionCTA text="Try AI Receipt Scanner" />
      </div>
    </section>
  );
}

function ReportsSection() {
  const ref = useFadeIn();
  const chartBars = [
    { month: "Oct", invoiced: 65, collected: 58 },
    { month: "Nov", invoiced: 72, collected: 65 },
    { month: "Dec", invoiced: 58, collected: 52 },
    { month: "Jan", invoiced: 80, collected: 70 },
    { month: "Feb", invoiced: 85, collected: 78 },
    { month: "Mar", invoiced: 92, collected: 82 },
  ];
  const topReports = [
    { icon: FileText, name: "AR Aging Report", color: "#3b82f6" },
    { icon: Users, name: "Utilization by Team", color: "#8b5cf6" },
    { icon: TrendingUp, name: "Project Profitability", color: "#22c55e" },
    { icon: DollarSign, name: "1099 Year-End Export", color: "#f59e0b" },
  ];
  const categories = [
    { name: "Financial", count: 4, color: "#22c55e" },
    { name: "Receivables", count: 3, color: "#3b82f6" },
    { name: "Operations", count: 3, color: "#8b5cf6" },
    { name: "Team", count: 3, color: "#f59e0b" },
    { name: "Payouts & Tax", count: 3, color: "#ef4444" },
    { name: "Expenses", count: 4, color: "#ec4899" },
  ];
  return (
    <section className="py-8 md:py-12" style={{ background: "#0a0f1c" }}>
      <div ref={ref} className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 fade-in-section">
        <SectionBadge num="03" color="#3b82f6" />
        <h2 className="text-3xl md:text-4xl font-bold text-white mb-3" data-testid="demo-section-reports">Reports Suite</h2>
        <p className="text-lg mb-10" style={{ color: "rgba(255,255,255,0.5)" }}>20+ built-in reports. Revenue, AR aging, utilization, profitability — export anything.</p>
        <MockupChrome url="cherryworkspro.com/reports">
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="text-sm font-bold text-white">Reports Library</p>
              <p className="text-[11px] mt-0.5" style={{ color: "rgba(255,255,255,0.5)" }}>6 categories · All exportable to PDF & CSV</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-black text-white">20</span>
              <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.5)" }}>Reports</span>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 space-y-4">
              <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
                <p className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: "rgba(255,255,255,0.5)" }}>Revenue by Month (6 months)</p>
                <div className="flex items-end gap-2 h-28">
                  {chartBars.map((b, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                      <div className="w-full flex gap-0.5 items-end" style={{ height: "100px" }}>
                        <div className="flex-1 rounded-t" style={{ height: `${b.invoiced}%`, background: "rgba(59,130,246,0.3)", border: "1px solid rgba(59,130,246,0.4)" }} />
                        <div className="flex-1 rounded-t" style={{ height: `${b.collected}%`, background: "rgba(34,197,94,0.3)", border: "1px solid rgba(34,197,94,0.4)" }} />
                      </div>
                      <span className="text-[9px] font-bold" style={{ color: "rgba(255,255,255,0.5)" }}>{b.month}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-4 mt-3">
                  <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded" style={{ background: "rgba(59,130,246,0.5)" }} /><span className="text-[10px]" style={{ color: "rgba(255,255,255,0.5)" }}>Invoiced</span></div>
                  <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded" style={{ background: "rgba(34,197,94,0.5)" }} /><span className="text-[10px]" style={{ color: "rgba(255,255,255,0.5)" }}>Collected</span></div>
                </div>
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: "rgba(255,255,255,0.5)" }}>Top Reports</p>
                <div className="space-y-2">
                  {topReports.map((r, i) => (
                    <div key={i} className="rounded-xl px-4 py-3 flex items-center justify-between" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
                      <div className="flex items-center gap-3">
                        <r.icon className="w-4 h-4" style={{ color: r.color }} />
                        <span className="text-[12px] font-semibold text-white">{r.name}</span>
                      </div>
                      <button className="text-[10px] font-bold px-3 py-1 rounded-lg" style={{ background: `${r.color}15`, color: r.color, border: `1px solid ${r.color}25` }}>Run</button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div>
              <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
                <p className="text-[11px] font-bold uppercase tracking-wider mb-4" style={{ color: "rgba(255,255,255,0.5)" }}>Report Categories</p>
                <div className="space-y-2.5">
                  {categories.map((cat, ci) => (
                    <div key={ci} className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: cat.color }} />
                        <span className="text-[12px] font-medium text-white">{cat.name}</span>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${cat.color}18`, color: cat.color, border: `1px solid ${cat.color}30` }}>{cat.count}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-5 pt-3" style={{ borderTop: "1px solid rgba(255,255,255,0.1)" }}>
                  <p className="text-[11px] font-semibold" style={{ color: "rgba(255,255,255,0.5)" }}>20 Reports · PDF & CSV Export</p>
                </div>
              </div>
            </div>
          </div>
        </MockupChrome>
        <SectionCTA text="Try Reports" />
      </div>
    </section>
  );
}

function GeneralLedgerSection() {
  const ref = useFadeIn();
  const entries = [
    { date: "Mar 01", account: "1000 — Cash", ref: "PMT-048", debit: "$12,450.00", credit: "—", balance: "$82,450.00" },
    { date: "Mar 01", account: "1200 — Accounts Receivable", ref: "PMT-048", debit: "—", credit: "$12,450.00", balance: "$23,891.00" },
    { date: "Mar 15", account: "4000 — Service Revenue", ref: "INV-053", debit: "—", credit: "$8,200.00", balance: "$47,850.00" },
    { date: "Mar 15", account: "1200 — Accounts Receivable", ref: "INV-053", debit: "$8,200.00", credit: "—", balance: "$32,091.00" },
    { date: "Mar 25", account: "5000 — Operating Expenses", ref: "EXP-031", debit: "$3,132.50", credit: "—", balance: "$18,432.50" },
    { date: "Mar 25", account: "1000 — Cash", ref: "EXP-031", debit: "—", credit: "$3,132.50", balance: "$79,317.50" },
  ];
  return (
    <section className="py-8 md:py-12" style={{ background: "#0d1321" }}>
      <div ref={ref} className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 fade-in-section">
        <SectionBadge num="13" color="#14b8a6" />
        <h2 className="text-3xl md:text-4xl font-bold text-white mb-3" data-testid="demo-section-gl">General Ledger</h2>
        <p className="text-lg mb-10" style={{ color: "rgba(255,255,255,0.5)" }}>Double-entry accounting that runs itself. Journal entries auto-post from financial events.</p>
        <MockupChrome url="cherryworkspro.com/accounting/general-ledger">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm font-bold text-white">Journal Entries</p>
              <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.5)" }}>March 2026</p>
            </div>
            <span className="text-[11px] font-bold px-3 py-1.5 rounded-lg" style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.2)" }}>Trial Balance: Balanced ✓</span>
          </div>
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.12)" }}>
            <div className="grid grid-cols-6 px-3 py-2" style={{ background: "rgba(255,255,255,0.10)" }}>
              {["Date", "Account", "Ref", "Debit", "Credit", "Balance"].map(h => (
                <span key={h} className="text-[9px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.5)" }}>{h}</span>
              ))}
            </div>
            {entries.map((e, i) => (
              <div key={i} className="grid grid-cols-6 px-3 py-2" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.65)" }}>{e.date}</span>
                <span className="text-[11px] font-medium text-white">{e.account}</span>
                <span className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.5)" }}>{e.ref}</span>
                <span className="text-[11px] font-mono" style={{ color: e.debit !== "—" ? "#22c55e" : "rgba(255,255,255,0.1)" }}>{e.debit}</span>
                <span className="text-[11px] font-mono" style={{ color: e.credit !== "—" ? "#ef4444" : "rgba(255,255,255,0.1)" }}>{e.credit}</span>
                <span className="text-[11px] font-mono font-semibold text-white">{e.balance}</span>
              </div>
            ))}
          </div>
        </MockupChrome>
        <SectionCTA text="Try General Ledger" />
      </div>
    </section>
  );
}

function BankReconciliationSection() {
  const ref = useFadeIn();
  const bankTxns = [
    { date: "Mar 08", desc: "Deposit — Wire Transfer", amount: "+$12,450.00", type: "deposit" },
    { date: "Mar 10", desc: "Deposit — ACH Payment", amount: "+$8,200.00", type: "deposit" },
    { date: "Mar 14", desc: "Withdrawal — Payout", amount: "-$6,300.00", type: "withdrawal" },
    { date: "Mar 18", desc: "Deposit — Stripe Checkout", amount: "+$6,800.00", type: "deposit" },
    { date: "Mar 22", desc: "Withdrawal — Expense Reimb.", amount: "-$1,245.00", type: "withdrawal" },
    { date: "Mar 25", desc: "Deposit — ACH Payment", amount: "+$3,950.00", type: "deposit" },
  ];
  const cwMatches = [
    { ref: "PMT-048", desc: "Payment — Invoice #CW-2026-048", amount: "$12,450.00", status: "auto", confidence: null },
    { ref: "PMT-053", desc: "Payment — Invoice #CW-2026-053", amount: "$8,200.00", status: "auto", confidence: null },
    { ref: "PAY-JS", desc: "Payout — J. Smith (1099)", amount: "$6,300.00", status: "auto", confidence: null },
    { ref: "PMT-057", desc: "Payment — Invoice #CW-2026-057", amount: "$6,800.00", status: "auto", confidence: null },
    { ref: "EXP-031", desc: "Expense Reimb. — A. Morgan", amount: "$1,245.00", status: "suggested", confidence: "94%" },
    { ref: "PMT-061", desc: "Payment — Invoice #CW-2026-061", amount: "$3,950.00", status: "auto", confidence: null },
  ];
  return (
    <section className="py-8 md:py-12" style={{ background: "#0a0f1c" }}>
      <div ref={ref} className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 fade-in-section">
        <SectionBadge num="14" color="#06b6d4" />
        <h2 className="text-3xl md:text-4xl font-bold text-white mb-3" data-testid="demo-section-bank-recon">Bank Reconciliation & Auto-Matching</h2>
        <p className="text-lg mb-10" style={{ color: "rgba(255,255,255,0.5)" }}>Import bank statements. AI auto-matches transactions to invoices, payments, and payouts.</p>
        <MockupChrome url="cherryworkspro.com/accounting/bank-reconciliation">
          <div className="rounded-xl p-3 mb-5 flex items-center justify-between flex-wrap gap-3" style={{ background: "rgba(6,182,212,0.06)", border: "1px solid rgba(6,182,212,0.15)" }}>
            <div className="flex items-center gap-3">
              <Landmark className="w-5 h-5" style={{ color: "#06b6d4" }} />
              <div>
                <p className="text-[12px] font-bold text-white">47 of 52 Transactions Auto-Matched</p>
                <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.65)" }}>March 2026 · Chase Business Checking ****8847</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-32 h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.15)" }}>
                <div className="h-full rounded-full" style={{ width: "90.4%", background: "linear-gradient(90deg, #06b6d4, #22c55e)" }} />
              </div>
              <span className="text-[12px] font-bold" style={{ color: "#22c55e" }}>90.4%</span>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Landmark className="w-3.5 h-3.5" style={{ color: "rgba(255,255,255,0.5)" }} />
                <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.5)" }}>Bank Transactions</p>
              </div>
              <div className="space-y-1.5">
                {bankTxns.map((t, i) => (
                  <div key={i} className="rounded-xl px-3.5 py-2.5 flex items-center justify-between" style={{ background: "rgba(255,255,255,0.08)", border: `1px solid ${cwMatches[i].status === "suggested" ? "rgba(245,158,11,0.2)" : "rgba(34,197,94,0.1)"}` }}>
                    <div className="flex items-center gap-2.5">
                      <div className="w-1.5 h-8 rounded-full" style={{ background: t.type === "deposit" ? "#22c55e" : "#ef4444" }} />
                      <div>
                        <p className="text-[11px] font-semibold text-white">{t.desc}</p>
                        <p className="text-[9px]" style={{ color: "rgba(255,255,255,0.5)" }}>{t.date}</p>
                      </div>
                    </div>
                    <span className="text-[12px] font-bold font-mono" style={{ color: t.type === "deposit" ? "#22c55e" : "#ef4444" }}>{t.amount}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Link2 className="w-3.5 h-3.5" style={{ color: "rgba(255,255,255,0.5)" }} />
                <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.5)" }}>CherryWorks Pro Matches</p>
              </div>
              <div className="space-y-1.5">
                {cwMatches.map((m, i) => (
                  <div key={i} className="rounded-xl px-3.5 py-2.5 flex items-center justify-between" style={{ background: "rgba(255,255,255,0.08)", border: `1px solid ${m.status === "suggested" ? "rgba(245,158,11,0.2)" : "rgba(34,197,94,0.1)"}` }}>
                    <div>
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[10px] font-mono font-bold" style={{ color: "rgba(255,255,255,0.65)" }}>{m.ref}</span>
                        {m.status === "auto" ? (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-1" style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e" }}>
                            <Check className="w-2.5 h-2.5" /> Auto-Matched
                          </span>
                        ) : (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(245,158,11,0.12)", color: "#f59e0b" }}>
                            Suggested · {m.confidence}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-white">{m.desc}</p>
                    </div>
                    <span className="text-[12px] font-bold font-mono text-white">{m.amount}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between mt-5 pt-4" style={{ borderTop: "1px solid rgba(255,255,255,0.12)" }}>
            <div className="flex items-center gap-3">
              <span className="text-[11px] px-2.5 py-1 rounded-lg font-semibold" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e" }}>5 Auto-Matched</span>
              <span className="text-[11px] px-2.5 py-1 rounded-lg font-semibold" style={{ background: "rgba(245,158,11,0.1)", color: "#f59e0b" }}>1 Suggested</span>
              <span className="text-[11px] px-2.5 py-1 rounded-lg font-semibold" style={{ background: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.65)" }}>5 Unmatched</span>
            </div>
            <button className="text-[12px] font-bold px-5 py-2 rounded-xl" style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)", color: "#fff", boxShadow: "0 4px 20px rgba(207,51,57,0.3)" }}>Reconcile All</button>
          </div>
        </MockupChrome>
        <SectionCTA text="Try Bank Reconciliation" />
      </div>
    </section>
  );
}

function TeamPayoutsSection() {
  const ref = useFadeIn();
  const payees = [
    { name: "A. Morgan", type: "1099", ytd: "$52,150.00", method: "ACH", methodColor: "#3b82f6", lastPaid: "Mar 28", status: "Ready", statusColor: "#22c55e" },
    { name: "J. Smith", type: "1099", ytd: "$47,400.00", method: "ACH", methodColor: "#3b82f6", lastPaid: "Mar 28", status: "Ready", statusColor: "#22c55e" },
    { name: "R. Torres", type: "C2C", ytd: "$58,200.00", method: "Wire", methodColor: "#22c55e", lastPaid: "Mar 25", status: "Ready", statusColor: "#22c55e" },
    { name: "M. Patel", type: "1099", ytd: "$32,800.00", method: "Zelle", methodColor: "#8b5cf6", lastPaid: "Mar 28", status: "Pending", statusColor: "#f59e0b" },
    { name: "C. Nakamura", type: "1099", ytd: "$54,200.00", method: "ACH", methodColor: "#3b82f6", lastPaid: "Mar 28", status: "Ready", statusColor: "#22c55e" },
    { name: "D. Reeves", type: "C2C", ytd: "$40,000.00", method: "Wire", methodColor: "#22c55e", lastPaid: "Mar 20", status: "Pending", statusColor: "#f59e0b" },
  ];
  return (
    <section className="py-8 md:py-12" style={{ background: "#0a0f1c" }}>
      <div ref={ref} className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 fade-in-section">
        <SectionBadge num="06" color="#f59e0b" />
        <h2 className="text-3xl md:text-4xl font-bold text-white mb-3" data-testid="demo-section-payouts">Team Payouts & 1099 Tracking</h2>
        <p className="text-lg mb-10" style={{ color: "rgba(255,255,255,0.5)" }}>Automatic payout creation, multi-rail payments, and year-end 1099 generation.</p>
        <MockupChrome url="cherryworkspro.com/payouts">
          <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
            <div>
              <p className="text-sm font-bold text-white">Team Payouts</p>
              <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.5)" }}>YTD Summary · Tax Year 2026</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5" style={{ background: "rgba(99,102,241,0.1)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.2)" }}>
                <CreditCard className="w-3 h-3" /> Stripe Connect
              </span>
              <div className="text-right">
                <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.5)" }}>Total YTD</p>
                <p className="text-lg font-bold" style={{ color: "#f59e0b" }}>$284,750</p>
              </div>
            </div>
          </div>
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.12)" }}>
            <div className="grid grid-cols-6 px-3 py-2" style={{ background: "rgba(255,255,255,0.10)" }}>
              {["Independent", "Type", "YTD Paid", "Method", "Last Paid", "1099 Status"].map(h => (
                <span key={h} className="text-[9px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.5)" }}>{h}</span>
              ))}
            </div>
            {payees.map((c, i) => (
              <div key={i} className="grid grid-cols-6 items-center px-3 py-2.5" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white" style={{ background: "rgba(255,255,255,0.15)" }}>{c.name.split(" ").map(n => n[0]).join("")}</div>
                  <span className="text-[12px] font-medium text-white">{c.name}</span>
                </div>
                <span className="text-[11px] px-2 py-0.5 rounded-full w-fit font-semibold" style={{ background: c.type === "1099" ? "rgba(245,158,11,0.1)" : "rgba(168,85,247,0.1)", color: c.type === "1099" ? "#f59e0b" : "#a855f7" }}>{c.type}</span>
                <span className="text-[12px] font-mono font-bold text-white">{c.ytd}</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full w-fit" style={{ background: `${c.methodColor}12`, color: c.methodColor }}>{c.method}</span>
                <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.65)" }}>{c.lastPaid}</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full w-fit" style={{ background: `${c.statusColor}12`, color: c.statusColor }}>{c.status}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between mt-4">
            <div className="flex items-center gap-2">
              <span className="text-[11px] px-2.5 py-1 rounded-lg font-semibold" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e" }}>4 Ready</span>
              <span className="text-[11px] px-2.5 py-1 rounded-lg font-semibold" style={{ background: "rgba(245,158,11,0.1)", color: "#f59e0b" }}>2 Pending</span>
            </div>
            <button className="text-[12px] font-bold px-5 py-2 rounded-xl flex items-center gap-2" style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)", color: "#fff", boxShadow: "0 4px 20px rgba(207,51,57,0.3)" }}>
              <FileText className="w-3.5 h-3.5" /> Generate 1099s
            </button>
          </div>
        </MockupChrome>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-8">
          {[
            { text: "Auto-created payouts when invoices are sent", color: "#22c55e" },
            { text: "ACH, Zelle, Wire, and Check payment rails", color: "#3b82f6" },
            { text: "1099-ready export with one click at year end", color: "#f59e0b" },
          ].map((h, i) => (
            <div key={i} className="flex items-start gap-2">
              <Check className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: h.color }} />
              <span className="text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>{h.text}</span>
            </div>
          ))}
        </div>
        <SectionCTA text="Try Team Payouts" />
      </div>
    </section>
  );
}

function StripePaymentsSection() {
  const ref = useFadeIn();
  return (
    <section className="py-8 md:py-12" style={{ background: "#0d1321" }}>
      <div ref={ref} className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 fade-in-section">
        <SectionBadge num="12" color="#7c3aed" />
        <h2 className="text-3xl md:text-4xl font-bold text-white mb-3" data-testid="demo-section-stripe">Stripe Payments & ACH</h2>
        <p className="text-lg mb-10" style={{ color: "rgba(255,255,255,0.5)" }}>Clients pay online via Stripe Checkout or ACH bank transfer. Instant reconciliation.</p>
        <MockupChrome url="cherryworkspro.com/pay/CW-2026-053">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <div className="rounded-xl p-5 mb-4" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.5)" }}>Invoice</p>
                    <p className="text-sm font-bold text-white">#CW-2026-053</p>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(245,158,11,0.12)", color: "#f59e0b" }}>Due Apr 15</span>
                </div>
                <div className="space-y-2 mb-4">
                  {[
                    { desc: "Strategy Consulting", amt: "$4,500.00" },
                    { desc: "Development Sprint", amt: "$3,200.00" },
                    { desc: "Project Management", amt: "$500.00" },
                  ].map((l, i) => (
                    <div key={i} className="flex justify-between text-[12px]">
                      <span style={{ color: "rgba(255,255,255,0.8)" }}>{l.desc}</span>
                      <span className="font-mono text-white">{l.amt}</span>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between text-sm font-bold pt-3" style={{ borderTop: "2px solid rgba(255,255,255,0.15)" }}>
                  <span className="text-white">Total Due</span>
                  <span style={{ color: "#f59e0b" }}>$8,200.00</span>
                </div>
              </div>
              <div className="space-y-2">
                <button className="w-full py-3 rounded-xl text-[13px] font-bold flex items-center justify-center gap-2" style={{ background: "linear-gradient(135deg, #635bff, #7c3aed)", color: "#fff", boxShadow: "0 4px 20px rgba(99,91,255,0.3)" }}>
                  <CreditCard className="w-4 h-4" /> Pay with Card — $8,200.00
                </button>
                <button className="w-full py-3 rounded-xl text-[13px] font-bold flex items-center justify-center gap-2" style={{ background: "rgba(34,197,94,0.08)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.2)" }}>
                  <Landmark className="w-4 h-4" /> Pay with ACH Bank Transfer
                </button>
                <div className="flex items-center justify-center gap-1.5 mt-1">
                  <span className="text-[10px] font-bold px-2.5 py-1 rounded-full" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e" }}>Save 2.5% vs Credit Card</span>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-4">
              <div className="rounded-xl p-5 flex-1" style={{ background: "rgba(99,91,255,0.04)", border: "1px solid rgba(99,91,255,0.12)" }}>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(99,91,255,0.15)" }}>
                    <Shield className="w-4 h-4" style={{ color: "#818cf8" }} />
                  </div>
                  <div>
                    <p className="text-[12px] font-bold text-white">Stripe Checkout</p>
                    <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.5)" }}>PCI-DSS Level 1 Certified</p>
                  </div>
                </div>
                <div className="space-y-2">
                  {["Visa, Mastercard, Amex, Discover", "Apple Pay & Google Pay", "ACH Direct Debit", "3D Secure Authentication"].map((f, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Check className="w-3 h-3" style={{ color: "#818cf8" }} />
                      <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.8)" }}>{f}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl p-5" style={{ background: "rgba(34,197,94,0.04)", border: "1px solid rgba(34,197,94,0.12)" }}>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "rgba(34,197,94,0.15)" }}>
                    <Check className="w-5 h-5" style={{ color: "#22c55e" }} />
                  </div>
                  <div>
                    <p className="text-[12px] font-bold text-white">Payment Confirmed</p>
                    <p className="text-[10px]" style={{ color: "#22c55e" }}>$8,200.00 received · Mar 15, 2026</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold px-2.5 py-1 rounded-full" style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e" }}>Auto-Posted to General Ledger</span>
                  <span className="text-[10px] font-bold px-2.5 py-1 rounded-full" style={{ background: "rgba(59,130,246,0.12)", color: "#3b82f6" }}>Invoice Marked Paid</span>
                </div>
              </div>
            </div>
          </div>
        </MockupChrome>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-8">
          {[
            { text: "Instant payment reconciliation — no manual matching", color: "#22c55e" },
            { text: "ACH saves clients 2.5% vs credit card fees", color: "#3b82f6" },
            { text: "Auto-posts journal entries to General Ledger", color: "#14b8a6" },
          ].map((h, i) => (
            <div key={i} className="flex items-start gap-2">
              <Check className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: h.color }} />
              <span className="text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>{h.text}</span>
            </div>
          ))}
        </div>
        <SectionCTA text="Try Stripe Payments" />
      </div>
    </section>
  );
}

function APIWebhooksSection() {
  const ref = useFadeIn();
  const events = [
    { event: "invoice.paid", source: "Stripe Webhook", time: "2 min ago", data: "INV-2026-053 · $8,200.00", color: "#22c55e" },
    { event: "timesheet.approved", source: "Internal", time: "18 min ago", data: "A. Morgan · Week Mar 23-29", color: "#3b82f6" },
    { event: "payment.received", source: "Stripe Webhook", time: "34 min ago", data: "PMT-061 · $3,950.00 · ACH", color: "#a855f7" },
    { event: "invoice.created", source: "Auto-Generated", time: "1 hr ago", data: "INV-2026-058 · $6,400.00", color: "#f59e0b" },
    { event: "expense.approved", source: "Internal", time: "2 hrs ago", data: "EXP-031 · $1,245.00 · Travel", color: "#ec4899" },
  ];
  const apiKeys = [
    { name: "Production API", prefix: "cwp_prod_****8f3a", status: "Active", lastUsed: "2 min ago" },
    { name: "Staging API", prefix: "cwp_stg_****2c91", status: "Active", lastUsed: "1 day ago" },
  ];
  const services = [
    { name: "Zapier", color: "#ff4a00" },
    { name: "Gusto", color: "#F45D48" },
    { name: "Slack", color: "#4a154b" },
  ];
  return (
    <section className="py-8 md:py-12" style={{ background: "#0a0f1c" }}>
      <div ref={ref} className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 fade-in-section">
        <SectionBadge num="19" color="#64748b" />
        <h2 className="text-3xl md:text-4xl font-bold text-white mb-3" data-testid="demo-section-api">API & Webhooks Integration Hub</h2>
        <p className="text-lg mb-10" style={{ color: "rgba(255,255,255,0.5)" }}>Connect CherryWorks Pro to any tool. REST API, webhook events, and Zapier-ready.</p>
        <MockupChrome url="cherryworkspro.com/settings/integrations">
          <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <Webhook className="w-5 h-5" style={{ color: "rgba(255,255,255,0.65)" }} />
              <p className="text-sm font-bold text-white">Integration Hub</p>
            </div>
            <span className="text-[10px] font-bold px-3 py-1 rounded-full" style={{ background: "rgba(168,85,247,0.12)", color: "#a855f7", border: "1px solid rgba(168,85,247,0.2)" }}>Professional Plan</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: "rgba(255,255,255,0.5)" }}>Webhook Event Log</p>
              <div className="space-y-1.5">
                {events.map((e, i) => (
                  <div key={i} className="rounded-xl px-3.5 py-2.5" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-mono font-bold" style={{ color: e.color }}>{e.event}</span>
                      <span className="text-[9px]" style={{ color: "rgba(255,255,255,0.5)" }}>{e.time}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.65)" }}>{e.data}</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e" }}>delivered</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: "rgba(255,255,255,0.5)" }}>API Keys</p>
                <div className="space-y-1.5">
                  {apiKeys.map((k, i) => (
                    <div key={i} className="rounded-xl px-3.5 py-2.5 flex items-center justify-between" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
                      <div className="flex items-center gap-2.5">
                        <Key className="w-3.5 h-3.5" style={{ color: "rgba(255,255,255,0.5)" }} />
                        <div>
                          <p className="text-[11px] font-semibold text-white">{k.name}</p>
                          <p className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.5)" }}>{k.prefix}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e" }}>{k.status}</span>
                        <p className="text-[9px] mt-0.5" style={{ color: "rgba(255,255,255,0.5)" }}>Used {k.lastUsed}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: "rgba(255,255,255,0.5)" }}>Connected Services</p>
                <div className="flex items-center gap-2">
                  {services.map((s, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
                      <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: `${s.color}20` }}>
                        <Zap className="w-3 h-3" style={{ color: s.color }} />
                      </div>
                      <span className="text-[11px] font-semibold text-white">{s.name}</span>
                      <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e" }}>Live</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
                <p className="text-[10px] font-bold mb-1" style={{ color: "rgba(255,255,255,0.5)" }}>Quick Stats</p>
                <div className="flex items-center gap-4">
                  <div><p className="text-lg font-bold text-white">847</p><p className="text-[9px]" style={{ color: "rgba(255,255,255,0.5)" }}>Events this month</p></div>
                  <div><p className="text-lg font-bold" style={{ color: "#22c55e" }}>99.8%</p><p className="text-[9px]" style={{ color: "rgba(255,255,255,0.5)" }}>Delivery rate</p></div>
                  <div><p className="text-lg font-bold" style={{ color: "#3b82f6" }}>142ms</p><p className="text-[9px]" style={{ color: "rgba(255,255,255,0.5)" }}>Avg latency</p></div>
                </div>
              </div>
            </div>
          </div>
        </MockupChrome>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mt-8">
          {[
            { text: "11 webhook event types with HMAC-SHA256 signing", color: "#22c55e" },
            { text: "SHA-256 hashed API keys with prefix-based lookup", color: "#3b82f6" },
            { text: "Zapier-ready for 5,000+ app integrations", color: "#f59e0b" },
            { text: "Available on Professional plan and above", color: "#a855f7" },
          ].map((h, i) => (
            <div key={i} className="flex items-start gap-2">
              <Check className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: h.color }} />
              <span className="text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>{h.text}</span>
            </div>
          ))}
        </div>
        <SectionCTA text="Try API & Webhooks" />
      </div>
    </section>
  );
}

function MarketingOSTourSection() {
  const ref = useFadeIn();
  const cards = [
    { icon: Users, title: "Contacts & Companies CRM", desc: "Marketing prospects and companies, completely separate from your billing clients. Tags, custom fields, and an activity timeline." },
    { icon: Send, title: "Campaigns & Sequences", desc: "Broadcast campaigns to a segment, or run multi-step automated sequences. Stops the moment a prospect replies or is promoted." },
    { icon: Database, title: "Prospect / Client Separation", desc: "Marketing data lives in dedicated database tables — no foreign keys to your books, no cross-contamination between marketing and billing records." },
  ];
  return (
    <section className="py-8 md:py-12" style={{ background: "linear-gradient(180deg, #111827 0%, #0a0f1c 100%)" }} data-testid="section-tour-marketing-os">
      <div ref={ref} className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 fade-in-section">
        <div className="text-center mb-10">
          <span className="inline-block text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full mb-3" style={{ background: "rgba(220,38,38,0.15)", color: "#f87171", border: "1px solid rgba(220,38,38,0.25)" }} data-testid="badge-tour-marketing-os">
            Included in Business plan
          </span>
          <h2 className="text-3xl md:text-4xl font-bold text-white tracking-tight" data-testid="demo-section-marketing-os">Marketing — bring leads in, keep your books clean</h2>
          <p className="mt-3 text-base max-w-2xl mx-auto" style={{ color: "rgba(255,255,255,0.55)" }}>
            A full prospect-to-client layer on top of CherryWorks Pro &mdash; no cross-contamination between marketing and billing records.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <div
                key={card.title}
                className="rounded-2xl p-6"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                data-testid={`card-tour-marketing-os-${card.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`}
              >
                <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-4" style={{ background: "rgba(220,38,38,0.12)" }}>
                  <Icon className="w-5 h-5" style={{ color: "#f87171" }} />
                </div>
                <h3 className="text-base font-bold text-white mb-2">{card.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>{card.desc}</p>
              </div>
            );
          })}
        </div>
        <div className="mt-8 text-center">
          <Link href="/marketing">
            <span
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg cursor-pointer transition-colors hover:bg-white/5"
              style={{ color: "rgba(255,255,255,0.85)", border: "1px solid rgba(255,255,255,0.18)" }}
              data-testid="link-tour-marketing-os"
            >
              Tour Marketing
              <ArrowRight className="w-4 h-4" />
            </span>
          </Link>
        </div>
      </div>
    </section>
  );
}

function AccessibilitySummary() {
  const ref = useFadeIn();
  const features = [
    { label: "Keyboard Navigation", desc: "Every action accessible via keyboard shortcuts and tab navigation", color: "#22c55e" },
    { label: "Screen Reader Support", desc: "ARIA labels and semantic HTML throughout the entire platform", color: "#3b82f6" },
    { label: "High Contrast Mode", desc: "WCAG 2.1 AA compliant color contrast on all interactive elements", color: "#8b5cf6" },
    { label: "Responsive Design", desc: "Fully functional on desktop, tablet, and mobile devices", color: "#f59e0b" },
  ];
  return (
    <section className="py-8 md:py-12" style={{ background: "#0d1321" }}>
      <div ref={ref} className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 fade-in-section">
        <div className="text-center mb-12">
          <SectionBadge num="20" color="#22c55e" />
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-3" data-testid="demo-section-accessibility">Built for Everyone</h2>
          <p className="text-lg" style={{ color: "rgba(255,255,255,0.5)" }}>CherryWorks Pro is designed to be accessible to all users, regardless of ability.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {features.map((f, i) => (
            <div key={i} className="rounded-xl p-5 flex items-start gap-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="w-10 h-10 rounded-lg flex-shrink-0 flex items-center justify-center" style={{ background: `${f.color}15`, border: `1px solid ${f.color}25` }}>
                <Check className="w-5 h-5" style={{ color: f.color }} />
              </div>
              <div>
                <h3 className="text-base font-bold text-white mb-1">{f.label}</h3>
                <p className="text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ClientPortalSection() {
  const ref = useFadeIn();
  const invoices = [
    { id: "INV-2026-053", date: "Mar 15", amount: "$8,200.00", status: "Paid", statusColor: "#22c55e" },
    { id: "INV-2026-048", date: "Mar 01", amount: "$12,450.00", status: "Paid", statusColor: "#22c55e" },
    { id: "INV-2026-058", date: "Mar 29", amount: "$6,400.00", status: "Due Apr 28", statusColor: "#f59e0b" },
    { id: "INV-2026-061", date: "Apr 5", amount: "$3,950.00", status: "Sent", statusColor: "#3b82f6" },
  ];
  const activity = [
    { text: "Invoice INV-2026-061 sent", date: "Apr 5", color: "#3b82f6" },
    { text: "Payment $8,200 received", date: "Mar 15", color: "#22c55e" },
    { text: "Invoice INV-2026-058 sent", date: "Mar 29", color: "#3b82f6" },
  ];
  return (
    <section className="py-8 md:py-12" style={{ background: "#0d1321" }}>
      <div ref={ref} className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 fade-in-section">
        <SectionBadge num="08" color="#3b82f6" />
        <h2 className="text-3xl md:text-4xl font-bold text-white mb-3" data-testid="demo-section-client-portal">Client Portal</h2>
        <p className="text-lg mb-10" style={{ color: "rgba(255,255,255,0.5)" }}>Branded portal where clients view invoices, make payments, and track overdue balances.</p>
        <MockupChrome url="cherryworkspro.com/portal/acme-corp">
          <div className="flex items-center justify-between mb-5">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "rgba(255,255,255,0.45)" }}>Client Portal</p>
              <div className="flex items-center gap-3">
                <p className="text-sm font-bold text-white">Acme Corporation</p>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e" }}>3 Active Projects</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.6)" }}>Welcome, Sarah</span>
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{ background: "linear-gradient(135deg, #3b82f6, #8b5cf6)" }}>SK</div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-5">
            <div className="md:col-span-2">
              <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
                <p className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: "rgba(255,255,255,0.5)" }}>Invoices</p>
                <div className="space-y-2">
                  {invoices.map((inv, i) => (
                    <div key={i} className="rounded-lg px-3.5 py-2.5 flex items-center justify-between" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}>
                      <div className="flex items-center gap-3">
                        <FileText className="w-4 h-4" style={{ color: "#3b82f6" }} />
                        <div>
                          <p className="text-[12px] font-semibold text-white">{inv.id}</p>
                          <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.5)" }}>{inv.date}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[12px] font-bold font-mono text-white">{inv.amount}</span>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${inv.statusColor}15`, color: inv.statusColor }}>{inv.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div>
              <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
                <p className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: "rgba(255,255,255,0.5)" }}>Account Summary</p>
                <div className="space-y-3">
                  <div>
                    <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.45)" }}>Outstanding Balance</p>
                    <p className="text-xl font-bold" style={{ color: "#f59e0b" }}>$10,350.00</p>
                  </div>
                  <div>
                    <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.45)" }}>Last Payment</p>
                    <p className="text-sm font-semibold" style={{ color: "#22c55e" }}>$8,200.00 <span className="text-[10px] font-normal" style={{ color: "rgba(255,255,255,0.5)" }}>on Mar 15</span></p>
                  </div>
                  <div>
                    <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.45)" }}>Total Paid YTD</p>
                    <p className="text-sm font-semibold text-white">$34,850.00</p>
                  </div>
                </div>
                <button className="w-full mt-4 text-[11px] font-bold px-4 py-2.5 rounded-xl flex items-center justify-center gap-2" style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)", color: "#fff" }} data-testid="button-pay-now">
                  <CreditCard className="w-3.5 h-3.5" />Pay $10,350.00 Now
                </button>
              </div>
            </div>
          </div>
          <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
            <p className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: "rgba(255,255,255,0.5)" }}>Recent Activity</p>
            <div className="space-y-2.5">
              {activity.map((a, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full" style={{ background: a.color }} />
                  <span className="text-[11px] text-white">{a.text}</span>
                  <span className="text-[10px] ml-auto" style={{ color: "rgba(255,255,255,0.4)" }}>{a.date}</span>
                </div>
              ))}
            </div>
          </div>
        </MockupChrome>
        <SectionCTA text="Try Client Portal" />
      </div>
    </section>
  );
}

function MultiCurrencySection() {
  const ref = useFadeIn();
  const invoiceLines = [
    { desc: "Strategy Consulting", hrs: "20h", rate: "€175.00", amt: "€3,500.00" },
    { desc: "Development Sprint", hrs: "32h", rate: "€165.00", amt: "€5,280.00" },
    { desc: "Project Management", hrs: "8h", rate: "€140.00", amt: "€1,120.00" },
  ];
  const currencies = [
    { code: "USD", flag: "🇺🇸", rate: "1.0000", trend: "", trendColor: "", selected: false },
    { code: "EUR", flag: "🇪🇺", rate: "0.9215", trend: "↓0.3%", trendColor: "#ef4444", selected: true },
    { code: "GBP", flag: "🇬🇧", rate: "0.7892", trend: "↑0.1%", trendColor: "#22c55e", selected: false },
    { code: "CAD", flag: "🇨🇦", rate: "1.3641", trend: "↓0.2%", trendColor: "#ef4444", selected: false },
    { code: "AUD", flag: "🇦🇺", rate: "1.5312", trend: "↑0.4%", trendColor: "#22c55e", selected: false },
  ];
  return (
    <section className="py-8 md:py-12" style={{ background: "#0d1321" }}>
      <div ref={ref} className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 fade-in-section">
        <SectionBadge num="15" color="#eab308" />
        <h2 className="text-3xl md:text-4xl font-bold text-white mb-3" data-testid="demo-section-multi-currency">Multi-Currency Invoicing</h2>
        <p className="text-lg mb-10" style={{ color: "rgba(255,255,255,0.5)" }}>Invoice in 30+ currencies. Automatic exchange rate lookup. Clients pay in their local currency.</p>
        <MockupChrome url="cherryworkspro.com/invoices/INV-2026-060">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-6 h-6 rounded flex items-center justify-center" style={{ background: "#cf3339" }}>
                      <span className="text-[10px] font-black text-white">CW</span>
                    </div>
                    <span className="text-sm font-bold text-white">INV-2026-060</span>
                  </div>
                  <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.5)" }}>Berlin Digital GmbH</p>
                </div>
                <span className="text-[10px] font-bold px-2.5 py-1 rounded-full" style={{ background: "rgba(234,179,8,0.12)", color: "#eab308", border: "1px solid rgba(234,179,8,0.2)" }}>€ EUR</span>
              </div>
              <div className="rounded-lg overflow-hidden mb-4" style={{ border: "1px solid rgba(255,255,255,0.12)" }}>
                <div className="grid grid-cols-4 px-3 py-2" style={{ background: "rgba(255,255,255,0.10)" }}>
                  {["Description", "Hours", "Rate", "Amount"].map(h => (
                    <span key={h} className="text-[10px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.5)" }}>{h}</span>
                  ))}
                </div>
                {invoiceLines.map((l, i) => (
                  <div key={i} className="grid grid-cols-4 px-3 py-2" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                    <span className="text-[12px] text-white">{l.desc}</span>
                    <span className="text-[12px] font-mono" style={{ color: "rgba(255,255,255,0.6)" }}>{l.hrs}</span>
                    <span className="text-[12px] font-mono" style={{ color: "rgba(255,255,255,0.6)" }}>{l.rate}</span>
                    <span className="text-[12px] font-mono font-semibold text-white">{l.amt}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-end">
                <div className="w-56 space-y-1.5">
                  <div className="flex justify-between text-[12px]"><span style={{ color: "rgba(255,255,255,0.65)" }}>Subtotal</span><span className="text-white font-mono">€9,900.00</span></div>
                  <div className="flex justify-between text-[12px]"><span style={{ color: "rgba(255,255,255,0.65)" }}>VAT (19%)</span><span className="text-white font-mono">€1,881.00</span></div>
                  <div className="flex justify-between text-sm font-bold pt-1.5" style={{ borderTop: "2px solid rgba(255,255,255,0.1)" }}><span className="text-white">Total</span><span style={{ color: "#eab308" }}>€11,781.00</span></div>
                </div>
              </div>
              <p className="text-[10px] text-right mt-2" style={{ color: "rgba(255,255,255,0.35)" }}>≈ $12,785.00 USD at 0.9215</p>
            </div>
            <div>
              <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
                <div className="flex items-center gap-2 mb-4">
                  <Globe className="w-4 h-4" style={{ color: "#eab308" }} />
                  <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.5)" }}>Live Exchange Rates</p>
                </div>
                <div className="space-y-2">
                  {currencies.map((c, i) => (
                    <div key={i} className="rounded-lg px-3.5 py-2.5 flex items-center justify-between" style={{ background: c.selected ? "rgba(234,179,8,0.06)" : "rgba(255,255,255,0.04)", border: `1px solid ${c.selected ? "rgba(234,179,8,0.25)" : "rgba(255,255,255,0.08)"}` }}>
                      <div className="flex items-center gap-2.5">
                        <span className="text-base">{c.flag}</span>
                        <span className="text-[12px] font-bold text-white">{c.code}</span>
                        {c.code === "USD" && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.5)" }}>base</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-mono font-semibold text-white">{c.rate}</span>
                        {c.trend && <span className="text-[10px] font-bold" style={{ color: c.trendColor }}>{c.trend}</span>}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] mt-4 text-center" style={{ color: "rgba(255,255,255,0.4)" }}>30+ currencies supported · Rates update hourly</p>
              </div>
            </div>
          </div>
        </MockupChrome>
        <SectionCTA text="Try Multi-Currency" />
      </div>
    </section>
  );
}

function TimesheetApprovalSection() {
  const ref = useFadeIn();
  const timesheets = [
    { name: "Ava Morgan", initials: "AM", role: "UX Designer", project: "Client Alpha — Brand Refresh", hours: 41.5, billable: 38, internal: 3.5, billablePct: 91, status: "Pending", color: "#22c55e" },
    { name: "James Smith", initials: "JS", role: "Full-Stack Developer", project: "Client Beta — API Integration", hours: 42, billable: 40, internal: 2, billablePct: 95, status: "Approved", color: "#3b82f6" },
    { name: "Rosa Torres", initials: "RT", role: "Project Manager", project: "Client Gamma — Cloud Migration", hours: 40, billable: 36, internal: 4, billablePct: 90, status: "Approved", color: "#a855f7" },
    { name: "Maya Patel", initials: "MP", role: "Data Analyst", project: "Client Alpha — Brand Refresh", hours: 18.5, billable: 18.5, internal: 0, billablePct: 100, status: "Pending", color: "#ec4899" },
  ];
  return (
    <section className="py-8 md:py-12" style={{ background: "#0a0f1c" }}>
      <div ref={ref} className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 fade-in-section">
        <SectionBadge num="05" color="#10b981" />
        <h2 className="text-3xl md:text-4xl font-bold text-white mb-3" data-testid="demo-section-timesheet-approval">Timesheet Approval Workflow</h2>
        <p className="text-lg mb-10" style={{ color: "rgba(255,255,255,0.5)" }}>Managers review, approve, or reject timesheets before invoicing. Full audit trail.</p>
        <MockupChrome url="cherryworkspro.com/approvals/timesheets">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <p className="text-sm font-bold text-white">Week of Mar 23–29, 2026</p>
              <span className="text-[10px] font-bold px-2.5 py-1 rounded-full" style={{ background: "rgba(245,158,11,0.12)", color: "#f59e0b" }}>Pending Approvals</span>
            </div>
            <button className="text-[11px] font-bold px-4 py-2 rounded-xl flex items-center gap-1.5" style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.2)" }} data-testid="button-approve-all">
              <Check className="w-3.5 h-3.5" />Approve All (3)
            </button>
          </div>
          <div className="space-y-3">
            {timesheets.map((t, i) => (
              <div key={i} className="rounded-xl px-4 py-4" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-bold text-white" style={{ background: `${t.color}30` }}>{t.initials}</div>
                    <div>
                      <p className="text-[12px] font-bold text-white">{t.name}</p>
                      <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.5)" }}>{t.role}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold px-2.5 py-1 rounded-full" style={{ background: t.status === "Approved" ? "rgba(34,197,94,0.12)" : "rgba(245,158,11,0.12)", color: t.status === "Approved" ? "#22c55e" : "#f59e0b" }}>{t.status}</span>
                    {t.status === "Pending" && (
                      <div className="flex items-center gap-1">
                        <button className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.25)" }} data-testid={`button-approve-${i}`}><Check className="w-3 h-3" style={{ color: "#22c55e" }} /></button>
                        <button className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.25)" }} data-testid={`button-reject-${i}`}><X className="w-3 h-3" style={{ color: "#ef4444" }} /></button>
                      </div>
                    )}
                  </div>
                </div>
                <p className="text-[11px] mb-2" style={{ color: "rgba(255,255,255,0.6)" }}>{t.project}</p>
                <p className="text-[10px] mb-2" style={{ color: "rgba(255,255,255,0.5)" }}>{t.billable}h billable · {t.internal}h internal · {t.hours}h total</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                    <div className="h-full rounded-full" style={{ width: `${t.billablePct}%`, background: "#22c55e" }} />
                  </div>
                  <span className="text-[10px] font-bold" style={{ color: "#22c55e" }}>{t.billablePct}%</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-xl px-4 py-3 flex items-center justify-between" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.6)" }}>Total: 142h · 132.5h billable · <span className="font-bold" style={{ color: "#22c55e" }}>93.3% billable rate</span></p>
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e" }}>2 Approved</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(245,158,11,0.12)", color: "#f59e0b" }}>2 Pending</span>
            </div>
          </div>
        </MockupChrome>
        <SectionCTA text="Try Timesheet Approvals" />
      </div>
    </section>
  );
}

function TeamOnboardingSection() {
  const ref = useFadeIn();
  const workerTypes = [
    { label: "1099 Independent", selected: true },
    { label: "W-2 Employee", selected: false },
    { label: "Corp-to-Corp", selected: false },
  ];
  const formFields = [
    { label: "Bill Rate", value: "$175.00/hr" },
    { label: "Cost Rate", value: "$125.00/hr" },
    { label: "Overtime Multiplier", value: "1.5x" },
    { label: "Effective Date", value: "Apr 1, 2026" },
  ];
  const composition = [
    { type: "1099 Independents", count: 8, color: "#a855f7", pct: 62 },
    { type: "W-2 Employees", count: 3, color: "#3b82f6", pct: 23 },
    { type: "Corp-to-Corp", count: 2, color: "#f59e0b", pct: 15 },
  ];
  return (
    <section className="py-8 md:py-12" style={{ background: "#0d1321" }}>
      <div ref={ref} className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 fade-in-section">
        <SectionBadge num="11" color="#8b5cf6" />
        <h2 className="text-3xl md:text-4xl font-bold text-white mb-3" data-testid="demo-section-team-onboarding">Smart Team Onboarding</h2>
        <p className="text-lg mb-10" style={{ color: "rgba(255,255,255,0.5)" }}>Onboarding wizard adapts to worker type — 1099, W-2, or Corp-to-Corp. Five steps to a fully configured team member.</p>
        <MockupChrome url="cherryworkspro.com/team/onboard">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-5">
            <div className="md:col-span-3">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <p className="text-sm font-bold text-white">Onboarding Wizard</p>
                  <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.5)" }}>Step 3 of 5 — Rate Setup</p>
                </div>
                <span className="text-[11px] font-bold px-3 py-1.5 rounded-lg" style={{ background: "rgba(139,92,246,0.12)", color: "#a855f7", border: "1px solid rgba(139,92,246,0.2)" }}>Step 3 of 5</span>
              </div>
              <div className="flex items-center gap-2 mb-5">
                {workerTypes.map((wt, i) => (
                  <span key={i} className="text-[11px] font-bold px-3.5 py-2 rounded-lg cursor-pointer" style={{ background: wt.selected ? "rgba(139,92,246,0.15)" : "rgba(255,255,255,0.08)", color: wt.selected ? "#a855f7" : "rgba(255,255,255,0.5)", border: `1px solid ${wt.selected ? "rgba(139,92,246,0.3)" : "rgba(255,255,255,0.12)"}` }}>{wt.label}</span>
                ))}
              </div>
              <div className="space-y-3 mb-5">
                {formFields.map((f, i) => (
                  <div key={i} className="rounded-lg px-4 py-3" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
                    <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "rgba(255,255,255,0.45)" }}>{f.label}</p>
                    <p className="text-[13px] font-semibold text-white">{f.value}</p>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                {[1, 2, 3, 4, 5].map(n => (
                  <div key={n} className="w-3 h-3 rounded-full" style={{ background: n <= 3 ? "#22c55e" : "rgba(255,255,255,0.15)" }} />
                ))}
                <span className="text-[10px] ml-2" style={{ color: "rgba(255,255,255,0.4)" }}>3 of 5 complete</span>
              </div>
            </div>
            <div className="md:col-span-2">
              <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
                <p className="text-[11px] font-bold uppercase tracking-wider mb-4" style={{ color: "rgba(255,255,255,0.5)" }}>Team Composition</p>
                <div className="flex justify-center mb-4">
                  <div className="relative w-28 h-28">
                    <svg viewBox="0 0 36 36" className="w-full h-full" style={{ transform: "rotate(-90deg)" }}>
                      <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
                      <circle cx="18" cy="18" r="15.9" fill="none" stroke="#a855f7" strokeWidth="3" strokeDasharray="62 38" strokeDashoffset="0" />
                      <circle cx="18" cy="18" r="15.9" fill="none" stroke="#3b82f6" strokeWidth="3" strokeDasharray="23 77" strokeDashoffset="-62" />
                      <circle cx="18" cy="18" r="15.9" fill="none" stroke="#f59e0b" strokeWidth="3" strokeDasharray="15 85" strokeDashoffset="-85" />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-2xl font-bold text-white">13</span>
                    </div>
                  </div>
                </div>
                <div className="space-y-2.5">
                  {composition.map((c, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: c.color }} />
                        <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.8)" }}>{c.type}</span>
                      </div>
                      <span className="text-[11px] font-bold" style={{ color: c.color }}>{c.count} members</span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] mt-4 text-center" style={{ color: "rgba(255,255,255,0.35)" }}>Total: 13 members · $0 per seat — unlimited users included</p>
              </div>
            </div>
          </div>
        </MockupChrome>
        <SectionCTA text="Try Team Onboarding" />
      </div>
    </section>
  );
}

function EstimatesSection() {
  const ref = useFadeIn();
  const lines = [
    { desc: "Discovery & Strategy", hrs: "20h", rate: "$175", amt: "$3,500" },
    { desc: "UI/UX Design", hrs: "40h", rate: "$150", amt: "$6,000" },
    { desc: "Frontend Development", hrs: "60h", rate: "$165", amt: "$9,900" },
    { desc: "QA & Launch Support", hrs: "15h", rate: "$125", amt: "$1,875" },
  ];
  const timeline = [
    { text: "Sent to client", date: "Mar 18", color: "#3b82f6" },
    { text: "Client viewed", date: "Mar 19", color: "#22c55e" },
    { text: "Revision requested", date: "Mar 22", color: "#f59e0b" },
  ];
  return (
    <section className="py-8 md:py-12" style={{ background: "#0a0f1c" }}>
      <div ref={ref} className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 fade-in-section">
        <SectionBadge num="07" color="#06b6d4" />
        <h2 className="text-3xl md:text-4xl font-bold text-white mb-3" data-testid="demo-section-estimates">Estimates & Proposals</h2>
        <p className="text-lg mb-10" style={{ color: "rgba(255,255,255,0.5)" }}>Create professional estimates, send to clients for approval, and convert to invoices with one click.</p>
        <MockupChrome url="cherryworkspro.com/estimates/EST-2026-012">
          <div className="flex items-center justify-between mb-5">
            <div>
              <p className="text-sm font-bold text-white">EST-2026-012</p>
              <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.5)" }}>Web App Redesign · Acme Corp</p>
              <p className="text-[10px] mt-1" style={{ color: "rgba(255,255,255,0.35)" }}>Created Mar 15 · Valid until Apr 30, 2026</p>
            </div>
            <span className="text-[10px] font-bold px-3 py-1.5 rounded-full" style={{ background: "rgba(245,158,11,0.12)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.2)" }}>Awaiting Client Approval</span>
          </div>
          <div className="rounded-lg overflow-hidden mb-4" style={{ border: "1px solid rgba(255,255,255,0.12)" }}>
            <div className="grid grid-cols-4 px-3 py-2" style={{ background: "rgba(255,255,255,0.10)" }}>
              {["Phase", "Hours", "Rate", "Amount"].map(h => (
                <span key={h} className="text-[10px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.5)" }}>{h}</span>
              ))}
            </div>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-4 px-3 py-2" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                <span className="text-[12px] text-white">{l.desc}</span>
                <span className="text-[12px] font-mono" style={{ color: "rgba(255,255,255,0.6)" }}>{l.hrs}</span>
                <span className="text-[12px] font-mono" style={{ color: "rgba(255,255,255,0.6)" }}>{l.rate}</span>
                <span className="text-[12px] font-mono font-semibold text-white">{l.amt}</span>
              </div>
            ))}
          </div>
          <div className="flex justify-end mb-1">
            <div className="w-56 space-y-1.5">
              <div className="flex justify-between text-[12px]"><span style={{ color: "rgba(255,255,255,0.65)" }}>Subtotal</span><span className="text-white font-mono">$21,275.00</span></div>
              <div className="flex justify-between text-[12px]"><span style={{ color: "rgba(255,255,255,0.65)" }}>Discount (5%)</span><span className="font-mono" style={{ color: "#ef4444" }}>-$1,063.75</span></div>
              <div className="flex justify-between text-sm font-bold pt-1.5" style={{ borderTop: "2px solid rgba(255,255,255,0.1)" }}><span className="text-white">Grand Total</span><span style={{ color: "#06b6d4" }}>$20,211.25</span></div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-5 pt-5" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: "rgba(255,255,255,0.45)" }}>Activity</p>
              <div className="space-y-2.5">
                {timeline.map((t, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full" style={{ background: t.color }} />
                    <span className="text-[11px] text-white">{t.text}</span>
                    <span className="text-[10px] ml-auto" style={{ color: "rgba(255,255,255,0.4)" }}>{t.date}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-end justify-end gap-2">
              <button className="text-[11px] font-bold px-3.5 py-2 rounded-xl" style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.15)" }} data-testid="button-revise-estimate">Revise Estimate</button>
              <button className="text-[11px] font-bold px-3.5 py-2 rounded-xl flex items-center gap-1.5" style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.25)" }} data-testid="button-convert-invoice">Convert to Invoice <ArrowRight className="w-3 h-3" /></button>
              <button className="text-[11px] font-bold px-3.5 py-2 rounded-xl flex items-center gap-1.5" style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.15)" }} data-testid="button-download-pdf"><Download className="w-3 h-3" />PDF</button>
            </div>
          </div>
        </MockupChrome>
        <SectionCTA text="Try Estimates" />
      </div>
    </section>
  );
}

function ImportWizardSection() {
  const ref = useFadeIn();
  const validationCards = [
    { label: "Clients", count: "47", ok: true },
    { label: "Invoices", count: "312", ok: true },
    { label: "Time Entries", count: "2,488", ok: true },
    { label: "Payments", count: "289", ok: true },
    { label: "Services", count: "18", ok: true },
    { label: "Expenses", count: "156", ok: true },
    { label: "Duplicates", count: "3", ok: false },
    { label: "Errors", count: "0", ok: true },
  ];
  return (
    <section className="py-8 md:py-12" style={{ background: "#0d1321" }}>
      <div ref={ref} className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 fade-in-section">
        <SectionBadge num="16" color="#f97316" />
        <h2 className="text-3xl md:text-4xl font-bold text-white mb-3" data-testid="demo-section-import-wizard">Import Wizard</h2>
        <p className="text-lg mb-10" style={{ color: "rgba(255,255,255,0.5)" }}>Import from 8 platforms. Upload, preview with dry-run, execute with one click. Full rollback if anything goes wrong.</p>
        <MockupChrome url="cherryworkspro.com/admin/import">
          <div className="mb-6">
            <p className="text-[11px] font-bold uppercase tracking-wider mb-4" style={{ color: "rgba(255,255,255,0.5)" }}>Import Progress</p>
            <div className="flex items-center gap-0 mb-4">
              {[
                { label: "Upload", done: true },
                { label: "Validate", done: true },
                { label: "Execute", done: false },
              ].map((step, i) => (
                <div key={i} className="flex items-center flex-1">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: step.done ? "rgba(34,197,94,0.15)" : "rgba(59,130,246,0.15)", border: `2px solid ${step.done ? "#22c55e" : "#3b82f6"}` }}>
                      {step.done ? <Check className="w-3.5 h-3.5" style={{ color: "#22c55e" }} /> : <div className="w-2.5 h-2.5 rounded-full animate-pulse" style={{ background: "#3b82f6" }} />}
                    </div>
                    <span className="text-[11px] font-semibold" style={{ color: step.done ? "#22c55e" : "#3b82f6" }}>{step.label}</span>
                  </div>
                  {i < 2 && <div className="flex-1 h-px mx-3" style={{ background: i === 0 ? "#22c55e" : "rgba(255,255,255,0.15)" }} />}
                </div>
              ))}
            </div>
            <div className="rounded-lg px-4 py-2.5 flex items-center gap-3" style={{ background: "rgba(34,197,94,0.04)", border: "1px solid rgba(34,197,94,0.12)" }}>
              <Upload className="w-4 h-4" style={{ color: "#22c55e" }} />
              <span className="text-[12px]" style={{ color: "rgba(255,255,255,0.7)" }}>FreshBooks · 3 CSV files · 2.4 MB</span>
            </div>
          </div>
          <div className="mb-6">
            <p className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: "rgba(255,255,255,0.5)" }}>Preflight Validation</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              {validationCards.map((v, i) => (
                <div key={i} className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.08)", border: `1px solid ${v.ok ? "rgba(255,255,255,0.12)" : "rgba(245,158,11,0.25)"}` }}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.5)" }}>{v.label}</span>
                    {v.ok ? <Check className="w-3.5 h-3.5" style={{ color: "#22c55e" }} /> : <span className="text-[11px]" style={{ color: "#f59e0b" }}>⚠</span>}
                  </div>
                  <p className="text-lg font-bold" style={{ color: v.ok ? "white" : "#f59e0b" }}>{v.count}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <div>
                <p className="text-[12px] font-bold text-white">Dry Run Results</p>
                <p className="text-[11px] mt-0.5" style={{ color: "rgba(255,255,255,0.5)" }}>3,310 records ready · 3 duplicates to skip · 0 errors</p>
              </div>
              <div className="flex items-center gap-2">
                <button className="text-[11px] font-bold px-3.5 py-2 rounded-lg" style={{ color: "#f59e0b", border: "1px solid rgba(245,158,11,0.25)" }}>Review Duplicates</button>
                <button className="text-[11px] font-bold px-4 py-2 rounded-lg text-white" style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)", boxShadow: "0 4px 20px rgba(207,51,57,0.3)" }}>Execute Import</button>
              </div>
            </div>
            <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>Full rollback available for 30 days</p>
          </div>
        </MockupChrome>
        <SectionCTA text="Try Import Wizard" />
      </div>
    </section>
  );
}

function CherryAssistSection() {
  const ref = useFadeIn();
  return (
    <section className="py-8 md:py-12" style={{ background: "#0a0f1c" }}>
      <div ref={ref} className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 fade-in-section">
        <SectionBadge num="18" color="#ec4899" />
        <h2 className="text-3xl md:text-4xl font-bold text-white mb-3" data-testid="demo-section-cherry-assist">CherryAssist AI</h2>
        <p className="text-lg mb-10" style={{ color: "rgba(255,255,255,0.5)" }}>AI-powered help assistant. Ask any question about CherryWorks Pro and get instant, accurate answers.</p>
        <MockupChrome url="cherryworkspro.com (CherryAssist panel)">
          <div className="max-w-lg mx-auto">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(236,72,153,0.15)" }}>
                  <Sparkles className="w-4 h-4" style={{ color: "#ec4899" }} />
                </div>
                <div>
                  <p className="text-[12px] font-bold text-white">CherryAssist</p>
                  <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.5)" }}>AI Help Assistant</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ background: "#22c55e" }} />
                <span className="text-[10px] font-semibold" style={{ color: "#22c55e" }}>Online</span>
              </div>
            </div>
            <div className="space-y-3">
              <div className="rounded-xl px-4 py-3 ml-8" style={{ background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.15)" }}>
                <p className="text-[10px] font-bold mb-1" style={{ color: "#a855f7" }}>You</p>
                <p className="text-[12px] leading-relaxed" style={{ color: "rgba(255,255,255,0.8)" }}>How much does Acme Corp owe us?</p>
              </div>
              <div className="rounded-xl px-4 py-3 mr-4" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
                <p className="text-[10px] font-bold mb-2" style={{ color: "#ec4899" }}>CherryAssist</p>
                <div className="rounded-lg p-3 mb-2" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
                  <p className="text-[11px] font-bold text-white mb-2">Acme Corp · 2 Outstanding Invoices</p>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono" style={{ color: "rgba(255,255,255,0.6)" }}>INV-2026-052</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-mono font-bold text-white">$8,750.00</span>
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(239,68,68,0.12)", color: "#ef4444" }}>Due Apr 12</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono" style={{ color: "rgba(255,255,255,0.6)" }}>INV-2026-058</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-mono font-bold text-white">$15,200.00</span>
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(59,130,246,0.12)", color: "#3b82f6" }}>Sent Apr 5</span>
                      </div>
                    </div>
                  </div>
                </div>
                <p className="text-[12px] leading-relaxed" style={{ color: "rgba(255,255,255,0.8)" }}>Total outstanding: <span className="font-bold text-white">$23,950.00</span>. Would you like me to send a payment reminder?</p>
              </div>
              <div className="rounded-xl px-4 py-3 ml-8" style={{ background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.15)" }}>
                <p className="text-[10px] font-bold mb-1" style={{ color: "#a855f7" }}>You</p>
                <p className="text-[12px] leading-relaxed" style={{ color: "rgba(255,255,255,0.8)" }}>Yes, send a reminder for the overdue one</p>
              </div>
              <div className="rounded-xl px-4 py-3 mr-4" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
                <p className="text-[10px] font-bold mb-2" style={{ color: "#ec4899" }}>CherryAssist</p>
                <div className="flex items-start gap-2">
                  <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: "rgba(34,197,94,0.15)" }}>
                    <Check className="w-3 h-3" style={{ color: "#22c55e" }} />
                  </div>
                  <p className="text-[12px] leading-relaxed" style={{ color: "rgba(255,255,255,0.8)" }}>Done! Payment reminder sent to Acme Corp for INV-2026-052 ($8,750). I've also scheduled a follow-up for Apr 15 if unpaid.</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-4 mb-3 flex-wrap">
              {["Show AR aging", "Revenue this month", "Overdue invoices"].map((s, i) => (
                <span key={i} className="text-[10px] font-semibold px-3 py-1.5 rounded-full cursor-pointer" style={{ background: "rgba(236,72,153,0.08)", color: "#ec4899", border: "1px solid rgba(236,72,153,0.15)" }}>{s}</span>
              ))}
            </div>
            <div className="rounded-xl px-4 py-3 flex items-center justify-between" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
              <span className="text-[12px]" style={{ color: "rgba(255,255,255,0.3)" }}>Ask anything about your data...</span>
              <Send className="w-4 h-4" style={{ color: "rgba(255,255,255,0.3)" }} />
            </div>
          </div>
        </MockupChrome>
        <SectionCTA text="Try CherryAssist" />
      </div>
    </section>
  );
}

function MissionControlSection() {
  const ref = useFadeIn();
  const kpis = [
    { label: "Revenue MTD", value: "$47,850", change: "+12.3%", positive: true, color: "#22c55e" },
    { label: "Collections Rate", value: "94.8%", change: "On Track", positive: true, color: "#3b82f6" },
    { label: "Open AR", value: "$23,891", change: "3 overdue", positive: false, color: "#f59e0b" },
    { label: "Team Utilization", value: "91%", change: "+4.2%", positive: true, color: "#a855f7" },
  ];
  const actions = [
    { border: "#ef4444", icon: FileText, text: "3 invoices overdue > 30 days — $18,200 outstanding", color: "#f59e0b" },
    { border: "#f59e0b", icon: ClipboardCheck, text: "5 timesheets pending approval — Week of Mar 23", color: "#f59e0b" },
    { border: "#3b82f6", icon: DollarSign, text: "2 team payouts ready for processing", color: "#3b82f6" },
    { border: "#22c55e", icon: TrendingUp, text: "Revenue up 12% vs last month — new high", color: "#22c55e" },
  ];
  const quickActions = [
    { icon: Send, label: "Send Reminders" },
    { icon: Check, label: "Approve Timesheets" },
    { icon: DollarSign, label: "Process Payouts" },
    { icon: BarChart3, label: "Run Reports" },
  ];
  return (
    <section className="py-8 md:py-12" style={{ background: "#0d1321" }}>
      <div ref={ref} className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 fade-in-section">
        <SectionBadge num="17" color="#a855f7" />
        <h2 className="text-3xl md:text-4xl font-bold text-white mb-3" data-testid="demo-section-mission-control">Mission Control</h2>
        <p className="text-lg mb-10" style={{ color: "rgba(255,255,255,0.5)" }}>Your operational command center. See what needs attention right now — overdue invoices, pending approvals, and team health.</p>
        <MockupChrome url="cherryworkspro.com/mission-control">
          <div className="flex items-center justify-between mb-5">
            <div>
              <p className="text-sm font-bold text-white">Mission Control</p>
              <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.5)" }}>Real-time operational overview</p>
            </div>
            <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.4)" }}>Last updated 2 min ago</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            {kpis.map((k, i) => (
              <div key={i} className="rounded-xl p-3.5" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
                <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "rgba(255,255,255,0.65)" }}>{k.label}</p>
                <p className="text-xl font-bold text-white">{k.value}</p>
                <div className="flex items-center gap-1 mt-1">
                  {k.positive && <TrendingUp className="w-3 h-3" style={{ color: k.color }} />}
                  <span className="text-[11px] font-semibold" style={{ color: k.color }}>{k.change}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-xl p-4 mb-5" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
            <p className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: "rgba(255,255,255,0.5)" }}>Action Items</p>
            <div className="space-y-2">
              {actions.map((a, i) => (
                <div key={i} className="rounded-lg px-4 py-3 flex items-center justify-between" style={{ background: "rgba(255,255,255,0.04)", borderLeft: `4px solid ${a.border}` }}>
                  <div className="flex items-center gap-3">
                    <a.icon className="w-4 h-4 flex-shrink-0" style={{ color: a.color }} />
                    <span className="text-[12px]" style={{ color: "rgba(255,255,255,0.8)" }}>{a.text}</span>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "rgba(255,255,255,0.3)" }} />
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: "rgba(255,255,255,0.5)" }}>Quick Actions</p>
            <div className="flex items-center gap-2 flex-wrap">
              {quickActions.map((qa, i) => (
                <button key={i} className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[11px] font-semibold transition-all hover:scale-[1.02]" style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.12)" }}>
                  <qa.icon className="w-3.5 h-3.5" />
                  {qa.label}
                </button>
              ))}
            </div>
          </div>
        </MockupChrome>
        <SectionCTA text="Try Mission Control" />
      </div>
    </section>
  );
}

export default function DemoPage() {
  const heroRef = useRef<HTMLDivElement>(null);

  return (
    <div style={{ background: "#0a0f1c" }}>
      <MarketingNav />
      <SEO
        title="Product Tour"
        fullTitle="Product Tour — CherryWorks Pro | See Every Feature in Action"
        description="Explore 20 features in one scroll. Time tracking, invoicing, reports, approvals, payouts, GL, and more. No signup required."
        path="/demo"
      />

      <section className="pt-[100px] pb-8 md:pb-10" style={{ background: "linear-gradient(135deg, #0a0f1c 0%, #111827 50%, #1a0a0a 100%)" }}>
        <div ref={heroRef} className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-10 md:pt-12 text-center">
          <p className="text-sm font-bold uppercase tracking-[3px] mb-4" style={{ color: "#cf3339" }} data-testid="demo-badge">Feature Showcase</p>
          <h1 className="text-4xl md:text-6xl font-bold text-white tracking-tight leading-tight" data-testid="demo-heading">
            Every Feature,{" "}
            <span style={{ color: "#cf3339" }}>One Scroll</span>
          </h1>
          <p className="mt-5 text-lg md:text-xl" style={{ color: "rgba(255,255,255,0.55)" }}>
            20 features. One scroll. See exactly how CherryWorks Pro runs a firm — from the first time entry to the last 1099.
          </p>
          <div className="mt-8">
            <button
              onClick={() => {
                const el = document.getElementById("tour-start");
                if (el) el.scrollIntoView({ behavior: "smooth" });
              }}
              className="inline-flex items-center gap-2 px-8 py-4 text-base font-bold text-white rounded-xl cursor-pointer transition-all hover:scale-[1.03]"
              style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)", boxShadow: "0 4px 30px rgba(207,51,57,0.4)" }}
              data-testid="button-start-tour"
            >
              Start Scrolling <ArrowDown className="w-4 h-4" />
            </button>
          </div>
          <style>{`@keyframes demoChyron { from { transform: translate3d(0,0,0); } to { transform: translate3d(-50%,0,0); } } .demo-chyron-track:hover { animation-play-state: paused !important; }`}</style>
          <div className="mt-12 overflow-hidden w-full" style={{ maskImage: "linear-gradient(90deg, transparent, black 8%, black 92%, transparent)", WebkitMaskImage: "linear-gradient(90deg, transparent, black 8%, black 92%, transparent)" }}>
            <div className="flex items-center gap-4 demo-chyron-track" style={{ animation: "demoChyron 40s linear infinite", width: "max-content", willChange: "transform" }}>
              {[...Array(2)].flatMap((_, setIdx) =>
                [
                  { icon: Clock, label: "Time Tracking", color: "#8b5cf6" },
                  { icon: FileText, label: "Invoicing", color: "#eab308" },
                  { icon: BarChart3, label: "Reports", color: "#3b82f6" },
                  { icon: BarChart3, label: "Dashboard", color: "#22c55e" },
                  { icon: ClipboardCheck, label: "Timesheets", color: "#10b981" },
                  { icon: DollarSign, label: "Payouts", color: "#f59e0b" },
                  { icon: Send, label: "Estimates", color: "#06b6d4" },
                  { icon: Building2, label: "Client Portal", color: "#3b82f6" },
                  { icon: Receipt, label: "Expenses", color: "#f97316" },
                  { icon: ScanLine, label: "AI Scanner", color: "#ec4899" },
                  { icon: Users, label: "Team Onboarding", color: "#8b5cf6" },
                  { icon: CreditCard, label: "Stripe", color: "#7c3aed" },
                  { icon: BookOpen, label: "General Ledger", color: "#14b8a6" },
                  { icon: Landmark, label: "Bank Recon", color: "#06b6d4" },
                  { icon: Globe, label: "Multi-Currency", color: "#eab308" },
                  { icon: Upload, label: "Import Wizard", color: "#f97316" },
                  { icon: Gauge, label: "Mission Control", color: "#a855f7" },
                  { icon: Sparkles, label: "CherryAssist AI", color: "#ec4899" },
                  { icon: Webhook, label: "API Hub", color: "#64748b" },
                ].map((item, i) => (
                  <div key={`${setIdx}-${i}`} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full flex-shrink-0" style={{ background: `${item.color}10`, border: `1px solid ${item.color}20` }}>
                    <item.icon className="w-3.5 h-3.5" style={{ color: item.color }} />
                    <span className="text-[11px] font-semibold whitespace-nowrap" style={{ color: item.color }}>{item.label}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      <div id="tour-start" />

      <TimeTrackingSection />
      <InvoicingSection />
      <ReportsSection />
      <DashboardSection />
      <TimesheetApprovalSection />
      <TeamPayoutsSection />
      <EstimatesSection />
      <ClientPortalSection />
      <ExpenseSection />
      <AIReceiptSection />
      <TeamOnboardingSection />
      <StripePaymentsSection />
      <GeneralLedgerSection />
      <BankReconciliationSection />
      <MultiCurrencySection />
      <ImportWizardSection />
      <MissionControlSection />
      <CherryAssistSection />
      <APIWebhooksSection />
      <MarketingOSTourSection />
      <AccessibilitySummary />

      <section className="py-10 md:py-14" style={{ background: "linear-gradient(135deg, #1a0505 0%, #0a0f1c 50%, #1a0a0a 100%)" }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-6" style={{ background: "rgba(207,51,57,0.12)", border: "1px solid rgba(207,51,57,0.25)" }}>
            <ArrowRight className="w-7 h-7" style={{ color: "#cf3339" }} />
          </div>
          <h2 className="text-3xl md:text-5xl font-bold text-white tracking-tight" data-testid="demo-cta-heading">Ready to Transform Your Business?</h2>
          <p className="mt-5 text-lg" style={{ color: "rgba(255,255,255,0.55)" }}>Explore every feature above — then see how CherryWorks Pro fits your team.</p>
          <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/signup"><span className="inline-flex items-center gap-2 px-8 py-4 text-lg font-bold text-white rounded-xl cursor-pointer transition-all hover:scale-[1.03]" style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)", boxShadow: "0 4px 30px rgba(207,51,57,0.4)" }} data-testid="cta-start-trial">Get Started Free <ArrowRight className="w-5 h-5" /></span></Link>
            <Link href="/pricing"><span className="inline-flex items-center gap-2 px-8 py-4 text-lg font-semibold rounded-xl cursor-pointer" style={{ color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.15)" }} data-testid="cta-see-pricing">See Pricing</span></Link>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
