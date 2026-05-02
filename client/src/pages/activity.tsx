import { useQuery } from "@tanstack/react-query";
import { useState, useMemo, useCallback } from "react";
import { Activity, User, FileText, Briefcase, FolderKanban, Clock, Receipt, DollarSign, Filter, CalendarDays, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { useLocation } from "wouter";

interface ActivityItem {
  id: string;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  details: any;
  createdAt: string;
}

interface ActivityResponse {
  success: boolean;
  total: number;
  limit: number;
  offset: number;
  activities: ActivityItem[];
  availableEntityTypes: string[];
  availableActions: string[];
}

interface TeamUser {
  id: string;
  name: string;
  email: string;
}

const ENTITY_ICONS: Record<string, typeof FileText> = {
  invoice: FileText,
  client: Briefcase,
  project: FolderKanban,
  estimate: FileText,
  expense: Receipt,
  "time-entry": Clock,
  "time_entry": Clock,
  user: User,
  payment: DollarSign,
};

const ACTION_COLORS: Record<string, string> = {
  created: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  updated: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  deleted: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  sent: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  paid: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  approved: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200",
  rejected: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
};

const DATE_RANGES = [
  { value: "all", label: "All Time" },
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 Days" },
  { value: "30d", label: "Last 30 Days" },
  { value: "custom", label: "Custom Range" },
];

const STANDARD_ENTITY_TYPES = [
  { value: "invoice", label: "Invoice" },
  { value: "client", label: "Client" },
  { value: "project", label: "Project" },
  { value: "estimate", label: "Estimate" },
  { value: "expense", label: "Expense" },
  { value: "time_entry", label: "Time Entry" },
  { value: "user", label: "User" },
];

const STANDARD_ACTIONS = [
  { value: "created", label: "Created" },
  { value: "updated", label: "Updated" },
  { value: "deleted", label: "Deleted" },
  { value: "sent", label: "Sent" },
  { value: "paid", label: "Paid" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return format(new Date(iso), "MMM d, yyyy");
}

function getActionLabel(action: string): string {
  const lower = action.toLowerCase();
  for (const a of STANDARD_ACTIONS) {
    if (lower.includes(a.value)) return a.label;
  }
  return action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function getActionColor(action: string): string {
  const lower = action.toLowerCase();
  for (const [key, cls] of Object.entries(ACTION_COLORS)) {
    if (lower.includes(key)) return cls;
  }
  return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200";
}

export default function ActivityPage() {
  const [, navigate] = useLocation();
  const [actor, setActor] = useState("all");
  const [entityType, setEntityType] = useState("all");
  const [actionType, setActionType] = useState("all");
  const [dateRange, setDateRange] = useState("all");
  const [customStart, setCustomStart] = useState<Date | undefined>();
  const [customEnd, setCustomEnd] = useState<Date | undefined>();
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const { data: teamData } = useQuery<{ users: TeamUser[] }>({
    queryKey: ["/api/team"],
    queryFn: async () => {
      const res = await fetch("/api/team", { credentials: "include" });
      if (!res.ok) return { users: [] };
      const data = await res.json();
      return { users: Array.isArray(data) ? data : data.users || [] };
    },
  });
  const teamUsers = teamData?.users ?? [];

  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    if (actor !== "all") p.set("actor", actor);
    if (entityType !== "all") p.set("entityType", entityType);
    if (actionType !== "all") p.set("action", actionType);
    if (dateRange !== "all" && dateRange !== "custom") p.set("dateRange", dateRange);
    if (dateRange === "custom") {
      if (customStart) p.set("startDate", customStart.toISOString().split("T")[0]);
      if (customEnd) p.set("endDate", customEnd.toISOString().split("T")[0]);
    }
    p.set("limit", String(pageSize));
    p.set("offset", String(page * pageSize));
    return p.toString();
  }, [actor, entityType, actionType, dateRange, customStart, customEnd, page]);

  const { data, isLoading } = useQuery<ActivityResponse>({
    queryKey: ["/api/activity", queryParams],
    queryFn: async () => {
      const res = await fetch(`/api/activity?${queryParams}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch activity");
      return res.json();
    },
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });

  const activities = data?.activities ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  const hasActiveFilters = actor !== "all" || entityType !== "all" || actionType !== "all" || dateRange !== "all";

  const clearFilters = useCallback(() => {
    setActor("all");
    setEntityType("all");
    setActionType("all");
    setDateRange("all");
    setCustomStart(undefined);
    setCustomEnd(undefined);
    setPage(0);
  }, []);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6" data-testid="activity-page">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold" data-testid="text-activity-title">Activity Feed</h1>
          <Badge variant="secondary" data-testid="badge-total-count">{total} entries</Badge>
        </div>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="button-clear-filters">
            <X className="w-4 h-4 mr-1" />
            Clear filters
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="py-4 px-5">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">Filters</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Actor</label>
              <Select value={actor} onValueChange={(v) => { setActor(v); setPage(0); }}>
                <SelectTrigger data-testid="select-actor-filter">
                  <SelectValue placeholder="All Users" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Users</SelectItem>
                  {teamUsers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name || u.email}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Entity Type</label>
              <Select value={entityType} onValueChange={(v) => { setEntityType(v); setPage(0); }}>
                <SelectTrigger data-testid="select-entity-filter">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {STANDARD_ENTITY_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Action</label>
              <Select value={actionType} onValueChange={(v) => { setActionType(v); setPage(0); }}>
                <SelectTrigger data-testid="select-action-filter">
                  <SelectValue placeholder="All Actions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Actions</SelectItem>
                  {STANDARD_ACTIONS.map((a) => (
                    <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Date Range</label>
              <Select value={dateRange} onValueChange={(v) => { setDateRange(v); setPage(0); }}>
                <SelectTrigger data-testid="select-date-filter">
                  <SelectValue placeholder="All Time" />
                </SelectTrigger>
                <SelectContent>
                  {DATE_RANGES.map((d) => (
                    <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {dateRange === "custom" && (
            <div className="flex items-center gap-3 mt-3">
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground">From:</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="w-[140px] text-left font-normal" data-testid="button-start-date">
                      <CalendarDays className="w-3.5 h-3.5 mr-1.5" />
                      {customStart ? format(customStart, "MMM d, yyyy") : "Pick date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={customStart} onSelect={(d) => { setCustomStart(d ?? undefined); setPage(0); }} initialFocus />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground">To:</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="w-[140px] text-left font-normal" data-testid="button-end-date">
                      <CalendarDays className="w-3.5 h-3.5 mr-1.5" />
                      {customEnd ? format(customEnd, "MMM d, yyyy") : "Pick date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={customEnd} onSelect={(d) => { setCustomEnd(d ?? undefined); setPage(0); }} initialFocus />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : activities.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Activity className="w-12 h-12 text-muted-foreground mb-3" />
            <p className="text-lg font-medium" data-testid="text-no-activity">No activity found</p>
            <p className="text-sm text-muted-foreground">
              {hasActiveFilters ? "Try adjusting your filters" : "Activity will appear here as actions are performed"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-2">
            {activities.map((item) => {
              const Icon = ENTITY_ICONS[item.entityType.toLowerCase()] || Activity;
              const detailMsg = item.details?.message || item.details?.description || "";
              return (
                <Card key={item.id} className="hover:bg-muted/30 transition-colors" data-testid={`card-activity-${item.id}`}>
                  <CardContent className="flex items-center gap-4 py-3 px-5">
                    <div className="shrink-0 w-9 h-9 rounded-full bg-muted flex items-center justify-center">
                      <Icon className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm" data-testid={`text-actor-${item.id}`}>
                          {item.userName || item.userEmail || "System"}
                        </span>
                        <Badge
                          variant="secondary"
                          className={`text-[10px] px-1.5 py-0 ${getActionColor(item.action)}`}
                          data-testid={`badge-action-${item.id}`}
                        >
                          {getActionLabel(item.action)}
                        </Badge>
                        <span className="text-sm text-muted-foreground capitalize" data-testid={`text-entity-${item.id}`}>
                          {item.entityType.replace(/_/g, " ")}
                        </span>
                        {item.entityId && (
                          <span className="text-xs text-muted-foreground font-mono">#{item.entityId.slice(0, 8)}</span>
                        )}
                      </div>
                      {detailMsg && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate" data-testid={`text-detail-${item.id}`}>
                          {typeof detailMsg === "string" ? detailMsg : JSON.stringify(detailMsg)}
                        </p>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0" data-testid={`text-time-${item.id}`}>
                      {timeAgo(item.createdAt)}
                    </span>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-sm text-muted-foreground">
                Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                  data-testid="button-prev-page"
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => p + 1)}
                  data-testid="button-next-page"
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
