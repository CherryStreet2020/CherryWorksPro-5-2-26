/**
 * Top-of-app banners about the account itself:
 *   • VerifyEmailBanner — the owner has not confirmed their address yet.
 *   • TrialCountdownBanner — a no-card trial ends within 3 days.
 */
import { useState } from "react";
import { Link } from "wouter";
import { MailCheck, Clock } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useBillingStatus } from "@/hooks/use-billing-status";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export function VerifyEmailBanner() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  if (!user || (user as any).emailVerifiedAt) return null;

  const resend = async () => {
    setSending(true);
    try {
      const res = await apiRequest("POST", "/api/auth/resend-verification");
      const data = await res.json();
      setSent(true);
      toast({ title: data.alreadyVerified ? "Already verified" : "Verification email sent", description: data.alreadyVerified ? "Reload the page." : `Check ${user.email} for the link. It works for 24 hours.` });
    } catch (err: any) {
      toast({ title: "Could not send", description: err?.message || "Try again in a moment.", variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2 text-sm" style={{ background: "#fffbeb", borderBottom: "1px solid #fde68a" }} data-testid="banner-verify-email">
      <div className="flex items-center gap-2 min-w-0">
        <MailCheck className="w-4 h-4 text-amber-600 flex-shrink-0" />
        <span className="text-amber-900 truncate">Confirm <strong>{user.email}</strong> to unlock team invites and sending invoices.</span>
      </div>
      <button onClick={resend} disabled={sending || sent} className="text-amber-800 underline font-medium whitespace-nowrap disabled:opacity-60" data-testid="button-resend-verification">
        {sending ? "Sending…" : sent ? "Sent — check your inbox" : "Resend verification email"}
      </button>
    </div>
  );
}

export function TrialCountdownBanner() {
  const { data: billing } = useBillingStatus();
  const { user } = useAuth();
  if (!billing || billing.subscriptionStatus !== "trialing" || billing.hasSubscription || !billing.trialEndsAt || billing.planTier === "ENTERPRISE") return null;
  const msLeft = new Date(billing.trialEndsAt).getTime() - Date.now();
  const daysLeft = Math.ceil(msLeft / 86_400_000);
  if (daysLeft > 3) return null;
  const when = daysLeft <= 0 ? "today" : daysLeft === 1 ? "tomorrow" : `in ${daysLeft} days`;
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2 text-sm" style={{ background: "#eff6ff", borderBottom: "1px solid #bfdbfe" }} data-testid="banner-trial-countdown">
      <div className="flex items-center gap-2 min-w-0">
        <Clock className="w-4 h-4 text-blue-600 flex-shrink-0" />
        <span className="text-blue-900">Your free trial ends <strong>{when}</strong>. Nothing is deleted — the workspace pauses until a plan is chosen.</span>
      </div>
      {user?.role === "ADMIN" && (
        <Link href="/settings/billing" className="text-blue-800 underline font-medium whitespace-nowrap" data-testid="link-trial-choose-plan">Choose a plan</Link>
      )}
    </div>
  );
}
