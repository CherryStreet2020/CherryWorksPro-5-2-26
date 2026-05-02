import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { PageHelpLink } from "@/components/page-help-link";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { useToast } from "@/hooks/use-toast";
import { isValidStripeUrl } from "@/lib/url-validation";
import { roleLabel } from "@/lib/role-label";
import PhoneInput from "react-phone-number-input/min";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/shared/status-badge";
import { ActiveFilterBar, type FilterChipDescriptor } from "@/components/active-filter-chip";
import { AvatarInitials } from "@/components/shared/avatar-initials";
import { StatCard } from "@/components/shared/stat-card";
import { FormSection } from "@/components/shared/form-section";
import { EmptyState } from "@/components/shared/empty-state";
import { formatHoursMinutes, formatRate } from "@/components/shared/format";
import { useBillingStatus } from "@/hooks/use-billing-status";
import { Link, useLocation } from "wouter";
import {
  UserPlus, Search, KeyRound, UserX, X, Plus, ExternalLink, Zap, ArrowUpRight,
  Users, UserCheck, Briefcase, CheckCircle2, XCircle,
  Building2, MapPin, CreditCard, ShieldCheck, AlertCircle, Lock,
  Clock, DollarSign, FileText, ChevronRight, MoreVertical, Eye, Pencil,
  Copy, AlertTriangle, Link2, ArrowLeft,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useDocumentTitle } from "@/lib/use-document-title";

interface TeamMember {
  id: string;
  name: string;
  firstName?: string | null;
  lastName?: string | null;
  email: string;
  role: "ADMIN" | "MANAGER" | "TEAM_MEMBER";
  isActive: boolean;
  onboardingComplete: boolean;
  tempPassword: boolean;
  phone: string | null;
  title?: string | null;
  department?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  createdAt: string;
  projectCount: number;
  totalHoursThisMonth: number;
  workerType?: string | null;
  stripeConnectStatus?: string | null;
  projects: Array<{
    projectId: string;
    projectName: string;
    hourlyRate: string;
    role: string;
  }>;
  legalName?: string | null;
  payToName?: string | null;
  ein?: string | null;
  mailingAddress?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  addressZip?: string | null;
  addressCountry?: string | null;
  taxIdLast4?: string | null;
  isPayoutEligible?: boolean;
  paymentMethod?: string | null;
  bankName?: string | null;
  bankRoutingNumber?: string | null;
  bankAccountNumber?: string | null;
  bankAccountType?: string | null;
  zelleContact?: string | null;
  w9OnFile?: boolean;
  agreementSigned?: boolean;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  payrollProviderId?: string | null;
  payrollProviderName?: string | null;
  hourlyPayRate?: string | null;
  salaryAmount?: string | null;
  payType?: string | null;
  notes?: string | null;
  lastLoginAt?: string | null;
}

interface ProjectOption {
  id: string;
  name: string;
  clientName: string;
}

const WORKER_TYPE_LABELS: Record<string, string> = {
  "INDEPENDENT": "1099 Independent",
  "W2_EMPLOYEE": "W-2 Employee",
  "CORP_TO_CORP": "Corp-to-Corp",
};

const WORKER_TYPE_STYLES: Record<string, { bg: string; color: string }> = {
  "INDEPENDENT": { bg: "rgba(59,130,246,0.1)", color: "#3b82f6" },
  "W2_EMPLOYEE": { bg: "rgba(34,197,94,0.1)", color: "#22c55e" },
  "CORP_TO_CORP": { bg: "rgba(168,85,247,0.1)", color: "#a855f7" },
};

const CONNECT_STATUS_CONFIG: Record<string, { label: string; bg: string; color: string; dot: string }> = {
  NOT_STARTED: { label: "Not Connected", bg: "rgba(107,114,128,0.1)", color: "#6b7280", dot: "#9ca3af" },
  ONBOARDING_STARTED: { label: "Onboarding", bg: "rgba(245,158,11,0.1)", color: "#f59e0b", dot: "#f59e0b" },
  ONBOARDING_COMPLETE: { label: "Pending", bg: "rgba(59,130,246,0.1)", color: "#3b82f6", dot: "#3b82f6" },
  ACTIVE: { label: "Connected", bg: "rgba(34,197,94,0.1)", color: "#22c55e", dot: "#22c55e" },
  SUSPENDED: { label: "Suspended", bg: "rgba(239,68,68,0.1)", color: "#ef4444", dot: "#ef4444" },
};

type FilterType = "all" | "active" | "inactive" | "W2_EMPLOYEE" | "INDEPENDENT" | "CORP_TO_CORP";

const FILTER_OPTIONS: { key: FilterType; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "inactive", label: "Inactive" },
  { key: "W2_EMPLOYEE", label: "W-2" },
  { key: "INDEPENDENT", label: "Independent" },
  { key: "CORP_TO_CORP", label: "C2C" },
];

function displayName(m: { firstName?: string | null; lastName?: string | null; name: string }) {
  if (m.firstName || m.lastName) return [m.firstName, m.lastName].filter(Boolean).join(" ");
  return m.name;
}

function maskValue(value: string | null | undefined, showLast = 4): string {
  if (!value) return "Not provided";
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
    display = value || "Not provided";
  }
  const hasValue = value !== null && value !== undefined && value !== "";
  return (
    <div className="flex justify-between items-center py-2">
      <span className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>{label}</span>
      <span
        className="text-sm font-medium text-right max-w-[60%]"
        style={{ color: hasValue ? "var(--lux-text)" : "var(--lux-text-muted)", fontStyle: hasValue ? "normal" : "italic" }}
      >
        {display}
      </span>
    </div>
  );
}

function ComplianceRow({ label, value }: { label: string; value?: boolean }) {
  const met = value === true;
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>{label}</span>
      <div className="flex items-center gap-1.5">
        {met ? (
          <CheckCircle2 className="w-4 h-4 text-green-500" />
        ) : (
          <XCircle className="w-4 h-4 text-red-400" />
        )}
        <span className="text-sm font-medium" style={{ color: met ? "#22c55e" : "#f87171" }}>
          {met ? "Yes" : "No"}
        </span>
      </div>
    </div>
  );
}

function PendingInvitesSection({ members, isAdmin }: { members: TeamMember[]; isAdmin: boolean }) {
  const { toast } = useToast();
  const [revokeTarget, setRevokeTarget] = useState<TeamMember | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);

  const pending = members.filter(m => m.isActive && !m.lastLoginAt && m.tempPassword);

  const handleResend = async (memberId: string) => {
    setResendingId(memberId);
    try {
      const res = await apiRequest("POST", `/api/team/${memberId}/resend-invite`);
      const data = await res.json();
      const m = pending.find(x => x.id === memberId);
      const copyLink = () => {
        if (data.inviteUrl) {
          navigator.clipboard.writeText(data.inviteUrl);
          toast({ title: "Copied!", description: "Invite link copied to clipboard" });
        }
      };
      toast({
        title: data.emailSent ? "Invite resent!" : "Invite regenerated",
        description: (
          <div className="space-y-2">
            <p>{data.emailSent ? `Email resent to ${m?.email}` : "Email delivery failed — copy the link below."}</p>
            {data.inviteUrl && (
              <button
                onClick={copyLink}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors hover:opacity-80"
                style={{ background: "rgba(207,51,57,0.15)", color: "#cf3339" }}
                data-testid="button-copy-resend-link"
              >
                <Copy className="w-3 h-3" /> Copy invite link
              </button>
            )}
          </div>
        ),
        duration: 15000,
      });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setResendingId(null);
    }
  };

  const revokeMutation = useMutation({
    mutationFn: async (memberId: string) => {
      const res = await apiRequest("DELETE", `/api/team/${memberId}/revoke-invite`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team"] });
      toast({ title: "Invite revoked", description: "The pending invite has been removed." });
      setRevokeTarget(null);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setRevokeTarget(null);
    },
  });

  if (!isAdmin || pending.length === 0) return null;

  return (
    <>
      <div className="mb-6" data-testid="section-pending-invites">
        <h3 className="text-sm font-bold mb-3 flex items-center gap-2" style={{ color: "var(--lux-text)" }}>
          <Clock className="w-4 h-4" style={{ color: "#f59e0b" }} />
          Pending Invites
          <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b" }}>
            {pending.length}
          </span>
        </h3>
        <div className="space-y-2">
          {pending.map(m => (
            <div
              key={m.id}
              className="flex items-center justify-between rounded-xl px-4 py-3"
              style={{ background: "var(--lux-card-bg)", border: "1px solid var(--lux-border)" }}
              data-testid={`pending-invite-${m.id}`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b" }}>
                  {(m.firstName || m.name || "?")[0].toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: "var(--lux-text)" }}>{displayName(m)}</p>
                  <p className="text-xs truncate" style={{ color: "var(--lux-text-muted)" }}>{m.email} · {m.role}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleResend(m.id)}
                  disabled={resendingId === m.id}
                  className="text-xs h-8 px-3"
                  data-testid={`button-resend-${m.id}`}
                >
                  <ArrowUpRight className="w-3.5 h-3.5 mr-1" /> {resendingId === m.id ? "Sending..." : "Resend"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setRevokeTarget(m)}
                  className="text-xs h-8 px-3 text-red-400 hover:text-red-300"
                  data-testid={`button-revoke-${m.id}`}
                >
                  <X className="w-3.5 h-3.5 mr-1" /> Revoke
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    try {
                      const res = await apiRequest("POST", `/api/team/${m.id}/resend-invite`);
                      const data = await res.json();
                      if (data.inviteUrl) {
                        await navigator.clipboard.writeText(data.inviteUrl);
                        toast({ title: "Copied!", description: "Invite link copied to clipboard" });
                      }
                    } catch (err: any) {
                      toast({ title: "Error", description: err.message, variant: "destructive" });
                    }
                  }}
                  className="text-xs h-8 px-3"
                  data-testid={`button-copylink-${m.id}`}
                >
                  <Link2 className="w-3.5 h-3.5 mr-1" /> Copy Link
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <Dialog open={!!revokeTarget} onOpenChange={(v) => { if (!v) setRevokeTarget(null); }}>
        <DialogContent className="max-w-sm" style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}>
          <DialogHeader>
            <DialogTitle style={{ color: "var(--lux-text)" }}>Revoke Invite</DialogTitle>
          </DialogHeader>
          <p className="text-sm" style={{ color: "var(--lux-text-muted)" }}>
            Are you sure you want to revoke the invite for <strong style={{ color: "var(--lux-text)" }}>{revokeTarget ? displayName(revokeTarget) : ""}</strong> ({revokeTarget?.email})?
            This will permanently delete their account.
          </p>
          <div className="flex gap-3 mt-4">
            <Button
              variant="destructive"
              className="flex-1"
              onClick={() => revokeTarget && revokeMutation.mutate(revokeTarget.id)}
              disabled={revokeMutation.isPending}
              data-testid="button-confirm-revoke"
            >
              {revokeMutation.isPending ? "Revoking..." : "Revoke Invite"}
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setRevokeTarget(null)}
              data-testid="button-cancel-revoke"
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function TeamPage() {
  useDocumentTitle("Team");
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const isAdmin = user?.role === "ADMIN";
  const canManage = user?.role === "ADMIN" || user?.role === "MANAGER";
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterType>("active");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [detailMember, setDetailMember] = useState<TeamMember | null>(null);
  const [sortBy, setSortBy] = useState<"name" | "workerType" | "status" | "startDate">("name");
  const { maxTeamMembers, currentTeamMembers, planTier } = useBillingStatus();

  const { data: members, isLoading } = useQuery<TeamMember[]>({
    queryKey: ["/api/team"],
  });

  const { data: allProjects } = useQuery<ProjectOption[]>({
    queryKey: ["/api/projects"],
    select: (data: any[]) => data.map((p: any) => ({ id: p.id, name: p.name, clientName: p.clientName || "" })),
  });

  const cardResetPwdMutation = useMutation({
    mutationFn: async (memberId: string) => {
      const res = await apiRequest("POST", `/api/team/${memberId}/reset-password`);
      return res.json();
    },
    onSuccess: (data: any, memberId: string) => {
      const m = members?.find(x => x.id === memberId);
      if (data.emailSent) {
        toast({ title: "Password Reset", description: `New credentials emailed to ${m?.email || "user"}` });
      } else {
        toast({ title: "Password Reset", description: `Password reset. Email delivery failed — contact them directly.`, variant: "destructive", duration: 10000 });
      }
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const cardDeactivateMutation = useMutation({
    mutationFn: async (memberId: string) => {
      const res = await apiRequest("POST", `/api/team/${memberId}/deactivate`);
      return res.json();
    },
    onSuccess: (_: any, memberId: string) => {
      const m = members?.find(x => x.id === memberId);
      queryClient.invalidateQueries({ queryKey: ["/api/team"] });
      toast({ title: "Deactivated", description: `${m ? displayName(m) : "Member"} has been deactivated.` });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const filtered = (members || []).filter(m => {
    if (filter === "active" && !m.isActive) return false;
    if (filter === "inactive" && m.isActive) return false;
    if (filter === "W2_EMPLOYEE" && m.workerType !== "W2_EMPLOYEE") return false;
    if (filter === "INDEPENDENT" && m.workerType !== "INDEPENDENT") return false;
    if (filter === "CORP_TO_CORP" && m.workerType !== "CORP_TO_CORP") return false;
    if (search) {
      const q = search.toLowerCase();
      const dn = displayName(m).toLowerCase();
      return dn.includes(q) || m.email.toLowerCase().includes(q) || (m.title || "").toLowerCase().includes(q);
    }
    return true;
  }).sort((a, b) => {
    if (sortBy === "name") return displayName(a).localeCompare(displayName(b));
    if (sortBy === "workerType") return (a.workerType || "").localeCompare(b.workerType || "");
    if (sortBy === "status") return (a.isActive ? 0 : 1) - (b.isActive ? 0 : 1);
    if (sortBy === "startDate") return (a.startDate || "").localeCompare(b.startDate || "");
    return 0;
  });

  const { data: canonicalTeam } = useQuery<{ total: number; active: number; independents: number; employees: number }>({
    queryKey: ["/api/canonical/active-team"],
  });
  const allMembers = members || [];
  const totalMembers = allMembers.length;
  const activeCount = canonicalTeam?.active ?? allMembers.filter(m => m.isActive).length;
  const w2Count = canonicalTeam?.employees ?? allMembers.filter(m => m.workerType === "W2_EMPLOYEE" && m.isActive).length;
  const independentCount = canonicalTeam?.independents ?? allMembers.filter(m => (m.workerType === "INDEPENDENT" || m.workerType === "CORP_TO_CORP") && m.isActive).length;
  const atTeamLimit = activeCount >= maxTeamMembers;

  if (isLoading) {
    return (
      <div className="px-6 lg:px-8 xl:px-10 py-6 space-y-6">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-12 w-full" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 lg:px-8 xl:px-10 py-6 space-y-6">
      <PageBreadcrumbs group="People" page="Team" />
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--lux-text)" }} data-testid="text-team-title">Team</h1>
            <PageHelpLink />
          </div>
          <p className="text-sm mt-1" style={{ color: "var(--lux-text-muted)" }}>
            Manage your team
            {maxTeamMembers < 999 && (
              <span className="ml-2 font-medium" data-testid="text-team-limit">
                ({activeCount} of {maxTeamMembers} seats)
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {atTeamLimit && (
            <Link href="/pricing">
              <Button variant="outline" size="sm" data-testid="button-upgrade-team">
                <Lock className="w-3.5 h-3.5 mr-1.5" /> Upgrade
              </Button>
            </Link>
          )}
          {isAdmin && (
            <Button
              className="text-white"
              style={{ background: atTeamLimit ? "var(--lux-text-muted)" : "var(--gradient-brand)" }}
              onClick={() => { if (!atTeamLimit) setInviteOpen(true); else toast({ title: "Team limit reached", description: `Your ${planTier} plan supports up to ${maxTeamMembers} team members. Upgrade to add more.`, variant: "destructive" }); }}
              data-testid="button-invite"
            >
              <UserPlus className="w-4 h-4 mr-2" /> Invite Member
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard icon={Users} label="Total Members" value={String(totalMembers)} testId="stat-total-members" />
        <StatCard icon={UserCheck} label="Active" value={String(activeCount)} color="#22c55e" testId="stat-active-members" />
        <StatCard icon={Building2} label="W-2 Employees" value={String(w2Count)} color="#3b82f6" testId="stat-w2" />
        <StatCard icon={Briefcase} label="Independent" value={String(independentCount)} color="#a855f7" testId="stat-independents" />
      </div>

      {(() => {
        const chips: FilterChipDescriptor[] = [];
        if (filter !== "active") {
          const opt = FILTER_OPTIONS.find((f) => f.key === filter);
          chips.push({
            id: "filter",
            label: `Show: ${opt?.label || filter}`,
            onClear: () => setFilter("active"),
          });
        }
        if (search) {
          chips.push({
            id: "search",
            label: `Search: "${search}"`,
            onClear: () => setSearch(""),
          });
        }
        return <ActiveFilterBar chips={chips} />;
      })()}

      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--lux-text-muted)" }} />
          <Input
            className="pl-9 h-10"
            placeholder="Search by name, email, or title..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid="input-search-team"
          />
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {FILTER_OPTIONS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
              style={{
                background: filter === f.key ? "var(--lux-accent)" : "var(--lux-surface-alt)",
                color: filter === f.key ? "#fff" : "var(--lux-text-muted)",
              }}
              data-testid={`button-filter-${f.key}`}
            >
              {f.label}
              {filter === f.key && f.key !== "all" && (
                <span
                  className="ml-1 cursor-pointer"
                  onClick={e => { e.stopPropagation(); setFilter("all"); }}
                >
                  <X className="w-3 h-3 inline" />
                </span>
              )}
            </button>
          ))}
        </div>
        <Select value={sortBy} onValueChange={v => setSortBy(v as any)}>
          <SelectTrigger className="w-[140px] h-9 text-xs" data-testid="select-sort">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Name</SelectItem>
            <SelectItem value="workerType">Worker Type</SelectItem>
            <SelectItem value="status">Status</SelectItem>
            <SelectItem value="startDate">Start Date</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 && (
        <Card className="border-0 rounded-xl" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
          <CardContent className="py-0">
            <EmptyState icon={Users} title="No team members found" description="Try adjusting your search or filter criteria." />
          </CardContent>
        </Card>
      )}

      <PendingInvitesSection members={members || []} isAdmin={isAdmin} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered.map(m => {
          const dn = displayName(m);
          const wt = m.workerType || "INDEPENDENT";
          const wtStyle = WORKER_TYPE_STYLES[wt] || WORKER_TYPE_STYLES["INDEPENDENT"];
          const connectCfg = CONNECT_STATUS_CONFIG[m.stripeConnectStatus || "NOT_STARTED"] || CONNECT_STATUS_CONFIG.NOT_STARTED;
          const isIndependent = wt !== "W2_EMPLOYEE";
          return (
            <Card
              key={m.id}
              className="border-0 rounded-xl cursor-pointer group"
              style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)", transition: "box-shadow 0.2s, transform 0.2s" }}
              onClick={() => setDetailMember(m)}
              data-testid={`card-team-${m.id}`}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 8px 30px rgba(0,0,0,0.12)"; (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = "var(--lux-card-shadow)"; (e.currentTarget as HTMLElement).style.transform = "none"; }}
            >
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  <div className="relative flex-shrink-0">
                    <AvatarInitials name={dn} size="md" />
                    {isIndependent && m.role === "TEAM_MEMBER" && (
                      <span
                        className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2"
                        style={{ background: connectCfg.dot, borderColor: "var(--lux-surface)" }}
                        title={`Connect: ${connectCfg.label}`}
                      />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold truncate" style={{ color: "var(--lux-text)" }}>{dn}</span>
                      {!m.isActive && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>Inactive</span>
                      )}
                    </div>
                    {m.title && (
                      <p className="text-xs mt-0.5 truncate" style={{ color: "var(--lux-text-muted)" }}>{m.title}</p>
                    )}
                    <p className="text-xs mt-0.5 truncate" style={{ color: "var(--lux-text-muted)" }}>{m.email}</p>
                    <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                      <span
                        className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                        style={{ background: m.role === "ADMIN" ? "rgba(245,158,11,0.1)" : m.role === "MANAGER" ? "rgba(59,130,246,0.1)" : "rgba(107,114,128,0.08)", color: m.role === "ADMIN" ? "#f59e0b" : m.role === "MANAGER" ? "#3b82f6" : "var(--lux-text-muted)" }}
                        data-testid={`badge-role-${m.id}`}
                      >
                        {roleLabel(m.role)}
                      </span>
                      {m.department && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: "var(--lux-surface-alt)", color: "var(--lux-text-muted)" }}>
                          {m.department}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-2 text-xs" style={{ color: "var(--lux-text-muted)" }}>
                      <span className="inline-flex items-center gap-1">
                        <Briefcase className="w-3 h-3" />
                        {m.projectCount} project{m.projectCount !== 1 ? "s" : ""}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatHoursMinutes(m.totalHoursThisMonth * 60)} this month
                      </span>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 flex-shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                        onClick={(e) => e.stopPropagation()}
                        data-testid={`button-member-menu-${m.id}`}
                      >
                        <MoreVertical className="w-4 h-4" style={{ color: "var(--lux-text-muted)" }} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenuItem onClick={() => setDetailMember(m)} data-testid={`menu-view-${m.id}`}>
                        <Eye className="w-3.5 h-3.5 mr-2" /> View Details
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setDetailMember(m)} data-testid={`menu-edit-${m.id}`}>
                        <Pencil className="w-3.5 h-3.5 mr-2" /> Edit
                      </DropdownMenuItem>
                      {isAdmin && (
                        <DropdownMenuItem
                          disabled={cardResetPwdMutation.isPending}
                          onClick={() => cardResetPwdMutation.mutate(m.id)}
                          data-testid={`menu-reset-pwd-${m.id}`}
                        >
                          <KeyRound className="w-3.5 h-3.5 mr-2" /> Reset Password
                        </DropdownMenuItem>
                      )}
                      {isAdmin && m.isActive && (
                        <DropdownMenuItem
                          className="text-red-500 focus:text-red-500"
                          disabled={cardDeactivateMutation.isPending}
                          onClick={() => cardDeactivateMutation.mutate(m.id)}
                          data-testid={`menu-deactivate-${m.id}`}
                        >
                          <UserX className="w-3.5 h-3.5 mr-2" /> Deactivate
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        allProjects={allProjects || []}
      />

      {detailMember && (
        <MemberDetailDialog
          member={detailMember}
          open={!!detailMember}
          onOpenChange={(open) => { if (!open) setDetailMember(null); }}
        />
      )}
    </div>
  );
}

function InviteDialog({ open, onOpenChange, allProjects }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  allProjects: ProjectOption[];
}) {
  const { toast } = useToast();
  const { data: orgSettings } = useQuery<{ defaultBillRate?: number }>({
    queryKey: ["/api/org/settings"],
    enabled: open,
  });
  const firmDefaultRate = String(orgSettings?.defaultBillRate ?? 125);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<"TEAM_MEMBER" | "MANAGER" | "ADMIN">("TEAM_MEMBER");
  const [workerType, setWorkerType] = useState("INDEPENDENT");
  const [title, setTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [payType, setPayType] = useState("HOURLY");
  const [hourlyPayRate, setHourlyPayRate] = useState("");
  const [salaryAmount, setSalaryAmount] = useState("");
  const [payrollProviderName, setPayrollProviderName] = useState("");
  const [billRate, setBillRate] = useState("125");
  const [assignments, setAssignments] = useState<Array<{ projectId: string; hourlyRate: string }>>([]);

  const { data: smtpStatus } = useQuery<{ configured: boolean }>({
    queryKey: ["/api/team/smtp-status"],
    enabled: open,
  });

  const inviteMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        firstName, lastName, email, role, workerType, phone, title, department,
        name: [firstName, lastName].filter(Boolean).join(" "),
        projectAssignments: assignments,
      };
      if (workerType === "W2_EMPLOYEE") {
        body.payType = payType;
        if (payType === "HOURLY") body.hourlyPayRate = hourlyPayRate;
        else body.salaryAmount = salaryAmount;
        if (payrollProviderName) body.payrollProviderName = payrollProviderName;
      }
      const res = await apiRequest("POST", "/api/team/invite", body);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/team"] });
      const copyLink = () => {
        if (data.inviteUrl) {
          navigator.clipboard.writeText(data.inviteUrl);
          toast({ title: "Copied!", description: "Invite link copied to clipboard" });
        }
      };
      toast({
        title: data.emailSent ? "Invite sent!" : "Team member created",
        description: (
          <div className="space-y-2">
            <p>{data.emailSent ? `Invitation email sent to ${data.user.email}` : "Email delivery failed — share the invite link manually."}</p>
            {data.inviteUrl && (
              <button
                onClick={copyLink}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors hover:opacity-80"
                style={{ background: "rgba(207,51,57,0.15)", color: "#cf3339" }}
                data-testid="button-copy-invite-link"
              >
                <Copy className="w-3 h-3" /> Copy invite link
              </button>
            )}
          </div>
        ),
        duration: 15000,
      });
      onOpenChange(false);
      setFirstName(""); setLastName(""); setEmail(""); setPhone(""); setRole("TEAM_MEMBER"); setWorkerType("INDEPENDENT"); setTitle(""); setDepartment(""); setPayType("HOURLY"); setHourlyPayRate(""); setSalaryAmount(""); setPayrollProviderName(""); setAssignments([]); setBillRate(firmDefaultRate);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}>
        <DialogHeader>
          <DialogTitle style={{ color: "var(--lux-text)" }}>Invite Team Member</DialogTitle>
        </DialogHeader>
        {smtpStatus && !smtpStatus.configured && (
          <div
            className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs"
            style={{ background: "rgba(234,179,8,0.1)", border: "1px solid rgba(234,179,8,0.25)", color: "rgba(234,179,8,0.9)" }}
            data-testid="banner-smtp-not-configured"
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>Email delivery not configured — the invite link will be shown after sending</span>
          </div>
        )}
        <div className="space-y-4 mt-2">
          <FormSection title="Personal Details">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>First Name *</Label>
                  <Input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Jane" data-testid="input-invite-firstName" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Last Name *</Label>
                  <Input value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Doe" data-testid="input-invite-lastName" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Email *</Label>
                  <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@company.com" data-testid="input-invite-email" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Phone</Label>
                  <PhoneInput
                    international
                    defaultCountry="US"
                    value={phone}
                    onChange={(val) => setPhone(val || "")}
                    className="phone-input-field"
                    data-testid="input-invite-phone"
                  />
                </div>
              </div>
            </div>
          </FormSection>

          <FormSection title="Role & Classification">
            <div className="space-y-3">
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="role" checked={role === "ADMIN"} onChange={() => setRole("ADMIN")} data-testid="radio-role-admin" />
                  <div>
                    <span className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>Admin</span>
                    <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>Full access including settings, billing, payouts</p>
                  </div>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="role" checked={role === "MANAGER"} onChange={() => setRole("MANAGER")} data-testid="radio-role-manager" />
                  <div>
                    <span className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>Manager</span>
                    <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>Operational access — clients, invoices, GL, reports</p>
                  </div>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="role" checked={role === "TEAM_MEMBER"} onChange={() => setRole("TEAM_MEMBER")} data-testid="radio-role-team-member" />
                  <div>
                    <span className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>Team Member</span>
                    <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>Time tracking and own expenses only</p>
                  </div>
                </label>
              </div>
              {role === "TEAM_MEMBER" && (
                <div className="space-y-2 pt-2" style={{ borderTop: "1px solid var(--lux-border)" }}>
                  <Label className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Worker Classification</Label>
                  <Select value={workerType} onValueChange={setWorkerType}>
                    <SelectTrigger className="h-9 text-sm" data-testid="select-worker-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="INDEPENDENT">1099 Independent</SelectItem>
                      <SelectItem value="W2_EMPLOYEE">W-2 Employee</SelectItem>
                      <SelectItem value="CORP_TO_CORP">Corp-to-Corp (C2C)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
                    {workerType === "W2_EMPLOYEE"
                      ? "W-2 employees are paid through your payroll provider."
                      : workerType === "CORP_TO_CORP"
                        ? "Corp-to-Corp team members invoice through their company."
                        : "Standard 1099 independent team member."
                    }
                  </p>
                </div>
              )}
            </div>
          </FormSection>

          {role === "TEAM_MEMBER" && workerType === "W2_EMPLOYEE" && (
            <FormSection title="Compensation & Payroll">
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Pay Type</Label>
                  <Select value={payType} onValueChange={setPayType}>
                    <SelectTrigger className="h-9 text-sm" data-testid="select-pay-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="HOURLY">Hourly</SelectItem>
                      <SelectItem value="SALARY">Salary</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {payType === "HOURLY" ? (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Hourly Rate ($)</Label>
                    <Input value={hourlyPayRate} onChange={e => setHourlyPayRate(e.target.value)} placeholder="35.00" data-testid="input-hourly-rate" />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Annual Salary ($)</Label>
                    <Input value={salaryAmount} onChange={e => setSalaryAmount(e.target.value)} placeholder="75000" data-testid="input-salary" />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Payroll Provider</Label>
                  <Select value={payrollProviderName} onValueChange={setPayrollProviderName}>
                    <SelectTrigger className="h-9 text-sm" data-testid="select-payroll-provider">
                      <SelectValue placeholder="Select provider" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Gusto">Gusto</SelectItem>
                      <SelectItem value="ADP">ADP</SelectItem>
                      <SelectItem value="Paychex">Paychex</SelectItem>
                      <SelectItem value="Rippling">Rippling</SelectItem>
                      <SelectItem value="OnPay">OnPay</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </FormSection>
          )}

          {role === "TEAM_MEMBER" && workerType !== "W2_EMPLOYEE" && (
            <FormSection title="Rate & Projects">
              <div className="space-y-3">
                {assignments.length > 0 && (
                  <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--lux-border)" }}>
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ background: "var(--lux-bg-muted)" }}>
                          <th className="text-left px-3 py-2 text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Project</th>
                          <th className="text-left px-3 py-2 text-xs font-medium w-32" style={{ color: "var(--lux-text-muted)" }}>Rate</th>
                          <th className="w-10" />
                        </tr>
                      </thead>
                      <tbody>
                        {assignments.map((a, idx) => {
                          const proj = allProjects.find(p => p.id === a.projectId);
                          return (
                            <tr key={a.projectId} className="border-t" style={{ borderColor: "var(--lux-border)" }}>
                              <td className="px-3 py-2">
                                <Select value={a.projectId} onValueChange={(v) => {
                                  if (assignments.some(x => x.projectId === v)) return;
                                  const next = [...assignments];
                                  next[idx] = { ...next[idx], projectId: v };
                                  setAssignments(next);
                                }}>
                                  <SelectTrigger className="h-8 text-sm border-0 p-0 shadow-none" data-testid={`select-assignment-project-${idx}`}>
                                    <SelectValue>{proj?.name || "Select project"}</SelectValue>
                                  </SelectTrigger>
                                  <SelectContent>
                                    {allProjects.filter(p => !assignments.some(x => x.projectId === p.id) || p.id === a.projectId).map(p => (
                                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-1">
                                  <span className="text-xs" style={{ color: "var(--lux-text-muted)" }}>$</span>
                                  <Input
                                    type="number"
                                    className="h-8 w-20 text-sm"
                                    value={a.hourlyRate}
                                    onChange={(e) => {
                                      const next = [...assignments];
                                      next[idx] = { ...next[idx], hourlyRate: e.target.value };
                                      setAssignments(next);
                                    }}
                                    data-testid={`input-assignment-rate-${idx}`}
                                  />
                                  <span className="text-xs" style={{ color: "var(--lux-text-muted)" }}>/hr</span>
                                </div>
                              </td>
                              <td className="px-1 py-2 text-center">
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setAssignments(assignments.filter(x => x.projectId !== a.projectId))} aria-label="Remove assignment" data-testid={`button-remove-assignment-${idx}`}>
                                  <X className="w-3.5 h-3.5" style={{ color: "var(--lux-text-muted)" }} />
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                <Button variant="outline" size="sm" onClick={() => {
                  const available = allProjects.filter(p => !assignments.some(a => a.projectId === p.id));
                  if (available.length === 0) return;
                  setAssignments([...assignments, { projectId: available[0].id, hourlyRate: firmDefaultRate }]);
                }} data-testid="button-add-assignment">
                  <Plus className="w-3.5 h-3.5 mr-1.5" /> Add project rate
                </Button>
              </div>
            </FormSection>
          )}

          <FormSection title="Additional Info" description="Optional">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Job Title</Label>
                <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Senior Team Member" data-testid="input-invite-title" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Department</Label>
                <Input value={department} onChange={e => setDepartment(e.target.value)} placeholder="Engineering" data-testid="input-invite-department" />
              </div>
            </div>
          </FormSection>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              className="text-white"
              style={{ background: "var(--gradient-brand)" }}
              onClick={() => inviteMutation.mutate()}
              disabled={!firstName || !email || inviteMutation.isPending}
              data-testid="button-send-invite"
            >
              {inviteMutation.isPending ? "Sending..." : "Send Invite"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type TabKey = "profile" | "compensation" | "compliance" | "deposits";

function MemberDetailDialog({ member, open, onOpenChange }: {
  member: TeamMember;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const [tab, setTab] = useState<TabKey>("profile");
  const dn = displayName(member);
  const wt = member.workerType || "INDEPENDENT";
  const isIndependentType = wt === "INDEPENDENT" || wt === "CORP_TO_CORP";
  const isW2 = wt === "W2_EMPLOYEE";
  const isTeamMemberRole = member.role === "TEAM_MEMBER";
  const wtStyle = WORKER_TYPE_STYLES[wt] || WORKER_TYPE_STYLES["INDEPENDENT"];

  const tabs: { key: TabKey; label: string; icon: typeof Users }[] = [
    { key: "profile", label: "Profile", icon: Users },
    { key: "compensation", label: "Compensation", icon: DollarSign },
    { key: "compliance", label: "Compliance", icon: ShieldCheck },
    { key: "deposits", label: "Direct Deposits", icon: Zap },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl max-h-[85vh] overflow-y-auto"
        style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}
      >
        <DialogHeader>
          <div className="flex items-center gap-4">
            <AvatarInitials name={dn} size="lg" />
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-lg" style={{ color: "var(--lux-text)" }}>{dn}</DialogTitle>
              {member.title && (
                <p className="text-sm mt-0.5" style={{ color: "var(--lux-text-muted)" }}>{member.title}</p>
              )}
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <span
                  className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                  style={{ background: wtStyle.bg, color: wtStyle.color }}
                >
                  {WORKER_TYPE_LABELS[wt] || wt}
                </span>
                <span
                  className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                  style={{ background: member.role === "ADMIN" ? "rgba(245,158,11,0.1)" : member.role === "MANAGER" ? "rgba(59,130,246,0.1)" : "rgba(107,114,128,0.08)", color: member.role === "ADMIN" ? "#f59e0b" : member.role === "MANAGER" ? "#3b82f6" : "var(--lux-text-muted)" }}
                >
                  {member.role === "ADMIN" ? "Admin" : member.role === "MANAGER" ? "Manager" : "Member"}
                </span>
                {member.isActive ? (
                  <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e" }}>
                    <CheckCircle2 className="w-3 h-3" /> Active
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>
                    <XCircle className="w-3 h-3" /> Inactive
                  </span>
                )}
                {!member.onboardingComplete && (
                  <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: "rgba(245,158,11,0.1)", color: "#f59e0b" }}>
                    <AlertCircle className="w-3 h-3" /> Pending Onboarding
                  </span>
                )}
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="mt-4 border-b" style={{ borderColor: "var(--lux-border)" }}>
          <div className="flex gap-0">
            {tabs.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className="relative px-4 py-2.5 text-xs font-medium transition-colors"
                style={{ color: tab === t.key ? "var(--lux-accent)" : "var(--lux-text-muted)" }}
                data-testid={`tab-${t.key}`}
              >
                <span className="flex items-center gap-1.5">
                  <t.icon className="w-3.5 h-3.5" />
                  {t.label}
                </span>
                {tab === t.key && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t" style={{ background: "var(--lux-accent)" }} />
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 min-h-[300px]">
          {tab === "profile" && <ProfileTab member={member} onOpenChange={onOpenChange} />}
          {tab === "compensation" && <CompensationTab member={member} onOpenChange={onOpenChange} />}
          {tab === "compliance" && <ComplianceTab member={member} />}
          {tab === "deposits" && <DepositsTab member={member} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProfileTab({ member, onOpenChange }: { member: TeamMember; onOpenChange: (v: boolean) => void }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const { toast } = useToast();
  const [editFirstName, setEditFirstName] = useState(member.firstName || "");
  const [editLastName, setEditLastName] = useState(member.lastName || "");
  const [editEmail, setEditEmail] = useState(member.email);
  const [editPhone, setEditPhone] = useState(member.phone || "");
  const [editRole, setEditRole] = useState(member.role);
  const [editWorkerType, setEditWorkerType] = useState(member.workerType || "INDEPENDENT");
  const [editTitle, setEditTitle] = useState(member.title || "");
  const [editDepartment, setEditDepartment] = useState(member.department || "");
  const [editStartDate, setEditStartDate] = useState(member.startDate || "");
  const [editNotes, setEditNotes] = useState(member.notes || "");
  const isTeamMemberRole = member.role === "TEAM_MEMBER";

  const updateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/team/${member.id}`, {
        firstName: editFirstName, lastName: editLastName, email: editEmail,
        phone: editPhone, role: editRole, workerType: editWorkerType,
        title: editTitle, department: editDepartment, startDate: editStartDate, notes: editNotes,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team"] });
      toast({ title: "Updated", description: `${editFirstName} ${editLastName} has been updated.` });
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/team/${member.id}/deactivate`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team"] });
      toast({ title: "Deactivated", description: `${displayName(member)} has been deactivated.` });
      onOpenChange(false);
    },
  });

  const resetPwdMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/team/${member.id}/reset-password`);
      return res.json();
    },
    onSuccess: (data) => {
      if (data.emailSent) {
        toast({ title: "Password Reset", description: `New credentials emailed to ${member.email}` });
      } else {
        toast({ title: "Password Reset", description: `Password reset for ${member.email}. Email delivery failed — please contact them directly.`, variant: "destructive", duration: 10000 });
      }
    },
  });

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>First Name</Label>
          <Input value={editFirstName} onChange={e => setEditFirstName(e.target.value)} data-testid="input-edit-firstName" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Last Name</Label>
          <Input value={editLastName} onChange={e => setEditLastName(e.target.value)} data-testid="input-edit-lastName" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Email</Label>
          <Input value={editEmail} onChange={e => setEditEmail(e.target.value)} data-testid="input-edit-email" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Phone</Label>
          <PhoneInput
            international
            defaultCountry="US"
            value={editPhone}
            onChange={(val) => setEditPhone(val || "")}
            className="phone-input-field"
            data-testid="input-edit-phone"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Job Title</Label>
          <Input value={editTitle} onChange={e => setEditTitle(e.target.value)} placeholder="Senior Team Member" data-testid="input-edit-title" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Department</Label>
          <Input value={editDepartment} onChange={e => setEditDepartment(e.target.value)} placeholder="Engineering" data-testid="input-edit-department" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Start Date</Label>
          <Input type="date" value={editStartDate} onChange={e => setEditStartDate(e.target.value)} data-testid="input-edit-startDate" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Role</Label>
          <Select value={editRole} onValueChange={(v) => setEditRole(v as "ADMIN" | "MANAGER" | "TEAM_MEMBER")}>
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ADMIN">Admin — Full access to all settings, billing, and team management</SelectItem>
              <SelectItem value="MANAGER">Manager — Can manage projects, clients, invoices, and approve time</SelectItem>
              <SelectItem value="TEAM_MEMBER">Team Member — Can track time, log expenses, and view assigned projects</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {isTeamMemberRole && (
          <div className="space-y-1.5 col-span-2">
            <Label className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Worker Classification</Label>
            <Select value={editWorkerType} onValueChange={setEditWorkerType}>
              <SelectTrigger className="h-9 text-sm" data-testid="select-edit-worker-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="INDEPENDENT">1099 Independent</SelectItem>
                <SelectItem value="W2_EMPLOYEE">W-2 Employee</SelectItem>
                <SelectItem value="CORP_TO_CORP">Corp-to-Corp (C2C)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Notes</Label>
        <Textarea
          value={editNotes}
          onChange={e => setEditNotes(e.target.value)}
          placeholder="Admin notes about this team member..."
          className="min-h-[60px] text-sm"
          data-testid="input-edit-notes"
        />
      </div>

      {member.projects.length > 0 && (
        <FormSection title="Project Assignments" icon={<Briefcase className="w-4 h-4" />}>
          <div className="space-y-2">
            {member.projects.map(p => (
              <div key={p.projectId} className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ background: "var(--lux-surface-alt)" }}>
                <span className="text-sm" style={{ color: "var(--lux-text)" }}>{p.projectName}</span>
                <span className="text-xs font-medium tabular-nums" style={{ color: "var(--lux-text-muted)" }}>{formatRate(p.hourlyRate)}</span>
              </div>
            ))}
          </div>
        </FormSection>
      )}

      {isAdmin && (
        <div className="flex items-center gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={() => resetPwdMutation.mutate()} disabled={resetPwdMutation.isPending} data-testid="button-reset-password">
            <KeyRound className="w-3.5 h-3.5 mr-1" /> Reset Password
          </Button>
          {member.isActive && (
            <Button variant="outline" size="sm" className="text-red-500 border-red-200" onClick={() => deactivateMutation.mutate()} disabled={deactivateMutation.isPending} data-testid="button-deactivate">
              <UserX className="w-3.5 h-3.5 mr-1" /> Deactivate
            </Button>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-3 border-t" style={{ borderColor: "var(--lux-border)" }}>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button className="text-white" style={{ background: "var(--gradient-brand)" }} onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending} data-testid="button-save-member">
          {updateMutation.isPending ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </div>
  );
}

function CompensationTab({ member, onOpenChange }: { member: TeamMember; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const wt = member.workerType || "INDEPENDENT";
  const isW2 = wt === "W2_EMPLOYEE";

  const [payType, setPayType] = useState(member.payType || "HOURLY");
  const [hourlyPayRate, setHourlyPayRate] = useState(member.hourlyPayRate || "");
  const [salaryAmount, setSalaryAmount] = useState(member.salaryAmount || "");
  const [payrollProviderName, setPayrollProviderName] = useState(member.payrollProviderName || "");
  const [payrollProviderId, setPayrollProviderId] = useState(member.payrollProviderId || "");

  const updateMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {};
      if (isW2) {
        body.payType = payType;
        body.hourlyPayRate = payType === "HOURLY" ? hourlyPayRate : "";
        body.salaryAmount = payType === "SALARY" ? salaryAmount : "";
        body.payrollProviderName = payrollProviderName;
        body.payrollProviderId = payrollProviderId;
      }
      const res = await apiRequest("PATCH", `/api/team/${member.id}`, body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team"] });
      toast({ title: "Updated", description: "Compensation details saved." });
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (isW2) {
    return (
      <div className="space-y-5">
        <FormSection title="W-2 Compensation" icon={<DollarSign className="w-4 h-4" />}>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Pay Type</Label>
              <Select value={payType} onValueChange={setPayType}>
                <SelectTrigger className="h-9 text-sm" data-testid="select-comp-payType"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="HOURLY">Hourly</SelectItem>
                  <SelectItem value="SALARY">Salary</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {payType === "HOURLY" ? (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Hourly Rate ($)</Label>
                <Input value={hourlyPayRate} onChange={e => setHourlyPayRate(e.target.value)} placeholder="35.00" className="tabular-nums" data-testid="input-comp-hourlyRate" />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Annual Salary ($)</Label>
                <Input value={salaryAmount} onChange={e => setSalaryAmount(e.target.value)} placeholder="75000" className="tabular-nums" data-testid="input-comp-salary" />
              </div>
            )}
          </div>
        </FormSection>

        <FormSection title="Payroll Provider" icon={<Building2 className="w-4 h-4" />}>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Provider</Label>
              <Select value={payrollProviderName} onValueChange={setPayrollProviderName}>
                <SelectTrigger className="h-9 text-sm" data-testid="select-comp-provider"><SelectValue placeholder="Select provider" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Gusto">Gusto</SelectItem>
                  <SelectItem value="ADP">ADP</SelectItem>
                  <SelectItem value="Paychex">Paychex</SelectItem>
                  <SelectItem value="Rippling">Rippling</SelectItem>
                  <SelectItem value="OnPay">OnPay</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>External Employee ID</Label>
              <Input value={payrollProviderId} onChange={e => setPayrollProviderId(e.target.value)} placeholder="Employee ID in payroll system" data-testid="input-comp-providerId" />
            </div>
            <div className="rounded-lg p-3" style={{ background: "rgba(59,130,246,0.05)", border: "1px solid rgba(59,130,246,0.12)" }}>
              <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
                Payroll is processed through your external provider. Connect via Zapier to sync time data automatically.
              </p>
              <a href="#" className="inline-flex items-center gap-1 text-xs font-medium mt-2" style={{ color: "#3b82f6" }} data-testid="link-zapier-setup">
                <ExternalLink className="w-3 h-3" /> Setup Zapier Integration
              </a>
            </div>
          </div>
        </FormSection>

        <div className="flex justify-end gap-2 pt-3 border-t" style={{ borderColor: "var(--lux-border)" }}>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="text-white" style={{ background: "var(--gradient-brand)" }} onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending} data-testid="button-save-comp">
            {updateMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <FormSection title="Pay Rates" icon={<DollarSign className="w-4 h-4" />}>
        <div className="space-y-1">
          {member.projects.length > 0 ? (
            member.projects.map(p => (
              <div key={p.projectId} className="flex items-center justify-between py-2">
                <span className="text-sm" style={{ color: "var(--lux-text)" }}>{p.projectName}</span>
                <span className="text-sm font-medium tabular-nums" style={{ color: "var(--lux-text)" }}>{formatRate(p.hourlyRate)}</span>
              </div>
            ))
          ) : (
            <p className="text-sm italic py-2" style={{ color: "var(--lux-text-muted)" }}>No project assignments yet</p>
          )}
        </div>
      </FormSection>

      <FormSection title="Payment Information" icon={<CreditCard className="w-4 h-4" />}>
        <div className="space-y-0.5">
          <DetailRow label="Payment Method" value={member.paymentMethod ? member.paymentMethod.toUpperCase() : null} />
          {(member.paymentMethod === "ach" || member.paymentMethod === "ACH") ? (
            <>
              <DetailRow label="Bank Name" value={member.bankName} />
              <DetailRow label="Routing Number" value={member.bankRoutingNumber} masked />
              <DetailRow label="Account Number" value={member.bankAccountNumber} masked />
              <DetailRow label="Account Type" value={member.bankAccountType ? member.bankAccountType.charAt(0).toUpperCase() + member.bankAccountType.slice(1) : null} />
            </>
          ) : (member.paymentMethod === "zelle" || member.paymentMethod === "Zelle" || member.paymentMethod === "ZELLE") ? (
            <DetailRow label="Zelle Contact" value={member.zelleContact} />
          ) : (
            <>
              {member.bankName && <DetailRow label="Bank Name" value={member.bankName} />}
              {member.zelleContact && <DetailRow label="Zelle Contact" value={member.zelleContact} />}
            </>
          )}
        </div>
      </FormSection>
    </div>
  );
}

function ComplianceTab({ member }: { member: TeamMember }) {
  const wt = member.workerType || "INDEPENDENT";
  const isW2 = wt === "W2_EMPLOYEE";
  const isIndependentType = wt === "INDEPENDENT" || wt === "CORP_TO_CORP";

  const addressParts = [
    member.addressLine1,
    member.addressLine2,
    [member.addressCity, member.addressState].filter(Boolean).join(", "),
    member.addressZip,
  ].filter(Boolean);
  const formattedAddress = addressParts.length > 0 ? addressParts.join("\n") : null;
  const displayAddress = formattedAddress || member.mailingAddress || null;

  if (isW2) {
    return (
      <div className="space-y-5">
        <FormSection title="Emergency Contact" icon={<Users className="w-4 h-4" />}>
          <div className="space-y-0.5">
            <DetailRow label="Contact Name" value={member.emergencyContactName} />
            <DetailRow label="Contact Phone" value={member.emergencyContactPhone} />
          </div>
        </FormSection>
        <FormSection title="Employment Dates" icon={<Clock className="w-4 h-4" />}>
          <div className="space-y-0.5">
            <DetailRow label="Start Date" value={member.startDate} />
            <DetailRow label="End Date" value={member.endDate || "Currently active"} />
          </div>
        </FormSection>
        <FormSection title="Mailing Address" icon={<MapPin className="w-4 h-4" />}>
          {displayAddress ? (
            <div className="text-sm leading-relaxed whitespace-pre-line" style={{ color: "var(--lux-text)" }}>{displayAddress}</div>
          ) : (
            <p className="text-sm italic" style={{ color: "var(--lux-text-muted)" }}>No address on file</p>
          )}
        </FormSection>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {isIndependentType && (
        <FormSection title="Business Entity" icon={<Building2 className="w-4 h-4" />}>
          <div className="space-y-0.5">
            <DetailRow label="Legal Name" value={member.legalName} />
            <DetailRow label="Pay-To Name" value={member.payToName} />
            <DetailRow label="EIN" value={member.ein} masked />
            <DetailRow label="Tax ID (last 4)" value={member.taxIdLast4} />
            <DetailRow label="1099 Eligible" value={member.isPayoutEligible} />
          </div>
        </FormSection>
      )}
      {isIndependentType && (
        <FormSection title="Compliance Documents" icon={<ShieldCheck className="w-4 h-4" />}>
          <div className="space-y-0.5">
            <ComplianceRow label="W-9 On File" value={member.w9OnFile} />
            <ComplianceRow label="Agreement Signed" value={member.agreementSigned} />
          </div>
        </FormSection>
      )}
      <FormSection title="Mailing Address" icon={<MapPin className="w-4 h-4" />}>
        {displayAddress ? (
          <div className="text-sm leading-relaxed whitespace-pre-line" style={{ color: "var(--lux-text)" }}>{displayAddress}</div>
        ) : (
          <p className="text-sm italic" style={{ color: "var(--lux-text-muted)" }}>No address on file</p>
        )}
      </FormSection>
      <FormSection title="Dates" icon={<Clock className="w-4 h-4" />}>
        <div className="space-y-0.5">
          <DetailRow label="Start Date" value={member.startDate} />
          <DetailRow label="End Date" value={member.endDate || "Currently active"} />
        </div>
      </FormSection>
      <FormSection title="Emergency Contact" icon={<Users className="w-4 h-4" />}>
        <div className="space-y-0.5">
          <DetailRow label="Contact Name" value={member.emergencyContactName} />
          <DetailRow label="Contact Phone" value={member.emergencyContactPhone} />
        </div>
      </FormSection>
    </div>
  );
}

function DepositsTab({ member }: { member: TeamMember }) {
  const wt = member.workerType || "INDEPENDENT";
  const isW2 = wt === "W2_EMPLOYEE";

  if (isW2) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl p-5" style={{ background: "rgba(59,130,246,0.05)", border: "1px solid rgba(59,130,246,0.12)" }}>
          <div className="flex items-start gap-3">
            <Building2 className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: "#3b82f6" }} />
            <div>
              <p className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>Payroll Provider Handles Direct Deposits</p>
              <p className="text-xs mt-1" style={{ color: "var(--lux-text-muted)" }}>
                Direct deposits for W-2 employees are handled through your payroll provider
                {member.payrollProviderName ? ` (${member.payrollProviderName})` : ""}.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <StripeConnectSection member={member} />;
}

function StripeConnectSection({ member }: { member: TeamMember }) {
  const { toast } = useToast();
  const connectStatus = member.stripeConnectStatus || "NOT_STARTED";
  const config = CONNECT_STATUS_CONFIG[connectStatus] || CONNECT_STATUS_CONFIG.NOT_STARTED;

  const onboardMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/team/${member.id}/connect-onboarding`);
      return res.json();
    },
    onSuccess: (data) => {
      if (data.url) {
        if (isValidStripeUrl(data.url)) {
          window.open(data.url, "_blank");
          toast({ title: "Stripe Connect", description: "Onboarding link opened in a new tab." });
          queryClient.invalidateQueries({ queryKey: ["/api/team"] });
        } else {
          toast({ title: "Error", description: "Invalid URL provided. Please check your Stripe configuration.", variant: "destructive" });
        }
      }
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const dashboardMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", `/api/connect/dashboard/${member.id}`);
      return res.json();
    },
    onSuccess: (data) => {
      if (data.url) {
        if (isValidStripeUrl(data.url)) {
          window.open(data.url, "_blank");
        } else {
          toast({ title: "Error", description: "Invalid URL provided. Please check your Stripe configuration.", variant: "destructive" });
        }
      }
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>Direct Deposit Status</span>
          <span
            className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-semibold"
            style={{ background: config.bg, color: config.color }}
            data-testid="badge-connect-detail-status"
          >
            <Zap className="w-3 h-3" />
            {config.label}
          </span>
        </div>
      </div>

      {connectStatus === "NOT_STARTED" && (
        <div className="rounded-xl p-4" style={{ background: "rgba(99,102,241,0.05)", border: "1px solid rgba(99,102,241,0.12)" }}>
          <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
            Set up Stripe Connect to send direct deposits to this team member. They will complete identity verification and bank account setup through Stripe.
          </p>
          <Button
            size="sm"
            className="mt-3 text-white"
            style={{ background: "var(--gradient-brand)" }}
            onClick={() => onboardMutation.mutate()}
            disabled={onboardMutation.isPending}
            data-testid="button-setup-connect"
          >
            <Zap className="w-3.5 h-3.5 mr-1" />
            {onboardMutation.isPending ? "Setting up..." : "Set Up Payments"}
          </Button>
        </div>
      )}

      {connectStatus === "ONBOARDING_STARTED" && (
        <div className="rounded-xl p-4" style={{ background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.12)" }}>
          <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
            Onboarding has been started. The team member needs to complete identity verification and bank setup on Stripe.
          </p>
          <Button
            size="sm" variant="outline" className="mt-3"
            onClick={() => onboardMutation.mutate()}
            disabled={onboardMutation.isPending}
            data-testid="button-resend-connect"
          >
            <ExternalLink className="w-3.5 h-3.5 mr-1" />
            {onboardMutation.isPending ? "Generating link..." : "Resend Onboarding Link"}
          </Button>
        </div>
      )}

      {connectStatus === "ACTIVE" && (
        <div className="rounded-xl p-4" style={{ background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.12)" }}>
          <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
            Stripe Connect is active. You can send direct deposits to this team member from the Payouts page.
          </p>
          <Button
            size="sm" variant="outline" className="mt-3"
            onClick={() => dashboardMutation.mutate()}
            disabled={dashboardMutation.isPending}
            data-testid="button-connect-dashboard"
          >
            <ExternalLink className="w-3.5 h-3.5 mr-1" />
            View Stripe Dashboard
          </Button>
        </div>
      )}

      {connectStatus === "ONBOARDING_COMPLETE" && (
        <div className="rounded-xl p-4" style={{ background: "rgba(59,130,246,0.05)", border: "1px solid rgba(59,130,246,0.12)" }}>
          <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
            The team member has submitted their details. Stripe is verifying their identity and bank information.
          </p>
        </div>
      )}

      {connectStatus === "SUSPENDED" && (
        <div className="rounded-xl p-4" style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.12)" }}>
          <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
            This account has been suspended by Stripe. The team member may need to provide additional verification.
          </p>
          <Button
            size="sm" variant="outline" className="mt-3"
            onClick={() => onboardMutation.mutate()}
            disabled={onboardMutation.isPending}
          >
            <ExternalLink className="w-3.5 h-3.5 mr-1" />
            Re-verify Account
          </Button>
        </div>
      )}
    </div>
  );
}
