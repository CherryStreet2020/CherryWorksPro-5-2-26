import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useUrlFilterState } from "@/lib/use-url-filter-state";
import { ErrorState } from "@/components/shared/error-state";
import { ActiveFilterBar, type FilterChipDescriptor } from "@/components/active-filter-chip";
import { PageHelpLink } from "@/components/page-help-link";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Trash2, Keyboard, FileText, Plus, Play, Pencil, Copy, Lock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getWeekStartDate, getWeekEndDate } from "@shared/schema";
import type { TimesheetWeek } from "@shared/schema";
import { formatMoney, formatHours } from "@/components/shared/format";
import { formatHoursMinutes, getProjectColor } from "@/components/time/utils";
import type { ProjectOption, ServiceOption } from "@/components/time/utils";
import FloatingTimer from "@/components/time/floating-timer";
import WeekView from "@/components/time/week-view";
import MySubmissions from "@/components/time/my-submissions";
import MonthView from "@/components/time/month-view";
import DayView from "@/components/time/day-view";
import EntryList from "@/components/time/entry-list";
import type { TimeEntryWithDetails } from "@/components/time/entry-list";
import TimeFilters from "@/components/time/time-filters";
import WeekSummary from "@/components/time/week-summary";
import TimeEntryDialog from "@/components/time/time-entry-dialog";
import { useDocumentTitle } from "@/lib/use-document-title";

interface WeekData {
  timesheet: TimesheetWeek | null;
  entries: Array<TimeEntryWithDetails>;
}

function getCurrentWeekStart(): string {
  return getWeekStartDate(new Date().toISOString().split("T")[0]);
}

function getThisWeekRange(): [string, string] {
  const start = getCurrentWeekStart();
  return [start, getWeekEndDate(start)];
}

function getLastWeekRange(): [string, string] {
  const d = new Date(getCurrentWeekStart() + "T12:00:00");
  d.setUTCDate(d.getUTCDate() - 7);
  const start = d.toISOString().split("T")[0];
  return [start, getWeekEndDate(start)];
}

function getThisMonthRange(): [string, string] {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];
  return [start, end];
}

function computeStreak(entries: TimeEntryWithDetails[]): number {
  if (!entries || entries.length === 0) return 0;
  const datesWithEntries = new Set(entries.map(e => e.date));
  let streak = 0;
  const today = new Date();
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  while (true) {
    const dow = d.getDay();
    if (dow === 0 || dow === 6) {
      d.setDate(d.getDate() - 1);
      continue;
    }
    const dateStr = d.toISOString().split("T")[0];
    if (datesWithEntries.has(dateStr)) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

export default function TimeTrackingPage() {
  useDocumentTitle("Time Tracking");
  const { user: _user } = useAuth();
  const { toast } = useToast();

  const [view, setView] = useState<"week" | "month" | "day">("week");
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);
  const [selectedMonth, setSelectedMonth] = useState(new Date());

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<TimeEntryWithDetails | null>(null);

  const [newEntryId, _setNewEntryId] = useState<string | null>(null);

  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editStartTime, setEditStartTime] = useState("09:00");
  const [editEndTime, setEditEndTime] = useState("10:00");
  const [editBillable, setEditBillable] = useState(true);
  const [editNotes, setEditNotes] = useState("");
  const [editProjectId, setEditProjectId] = useState("");
  const [editServiceId, setEditServiceId] = useState("");
  const [editSuccess, setEditSuccess] = useState<string | null>(null);
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null);

  const [selectedWeek, setSelectedWeek] = useState(getCurrentWeekStart());
  const [selectedEntries, setSelectedEntries] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  const [timerRunning, setTimerRunning] = useState(false);
  const [timerStart, setTimerStart] = useState<Date | null>(null);
  const [timerProject, setTimerProject] = useState("");
  const [timerElapsed, setTimerElapsed] = useState(0);
  const [timerActualStart, setTimerActualStart] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogDefaultDate, setDialogDefaultDate] = useState<string | undefined>();
  const [dialogDefaultProjectId, setDialogDefaultProjectId] = useState<string | undefined>();
  const [dialogDefaultStartTime, setDialogDefaultStartTime] = useState<string | undefined>();
  const [dialogDefaultEndTime, setDialogDefaultEndTime] = useState<string | undefined>();
  const [dialogEditEntry, setDialogEditEntry] = useState<TimeEntryWithDetails | null>(null);

  const [genInvoiceOpen, setGenInvoiceOpen] = useState(false);
  const [ttFilters, setTtFilter] = useUrlFilterState({
    member: "all",
    project: "all",
    range: "this-week",
    from: "",
    to: "",
    billable: "all",
  });
  const teamMemberFilter = ttFilters.member;
  const projectFilter = ttFilters.project;
  const dateRangeFilter = ttFilters.range;
  const customDateStart = ttFilters.from;
  const customDateEnd = ttFilters.to;
  const billableFilter = ttFilters.billable;
  const setTeamMemberFilter = (v: string) => setTtFilter("member", v);
  const setProjectFilter = (v: string) => setTtFilter("project", v);
  const setDateRangeFilter = (v: string) => setTtFilter("range", v);
  const setCustomDateStart = (v: string) => setTtFilter("from", v);
  const setCustomDateEnd = (v: string) => setTtFilter("to", v);
  const setBillableFilter = (v: string) => setTtFilter("billable", v);
  const [legendFilter, setLegendFilter] = useState<string | null>(null);

  useEffect(() => {
    if (timerRunning && timerStart) {
      timerRef.current = setInterval(() => {
        setTimerElapsed(Math.floor((Date.now() - timerStart.getTime()) / 1000));
      }, 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [timerRunning, timerStart]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.altKey && e.key === 't') {
        e.preventDefault();
        if (timerRunning) stopTimer();
        else startTimer();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  const roundDown5 = (h: number, m: number): string => {
    const rm = Math.floor(m / 5) * 5;
    return `${String(h).padStart(2, "0")}:${String(rm).padStart(2, "0")}`;
  };
  const roundUp5 = (h: number, m: number): string => {
    const rm = Math.ceil(m / 5) * 5;
    if (rm >= 60) return `${String((h + 1) % 24).padStart(2, "0")}:00`;
    return `${String(h).padStart(2, "0")}:${String(rm).padStart(2, "0")}`;
  };

  const startTimer = useCallback(() => {
    if (!timerProject) { toast({ title: "Select a project first", variant: "destructive" }); return; }
    setTimerStart(new Date());
    setTimerActualStart(new Date());
    setTimerElapsed(0);
    setTimerRunning(true);
  }, [timerProject, toast]);

  const stopTimer = useCallback(() => {
    setTimerRunning(false);
    if (timerRef.current) clearInterval(timerRef.current);
    const now = new Date();
    const startDate = timerActualStart || timerStart || now;
    const roundedStart = roundDown5(startDate.getHours(), startDate.getMinutes());
    const roundedEnd = roundUp5(now.getHours(), now.getMinutes());
    setDialogDefaultProjectId(timerProject);
    setDialogDefaultDate(now.toISOString().split("T")[0]);
    setDialogDefaultStartTime(roundedStart);
    setDialogDefaultEndTime(roundedEnd);
    setDialogEditEntry(null);
    setDialogOpen(true);
  }, [timerActualStart, timerStart, timerProject]);

  const { data: entries, isLoading, isError: entriesError, error: entriesQueryError, refetch: refetchEntries } = useQuery<TimeEntryWithDetails[]>({
    queryKey: ["/api/time-entries"],
  });

  const { data: myProjects } = useQuery<ProjectOption[]>({
    queryKey: ["/api/time-entries/my-projects"],
  });

  const { data: services } = useQuery<ServiceOption[]>({
    queryKey: ["/api/services"],
  });

  const [selectedProjectForServices, setSelectedProjectForServices] = useState<string | null>(null);
  const { data: projectSpecificServices } = useQuery<any[]>({
    queryKey: ["/api/projects", selectedProjectForServices, "available-services"],
    queryFn: () => selectedProjectForServices
      ? fetch(`/api/projects/${selectedProjectForServices}/available-services`, { credentials: "include" }).then(r => r.json())
      : Promise.resolve([]),
    enabled: !!selectedProjectForServices,
  });

  const { data: weekData } = useQuery<WeekData>({
    queryKey: ["/api/timesheets/my-week", selectedWeek],
    queryFn: () =>
      fetch(`/api/timesheets/my-week?weekStartDate=${selectedWeek}`, { credentials: "include" }).then((r) => r.json()),
  });

  const uniqueTeamMembers = useMemo(() => {
    if (!entries) return [];
    const map = new Map<string, string>();
    entries.forEach((e) => map.set(e.userId, e.userName));
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [entries]);

  const uniqueProjects = useMemo(() => {
    if (!entries) return [];
    const map = new Map<string, string>();
    entries.forEach((e) => map.set(e.projectId, e.projectName));
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [entries]);

  const filteredEntries = useMemo(() => {
    if (!entries) return [];
    let result = entries;
    if (teamMemberFilter !== "all") result = result.filter((e) => e.userId === teamMemberFilter);
    if (projectFilter !== "all") result = result.filter((e) => e.projectId === projectFilter);
    if (legendFilter) result = result.filter((e) => e.projectId === legendFilter);
    if (billableFilter === "billable") result = result.filter((e) => e.billable);
    else if (billableFilter === "non-billable") result = result.filter((e) => !e.billable);

    let dateStart: string | null = null;
    let dateEnd: string | null = null;
    if (dateRangeFilter === "this-week") [dateStart, dateEnd] = getThisWeekRange();
    else if (dateRangeFilter === "last-week") [dateStart, dateEnd] = getLastWeekRange();
    else if (dateRangeFilter === "this-month") [dateStart, dateEnd] = getThisMonthRange();
    else if (dateRangeFilter === "custom" && customDateStart && customDateEnd) { dateStart = customDateStart; dateEnd = customDateEnd; }
    if (dateStart && dateEnd) result = result.filter((e) => e.date >= dateStart! && e.date <= dateEnd!);
    return result;
  }, [entries, teamMemberFilter, projectFilter, legendFilter, billableFilter, dateRangeFilter, customDateStart, customDateEnd]);

  const isAdmin = _user?.role === "ADMIN";
  const canManage = _user?.role === "ADMIN" || _user?.role === "MANAGER";

  const selectableEntries = useMemo(() => filteredEntries.filter((e) => !e.invoiced), [filteredEntries]);

  const toggleEntrySelection = (id: string) => {
    setSelectedEntries((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedEntries.size === selectableEntries.length) setSelectedEntries(new Set());
    else setSelectedEntries(new Set(selectableEntries.map((e) => e.id)));
  };

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] });
    queryClient.invalidateQueries({ queryKey: ["/api/timesheets/my-week", selectedWeek] });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
  };

  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);

  const submitMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/timesheets/submit", {
        weekStartDate: selectedWeek,
        confirmEmpty: (weekData?.entries.length || 0) === 0,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/my-week", selectedWeek] });
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/my-recent"] });
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/all"] });
      setSubmitConfirmOpen(false);
      toast({ title: "Timesheet submitted for approval" });
    },
    onError: (err: Error) => {
      setSubmitConfirmOpen(false);
      toast({ title: "Could not submit", description: err.message, variant: "destructive" });
    },
  });

  const attemptSubmitWeek = useCallback(() => {
    // Don't act on stale/loading week data — the button should re-arm once
    // weekData hydrates (avoids a spurious "submit empty?" prompt for a week
    // that actually has entries the client just hasn't fetched yet).
    if (!weekData) return;
    if (weekData.entries.length === 0) {
      setSubmitConfirmOpen(true);
      return;
    }
    submitMutation.mutate();
  }, [weekData, submitMutation]);

  const recallWeekMutation = useMutation({
    mutationFn: async () => {
      const tsId = weekData?.timesheet?.id;
      if (!tsId) throw new Error("No submitted timesheet to recall");
      await apiRequest("POST", `/api/timesheets/${tsId}/recall`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/my-week", selectedWeek] });
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/my-recent"] });
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/all"] });
      toast({ title: "Timesheet recalled", description: "Back to draft. Make changes and resubmit when ready." });
    },
    onError: (err: Error) => {
      toast({ title: "Could not recall", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { id: string; date: string; minutes: number; billable: boolean; notes: string; startTime?: string; endTime?: string }) => {
      await apiRequest("PATCH", `/api/time-entries/${data.id}`, {
        date: data.date,
        minutes: data.minutes,
        billable: data.billable,
        notes: data.notes || null,
        startTime: data.startTime || null,
        endTime: data.endTime || null,
      });
    },
    onSuccess: () => {
      invalidateAll();
      setEditSuccess(editingEntryId);
      setEditingEntryId(null);
      setTimeout(() => setEditSuccess(null), 600);
      toast({ title: "Time entry updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!selectedEntry?.id) return;
      setDeletingEntryId(selectedEntry.id);
      await apiRequest("DELETE", `/api/time-entries/${selectedEntry.id}`);
    },
    onSuccess: () => {
      setTimeout(() => {
        invalidateAll();
        setDeletingEntryId(null);
        setDeleteOpen(false);
        toast({ title: "Time entry deleted" });
      }, 200);
    },
    onError: (err: Error) => {
      setDeletingEntryId(null);
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async () => {
      const ids = Array.from(selectedEntries);
      for (const id of ids) await apiRequest("DELETE", `/api/time-entries/${id}`);
    },
    onSuccess: () => {
      invalidateAll();
      setSelectedEntries(new Set());
      setBulkDeleteOpen(false);
      toast({ title: "Selected entries deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: async (entry: TimeEntryWithDetails) => {
      const todayStr = new Date().toISOString().split("T")[0];
      await apiRequest("POST", "/api/time-entries/duplicate", {
        sourceEntryId: entry.id,
        targetDate: todayStr,
      });
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Duplicated to today" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  function startInlineEdit(entry: TimeEntryWithDetails) {
    setEditingEntryId(entry.id);
    setEditDate(entry.date);
    if (entry.startTime && entry.endTime) {
      setEditStartTime(entry.startTime);
      setEditEndTime(entry.endTime);
    } else {
      setEditStartTime("09:00");
      const endMins = 9 * 60 + entry.minutes;
      const eh = Math.floor(endMins / 60);
      const em = endMins % 60;
      setEditEndTime(`${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`);
    }
    setEditBillable(entry.billable);
    setEditNotes(entry.notes || "");
    setEditProjectId(entry.projectId);
    setEditServiceId((entry as any).serviceId || "");
  }

  function saveInlineEdit() {
    if (!editingEntryId) return;
    if (!editStartTime || !editEndTime) { toast({ title: "Start and end times required", variant: "destructive" }); return; }
    const [sh, sm] = editStartTime.split(":").map(Number);
    const [eh, em] = editEndTime.split(":").map(Number);
    const mins = (eh * 60 + em) - (sh * 60 + sm);
    if (mins <= 0) { toast({ title: "End time must be after start time", variant: "destructive" }); return; }
    updateMutation.mutate({ id: editingEntryId, date: editDate, minutes: mins, billable: editBillable, notes: editNotes, startTime: editStartTime, endTime: editEndTime });
  }

  function openNewEntryDialog(opts?: { date?: string; projectId?: string }) {
    setDialogEditEntry(null);
    setDialogDefaultDate(opts?.date || selectedDate || new Date().toISOString().split("T")[0]);
    setDialogDefaultProjectId(opts?.projectId || undefined);
    setDialogDefaultStartTime(undefined);
    setDialogDefaultEndTime(undefined);
    setDialogOpen(true);
  }

  function openDeleteEntry(entry: TimeEntryWithDetails) {
    setSelectedEntry(entry);
    setDeleteOpen(true);
  }

  const navigateWeek = (direction: number) => {
    const d = new Date(selectedWeek + "T12:00:00");
    d.setUTCDate(d.getUTCDate() + direction * 7);
    setSelectedWeek(d.toISOString().split("T")[0]);
  };

  const weekEntries = weekData?.entries || [];
  const weekTotal = weekEntries.reduce((s, e) => s + e.minutes, 0);
  const weekBillable = weekEntries.filter(e => e.billable).reduce((s, e) => s + e.minutes, 0);
  const weekNonBillable = weekTotal - weekBillable;
  const weekUtilization = weekTotal > 0 ? Math.round((weekBillable / weekTotal) * 100) : 0;

  const todayStr = new Date().toISOString().split("T")[0];
  const todayMinutes = useMemo(() => {
    if (!entries) return 0;
    return entries.filter(e => e.date === todayStr).reduce((s, e) => s + e.minutes, 0);
  }, [entries, todayStr]);

  const thisMonthMinutes = useMemo(() => {
    if (!entries) return 0;
    const [start, end] = getThisMonthRange();
    return entries.filter(e => e.date >= start && e.date <= end).reduce((s, e) => s + e.minutes, 0);
  }, [entries]);

  const streak = useMemo(() => computeStreak(entries || []), [entries]);

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-16 rounded-xl" />
        ))}
      </div>
    );
  }

  if (entriesError) {
    return (
      <div className="px-6 lg:px-8 xl:px-10 py-6">
        <ErrorState title="Failed to load time entries" description="We couldn't load time entry data. Please try again." onRetry={refetchEntries} error={entriesQueryError as Error} showDashboardLink />
      </div>
    );
  }

  return (
    <div className="px-6 lg:px-8 xl:px-10 py-6 space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--lux-text)" }} data-testid="text-time-title">
              Time Tracking
            </h1>
            <PageHelpLink />
          </div>
          <p className="text-sm mt-1" style={{ color: "var(--lux-text-muted)" }}>
            Log and review billable hours
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canManage && (
            <Button
              size="sm"
              className="text-white"
              style={{ background: "var(--gradient-brand)" }}
              onClick={() => setGenInvoiceOpen(true)}
              data-testid="button-generate-invoice"
            >
              <FileText className="w-3.5 h-3.5 mr-1" />
              Generate Invoice
            </Button>
          )}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="button-keyboard-shortcuts" aria-label="Keyboard shortcuts">
                  <Keyboard className="w-4 h-4" style={{ color: "var(--lux-text-muted)" }} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">Alt+T to start/stop timer, Enter to submit</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      <FloatingTimer
        timerRunning={timerRunning}
        timerElapsed={timerElapsed}
        timerProject={timerProject}
        myProjects={myProjects}
        onStop={stopTimer}
        onDiscard={() => { setTimerRunning(false); if (timerRef.current) clearInterval(timerRef.current); }}
      />

      <div className="flex items-center gap-2 flex-wrap" data-testid="view-switcher">
        <div className="flex items-center gap-1 p-1 rounded-lg" style={{ background: "var(--lux-surface-alt)" }}>
          {(["day", "week", "month"] as const).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${view === v ? "shadow-sm" : ""}`}
              style={{
                background: view === v ? "var(--lux-surface)" : "transparent",
                color: view === v ? "var(--lux-text)" : "var(--lux-text-muted)",
              }}
              data-testid={`button-view-${v}`}
            >
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <div
          className="flex items-center gap-3 text-xs tabular-nums flex-wrap"
          style={{ color: "var(--lux-text-muted)" }}
          data-testid="time-quick-stats"
        >
          <span>Today: <strong style={{ color: "var(--lux-text)" }}>{formatHoursMinutes(todayMinutes)}</strong></span>
          <span className="hidden sm:inline">|</span>
          <span className="hidden sm:inline">This Week: <strong style={{ color: "var(--lux-text)" }}>{formatHoursMinutes(weekTotal)}</strong> / 40h</span>
          <span className="hidden sm:inline">|</span>
          <span className="hidden sm:inline">This Month: <strong style={{ color: "var(--lux-text)" }}>{formatHoursMinutes(thisMonthMinutes)}</strong></span>
          {streak > 0 && (
            <>
              <span className="hidden sm:inline">|</span>
              <span className="hidden sm:inline" data-testid="text-streak">Streak: <strong style={{ color: "var(--lux-text)" }}>{streak} days</strong>{streak > 5 ? " 🔥" : ""}</span>
            </>
          )}
        </div>
      </div>

      {view === "week" && (
        <>
          <WeekView
            selectedWeek={selectedWeek}
            navigateWeek={navigateWeek}
            weekData={weekData}
            setSelectedDate={setSelectedDate}
            onCellClick={(dateStr) => {
              openNewEntryDialog({ date: dateStr });
            }}
            legendFilter={legendFilter}
            setLegendFilter={setLegendFilter}
            submitMutation={submitMutation}
            onSubmit={attemptSubmitWeek}
            recallMutation={
              weekData?.timesheet?.id && weekData.timesheet.status === "SUBMITTED"
                ? { mutate: () => recallWeekMutation.mutate(), isPending: recallWeekMutation.isPending }
                : undefined
            }
          />
          {!canManage && (
            <MySubmissions
              onJumpToWeek={(weekStartDate) => {
                setSelectedWeek(weekStartDate);
              }}
            />
          )}
        </>
      )}

      {view === "month" && (
        <>
          <MonthView
            selectedMonth={selectedMonth}
            setSelectedMonth={setSelectedMonth}
            entries={entries || []}
            setSelectedDate={setSelectedDate}
            selectedDate={selectedDate}
            isAdmin={isAdmin}
            teamMemberFilter={teamMemberFilter}
            setTeamMemberFilter={setTeamMemberFilter}
            uniqueTeamMembers={uniqueTeamMembers}
            onCellClick={(dateStr) => {
              setSelectedDate(dateStr);
              openNewEntryDialog({ date: dateStr });
            }}
          />
          <SelectedDayEntries
            selectedDate={selectedDate}
            entries={entries || []}
            isAdmin={isAdmin}
            teamMemberFilter={teamMemberFilter}
            onStartTimer={startTimer}
            timerRunning={timerRunning}
            onStartInlineEdit={startInlineEdit}
            editingEntryId={editingEntryId}
            setEditingEntryId={setEditingEntryId}
            editDate={editDate}
            setEditDate={setEditDate}
            editStartTime={editStartTime}
            setEditStartTime={setEditStartTime}
            editEndTime={editEndTime}
            setEditEndTime={setEditEndTime}
            editBillable={editBillable}
            setEditBillable={setEditBillable}
            editNotes={editNotes}
            setEditNotes={setEditNotes}
            editProjectId={editProjectId}
            setEditProjectId={setEditProjectId}
            editServiceId={editServiceId}
            setEditServiceId={setEditServiceId}
            onSaveInlineEdit={saveInlineEdit}
            updateMutationPending={updateMutation.isPending}
            editSuccess={editSuccess}
            onOpenDeleteEntry={openDeleteEntry}
            onDuplicateEntry={(entry) => duplicateMutation.mutate(entry)}
            myProjects={myProjects}
            services={services}
            onOpenDialog={() => openNewEntryDialog({ date: selectedDate })}
          />
        </>
      )}

      {view === "day" && (
        <DayView
          selectedDate={selectedDate}
          setSelectedDate={setSelectedDate}
          entries={entries || []}
          onDuplicateEntry={(entry) => duplicateMutation.mutate(entry)}
          duplicatePending={duplicateMutation.isPending}
          onOpenDialog={() => openNewEntryDialog({ date: selectedDate })}
        />
      )}

      <div className="flex items-center justify-between gap-3 py-3 px-1" data-testid="bar-action-row">
        <div className="flex items-center gap-2">
          {!timerRunning && (
            <Select value={timerProject} onValueChange={setTimerProject}>
              <SelectTrigger className="w-[180px] h-9 text-sm" data-testid="select-timer-project">
                <div className="flex items-center gap-2">
                  {timerProject && <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: getProjectColor(timerProject) }} />}
                  <SelectValue placeholder="Timer project" />
                </div>
              </SelectTrigger>
              <SelectContent>
                {myProjects?.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <div className="flex items-center gap-2">
                      <span className="inline-block w-2 h-2 rounded-full" style={{ background: getProjectColor(p.id) }} />
                      {p.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            variant="outline"
            onClick={startTimer}
            disabled={timerRunning || !timerProject}
            className="gap-2"
            data-testid="button-start-timer"
          >
            <Play className="w-4 h-4" />
            {timerRunning ? "Timer Running..." : "Start Timer"}
          </Button>
        </div>

        <Button
          className="gap-2 text-white"
          style={{ background: "var(--gradient-brand)" }}
          onClick={() => openNewEntryDialog()}
          data-testid="button-add-time"
        >
          <Plus className="w-4 h-4" />
          New Entry
        </Button>
      </div>

      {(() => {
        const chips: FilterChipDescriptor[] = [];
        if (teamMemberFilter !== "all") {
          const member = uniqueTeamMembers.find((m) => m.id === teamMemberFilter);
          chips.push({
            id: "member",
            label: `Member: ${member?.name || "Selected"}`,
            onClear: () => setTeamMemberFilter("all"),
          });
        }
        if (projectFilter !== "all") {
          const project = uniqueProjects.find((p) => p.id === projectFilter);
          chips.push({
            id: "project",
            label: `Project: ${project?.name || "Selected"}`,
            onClear: () => setProjectFilter("all"),
          });
        }
        if (dateRangeFilter !== "this-week") {
          const rangeLabels: Record<string, string> = {
            "last-week": "Last Week",
            "this-month": "This Month",
            custom: customDateStart && customDateEnd ? `${customDateStart} → ${customDateEnd}` : "Custom",
          };
          chips.push({
            id: "range",
            label: `Range: ${rangeLabels[dateRangeFilter] || dateRangeFilter}`,
            onClear: () => {
              setDateRangeFilter("this-week");
              setCustomDateStart("");
              setCustomDateEnd("");
            },
          });
        }
        if (billableFilter !== "all") {
          chips.push({
            id: "billable",
            label: billableFilter === "billable" ? "Billable only" : "Non-billable only",
            onClear: () => setBillableFilter("all"),
          });
        }
        return <ActiveFilterBar chips={chips} />;
      })()}

      <TimeFilters
        isAdmin={isAdmin}
        teamMemberFilter={teamMemberFilter} setTeamMemberFilter={setTeamMemberFilter}
        projectFilter={projectFilter} setProjectFilter={setProjectFilter}
        dateRangeFilter={dateRangeFilter} setDateRangeFilter={setDateRangeFilter}
        billableFilter={billableFilter} setBillableFilter={setBillableFilter}
        customDateStart={customDateStart} setCustomDateStart={setCustomDateStart}
        customDateEnd={customDateEnd} setCustomDateEnd={setCustomDateEnd}
        uniqueTeamMembers={uniqueTeamMembers}
        uniqueProjects={uniqueProjects}
      />

      {selectedEntries.size > 0 && (
        <div
          className="sticky bottom-4 z-50 flex items-center justify-between gap-4 p-3 rounded-md"
          style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow-hover)", border: "1px solid var(--lux-border-strong)" }}
          data-testid="bar-bulk-actions"
        >
          <span className="text-sm font-semibold" style={{ color: "var(--lux-text)" }} data-testid="text-selected-count">
            {selectedEntries.size} selected
          </span>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setBulkDeleteOpen(true)}
            data-testid="button-bulk-delete"
          >
            <Trash2 className="w-3.5 h-3.5 mr-1" />
            Delete Selected ({selectedEntries.size})
          </Button>
        </div>
      )}

      <EntryList
        filteredEntries={filteredEntries}
        selectedEntries={selectedEntries}
        toggleEntrySelection={toggleEntrySelection}
        toggleSelectAll={toggleSelectAll}
        selectableEntries={selectableEntries}
        editingEntryId={editingEntryId} setEditingEntryId={setEditingEntryId}
        editDate={editDate} setEditDate={setEditDate}
        editStartTime={editStartTime} setEditStartTime={setEditStartTime}
        editEndTime={editEndTime} setEditEndTime={setEditEndTime}
        editBillable={editBillable} setEditBillable={setEditBillable}
        editNotes={editNotes} setEditNotes={setEditNotes}
        editProjectId={editProjectId} setEditProjectId={setEditProjectId}
        editServiceId={editServiceId} setEditServiceId={setEditServiceId}
        editSuccess={editSuccess}
        newEntryId={newEntryId}
        deletingEntryId={deletingEntryId}
        onStartInlineEdit={startInlineEdit}
        onSaveInlineEdit={saveInlineEdit}
        onOpenDeleteEntry={openDeleteEntry}
        onDuplicateEntry={(entry) => duplicateMutation.mutate(entry)}
        updateMutationPending={updateMutation.isPending}
        myProjects={myProjects}
        services={services}
        isAdmin={isAdmin}
        onAddEntry={() => openNewEntryDialog()}
      />

      <WeekSummary
        weekBillable={weekBillable}
        weekNonBillable={weekNonBillable}
        weekTotal={weekTotal}
        weekUtilization={weekUtilization}
      />

      <TimeEntryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        myProjects={myProjects}
        services={services}
        projectServices={projectSpecificServices}
        defaultDate={dialogDefaultDate}
        defaultProjectId={dialogDefaultProjectId}
        defaultStartTime={dialogDefaultStartTime}
        defaultEndTime={dialogDefaultEndTime}
        existingEntries={entries?.filter(e => e.date === (dialogDefaultDate || selectedDate))}
        editEntry={dialogEditEntry}
      />

      <AlertDialog open={submitConfirmOpen} onOpenChange={setSubmitConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Submit empty week?</AlertDialogTitle>
            <AlertDialogDescription>
              You haven't logged any time for this week. Submitting an empty week tells your manager you intentionally had no billable activity.
              You can still recall it before it's approved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-submit-empty">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => submitMutation.mutate()}
              data-testid="button-confirm-submit-empty"
            >
              {submitMutation.isPending ? "Submitting..." : "Submit empty week"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Time Entry</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this time entry? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-time">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteMutation.mutate()} className="bg-red-600 hover:bg-red-700" data-testid="button-confirm-delete-time">
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Selected Entries</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {selectedEntries.size} selected time {selectedEntries.size === 1 ? "entry" : "entries"}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-bulk-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => bulkDeleteMutation.mutate()} className="bg-red-600 hover:bg-red-700" data-testid="button-confirm-bulk-delete">
              {bulkDeleteMutation.isPending ? "Deleting..." : `Delete ${selectedEntries.size}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {canManage && (
        <GenerateInvoiceDialog
          open={genInvoiceOpen}
          onOpenChange={setGenInvoiceOpen}
        />
      )}
    </div>
  );
}

interface SelectedDayEntriesProps {
  selectedDate: string;
  entries: TimeEntryWithDetails[];
  isAdmin: boolean;
  teamMemberFilter: string;
  onStartTimer: () => void;
  timerRunning: boolean;
  onStartInlineEdit: (entry: TimeEntryWithDetails) => void;
  editingEntryId: string | null;
  setEditingEntryId: (v: string | null) => void;
  editDate: string;
  setEditDate: (v: string) => void;
  editStartTime: string;
  setEditStartTime: (v: string) => void;
  editEndTime: string;
  setEditEndTime: (v: string) => void;
  editBillable: boolean;
  setEditBillable: (v: boolean) => void;
  editNotes: string;
  setEditNotes: (v: string) => void;
  editProjectId: string;
  setEditProjectId: (v: string) => void;
  editServiceId: string;
  setEditServiceId: (v: string) => void;
  onSaveInlineEdit: () => void;
  updateMutationPending: boolean;
  editSuccess: string | null;
  onOpenDeleteEntry: (entry: TimeEntryWithDetails) => void;
  onDuplicateEntry: (entry: TimeEntryWithDetails) => void;
  myProjects: ProjectOption[] | undefined;
  services: ServiceOption[] | undefined;
  onOpenDialog: () => void;
}

function SelectedDayEntries(props: SelectedDayEntriesProps) {
  const {
    selectedDate, entries, isAdmin, teamMemberFilter,
    onStartTimer, timerRunning,
    onStartInlineEdit, editingEntryId, setEditingEntryId,
    editDate, setEditDate, editStartTime, setEditStartTime, editEndTime, setEditEndTime,
    editBillable: _editBillable, setEditBillable: _setEditBillable, editNotes, setEditNotes,
    editProjectId, setEditProjectId, editServiceId: _editServiceId, setEditServiceId: _setEditServiceId,
    onSaveInlineEdit, updateMutationPending, editSuccess,
    onOpenDeleteEntry, onDuplicateEntry, myProjects, services: _services, onOpenDialog,
  } = props;

  const dayEntries = useMemo(() => {
    let result = entries.filter(e => e.date === selectedDate);
    if (teamMemberFilter !== "all") result = result.filter(e => e.userId === teamMemberFilter);
    return result;
  }, [entries, selectedDate, teamMemberFilter]);

  const totalMinutes = dayEntries.reduce((s, e) => s + e.minutes, 0);
  const d = new Date(selectedDate + "T12:00:00");
  const dateLabel = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  return (
    <div className="space-y-3 view-enter" data-testid="selected-day-entries">
      <div className="flex items-center gap-3 px-1">
        <div className="flex-1 flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-secondary)" }}>
            {dateLabel}
          </span>
          <div className="flex-1 h-px" style={{ background: "var(--lux-border)" }} />
        </div>
        <span className="text-xs font-bold tabular-nums" style={{ color: "var(--lux-text-secondary)" }}>
          {formatHoursMinutes(totalMinutes)}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="text-xs"
          onClick={onOpenDialog}
          data-testid="button-new-entry-day"
        >
          <Plus className="w-3.5 h-3.5 mr-1" />
          New Entry
        </Button>
        {!timerRunning && (
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={onStartTimer}
            data-testid="button-start-timer-day"
          >
            <Play className="w-3.5 h-3.5 mr-1" />
            Start Timer
          </Button>
        )}
      </div>

      {dayEntries.length === 0 ? (
        <div className="rounded-lg px-4 py-8 text-center" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
          <p className="text-sm" style={{ color: "var(--lux-text-muted)" }}>No entries for this day</p>
        </div>
      ) : (
        <div className="space-y-1 max-h-[400px] overflow-y-auto">
          {dayEntries.map(entry => {
            const color = getProjectColor(entry.projectId);
            const isEditing = editingEntryId === entry.id;
            const isFlashing = editSuccess === entry.id;

            if (isEditing) {
              return (
                <div
                  key={entry.id}
                  className="rounded-lg p-3 space-y-2"
                  style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)", border: "1px solid var(--lux-border-strong)" }}
                  data-testid={`month-day-entry-${entry.id}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={editProjectId}
                      onChange={e => setEditProjectId(e.target.value)}
                      className="h-9 text-sm rounded-md border px-2"
                      style={{ background: "var(--lux-surface)", color: "var(--lux-text)", borderColor: "var(--lux-border)" }}
                    >
                      {myProjects?.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    <input type="date" className="h-9 text-sm rounded-md border px-2" style={{ background: "var(--lux-surface)", color: "var(--lux-text)", borderColor: "var(--lux-border)" }} value={editDate} onChange={e => setEditDate(e.target.value)} />
                    <div className="flex items-center gap-1">
                      <input type="time" className="h-9 text-sm rounded-md border px-2 tabular-nums" style={{ background: "var(--lux-surface)", color: "var(--lux-text)", borderColor: "var(--lux-border)" }} value={editStartTime} onChange={e => setEditStartTime(e.target.value)} data-testid="input-month-edit-start" />
                      <span className="text-xs" style={{ color: "var(--lux-text-muted)" }}>{"\u2192"}</span>
                      <input type="time" className="h-9 text-sm rounded-md border px-2 tabular-nums" style={{ background: "var(--lux-surface)", color: "var(--lux-text)", borderColor: "var(--lux-border)" }} value={editEndTime} onChange={e => setEditEndTime(e.target.value)} data-testid="input-month-edit-end" />
                      <span className="text-sm font-bold tabular-nums ml-1" style={{ color: (() => { const [sh,sm] = editStartTime.split(":").map(Number); const [eh,em] = editEndTime.split(":").map(Number); return (eh*60+em)-(sh*60+sm) > 0 ? "var(--color-accent)" : "var(--lux-text-muted)"; })() }} data-testid="text-month-edit-duration">{(() => { const [sh,sm] = editStartTime.split(":").map(Number); const [eh,em] = editEndTime.split(":").map(Number); const d = (eh*60+em)-(sh*60+sm); return d > 0 ? formatHoursMinutes(d) : "0:00"; })()}</span>
                    </div>
                  </div>
                  <input className="w-full h-9 text-sm rounded-md border px-2" style={{ background: "var(--lux-surface)", color: "var(--lux-text)", borderColor: "var(--lux-border)" }} placeholder="Notes" value={editNotes} onChange={e => setEditNotes(e.target.value)} />
                  <div className="flex items-center justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setEditingEntryId(null)}>Cancel</Button>
                    <Button size="sm" className="text-white" style={{ background: "var(--gradient-brand)" }} onClick={onSaveInlineEdit} disabled={updateMutationPending}>
                      {updateMutationPending ? "Saving..." : "Save"}
                    </Button>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={entry.id}
                className="rounded-lg px-4 py-3 flex items-center justify-between gap-3 group transition-all duration-200"
                style={{
                  background: isFlashing ? "rgba(34, 197, 94, 0.08)" : "var(--lux-surface)",
                  boxShadow: "var(--lux-card-shadow)",
                  borderLeft: `3px solid ${entry.billable ? color : "var(--lux-border)"}`,
                }}
                data-testid={`month-day-entry-${entry.id}`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {isAdmin && (
                        <span className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>{entry.userName}</span>
                      )}
                      <span className="text-sm font-semibold" style={{ color: "var(--lux-text)" }}>
                        {entry.projectName}
                        {entry.clientName && <span className="font-normal text-xs ml-1" style={{ color: "var(--lux-text-muted)" }}>({entry.clientName})</span>}
                      </span>
                      {entry.serviceName && (
                        <span className="text-xs" style={{ color: "var(--lux-text-muted)" }}>{entry.serviceName}</span>
                      )}
                    </div>
                    {entry.notes && (
                      <p className="text-xs mt-0.5 truncate max-w-[400px]" style={{ color: "var(--lux-text-muted)" }}>{entry.notes}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {entry.invoiced ? (
                    <>
                      <Lock className="w-3 h-3" style={{ color: "var(--lux-text-muted)" }} />
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e" }}>Billed</span>
                    </>
                  ) : (
                    <span className="text-[10px] px-2 py-0.5" style={{ color: "var(--lux-text-muted)" }}>Unbilled</span>
                  )}
                  <span className="text-sm font-bold tabular-nums min-w-[3rem] text-right" style={{ color: "var(--lux-text)" }}>
                    {formatHoursMinutes(entry.minutes)}
                  </span>
                  {!entry.invoiced && (
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity sm:opacity-100">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onDuplicateEntry(entry)} title="Duplicate" aria-label="Duplicate entry" data-testid={`button-dup-day-${entry.id}`}>
                        <Copy className="w-3 h-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onStartInlineEdit(entry)} data-testid={`button-edit-day-${entry.id}`} aria-label="Edit entry">
                        <Pencil className="w-3 h-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => onOpenDeleteEntry(entry)} data-testid={`button-del-day-${entry.id}`} aria-label="Delete entry">
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface GenerateInvoiceDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

function GenerateInvoiceDialog({ open, onOpenChange }: GenerateInvoiceDialogProps) {
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [clientId, setClientId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedTeamMembers, setSelectedTeamMembers] = useState<string[]>([]);
  const [grouping, setGrouping] = useState<"combined" | "per-team-member">("combined");
  const [lineGroupBy, setLineGroupBy] = useState<"team-member" | "project" | "service" | "none">("team-member");
  const [includeUnapproved, setIncludeUnapproved] = useState(true);

  const { data: clients } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/clients"],
  });

  const { data: preview, isLoading: previewLoading } = useQuery<{
    entries: Array<{ id: string; project: string; teamMember: string; teamMemberId: string; date: string; hours: number; rate: number; amount: number; service: string | null }>;
    totalHours: number;
    totalAmount: number;
    byProject: Array<{ project: string; hours: number; amount: number }>;
    byTeamMember: Array<{ teamMemberId: string; name: string; hours: number; amount: number }>;
  }>({
    queryKey: ["/api/time-entries/unbilled-preview", clientId, includeUnapproved],
    queryFn: () => fetch(`/api/time-entries/unbilled-preview?clientId=${clientId}&includeUnapproved=${includeUnapproved}`, { credentials: "include" }).then(r => r.json()),
    enabled: !!clientId,
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { clientId, grouping, lineGroupBy, includeUnapproved };
      if (dateFrom) body.dateFrom = dateFrom;
      if (dateTo) body.dateTo = dateTo;
      if (selectedTeamMembers.length > 0 && preview?.byTeamMember && selectedTeamMembers.length < preview.byTeamMember.length) {
        body.teamMemberIds = selectedTeamMembers;
      }
      const res = await apiRequest("POST", "/api/invoices/generate", body);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries/unbilled-preview", clientId] });
      const isArr = Array.isArray(data);
      const count = isArr ? data.length : 1;
      const numbers = isArr ? data.map((i: any) => i.number).join(", ") : data.number;
      toast({ title: count > 1 ? `${count} invoices created` : `Invoice ${numbers} created` });
      onOpenChange(false);
      resetDialog();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  function resetDialog() {
    setStep(1);
    setClientId("");
    setDateFrom("");
    setDateTo("");
    setSelectedTeamMembers([]);
    setGrouping("combined");
    setLineGroupBy("team-member");
    setIncludeUnapproved(true);
  }

  const filteredPreview = useMemo(() => {
    if (!preview) return null;
    let filtered = preview.entries;
    if (dateFrom) filtered = filtered.filter(e => e.date >= dateFrom);
    if (dateTo) filtered = filtered.filter(e => e.date <= dateTo);
    if (selectedTeamMembers.length > 0 && preview.byTeamMember && selectedTeamMembers.length < preview.byTeamMember.length) {
      filtered = filtered.filter(e => selectedTeamMembers.includes(e.teamMemberId));
    }
    const totalHours = filtered.reduce((s, e) => s + e.hours, 0);
    const totalAmount = filtered.reduce((s, e) => s + e.amount, 0);
    return { entries: filtered, totalHours: Math.round(totalHours * 100) / 100, totalAmount: Math.round(totalAmount * 100) / 100 };
  }, [preview, dateFrom, dateTo, selectedTeamMembers]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetDialog(); onOpenChange(v); }}>
      <DialogContent className="max-w-lg" data-testid="dialog-generate-invoice">
        <DialogHeader>
          <DialogTitle>Generate Invoice from Time</DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>Select Client</label>
              <select
                value={clientId}
                onChange={e => setClientId(e.target.value)}
                className="w-full h-10 rounded-md border px-3 text-sm"
                style={{ background: "var(--lux-surface)", color: "var(--lux-text)", borderColor: "var(--lux-border)" }}
                data-testid="select-gen-client"
              >
                <option value="">Choose a client...</option>
                {clients?.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            {clientId && previewLoading && (
              <p className="text-sm" style={{ color: "var(--lux-text-muted)" }}>Loading unbilled time...</p>
            )}
            {clientId && preview && (
              <div className="rounded-md p-3 text-sm" style={{ background: "var(--lux-surface-alt)", border: "1px solid var(--lux-border)" }}>
                <p style={{ color: "var(--lux-text)" }}>
                  <strong>{preview.entries.length}</strong> unbilled entries
                  &middot; <strong>{formatHours(preview.totalHours)}h</strong>
                  &middot; <strong>{formatMoney(preview.totalAmount)}</strong>
                </p>
              </div>
            )}
            <div className="flex justify-end">
              <Button
                size="sm"
                disabled={!clientId || !preview || preview.entries.length === 0}
                onClick={() => {
                  if (preview?.byTeamMember) {
                    setSelectedTeamMembers(preview.byTeamMember.map(c => c.teamMemberId));
                  }
                  setStep(2);
                }}
                className="text-white"
                style={{ background: "var(--gradient-brand)" }}
              >
                Next
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>From (optional)</label>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-full h-9 rounded-md border px-2 text-sm" style={{ background: "var(--lux-surface)", color: "var(--lux-text)", borderColor: "var(--lux-border)" }} data-testid="input-gen-date-from" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>To (optional)</label>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-full h-9 rounded-md border px-2 text-sm" style={{ background: "var(--lux-surface)", color: "var(--lux-text)", borderColor: "var(--lux-border)" }} data-testid="input-gen-date-to" />
              </div>
            </div>

            {preview?.byTeamMember && preview.byTeamMember.length > 1 && (
              <div className="space-y-2">
                <label className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Team Members</label>
                {preview.byTeamMember.map(c => (
                  <label key={c.teamMemberId} className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "var(--lux-text)" }}>
                    <input
                      type="checkbox"
                      checked={selectedTeamMembers.includes(c.teamMemberId)}
                      onChange={e => {
                        if (e.target.checked) setSelectedTeamMembers(prev => [...prev, c.teamMemberId]);
                        else setSelectedTeamMembers(prev => prev.filter(id => id !== c.teamMemberId));
                      }}
                    />
                    {c.name} ({formatHours(c.hours)}h &middot; {formatMoney(c.amount)})
                  </label>
                ))}
              </div>
            )}

            <div className="space-y-2">
              <label className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Invoice Grouping</label>
              <div className="flex flex-col gap-1">
                <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "var(--lux-text)" }}>
                  <input type="radio" name="grouping" checked={grouping === "combined"} onChange={() => setGrouping("combined")} />
                  One combined invoice
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "var(--lux-text)" }}>
                  <input type="radio" name="grouping" checked={grouping === "per-team-member"} onChange={() => setGrouping("per-team-member")} />
                  Separate invoice per team member
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Group Line Items By</label>
              <select
                value={lineGroupBy}
                onChange={e => setLineGroupBy(e.target.value as any)}
                className="w-full h-9 rounded-md border px-3 text-sm"
                style={{ background: "var(--lux-surface)", color: "var(--lux-text)", borderColor: "var(--lux-border)" }}
                data-testid="select-line-group-by"
              >
                <option value="team-member">Team Member</option>
                <option value="project">Project</option>
                <option value="service">Service</option>
                <option value="none">None (flat list)</option>
              </select>
            </div>

            <div className="flex items-start gap-2 p-3 rounded-md" style={{ background: "var(--lux-surface-alt)", border: "1px solid var(--lux-border)" }}>
              <input
                type="checkbox"
                checked={includeUnapproved}
                onChange={(e) => setIncludeUnapproved(e.target.checked)}
                className="mt-0.5"
                data-testid="checkbox-include-unapproved"
              />
              <div>
                <label className="text-sm font-medium cursor-pointer" style={{ color: "var(--lux-text)" }}>
                  Include unapproved time entries
                </label>
                <p className="text-xs mt-0.5" style={{ color: "var(--lux-text-muted)" }}>
                  When checked, all unbilled time is included regardless of timesheet approval status.
                  Uncheck to include only time from approved timesheets.
                </p>
              </div>
            </div>

            <div className="flex justify-between">
              <Button variant="ghost" size="sm" onClick={() => setStep(1)}>Back</Button>
              <Button size="sm" onClick={() => setStep(3)} className="text-white" style={{ background: "var(--gradient-brand)" }}>Preview</Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="max-h-[300px] overflow-y-auto rounded-md" style={{ border: "1px solid var(--lux-border)" }}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: "var(--lux-surface-alt)" }}>
                    <th className="text-left p-2 text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Project</th>
                    <th className="text-left p-2 text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Team Member</th>
                    <th className="text-right p-2 text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Hours</th>
                    <th className="text-right p-2 text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPreview?.entries.map((e, i) => (
                    <tr key={i} style={{ borderTop: "1px solid var(--lux-border)" }}>
                      <td className="p-2" style={{ color: "var(--lux-text)" }}>{e.project}</td>
                      <td className="p-2" style={{ color: "var(--lux-text-muted)" }}>{e.teamMember}</td>
                      <td className="p-2 text-right tabular-nums" style={{ color: "var(--lux-text)" }}>{formatHours(e.hours)}</td>
                      <td className="p-2 text-right tabular-nums" style={{ color: "var(--lux-text)" }}>{formatMoney(e.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredPreview && (
              <div className="flex justify-between items-center px-2">
                <span className="text-sm font-bold" style={{ color: "var(--lux-text)" }}>
                  Total: {formatHours(filteredPreview.totalHours)}h &middot; {formatMoney(filteredPreview.totalAmount)}
                </span>
                {grouping === "per-team-member" && preview?.byTeamMember && (
                  <span className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
                    Will create {selectedTeamMembers.length} invoice(s)
                  </span>
                )}
              </div>
            )}
            <div className="flex justify-between">
              <Button variant="ghost" size="sm" onClick={() => setStep(2)}>Back</Button>
              <Button
                size="sm"
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending || !filteredPreview || filteredPreview.entries.length === 0}
                className="text-white"
                style={{ background: "var(--gradient-brand)" }}
                data-testid="button-gen-submit"
              >
                {generateMutation.isPending ? "Generating..." : "Generate Invoice(s)"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
