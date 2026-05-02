import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Lock, ArrowLeft } from "lucide-react";
import { BrandLockup } from "@/components/shared/brand-lockup";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/lib/use-document-title";

export default function ChangePasswordPage() {
  useDocumentTitle("Change Password");
  const { toast } = useToast();
  const { user } = useAuth();
  const isTempPassword = user?.tempPassword === true;
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentPasswordError, setCurrentPasswordError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCurrentPasswordError("");
    if (!isTempPassword && !currentPassword) {
      setCurrentPasswordError("Current password is required");
      return;
    }
    if (newPassword.length < 8) {
      toast({ title: "Password must be at least 8 characters", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      await apiRequest("PATCH", "/api/auth/change-password", {
        ...(isTempPassword ? {} : { currentPassword }),
        newPassword,
      });
      toast({ title: "Password updated successfully" });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => { window.location.href = "/"; }, 1200);
    } catch (err: any) {
      if (err.message?.toLowerCase().includes("current password is incorrect")) {
        setCurrentPasswordError("Current password is incorrect");
      } else {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "var(--gradient-hero)" }}>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/">
            <div className="flex justify-center mb-4 cursor-pointer" data-testid="link-logo-home">
              <BrandLockup iconSize={48} textSize="lg" />
            </div>
          </Link>
          <h1 className="text-2xl font-bold text-white" data-testid="text-change-password-title">
            Welcome{(user as any)?.firstName ? `, ${(user as any).firstName}` : user?.name ? `, ${user.name.split(" ")[0]}` : ""}!
          </h1>
          <p className="text-sm mt-2" style={{ color: "rgba(255,255,255,0.6)" }}>
            {isTempPassword
              ? "Your administrator set up your account with a temporary password. Please choose a new password to continue."
              : "Update your account password below."}
          </p>
        </div>

        <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow, 0 24px 64px rgba(0,0,0,0.25))" }}>
          <CardContent className="p-8">
            <div className="mb-6">
              <h2 className="text-lg font-semibold" style={{ color: "var(--lux-text)" }}>
                {isTempPassword ? "Choose a new password" : "Change your password"}
              </h2>
              <p className="text-xs mt-1" style={{ color: "var(--lux-text-muted)" }}>Must be at least 8 characters</p>
            </div>
            <form onSubmit={handleSubmit} className="space-y-5">
              {!isTempPassword && (
                <div className="space-y-2">
                  <Label className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Current Password</Label>
                  <Input
                    type="password"
                    value={currentPassword}
                    onChange={e => { setCurrentPassword(e.target.value); setCurrentPasswordError(""); }}
                    placeholder="Enter your current password"
                    required
                    data-testid="input-current-password"
                    style={{ background: "var(--lux-bg)", borderColor: currentPasswordError ? "hsl(0 84% 60%)" : "var(--lux-border)", color: "var(--lux-text)" }}
                  />
                  {currentPasswordError && (
                    <p className="text-xs font-medium" style={{ color: "hsl(0 84% 60%)" }} data-testid="text-current-password-error">{currentPasswordError}</p>
                  )}
                </div>
              )}
              <div className="space-y-2">
                <Label className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>New Password</Label>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  required
                  minLength={8}
                  data-testid="input-new-password"
                  style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Confirm Password</Label>
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Repeat your new password"
                  required
                  data-testid="input-confirm-password"
                  style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                />
              </div>
              <Button
                type="submit"
                className="w-full text-white h-11 font-semibold"
                disabled={loading}
                style={{ background: "var(--gradient-brand)" }}
                data-testid="button-set-password"
              >
                <Lock className="w-4 h-4 mr-2" />
                {loading ? "Setting Password..." : "Set Password & Continue"}
              </Button>
            </form>
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
