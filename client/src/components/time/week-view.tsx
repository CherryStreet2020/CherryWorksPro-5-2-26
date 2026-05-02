import { useMemo } from "react";
import { formatPercent } from "@/components/shared/format";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Send, Plus, Undo2, CheckCircle2, Clock, AlertCircle } from "lucide-react";
import { getProjectColor, formatMinutesShort, formatHoursMinutes } from "./utils";
import { getWeekEndDate } from "@shared/schema";
import type { TimesheetWeek, TimeEntry } from "@shared/schema";

interface TimeEntryWithDetails extends TimeEntry {
  projectName: string;
  clientName: string;
  userName: string;
  serviceName?: string | null;
}

interface WeekData {
  timesheet: TimesheetWeek | null;
  entries: Array<TimeEntryWithDetails>;
}

interface WeekViewProps {
  selectedWeek: string;
  navigateWeek: (dir: number) => void;
  weekData: WeekData | undefined;
  setSelectedDate: (d: string) => void;
  onCellClick: (dateStr: string) => void;
  legendFilter: string | null;
  setLegendFilter: (v: string | null) => void;
  submitMutation: { mutate: () => void; isPending: boolean };
  onSubmit?: () => void;
  recallMutation?: { mutate: () => void; isPending: boolean };
}

function formatSubmittedAt(d: Date | string | null | undefined): string {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function WeekView({ selectedWeek, navigateWeek, weekData, setSelectedDate, onCellClick, legendFilter, setLegendFilter, submitMutation, onSubmit, recallMutation }: WeekViewProps) {
  const weekEnd = getWeekEndDate(selectedWeek);
  const weekStart = new Date(selectedWeek + "T12:00:00");
  const weekEndDate = new Date(weekEnd + "T12:00:00");
  const weekLabel = `${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${weekEndDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  const canSubmit = weekData?.timesheet?.status !== "SUBMITTED" &&
    weekData?.timesheet?.status !== "APPROVED";

  const weekEntries = weekData?.entries || [];
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayDates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(selectedWeek + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + i);
    dayDates.push(d.toISOString().split("T")[0]);
  }

  const dailyTotals = dayDates.map((dd) =>
    weekEntries.filter((e) => e.date === dd).reduce((s, e) => s + e.minutes, 0),
  );
  const weekTotal = dailyTotals.reduce((s, m) => s + m, 0);
  const todayStr = new Date().toISOString().split("T")[0];
  const maxDayMinutes = Math.max(480, ...dailyTotals);

  const weekProjectBreakdown = useMemo(() => {
    return dayDates.map(dd => {
      const dayEntries = weekEntries.filter(e => e.date === dd);
      const byProject: Record<string, number> = {};
      dayEntries.forEach(e => {
        byProject[e.projectId] = (byProject[e.projectId] || 0) + e.minutes;
      });
      return Object.entries(byProject)
        .map(([pid, mins]) => ({ projectId: pid, minutes: mins, projectName: dayEntries.find(e => e.projectId === pid)?.projectName || "" }))
        .sort((a, b) => b.minutes - a.minutes);
    });
  }, [weekEntries, dayDates]);

  const weekProjects = useMemo(() => {
    const map = new Map<string, string>();
    weekEntries.forEach(e => map.set(e.projectId, e.projectName));
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [weekEntries]);

  return (
    <div className="view-enter">
      <Card
        className="border-0 overflow-hidden"
        style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}
      >
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="icon" onClick={() => navigateWeek(-1)} data-testid="button-prev-week" aria-label="Previous week">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <div className="text-center">
              <p className="text-sm font-semibold" style={{ color: "var(--lux-text)" }} data-testid="text-week-label">
                {weekLabel}
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={() => navigateWeek(1)} data-testid="button-next-week" aria-label="Next week">
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>

          {weekData?.timesheet?.status === "SUBMITTED" && (
            <div
              className="flex items-center justify-between gap-3 rounded-md p-3"
              style={{ background: "rgba(37,99,235,0.08)", border: "1px solid rgba(37,99,235,0.25)" }}
              data-testid="banner-submitted"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Clock className="w-4 h-4 shrink-0" style={{ color: "#2563eb" }} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold" style={{ color: "#1e40af" }}>
                    Submitted • Awaiting approval
                  </p>
                  {weekData.timesheet.submittedAt && (
                    <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
                      Sent {formatSubmittedAt(weekData.timesheet.submittedAt)}. Your manager has been notified.
                    </p>
                  )}
                </div>
              </div>
              {recallMutation && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => recallMutation.mutate()}
                  disabled={recallMutation.isPending}
                  data-testid="button-recall-week"
                >
                  <Undo2 className="w-3.5 h-3.5 mr-1" />
                  {recallMutation.isPending ? "Recalling…" : "Recall"}
                </Button>
              )}
            </div>
          )}

          {weekData?.timesheet?.status === "APPROVED" && (
            <div
              className="flex items-center gap-2 rounded-md p-3"
              style={{ background: "rgba(21,128,61,0.08)", border: "1px solid rgba(21,128,61,0.25)" }}
              data-testid="banner-approved"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: "#15803d" }} />
              <div>
                <p className="text-sm font-semibold" style={{ color: "#166534" }}>
                  Approved • Locked
                </p>
                {weekData.timesheet.approvedAt && (
                  <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
                    Approved {formatSubmittedAt(weekData.timesheet.approvedAt)}. Contact an admin if changes are needed.
                  </p>
                )}
              </div>
            </div>
          )}

          {weekData?.timesheet?.status === "REJECTED" && (
            <div
              className="flex items-start gap-2 rounded-md p-3"
              style={{ background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.25)" }}
              data-testid="banner-rejected"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#dc2626" }} />
              <div className="min-w-0">
                <p className="text-sm font-semibold" style={{ color: "#991b1b" }}>
                  Rejected • Needs your attention
                </p>
                {weekData.timesheet.rejectionReason && (
                  <p className="text-xs mt-0.5" style={{ color: "var(--lux-text)" }} data-testid="text-rejection-reason">
                    Reason: {weekData.timesheet.rejectionReason}
                  </p>
                )}
                <p className="text-xs mt-1" style={{ color: "var(--lux-text-muted)" }}>
                  Edit your entries below, then click Submit Week to resubmit.
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-7 gap-2" style={{ minHeight: "120px" }}>
            {dayNames.map((name, i) => {
              const isToday = dayDates[i] === todayStr;
              const totalMins = dailyTotals[i];
              const segments = weekProjectBreakdown[i];
              const dayTooltip = segments.map(s => `${s.projectName}: ${formatMinutesShort(s.minutes)}`).join("\n");

              return (
                <div
                  key={name}
                  className="flex flex-col items-center cursor-pointer group"
                  onClick={() => { setSelectedDate(dayDates[i]); onCellClick(dayDates[i]); }}
                  title={totalMins > 0 ? `${name} ${new Date(dayDates[i] + "T12:00:00").getDate()} \u2014 ${formatMinutesShort(totalMins)}\n${dayTooltip}` : `${name} \u2014 No entries`}
                  data-testid={`day-bar-${i}`}
                >
                  <p className="text-[10px] font-semibold uppercase mb-1" style={{ color: "var(--lux-text-muted)" }}>{name}</p>
                  <p className="text-[10px]" style={{ color: "var(--lux-text-muted)" }}>
                    {new Date(dayDates[i] + "T12:00:00").getDate()}
                  </p>
                  <div
                    className="relative w-full flex-1 mt-1 rounded-t-md overflow-hidden flex flex-col-reverse transition-all"
                    style={{
                      minHeight: "60px",
                      border: isToday ? "1.5px solid var(--color-accent-glow)" : "1px solid var(--lux-border)",
                      borderRadius: "6px",
                      boxShadow: isToday ? "0 0 8px var(--color-accent-glow)" : undefined,
                      background: "var(--lux-surface-alt)",
                    }}
                  >
                    <button
                      className="absolute top-1 right-1 w-6 h-6 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
                      style={{ background: "var(--color-accent)", color: "white" }}
                      onClick={(e) => { e.stopPropagation(); onCellClick(dayDates[i]); }}
                      data-testid={`button-add-entry-day-${i}`}
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                    {segments.map((seg) => (
                      <div
                        key={seg.projectId}
                        style={{
                          height: `${(seg.minutes / maxDayMinutes) * 100}%`,
                          background: getProjectColor(seg.projectId),
                          opacity: 0.85,
                          minHeight: seg.minutes > 0 ? "3px" : "0px",
                        }}
                      />
                    ))}
                  </div>
                  <p
                    className="text-xs font-bold tabular-nums mt-1"
                    style={{ color: totalMins > 0 ? "var(--lux-text)" : "var(--lux-text-muted)" }}
                    data-testid={`text-day-total-${i}`}
                  >
                    {formatHoursMinutes(totalMins)}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="pt-2 border-t space-y-2" style={{ borderColor: "var(--lux-border)" }}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-bold" style={{ color: "var(--lux-text)" }} data-testid="text-week-total">
                Week Total: {formatHoursMinutes(weekTotal)}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs tabular-nums" style={{ color: "var(--lux-text-muted)" }}>
                  {formatPercent((weekTotal / 60 / 40) * 100)} of 40h target
                </span>
              </div>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--lux-surface-alt)" }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(100, (weekTotal / 60 / 40) * 100)}%`,
                  background: "var(--gradient-brand)",
                }}
              />
            </div>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3 flex-wrap">
                {weekProjects.map(p => (
                  <button
                    key={p.id}
                    onClick={() => setLegendFilter(legendFilter === p.id ? null : p.id)}
                    className="flex items-center gap-1.5 text-xs cursor-pointer hover:opacity-80 transition-opacity"
                    style={{
                      color: legendFilter === p.id ? getProjectColor(p.id) : "var(--lux-text-muted)",
                      fontWeight: legendFilter === p.id ? 600 : 400,
                    }}
                    data-testid={`legend-project-${p.id}`}
                  >
                    <span className="inline-block w-2 h-2 rounded-full" style={{ background: getProjectColor(p.id) }} />
                    {p.name}
                  </button>
                ))}
              </div>
              {canSubmit && (
                <Button
                  size="sm"
                  className="text-white"
                  style={{ background: "var(--gradient-brand)" }}
                  onClick={() => (onSubmit ? onSubmit() : submitMutation.mutate())}
                  disabled={submitMutation.isPending}
                  data-testid="button-submit-timesheet"
                >
                  <Send className="w-3.5 h-3.5 mr-1" />
                  {submitMutation.isPending
                    ? "Submitting..."
                    : weekData?.timesheet?.status === "REJECTED"
                      ? "Resubmit Week"
                      : "Submit Week"}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
