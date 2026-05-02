import { useEffect, useRef } from "react";
import { Link } from "wouter";
import { ArrowRight, CheckCircle, X, AlertTriangle, Upload, Shield, Clock, Zap, Users, Send, Database } from "lucide-react";
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

const painPoints = [
  { pain: "QuickBooks charges per user", fix: "CherryWorks Pro includes unlimited users on every plan. A 15-person firm saves $2,000+/year in seat fees alone." },
  { pain: "No payout tracking", fix: "Auto-created payouts when you send an invoice. Track ACH, Zelle, wire — and export 1099 totals at year end." },
  { pain: "Weak project profitability", fix: "Revenue minus labor cost minus expense cost per project. Bill rate and cost rate per team member per project." },
  { pain: "Not built for services firms", fix: "Purpose-built for agencies and consultancies managing 1099, W-2, and Corp-to-Corp teams in one platform." },
  { pain: "Overcomplicated for what you need", fix: "QuickBooks is a general-purpose accounting tool. CherryWorks Pro is a focused operating system: time → invoice → collect → pay." },
  { pain: "Timesheet approvals don't exist", fix: "Full Submit → Approve → Lock workflow. Approved hours lock automatically. Rejection with mandatory reasons. Audit trail." },
];

const comparison = [
  { feature: "Unlimited users (no per-seat fees)", cw: true, qb: false },
  { feature: "1099 + W-2 + Corp-to-Corp support", cw: true, qb: false },
  { feature: "Payout tracking", cw: true, qb: false },
  { feature: "Timesheet approval workflow", cw: true, qb: false },
  { feature: "Auto-reimbursement payouts", cw: true, qb: false },
  { feature: "Project profitability (labor + expenses)", cw: true, qb: false },
  { feature: "Client portal with overdue alerts", cw: true, qb: false },
  { feature: "Import wizard (8 platforms)", cw: true, qb: false },
  { feature: "Multi-currency invoicing (33)", cw: true, qb: true },
  { feature: "Bank reconciliation", cw: true, qb: true },
  { feature: "Full general ledger accounting", cw: true, qb: true },
  { feature: "Payroll processing", cw: true, qb: true },
  { feature: "Inventory management", cw: true, qb: true },
  { feature: "Estimates & proposals", cw: true, qb: true },
  { feature: "Resource planning", cw: true, qb: false },
  { feature: "Enterprise audit logging", cw: true, qb: false },
];

export default function SwitchQuickBooksPage() {
  const painRef = useFadeIn();
  const compRef = useFadeIn();
  const timelineRef = useFadeIn();
  const getRef = useFadeIn();

  return (
    <div style={{ background: "#0a0f1c" }}>
      <MarketingNav />
      <SEO
        title="Switch from QuickBooks to CherryWorks Pro"
        fullTitle="Switch from QuickBooks to CherryWorks Pro | Purpose-Built for Services"
        description="QuickBooks is built for accountants. CherryWorks Pro is built for agencies — time tracking, invoicing, payouts, and profitability in one platform."
        path="/switch-from-quickbooks"
      />

      <section className="pt-[100px] pb-8 md:pb-10" style={{ background: "var(--gradient-hero)" }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-8 md:pt-12 md:pb-10">
          <div className="max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[3px] mb-4" style={{ color: "#2CA01C" }}>Switch from QuickBooks</p>
            <h1 className="text-4xl md:text-6xl font-bold text-white tracking-tight leading-[1.1]">
              QuickBooks was built for accountants.{" "}
              <span style={{ color: "rgba(255,255,255,0.4)" }}>You're not an accountant.</span>
            </h1>
            <p className="mt-6 text-lg md:text-xl leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>
              You need to track time, invoice clients, pay team members, and see profitability — with a general ledger that handles the accounting automatically. That's the whole job. We built it.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-4">
              <Link href="/signup">
                <span className="inline-flex items-center gap-2 px-6 py-3.5 text-base font-bold text-white rounded-xl cursor-pointer transition-all hover:scale-[1.02]" style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)", boxShadow: "0 4px 24px rgba(207,51,57,0.35)" }}>
                  Start Free Trial <ArrowRight className="w-5 h-5" />
                </span>
              </Link>
              <Link href="/demo">
                <span className="inline-flex items-center gap-2 px-6 py-3.5 text-base font-semibold rounded-xl cursor-pointer" style={{ color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.15)" }}>
                  Watch the Demo
                </span>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="py-8 md:py-12" style={{ background: "#0a0f1c" }}>
        <div ref={painRef} className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 fade-in-section">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-white">Why firms switch from QuickBooks</h2>
            <p className="mt-4 text-lg" style={{ color: "rgba(255,255,255,0.45)" }}>Every one of these is something QuickBooks can't do — or makes painfully hard.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {painPoints.map((p, i) => (
              <div key={i} className="rounded-xl p-6" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }} data-testid={`pain-point-${i}`}>
                <div className="flex items-start gap-3 mb-3">
                  <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: "#f59e0b" }} />
                  <p className="text-base font-bold text-white">{p.pain}</p>
                </div>
                <p className="text-sm leading-relaxed pl-8" style={{ color: "rgba(255,255,255,0.5)" }}>{p.fix}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-8 md:py-12" style={{ background: "linear-gradient(180deg, #0f172a 0%, #0a0f1c 100%)" }}>
        <div ref={compRef} className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 fade-in-section">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-white">Feature comparison</h2>
            <p className="mt-3 text-base" style={{ color: "rgba(255,255,255,0.45)" }}>Where CherryWorks Pro wins — and where QuickBooks still has the edge.</p>
          </div>
          <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="grid grid-cols-3 text-center py-4 px-6" style={{ background: "rgba(255,255,255,0.04)" }}>
              <div className="text-left"><span className="text-xs font-bold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.4)" }}>Feature</span></div>
              <div><span className="text-sm font-bold" style={{ color: "#cf3339" }}>CherryWorks Pro</span></div>
              <div><span className="text-sm font-bold" style={{ color: "#2CA01C" }}>QuickBooks</span></div>
            </div>
            {comparison.map((r, i) => (
              <div key={i} className="grid grid-cols-3 items-center py-3 px-6" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                <p className="text-sm font-medium text-white">{r.feature}</p>
                <div className="text-center">{r.cw ? <CheckCircle className="w-5 h-5 mx-auto" style={{ color: "#22c55e" }} /> : <X className="w-5 h-5 mx-auto" style={{ color: "#ef4444", opacity: 0.6 }} />}</div>
                <div className="text-center">{r.qb ? <CheckCircle className="w-5 h-5 mx-auto" style={{ color: "#22c55e" }} /> : <X className="w-5 h-5 mx-auto" style={{ color: "#ef4444", opacity: 0.6 }} />}</div>
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm text-center" style={{ color: "rgba(255,255,255,0.35)" }}>
            QuickBooks excels at general accounting. CherryWorks Pro excels at running a services firm. They solve different problems.
          </p>
          <p style={{ color: "rgba(255,255,255,0.35)", fontSize: "12px", marginTop: "12px" }}>* Some features require Professional or Business plans. See <Link href="/pricing" style={{ color: "rgba(255,255,255,0.35)", textDecoration: "underline" }}>pricing</Link> for details.</p>
        </div>
      </section>

      <section className="py-8 md:py-12" style={{ background: "#0a0f1c" }}>
        <div ref={timelineRef} className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 fade-in-section">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-white" data-testid="migration-timeline-heading">Migration timeline</h2>
            <p className="mt-3 text-base" style={{ color: "rgba(255,255,255,0.45)" }}>Three steps. Five minutes. Zero downtime.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { icon: Upload, step: "1", title: "Export from QuickBooks", desc: "Export your clients, invoices, and chart of accounts as CSV files from QuickBooks Online." },
              { icon: Clock, step: "2", title: "Import & preview", desc: "Upload CSVs to CherryWorks Pro. Preview every record with dry-run. Fix any issues before committing." },
              { icon: Zap, step: "3", title: "Go live", desc: "Execute the import with one click. Your team starts working immediately. Roll back anytime if needed." },
            ].map((s) => (
              <div key={s.step} className="rounded-xl p-6 text-center" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }} data-testid={`timeline-step-${s.step}`}>
                <div className="w-12 h-12 rounded-xl mx-auto mb-4 flex items-center justify-center" style={{ background: "rgba(207,51,57,0.1)", border: "1px solid rgba(207,51,57,0.2)" }}>
                  <s.icon className="w-5 h-5" style={{ color: "#cf3339" }} />
                </div>
                <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: "#cf3339" }}>Step {s.step}</p>
                <h3 className="text-lg font-bold text-white mb-2">{s.title}</h3>
                <p className="text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-8 md:py-12" style={{ background: "linear-gradient(180deg, #0f172a 0%, #0a0f1c 100%)" }}>
        <div ref={getRef} className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 fade-in-section">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-white" data-testid="what-you-get-heading">What you won't miss</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {[
              { icon: Clock, title: "Native time tracking", desc: "Week, month, and day views with a floating timer widget. No add-on or integration needed." },
              { icon: Shield, title: "Timesheet approvals", desc: "Submit → Approve → Lock workflow. Rejection with mandatory reasons. Full audit trail." },
              { icon: Zap, title: "Unlimited users", desc: "No per-user fees, ever. Add your entire team on any plan." },
              { icon: Upload, title: "25+ built-in reports", desc: "Project profitability, team utilization, AR aging, and expense analytics — purpose-built for services firms." },
            ].map((b, i) => (
              <div key={i} className="rounded-xl p-6 flex items-start gap-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="w-10 h-10 rounded-lg flex-shrink-0 flex items-center justify-center" style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.2)" }}>
                  <b.icon className="w-5 h-5" style={{ color: "#22c55e" }} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white mb-1">{b.title}</h3>
                  <p className="text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>{b.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-10 md:py-14" style={{ background: "#0a0f1c" }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">Ready to switch from QuickBooks?</h2>
          <p className="text-lg mb-10" style={{ color: "rgba(255,255,255,0.5)" }}>
            14-day free trial. Full access. Import your QuickBooks data in minutes.
          </p>
          <Link href="/signup">
            <span className="inline-flex items-center gap-2 px-8 py-4 text-lg font-bold text-white rounded-xl cursor-pointer transition-all hover:scale-[1.03]" style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)", boxShadow: "0 4px 30px rgba(207,51,57,0.4)" }} data-testid="cta-start-trial">
              Start Your Free Trial <ArrowRight className="w-5 h-5" />
            </span>
          </Link>
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
              Marketing adds a full prospect-to-client layer on top of CherryWorks Pro &mdash; included in the Business plan, with no cross-contamination between marketing and billing records.
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
                Tour Marketing
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
