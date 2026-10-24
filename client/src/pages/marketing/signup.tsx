import { useState, useEffect, useMemo } from "react";
import { Link } from "wouter";
import { Eye, EyeOff, Check, X, ArrowLeft } from "lucide-react";
import { BrandLockup } from "@/components/shared/brand-lockup";
import { SEO } from "@/components/seo";
import { MarketingChatBubble } from "@/components/marketing/marketing-chat-bubble";
import { Display, Eyebrow, FORM } from "@/components/marketing/kit";
import { isValidStripeUrl } from "@/lib/url-validation";
import { PLAN_PRICING, annualPerMonth, type PlanId } from "@shared/plan-pricing";

const plans = [
  { id: "STARTER", name: "Starter", monthly: PLAN_PRICING.STARTER.monthly, annual: annualPerMonth("STARTER"), capacity: "Up to 5 clients · Unlimited users", features: "5 clients · 3 projects · Full GL" },
  { id: "PROFESSIONAL", name: "Professional", monthly: PLAN_PRICING.PROFESSIONAL.monthly, annual: annualPerMonth("PROFESSIONAL"), capacity: "Unlimited clients · Unlimited users", popular: true, features: "Unlimited clients · Support · Payouts" },
  { id: "BUSINESS", name: "Business", monthly: PLAN_PRICING.BUSINESS.monthly, annual: annualPerMonth("BUSINESS"), capacity: "Unlimited clients · Unlimited users", features: "Marketing Hub · Period closes · Dunning · Multi-entity" },
];

const LABEL = FORM.label;
const FIELD = `${FORM.field} ${FORM.border} h-12`;
const NOTICE = "mb-5 border-l-2 border-[#15171C] bg-[#F2F0EB] px-4 py-3 text-[14px] leading-relaxed text-[#5C606A]";
const NOTICE_LINK = "font-medium text-[#15171C] underline decoration-[#CFCBC3] underline-offset-4 hover:decoration-[#15171C]";

const reassurance = [
  "A 14-day trial on the plan you pick. Professional is selected to start.",
  "Unlimited users on every plan.",
  "Cancel anytime before day 15 and you pay nothing.",
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
    <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1" data-testid="password-checks">
      {checks.map((c) => (
        <div key={c.label} className="flex items-center gap-1.5">
          {c.met
            ? <Check className="h-3.5 w-3.5 text-[#2F7D4F]" aria-hidden="true" />
            : <X className="h-3.5 w-3.5 text-[#9AA0AA]" aria-hidden="true" />}
          <span className={`text-[13px] ${c.met ? "text-[#2F7D4F]" : "text-[#6E727B]"}`}>{c.label}</span>
        </div>
      ))}
    </div>
  );
}

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
  // Stripe's cancel_url brings a signed-in owner back here. Their workspace
  // already exists, so the form collapses to "finish billing" instead of
  // inviting a second signup (which used to create a duplicate "firm-1" org).
  const [resume, setResume] = useState<{ name: string; chargeNote: string } | null>(null);
  const [closed, setClosed] = useState<string | null>(null);

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
    fetch("/api/auth/signup-status").then(r => r.ok ? r.json() : null).then(st => { if (st && st.enabled === false) setClosed(st.message || "New signups are paused right now."); }).catch(() => {});
    if (params.get("checkout") === "canceled") {
      fetch("/api/auth/me", { credentials: "include" })
        .then(r => (r.ok ? r.json() : null))
        .then(me => {
          if (!me?.id) return;
          // Recognise the signed-in owner IMMEDIATELY (the form must never invite a
          // second signup); the charge note refines itself once billing status arrives.
          const name = me.name || me.firstName || me.email || "there";
          setResume({ name, chargeNote: "Billing starts as soon as you complete checkout." });
          fetch("/api/billing/status", { credentials: "include" })
            .then(r => (r.ok ? r.json() : null))
            .then(b => {
              // The server's own effective checkout policy, not the raw signup date.
              const ends = b?.checkoutTrialEnd ? new Date(b.checkoutTrialEnd) : null;
              if (ends && ends.getTime() > Date.now()) {
                setResume({ name, chargeNote: `Your card won't be charged until ${ends.toLocaleDateString("en-US", { month: "long", day: "numeric" })}. Cancel any time before then.` });
              }
            })
            .catch(() => {});
        })
        .catch(() => {});
    }
  }, []);

  const startCheckout = async (csrfToken: string) => {
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
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (resume) {
        const tokenRes = await fetch("/api/csrf-token", { credentials: "include" });
        if (!tokenRes.ok) throw new Error("Your session has expired. Please log in and continue from Settings → Billing.");
        const { token } = await tokenRes.json();
        await startCheckout(token);
        return;
      }

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

      await startCheckout(csrfToken);
    } catch (err: any) {
      setError(err.message || "Something went wrong");
      setLoading(false);
    }
  };

  const annualSaving = Math.round(
    (1 - PLAN_PRICING[selectedPlan as PlanId].annual / (PLAN_PRICING[selectedPlan as PlanId].monthly * 12)) * 100,
  );

  return (
    <div className="flex min-h-screen flex-col bg-[#FBFAF8] font-display text-[#5C606A] antialiased">
      <SEO path="/signup" />

      <header className="mx-auto flex h-20 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link href="/" className="block w-fit" data-testid="link-logo-home" aria-label="CherryWorks Pro home">
          <BrandLockup iconSize={32} textSize="base" tone="light" />
        </Link>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[#6E727B] hover:text-[#15171C]"
          data-testid="link-back-to-home"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to home
        </Link>
      </header>

      <main id="main-content" className="flex-1">
        <div className="mx-auto w-full max-w-6xl px-5 pb-20 pt-6 sm:px-8 lg:pt-14">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-20">
            <div className="lg:sticky lg:top-10 lg:self-start lg:pt-4">
              <Eyebrow>Free for 14 days</Eyebrow>
              <Display testId="text-signup-headline" className="mt-4 !text-[40px] md:!text-[56px]">
                Start your trial
              </Display>
              <p className="mt-5 max-w-md text-[18px] leading-[1.5] text-[#5C606A] md:text-[19px]">
                Set up your firm’s workspace and choose a plan. You can invite your team once you’re in.
              </p>
              <ul className="mt-8 max-w-md border-t border-[#E6E3DD]">
                {reassurance.map((line) => (
                  <li key={line} className="flex gap-3 border-b border-[#E6E3DD] py-3.5 text-[15.5px] leading-[1.55] text-[#15171C]">
                    <Check className="mt-1 h-4 w-4 shrink-0 text-[#CF3339]" aria-hidden="true" />
                    {line}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <div
                className="border-t border-[#15171C] pt-6"
                data-testid="signup-form-card"
              >
                <h2 className="text-[24px] font-medium tracking-[-0.015em] text-[#15171C]">
                  {resume ? "Finish setting up billing" : "Create your account"}
                </h2>
                <p className="mb-6 mt-1.5 text-[15px] leading-relaxed text-[#6E727B]">
                  {resume ? `Welcome back, ${resume.name}. Your workspace is ready — pick a plan to continue.` : "Next you add a card on Stripe’s checkout page. Nothing is charged today."}
                </p>
                {closed && !resume && (
                  <div className={NOTICE} data-testid="signup-closed-notice">
                    <strong className="font-medium text-[#15171C]">Signups are closed for the moment.</strong> {closed} Want a heads-up when they reopen? <a href="/contact" className={NOTICE_LINK}>Get in touch</a>.
                  </div>
                )}
                {resume && (
                  <div className={NOTICE} data-testid="signup-resume-notice">
                    Checkout was canceled, but your account was created. You can also do this later from <a href="/settings/billing" className={NOTICE_LINK}>Settings → Billing</a>, or <a href="/getting-started" className={NOTICE_LINK}>go to your dashboard</a> now.
                  </div>
                )}

                {error && (
                  <div role="alert" className={`mb-5 ${FORM.alert}`} data-testid="signup-error">
                    {error}
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
                  {!resume && (<>
                  <div>
                    <label htmlFor="signup-firm-name" className={LABEL}>Firm or company name</label>
                    <input id="signup-firm-name" type="text" value={firmName} onChange={(e) => setFirmName(e.target.value)} required className={FIELD} placeholder="Your firm name" data-testid="input-firm-name" />
                    {generatedSlug && (
                      <p className="mt-1.5 text-[13px] text-[#6E727B]" data-testid="text-slug-preview">
                        Your firm slug will be: <strong className="font-medium text-[#15171C]">{generatedSlug}</strong>
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="signup-first-name" className={LABEL}>First name</label>
                      <input id="signup-first-name" type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} required className={FIELD} placeholder="Jane" data-testid="input-signup-firstName" />
                    </div>
                    <div>
                      <label htmlFor="signup-last-name" className={LABEL}>Last name</label>
                      <input id="signup-last-name" type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} required className={FIELD} placeholder="Doe" data-testid="input-signup-lastName" />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="signup-email" className={LABEL}>Work email</label>
                    <input id="signup-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className={FIELD} placeholder="you@yourfirm.com" autoComplete="email" data-testid="input-signup-email" />
                  </div>

                  <div>
                    <label htmlFor="signup-password" className={LABEL}>Password</label>
                    <div className="relative">
                      <input id="signup-password" type={showPass ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} className={`${FIELD} pr-11`} placeholder="8+ chars, upper, lower, number" autoComplete="new-password" data-testid="input-signup-password" />
                      <button type="button" onClick={() => setShowPass(!showPass)} aria-label={showPass ? "Hide password" : "Show password"} className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-[#6E727B] hover:text-[#15171C] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#CF3339]">
                        {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <PasswordChecks password={password} />
                  </div>

                  </>)}

                  <div className="pt-1">
                    <p className={LABEL}>Plan</p>
                    <div className="mt-2 space-y-2">
                      {plans.map((plan) => (
                        <button key={plan.id} type="button" onClick={() => setSelectedPlan(plan.id)} aria-pressed={selectedPlan === plan.id} className={`flex w-full items-center justify-between gap-4 rounded-lg border bg-white px-4 py-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#CF3339] ${selectedPlan === plan.id ? "border-[#15171C] ring-1 ring-[#15171C]" : "border-[#D5D2CB] hover:border-[#B5B1A9]"}`} data-testid={`plan-select-${plan.id.toLowerCase()}`}>
                          <span className="flex min-w-0 items-start gap-3">
                            <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${selectedPlan === plan.id ? "border-[#CF3339]" : "border-[#B5B1A9]"}`} aria-hidden="true">
                              {selectedPlan === plan.id && <span className="h-2 w-2 rounded-full bg-[#CF3339]" />}
                            </span>
                            <span className="min-w-0">
                              <span className="block text-[15px] font-medium text-[#15171C]">{plan.name}</span>
                              <span className="block text-[13px] text-[#6E727B]">{plan.features}</span>
                            </span>
                          </span>
                          <span className="shrink-0 text-[15px] font-medium tabular-nums text-[#15171C]">${annual ? plan.annual : plan.monthly}<span className="text-[13px] font-normal text-[#6E727B]">/mo</span></span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-4 rounded-lg border border-[#E6E3DD] bg-white px-4 py-3">
                    <div className="flex min-w-0 flex-col">
                      <span className="text-sm font-medium text-[#15171C]">
                        {annual ? "Annual billing" : "Monthly billing"}
                      </span>
                      <span className="mt-0.5 text-[13px] text-[#6E727B]">
                        {annual
                          ? `$${PLAN_PRICING[selectedPlan as PlanId].annual.toLocaleString()}/yr — billed once per year`
                          : `$${plans.find(p => p.id === selectedPlan)?.monthly ?? 0}/mo — billed each month`}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {annual && <span className="text-[13px] font-medium text-[#2F7D4F]">Save {annualSaving}%</span>}
                      <span className="text-[13px] font-medium text-[#6E727B]">Annual</span>
                      <button type="button" onClick={() => setAnnual(!annual)} role="switch" aria-checked={annual} aria-label="Bill annually" className="inline-flex h-11 items-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#CF3339]" data-testid="toggle-annual">
                        <span className={`relative block h-6 w-11 rounded-full transition-colors ${annual ? "bg-[#15171C]" : "bg-[#D5D2CB]"}`} aria-hidden="true">
                          <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${annual ? "translate-x-5" : "translate-x-0"}`} />
                        </span>
                      </button>
                    </div>
                  </div>

                  <button type="submit" disabled={loading || (!!closed && !resume) || (!resume && (!firmName || !firstName || !lastName || !email || !passwordValid))} className={FORM.submit} data-testid="button-signup-submit">
                    {loading ? (resume ? "Opening checkout…" : "Creating your account…") : "Continue to payment"}
                  </button>
                </form>

                <p className="mt-4 text-center text-[13px] text-[#6E727B]">
                  {resume ? resume.chargeNote : "You won’t be charged until day 15 · Cancel anytime"}
                </p>

                <div className="mt-6 border-t border-[#E6E3DD] pt-5 text-center">
                  <p className="text-sm text-[#6E727B]">
                    Already have an account?{" "}
                    <Link href="/login" className="font-medium text-[#15171C] underline decoration-[#CFCBC3] underline-offset-4 hover:decoration-[#15171C]" data-testid="link-login">Log in</Link>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-[#E6E3DD]">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-6 text-[13px] text-[#6E727B] sm:px-8">
          <p>&copy; {new Date().getFullYear()} CherryWorks Pro</p>
          <nav aria-label="Legal" className="flex gap-5">
            <Link href="/terms" className="hover:text-[#15171C]">Terms</Link>
            <Link href="/privacy" className="hover:text-[#15171C]">Privacy</Link>
            <Link href="/security" className="hover:text-[#15171C]">Security</Link>
          </nav>
        </div>
      </footer>

      <MarketingChatBubble />
    </div>
  );
}
