import { useState, useMemo, useRef, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/page-header";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import {
  User, Briefcase, Clock, Building2, MapPin, CreditCard, ShieldCheck, CheckCircle2, XCircle, Zap, ExternalLink, Lock, Camera, Save, LogOut, AlertTriangle, Trash2, Monitor, Smartphone, Tablet, Shield, Bell, ArrowLeft,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { AvatarInitials } from "@/components/shared/avatar-initials";
import { StatusBadge } from "@/components/shared/status-badge";
import { FormSection } from "@/components/shared/form-section";
import { EmptyState } from "@/components/shared/empty-state";
import { formatHoursMinutes, formatMoney, formatRate } from "@/components/shared/format";
import { useBaseCurrency } from "@/hooks/use-base-currency";
import { useToast } from "@/hooks/use-toast";
import { isValidStripeUrl } from "@/lib/url-validation";
import { useDocumentTitle } from "@/lib/use-document-title";
import { Link, useLocation } from "wouter";

const WORKER_TYPE_LABELS: Record<string, string> = {
  "INDEPENDENT": "1099 Independent",
  "W2_EMPLOYEE": "W-2 Employee",
  "CORP_TO_CORP": "Corp-to-Corp",
};

function maskValue(value: string | null | undefined, showLast = 4): string {
  if (!value) return "—";
  if (value.length <= showLast) return value;
  return "\u2022".repeat(value.length - showLast) + value.slice(-showLast);
}

function DetailRow({ label, value, masked = false }: {
  label: string;
  value?: string | null | boolean;
  masked?: boolean;
}) {
  let display: string;
  if (typeof value === "boolean") {
    display = value ? "Yes" : "No";
  } else if (masked) {
    display = maskValue(value);
  } else {
    display = value || "—";
  }
  const hasValue = value !== null && value !== undefined && value !== "";
  return (
    <div className="flex justify-between items-center py-1.5">
      <span className="text-xs" style={{ color: "var(--lux-text-muted)" }}>{label}</span>
      <span
        className="text-sm font-medium text-right max-w-[60%]"
        style={{ color: hasValue ? "var(--lux-text)" : "var(--lux-text-muted)", fontStyle: hasValue ? "normal" : "italic" }}
      >
        {display}
      </span>
    </div>
  );
}

function ComplianceBadge({ label, value }: { label: string; value?: boolean }) {
  const met = value === true;
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs" style={{ color: "var(--lux-text-muted)" }}>{label}</span>
      <div className="flex items-center gap-1.5">
        {met ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-red-400" />}
        <span className="text-sm font-medium" style={{ color: met ? "#22c55e" : "#f87171" }}>{met ? "Yes" : "No"}</span>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  useDocumentTitle("Profile");
  const { user, refetchUser, logout } = useAuth();
  const baseCurrency = useBaseCurrency();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [editFirstName, setEditFirstName] = useState((user as any)?.firstName || "");
  const [editLastName, setEditLastName] = useState((user as any)?.lastName || "");
  const [editPhone, setEditPhone] = useState((user as any)?.phone || "");
  const [editName, setEditName] = useState((user as any)?.name || "");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty) {
      if ((user as any)?.firstName !== undefined) setEditFirstName((user as any).firstName || "");
      if ((user as any)?.lastName !== undefined) setEditLastName((user as any).lastName || "");
      if ((user as any)?.phone !== undefined) setEditPhone((user as any).phone || "");
      if (user?.name !== undefined) setEditName(user?.name || "");
    }
  }, [(user as any)?.firstName, (user as any)?.lastName, (user as any)?.phone, user?.name]);

  const { data: myProjects, isLoading: loadingProjects } = useQuery<any[]>({
    queryKey: ["/api/time-entries/my-projects"],
  });

  const currentWeekStart = useMemo(() => {
    const d = new Date();
    const day = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() - day);
    return d.toISOString().split("T")[0];
  }, []);

  const { data: timesheets, isLoading: loadingTimesheets } = useQuery<any>({
    queryKey: ["/api/timesheets/my-week", currentWeekStart],
    queryFn: async () => {
      const res = await fetch(`/api/timesheets/my-week?weekStartDate=${currentWeekStart}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch timesheet");
      return res.json();
    },
  });

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  const avatarMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("avatar", file);
      const res = await fetch("/api/auth/me/avatar", {
        method: "POST",
        body: form,
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Upload failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Avatar updated" });
      setAvatarPreview(null);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      if (refetchUser) refetchUser();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setAvatarPreview(null);
    },
  });

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "File too large", description: "Max 2MB", variant: "destructive" });
      return;
    }
    const url = URL.createObjectURL(file);
    setAvatarPreview(url);
    avatarMutation.mutate(file);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", "/api/auth/me", { firstName: editFirstName.trim(), lastName: editLastName.trim(), phone: editPhone.trim() });
    },
    onSuccess: () => {
      toast({ title: "Profile updated" });
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      if (refetchUser) refetchUser();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (!user) return null;

  const u = user as any;
  const isTeamMember = u.role === "TEAM_MEMBER";
  const wt = u.workerType || "INDEPENDENT";
  const isIndependentType = wt === "INDEPENDENT" || wt === "CORP_TO_CORP";

  const addressParts = [
    u.addressLine1,
    u.addressLine2,
    [u.addressCity, u.addressState].filter(Boolean).join(", "),
    u.addressZip,
  ].filter(Boolean);
  const formattedAddress = addressParts.length > 0 ? addressParts.join("\n") : null;
  const displayAddress = formattedAddress || u.mailingAddress || null;

  return (
    <div className="px-6 lg:px-8 xl:px-10 py-6 max-w-5xl mx-auto">
      <PageBreadcrumbs page="Profile" className="mb-4" />
      <PageHeader title="Profile" subtitle="Your account information and activity" icon={User} />

      <div className="grid gap-6">

        <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
          <CardContent className="pt-6">
            <FormSection title="Account Details">
              <div className="flex items-start gap-4 mb-4">
                <div className="relative group cursor-pointer" onClick={() => avatarInputRef.current?.click()} data-testid="button-avatar-upload">
                  {avatarPreview || u.avatarUrl ? (
                    <img
                      src={avatarPreview || u.avatarUrl}
                      alt="Avatar"
                      className="w-16 h-16 rounded-full object-cover border-2"
                      style={{ borderColor: "var(--lux-border)" }}
                    />
                  ) : (
                    <AvatarInitials name={[editFirstName, editLastName].filter(Boolean).join(" ") || user.name} size="lg" />
                  )}
                  <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Camera className="w-5 h-5 text-white" />
                  </div>
                  {avatarMutation.isPending && (
                    <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center">
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    onChange={handleAvatarChange}
                    data-testid="input-avatar-file"
                  />
                </div>
                <div className="flex-1 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>First Name</Label>
                      <Input
                        value={editFirstName}
                        onChange={e => { setEditFirstName(e.target.value); setDirty(true); }}
                        data-testid="input-profile-firstName"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Last Name</Label>
                      <Input
                        value={editLastName}
                        onChange={e => { setEditLastName(e.target.value); setDirty(true); }}
                        data-testid="input-profile-lastName"
                        className="mt-1"
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Email</Label>
                    <p className="text-sm mt-1" style={{ color: "var(--lux-text)" }} data-testid="text-profile-email">{user.email}</p>
                  </div>
                  <div>
                    <Label className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Phone</Label>
                    <Input
                      value={editPhone}
                      onChange={e => { setEditPhone(e.target.value); setDirty(true); }}
                      placeholder="(area code) prefix-line"
                      data-testid="input-profile-phone"
                      className="mt-1"
                    />
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusBadge status={user.role} size="sm" />
                    <span className="sr-only" data-testid="text-profile-role">{user.role}</span>
                    {isTeamMember && (
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{
                        background: wt === "W2_EMPLOYEE" ? "rgba(59,130,246,0.1)" : wt === "CORP_TO_CORP" ? "rgba(168,85,247,0.1)" : "rgba(34,197,94,0.1)",
                        color: wt === "W2_EMPLOYEE" ? "#3b82f6" : wt === "CORP_TO_CORP" ? "#a855f7" : "#22c55e",
                      }}>
                        {WORKER_TYPE_LABELS[wt] || wt}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 pt-2">
                    <Button
                      size="sm"
                      disabled={!dirty || saveMutation.isPending || !editFirstName.trim()}
                      onClick={() => saveMutation.mutate()}
                      className="text-white"
                      style={{ background: dirty ? "var(--gradient-brand)" : undefined }}
                      data-testid="button-save-profile"
                    >
                      <Save className="w-3.5 h-3.5 mr-1.5" />
                      {saveMutation.isPending ? "Saving..." : "Save Changes"}
                    </Button>
                    <Link href="/change-password">
                      <Button variant="outline" size="sm" data-testid="link-change-password">
                        <Lock className="w-3.5 h-3.5 mr-1.5" />
                        Change Password
                      </Button>
                    </Link>
                    <Button variant="outline" size="sm" onClick={logout} data-testid="button-logout-profile">
                      <LogOut className="w-3.5 h-3.5 mr-1.5" />
                      Logout
                    </Button>
                  </div>
                </div>
              </div>
            </FormSection>
          </CardContent>
        </Card>

        {isTeamMember && isIndependentType && (
          <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
            <CardContent className="pt-6">
              <FormSection title="Business Entity" icon={<Building2 className="w-4 h-4" />}>
                <div className="space-y-0.5">
                  <DetailRow label="Legal Name" value={u.legalName} />
                  <DetailRow label="Pay-To Name" value={u.payToName} />
                  <DetailRow label="EIN" value={u.ein} masked />
                  <DetailRow label="Tax ID (last 4)" value={u.taxIdLast4} />
                  <DetailRow label="1099 Eligible" value={u.isPayoutEligible} />
                </div>
              </FormSection>
            </CardContent>
          </Card>
        )}

        {isTeamMember && (
          <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
            <CardContent className="pt-6">
              <FormSection title="Mailing Address" icon={<MapPin className="w-4 h-4" />}>
                {displayAddress ? (
                  <div className="text-sm leading-relaxed whitespace-pre-line" style={{ color: "var(--lux-text)" }}>{displayAddress}</div>
                ) : (
                  <p className="text-sm italic" style={{ color: "var(--lux-text-muted)" }}>No address on file</p>
                )}
              </FormSection>
            </CardContent>
          </Card>
        )}

        {isTeamMember && isIndependentType && (
          <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
            <CardContent className="pt-6">
              <FormSection title="Payment Information" icon={<CreditCard className="w-4 h-4" />}>
                <div className="space-y-0.5">
                  <DetailRow label="Payment Method" value={u.paymentMethod ? u.paymentMethod.toUpperCase() : null} />
                  {(u.paymentMethod === "ach" || u.paymentMethod === "ACH") ? (
                    <>
                      <DetailRow label="Bank Name" value={u.bankName} />
                      <DetailRow label="Routing Number" value={u.bankRoutingNumber} masked />
                      <DetailRow label="Account Number" value={u.bankAccountNumber} masked />
                      <DetailRow label="Account Type" value={u.bankAccountType ? u.bankAccountType.charAt(0).toUpperCase() + u.bankAccountType.slice(1) : null} />
                    </>
                  ) : (u.paymentMethod === "zelle" || u.paymentMethod === "Zelle" || u.paymentMethod === "ZELLE") ? (
                    <DetailRow label="Zelle Contact" value={u.zelleContact} />
                  ) : null}
                </div>
              </FormSection>
            </CardContent>
          </Card>
        )}

        {isTeamMember && wt === "W2_EMPLOYEE" && (
          <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
            <CardContent className="pt-6">
              <div className="rounded-lg px-4 py-3" style={{ background: "rgba(59,130,246,0.05)", border: "1px solid rgba(59,130,246,0.15)" }}>
                <p className="text-sm font-medium" style={{ color: "#3b82f6" }}>Paid via Payroll</p>
                <p className="text-xs mt-1" style={{ color: "var(--lux-text-muted)" }}>
                  Your compensation is handled through your employer's payroll system. Contact your administrator for payment details.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {isTeamMember && isIndependentType && (
          <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
            <CardContent className="pt-6">
              <FormSection title="Compliance" icon={<ShieldCheck className="w-4 h-4" />}>
                <div className="space-y-0.5">
                  <ComplianceBadge label="W-9 On File" value={u.w9OnFile} />
                  <ComplianceBadge label="Agreement Signed" value={u.agreementSigned} />
                </div>
              </FormSection>
            </CardContent>
          </Card>
        )}

        {isTeamMember && isIndependentType && (
          <ProfileConnectSection />
        )}

        <EmailNotificationPreferences />

        <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
          <CardContent className="pt-6">
            <FormSection title="Assigned Projects">
              {loadingProjects ? (
                <div className="space-y-2">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ) : myProjects && myProjects.length > 0 ? (
                <div className="space-y-3">
                  {myProjects.map((p: any) => (
                    <div key={p.id} className="flex items-center justify-between p-3 rounded-lg" style={{ background: "var(--lux-surface-alt)" }}>
                      <div className="flex items-center gap-3">
                        <AvatarInitials name={p.name || "Project"} size="sm" />
                        <div>
                          <p className="font-medium text-sm" style={{ color: "var(--lux-text)" }}>{p.name}</p>
                          <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>{p.clientName}</p>
                        </div>
                      </div>
                      {!isTeamMember && p.rate && (
                        <span className="text-sm tabular-nums" style={{ color: "var(--lux-text-secondary)" }}>
                          {formatRate(p.rate, baseCurrency)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState icon={Briefcase} title="No projects assigned" description="You haven't been assigned to any projects yet." />
              )}
            </FormSection>
          </CardContent>
        </Card>

        <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
          <CardContent className="pt-6">
            <FormSection title="Current Week Timesheet">
              {loadingTimesheets ? (
                <Skeleton className="h-8 w-full" />
              ) : timesheets ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="text-sm" style={{ color: "var(--lux-text-muted)" }}>Status:</span>
                    <StatusBadge status={(timesheets as any)?.status || "DRAFT"} size="sm" />
                    <span className="sr-only" data-testid="text-timesheet-status">{(timesheets as any)?.status || "No timesheet"}</span>
                  </div>
                  {(timesheets as any)?.totalHours != null && (
                    <p className="text-sm" style={{ color: "var(--lux-text)" }}>
                      Total hours this week: <span className="tabular-nums font-semibold">{formatHoursMinutes((timesheets as any).totalHours * 60)}</span>
                    </p>
                  )}
                </div>
              ) : (
                <EmptyState icon={Clock} title="No timesheet data" description="No timesheet data for the current week." />
              )}
            </FormSection>
          </CardContent>
        </Card>

        <ActiveSessionsSection />

        <DeleteAccountSection />
      </div>
    </div>
  );
}

interface SessionData {
  id: number;
  deviceLabel: string;
  ipAddress: string | null;
  city: string | null;
  lastActiveAt: string;
  createdAt: string;
  isCurrent: boolean;
}

function getDeviceIcon(label: string) {
  const lower = label.toLowerCase();
  if (lower.includes("iphone") || lower.includes("android") || lower.includes("mobile")) return Smartphone;
  if (lower.includes("ipad") || lower.includes("tablet")) return Tablet;
  return Monitor;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} minute${mins !== 1 ? "s" : ""} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours !== 1 ? "s" : ""} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days !== 1 ? "s" : ""} ago`;
}

function ActiveSessionsSection() {
  const { toast } = useToast();
  const [showRevokeAllDialog, setShowRevokeAllDialog] = useState(false);

  const { data: sessions, isLoading, refetch } = useQuery<SessionData[]>({
    queryKey: ["/api/sessions"],
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/sessions/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
      toast({ title: "Session revoked", description: "The session has been revoked successfully." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to revoke session", variant: "destructive" });
    },
  });

  const revokeAllMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sessions/revoke-all");
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
      setShowRevokeAllDialog(false);
      toast({ title: "Sessions revoked", description: `${data.revokedCount} other session${data.revokedCount !== 1 ? "s" : ""} revoked.` });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to revoke sessions", variant: "destructive" });
    },
  });

  const otherSessionCount = sessions?.filter((s) => !s.isCurrent).length || 0;

  return (
    <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)", borderColor: "var(--lux-border)" }}>
      <CardContent className="pt-6">
        <FormSection title="Active Sessions">
          <p className="text-xs mb-4" style={{ color: "var(--lux-text-secondary)" }}>
            Devices currently logged into your account
          </p>

          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : !sessions?.length ? (
            <p className="text-sm" style={{ color: "var(--lux-text-secondary)" }}>No active sessions found.</p>
          ) : (
            <div className="space-y-3">
              {sessions.map((session) => {
                const DeviceIcon = getDeviceIcon(session.deviceLabel);
                return (
                  <div
                    key={session.id}
                    className="flex items-center justify-between p-3 rounded-lg border"
                    style={{ borderColor: session.isCurrent ? "rgba(34,197,94,0.3)" : "var(--lux-border)", background: session.isCurrent ? "rgba(34,197,94,0.05)" : "transparent" }}
                    data-testid={`session-row-${session.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: session.isCurrent ? "rgba(34,197,94,0.15)" : "var(--lux-bg)" }}>
                        <DeviceIcon className="w-4 h-4" style={{ color: session.isCurrent ? "#22c55e" : "var(--lux-text-secondary)" }} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium" style={{ color: "var(--lux-text)" }} data-testid={`session-label-${session.id}`}>
                            {session.deviceLabel}
                          </span>
                          {session.isCurrent && (
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: "rgba(34,197,94,0.15)", color: "#16a34a" }} data-testid="badge-current-session">
                              Current Session
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {session.ipAddress && (
                            <span className="text-xs" style={{ color: "var(--lux-text-secondary)" }}>{session.ipAddress}</span>
                          )}
                          <span className="text-xs" style={{ color: "var(--lux-text-secondary)" }}>
                            Active {timeAgo(session.lastActiveAt)}
                          </span>
                        </div>
                      </div>
                    </div>
                    {!session.isCurrent && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                        onClick={() => revokeMutation.mutate(session.id)}
                        disabled={revokeMutation.isPending}
                        data-testid={`button-revoke-session-${session.id}`}
                      >
                        Revoke
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {otherSessionCount > 0 && (
            <div className="mt-4 pt-4 border-t" style={{ borderColor: "var(--lux-border)" }}>
              <Button
                variant="outline"
                className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                onClick={() => setShowRevokeAllDialog(true)}
                data-testid="button-revoke-all-sessions"
              >
                <Shield className="w-4 h-4 mr-2" />
                Revoke All Other Sessions
              </Button>
            </div>
          )}
        </FormSection>
      </CardContent>

      <Dialog open={showRevokeAllDialog} onOpenChange={setShowRevokeAllDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke All Other Sessions</DialogTitle>
            <DialogDescription>
              This will log you out of all other devices. Only your current session will remain active. Continue?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRevokeAllDialog(false)} data-testid="button-cancel-revoke-all">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => revokeAllMutation.mutate()}
              disabled={revokeAllMutation.isPending}
              data-testid="button-confirm-revoke-all"
            >
              {revokeAllMutation.isPending ? "Revoking..." : "Revoke All"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function DeleteAccountSection() {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const [showDialog, setShowDialog] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!user) return null;

  const handleDelete = async () => {
    if (!password || !confirmed) return;
    setDeleting(true);
    try {
      const res = await apiRequest("POST", "/api/account/delete-request", { password });
      const data = await res.json();
      toast({ title: "Account deletion", description: data.message });
      setShowDialog(false);
      if (!data.scheduledDeletion) {
        setTimeout(() => logout(), 1500);
      } else {
        queryClient.invalidateQueries({ queryKey: ["/api/billing/status"] });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to process request", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Card className="border-0" style={{ border: "1px solid rgba(239,68,68,0.3)", background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
      <CardContent className="pt-6">
        <FormSection title="Danger Zone">
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: "#ef4444" }} />
              <div>
                <p className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>Delete Account</p>
                <p className="text-xs mt-1" style={{ color: "var(--lux-text-secondary)" }}>
                  Permanently delete your account and all associated data. This action cannot be undone after the grace period.
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              className="border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700"
              onClick={() => setShowDialog(true)}
              data-testid="button-delete-account"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete My Account
            </Button>
          </div>
        </FormSection>
      </CardContent>

      <Dialog open={showDialog} onOpenChange={(open) => { setShowDialog(open); if (!open) { setPassword(""); setConfirmed(false); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" />
              Delete Account
            </DialogTitle>
            <DialogDescription>
              {user.role === "ADMIN"
                ? "If you are the only admin, your entire organization and all data will be scheduled for deletion in 30 days. You can cancel within that period by logging back in."
                : "Your account will be deactivated immediately and your personal data removed."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="delete-password">Enter your password to confirm</Label>
              <Input
                id="delete-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your current password"
                data-testid="input-delete-password"
              />
            </div>
            <div className="flex items-start gap-2">
              <Checkbox
                id="delete-confirm"
                checked={confirmed}
                onCheckedChange={(val) => setConfirmed(val === true)}
                data-testid="checkbox-delete-confirm"
              />
              <label htmlFor="delete-confirm" className="text-sm cursor-pointer" style={{ color: "var(--lux-text-secondary)" }}>
                I understand this will permanently delete my account
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)} data-testid="button-cancel-delete">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={!password || !confirmed || deleting}
              data-testid="button-confirm-delete"
            >
              {deleting ? "Processing..." : "Delete My Account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

interface NotifPref {
  invoiceAlerts: boolean;
  timesheetReminders: boolean;
  approvalNotifications: boolean;
  systemUpdates: boolean;
  marketingTips: boolean;
  mailboxAlerts: boolean;
}

const NOTIF_TOGGLES: { key: keyof NotifPref; label: string; description: string }[] = [
  { key: "invoiceAlerts", label: "Invoice & Payment Alerts", description: "Get notified when invoices are sent, paid, or overdue" },
  { key: "timesheetReminders", label: "Timesheet Reminders", description: "Weekly reminders to submit your timesheet" },
  { key: "approvalNotifications", label: "Approval Notifications", description: "Alerts when timesheets or expenses need your approval" },
  { key: "systemUpdates", label: "System Updates", description: "Product updates, maintenance windows, and new features" },
  { key: "marketingTips", label: "Marketing & Tips", description: "Best practices, tips, and CherryWorks Pro news" },
  { key: "mailboxAlerts", label: "Mailbox Reconnect Alerts", description: "Admin-only: get emailed when the connected Microsoft 365 / Gmail mailbox needs reconnection" },
];

function EmailNotificationPreferences() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const visibleToggles = NOTIF_TOGGLES.filter(
    (t) => t.key !== "mailboxAlerts" || isAdmin,
  );
  const { data: prefs, isLoading } = useQuery<NotifPref>({
    queryKey: ["/api/notification-preferences"],
  });

  const [local, setLocal] = useState<NotifPref | null>(null);

  useEffect(() => {
    if (prefs && !local) {
      setLocal({
        invoiceAlerts: prefs.invoiceAlerts,
        timesheetReminders: prefs.timesheetReminders,
        approvalNotifications: prefs.approvalNotifications,
        systemUpdates: prefs.systemUpdates,
        marketingTips: prefs.marketingTips,
        mailboxAlerts: prefs.mailboxAlerts,
      });
    }
  }, [prefs, local]);

  const saveMutation = useMutation({
    mutationFn: async (data: NotifPref) => {
      const res = await apiRequest("PUT", "/api/notification-preferences", data);
      return res.json();
    },
    onSuccess: (updated: NotifPref) => {
      queryClient.invalidateQueries({ queryKey: ["/api/notification-preferences"] });
      setLocal(null);
      toast({ title: "Preferences saved", description: "Your email notification preferences have been updated." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message || "Failed to save preferences", variant: "destructive" });
    },
  });

  const isDirty = local && prefs && (
    local.invoiceAlerts !== prefs.invoiceAlerts ||
    local.timesheetReminders !== prefs.timesheetReminders ||
    local.approvalNotifications !== prefs.approvalNotifications ||
    local.systemUpdates !== prefs.systemUpdates ||
    local.marketingTips !== prefs.marketingTips ||
    local.mailboxAlerts !== prefs.mailboxAlerts
  );

  return (
    <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
      <CardContent className="pt-6">
        <FormSection title="Email Notifications" icon={<Bell className="w-4 h-4" />}>
          <p className="text-xs mb-4" style={{ color: "var(--lux-text-muted)" }}>Choose which emails you receive</p>
          {isLoading || !local ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-12 w-full rounded-lg" />
              ))}
            </div>
          ) : (
            <div className="space-y-1">
              {visibleToggles.map((t) => (
                <div key={t.key} className="flex items-center justify-between gap-4 py-3 px-1">
                  <div>
                    <Label className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>{t.label}</Label>
                    <p className="text-xs mt-0.5" style={{ color: "var(--lux-text-muted)" }}>{t.description}</p>
                  </div>
                  <Switch
                    checked={local[t.key]}
                    onCheckedChange={(v) => setLocal({ ...local, [t.key]: v })}
                    data-testid={`switch-notif-${t.key}`}
                  />
                </div>
              ))}
              <div className="pt-4">
                <Button
                  onClick={() => saveMutation.mutate(local)}
                  disabled={saveMutation.isPending || !isDirty}
                  data-testid="button-save-notification-prefs"
                >
                  {saveMutation.isPending ? "Saving..." : "Save Preferences"}
                </Button>
              </div>
            </div>
          )}
        </FormSection>
      </CardContent>
    </Card>
  );
}

function ProfileConnectSection() {
  const { toast } = useToast();

  const { data: connectData, isLoading } = useQuery<{
    eligible: boolean;
    status: string;
    chargesEnabled?: boolean;
    payoutsEnabled?: boolean;
    detailsSubmitted?: boolean;
    reason?: string;
  }>({
    queryKey: ["/api/my/connect-status"],
  });

  const dashboardMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", "/api/my/connect-dashboard");
      return res.json();
    },
    onSuccess: (data) => {
      if (data.url) {
        if (isValidStripeUrl(data.url)) {
          window.open(data.url, "_blank");
        } else {
          toast({ title: "Error", description: "Invalid redirect URL", variant: "destructive" });
        }
      }
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
        <CardContent className="pt-6">
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!connectData?.eligible) return null;

  const status = connectData.status || "NOT_STARTED";

  return (
    <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
      <CardContent className="pt-6">
        <FormSection title="Direct Deposit" icon={<Zap className="w-4 h-4" />}>
          {status === "NOT_STARTED" && (
            <div className="rounded-lg p-4" style={{ background: "rgba(99,102,241,0.05)", border: "1px solid rgba(99,102,241,0.15)" }}>
              <p className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>
                Connect your bank account for direct deposits
              </p>
              <p className="text-xs mt-1" style={{ color: "var(--lux-text-muted)" }}>
                Your administrator will send you a setup link to connect your bank account through Stripe for secure direct deposits.
              </p>
            </div>
          )}

          {status === "ONBOARDING_STARTED" && (
            <div className="rounded-lg p-4" style={{ background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.15)" }}>
              <div className="flex items-center gap-2 mb-1">
                <Zap className="w-4 h-4" style={{ color: "#f59e0b" }} />
                <p className="text-sm font-medium" style={{ color: "#f59e0b" }}>Onboarding in Progress</p>
              </div>
              <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
                Complete your identity verification and bank account setup to start receiving direct deposits. Check your email for the setup link.
              </p>
            </div>
          )}

          {status === "ONBOARDING_COMPLETE" && (
            <div className="rounded-lg p-4" style={{ background: "rgba(59,130,246,0.05)", border: "1px solid rgba(59,130,246,0.15)" }}>
              <div className="flex items-center gap-2 mb-1">
                <Zap className="w-4 h-4" style={{ color: "#3b82f6" }} />
                <p className="text-sm font-medium" style={{ color: "#3b82f6" }}>Pending Verification</p>
              </div>
              <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
                Your details have been submitted. Stripe is verifying your identity and bank information. This usually takes 1-2 business days.
              </p>
            </div>
          )}

          {status === "ACTIVE" && (
            <div className="rounded-lg p-4" style={{ background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.15)" }}>
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 className="w-4 h-4" style={{ color: "#22c55e" }} />
                <p className="text-sm font-medium" style={{ color: "#22c55e" }}>Direct Deposit Active</p>
              </div>
              <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
                Your bank account is connected and verified. You will receive payouts directly to your bank account.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => dashboardMutation.mutate()}
                disabled={dashboardMutation.isPending}
                data-testid="button-my-connect-dashboard"
              >
                <ExternalLink className="w-3.5 h-3.5 mr-1" />
                View Stripe Dashboard
              </Button>
            </div>
          )}

          {status === "SUSPENDED" && (
            <div className="rounded-lg p-4" style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.15)" }}>
              <div className="flex items-center gap-2 mb-1">
                <XCircle className="w-4 h-4" style={{ color: "#ef4444" }} />
                <p className="text-sm font-medium" style={{ color: "#ef4444" }}>Account Suspended</p>
              </div>
              <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
                Your Stripe Connect account has been suspended. Contact your administrator for assistance.
              </p>
            </div>
          )}
        </FormSection>
      </CardContent>
    </Card>
  );
}