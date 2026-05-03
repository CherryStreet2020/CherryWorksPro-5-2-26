import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Eye, EyeOff, Building2, ArrowLeft, ShieldCheck } from "lucide-react";
import { BrandLockup } from "@/components/shared/brand-lockup";
import { useToast } from "@/hooks/use-toast";
import { SEO } from "@/components/seo";

export default function LoginPage() {
  const { login, refetchUser } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [orgPickerOrgs, setOrgPickerOrgs] = useState<Array<{ slug: string; name: string }> | null>(null);
  const [autoPicking, setAutoPicking] = useState<{ slug: string; name: string } | null>(null);
  const [mfaPhase, setMfaPhase] = useState<null | "code" | "setup">(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaError, setMfaError] = useState("");
  // Setup-phase state. Filled by /api/mfa/totp/setup. Held in component
  // state (NOT persisted) so an attacker browsing back can't replay it.
  const [setupSecret, setSetupSecret] = useState<string | null>(null);
  const [setupOtpauthUrl, setSetupOtpauthUrl] = useState<string | null>(null);
  const [setupRecoveryCodes, setSetupRecoveryCodes] = useState<string[] | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const autoPickAbortRef = useRef<AbortController | null>(null);
  const autoPickCancelledRef = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth") === "required") {
      toast({ title: "Please sign in to continue" });
      window.history.replaceState({}, "", "/login");
    }
  }, [toast]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const data = await login("", email, password);
      if (data.kind === "mfa-code") {
        setMfaPhase("code");
        return;
      }
      if (data.kind === "mfa-setup") {
        setMfaPhase("setup");
        await beginMfaSetup();
        return;
      }
    } catch (err: any) {
      const raw = err?.message || "";
      try {
        const jsonPart = raw.includes("{") ? raw.slice(raw.indexOf("{")) : raw;
        const obj = JSON.parse(jsonPart);
        if (obj.needsOrgPick && obj.orgs) {
          let savedSlug: string | null = null;
          try { savedSlug = localStorage.getItem("lastOrgSlug"); } catch {}
          const match = savedSlug ? obj.orgs.find((o: { slug: string; name: string }) => o.slug === savedSlug) : null;
          if (match) {
            setOrgPickerOrgs(obj.orgs);
            setAutoPicking(match);
            await handleOrgPick(match.slug, true);
            return;
          }
          setOrgPickerOrgs(obj.orgs);
          return;
        }
      } catch {}
      setError("Invalid credentials");
    } finally {
      setLoading(false);
    }
  };

  const handleOrgPick = async (slug: string, isAutoPick = false) => {
    setLoading(true);
    setError("");
    let controller: AbortController | null = null;
    if (isAutoPick) {
      controller = new AbortController();
      autoPickAbortRef.current = controller;
      autoPickCancelledRef.current = false;
    }
    try {
      const data = await login(slug, email, password, controller ? { signal: controller.signal } : undefined);
      // CRITICAL: a multi-org user landing in an MFA-enforced org gets the
      // same {requiresMfaCode}/{requiresMfaSetup} payload as the single-org
      // path. Without this branch the picker handler would silently swallow
      // the response and leave the user staring at a frozen org picker.
      if (data.kind === "mfa-code") {
        setOrgPickerOrgs(null);
        setAutoPicking(null);
        setMfaPhase("code");
        return;
      }
      if (data.kind === "mfa-setup") {
        setOrgPickerOrgs(null);
        setAutoPicking(null);
        setMfaPhase("setup");
        await beginMfaSetup();
        return;
      }
    } catch (err: any) {
      if (isAutoPick && (autoPickCancelledRef.current || err?.name === "AbortError")) {
        return;
      }
      setError("Invalid credentials");
      setAutoPicking(null);
    } finally {
      if (isAutoPick && autoPickAbortRef.current === controller) {
        autoPickAbortRef.current = null;
      }
      if (!isAutoPick || !autoPickCancelledRef.current) {
        setLoading(false);
      }
    }
  };

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMfaError("");
    try {
      const res = await apiRequest("POST", "/api/mfa/totp/validate", { code: mfaCode.trim() });
      const data = await res.json();
      if (data?.valid) {
        await refetchUser();
        navigate("/");
        return;
      }
      setMfaError("Invalid code");
    } catch (err: any) {
      setMfaError("Invalid code");
    } finally {
      setLoading(false);
    }
  };

  const cancelMfa = () => {
    setMfaPhase(null);
    setMfaCode("");
    setMfaError("");
    setError("");
    setSetupSecret(null);
    setSetupOtpauthUrl(null);
    setSetupRecoveryCodes(null);
  };

  // The MFA gate (server/routes/middleware.ts) only permits
  // /api/mfa/totp/{setup,verify} while mfaPendingReason === "setup".
  // Calling them here lets an admin who is required-but-not-enrolled
  // complete bootstrap inline, without ever needing a fully-authenticated
  // session (which is impossible while mfaPending=true).
  const beginMfaSetup = async () => {
    setSetupLoading(true);
    setMfaError("");
    try {
      const res = await apiRequest("POST", "/api/mfa/totp/setup", {});
      const data = await res.json();
      if (data?.success) {
        setSetupSecret(data.secret);
        setSetupOtpauthUrl(data.otpauthUrl);
        setSetupRecoveryCodes(data.recoveryCodes || []);
      } else {
        setMfaError("Could not start MFA setup. Please try again.");
      }
    } catch {
      setMfaError("Could not start MFA setup. Please try again.");
    } finally {
      setSetupLoading(false);
    }
  };

  const handleSetupVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMfaError("");
    try {
      const res = await apiRequest("POST", "/api/mfa/totp/verify", { code: mfaCode.trim() });
      const data = await res.json();
      if (data?.success && data?.enabled) {
        await refetchUser();
        navigate("/");
        return;
      }
      setMfaError("Invalid code");
    } catch {
      setMfaError("Invalid code");
    } finally {
      setLoading(false);
    }
  };

  const cancelAutoPick = () => {
    autoPickCancelledRef.current = true;
    if (autoPickAbortRef.current) {
      try { autoPickAbortRef.current.abort(); } catch {}
      autoPickAbortRef.current = null;
    }
    try { localStorage.removeItem("lastOrgSlug"); } catch {}
    setAutoPicking(null);
    setError("");
    setLoading(false);
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: "var(--gradient-hero)" }}
    >
      <SEO title="Log In" fullTitle="Log In | CherryWorks Pro" description="Sign in to your CherryWorks Pro account." path="/login" />
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/">
            <div className="flex justify-center mb-4 cursor-pointer" data-testid="link-logo-home">
              <BrandLockup iconSize={48} textSize="lg" />
            </div>
          </Link>
          <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.6)" }}>
            The professional services operating system
          </p>
        </div>

        <Card
          className="border-0"
          style={{
            background: "var(--lux-surface)",
            boxShadow: "var(--lux-card-shadow, 0 24px 64px rgba(0,0,0,0.25))",
          }}
        >
          <CardContent className="p-8">
            {mfaPhase === "code" ? (
              <div data-testid="state-mfa-code">
                <div className="mb-6">
                  <div className="flex items-center gap-2 mb-2">
                    <ShieldCheck className="w-5 h-5" style={{ color: "var(--color-accent)" }} />
                    <h2 className="text-lg font-semibold" style={{ color: "var(--lux-text)" }}>Two-factor authentication</h2>
                  </div>
                  <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
                    Enter the 6-digit code from your authenticator app
                  </p>
                </div>
                <form onSubmit={handleMfaSubmit} className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="mfa-code" className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>
                      Authentication code
                    </Label>
                    <Input
                      id="mfa-code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="123456"
                      maxLength={10}
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value)}
                      required
                      autoFocus
                      data-testid="input-mfa-code"
                      style={{
                        background: "var(--lux-bg)",
                        borderColor: "var(--lux-border)",
                        color: "var(--lux-text)",
                        letterSpacing: "0.3em",
                        textAlign: "center",
                        fontSize: "18px",
                      }}
                    />
                    <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
                      Or paste a recovery code if you've lost your device.
                    </p>
                  </div>
                  {mfaError && (
                    <div className="rounded-lg px-3 py-2.5" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                      <p className="text-sm font-medium" style={{ color: "#ef4444" }} data-testid="text-mfa-error">{mfaError}</p>
                    </div>
                  )}
                  <Button
                    type="submit"
                    className="w-full text-white h-11 font-semibold"
                    disabled={loading || mfaCode.trim().length < 6}
                    data-testid="button-mfa-verify"
                    style={{ background: "var(--gradient-brand)" }}
                  >
                    {loading ? "Verifying..." : "Verify"}
                  </Button>
                  <button
                    type="button"
                    onClick={cancelMfa}
                    className="w-full flex items-center justify-center gap-1 text-sm font-medium cursor-pointer"
                    style={{ color: "var(--lux-text-muted)" }}
                    data-testid="button-mfa-cancel"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Back
                  </button>
                </form>
              </div>
            ) : mfaPhase === "setup" ? (
              <div data-testid="state-mfa-setup-required">
                <div className="mb-6">
                  <div className="flex items-center gap-2 mb-2">
                    <ShieldCheck className="w-5 h-5" style={{ color: "var(--color-accent)" }} />
                    <h2 className="text-lg font-semibold" style={{ color: "var(--lux-text)" }}>Set up two-factor authentication</h2>
                  </div>
                  <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
                    Your organization requires admins to enable an authenticator app before signing in.
                  </p>
                </div>
                {setupLoading && (
                  <p className="text-sm" style={{ color: "var(--lux-text-muted)" }} data-testid="text-mfa-setup-loading">
                    Preparing your authenticator secret…
                  </p>
                )}
                {setupSecret && (
                  <div className="space-y-4" data-testid="state-mfa-setup-ready">
                    <div>
                      <Label className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>
                        Scan in your authenticator app
                      </Label>
                      <code
                        className="mt-2 block w-full rounded-lg p-3 text-xs break-all"
                        style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)", border: "1px solid var(--lux-border)" }}
                        data-testid="text-mfa-setup-secret"
                      >
                        {setupSecret}
                      </code>
                      {setupOtpauthUrl && (
                        <p className="mt-2 text-xs break-all" style={{ color: "var(--lux-text-muted)" }} data-testid="text-mfa-setup-otpauth">
                          {setupOtpauthUrl}
                        </p>
                      )}
                    </div>
                    {setupRecoveryCodes && setupRecoveryCodes.length > 0 && (
                      <div>
                        <Label className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>
                          Recovery codes — store somewhere safe
                        </Label>
                        <ul
                          className="mt-2 grid grid-cols-2 gap-1 rounded-lg p-3 text-xs font-mono"
                          style={{ background: "var(--lux-bg)", border: "1px solid var(--lux-border)", color: "var(--lux-text)" }}
                          data-testid="list-mfa-setup-recovery-codes"
                        >
                          {setupRecoveryCodes.map((c) => (
                            <li key={c}>{c}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <form onSubmit={handleSetupVerify} className="space-y-3">
                      <Label htmlFor="mfa-setup-code" className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>
                        Enter the 6-digit code from your app
                      </Label>
                      <Input
                        id="mfa-setup-code"
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        placeholder="123456"
                        maxLength={10}
                        value={mfaCode}
                        onChange={(e) => setMfaCode(e.target.value)}
                        required
                        autoFocus
                        data-testid="input-mfa-setup-code"
                        style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)", letterSpacing: "0.3em", textAlign: "center", fontSize: "18px" }}
                      />
                      {mfaError && (
                        <p className="text-sm font-medium" style={{ color: "#ef4444" }} data-testid="text-mfa-setup-error">{mfaError}</p>
                      )}
                      <Button
                        type="submit"
                        className="w-full text-white h-11 font-semibold"
                        disabled={loading || mfaCode.trim().length < 6}
                        data-testid="button-mfa-setup-verify"
                        style={{ background: "var(--gradient-brand)" }}
                      >
                        {loading ? "Verifying…" : "Enable two-factor"}
                      </Button>
                    </form>
                  </div>
                )}
                {!setupLoading && !setupSecret && mfaError && (
                  <div className="space-y-3">
                    <p className="text-sm font-medium" style={{ color: "#ef4444" }} data-testid="text-mfa-setup-error">{mfaError}</p>
                    <Button
                      type="button"
                      onClick={beginMfaSetup}
                      className="w-full text-white h-11 font-semibold"
                      data-testid="button-mfa-setup-retry"
                      style={{ background: "var(--gradient-brand)" }}
                    >
                      Try again
                    </Button>
                  </div>
                )}
                <button
                  type="button"
                  onClick={cancelMfa}
                  className="mt-4 w-full flex items-center justify-center gap-1 text-sm font-medium cursor-pointer"
                  style={{ color: "var(--lux-text-muted)" }}
                  data-testid="button-mfa-cancel"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Back
                </button>
              </div>
            ) : orgPickerOrgs ? (
              autoPicking ? (
                <div data-testid="state-auto-pick">
                  <div className="mb-6">
                    <h2 className="text-lg font-semibold" style={{ color: "var(--lux-text)" }}>Signing you in</h2>
                    <p className="text-xs mt-1" style={{ color: "var(--lux-text-muted)" }}>
                      Continuing to <span data-testid="text-auto-pick-name">{autoPicking.name}</span>, your last workspace.
                    </p>
                  </div>
                  {error && (
                    <div className="mb-4 rounded-lg px-3 py-2.5" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                      <p className="text-sm font-medium" style={{ color: "#ef4444" }} data-testid="text-login-error">{error}</p>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={cancelAutoPick}
                    className="w-full text-sm font-medium cursor-pointer underline"
                    style={{ color: "var(--lux-text-muted)" }}
                    data-testid="button-switch-workspace"
                  >
                    Switch workspace
                  </button>
                </div>
              ) : (
              <div>
                <div className="mb-6">
                  <h2 className="text-lg font-semibold" style={{ color: "var(--lux-text)" }}>Choose your organization</h2>
                  <p className="text-xs mt-1" style={{ color: "var(--lux-text-muted)" }}>
                    Your email is associated with multiple firms
                  </p>
                </div>
                <div className="space-y-3">
                  {orgPickerOrgs.map((org) => (
                    <button
                      key={org.slug}
                      type="button"
                      onClick={() => handleOrgPick(org.slug)}
                      disabled={loading}
                      className="w-full flex items-center gap-3 px-4 py-3.5 rounded-lg text-left transition-all hover:scale-[1.01]"
                      style={{
                        background: "var(--lux-bg)",
                        border: "1px solid var(--lux-border)",
                      }}
                      data-testid={`button-org-pick-${org.slug}`}
                    >
                      <div
                        className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{ background: "var(--color-accent-soft)" }}
                      >
                        <Building2 className="w-4 h-4" style={{ color: "var(--color-accent)" }} />
                      </div>
                      <div>
                        <p className="text-sm font-semibold" style={{ color: "var(--lux-text)" }}>{org.name}</p>
                        <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>{org.slug}</p>
                      </div>
                    </button>
                  ))}
                </div>
                {error && (
                  <div className="mt-4 rounded-lg px-3 py-2.5" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                    <p className="text-sm font-medium" style={{ color: "#ef4444" }} data-testid="text-login-error">{error}</p>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => { setOrgPickerOrgs(null); setError(""); }}
                  className="mt-5 w-full flex items-center justify-center gap-1 text-sm font-medium cursor-pointer"
                  style={{ color: "var(--lux-text-muted)" }}
                  data-testid="button-back-to-login"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Back
                </button>
              </div>
              )
            ) : (
              <>
                <div className="mb-6">
                  <h2 className="text-lg font-semibold" style={{ color: "var(--lux-text)" }}>Sign in to your account</h2>
                  <p className="text-xs mt-1" style={{ color: "var(--lux-text-muted)" }}>Enter your credentials below</p>
                </div>
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>
                      Email
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@yourfirm.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      data-testid="input-email"
                      style={{
                        background: "var(--lux-bg)",
                        borderColor: "var(--lux-border)",
                        color: "var(--lux-text)",
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password" className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>
                      Password
                    </Label>
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPass ? "text" : "password"}
                        placeholder="Enter your password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        data-testid="input-password"
                        style={{
                          background: "var(--lux-bg)",
                          borderColor: "var(--lux-border)",
                          color: "var(--lux-text)",
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPass(!showPass)}
                        className="absolute right-3 top-1/2 -translate-y-1/2"
                        style={{ color: "var(--lux-text-muted)" }}
                        data-testid="button-toggle-password"
                      >
                        {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  {error && (
                    <div className="rounded-lg px-3 py-2.5" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                      <p className="text-sm font-medium" style={{ color: "#ef4444" }} data-testid="text-login-error">
                        {error}
                      </p>
                    </div>
                  )}
                  <div className="flex justify-end">
                    <Link href="/forgot-password">
                      <span className="text-xs font-medium cursor-pointer" style={{ color: "var(--lux-text-muted)" }} data-testid="link-forgot-password">
                        Forgot password?
                      </span>
                    </Link>
                  </div>
                  <Button
                    type="submit"
                    className="w-full text-white h-11 font-semibold"
                    disabled={loading}
                    data-testid="button-login"
                    style={{
                      background: "var(--gradient-brand)",
                    }}
                  >
                    {loading ? "Signing in..." : "Sign In"}
                  </Button>
                </form>
              </>
            )}
          </CardContent>
        </Card>
        <p className="text-center mt-5 text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>
          Don't have an account?{" "}
          <Link href="/signup">
            <span className="font-semibold cursor-pointer" style={{ color: "var(--lux-accent)" }}>Start free trial</span>
          </Link>
        </p>
        <div className="text-center mt-3">
          <Link href="/">
            <span className="text-sm font-medium inline-flex items-center gap-1 cursor-pointer" style={{ color: "rgba(255,255,255,0.4)" }} data-testid="link-back-to-home">
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to home
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}
