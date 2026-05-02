import { useState, useMemo, useEffect, useRef } from "react";
import { UpgradeWall } from "@/components/upgrade-wall";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { PageHelpLink } from "@/components/page-help-link";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { useBillingStatus } from "@/hooks/use-billing-status";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, Unlock, Eye, ClipboardList, Search, ChevronDown, ChevronUp, Clock, Users, ThumbsUp, ArrowLeft, Undo2, Activity, Send, UserPlus, type LucideIcon } from "lucide-react";
import { useLocation } from "wouter";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type TimesheetWeek, getWeekStartDate } from "@shared/schema";

interface TeamMemberLite {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
}
import { StatusBadge } from "@/components/shared/status-badge";
import { ActiveFilterBar, type FilterChipDescriptor } from "@/components/active-filter-chip";
import { DateDisplay } from "@/components/shared/date-display";
import { EmptyState } from "@/components/shared/empty-state";
import { AvatarInitials } from "@/components/shared/avatar-initials";
import { StatCard } from "@/components/shared/stat-card";
import { FormSection } from "@/components/shared/form-section";
import { formatHoursMinutes, formatPercent, formatDate } from "@/components/shared/format";
import { useDocumentTitle } from "@/lib/use-document-title";
import { useUrlFilterState } from "@/lib/use-url-filter-state";

interface TimesheetWithUser extends TimesheetWeek {
  userName: string;
  userEmail?: string;
  totalMinutes?: number;
  billableMinutes?: number;
}

interface TimesheetActivityDetails {
  targetUserId?: string;
  weekStartDate?: string;
  rejectionReason?: string;
}

interface TimesheetActivityEntry {
  id: string;
  action:
    | "TIMESHEET_SUBMITTED"
    | "TIMESHEET_SUBMITTED_BY_MANAGER"
    | "TIMESHEET_RECALLED"
    | "TIMESHEET_APPROVED"
    | "TIMESHEET_REJECTED";
  entityType: string;
  entityId: string | null;
  actorName: string;
  createdAt: string;
  details: TimesheetActivityDetails | null;
}

interface WeekEntry {
  id: string;
  date: string;
  minutes: number;
  billable: boolean;
  notes: string | null;
  projectName: string;
  clientName: string;
}

type StatusFilter = "ALL" | "SUBMITTED" | "APPROVED" | "REJECTED";
type SortField = "weekStartDate" | "userName" | "totalMinutes";

export default function ApprovalsPage() {
  useDocumentTitle("Approvals");
  const { toast } = useToast();
  const { isProfessionalPlus } = useBillingStatus();
  const [, setLocation] = useLocation();
  const [viewSheet, setViewSheet] = useState<TimesheetWithUser | null>(null);
  const [rejectSheet, setRejectSheet] = useState<TimesheetWithUser | null>(null);
  const [unlockSheet, setUnlockSheet] = useState<TimesheetWithUser | null>(null);
  const [reason, setReason] = useState("");
  const [filters, setFilter] = useUrlFilterState({
    status: "ALL",
    q: "",
    member: "all",
    sort: "weekStartDate",
    dir: "desc",
  });
  const [hubFilter, setHubFilter] = useState<{ label: string } | null>(null);
  const statusFilter = filters.status as StatusFilter;
  const searchTerm = filters.q;
  const teamMemberFilter = filters.member;
  const sortField = filters.sort as SortField;
  const sortDir = filters.dir as "asc" | "desc";
  const setStatusFilter = (v: StatusFilter) => setFilter("status", v);
  const setSearchTerm = (v: string) => setFilter("q", v, { replace: true });
  const setTeamMemberFilter = (v: string) => setFilter("member", v);
  const [selectedTimesheets, setSelectedTimesheets] = useState<Set<string>>(new Set());
  const [expandedSheet, setExpandedSheet] = useState<string | null>(null);
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false);
  const [bulkRejectReason, setBulkRejectReason] = useState("");
  // "Submit on behalf" lets a manager/admin submit a forgotten week for
  // a teammate so it enters the approval queue normally.
  const [submitForOpen, setSubmitForOpen] = useState(false);
  const [submitForUserId, setSubmitForUserId] = useState<string>("");
  const [submitForWeekRaw, setSubmitForWeekRaw] = useState<string>(
    () => new Date().toISOString().split("T")[0],
  );
  const [submitForConfirmEmpty, setSubmitForConfirmEmpty] = useState(false);

  const { data: allTimesheets, isLoading } = useQuery<TimesheetWithUser[]>({
    queryKey: ["/api/timesheets/all"],
    enabled: isProfessionalPlus,
    refetchInterval: isProfessionalPlus ? 30_000 : false,
  });

  const { data: recentActivity } = useQuery<TimesheetActivityEntry[]>({
    queryKey: ["/api/timesheets/recent-activity"],
    enabled: isProfessionalPlus,
    refetchInterval: isProfessionalPlus ? 30_000 : false,
  });

  const seenRecallIdsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!recentActivity) return;
    const recallEvents = recentActivity.filter((a) => a.action === "TIMESHEET_RECALLED");
    if (seenRecallIdsRef.current === null) {
      seenRecallIdsRef.current = new Set(recallEvents.map((r) => r.id));
      return;
    }
    const seen = seenRecallIdsRef.current;
    const fresh = recallEvents.filter((r) => !seen.has(r.id));
    if (fresh.length > 0) {
      fresh.forEach((r) => {
        const weekLabel = r.details?.weekStartDate ? formatWeek(r.details.weekStartDate) : "an earlier week";
        toast({
          title: "Timesheet recalled by rep",
          description: `${r.actorName} pulled back their timesheet for ${weekLabel}.`,
        });
        seen.add(r.id);
      });
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/pending"] });
    }
  }, [recentActivity, toast]);

  const { data: expandedEntries } = useQuery<WeekEntry[]>({
    queryKey: ["/api/timesheets", expandedSheet, "entries"],
    queryFn: expandedSheet
      ? () => fetch(`/api/timesheets/${expandedSheet}/entries`, { credentials: "include" }).then((r) => r.json())
      : undefined,
    enabled: !!expandedSheet,
  });

  const { data: viewEntries } = useQuery<WeekEntry[]>({
    queryKey: ["/api/timesheets", viewSheet?.id, "entries"],
    queryFn: viewSheet
      ? () => fetch(`/api/timesheets/${viewSheet.id}/entries`, { credentials: "include" }).then((r) => r.json())
      : undefined,
    enabled: !!viewSheet,
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/timesheets/${id}/approve`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/all"] });
      toast({ title: "Timesheet approved" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason: r }: { id: string; reason: string }) => {
      await apiRequest("POST", `/api/timesheets/${id}/reject`, { reason: r });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/all"] });
      setRejectSheet(null);
      setReason("");
      toast({ title: "Timesheet rejected" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const unlockMutation = useMutation({
    mutationFn: async ({ id, reason: r }: { id: string; reason: string }) => {
      await apiRequest("POST", `/api/timesheets/${id}/unlock`, { reason: r });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/all"] });
      setUnlockSheet(null);
      setReason("");
      toast({ title: "Timesheet unlocked" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const bulkApproveMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await apiRequest("POST", "/api/timesheets/bulk-approve", { ids });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/all"] });
      setSelectedTimesheets(new Set());
      toast({ title: "Selected timesheets approved" });
    },
    onError: (err: any) => {
      toast({ title: "Bulk approve failed", description: err.message, variant: "destructive" });
    },
  });

  const { data: teamMembersFull } = useQuery<TeamMemberLite[]>({
    queryKey: ["/api/users/team-members"],
    enabled: isProfessionalPlus,
  });

  const submitForRepMutation = useMutation({
    mutationFn: async ({ targetUserId, weekStartDate, confirmEmpty }: { targetUserId: string; weekStartDate: string; confirmEmpty: boolean }) => {
      return apiRequest("POST", "/api/timesheets/submit", {
        targetUserId,
        weekStartDate,
        confirmEmpty,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/recent-activity"] });
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/my-recent"] });
      setSubmitForOpen(false);
      setSubmitForUserId("");
      setSubmitForConfirmEmpty(false);
      toast({ title: "Timesheet submitted", description: "It now appears in the pending queue for approval." });
    },
    onError: (err: any) => {
      const msg = String(err?.message || "");
      // Surface the empty-week server message as an inline checkbox prompt
      // so the manager can confirm and retry, instead of a confusing toast.
      if (/confirmEmpty/i.test(msg) && !submitForConfirmEmpty) {
        toast({
          title: "This week has no time entries",
          description: "Tick \"Submit even if empty\" and try again to submit anyway.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Could not submit on behalf", description: msg, variant: "destructive" });
      }
    },
  });

  const bulkRejectMutation = useMutation({
    mutationFn: async ({ ids, reason: r }: { ids: string[]; reason: string }) => {
      await apiRequest("POST", "/api/timesheets/bulk-reject", { ids, reason: r });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/all"] });
      setSelectedTimesheets(new Set());
      setBulkRejectOpen(false);
      setBulkRejectReason("");
      toast({ title: "Selected timesheets rejected" });
    },
    onError: (err: any) => {
      toast({ title: "Bulk reject failed", description: err.message, variant: "destructive" });
    },
  });

  const formatWeek = (weekStart: string) => {
    const d = new Date(weekStart + "T12:00:00");
    const end = new Date(d);
    end.setDate(end.getDate() + 6);
    return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  };

  const teamMembers = Array.from(new Set((allTimesheets || []).map((t) => t.userName))).sort();

  const counts = {
    ALL: allTimesheets?.length || 0,
    SUBMITTED: allTimesheets?.filter((t) => t.status === "SUBMITTED").length || 0,
    APPROVED: allTimesheets?.filter((t) => t.status === "APPROVED").length || 0,
    REJECTED: allTimesheets?.filter((t) => t.status === "REJECTED").length || 0,
  };

  const totalMinutesAll = useMemo(() => {
    return (allTimesheets || []).reduce((sum, t) => sum + (t.totalMinutes || 0), 0);
  }, [allTimesheets]);

  const filtered = (allTimesheets || [])
    .filter((ts) => {
      if (statusFilter !== "ALL" && ts.status !== statusFilter) return false;
      if (searchTerm && !ts.userName.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      if (teamMemberFilter !== "all" && ts.userName !== teamMemberFilter) return false;
      return true;
    })
    .sort((a, b) => {
      let cmp = 0;
      if (sortField === "weekStartDate") cmp = a.weekStartDate.localeCompare(b.weekStartDate);
      else if (sortField === "userName") cmp = a.userName.localeCompare(b.userName);
      else if (sortField === "totalMinutes") cmp = (a.totalMinutes || 0) - (b.totalMinutes || 0);
      return sortDir === "asc" ? cmp : -cmp;
    });

  const pendingSelected = Array.from(selectedTimesheets).filter((id) => {
    const ts = allTimesheets?.find((t) => t.id === id);
    return ts?.status === "SUBMITTED";
  });

  const toggleSelect = (id: string) => {
    const next = new Set(selectedTimesheets);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedTimesheets(next);
  };

  const toggleSelectAll = () => {
    const pendingFiltered = filtered.filter((t) => t.status === "SUBMITTED");
    if (pendingFiltered.every((t) => selectedTimesheets.has(t.id))) {
      const next = new Set(selectedTimesheets);
      pendingFiltered.forEach((t) => next.delete(t.id));
      setSelectedTimesheets(next);
    } else {
      const next = new Set(selectedTimesheets);
      pendingFiltered.forEach((t) => next.add(t.id));
      setSelectedTimesheets(next);
    }
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) setFilter("dir", sortDir === "asc" ? "desc" : "asc");
    else { setFilter("sort", field); setFilter("dir", "desc"); }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortDir === "asc" ? <ChevronUp className="w-3 h-3 inline ml-0.5" /> : <ChevronDown className="w-3 h-3 inline ml-0.5" />;
  };

  if (isLoading) {
    return (
      <div className="px-6 lg:px-8 xl:px-10 py-6 space-y-6">
        <div className="flex items-center gap-4"><Skeleton className="h-12 w-12 rounded-xl" /><div><Skeleton className="h-7 w-40 rounded-lg" /><Skeleton className="h-4 w-56 rounded-md mt-1.5" /></div></div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">{[1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
        <Skeleton className="h-12 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  return (
    <UpgradeWall requiredTier="PROFESSIONAL" featureName="Approvals" description="Review and approve team member timesheets. Available on Professional plans and above.">
    <div className="px-6 lg:px-8 xl:px-10 py-6 space-y-6">
      <PageBreadcrumbs group="Management" page="Approvals" />
      <div className="flex items-center gap-4">
        <div className="relative">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(var(--lux-accent-rgb),0.15) 0%, rgba(var(--lux-accent-rgb),0.05) 100%)" }}>
            <ClipboardList className="w-6 h-6" style={{ color: "var(--lux-accent)" }} />
          </div>
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1
              className="text-2xl font-bold tracking-tight"
              style={{ color: "var(--lux-text)" }}
              data-testid="text-approvals-title"
            >
              Timesheet Approvals
            </h1>
            <PageHelpLink />
          </div>
          <p className="text-sm mt-0.5" style={{ color: "var(--lux-text-muted)" }}>
            Review and approve team member timesheets
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setSubmitForOpen(true)}
          data-testid="button-submit-on-behalf"
          style={{ borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
        >
          <UserPlus className="w-4 h-4 mr-1.5" />
          Submit for a Teammate
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" data-testid="approvals-stats-row">
        <StatCard
          icon={Users}
          label="Pending"
          value={String(counts.SUBMITTED)}
          color="#f59e0b"
          testId="stat-pending-count"
        />
        <StatCard
          icon={ThumbsUp}
          label="Approved"
          value={String(counts.APPROVED)}
          color="#22c55e"
          testId="stat-approved-count"
        />
        <StatCard
          icon={Clock}
          label="Total Hours"
          value={formatHoursMinutes(totalMinutesAll)}
          testId="stat-total-hours"
        />
      </div>

      <Card className="border-0 p-4 space-y-4" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
        <div className="flex flex-wrap gap-2" data-testid="filter-tabs">
          {(["ALL", "SUBMITTED", "APPROVED", "REJECTED"] as StatusFilter[]).map((s) => (
            <Button
              key={s}
              size="sm"
              variant={statusFilter === s ? "default" : "outline"}
              onClick={() => { setStatusFilter(s); setHubFilter(null); }}
              data-testid={`filter-tab-${s.toLowerCase()}`}
              style={statusFilter === s ? { background: "var(--gradient-brand)" } : { borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
              className={statusFilter === s ? "text-white" : ""}
            >
              {s === "ALL" ? "All" : s === "SUBMITTED" ? "Pending" : s.charAt(0) + s.slice(1).toLowerCase()}
              <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-black/10 dark:bg-white/10">
                {counts[s]}
              </span>
            </Button>
          ))}
        </div>

        {(() => {
          const statusLabels: Record<string, string> = {
            SUBMITTED: "Pending",
            APPROVED: "Approved",
            REJECTED: "Rejected",
          };
          const chips: FilterChipDescriptor[] = [];
          if (statusFilter !== "ALL") {
            chips.push({
              id: "hub-filter",
              label: hubFilter?.label || `Status: ${statusLabels[statusFilter] || statusFilter}`,
              onClear: () => { setStatusFilter("ALL"); setHubFilter(null); },
            });
          }
          if (searchTerm) {
            chips.push({
              id: "search",
              label: `Search: "${searchTerm}"`,
              onClear: () => setSearchTerm(""),
            });
          }
          if (teamMemberFilter !== "all") {
            chips.push({
              id: "team-member",
              label: `Member: ${teamMemberFilter}`,
              onClear: () => setTeamMemberFilter("all"),
            });
          }
          return <ActiveFilterBar chips={chips} />;
        })()}

        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--lux-text-muted)" }} />
              <Input
                className="pl-9"
                placeholder="Search by team member name..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                data-testid="input-search-timesheets"
              />
            </div>
          </div>
          <div className="w-48">
            <Select value={teamMemberFilter} onValueChange={setTeamMemberFilter}>
              <SelectTrigger data-testid="select-team-member-filter">
                <SelectValue placeholder="All Team Members" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Team Members</SelectItem>
                {teamMembers.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      <RecentTimesheetActivity activity={recentActivity} formatWeek={formatWeek} />

      {pendingSelected.length > 0 && (
        <div
          className="flex items-center gap-3 p-3 rounded-lg"
          style={{ background: "var(--lux-surface-alt)", border: "1px solid var(--lux-border)" }}
          data-testid="bulk-actions-bar"
        >
          <span className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>
            {pendingSelected.length} selected
          </span>
          <Button
            size="sm"
            className="text-white"
            style={{ background: "#22c55e" }}
            onClick={() => bulkApproveMutation.mutate(pendingSelected)}
            disabled={bulkApproveMutation.isPending}
            data-testid="button-bulk-approve"
          >
            <CheckCircle className="w-3.5 h-3.5 mr-1" />
            Approve Selected
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => { setBulkRejectOpen(true); setBulkRejectReason(""); }}
            data-testid="button-bulk-reject"
          >
            <XCircle className="w-3.5 h-3.5 mr-1" />
            Reject Selected
          </Button>
        </div>
      )}

      {!filtered.length ? (
        <Card
          className="border-0"
          style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}
        >
          <EmptyState
            icon={ClipboardList}
            title="No timesheets found"
            description="No timesheets match your current filters"
          />
        </Card>
      ) : (
        <Card
          className="border-0"
          style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}
        >
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: "var(--lux-table-header-bg)" }}>
                    <th className="px-4 py-2.5 w-8">
                      <Checkbox
                        checked={filtered.filter((t) => t.status === "SUBMITTED").length > 0 && filtered.filter((t) => t.status === "SUBMITTED").every((t) => selectedTimesheets.has(t.id))}
                        onCheckedChange={toggleSelectAll}
                        data-testid="checkbox-select-all"
                      />
                    </th>
                    <th
                      className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider cursor-pointer"
                      style={{ color: "var(--lux-text-muted)" }}
                      onClick={() => toggleSort("userName")}
                      data-testid="header-sort-team-member"
                    >
                      Team Member <SortIcon field="userName" />
                    </th>
                    <th
                      className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider cursor-pointer"
                      style={{ color: "var(--lux-text-muted)" }}
                      onClick={() => toggleSort("weekStartDate")}
                      data-testid="header-sort-week"
                    >
                      Week <SortIcon field="weekStartDate" />
                    </th>
                    <th
                      className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider cursor-pointer"
                      style={{ color: "var(--lux-text-muted)" }}
                      onClick={() => toggleSort("totalMinutes")}
                      data-testid="header-sort-hours"
                    >
                      Hours <SortIcon field="totalMinutes" />
                    </th>
                    <th className="text-center px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>
                      Status
                    </th>
                    <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((ts) => {
                    const isExpanded = expandedSheet === ts.id;
                    return (
                      <tr key={ts.id}>
                        <td colSpan={6} className="p-0">
                          <div
                            className="px-4 py-3 flex items-center gap-3 cursor-pointer"
                            style={{ borderTop: "1px solid var(--lux-border)" }}
                            onClick={() => setExpandedSheet(isExpanded ? null : ts.id)}
                            data-testid={`row-timesheet-${ts.id}`}
                          >
                            <div className="w-8 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                              {ts.status === "SUBMITTED" ? (
                                <Checkbox
                                  checked={selectedTimesheets.has(ts.id)}
                                  onCheckedChange={() => toggleSelect(ts.id)}
                                  data-testid={`checkbox-timesheet-${ts.id}`}
                                />
                              ) : <div className="w-4" />}
                            </div>
                            <div className="flex-1 min-w-0 flex items-center gap-2">
                              <AvatarInitials name={ts.userName} size="sm" />
                              <p className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>
                                {ts.userName}
                              </p>
                            </div>
                            <div className="w-40 text-sm" style={{ color: "var(--lux-text-secondary)" }}>
                              {formatWeek(ts.weekStartDate)}
                            </div>
                            <div className="w-32 text-right">
                              <span className="text-sm font-medium tabular-nums" style={{ color: "var(--lux-text)" }}>
                                {formatHoursMinutes(ts.totalMinutes || 0)}
                              </span>
                              <span className="text-[10px] ml-1" style={{ color: "var(--lux-text-muted)" }}>
                                ({formatHoursMinutes(ts.billableMinutes || 0)}b / {formatHoursMinutes((ts.totalMinutes || 0) - (ts.billableMinutes || 0))}nb · {formatPercent((ts.totalMinutes || 0) > 0 ? ((ts.billableMinutes || 0) / (ts.totalMinutes || 1) * 100) : 0)} util)
                              </span>
                            </div>
                            <div className="w-24 text-center">
                              <StatusBadge status={ts.status} size="xs" />
                            </div>
                            <div className="w-36 flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setViewSheet(ts)}
                                data-testid={`button-view-${ts.id}`}
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </Button>
                              {ts.status === "SUBMITTED" && (
                                <>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        size="icon"
                                        className="text-white h-7 w-7"
                                        style={{ background: "#22c55e" }}
                                        onClick={() => approveMutation.mutate(ts.id)}
                                        disabled={approveMutation.isPending}
                                        data-testid={`button-approve-${ts.id}`}
                                        aria-label="Approve timesheet"
                                      >
                                        <CheckCircle className="w-3.5 h-3.5" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Approve</TooltipContent>
                                  </Tooltip>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        size="icon"
                                        variant="destructive"
                                        className="h-7 w-7"
                                        onClick={() => { setRejectSheet(ts); setReason(""); }}
                                        data-testid={`button-reject-${ts.id}`}
                                        aria-label="Reject timesheet"
                                      >
                                        <XCircle className="w-3.5 h-3.5" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Reject</TooltipContent>
                                  </Tooltip>
                                </>
                              )}
                              {(ts.status === "APPROVED" || ts.status === "SUBMITTED" || ts.status === "REJECTED") && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2"
                                  onClick={() => { setUnlockSheet(ts); setReason(""); }}
                                  data-testid={`button-unlock-${ts.id}`}
                                >
                                  <Unlock className="w-3 h-3" />
                                </Button>
                              )}
                            </div>
                          </div>
                          {isExpanded && (
                            <div className="px-12 pb-3">
                              {ts.status === "REJECTED" && ts.rejectionReason && (
                                <div className="mb-2 p-2 rounded text-sm" style={{ background: "rgba(239,68,68,0.08)", color: "#ef4444" }} data-testid={`text-rejection-reason-${ts.id}`}>
                                  Rejection reason: {ts.rejectionReason}
                                </div>
                              )}
                              {expandedEntries ? (
                                <div className="space-y-1">
                                  {expandedEntries.length === 0 ? (
                                    <p className="text-xs py-2 text-center" style={{ color: "var(--lux-text-muted)" }}>No entries</p>
                                  ) : expandedEntries.map((e) => (
                                    <div
                                      key={e.id}
                                      className="flex items-center justify-between gap-2 p-2 rounded text-xs"
                                      style={{ background: "var(--lux-surface-alt)" }}
                                    >
                                      <div className="min-w-0">
                                        <span className="font-medium" style={{ color: "var(--lux-text)" }}>{e.projectName}</span>
                                        <span className="mx-1" style={{ color: "var(--lux-text-muted)" }}>·</span>
                                        <DateDisplay value={e.date} />
                                        {e.notes && <span style={{ color: "var(--lux-text-muted)" }}> — {e.notes}</span>}
                                      </div>
                                      <div className="flex items-center gap-2 flex-shrink-0">
                                        <span
                                          className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
                                          style={{
                                            background: e.billable ? "rgba(34,197,94,0.1)" : "rgba(148,163,184,0.15)",
                                            color: e.billable ? "#22c55e" : "var(--lux-text-muted)",
                                          }}
                                        >
                                          {e.billable ? "B" : "NB"}
                                        </span>
                                        <span className="font-bold tabular-nums" style={{ color: "var(--lux-text)" }}>
                                          {formatHoursMinutes(e.minutes)}
                                        </span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <Skeleton className="h-16 rounded" />
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!viewSheet} onOpenChange={() => setViewSheet(null)}>
        <DialogContent className="max-w-2xl" style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}>
          <DialogHeader>
            <DialogTitle style={{ color: "var(--lux-text)" }}>
              {viewSheet?.userName} - {viewSheet ? formatWeek(viewSheet.weekStartDate) : ""}
            </DialogTitle>
          </DialogHeader>
          {viewEntries ? (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {viewEntries.length === 0 ? (
                <p className="text-sm py-4 text-center" style={{ color: "var(--lux-text-muted)" }}>
                  No time entries
                </p>
              ) : (
                viewEntries.map((e) => (
                  <div
                    key={e.id}
                    className="flex items-center justify-between gap-2 p-2 rounded"
                    style={{ background: "var(--lux-surface-alt)" }}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>
                        {e.projectName}
                      </p>
                      <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
                        {formatDate(e.date)} {e.notes && ` - ${e.notes}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span
                        className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                        style={{
                          background: e.billable ? "rgba(34,197,94,0.1)" : "rgba(148,163,184,0.15)",
                          color: e.billable ? "#22c55e" : "var(--lux-text-muted)",
                        }}
                      >
                        {e.billable ? "Billable" : "Non-billable"}
                      </span>
                      <span className="text-sm font-bold tabular-nums" style={{ color: "var(--lux-text)" }}>
                        {formatHoursMinutes(e.minutes)}
                      </span>
                    </div>
                  </div>
                ))
              )}
              {viewEntries.length > 0 && (
                <div className="pt-2 border-t flex justify-end" style={{ borderColor: "var(--lux-border)" }}>
                  <span className="text-sm font-bold" style={{ color: "var(--lux-text)" }}>
                    Total: {formatHoursMinutes(viewEntries.reduce((s, e) => s + e.minutes, 0))}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <Skeleton className="h-40 rounded" />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejectSheet} onOpenChange={() => setRejectSheet(null)}>
        <DialogContent style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}>
          <DialogHeader>
            <DialogTitle style={{ color: "var(--lux-text)" }}>Reject Timesheet</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (rejectSheet) rejectMutation.mutate({ id: rejectSheet.id, reason });
            }}
            className="space-y-4"
          >
            <FormSection title="Rejection Details">
              <div className="space-y-2">
                <Label>Reason for rejection *</Label>
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                  data-testid="input-reject-reason"
                />
              </div>
            </FormSection>
            <Button
              type="submit"
              variant="destructive"
              className="w-full"
              disabled={rejectMutation.isPending || !reason}
              data-testid="button-confirm-reject"
            >
              {rejectMutation.isPending ? "Rejecting..." : "Reject Timesheet"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!unlockSheet} onOpenChange={() => setUnlockSheet(null)}>
        <DialogContent style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}>
          <DialogHeader>
            <DialogTitle style={{ color: "var(--lux-text)" }}>Unlock Timesheet</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (unlockSheet) unlockMutation.mutate({ id: unlockSheet.id, reason });
            }}
            className="space-y-4"
          >
            <FormSection title="Unlock Details">
              <div className="space-y-2">
                <Label>Reason for unlocking *</Label>
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                  data-testid="input-unlock-reason"
                />
              </div>
            </FormSection>
            <Button
              type="submit"
              className="w-full"
              disabled={unlockMutation.isPending || !reason}
              data-testid="button-confirm-unlock"
            >
              {unlockMutation.isPending ? "Unlocking..." : "Unlock Timesheet"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={submitForOpen} onOpenChange={(open) => {
        setSubmitForOpen(open);
        if (!open) setSubmitForConfirmEmpty(false);
      }}>
        <DialogContent style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}>
          <DialogHeader>
            <DialogTitle style={{ color: "var(--lux-text)" }}>Submit a Week for a Teammate</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!submitForUserId || !submitForWeekRaw) return;
              const weekStartDate = getWeekStartDate(submitForWeekRaw);
              submitForRepMutation.mutate({
                targetUserId: submitForUserId,
                weekStartDate,
                confirmEmpty: submitForConfirmEmpty,
              });
            }}
            className="space-y-4"
          >
            <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
              Use this when a team member forgot to submit their week. The
              submission goes through the normal approval flow and is recorded
              in the audit log as submitted on their behalf.
            </p>
            <FormSection title="Submission Details">
              <div className="space-y-2">
                <Label>Team Member *</Label>
                {teamMembersFull && teamMembersFull.filter((u) => u.isActive).length === 0 ? (
                  <p
                    className="text-xs rounded-md px-3 py-2"
                    style={{ background: "rgba(245,158,11,0.08)", color: "var(--lux-text-muted)" }}
                    data-testid="text-submit-for-empty"
                  >
                    No active team members yet. Invite a teammate first to use this feature.
                  </p>
                ) : (
                  <Select
                    value={submitForUserId}
                    onValueChange={setSubmitForUserId}
                  >
                    <SelectTrigger data-testid="select-submit-for-user">
                      <SelectValue placeholder="Choose a team member" />
                    </SelectTrigger>
                    <SelectContent>
                      {(teamMembersFull || [])
                        .filter((u) => u.isActive)
                        .map((u) => (
                          <SelectItem key={u.id} value={u.id} data-testid={`option-submit-for-${u.id}`}>
                            {u.name} <span style={{ color: "var(--lux-text-muted)" }}>· {u.email}</span>
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="space-y-2">
                <Label>Any day in the target week *</Label>
                <Input
                  type="date"
                  value={submitForWeekRaw}
                  onChange={(e) => setSubmitForWeekRaw(e.target.value)}
                  required
                  data-testid="input-submit-for-week"
                />
                {submitForWeekRaw && (
                  <p className="text-xs" style={{ color: "var(--lux-text-muted)" }} data-testid="text-submit-for-week-resolved">
                    Will submit week starting {formatWeek(getWeekStartDate(submitForWeekRaw))}
                  </p>
                )}
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "var(--lux-text)" }}>
                <Checkbox
                  checked={submitForConfirmEmpty}
                  onCheckedChange={(v) => setSubmitForConfirmEmpty(!!v)}
                  data-testid="checkbox-submit-for-confirm-empty"
                />
                Submit even if the week has no time entries
              </label>
            </FormSection>
            <Button
              type="submit"
              className="w-full text-white"
              style={{ background: "var(--gradient-brand)" }}
              disabled={submitForRepMutation.isPending || !submitForUserId || !submitForWeekRaw}
              data-testid="button-confirm-submit-on-behalf"
            >
              {submitForRepMutation.isPending ? "Submitting..." : "Submit Week"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkRejectOpen} onOpenChange={setBulkRejectOpen}>
        <DialogContent style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}>
          <DialogHeader>
            <DialogTitle style={{ color: "var(--lux-text)" }}>Reject {pendingSelected.length} Timesheets</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              bulkRejectMutation.mutate({ ids: pendingSelected, reason: bulkRejectReason });
            }}
            className="space-y-4"
          >
            <FormSection title="Bulk Rejection Details">
              <div className="space-y-2">
                <Label>Reason for rejection *</Label>
                <Input
                  value={bulkRejectReason}
                  onChange={(e) => setBulkRejectReason(e.target.value)}
                  required
                  data-testid="input-bulk-reject-reason"
                />
              </div>
            </FormSection>
            <Button
              type="submit"
              variant="destructive"
              className="w-full"
              disabled={bulkRejectMutation.isPending || !bulkRejectReason}
              data-testid="button-confirm-bulk-reject"
            >
              {bulkRejectMutation.isPending ? "Rejecting..." : `Reject ${pendingSelected.length} Timesheets`}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
    </UpgradeWall>
  );
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const ACTIVITY_META: Record<TimesheetActivityEntry["action"], { label: string; verb: string; color: string; bg: string; Icon: LucideIcon }> = {
  TIMESHEET_SUBMITTED: { label: "Submitted", verb: "submitted a timesheet", color: "#3b82f6", bg: "rgba(59,130,246,0.1)", Icon: Send },
  TIMESHEET_SUBMITTED_BY_MANAGER: { label: "Submitted on behalf", verb: "submitted a timesheet on behalf of a teammate", color: "#3b82f6", bg: "rgba(59,130,246,0.1)", Icon: UserPlus },
  TIMESHEET_RECALLED: { label: "Recalled", verb: "recalled their timesheet", color: "#f59e0b", bg: "rgba(245,158,11,0.12)", Icon: Undo2 },
  TIMESHEET_APPROVED: { label: "Approved", verb: "approved a timesheet", color: "#22c55e", bg: "rgba(34,197,94,0.1)", Icon: CheckCircle },
  TIMESHEET_REJECTED: { label: "Rejected", verb: "rejected a timesheet", color: "#ef4444", bg: "rgba(239,68,68,0.1)", Icon: XCircle },
};

function RecentTimesheetActivity({
  activity,
  formatWeek,
}: {
  activity: TimesheetActivityEntry[] | undefined;
  formatWeek: (w: string) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const items = (activity || []).slice(0, expanded ? 20 : 5);
  const recallCount = (activity || []).filter((a) => a.action === "TIMESHEET_RECALLED").length;

  return (
    <Card
      className="border-0"
      style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}
      data-testid="card-recent-timesheet-activity"
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4" style={{ color: "var(--lux-accent)" }} />
            <h2 className="text-sm font-semibold" style={{ color: "var(--lux-text)" }} data-testid="text-recent-activity-title">
              Recent Timesheet Activity
            </h2>
            {recallCount > 0 && (
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b" }}
                data-testid="badge-recall-count"
              >
                {recallCount} recall{recallCount === 1 ? "" : "s"}
              </span>
            )}
          </div>
          {(activity?.length || 0) > 5 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => setExpanded((v) => !v)}
              data-testid="button-toggle-activity"
            >
              {expanded ? "Show less" : `Show all (${activity?.length || 0})`}
            </Button>
          )}
        </div>
        {!items.length ? (
          <p className="text-xs py-2" style={{ color: "var(--lux-text-muted)" }} data-testid="text-no-activity">
            No timesheet activity yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((a) => {
              const meta = ACTIVITY_META[a.action] ?? ACTIVITY_META.TIMESHEET_SUBMITTED;
              const Icon = meta.Icon;
              const week = a.details?.weekStartDate ? formatWeek(a.details.weekStartDate) : null;
              return (
                <li
                  key={a.id}
                  className="flex items-center gap-3 text-sm"
                  data-testid={`activity-item-${a.id}`}
                  data-action={a.action}
                >
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: meta.bg }}
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p style={{ color: "var(--lux-text)" }}>
                      <span className="font-medium">{a.actorName}</span>
                      <span style={{ color: "var(--lux-text-muted)" }}> {meta.verb}</span>
                      {week && (
                        <span style={{ color: "var(--lux-text-muted)" }}> · {week}</span>
                      )}
                    </p>
                  </div>
                  <span
                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0"
                    style={{ background: meta.bg, color: meta.color }}
                  >
                    {meta.label}
                  </span>
                  <span className="text-[11px] flex-shrink-0 tabular-nums" style={{ color: "var(--lux-text-muted)" }}>
                    {formatRelativeTime(a.createdAt)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
