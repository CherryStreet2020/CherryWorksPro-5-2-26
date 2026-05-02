import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { CheckCircle, X, ArrowRight, Building2, Shield, ChevronDown } from "lucide-react";
import { SEO, SoftwareApplicationStructuredData, FAQStructuredData } from "@/components/seo";
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

const plans = [
  {
    name: "Starter",
    monthly: 39,
    annual: 31,
    users: "Unlimited",
    clients: "Up to 5",
    projects: "Up to 3",
    description: "Everything a lean firm needs. Full GL, expenses, AI assistant, and unlimited users — for less than most tools charge per seat.",
    cta: "Start Free Trial",
    featured: false,
  },
  {
    name: "Professional",
    monthly: 89,
    annual: 71,
    users: "Unlimited",
    clients: "Unlimited",
    projects: "Unlimited",
    description: "The toolkit that grows with you. Approvals, bank feeds, team payouts, 8-platform imports, custom branding, and full API access.",
    cta: "Start Free Trial",
    featured: true,
  },
  {
    name: "Business",
    monthly: 159,
    annual: 127,
    users: "Unlimited",
    clients: "Unlimited",
    projects: "Unlimited",
    description: "Firms that take their numbers seriously. Period closes, multi-entity, dunning automation, payment plans, and dashboards built for the people running the numbers.",
    cta: "Start Free Trial",
    featured: false,
  },
];

const featureMatrix = [
  { feature: "Team members", starter: "Unlimited", pro: "Unlimited", business: "Unlimited", enterprise: "Unlimited" },
  { feature: "Clients", starter: "Up to 5", pro: "Unlimited", business: "Unlimited", enterprise: "Unlimited" },
  { feature: "Projects", starter: "Up to 3", pro: "Unlimited", business: "Unlimited", enterprise: "Unlimited" },
  { feature: "Time tracking (week/month/day + timer)", starter: true, pro: true, business: true, enterprise: true },
  { feature: "Invoicing from billable hours", starter: true, pro: true, business: true, enterprise: true },
  { feature: "Multi-currency invoicing (30+)", starter: true, pro: true, business: true, enterprise: true },
  { feature: "PDF generation & email", starter: true, pro: true, business: true, enterprise: true },
  { feature: "Client portal with overdue alerts", starter: true, pro: true, business: true, enterprise: true },
  { feature: "Payment recording + Stripe Checkout", starter: true, pro: true, business: true, enterprise: true },
  { feature: "Estimates & proposals", starter: true, pro: true, business: true, enterprise: true },
  { feature: "Recurring invoice templates", starter: true, pro: true, business: true, enterprise: true },
  { feature: "Expense tracking with receipts", starter: true, pro: true, business: true, enterprise: true },
  { feature: "Receipt OCR (AI-powered)", starter: true, pro: true, business: true, enterprise: true },
  { feature: "CherryAssist AI helper", starter: true, pro: true, business: true, enterprise: true },
  { feature: "Full GL (chart of accounts, journal entries, trial balance, ledger)", starter: true, pro: true, business: true, enterprise: true, highlight: true },
  { feature: "Reports", starter: "Full Suite", pro: "Full Suite", business: "Full Suite", enterprise: "Full Suite" },
  { feature: "Expense analytics", starter: true, pro: true, business: true, enterprise: true },
  { feature: "Multi-currency reporting rollups", starter: true, pro: true, business: true, enterprise: true },
  { feature: "Team member payout tracking", starter: true, pro: true, business: true, enterprise: true },
  { feature: "Smart onboarding (1099/W-2/C2C)", starter: true, pro: true, business: true, enterprise: true },
  { feature: "Your logo on invoices and portal", starter: true, pro: true, business: true, enterprise: true },
  { feature: "Timesheet approval workflow", starter: false, pro: true, business: true, enterprise: true },
  { feature: "Expense approval workflow", starter: false, pro: true, business: true, enterprise: true },
  { feature: "Expense reports with GL posting", starter: true, pro: true, business: true, enterprise: true },
  { feature: "Batch expense reports", starter: false, pro: true, business: true, enterprise: true },
  { feature: "Auto-reimbursement payouts", starter: false, pro: true, business: true, enterprise: true },
  { feature: "Auto-charge recurring invoices", starter: false, pro: true, business: true, enterprise: true },
  { feature: "Custom invoice themes / branded PDFs", starter: false, pro: true, business: true, enterprise: true },
  { feature: "Project budgets", starter: false, pro: true, business: true, enterprise: true },
  { feature: "Vendor 1099 management", starter: false, pro: true, business: true, enterprise: true },
  { feature: "Stripe Connect team payouts", starter: false, pro: true, business: true, enterprise: true },
  { feature: "Bank feeds", starter: false, pro: true, business: true, enterprise: true },
  { feature: "Import wizard (8 platforms)", starter: false, pro: true, business: true, enterprise: true },
  { feature: "API access + webhooks", starter: false, pro: true, business: true, enterprise: true },
  { feature: "Close periods (month-end lock)", starter: false, pro: false, business: true, enterprise: true },
  { feature: "Year-end close", starter: false, pro: false, business: true, enterprise: true },
  { feature: "Multi-entity support", starter: false, pro: false, business: true, enterprise: true },
  { feature: "Bulk operations", starter: false, pro: false, business: true, enterprise: true },
  { feature: "Scheduled reports", starter: false, pro: false, business: true, enterprise: true },
  { feature: "Custom report builder", starter: false, pro: false, business: true, enterprise: true },
  { feature: "Audit log search", starter: false, pro: false, business: true, enterprise: true },
  { feature: "Dunning automation", starter: false, pro: false, business: true, enterprise: true },
  { feature: "Payment plans", starter: false, pro: false, business: true, enterprise: true },
  { feature: "Role-based dashboards", starter: false, pro: false, business: true, enterprise: true },
  { feature: "Multi-jurisdiction tax engine", starter: false, pro: false, business: true, enterprise: true },
  { feature: "Marketing — Contacts & Companies CRM", starter: false, pro: false, business: true, enterprise: true, highlight: true },
  { feature: "Marketing — Tags & Segments", starter: false, pro: false, business: true, enterprise: true },
  { feature: "Marketing — Campaigns", starter: false, pro: false, business: true, enterprise: true },
  { feature: "Marketing — Sequences (auto-stop on reply)", starter: false, pro: false, business: true, enterprise: true },
  { feature: "Marketing — Activity timeline", starter: false, pro: false, business: true, enterprise: true },
  { feature: "Marketing — Bulk contacts CSV import", starter: false, pro: false, business: true, enterprise: true },
  { feature: "Marketing — Prospect / Client Separation", starter: false, pro: false, business: true, enterprise: true, highlight: true },
  { feature: "Priority email support", starter: false, pro: false, business: true, enterprise: true },
  { feature: "Dedicated onboarding call", starter: false, pro: false, business: true, enterprise: true },
  { feature: "SSO / SAML", starter: false, pro: false, business: false, enterprise: true },
  { feature: "MFA enforcement org-wide", starter: false, pro: false, business: false, enterprise: true },
  { feature: "User impersonation (support/IT)", starter: false, pro: false, business: false, enterprise: true },
  { feature: "Advanced AV scanning", starter: false, pro: false, business: false, enterprise: true },
  { feature: "Backup drill & restore", starter: false, pro: false, business: false, enterprise: true },
  { feature: "Dedicated account manager", starter: false, pro: false, business: false, enterprise: true },
  { feature: "Volume discounts", starter: false, pro: false, business: false, enterprise: true },
  { feature: "Custom contract / SLA / DPA", starter: false, pro: false, business: false, enterprise: true },
  { feature: "White-label option", starter: false, pro: false, business: false, enterprise: true },
];

const faqs = [
  { q: "Is there a free trial?", a: "Yes \u2014 14 days, full access to the Professional plan. You can downgrade to Starter or upgrade to Business anytime during or after the trial. You won't be charged until day 15." },
  { q: "What happens when I hit 5 clients on Starter?", a: "You'll be prompted to upgrade to Professional to add more clients. Your data stays intact \u2014 no migration needed, just a plan change. You won't lose access to any features." },
  { q: "What happens when I hit 3 projects on Starter?", a: "Same upgrade path \u2014 upgrade to Professional for unlimited projects. Your existing projects and data stay exactly where they are." },
  { q: "Are users really unlimited on every plan?", a: "Yes. Add as many team members as you need \u2014 1099 independents, W-2 employees, Corp-to-Corp partners. No per-user fees, ever. On any plan." },
  { q: "What if I need GL / accounting features?", a: "Full GL is included on every plan, including Starter. Chart of accounts, journal entries, trial balance, general ledger, and P&L \u2014 no upgrade required. This is one of the biggest ways CherryWorks Pro differs from QuickBooks (locks GL to $115/mo) and FreshBooks (no GL at all)." },
  { q: "Can I switch plans later?", a: "Absolutely. Upgrade or downgrade anytime. If you upgrade mid-cycle, you'll be prorated. If you downgrade, the change takes effect at the next billing date." },
  { q: "What payment methods do you accept?", a: "All major credit cards via Stripe. Annual plans can also pay by invoice." },
  { q: "Can I import data from other platforms?", a: "Yes \u2014 the Professional, Business, and Enterprise plans include import wizards for FreshBooks, QuickBooks, Harvest, Xero, Wave, BigTime, Scoro, and Paymo. Upload, preview with dry-run, execute, and rollback if needed." },
  { q: "Is my data secure?", a: "Yes. All data is encrypted in transit (SSL/TLS) and stored in isolated PostgreSQL databases. Every query is scoped to your organization \u2014 no cross-tenant data access is possible. Full audit logging tracks every financial event." },
  { q: "Can I cancel anytime?", a: "Yes. No contracts, no cancellation fees. Cancel anytime and your data remains accessible." },
  { q: "What is Marketing on the Business plan?", a: "Marketing is a full prospect-to-client layer included with the Business plan: contacts and companies CRM, tags, segments, campaigns, sequences, an activity timeline, and bulk contact import. There is no separate add-on charge \u2014 pick the Business plan and Marketing is on for your firm from day one. The Prospect / Client Separation guarantee is built in, so marketing leads never touch your billing records." },
  { q: "How does Marketing keep marketing data separate from my books?", a: "Marketing prospects and marketing companies live in physically separate database tables from your billing clients. There are no foreign keys between the two, so a marketing lead can never silently be invoiced, reported on, or paid out as a client. Promoting a prospect into a billing client is an explicit, audited step you take \u2014 never an automatic side effect. The result: no cross-contamination between marketing and billing records, by design. We label this guarantee Prospect / Client Separation." },
];

function FeatureCell({ value }: { value: boolean | string }) {
  if (value === true) return <CheckCircle className="w-4 h-4 mx-auto" style={{ color: "#22c55e" }} data-testid="icon-check" />;
  if (value === false) return <X className="w-4 h-4 mx-auto" style={{ color: "#ef4444", opacity: 0.6 }} data-testid="icon-x" />;
  return <span className="text-xs font-medium" style={{ color: "rgba(255,255,255,0.55)" }}>{value}</span>;
}

export default function PricingPage() {
  const [annual, setAnnual] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const matrixRef = useFadeIn();
  const faqRef = useFadeIn();


  return (
    <div style={{ background: "#0a0f1c" }}>
      <MarketingNav />
      <SEO
        title="Pricing"
        fullTitle="Pricing — CherryWorks Pro | Unlimited Users, Flat-Rate Plans from $39/mo"
        description="Transparent pricing. Starter $39, Professional $89, Business $159. Unlimited team members on every plan. Zero per-user fees. 14-day free trial."
        path="/pricing"
      />
      <SoftwareApplicationStructuredData />
      <FAQStructuredData faqs={faqs} />

      <section className="pt-[100px] pb-8 md:pb-10" style={{ background: "linear-gradient(135deg, #0a0f1c 0%, #111827 50%, #1a0a0a 100%)" }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-8 md:pt-12 md:pb-10 text-center">
          <div className="mb-6" data-testid="social-proof-stars">
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-white tracking-tight" data-testid="pricing-heading">Every feature. Every plan. Unlimited users.</h1>
          <p className="mt-4 text-lg max-w-2xl mx-auto" style={{ color: "rgba(255,255,255,0.65)" }}>
            No per-user fees. Full GL on every plan. Start with everything you need — upgrade when your firm outgrows the basics.
          </p>
          <div className="mt-8 inline-flex items-center gap-3 px-4 py-2 rounded-full" data-testid="billing-toggle" style={{ background: "rgba(255,255,255,0.08)" }}>
            <span className="text-sm font-medium" style={{ color: annual ? "rgba(255,255,255,0.4)" : "white" }}>Monthly</span>
            <button
              onClick={() => setAnnual(!annual)}
              className="relative w-12 h-6 rounded-full transition-colors cursor-pointer"
              style={{ background: annual ? "#cf3339" : "rgba(255,255,255,0.25)" }}
              data-testid="button-toggle-billing"
            >
              <div className="absolute top-1 w-4 h-4 rounded-full bg-white transition-transform" style={{ left: annual ? "28px" : "4px" }} />
            </button>
            <span className="text-sm font-medium" style={{ color: annual ? "white" : "rgba(255,255,255,0.4)" }}>
              Annual <span className="text-xs font-bold px-2 py-0.5 rounded-full ml-1" style={{ background: "rgba(34,197,94,0.2)", color: "#4ade80", border: "1px solid rgba(34,197,94,0.3)" }} data-testid="badge-save-20">Save 20%</span>
            </span>
          </div>
        </div>
      </section>

      <section className="py-8 md:py-12" style={{ background: "#0a0f1c" }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-5 -mt-20">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className="rounded-2xl p-7 flex flex-col relative"
                style={{
                  opacity: 1,
                  background: "rgba(255,255,255,0.03)",
                  border: plan.featured ? "2px solid #cf3339" : "1px solid rgba(255,255,255,0.06)",
                  boxShadow: plan.featured ? "0 8px 40px rgba(207,51,57,0.15)" : "var(--lux-card-shadow)",
                }}
                data-testid={`tier-card-${plan.name.toLowerCase()}`}
              >
                {plan.featured && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-xs font-bold text-white" style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)" }}>
                    Most Popular
                  </div>
                )}
                <h3 className="text-lg font-bold text-white">{plan.name}</h3>
                <p className="text-base mt-2 mb-4 leading-relaxed" style={{ color: "rgba(255,255,255,0.4)" }}>{plan.description}</p>
                <div className="flex items-baseline gap-1 mb-1">
                  <span className="text-4xl font-bold text-white">${annual ? plan.annual : plan.monthly}</span>
                  <span className="text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>/mo</span>
                </div>
                {annual && (
                  <p className="text-sm mb-3" style={{ color: "#22c55e" }}>
                    ${plan.monthly - plan.annual}/mo saved &middot; Billed ${plan.annual * 12}/yr
                  </p>
                )}
                {!annual && <div className="mb-3" />}
                <div className="space-y-1.5 mb-6">
                  <p className="text-sm font-semibold" style={{ color: "#cf3339" }}>{plan.users} users &middot; {plan.clients} clients &middot; {plan.projects} projects</p>
                  <p className="text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>Full GL &middot; Full reporting suite</p>
                  <p className="text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>Your logo on invoices and portal</p>
                  {plan.name === "Business" && (
                    <>
                      <p className="text-sm font-semibold pt-1" style={{ color: "#f87171" }} data-testid="text-business-marketing-included">Marketing included</p>
                      <p className="text-sm" style={{ color: "rgba(255,255,255,0.55)" }}>CRM, campaigns, sequences &middot; Prospect / Client Separation</p>
                    </>
                  )}
                </div>
                <Link href={`/signup?plan=${plan.name.toLowerCase()}${annual ? "&annual=true" : ""}`}>
                  <span
                    className="block text-center px-4 py-3 text-sm font-semibold rounded-lg cursor-pointer transition-opacity hover:opacity-90 mt-auto"
                    style={plan.featured
                      ? { background: "linear-gradient(135deg, #cf3339, #e74c3c)", color: "white" }
                      : { border: "1px solid rgba(255,255,255,0.15)", color: "#ffffff" }
                    }
                    data-testid={`button-signup-${plan.name.toLowerCase()}`}
                  >
                    {plan.cta}
                  </span>
                </Link>
                <p className="text-xs text-center mt-2" style={{ color: "rgba(255,255,255,0.4)" }}>14-day free trial &middot; Cancel anytime</p>
              </div>
            ))}

            {/* Enterprise */}
            <div className="rounded-2xl p-7 flex flex-col" style={{ opacity: 1, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }} data-testid="tier-card-enterprise">
              <div className="flex items-center gap-2 mb-1">
                <Building2 className="w-5 h-5" style={{ color: "#cf3339" }} />
                <h3 className="text-lg font-bold text-white">Enterprise</h3>
              </div>
              <p className="text-base mt-2 mb-4 leading-relaxed" style={{ color: "rgba(255,255,255,0.4)" }}>For large firms needing SSO, volume pricing, and a dedicated account manager</p>
              <div className="flex items-baseline gap-1 mb-1">
                <span className="text-2xl font-bold text-white">Custom</span>
              </div>
              <p className="text-sm mb-3" style={{ color: "rgba(255,255,255,0.4)" }}>Tailored to your firm</p>
              <div className="space-y-1.5 mb-6">
                <div className="flex items-center gap-1.5"><Shield className="w-3 h-3" style={{ color: "#22c55e" }} /><span className="text-sm" style={{ color: "rgba(255,255,255,0.55)" }}>SSO / SAML authentication</span></div>

                <div className="flex items-center gap-1.5"><CheckCircle className="w-3 h-3" style={{ color: "#22c55e" }} /><span className="text-sm" style={{ color: "rgba(255,255,255,0.55)" }}>Dedicated account manager</span></div>
                <div className="flex items-center gap-1.5"><CheckCircle className="w-3 h-3" style={{ color: "#22c55e" }} /><span className="text-sm" style={{ color: "rgba(255,255,255,0.55)" }}>Volume discounts</span></div>
                <div className="flex items-center gap-1.5"><CheckCircle className="w-3 h-3" style={{ color: "#22c55e" }} /><span className="text-sm" style={{ color: "rgba(255,255,255,0.55)" }}>Full white-label branding</span></div>
              </div>
              <Link href="/contact">
                <span className="block text-center px-4 py-3 text-sm font-semibold rounded-lg cursor-pointer mt-auto" style={{ border: "1px solid rgba(255,255,255,0.15)", color: "#ffffff" }}>
                  Contact Sales
                </span>
              </Link>
            </div>
          </div>

          {/* Cost comparison callout */}
          <div className="mt-10 rounded-xl p-6 text-center" style={{ background: "rgba(207,51,57,0.06)", border: "1px solid rgba(207,51,57,0.15)" }}>
            <p className="text-sm font-semibold" style={{ color: "#cf3339" }}>
              A 10-person firm pays $142/mo on FreshBooks ($43 + 9 &times; $11/user) or $110/mo on Harvest ($11/seat &times; 10).
            </p>
            <p className="text-sm font-bold mt-1" style={{ color: "#ffffff" }}>
              CherryWorks Pro Starter: ${annual ? "31" : "39"}/mo. Same team. More features. Zero per-user fees.
            </p>
          </div>
        </div>
      </section>


      <section className="py-8 md:py-12" style={{ background: "rgba(255,255,255,0.03)" }}>
        <div ref={matrixRef} className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 fade-in-section">
          <h2 className="text-2xl font-bold text-center mb-10" style={{ color: "#ffffff" }}>Compare every feature</h2>
          <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: "var(--color-brand-900)" }}>
                    <th className="text-left px-5 py-3 text-white font-semibold w-[36%]">Feature</th>
                    <th className="text-center px-3 py-3 text-white font-semibold">Starter</th>
                    <th className="text-center px-3 py-3 font-semibold" style={{ color: "#f87171" }}>Professional</th>
                    <th className="text-center px-3 py-3 text-white font-semibold">Business</th>
                    <th className="text-center px-3 py-3 text-white font-semibold">Enterprise</th>
                  </tr>
                </thead>
                <tbody>
                  {featureMatrix.map((row, i) => (
                    <tr key={i} style={{ background: (row as any).highlight ? "rgba(207,51,57,0.08)" : i % 2 === 0 ? "rgba(255,255,255,0.03)" : "#0a0f1c", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                      <td className="px-5 py-2.5 font-medium" style={{ color: (row as any).highlight ? "#f87171" : "#ffffff", fontWeight: (row as any).highlight ? 700 : 500 }}>{row.feature}</td>
                      <td className="px-3 py-2.5 text-center"><FeatureCell value={row.starter} /></td>
                      <td className="px-3 py-2.5 text-center"><FeatureCell value={row.pro} /></td>
                      <td className="px-3 py-2.5 text-center"><FeatureCell value={row.business} /></td>
                      <td className="px-3 py-2.5 text-center"><FeatureCell value={row.enterprise} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* Setup speed */}
      <section className="py-8 md:py-12" style={{ background: "#0a0f1c" }}>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="rounded-2xl p-8 text-center" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <h3 className="text-xl font-bold mb-3" style={{ color: "#ffffff" }}>Up and running in minutes, not months</h3>
            <p className="text-sm max-w-xl mx-auto mb-6" style={{ color: "rgba(255,255,255,0.55)" }}>
              Starting from scratch? The guided wizard walks you through everything. Switching platforms? Import wizards bring your data with you. Either way, you're live on day one.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              {["60-second signup", "Guided setup wizard", "Start fresh or import data", "Live on day one"].map((t, i) => (
                <span key={i} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: "rgba(34,197,94,0.08)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.15)" }}>{t}</span>
              ))}
            </div>
          </div>
        </div>
      </section>


      <section className="py-8 md:py-12" style={{ background: "#0a0f1c" }}>
        <div ref={faqRef} className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 fade-in-section">
          <h2 className="text-2xl font-bold text-center mb-10" style={{ color: "#ffffff" }} data-testid="faq-heading">Frequently asked questions</h2>
          <div className="space-y-2">
            {faqs.map((faq, i) => (
              <div key={i} className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }} data-testid={`faq-item-${i}`}>
                <button
                  className="w-full flex items-center justify-between px-5 py-4 text-left cursor-pointer"
                  style={{ background: "rgba(255,255,255,0.03)" }}
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  data-testid={`button-faq-${i}`}
                >
                  <span className="text-sm font-semibold" style={{ color: "#ffffff" }}>{faq.q}</span>
                  <ChevronDown className="w-4 h-4 flex-shrink-0 ml-3 transition-transform duration-200" style={{ color: "rgba(255,255,255,0.4)", transform: openFaq === i ? "rotate(180deg)" : "none" }} />
                </button>
                {openFaq === i && (
                  <div className="px-5 py-4" style={{ background: "#0a0f1c", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                    <p className="text-base leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>{faq.a}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-10 md:py-14" style={{ background: "linear-gradient(135deg, #1a0505 0%, #0a0f1c 50%, #1a0a0a 100%)" }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-bold text-white tracking-tight">Start your free trial today</h2>
          <p className="mt-3 text-lg" style={{ color: "rgba(255,255,255,0.6)" }}>14 days. Full access. Guided setup wizard gets you live in minutes.</p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/signup"><span className="inline-flex items-center gap-2 px-7 py-4 text-base font-bold text-white rounded-xl cursor-pointer transition-all hover:scale-[1.03]" style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)", boxShadow: "0 4px 30px rgba(207,51,57,0.4)" }}>Start Free Trial <ArrowRight className="w-4 h-4" /></span></Link>
            <Link href="/contact"><span className="inline-flex items-center gap-2 px-7 py-4 text-base font-semibold rounded-xl cursor-pointer" style={{ color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.15)" }}>Talk to Sales</span></Link>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
