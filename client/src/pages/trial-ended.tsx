/**
 * Full-screen stop for a workspace whose plan is inactive (trial ended
 * without a card, or subscription gone). Admins pick a plan and go to Stripe
 * Checkout; everyone else is told whom to ask. Data is untouched.
 */
import { useEffect, useState } from "react";
import { CreditCard, LogOut, ShieldCheck } from "lucide-react";
import { BrandLockup } from "@/components/shared/brand-lockup";
import { useAuth } from "@/lib/auth";
import { useBillingStatus } from "@/hooks/use-billing-status";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isValidStripeUrl } from "@/lib/url-validation";
import { useDocumentTitle } from "@/lib/use-document-title";
import { DeletionBanner } from "@/components/deletion-banner";
import { VerifyEmailBanner } from "@/components/account-banners";

const PLANS = [
  { id: "STARTER", name: "Starter", blurb: "5 clients · 3 projects · Full GL", monthly: 39, annual: 379 },
  { id: "PROFESSIONAL", name: "Professional", blurb: "Unlimited · Approvals · Payouts · API", monthly: 89, annual: 849, popular: true },
  { id: "BUSINESS", name: "Business", blurb: "Period closes · Dunning · Multi-entity", monthly: 159, annual: 1499 },
];

/** Back from Stripe with a session_id: the webhook usually lands within seconds; poll before offering anything. */
function useCheckoutSettling() {
  const [settling, setSettling] = useState(() => new URLSearchParams(window.location.search).has("session_id"));
  const { refetch } = useBillingStatus();
  useEffect(() => {
    if (!settling) return;
    let tries = 0;
    const id = setInterval(async () => {
      tries++;
      const r = await refetch();
      if (r.data && !r.data.planInactive) { clearInterval(id); window.location.replace("/getting-started?welcome=true"); return; }
      if (tries >= 20) { clearInterval(id); setSettling(false); } // ~60s, then fall back to the picker
    }, 3000);
    return () => clearInterval(id);
  }, [settling, refetch]);
  return settling;
}

export default function TrialEndedPage() {
  useDocumentTitle("Choose a plan");
  const { user, logout } = useAuth();
  const { data: billing } = useBillingStatus();
  const settling = useCheckoutSettling();
  const [plan, setPlan] = useState("PROFESSIONAL");
  const [annual, setAnnual] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const isAdmin = user?.role === "ADMIN";
  // Also reachable at /choose-plan during a live trial (banner + reminder emails).
  const stillActive = billing ? !billing.planInactive : false;
  const ended = stillActive ? "Choose your plan" : billing?.planTier === "EXPIRED" ? "Your subscription has ended" : "Your free trial has ended";

  const checkout = async () => {
    setLoading(true); setError("");
    try {
      const res = await apiRequest("POST", "/api/billing/checkout", { plan, annual });
      const data = await res.json();
      if (data.url && isValidStripeUrl(data.url)) window.location.href = data.url;
      else throw new Error("No checkout URL received");
    } catch (err: any) {
      setError(err?.message || "Could not start checkout"); setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10" style={{ background: "var(--gradient-hero)" }}>
      <div className="w-full max-w-lg rounded-2xl overflow-hidden" style={{ background: "var(--lux-surface)", border: "1px solid var(--lux-border)" }} data-testid="trial-ended-card">
        <DeletionBanner />
        <VerifyEmailBanner />
        <div className="p-8">
        <div className="flex justify-center mb-6"><BrandLockup /></div>
        {settling ? (
          <div className="text-center py-8" data-testid="checkout-settling">
            <h1 className="text-2xl font-bold" style={{ color: "var(--lux-text)" }}>Confirming your subscription…</h1>
            <p className="mt-2 text-sm" style={{ color: "var(--lux-text-muted)" }}>Stripe is telling us about your plan. This usually takes a few seconds.</p>
          </div>
        ) : (<>
        <h1 className="text-2xl font-bold text-center" style={{ color: "var(--lux-text)" }}>{ended}</h1>
        <p className="mt-2 text-sm text-center" style={{ color: "var(--lux-text-muted)" }}>
          <ShieldCheck className="inline w-4 h-4 mr-1 align-text-bottom" />{stillActive ? "Pick the plan that fits and add a card. Your trial keeps running; billing starts when it ends, and you can change or cancel any time." : "Everything is exactly as you left it — clients, projects, time, invoices and your books. Choose a plan to pick up where you left off."}
        </p>

        {isAdmin ? (
          <>
            <div className="mt-6 space-y-2">
              {PLANS.map(p => (
                <button key={p.id} type="button" onClick={() => setPlan(p.id)} className="w-full text-left px-4 py-3 rounded-lg flex items-center justify-between" style={{ border: `1px solid ${plan === p.id ? "var(--lux-accent)" : "var(--lux-border)"}`, background: plan === p.id ? "rgba(207,51,57,0.08)" : "transparent" }} data-testid={`button-plan-${p.id.toLowerCase()}`}>
                  <span>
                    <span className="text-sm font-semibold" style={{ color: "var(--lux-text)" }}>{p.name}{p.popular && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full text-white" style={{ background: "var(--lux-accent)" }}>Popular</span>}</span>
                    <span className="block text-xs" style={{ color: "var(--lux-text-muted)" }}>{p.blurb}</span>
                  </span>
                  <span className="text-sm font-semibold" style={{ color: "var(--lux-text)" }}>${annual ? p.annual : p.monthly}<span className="text-xs font-normal" style={{ color: "var(--lux-text-muted)" }}>/{annual ? "yr" : "mo"}</span></span>
                </button>
              ))}
            </div>
            <label className="mt-3 flex items-center justify-between text-xs" style={{ color: "var(--lux-text-muted)" }}>
              <span>{annual ? "Annual billing (two months free)" : "Monthly billing"}</span>
              <input type="checkbox" checked={annual} onChange={e => setAnnual(e.target.checked)} data-testid="toggle-annual" />
            </label>
            {error && <div className="mt-3 px-3 py-2 rounded text-sm" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }} data-testid="trial-ended-error">{error}</div>}
            <button onClick={checkout} disabled={loading} className="mt-4 w-full px-4 py-3 text-sm font-semibold text-white rounded-lg flex items-center justify-center gap-2 disabled:opacity-60" style={{ background: "var(--gradient-brand)" }} data-testid="button-trial-ended-checkout">
              <CreditCard className="w-4 h-4" />{loading ? "Opening checkout…" : "Continue to Payment"}
            </button>
            <p className="mt-3 text-xs text-center" style={{ color: "var(--lux-text-muted)" }}>Questions? Email <a href="mailto:support@cherryworkspro.com" className="underline">support@cherryworkspro.com</a>.</p>
          </>
        ) : (
          <p className="mt-6 text-sm text-center px-3 py-3 rounded-lg" style={{ background: "var(--lux-surface-alt)", color: "var(--lux-text)" }} data-testid="trial-ended-non-admin">
            Ask a workspace admin to choose a plan. You'll be able to sign back in as soon as they do.
          </p>
        )}
        {stillActive ? (
          <a href="/" className="mt-6 mx-auto block text-center text-xs underline" style={{ color: "var(--lux-text-muted)" }} data-testid="link-choose-plan-back">Back to dashboard</a>
        ) : (
          <div className="mt-6 flex items-center justify-center gap-4 text-xs" style={{ color: "var(--lux-text-muted)" }}>
            <button onClick={() => logout()} className="flex items-center gap-1.5 underline" data-testid="button-trial-ended-signout"><LogOut className="w-3.5 h-3.5" />Sign out</button>
            <DeleteWorkspaceLink />
          </div>
        )}
        </>)}
        </div>
      </div>
    </div>
  );
}

/**
 * Not continuing? The existing deletion flow stays available without a plan.
 * Same semantics as Profile: the only admin schedules the WHOLE workspace for
 * deletion in 30 days (cancel by signing in); any other user removes only
 * their own account. Password-confirmed.
 */
function DeleteWorkspaceLink() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await apiRequest("POST", "/api/account/delete-request", { password });
      const data = await res.json();
      setMsg(data.message || "Deletion scheduled. Sign back in within 30 days to cancel.");
      queryClient.invalidateQueries({ queryKey: ["/api/billing/status"] });
    } catch (err: any) {
      setMsg(err?.message?.replace(/^\d+:\s*/, "") || "Could not schedule deletion");
    } finally { setBusy(false); }
  };
  if (!open) return <button onClick={() => setOpen(true)} className="underline" data-testid="button-delete-workspace">Delete my account</button>;
  return (
    <span className="flex flex-col items-center gap-2" data-testid="delete-workspace-form">
      <span>If you are the only admin, the whole workspace is scheduled for deletion in 30 days (cancel any time by signing in). Otherwise only your own account is removed. Confirm with your password.</span>
      <span className="flex gap-2">
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" className="px-2 py-1 rounded text-xs" style={{ background: "var(--color-surface-0)", border: "1px solid var(--lux-border)", color: "var(--lux-text)" }} data-testid="input-delete-password" />
        <button onClick={submit} disabled={busy || !password} className="underline disabled:opacity-60" data-testid="button-delete-confirm">{busy ? "…" : "Schedule deletion"}</button>
      </span>
      {msg && <span data-testid="delete-workspace-message">{msg}</span>}
    </span>
  );
}
