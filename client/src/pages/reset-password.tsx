import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, CheckCircle2, Eye, EyeOff, AlertTriangle } from "lucide-react";
import { SEO } from "@/components/seo";

export default function ResetPasswordPage() {
  const token = window.location.pathname.split("/reset-password/")[1] || "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(true);
  const [valid, setValid] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function validateToken() {
      try {
        const res = await fetch(`/api/auth/reset-password/${token}`);
        const data = await res.json();
        setValid(data.valid === true);
        if (!data.valid) {
          setError(data.message || "This reset link is invalid or has expired.");
        }
      } catch {
        setValid(false);
        setError("Unable to validate reset link.");
      } finally {
        setValidating(false);
      }
    }
    if (token) {
      validateToken();
    } else {
      setValid(false);
      setError("Invalid reset link.");
      setValidating(false);
    }
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/auth/reset-password/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Something went wrong");
      }
      setSuccess(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{
        background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
      }}
    >
      <SEO
        title="Reset Password"
        fullTitle="Reset Password | CherryWorks Pro"
        description="Set a new password for your CherryWorks Pro account."
        path="/reset-password"
      />
      <Card className="w-full max-w-md border-0 shadow-2xl" style={{ background: "rgba(255,255,255,0.97)", color: "#1a1a2e" }}>
        <CardContent className="p-8">
          {validating ? (
            <div className="text-center py-8">
              <p className="text-sm" style={{ color: "#6b7280" }}>Validating reset link...</p>
            </div>
          ) : success ? (
            <div className="text-center space-y-4">
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center mx-auto"
                style={{ background: "rgba(34,197,94,0.1)" }}
              >
                <CheckCircle2 className="w-7 h-7 text-green-600" />
              </div>
              <h2 className="text-lg font-semibold" style={{ color: "#1a1a2e" }} data-testid="text-reset-success">
                Password updated
              </h2>
              <p className="text-sm" style={{ color: "#6b7280" }}>
                Your password has been reset successfully. You can now sign in with your new password.
              </p>
              <Link href="/login">
                <Button
                  className="mt-4 text-white font-semibold"
                  style={{ background: "var(--gradient-brand)" }}
                  data-testid="link-login-after-reset"
                >
                  Sign In
                </Button>
              </Link>
            </div>
          ) : !valid ? (
            <div className="text-center space-y-4">
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center mx-auto"
                style={{ background: "rgba(239,68,68,0.08)" }}
              >
                <AlertTriangle className="w-7 h-7 text-red-500" />
              </div>
              <h2 className="text-lg font-semibold" style={{ color: "#1a1a2e" }} data-testid="text-reset-invalid">
                Invalid or expired link
              </h2>
              <p className="text-sm" style={{ color: "#6b7280" }}>
                {error || "This password reset link is no longer valid. Please request a new one."}
              </p>
              <Link href="/forgot-password">
                <Button variant="outline" className="mt-4" data-testid="link-request-new-reset">
                  Request New Link
                </Button>
              </Link>
            </div>
          ) : (
            <>
              <div className="text-center mb-6">
                <h2 className="text-lg font-semibold" style={{ color: "#1a1a2e" }}>
                  Set a new password
                </h2>
                <p className="text-sm mt-1" style={{ color: "#6b7280" }}>
                  Choose a strong password for your account.
                </p>
              </div>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1.5 block" style={{ color: "#1a1a2e" }}>
                    New Password
                  </label>
                  <div className="relative">
                    <Input
                      type={showPass ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter new password"
                      required
                      minLength={8}
                      autoFocus
                      data-testid="input-new-password"
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowPass(!showPass)}
                      tabIndex={-1}
                      data-testid="button-toggle-password"
                    >
                      {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block" style={{ color: "#1a1a2e" }}>
                    Confirm Password
                  </label>
                  <Input
                    type={showPass ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                    required
                    minLength={8}
                    data-testid="input-confirm-password"
                  />
                </div>
                {error && (
                  <div className="rounded-lg px-3 py-2.5" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                    <p className="text-sm font-medium" style={{ color: "#ef4444" }} data-testid="text-reset-error">
                      {error}
                    </p>
                  </div>
                )}
                <Button
                  type="submit"
                  className="w-full text-white h-11 font-semibold"
                  disabled={loading}
                  data-testid="button-reset-password"
                  style={{ background: "var(--gradient-brand)" }}
                >
                  {loading ? "Resetting..." : "Reset Password"}
                </Button>
              </form>
              <div className="text-center mt-5">
                <Link href="/login">
                  <span
                    className="text-sm font-medium inline-flex items-center gap-1 cursor-pointer"
                    style={{ color: "#6b7280" }}
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
    </div>
  );
}
