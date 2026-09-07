/**
 * /verify-email?token=… — the landing page for the link in the welcome and
 * verification emails. Works signed in or out. On success, a signed-in user
 * goes straight back to the app; anyone else is pointed at sign-in.
 * Rendered outside AuthProvider (public route), so no useAuth here.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { BrandLockup } from "@/components/shared/brand-lockup";
import { useDocumentTitle } from "@/lib/use-document-title";
import { queryClient } from "@/lib/queryClient";

type State = { kind: "working" } | { kind: "ok"; signedIn: boolean; alreadyVerified: boolean } | { kind: "error"; message: string; expired: boolean };

export default function VerifyEmailPage() {
  useDocumentTitle("Verify your email");
  const [state, setState] = useState<State>({ kind: "working" });
  const fired = useRef(false);

  useEffect(() => {
    // The token is single-use; React's dev StrictMode runs effects twice.
    if (fired.current) return;
    fired.current = true;
    const token = new URLSearchParams(window.location.search).get("token") || "";
    window.history.replaceState({}, "", "/verify-email");
    fetch("/api/auth/verify-email", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ token }) })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) { setState({ kind: "error", message: data.message || "This verification link is not valid.", expired: data.code === "TOKEN_EXPIRED" }); return; }
        setState({ kind: "ok", signedIn: !!data.signedIn, alreadyVerified: !!data.alreadyVerified });
        queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      })
      .catch(() => setState({ kind: "error", message: "We couldn't reach the server. Please try the link again.", expired: false }));
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--gradient-hero)" }}>
      <div className="w-full max-w-md rounded-2xl p-8 text-center" style={{ background: "var(--lux-surface)", border: "1px solid var(--lux-border)" }} data-testid="verify-email-card">
        <div className="flex justify-center mb-6"><BrandLockup /></div>
        {state.kind === "working" && (
          <>
            <Loader2 className="w-8 h-8 mx-auto animate-spin" style={{ color: "var(--lux-accent)" }} />
            <p className="mt-4 text-sm" style={{ color: "var(--lux-text-muted)" }}>Confirming your email…</p>
          </>
        )}
        {state.kind === "ok" && (
          <>
            <CheckCircle2 className="w-10 h-10 mx-auto" style={{ color: "#22c55e" }} />
            <h1 className="mt-4 text-xl font-bold" style={{ color: "var(--lux-text)" }}>{state.alreadyVerified ? "Already verified" : "Email verified"}</h1>
            <p className="mt-2 text-sm" style={{ color: "var(--lux-text-muted)" }}>Team invites and sending invoices are unlocked for your workspace.</p>
            <a href={state.signedIn ? "/" : "/login"} className="inline-block mt-6 px-5 py-2.5 text-sm font-semibold text-white rounded-lg" style={{ background: "var(--gradient-brand)" }} data-testid="link-verify-continue">
              {state.signedIn ? "Back to your workspace" : "Sign in"}
            </a>
          </>
        )}
        {state.kind === "error" && (
          <>
            <AlertTriangle className="w-10 h-10 mx-auto" style={{ color: "#f59e0b" }} />
            <h1 className="mt-4 text-xl font-bold" style={{ color: "var(--lux-text)" }}>{state.expired ? "Link expired" : "Link not valid"}</h1>
            <p className="mt-2 text-sm" style={{ color: "var(--lux-text-muted)" }} data-testid="verify-email-error">{state.message}</p>
            <p className="mt-4 text-xs" style={{ color: "var(--lux-text-muted)" }}>Sign in and use <strong>Resend verification email</strong> in the banner at the top of the app.</p>
            <Link href="/login" className="inline-block mt-6 px-5 py-2.5 text-sm font-semibold text-white rounded-lg" style={{ background: "var(--gradient-brand)" }}>Sign in</Link>
          </>
        )}
      </div>
    </div>
  );
}
