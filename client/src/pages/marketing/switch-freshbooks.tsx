import { useState, useMemo } from "react";
import { Link } from "wouter";
import { CheckCircle, X, ArrowRight, Upload, DollarSign, BarChart3, Users, Clock, Shield, Receipt, Globe, ChevronDown, Database, Send } from "lucide-react";
import { SEO } from "@/components/seo";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { MarketingFooter } from "@/components/marketing/marketing-footer";

const BRAND_COLORS: Record<string, string> = {
  freshbooks: "#0075DD",
  quickbooks: "#2CA01C",
  harvest: "#FA5D00",
  xero: "#13B5EA",
  wave: "#004A82",
  bigtime: "#1B75BC",
  scoro: "#3D5AFE",
  paymo: "#F4511E",
};

const competitors = [
  { id: "all", name: "All Platforms" },
  { id: "freshbooks", name: "FreshBooks" },
  { id: "quickbooks", name: "QuickBooks" },
  { id: "xero", name: "Xero" },
  { id: "wave", name: "Wave" },
  { id: "harvest", name: "Harvest" },
  { id: "bigtime", name: "BigTime" },
  { id: "scoro", name: "Scoro" },
  { id: "paymo", name: "Paymo" },
];

type Support = boolean | string;
interface CompRow {
  feature: string;
  category: string;
  cherry: Support;
  freshbooks: Support;
  quickbooks: Support;
  xero: Support;
  wave: Support;
  harvest: Support;
  bigtime: Support;
  scoro: Support;
  paymo: Support;
}

const comparisonData: CompRow[] = [
  { feature: "Unlimited team members (no per-user fees)", category: "Pricing", cherry: true, freshbooks: false, quickbooks: false, xero: true, wave: true, harvest: false, bigtime: false, scoro: false, paymo: false },
  { feature: "1099 + W-2 + Corp-to-Corp worker types", category: "Team", cherry: true, freshbooks: false, quickbooks: false, xero: false, wave: false, harvest: false, bigtime: false, scoro: false, paymo: false },
  { feature: "Smart onboarding wizard (adapts to worker type)", category: "Team", cherry: true, freshbooks: false, quickbooks: false, xero: false, wave: false, harvest: false, bigtime: false, scoro: false, paymo: false },
  { feature: "Time tracking (week, month, day views)", category: "Time", cherry: true, freshbooks: true, quickbooks: true, xero: false, wave: false, harvest: true, bigtime: true, scoro: true, paymo: true },
  { feature: "Floating timer widget", category: "Time", cherry: true, freshbooks: true, quickbooks: false, xero: false, wave: false, harvest: true, bigtime: false, scoro: true, paymo: true },
  { feature: "Timesheet approval workflow", category: "Time", cherry: true, freshbooks: false, quickbooks: true, xero: false, wave: false, harvest: true, bigtime: true, scoro: true, paymo: true },
  { feature: "Invoicing from billable time", category: "Billing", cherry: true, freshbooks: true, quickbooks: true, xero: true, wave: false, harvest: false, bigtime: true, scoro: true, paymo: true },
  { feature: "Multi-currency invoicing (30+)", category: "Billing", cherry: true, freshbooks: true, quickbooks: true, xero: true, wave: false, harvest: false, bigtime: true, scoro: true, paymo: false },
  { feature: "Recurring invoice templates", category: "Billing", cherry: true, freshbooks: true, quickbooks: true, xero: true, wave: false, harvest: false, bigtime: false, scoro: true, paymo: true },
  { feature: "Stripe Checkout integration", category: "Billing", cherry: true, freshbooks: true, quickbooks: false, xero: true, wave: false, harvest: false, bigtime: false, scoro: true, paymo: false },
  { feature: "ACH bank transfer payments", category: "Billing", cherry: true, freshbooks: true, quickbooks: true, xero: false, wave: false, harvest: false, bigtime: false, scoro: false, paymo: false },
  { feature: "25+ built-in reports", category: "Reports", cherry: true, freshbooks: false, quickbooks: true, xero: true, wave: false, harvest: false, bigtime: true, scoro: true, paymo: true },
  { feature: "AR aging report", category: "Reports", cherry: true, freshbooks: true, quickbooks: true, xero: true, wave: false, harvest: false, bigtime: false, scoro: false, paymo: false },
  { feature: "Team utilization report", category: "Reports", cherry: true, freshbooks: true, quickbooks: false, xero: false, wave: false, harvest: false, bigtime: true, scoro: true, paymo: true },
  { feature: "Expense analytics (category, project, team member)", category: "Reports", cherry: true, freshbooks: false, quickbooks: true, xero: false, wave: false, harvest: false, bigtime: true, scoro: true, paymo: true },
  { feature: "Expense management with approval workflow", category: "Expenses", cherry: true, freshbooks: true, quickbooks: true, xero: true, wave: false, harvest: true, bigtime: true, scoro: true, paymo: true },
  { feature: "Receipt photo/PDF upload", category: "Expenses", cherry: true, freshbooks: true, quickbooks: true, xero: true, wave: true, harvest: true, bigtime: false, scoro: false, paymo: false },
  { feature: "AI receipt scanning (photo to GL entry)", category: "Expenses", cherry: true, freshbooks: false, quickbooks: false, xero: false, wave: false, harvest: false, bigtime: false, scoro: false, paymo: false },
  { feature: "Batch expense reports", category: "Expenses", cherry: true, freshbooks: true, quickbooks: true, xero: false, wave: false, harvest: false, bigtime: true, scoro: true, paymo: true },
  { feature: "Auto-reimbursement payouts on approval", category: "Expenses", cherry: true, freshbooks: false, quickbooks: false, xero: false, wave: false, harvest: false, bigtime: false, scoro: false, paymo: false },
  { feature: "Expense reports with GL posting", category: "Expenses", cherry: true, freshbooks: false, quickbooks: false, xero: false, wave: false, harvest: false, bigtime: false, scoro: false, paymo: false },
  { feature: "Automatic payout tracking", category: "Payouts", cherry: true, freshbooks: false, quickbooks: false, xero: false, wave: false, harvest: false, bigtime: false, scoro: false, paymo: false },
  { feature: "Stripe Connect team payouts", category: "Payouts", cherry: true, freshbooks: false, quickbooks: false, xero: false, wave: false, harvest: false, bigtime: false, scoro: false, paymo: false },
  { feature: "Bill rate vs cost rate per project", category: "Payouts", cherry: true, freshbooks: true, quickbooks: false, xero: true, wave: false, harvest: false, bigtime: true, scoro: true, paymo: true },
  { feature: "1099-ready export", category: "Payouts", cherry: true, freshbooks: false, quickbooks: true, xero: true, wave: false, harvest: false, bigtime: false, scoro: false, paymo: false },
  { feature: "Project profitability (labor + expenses)", category: "Projects", cherry: true, freshbooks: true, quickbooks: true, xero: true, wave: false, harvest: false, bigtime: true, scoro: true, paymo: true },
  { feature: "Project budget tracking", category: "Projects", cherry: true, freshbooks: true, quickbooks: true, xero: true, wave: false, harvest: false, bigtime: true, scoro: true, paymo: true },
  { feature: "Client portal (invoices, payments, overdue alerts)", category: "Clients", cherry: true, freshbooks: true, quickbooks: false, xero: false, wave: false, harvest: false, bigtime: true, scoro: true, paymo: true },
  { feature: "Estimates & proposals", category: "Clients", cherry: true, freshbooks: true, quickbooks: true, xero: false, wave: true, harvest: false, bigtime: true, scoro: true, paymo: true },
  { feature: "Import wizard for 8 platforms (preview, execute, rollback)", category: "Migration", cherry: true, freshbooks: false, quickbooks: false, xero: false, wave: false, harvest: false, bigtime: false, scoro: false, paymo: false },
  { feature: "REST API for external integrations", category: "Integrations", cherry: true, freshbooks: true, quickbooks: true, xero: true, wave: false, harvest: true, bigtime: true, scoro: true, paymo: true },
  { feature: "Webhook event notifications", category: "Integrations", cherry: true, freshbooks: true, quickbooks: true, xero: true, wave: false, harvest: true, bigtime: false, scoro: false, paymo: false },
  { feature: "Zapier payroll webhooks", category: "Integrations", cherry: true, freshbooks: false, quickbooks: false, xero: false, wave: false, harvest: false, bigtime: false, scoro: false, paymo: false },
  { feature: "AI-powered help assistant", category: "AI & Automation", cherry: true, freshbooks: true, quickbooks: true, xero: false, wave: false, harvest: false, bigtime: true, scoro: true, paymo: false },
  { feature: "Mission Control dashboard", category: "AI & Automation", cherry: true, freshbooks: false, quickbooks: false, xero: false, wave: false, harvest: false, bigtime: false, scoro: false, paymo: false },
  { feature: "General Ledger (chart of accounts, journal entries)", category: "Accounting", cherry: true, freshbooks: true, quickbooks: true, xero: true, wave: true, harvest: false, bigtime: false, scoro: false, paymo: false },
  { feature: "Bank reconciliation", category: "Accounting", cherry: true, freshbooks: true, quickbooks: true, xero: true, wave: true, harvest: false, bigtime: true, scoro: false, paymo: false },
  { feature: "Trial Balance report", category: "Accounting", cherry: true, freshbooks: true, quickbooks: true, xero: true, wave: true, harvest: false, bigtime: false, scoro: false, paymo: false },
  { feature: "Close periods (period locking)", category: "Accounting", cherry: true, freshbooks: true, quickbooks: true, xero: true, wave: false, harvest: false, bigtime: false, scoro: true, paymo: false },
  { feature: "Auto-post transactions to General Ledger", category: "Accounting", cherry: true, freshbooks: true, quickbooks: false, xero: false, wave: false, harvest: false, bigtime: false, scoro: false, paymo: false },
  { feature: "Enterprise audit logging", category: "Security", cherry: true, freshbooks: true, quickbooks: false, xero: false, wave: false, harvest: false, bigtime: false, scoro: true, paymo: false },
];

const Chk = () => <CheckCircle className="w-3.5 h-3.5 mx-auto" style={{ color: "#22c55e" }} />;
const No = () => <X className="w-3.5 h-3.5 mx-auto" style={{ color: "rgba(255,255,255,0.1)" }} />;
const Val = ({ v }: { v: Support }) => typeof v === "string" ? <span className="text-xs text-center block" style={{ color: "#f59e0b" }}>{v}</span> : v ? <Chk /> : <No />;

export default function SwitchFreshBooksPage() {
  const [selected, setSelected] = useState("all");

  const visibleCompetitors = selected === "all"
    ? competitors.filter(c => c.id !== "all")
    : competitors.filter(c => c.id === selected);

  const allCompetitorIds = ["freshbooks", "quickbooks", "xero", "wave", "harvest", "bigtime", "scoro", "paymo"];
  const cherryExclusiveCount = useMemo(() =>
    comparisonData.filter(row =>
      row.cherry === true && allCompetitorIds.every(id => (row as any)[id] === false)
    ).length,
  []);

  return (
    <div style={{ background: "#0a0f1c" }}>
      <MarketingNav />
      <SEO
        title="Compare"
        fullTitle="CherryWorks Pro vs FreshBooks, QuickBooks, Xero, Harvest & More"
        description="41 features compared. 41 CherryWorks wins. See how unlimited users, built-in GL, and 1099 support set CherryWorks Pro apart from 8 competitors."
        path="/compare"
      />

      <section className="pt-[100px] pb-8 md:pb-10" style={{ background: "linear-gradient(135deg, #0a0f1c 0%, #111827 50%, #1a0a0a 100%)" }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-8 md:pt-12 md:pb-10">
          <div className="max-w-3xl">
            <h1 className="text-4xl md:text-5xl font-bold text-white tracking-tight">
              We didn't build another time tracker. We built the platform that replaces{" "}
              <span style={{ color: "#cf3339" }}>all of them</span>.
            </h1>
            <p className="mt-4 text-lg" style={{ color: "rgba(255,255,255,0.65)" }}>
              Eight competitors. 41 features compared. 41 wins. Switching? Import your data in minutes. Starting fresh? You'll be live just as fast.
            </p>
          </div>
        </div>
      </section>

      <section className="py-10 md:py-12" style={{ background: "var(--color-brand-900)" }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            <div><p className="text-2xl font-bold text-white">{comparisonData.length}</p><p className="text-xs uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.5)" }}>Features Compared</p></div>
            <div><p className="text-2xl font-bold" style={{ color: "#22c55e" }}>{comparisonData.filter(r => r.cherry).length}</p><p className="text-xs uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.5)" }}>CherryWorks Pro Wins</p></div>
            <div><p className="text-2xl font-bold text-white">8</p><p className="text-xs uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.5)" }}>Competitors Compared</p></div>
            <div><p className="text-2xl font-bold" style={{ color: "#cf3339" }}>{cherryExclusiveCount}</p><p className="text-xs uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.5)" }}>Exclusive to CherryWorks Pro</p></div>
          </div>
        </div>
      </section>

      <section className="pt-8 md:pt-10" style={{ background: "#0a0f1c" }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-sm font-bold mb-4" style={{ color: "rgba(255,255,255,0.7)" }}>Compare CherryWorks Pro against:</p>
          <div className="flex flex-wrap gap-2">
            {competitors.map(c => {
              const brandColor = BRAND_COLORS[c.id];
              return (
                <button key={c.id} onClick={() => setSelected(c.id)} className="px-4 py-2 text-sm font-medium rounded-lg transition-all cursor-pointer" data-testid={`compare-filter-${c.id}`} style={{ background: selected === c.id ? "#cf3339" : "rgba(255,255,255,0.03)", color: selected === c.id ? "#fff" : (brandColor || "rgba(255,255,255,0.5)"), border: `1px solid ${selected === c.id ? "#cf3339" : "rgba(255,255,255,0.06)"}` }}>
                  {c.name}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="pb-16 md:pb-20" style={{ background: "#0a0f1c" }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="rounded-2xl overflow-hidden overflow-x-auto" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
            <table className="w-full text-sm" data-testid="comparison-table">
              <thead>
                <tr style={{ background: "rgba(255,255,255,0.03)" }}>
                  <th className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider sticky left-0 z-10" style={{ color: "rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.03)", minWidth: "240px" }}>Feature</th>
                  <th className="text-center px-3 py-3 text-xs font-bold" style={{ color: "#cf3339", minWidth: "100px" }}>CherryWorks Pro</th>
                  {visibleCompetitors.map(c => (
                    <th key={c.id} className="text-center px-3 py-3 text-xs font-bold" style={{ color: BRAND_COLORS[c.id] || "rgba(255,255,255,0.5)", minWidth: "100px" }}>{c.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparisonData.map((row, i) => {
                  const prevCat = i > 0 ? comparisonData[i-1].category : "";
                  const showCat = row.category !== prevCat;
                  return (
                    <tr key={i}>
                      <td className="px-4 py-2.5 sticky left-0 z-10" style={{ background: "#0a0f1c", borderTop: showCat ? "2px solid rgba(255,255,255,0.06)" : "1px solid rgba(255,255,255,0.06)" }}>
                        {showCat && <p className="text-xs font-bold uppercase tracking-wider mb-0.5" style={{ color: "#cf3339" }}>{row.category}</p>}
                        <p className="text-sm" style={{ color: "rgba(255,255,255,0.7)" }}>{row.feature}</p>
                      </td>
                      <td className="text-center px-3 py-2.5" style={{ background: "rgba(207,51,57,0.03)", borderTop: showCat ? "2px solid rgba(255,255,255,0.06)" : "1px solid rgba(255,255,255,0.06)" }}><Val v={row.cherry} /></td>
                      {visibleCompetitors.map(c => (
                        <td key={c.id} className="text-center px-3 py-2.5" style={{ borderTop: showCat ? "2px solid rgba(255,255,255,0.06)" : "1px solid rgba(255,255,255,0.06)" }}><Val v={(row as any)[c.id]} /></td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>* Some features require Professional or Business plans. See <Link href="/pricing" style={{ color: "rgba(255,255,255,0.35)", textDecoration: "underline" }}>pricing</Link> for details. Competitor features verified April 2026.</p>
        </div>
      </section>

      <section className="py-10 md:py-14" style={{ background: "linear-gradient(135deg, #0a0f1c 0%, #111827 100%)" }}>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-bold text-white tracking-tight">Switch from any of them in under 5 minutes</h2>
          <p className="mt-3 text-base" style={{ color: "rgba(255,255,255,0.5)" }}>Built-in import wizards for every major platform. Upload your export, preview with dry-run, execute with one click. Full rollback if anything goes wrong.</p>
          <div className="flex flex-wrap justify-center gap-3 mt-8">
            {[
              { name: "FreshBooks", href: "/switch-from-freshbooks", color: "#0075DD" },
              { name: "QuickBooks", href: "/switch-from-quickbooks", color: "#2CA01C" },
              { name: "Xero", href: "/switch-from-xero", color: "#13B5EA" },
              { name: "Wave", href: "/switch-from-wave", color: "#004A82" },
              { name: "Harvest", href: "/switch-from-harvest", color: "#FA5D00" },
              { name: "BigTime", href: "/switch-from-bigtime", color: "#1B75BC" },
              { name: "Scoro", href: "/switch-from-scoro", color: "#3D5AFE" },
              { name: "Paymo", href: "/switch-from-paymo", color: "#F4511E" },
            ].map((p, i) => (
              <Link key={i} href={p.href}><span className="text-xs font-bold px-4 py-2 rounded-lg cursor-pointer transition-all duration-200 hover:scale-105 inline-block" data-testid={`switch-link-${p.name.toLowerCase()}`} style={{ background: `${p.color}15`, color: p.color, border: `1px solid ${p.color}40`, boxShadow: `0 0 0 0 ${p.color}00` }} onMouseEnter={e => { e.currentTarget.style.background = `${p.color}25`; e.currentTarget.style.borderColor = `${p.color}80`; e.currentTarget.style.boxShadow = `0 0 12px ${p.color}30`; }} onMouseLeave={e => { e.currentTarget.style.background = `${p.color}15`; e.currentTarget.style.borderColor = `${p.color}40`; e.currentTarget.style.boxShadow = `0 0 0 0 ${p.color}00`; }}>{p.name}</span></Link>
            ))}
          </div>
          <div className="mt-8 flex flex-col sm:flex-row justify-center gap-4">
            <div className="rounded-xl p-5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <p className="text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>
                Switching from QuickBooks?{" "}
                <Link href="/switch-from-quickbooks"><span className="font-bold cursor-pointer transition-colors hover:text-white" style={{ color: "#f87171" }}>See our detailed comparison <ArrowRight className="w-3.5 h-3.5 inline" /></span></Link>
              </p>
            </div>
            <div className="rounded-xl p-5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <p className="text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>
                Switching from FreshBooks?{" "}
                <Link href="/switch-from-freshbooks"><span className="font-bold cursor-pointer transition-colors hover:text-white" style={{ color: "#f87171" }}>See our detailed comparison <ArrowRight className="w-3.5 h-3.5 inline" /></span></Link>
              </p>
            </div>
          </div>
          <div className="mt-8">
            <Link href="/signup"><span className="inline-flex items-center gap-2 px-7 py-4 text-base font-bold text-white rounded-xl cursor-pointer transition-all hover:scale-[1.03]" style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)", boxShadow: "0 4px 30px rgba(207,51,57,0.4)" }}>Start Free Trial <ArrowRight className="w-4 h-4" /></span></Link>
          </div>
          <p className="mt-4 text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>14-day free trial &middot; Cancel anytime</p>
        </div>
      </section>

      <section className="py-10 md:py-14" style={{ background: "#0a0f1c" }} data-testid="section-compare-marketing-os">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <span className="inline-block text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full mb-3" style={{ background: "rgba(220,38,38,0.15)", color: "#f87171", border: "1px solid rgba(220,38,38,0.25)" }} data-testid="badge-compare-marketing-os">
              Included in Business plan
            </span>
            <h2 className="text-3xl md:text-4xl font-bold text-white tracking-tight">One more thing no competitor offers</h2>
            <p className="mt-3 text-base max-w-2xl mx-auto" style={{ color: "rgba(255,255,255,0.55)" }}>
              Marketing Hub adds a full prospect-to-client layer on top of CherryWorks Pro &mdash; included in the Business plan, with no cross-contamination between marketing and billing records.
            </p>
          </div>
          <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
              {[
                { icon: Users, title: "Contacts & Companies CRM", desc: "Track prospects and companies in their own tables, completely separate from billing clients. Tags, custom fields, activity timeline." },
                { icon: Send, title: "Campaigns & Sequences", desc: "Broadcast to a segment, or run multi-step automated outreach. Stops the moment a prospect replies or is promoted to a client." },
                { icon: Database, title: "Prospect / Client Separation", desc: "Marketing data lives in dedicated database tables — no foreign keys to your books, no cross-contamination between marketing and billing records." },
              ].map((card) => {
                const Icon = card.icon;
                return (
                  <div
                    key={card.title}
                    className="p-7"
                    style={{ background: "rgba(207,51,57,0.03)", borderColor: "rgba(255,255,255,0.06)" }}
                    data-testid={`card-compare-marketing-os-${card.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`}
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
          </div>
          <div className="mt-8 text-center">
            <Link href="/marketing">
              <span
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg cursor-pointer transition-colors hover:bg-white/5"
                style={{ color: "rgba(255,255,255,0.85)", border: "1px solid rgba(255,255,255,0.18)" }}
                data-testid="link-compare-marketing-os"
              >
                Tour Marketing Hub
                <ArrowRight className="w-4 h-4" />
              </span>
            </Link>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
