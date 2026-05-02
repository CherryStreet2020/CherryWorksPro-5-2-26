import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Eye, EyeOff, Building2, ArrowLeft } from "lucide-react";
import { BrandLockup } from "@/components/shared/brand-lockup";
import { useToast } from "@/hooks/use-toast";
import { SEO } from "@/components/seo";

export default function LoginPage() {
  const { login } = useAuth();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [orgPickerOrgs, setOrgPickerOrgs] = useState<Array<{ slug: string; name: string }> | null>(null);
  const [autoPicking, setAutoPicking] = useState<{ slug: string; name: string } | null>(null);
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
      await login("", email, password);
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
      await login(slug, email, password, controller ? { signal: controller.signal } : undefined);
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
            {orgPickerOrgs ? (
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
