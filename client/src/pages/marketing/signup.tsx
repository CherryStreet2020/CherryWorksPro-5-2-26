import { useState, useEffect, useMemo } from "react";
import { Link } from "wouter";
import { Eye, EyeOff, CheckCircle2, CreditCard, Check, X, Clock, DollarSign, BarChart3, Shield, ArrowLeft } from "lucide-react";
import { BrandLockup } from "@/components/shared/brand-lockup";
import { SEO } from "@/components/seo";
import { MarketingChatBubble } from "@/components/marketing/marketing-chat-bubble";
import { isValidStripeUrl } from "@/lib/url-validation";

const plans = [
  { id: "STARTER", name: "Starter", monthly: 39, annual: 31, capacity: "Up to 5 clients · Unlimited users", features: "5 clients · 3 projects · Full GL" },
  { id: "PROFESSIONAL", name: "Professional", monthly: 89, annual: 71, capacity: "Unlimited clients · Unlimited users", popular: true, features: "Unlimited · Approvals · Payouts · API" },
  { id: "BUSINESS", name: "Business", monthly: 159, annual: 127, capacity: "Unlimited clients · API · Custom branding", features: "Period closes · Dunning · Multi-entity" },
];

function PasswordChecks({ password }: { password: string }) {
  const checks = [
    { label: "At least 8 characters", met: password.length >= 8 },
    { label: "Uppercase letter", met: /[A-Z]/.test(password) },
    { label: "Lowercase letter", met: /[a-z]/.test(password) },
    { label: "Number", met: /[0-9]/.test(password) },
  ];
  if (!password) return null;
  return (
    <div className="mt-2 space-y-1" data-testid="password-checks">
      {checks.map((c) => (
        <div key={c.label} className="flex items-center gap-1.5">
          {c.met
            ? <Check className="w-3.5 h-3.5 text-green-500" />
            : <X className="w-3.5 h-3.5 text-red-400" />}
          <span className="text-xs" style={{ color: c.met ? "#22c55e" : "#f87171" }}>{c.label}</span>
        </div>
      ))}
    </div>
  );
}

const valueProps = [
  { icon: Clock, title: "Live in 5 minutes", desc: "Guided setup wizard walks you through everything. Import from 8 platforms or start fresh." },
  { icon: DollarSign, title: "Save $100+/mo vs competitors", desc: "A 10-person firm pays $142/mo on FreshBooks. CherryWorks Pro Starter: $39/mo. Zero per-user fees." },
  { icon: BarChart3, title: "The reports you've always wanted", desc: "Revenue trends, AR aging, utilization, profitability, WIP, cash flow — all built in, not bolted on." },
];

const featureHighlights = [
  "Full General Ledger",
  "Unlimited Users",
  "AI Receipt Scanner",
  "Team Payouts",
  "Client Portal",
  "22+ Features",
  "Marketing Hub (Business plan)",
  "Marketing Hub CRM",
];

const platformLogos = ["FreshBooks", "QuickBooks", "Harvest", "Xero", "Wave", "BigTime", "Scoro", "Paymo"];

const industryPills = ["Consulting Firms", "Agencies", "IT Services", "Architecture", "Legal", "Engineering"];

export default function SignupPage() {
  const [firmName, setFirmName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState("PROFESSIONAL");
  const [annual, setAnnual] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const generatedSlug = firmName.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);

  const passwordValid = useMemo(() => {
    return password.length >= 8
      && /[A-Z]/.test(password)
      && /[a-z]/.test(password)
      && /[0-9]/.test(password);
  }, [password]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const planParam = params.get("plan");
    if (planParam && ["STARTER", "PROFESSIONAL", "BUSINESS"].includes(planParam.toUpperCase())) {
      setSelectedPlan(planParam.toUpperCase());
    }
    if (params.get("annual") === "true") {
      setAnnual(true);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const signupRes = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ firmName, firstName, lastName, email, password, plan: selectedPlan }),
      });

      const csrfToken = signupRes.headers.get("X-CSRF-Token") || "";
      const signupData = await signupRes.json();

      if (!signupRes.ok) {
        throw new Error(signupData.message || "Signup failed");
      }

      const checkoutRes = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        credentials: "include",
        body: JSON.stringify({ plan: selectedPlan, annual }),
      });

      if (!checkoutRes.ok) {
        const data = await checkoutRes.json();
        throw new Error(data.message || "Could not start checkout");
      }

      const checkoutData = await checkoutRes.json();
      if (checkoutData.url && isValidStripeUrl(checkoutData.url)) {
        window.location.href = checkoutData.url;
      } else if (checkoutData.url) {
        throw new Error("Invalid redirect URL");
      } else {
        throw new Error("No checkout URL received");
      }
    } catch (err: any) {
      setError(err.message || "Something went wrong");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen" style={{ background: "var(--gradient-hero)" }}>
      <SEO
        title="Start Your Free Trial"
        fullTitle="Start Your Free Trial — 14 Days Free, Cancel Anytime | CherryWorks Pro"
        description="Sign up for CherryWorks Pro. Full GL, unlimited users, no per-seat fees. 14-day free trial. Import from FreshBooks, QuickBooks, Harvest, Xero, and more. Live in 5 minutes."
        path="/signup"
      />

      <style>{`
        @keyframes fadeInLeft {
          from { opacity: 0; transform: translateX(-20px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes fadeInRight {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }
        .animate-fade-left { animation: fadeInLeft 0.5s ease-out both; }
        .animate-fade-right { animation: fadeInRight 0.6s ease-out 0.1s both; }
        .animate-stagger-1 { animation: fadeInLeft 0.5s ease-out 0.1s both; }
        .animate-stagger-2 { animation: fadeInLeft 0.5s ease-out 0.2s both; }
        .animate-stagger-3 { animation: fadeInLeft 0.5s ease-out 0.3s both; }
      `}</style>

      <div className="max-w-7xl mx-auto px-6 lg:px-12 py-8">
        <Link href="/">
          <div className="flex items-center gap-2.5 cursor-pointer w-fit" data-testid="link-logo-home">
            <BrandLockup iconSize={34} textSize="base" />
          </div>
        </Link>
      </div>

      <div className="max-w-7xl mx-auto px-6 lg:px-12 pb-16">
        <div className="flex flex-col lg:flex-row gap-12 lg:gap-16">

          <div className="lg:w-[55%] animate-fade-left">
            <div className="mt-4 lg:mt-8">
              <h1 className="text-3xl lg:text-4xl font-bold text-white leading-tight" data-testid="text-signup-headline">
                Welcome to the platform your business deserves
              </h1>
              <p className="mt-4 text-lg" style={{ color: "rgba(255,255,255,0.6)" }}>
                Full GL, unlimited users, no per-seat fees. You'll be live in 5 minutes.
              </p>
            </div>

            <div className="mt-10 space-y-4">
              {valueProps.map((vp, i) => {
                const Icon = vp.icon;
                return (
                  <div
                    key={vp.title}
                    className={`flex items-start gap-4 rounded-xl px-5 py-4 animate-stagger-${i + 1}`}
                    style={{ background: "rgba(255,255,255,0.04)", borderLeft: "4px solid var(--color-accent, #dc2626)" }}
                    data-testid={`value-prop-${i}`}
                  >
                    <div className="mt-0.5 w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: "rgba(220,38,38,0.15)" }}>
                      <Icon className="w-5 h-5" style={{ color: "var(--color-accent-light, #f87171)" }} />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-white">{vp.title}</p>
                      <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.55)" }}>{vp.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-10" data-testid="built-for-you-strip">
              <p className="text-sm font-medium text-white mb-3">Built for professional services firms of every kind</p>
              <div className="flex flex-wrap gap-2">
                {industryPills.map((pill) => (
                  <span
                    key={pill}
                    className="px-3 py-1.5 rounded-full text-xs font-medium"
                    style={{ background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.55)", border: "1px solid rgba(255,255,255,0.1)" }}
                  >
                    {pill}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-8" data-testid="platform-logos-strip">
              <p className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: "rgba(255,255,255,0.4)" }}>
                Switch from anything in minutes
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>
                {platformLogos.map((name, i) => (
                  <span key={name}>
                    {name}{i < platformLogos.length - 1 ? " ·" : ""}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-3" data-testid="feature-highlights-grid">
              {featureHighlights.map((f) => (
                <div key={f} className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: "var(--color-accent, #dc2626)" }} />
                  <span className="text-sm text-white">{f}</span>
                </div>
              ))}
            </div>

            <div className="mt-8 px-5 py-4 rounded-xl" style={{ border: "1px solid rgba(220,38,38,0.18)", background: "linear-gradient(135deg, rgba(220,38,38,0.08), rgba(220,38,38,0.02))" }} data-testid="card-signup-marketing-os">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full" style={{ background: "rgba(220,38,38,0.18)", color: "#f87171", border: "1px solid rgba(220,38,38,0.28)" }}>
                  Included in Business plan
                </span>
              </div>
              <p className="text-sm font-bold text-white mb-1">Marketing Hub — Prospect / Client Separation</p>
              <p className="text-xs leading-relaxed mb-2" style={{ color: "rgba(255,255,255,0.5)" }}>
                Contacts &amp; companies CRM, tags, segments, campaigns, and sequences. Marketing prospects live in separate database tables from your billing clients — no cross-contamination between marketing and billing records.
              </p>
              <p className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
                Pick the Business plan to turn Marketing Hub on from day one.{" "}
                <Link href="/marketing">
                  <span className="underline cursor-pointer" style={{ color: "#f87171" }} data-testid="link-signup-marketing-os">See details</span>
                </Link>
              </p>
            </div>

            <div className="mt-10 flex items-center gap-3 px-5 py-3.5 rounded-xl" style={{ border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)" }} data-testid="guarantee-badge">
              <Shield className="w-5 h-5 shrink-0" style={{ color: "rgba(255,255,255,0.5)" }} />
              <p className="text-sm" style={{ color: "rgba(255,255,255,0.55)" }}>
                14-day free trial · No credit card charged during trial · Cancel anytime
              </p>
            </div>

            <p className="mt-10 text-xs hidden lg:block" style={{ color: "rgba(255,255,255,0.25)" }}>
              &copy; {new Date().getFullYear()} CherryWorks Pro. All rights reserved.
            </p>
          </div>

          <div className="lg:w-[45%] animate-fade-right">
            <div className="lg:hidden text-center mb-6">
              <h2 className="text-xl font-bold text-white">Start your free trial</h2>
              <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.5)" }}>No commitment. Full access. Live in 5 minutes.</p>
            </div>

            <div
              className="rounded-2xl p-8"
              style={{
                background: "var(--lux-surface)",
                boxShadow: "0 0 0 1px rgba(220,38,38,0.1), 0 24px 64px rgba(0,0,0,0.3), 0 0 40px rgba(220,38,38,0.04)",
                borderRadius: "16px",
              }}
              data-testid="signup-form-card"
            >
              <h2 className="text-xl font-bold mb-1 hidden lg:block" style={{ color: "var(--lux-text)" }}>Start your free trial</h2>
              <p className="text-sm mb-6 hidden lg:block" style={{ color: "var(--lux-text-muted)" }}>No commitment. Full access. Live in 5 minutes.</p>

              {error && (
                <div className="mb-4 px-4 py-3 rounded-lg text-sm" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }} data-testid="signup-error">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--lux-text)" }}>Firm / Company Name</label>
                  <input type="text" value={firmName} onChange={(e) => setFirmName(e.target.value)} required className="w-full px-4 py-2.5 text-sm rounded-lg" style={{ background: "var(--color-surface-0)", border: "1px solid var(--lux-border)", color: "var(--lux-text)" }} placeholder="Your firm name" data-testid="input-firm-name" />
                  {generatedSlug && (
                    <p className="text-xs mt-1.5" style={{ color: "var(--lux-text-muted)" }} data-testid="text-slug-preview">
                      Your firm slug will be: <strong style={{ color: "var(--lux-text)" }}>{generatedSlug}</strong>
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--lux-text)" }}>First Name</label>
                    <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} required className="w-full px-4 py-2.5 text-sm rounded-lg" style={{ background: "var(--color-surface-0)", border: "1px solid var(--lux-border)", color: "var(--lux-text)" }} placeholder="Jane" data-testid="input-signup-firstName" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--lux-text)" }}>Last Name</label>
                    <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} required className="w-full px-4 py-2.5 text-sm rounded-lg" style={{ background: "var(--color-surface-0)", border: "1px solid var(--lux-border)", color: "var(--lux-text)" }} placeholder="Doe" data-testid="input-signup-lastName" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--lux-text)" }}>Email</label>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full px-4 py-2.5 text-sm rounded-lg" style={{ background: "var(--color-surface-0)", border: "1px solid var(--lux-border)", color: "var(--lux-text)" }} placeholder="you@yourfirm.com" autoComplete="email" data-testid="input-signup-email" />
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--lux-text)" }}>Password</label>
                  <div className="relative">
                    <input type={showPass ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} className="w-full px-4 py-2.5 text-sm rounded-lg pr-10" style={{ background: "var(--color-surface-0)", border: "1px solid var(--lux-border)", color: "var(--lux-text)" }} placeholder="8+ chars, upper, lower, number" autoComplete="new-password" data-testid="input-signup-password" />
                    <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: "var(--lux-text-muted)" }}>
                      {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <PasswordChecks password={password} />
                </div>

                <div>
                  <label className="block text-xs font-medium mb-2" style={{ color: "var(--lux-text)" }}>Select Plan</label>
                  <div className="space-y-2">
                    {plans.map((plan) => (
                      <button key={plan.id} type="button" onClick={() => setSelectedPlan(plan.id)} className="w-full flex items-center justify-between px-4 py-3 rounded-lg text-left transition-all" style={{ background: selectedPlan === plan.id ? "var(--color-accent-soft)" : "var(--color-surface-0)", border: selectedPlan === plan.id ? "2px solid var(--color-accent)" : "1px solid var(--lux-border)" }} data-testid={`plan-select-${plan.id}`}>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold" style={{ color: "var(--lux-text)" }}>{plan.name}</span>
                            {plan.popular && (<span className="text-xs font-bold px-1.5 py-0.5 rounded-full text-white" style={{ background: "var(--gradient-brand)" }}>Popular</span>)}
                          </div>
                          <span className="text-xs" style={{ color: "var(--lux-text-muted)" }}>{plan.features}</span>
                        </div>
                        <span className="text-sm font-bold" style={{ color: selectedPlan === plan.id ? "var(--color-accent)" : "var(--lux-text-secondary)" }}>${annual ? plan.annual : plan.monthly}<span className="text-xs font-normal">/mo</span></span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="px-3 py-3 rounded-lg" style={{ background: "var(--color-surface-0)", border: `1.5px solid ${annual ? "var(--color-accent)" : "var(--lux-border)"}` }}>
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold" style={{ color: "var(--lux-text-primary)" }}>
                        {annual ? "Annual billing" : "Monthly billing"}
                      </span>
                      <span className="text-xs mt-0.5" style={{ color: "var(--lux-text-muted)" }}>
                        {annual
                          ? `$${(plans.find(p => p.id === selectedPlan)?.annual ?? 0) * 12}/yr — billed once per year`
                          : `$${plans.find(p => p.id === selectedPlan)?.monthly ?? 0}/mo — billed each month`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium" style={{ color: annual ? "var(--lux-text-muted)" : "var(--lux-text-secondary)" }}>Annual</span>
                      <button type="button" onClick={() => setAnnual(!annual)} className="relative w-10 h-5 rounded-full transition-colors" style={{ background: annual ? "var(--color-accent)" : "var(--lux-border)" }} data-testid="toggle-annual">
                        <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform" style={{ left: annual ? "22px" : "2px" }} />
                      </button>
                      {annual && <span className="text-xs font-bold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e" }}>Save 20%</span>}
                    </div>
                  </div>
                </div>

                <button type="submit" disabled={loading || !firmName || !firstName || !lastName || !email || !passwordValid} className="w-full px-4 py-3 text-sm font-semibold text-white rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2" style={{ background: "var(--gradient-brand)" }} data-testid="button-signup-submit">
                  <CreditCard className="w-4 h-4" />
                  {loading ? "Creating your account..." : "Continue to Payment"}
                </button>
              </form>

              <p className="text-xs text-center mt-4" style={{ color: "var(--lux-text-muted)" }}>
                Your card won't be charged for 14 days. Cancel anytime during trial.
              </p>

              <div className="mt-6 pt-4 text-center" style={{ borderTop: "1px solid var(--lux-border)" }}>
                <p className="text-sm" style={{ color: "var(--lux-text-muted)" }}>
                  Already have an account?{" "}
                  <Link href="/login"><span className="font-semibold cursor-pointer" style={{ color: "var(--color-accent)" }} data-testid="link-login">Log in</span></Link>
                </p>
              </div>
            </div>

            <p className="mt-8 text-xs text-center lg:hidden" style={{ color: "rgba(255,255,255,0.25)" }}>
              &copy; {new Date().getFullYear()} CherryWorks Pro. All rights reserved.
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 lg:px-12 pb-8">
        <Link href="/">
          <span className="text-sm font-medium inline-flex items-center gap-1 cursor-pointer" style={{ color: "rgba(255,255,255,0.4)" }} data-testid="link-back-to-home">
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to home
          </span>
        </Link>
      </div>

      <MarketingChatBubble />
    </div>
  );
}
