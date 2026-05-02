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
  { pain: "Paymo charges per user ($11.90+/user/month)", fix: "CherryWorks Pro includes unlimited users on every plan. A 15-person firm saves $2,142/year in seat fees alone." },
  { pain: "No general ledger or accounting module", fix: "CherryWorks Pro includes a full chart of accounts, double-entry journal entries, trial balance report, and bank reconciliation." },
  { pain: "No project profitability or utilization reports", fix: "CherryWorks Pro includes 25+ reports: project profitability, team utilization, AR aging, expense analytics, and more." },
  { pain: "No 1099 + W-2 + Corp-to-Corp support", fix: "Manage all three worker classifications in one platform. Smart onboarding adapts to each type. Payouts, tax exports, and compliance are built in." },
  { pain: "No payout tracking", fix: "Automatic payout creation when invoices are sent. Track ACH, Zelle, wire — and export 1099 totals at year-end." },
  { pain: "No import wizard for data migration", fix: "Upload CSVs from any platform. Preview with dry-run. Execute with one click. Full rollback if anything looks wrong." },
  { pain: "Built for small teams, not scaling firms", fix: "Paymo works for teams of 5. CherryWorks Pro is built for agencies managing 10, 50, or 100+ team members across projects." },
];

const comparison = [
  { feature: "Unlimited users (no per-seat fees)", cw: true, comp: false },
  { feature: "1099 + W-2 + Corp-to-Corp support", cw: true, comp: false },
  { feature: "Payout tracking", cw: true, comp: false },
  { feature: "Full general ledger accounting", cw: true, comp: false },
  { feature: "Auto-reimbursement payouts", cw: true, comp: false },
  { feature: "Client portal with overdue alerts", cw: true, comp: false },
  { feature: "Import wizard (upload, preview, rollback)", cw: true, comp: false },
  { feature: "Bank reconciliation", cw: true, comp: false },
  { feature: "Multi-currency invoicing (33)", cw: true, comp: false },
  { feature: "Time tracking", cw: true, comp: true },
  { feature: "Invoicing from billable time", cw: true, comp: true },
  { feature: "Expense management", cw: true, comp: true },
  { feature: "Project budget tracking", cw: true, comp: true },
  { feature: "Kanban task boards", cw: true, comp: true },
  { feature: "Resource planning", cw: true, comp: false },
  { feature: "Estimates & proposals", cw: true, comp: true },
  { feature: "Enterprise audit logging", cw: true, comp: false },
];

export default function SwitchPaymoPage() {
  const painRef = useFadeIn();
  const compRef = useFadeIn();
  const timelineRef = useFadeIn();
  const getRef = useFadeIn();

  return (
    <div style={{ background: "#0a0f1c" }}>
      <MarketingNav />
      <SEO
        title="Switch from Paymo to CherryWorks Pro"
        fullTitle="Switch from Paymo to CherryWorks Pro | Scale Without Per-Seat Fees"
        description="Paymo charges $11.90/user/month with no GL or team payouts. CherryWorks Pro: unlimited users, full accounting, and 1099 exports from $39/mo."
        path="/switch-from-paymo"
      />

      <section className="pt-[100px] pb-8 md:pb-10" style={{ background: "var(--gradient-hero)" }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-8 md:pt-12 md:pb-10">
          <div className="max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[3px] mb-4" style={{ color: "#cf3339" }}>Switch from Paymo</p>
            <h1 className="text-4xl md:text-6xl font-bold text-white tracking-tight leading-[1.1]">
              Paymo is great for small teams.{" "}
              <span style={{ color: "rgba(255,255,255,0.4)" }}>You're ready to scale.</span>
            </h1>
            <p className="mt-6 text-lg md:text-xl leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>
              Paymo was perfect when you were five people. Now every new hire costs you $12/month in seat fees — and you still can't pay a team member or close your books. Time to graduate.
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
            <h2 className="text-3xl md:text-4xl font-bold text-white">Why firms switch from Paymo</h2>
            <p className="mt-4 text-lg" style={{ color: "rgba(255,255,255,0.45)" }}>Every one of these is something Paymo can't do — or doesn't offer at all.</p>
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
            <p className="mt-3 text-base" style={{ color: "rgba(255,255,255,0.45)" }}>Where CherryWorks Pro wins — and where Paymo still has the edge.</p>
          </div>
          <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="grid grid-cols-3 text-center py-4 px-6" style={{ background: "rgba(255,255,255,0.04)" }}>
              <div className="text-left"><span className="text-xs font-bold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.4)" }}>Feature</span></div>
              <div><span className="text-sm font-bold" style={{ color: "#cf3339" }}>CherryWorks Pro</span></div>
              <div><span className="text-sm font-bold" style={{ color: "rgba(255,255,255,0.5)" }}>Paymo</span></div>
            </div>
            {comparison.map((r, i) => (
              <div key={i} className="grid grid-cols-3 items-center py-3 px-6" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                <p className="text-sm font-medium text-white">{r.feature}</p>
                <div className="text-center">{r.cw ? <CheckCircle className="w-5 h-5 mx-auto" style={{ color: "#22c55e" }} /> : <X className="w-5 h-5 mx-auto" style={{ color: "#ef4444", opacity: 0.6 }} />}</div>
                <div className="text-center">{r.comp ? <CheckCircle className="w-5 h-5 mx-auto" style={{ color: "#22c55e" }} /> : <X className="w-5 h-5 mx-auto" style={{ color: "#ef4444", opacity: 0.6 }} />}</div>
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm text-center" style={{ color: "rgba(255,255,255,0.35)" }}>
            Paymo is solid for small teams. CherryWorks Pro is built for firms ready to scale operations and accounting in one platform.
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
              { icon: Upload, step: "1", title: "Export from Paymo", desc: "Export your clients, projects, and time entries as CSV files from Paymo's settings." },
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
            <h2 className="text-3xl md:text-4xl font-bold text-white" data-testid="what-you-get-heading">What scaling actually looks like</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {[
              { icon: Clock, title: "Full general ledger", desc: "Chart of accounts, journal entries, trial balance, and bank reconciliation — built in." },
              { icon: Shield, title: "Team payouts", desc: "Auto-created payouts when invoices are sent. Track ACH, Zelle, wire. Export 1099 totals." },
              { icon: Zap, title: "Unlimited users", desc: "No $11.90/user/month. Add your entire team on any plan. Scale without seat-fee anxiety." },
              { icon: Upload, title: "25+ built-in reports", desc: "Project profitability, utilization, AR aging — the reporting Paymo doesn't offer." },
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
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">Ready to switch from Paymo?</h2>
          <p className="text-lg mb-10" style={{ color: "rgba(255,255,255,0.5)" }}>
            14-day free trial. Full access. Import your Paymo data in minutes.
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
