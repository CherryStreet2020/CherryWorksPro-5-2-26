import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Mail } from "lucide-react";
import { Label } from "@/components/ui/label";
import { BrandLockup } from "@/components/shared/brand-lockup";
import { SEO } from "@/components/seo";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Something went wrong");
      }
      setSent(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: "var(--gradient-hero)" }}
    >
      <SEO
        title="Forgot Password"
        fullTitle="Forgot Password | CherryWorks Pro"
        description="Reset your CherryWorks Pro password."
        path="/forgot-password"
      />
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

      <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow, 0 24px 64px rgba(0,0,0,0.25))" }}>
        <CardContent className="p-8">
          {sent ? (
            <div className="text-center space-y-4">
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center mx-auto"
                style={{ background: "var(--color-accent-soft)" }}
              >
                <Mail className="w-7 h-7" style={{ color: "var(--color-accent)" }} />
              </div>
              <h2 className="text-lg font-semibold" style={{ color: "var(--lux-text)" }} data-testid="text-reset-sent">
                Check your email
              </h2>
              <p className="text-sm" style={{ color: "var(--lux-text-muted)" }}>
                If an account exists for <strong>{email}</strong>, we've sent a password reset link. It will expire in 1 hour.
              </p>
              <Link href="/login">
                <Button
                  variant="outline"
                  className="mt-4"
                  data-testid="link-back-to-login"
                >
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Sign In
                </Button>
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-6">
                <h2 className="text-lg font-semibold" style={{ color: "var(--lux-text)" }} data-testid="heading-reset-password">
                  Forgot your password?
                </h2>
                <p className="text-xs mt-1" style={{ color: "var(--lux-text-muted)" }}>
                  Enter your email and we'll send you a reset link.
                </p>
              </div>
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <Label className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>
                    Email
                  </Label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    autoFocus
                    data-testid="input-forgot-email"
                    style={{
                      background: "var(--lux-bg)",
                      borderColor: "var(--lux-border)",
                      color: "var(--lux-text)",
                    }}
                  />
                </div>
                {error && (
                  <div className="rounded-lg px-3 py-2.5" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                    <p className="text-sm font-medium" style={{ color: "#ef4444" }} data-testid="text-forgot-error">
                      {error}
                    </p>
                  </div>
                )}
                <Button
                  type="submit"
                  className="w-full text-white h-11 font-semibold"
                  disabled={loading}
                  data-testid="button-send-reset"
                  style={{ background: "var(--gradient-brand)" }}
                >
                  {loading ? "Sending..." : "Send Reset Link"}
                </Button>
              </form>
              <div className="text-center mt-5">
                <Link href="/login">
                  <span
                    className="text-sm font-medium inline-flex items-center gap-1 cursor-pointer"
                    style={{ color: "var(--lux-text-muted)" }}
                    data-testid="link-back-to-login"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Back to Sign In
                  </span>
                </Link>
              </div>
            </>
          )}
        </CardContent>
      </Card>
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
