import { useMemo } from "react";
import { formatPercent } from "@/components/shared/format";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Clock, Plus } from "lucide-react";
import { getProjectColor, formatHoursMinutes } from "./utils";
import type { TimeEntry } from "@shared/schema";

interface TimeEntryWithDetails extends TimeEntry {
  projectName: string;
  clientName: string;
  userName: string;
  serviceName?: string | null;
}

interface DayViewProps {
  selectedDate: string;
  setSelectedDate: (d: string) => void;
  entries: TimeEntryWithDetails[];
  onDuplicateEntry: (entry: TimeEntryWithDetails) => void;
  duplicatePending: boolean;
  onOpenDialog: () => void;
}

export default function DayView({ selectedDate, setSelectedDate, entries, onDuplicateEntry, duplicatePending, onOpenDialog }: DayViewProps) {
  const d = new Date(selectedDate + "T12:00:00");
  const todayStr = new Date().toISOString().split("T")[0];
  const isToday = selectedDate === todayStr;
  const dateLabel = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  const dayEntries = useMemo(() => {
    return entries.filter(e => e.date === selectedDate);
  }, [entries, selectedDate]);

  const totalMinutes = dayEntries.reduce((s, e) => s + e.minutes, 0);

  const projectBreakdown = useMemo(() => {
    const byProject: Record<string, { name: string; minutes: number; projectId: string }> = {};
    dayEntries.forEach(e => {
      if (!byProject[e.projectId]) byProject[e.projectId] = { name: e.projectName, minutes: 0, projectId: e.projectId };
      byProject[e.projectId].minutes += e.minutes;
    });
    return Object.values(byProject).sort((a, b) => b.minutes - a.minutes);
  }, [dayEntries]);

  const yesterdayStr = useMemo(() => {
    const yd = new Date(selectedDate + "T12:00:00");
    yd.setDate(yd.getDate() - 1);
    return yd.toISOString().split("T")[0];
  }, [selectedDate]);

  const yesterdayEntries = useMemo(() => {
    return entries.filter(e => e.date === yesterdayStr);
  }, [entries, yesterdayStr]);

  const navigateDay = (dir: number) => {
    const nd = new Date(selectedDate + "T12:00:00");
    nd.setDate(nd.getDate() + dir);
    const newDate = nd.toISOString().split("T")[0];
    setSelectedDate(newDate);
  };

  return (
    <div className="view-enter space-y-4">
      <Card className="border-0 overflow-hidden" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="icon" onClick={() => navigateDay(-1)} data-testid="button-prev-day" aria-label="Previous day">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <div className="text-center">
              <p className="text-sm font-semibold" style={{ color: "var(--lux-text)" }} data-testid="text-day-label">
                {dateLabel}
              </p>
              <div className="flex items-center justify-center gap-2 mt-1">
                <span className="text-lg font-bold tabular-nums" style={{ color: "var(--lux-text)" }}>
                  {formatHoursMinutes(totalMinutes)}
                </span>
                {isToday && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "rgba(207,51,57,0.1)", color: "var(--color-accent)" }}>
                    Today
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                className="text-xs text-white"
                style={{ background: "var(--color-accent)" }}
                onClick={onOpenDialog}
                data-testid="button-day-add-entry"
              >
                <Plus className="w-3 h-3 mr-1" /> New Entry
              </Button>
              {!isToday && (
                <Button variant="ghost" size="sm" className="text-xs" onClick={() => setSelectedDate(todayStr)} data-testid="button-go-today">
                  Today
                </Button>
              )}
              <Button variant="ghost" size="icon" onClick={() => navigateDay(1)} data-testid="button-next-day" aria-label="Next day">
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {projectBreakdown.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>
                Project Breakdown
              </p>
              {projectBreakdown.map(pb => {
                const percent = totalMinutes > 0 ? Math.round((pb.minutes / totalMinutes) * 100) : 0;
                return (
                  <div key={pb.projectId} className="flex items-center gap-3" data-testid={`day-breakdown-${pb.projectId}`}>
                    <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: getProjectColor(pb.projectId) }} />
                    <span className="text-sm font-medium min-w-[120px]" style={{ color: "var(--lux-text)" }}>{pb.name}</span>
                    <span className="text-xs font-bold tabular-nums min-w-[3rem]" style={{ color: "var(--lux-text)" }}>
                      {formatHoursMinutes(pb.minutes)}
                    </span>
                    <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: "var(--lux-surface-alt)" }}>
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${percent}%`, background: getProjectColor(pb.projectId), opacity: 0.85 }}
                      />
                    </div>
                    <span className="text-xs tabular-nums" style={{ color: "var(--lux-text-muted)" }}>{formatPercent(percent)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {dayEntries.length === 0 && (
        <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
          <CardContent className="py-10 text-center">
            <Clock className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--lux-text-muted)" }} />
            <p className="font-medium" style={{ color: "var(--lux-text)" }}>No time logged yet</p>
            <p className="text-sm mt-1" style={{ color: "var(--lux-text-muted)" }}>
              Use the quick-add bar above or duplicate from yesterday
            </p>
          </CardContent>
        </Card>
      )}

      {dayEntries.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider px-1 mb-2" style={{ color: "var(--lux-text-muted)" }}>
            Entries
          </p>
          {dayEntries.map(entry => (
            <div
              key={entry.id}
              className="rounded-lg px-4 py-3 flex items-center justify-between gap-3"
              style={{
                background: "var(--lux-surface)",
                boxShadow: "var(--lux-card-shadow)",
                borderLeft: `3px solid ${entry.billable ? getProjectColor(entry.projectId) : "var(--lux-border)"}`,
              }}
              data-testid={`day-entry-${entry.id}`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: getProjectColor(entry.projectId) }} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold" style={{ color: "var(--lux-text)" }}>{entry.projectName}</span>
                    {entry.serviceName && (
                      <span className="text-xs" style={{ color: "var(--lux-text-muted)" }}>{entry.serviceName}</span>
                    )}
                  </div>
                  {entry.notes && (
                    <p className="text-xs mt-0.5" style={{ color: "var(--lux-text-muted)" }}>{entry.notes}</p>
                  )}
                </div>
              </div>
              <span className="text-sm font-bold tabular-nums" style={{ color: "var(--lux-text)" }}>
                {formatHoursMinutes(entry.minutes)}
              </span>
            </div>
          ))}
        </div>
      )}

      {yesterdayEntries.length > 0 && (
        <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
          <CardContent className="p-4 space-y-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>
              Repeat from yesterday
            </p>
            <div className="flex flex-wrap gap-2">
              {yesterdayEntries.map(entry => (
                <Button
                  key={entry.id}
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() => onDuplicateEntry(entry)}
                  disabled={duplicatePending}
                  data-testid={`button-repeat-${entry.id}`}
                >
                  <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: getProjectColor(entry.projectId) }} />
                  {entry.projectName} {formatHoursMinutes(entry.minutes)}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
