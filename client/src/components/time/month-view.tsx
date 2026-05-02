import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { getProjectColor, formatHoursMinutes } from "./utils";
import type { TimeEntry } from "@shared/schema";

interface TimeEntryWithDetails extends TimeEntry {
  projectName: string;
  clientName: string;
  userName: string;
  serviceName?: string | null;
}

interface MonthViewProps {
  selectedMonth: Date;
  setSelectedMonth: (d: Date) => void;
  entries: TimeEntryWithDetails[];
  setSelectedDate: (d: string) => void;
  selectedDate: string;
  isAdmin: boolean;
  teamMemberFilter: string;
  setTeamMemberFilter: (v: string) => void;
  uniqueTeamMembers: Array<{ id: string; name: string }>;
  onCellClick: (dateStr: string) => void;
}

function getHeatmapIntensity(hours: number): string {
  if (hours <= 0) return "transparent";
  if (hours < 3) return "rgba(207,51,57, 0.08)";
  if (hours < 6) return "rgba(207,51,57, 0.18)";
  if (hours < 8) return "rgba(207,51,57, 0.30)";
  return "rgba(207,51,57, 0.45)";
}

export default function MonthView({
  selectedMonth, setSelectedMonth, entries, setSelectedDate,
  selectedDate, isAdmin, teamMemberFilter, setTeamMemberFilter, uniqueTeamMembers,
  onCellClick,
}: MonthViewProps) {
  const year = selectedMonth.getFullYear();
  const month = selectedMonth.getMonth();
  const monthName = selectedMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const filteredEntries = useMemo(() => {
    if (teamMemberFilter === "all") return entries;
    return entries.filter(e => e.userId === teamMemberFilter);
  }, [entries, teamMemberFilter]);

  const entriesByDate = useMemo(() => {
    const map = new Map<string, TimeEntryWithDetails[]>();
    for (const entry of filteredEntries || []) {
      const existing = map.get(entry.date) || [];
      existing.push(entry);
      map.set(entry.date, existing);
    }
    return map;
  }, [filteredEntries]);

  function getDayMinutes(date: string): number {
    const dayEntries = entriesByDate.get(date) || [];
    return dayEntries.reduce((sum, e) => sum + e.minutes, 0);
  }

  function getDayProjects(date: string): string[] {
    const dayEntries = entriesByDate.get(date) || [];
    const seen = new Set<string>();
    return dayEntries.filter(e => { if (seen.has(e.projectId)) return false; seen.add(e.projectId); return true; }).map(e => e.projectId).slice(0, 3);
  }

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, month, 1);
  const startDow = firstDayOfMonth.getDay();

  const allCells: Array<{ day: number; dateStr: string } | null> = [];
  for (let i = 0; i < startDow; i++) allCells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    allCells.push({ day: d, dateStr });
  }
  while (allCells.length % 7 !== 0) allCells.push(null);

  const weeks: Array<Array<{ day: number; dateStr: string } | null>> = [];
  for (let i = 0; i < allCells.length; i += 7) {
    weeks.push(allCells.slice(i, i + 7));
  }

  const todayStr = new Date().toISOString().split("T")[0];

  const weekTotals = useMemo(() => {
    return weeks.map(week => {
      let total = 0;
      for (const cell of week) {
        if (cell) total += getDayMinutes(cell.dateStr);
      }
      return total;
    });
  }, [entriesByDate, weeks]);

  const monthTotal = useMemo(() => {
    return weekTotals.reduce((s, t) => s + t, 0);
  }, [weekTotals]);

  function getWeekRange(week: Array<{ day: number; dateStr: string } | null>): string {
    const validCells = week.filter(c => c !== null) as Array<{ day: number; dateStr: string }>;
    if (validCells.length === 0) return "";
    const first = new Date(validCells[0].dateStr + "T12:00:00");
    const last = new Date(validCells[validCells.length - 1].dateStr + "T12:00:00");
    const fm = first.toLocaleDateString("en-US", { month: "short" });
    const fd = first.getDate();
    const ld = last.getDate();
    const lm = last.toLocaleDateString("en-US", { month: "short" });
    if (fm === lm) return `${fm} ${fd} - ${ld}`;
    return `${fm} ${fd} - ${lm} ${ld}`;
  }

  const navigateMonth = (dir: number) => {
    const next = new Date(year, month + dir, 1);
    setSelectedMonth(next);
  };

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];


  return (
    <div className="view-enter">
      <Card className="border-0 overflow-hidden" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={() => navigateMonth(-1)} data-testid="button-prev-month" aria-label="Previous month">
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <p className="text-sm font-semibold" style={{ color: "var(--lux-text)" }} data-testid="text-month-label">
                {monthName}
              </p>
              <Button variant="ghost" size="icon" onClick={() => navigateMonth(1)} data-testid="button-next-month" aria-label="Next month">
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
            {isAdmin && uniqueTeamMembers.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: "var(--lux-text-muted)" }}>Hours Logged By:</span>
                <Select value={teamMemberFilter} onValueChange={setTeamMemberFilter}>
                  <SelectTrigger className="h-8 w-[160px] text-xs" data-testid="select-hours-logged-by">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {uniqueTeamMembers.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse" style={{ minWidth: "600px" }}>
              <thead>
                <tr>
                  {dayNames.map(d => (
                    <th key={d} className="text-center text-[10px] font-semibold uppercase py-1.5 px-1" style={{ color: "var(--lux-text-muted)", width: "12%" }}>
                      {d}
                    </th>
                  ))}
                  <th className="text-center text-[10px] font-semibold uppercase py-1.5 px-1" style={{ color: "var(--lux-text-muted)", width: "16%" }}>
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((week, weekIdx) => {
                  const range = getWeekRange(week);
                  const wTotal = weekTotals[weekIdx];
                  return (
                    <tr key={weekIdx}>
                      {week.map((cell, dayIdx) => {
                        if (!cell) {
                          return (
                            <td key={`empty-${weekIdx}-${dayIdx}`} className="p-0.5">
                              <div className="aspect-square rounded-md" style={{ background: "var(--lux-surface-alt)", border: "1px solid var(--lux-border)", opacity: 0.4 }} />
                            </td>
                          );
                        }
                        const { day, dateStr } = cell;
                        const mins = getDayMinutes(dateStr);
                        const hours = mins / 60;
                        const isToday = dateStr === todayStr;
                        const isSelected = dateStr === selectedDate;
                        const dayOfWeek = new Date(dateStr + "T12:00:00").getDay();
                        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                        const projects = getDayProjects(dateStr);
                        const intensity = getHeatmapIntensity(hours);
                        const dayEntries = entriesByDate.get(dateStr) || [];
                        const breakdown = dayEntries.reduce((acc, e) => {
                          acc[e.projectName] = (acc[e.projectName] || 0) + e.minutes;
                          return acc;
                        }, {} as Record<string, number>);
                        const tooltipLines = Object.entries(breakdown).map(([name, m]) => `${name}: ${formatHoursMinutes(m)}`);
                        const tooltip = mins > 0 ? `${dateStr}\n${formatHoursMinutes(mins)} total\n${tooltipLines.join("\n")}` : dateStr;

                        return (
                          <td key={dateStr} className="p-0.5">
                            <div
                              className="aspect-square rounded-md p-1 cursor-pointer transition-all flex flex-col items-center justify-center relative group"
                              style={{
                                background: intensity !== "transparent" ? intensity : isWeekend ? "var(--lux-surface-alt)" : "var(--lux-surface)",
                                border: isSelected
                                  ? "2px solid var(--color-accent)"
                                  : isToday
                                    ? "1.5px solid var(--color-accent-glow)"
                                    : "1px solid var(--lux-border)",
                                boxShadow: isSelected
                                  ? "0 0 10px rgba(207,51,57,0.3)"
                                  : isToday
                                    ? "0 0 8px var(--color-accent-glow)"
                                    : hours > 8 ? "0 0 6px rgba(207,51,57, 0.3)" : undefined,
                              }}
                              onClick={() => { setSelectedDate(dateStr); onCellClick(dateStr); }}
                              title={tooltip}
                              data-testid={`month-cell-${dateStr}`}
                            >
                              <span className="text-[10px] font-medium absolute top-0.5 left-1" style={{ color: isToday ? "var(--color-accent)" : "var(--lux-text-muted)" }}>
                                {day}
                              </span>
                              <button
                                className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
                                style={{ background: "var(--color-accent)", color: "white" }}
                                onClick={(e) => { e.stopPropagation(); onCellClick(dateStr); }}
                                data-testid={`button-add-entry-month-${dateStr}`}
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                              {mins > 0 && (
                                <span className="text-xs tabular-nums font-bold" style={{ color: "var(--lux-text)" }}>
                                  {formatHoursMinutes(mins)}
                                </span>
                              )}
                              {projects.length > 0 && (
                                <div className="flex items-center gap-0.5 absolute bottom-0.5">
                                  {projects.map(pid => (
                                    <span key={pid} className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: getProjectColor(pid) }} />
                                  ))}
                                </div>
                              )}
                            </div>
                          </td>
                        );
                      })}
                      <td className="p-0.5 align-middle">
                        <div className="rounded-md px-2 py-2 text-center" style={{ background: "var(--lux-surface-alt)", border: "1px solid var(--lux-border)" }}>
                          <p className="text-[9px] leading-tight" style={{ color: "var(--lux-text-muted)" }}>{range}</p>
                          <p className="text-sm font-bold tabular-nums mt-0.5" style={{ color: wTotal > 0 ? "var(--lux-text)" : "var(--lux-text-muted)" }}>
                            {formatHoursMinutes(wTotal)}
                          </p>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end pt-1 border-t" style={{ borderColor: "var(--lux-border)" }}>
            <span className="text-sm font-bold tabular-nums" style={{ color: "var(--lux-text)" }} data-testid="text-month-total">
              Monthly Total: {formatHoursMinutes(monthTotal)}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
