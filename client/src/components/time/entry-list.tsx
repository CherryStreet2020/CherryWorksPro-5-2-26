import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Clock, Pencil, Trash2, Lock, Copy, Plus } from "lucide-react";
import { getProjectColor, formatHoursMinutes } from "./utils";
import { formatTime12h } from "@/components/shared/format";
import type { ProjectOption, ServiceOption } from "./utils";
import type { TimeEntry } from "@shared/schema";

export interface TimeEntryWithDetails extends TimeEntry {
  projectName: string;
  clientName: string;
  userName: string;
  serviceName?: string | null;
}

function humanDate(dateStr: string): string {
  const today = new Date().toISOString().split("T")[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
  const d = new Date(dateStr + "T12:00:00");
  const dayName = d.toLocaleDateString("en-US", { weekday: "long" });
  const formatted = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (dateStr === today) return `Today \u2014 ${dayName}, ${formatted}`;
  if (dateStr === yesterday) return `Yesterday \u2014 ${dayName}, ${formatted}`;
  return `${dayName}, ${formatted}`;
}

function computeEditDuration(start: string, end: string): number {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const diff = (eh * 60 + em) - (sh * 60 + sm);
  return diff > 0 ? diff : 0;
}

interface EntryListProps {
  filteredEntries: TimeEntryWithDetails[];
  selectedEntries: Set<string>;
  toggleEntrySelection: (id: string) => void;
  toggleSelectAll: () => void;
  selectableEntries: TimeEntryWithDetails[];
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
  editSuccess: string | null;
  newEntryId: string | null;
  deletingEntryId: string | null;
  onStartInlineEdit: (entry: TimeEntryWithDetails) => void;
  onSaveInlineEdit: () => void;
  onOpenDeleteEntry: (entry: TimeEntryWithDetails) => void;
  onDuplicateEntry: (entry: TimeEntryWithDetails) => void;
  updateMutationPending: boolean;
  myProjects: ProjectOption[] | undefined;
  services: ServiceOption[] | undefined;
  isAdmin?: boolean;
  onAddEntry?: () => void;
}

export default function EntryList(props: EntryListProps) {
  const {
    filteredEntries, selectedEntries, toggleEntrySelection, toggleSelectAll, selectableEntries,
    editingEntryId, setEditingEntryId, editDate, setEditDate,
    editStartTime, setEditStartTime, editEndTime, setEditEndTime,
    editBillable, setEditBillable,
    editNotes, setEditNotes, editProjectId, setEditProjectId,
    editServiceId, setEditServiceId, editSuccess, newEntryId, deletingEntryId,
    onStartInlineEdit, onSaveInlineEdit, onOpenDeleteEntry, onDuplicateEntry,
    updateMutationPending, myProjects, services, isAdmin,
  } = props;

  const editDurationMinutes = computeEditDuration(editStartTime, editEndTime);

  const groupedByDate = filteredEntries.reduce(
    (acc, entry) => {
      const d = entry.date;
      if (!acc[d]) acc[d] = [];
      acc[d].push(entry);
      return acc;
    },
    {} as Record<string, TimeEntryWithDetails[]>,
  );

  const sortedDates = Object.keys(groupedByDate).sort(
    (a, b) => new Date(b).getTime() - new Date(a).getTime(),
  );

  if (!sortedDates.length) {
    return (
      <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
        <CardContent className="py-16 text-center">
          <Clock className="w-12 h-12 mx-auto mb-3" style={{ color: "var(--lux-text-muted)" }} />
          <p className="font-medium" style={{ color: "var(--lux-text)" }}>No time entries yet</p>
          <p className="text-sm mt-1 mb-4" style={{ color: "var(--lux-text-muted)" }}>Log your first time entry to get started</p>
          {props.onAddEntry && (
            <Button onClick={props.onAddEntry} className="text-white" style={{ background: "var(--gradient-brand)" }} data-testid="button-add-first-entry">
              <Plus className="w-4 h-4 mr-2" /> Add First Entry
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {sortedDates.length > 0 && (
        <>
          <div className="flex items-center gap-2 px-1">
            <Checkbox
              checked={selectedEntries.size === selectableEntries.length && selectableEntries.length > 0}
              onCheckedChange={toggleSelectAll}
              data-testid="checkbox-select-all"
            />
            <Label className="text-xs cursor-pointer" style={{ color: "var(--lux-text-muted)" }}>Select All</Label>
          </div>
          <div
            className="grid grid-cols-[auto_1fr_auto] gap-4 px-4 py-2 text-xs font-medium"
            style={{ color: "var(--lux-text-muted)", borderBottom: "1px solid var(--lux-border)" }}
            data-testid="entry-list-headers"
          >
            <span>{isAdmin ? "Team Member / Date" : "Date"}</span>
            <span>Client / Project / Service / Note</span>
            <span className="text-right">Time / Status</span>
          </div>
        </>
      )}
      {sortedDates.map((dateKey) => {
        const dayEntries = groupedByDate[dateKey];
        const totalMins = dayEntries.reduce((sum, e) => sum + e.minutes, 0);

        return (
          <div key={dateKey}>
            <div className="flex items-center gap-3 mb-2 px-1">
              <div className="flex-1 flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-secondary)" }}>
                  {humanDate(dateKey)}
                </span>
                <div className="flex-1 h-px" style={{ background: "var(--lux-border)" }} />
              </div>
              <span className="text-xs font-bold tabular-nums" style={{ color: "var(--lux-text-secondary)" }}>
                {formatHoursMinutes(totalMins)}
              </span>
            </div>

            <div className="space-y-1">
              {dayEntries.map((entry) => {
                const isEditing = editingEntryId === entry.id;
                const isDeleting = deletingEntryId === entry.id;
                const isNew = newEntryId === entry.id;
                const isFlashing = editSuccess === entry.id;
                const color = getProjectColor(entry.projectId);

                if (isEditing) {
                  return (
                    <div
                      key={entry.id}
                      className="rounded-lg p-3 space-y-2"
                      style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)", border: "1px solid var(--lux-border-strong)" }}
                      data-testid={`row-time-${entry.id}`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Select value={editProjectId} onValueChange={setEditProjectId}>
                          <SelectTrigger className="w-[180px] h-9 text-sm">
                            <div className="flex items-center gap-2">
                              <span className="inline-block w-2 h-2 rounded-full" style={{ background: getProjectColor(editProjectId) }} />
                              <SelectValue />
                            </div>
                          </SelectTrigger>
                          <SelectContent>
                            {myProjects?.map((p) => (
                              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input type="date" className="w-[140px] h-9 text-sm" value={editDate} onChange={(e) => setEditDate(e.target.value)} data-testid="input-edit-time-date" />
                        <div className="flex items-center gap-1">
                          <Input type="time" className="w-[110px] h-9 text-sm tabular-nums" value={editStartTime} onChange={(e) => setEditStartTime(e.target.value)} data-testid="input-edit-start-time" />
                          <span className="text-xs" style={{ color: "var(--lux-text-muted)" }}>{"\u2192"}</span>
                          <Input type="time" className="w-[110px] h-9 text-sm tabular-nums" value={editEndTime} onChange={(e) => setEditEndTime(e.target.value)} data-testid="input-edit-end-time" />
                          <span
                            className="text-sm font-bold tabular-nums ml-1"
                            style={{ color: editDurationMinutes > 0 ? "var(--color-accent)" : "var(--lux-text-muted)" }}
                            data-testid="text-edit-duration"
                          >
                            {formatHoursMinutes(editDurationMinutes)}
                          </span>
                        </div>
                        <Select value={editServiceId || "none"} onValueChange={(v) => setEditServiceId(v === "none" ? "" : v)}>
                          <SelectTrigger className="w-[130px] h-9 text-sm">
                            <SelectValue placeholder="Service" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No service</SelectItem>
                            {services?.filter((s) => s.isActive).map((s) => (
                              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Input className="h-9 text-sm" placeholder="Notes" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} data-testid="input-edit-time-notes" />
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <Checkbox id={`edit-bill-${entry.id}`} checked={editBillable} onCheckedChange={(v) => setEditBillable(!!v)} data-testid="checkbox-edit-billable" />
                          <Label htmlFor={`edit-bill-${entry.id}`} className="text-xs cursor-pointer">Billable</Label>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button variant="ghost" size="sm" onClick={() => setEditingEntryId(null)} data-testid="button-cancel-edit">Cancel</Button>
                          <Button size="sm" className="text-white" style={{ background: "var(--gradient-brand)" }} onClick={onSaveInlineEdit} disabled={updateMutationPending || editDurationMinutes <= 0} data-testid="button-submit-edit-time">
                            {updateMutationPending ? "Saving..." : "Save"}
                          </Button>
                        </div>
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
                      animation: isNew ? "entrySlideIn 0.3s ease-out" : isDeleting ? "entryFadeOut 0.2s ease-in forwards" : undefined,
                    }}
                    data-testid={`row-time-${entry.id}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Checkbox
                        checked={selectedEntries.has(entry.id)}
                        onCheckedChange={() => toggleEntrySelection(entry.id)}
                        disabled={entry.invoiced}
                        data-testid={`checkbox-entry-${entry.id}`}
                      />
                      {entry.startTime && entry.endTime ? (
                        <div className="flex flex-col items-end flex-shrink-0 w-[70px]" data-testid={`text-times-${entry.id}`}>
                          <span className="text-[11px] font-medium tabular-nums" style={{ color: "var(--lux-text-secondary)" }}>
                            {formatTime12h(entry.startTime)}
                          </span>
                          <span className="text-[11px] tabular-nums" style={{ color: "var(--lux-text-muted)" }}>
                            {formatTime12h(entry.endTime)}
                          </span>
                        </div>
                      ) : (
                        <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                          <span className="text-sm font-semibold" style={{ color: "var(--lux-text)" }}>
                            {entry.projectName}
                          </span>
                          {entry.serviceName && (
                            <span className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
                              {entry.serviceName}
                            </span>
                          )}
                        </div>
                        {entry.notes && (
                          <p className="text-xs mt-0.5 truncate max-w-[400px]" style={{ color: "var(--lux-text-muted)" }}>
                            {entry.notes}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {entry.invoiced && (
                        <Lock className="w-3 h-3" style={{ color: "var(--lux-text-muted)" }} />
                      )}
                      <span className="text-sm font-bold tabular-nums min-w-[3rem] text-right" style={{ color: "var(--lux-text)" }}>
                        {formatHoursMinutes(entry.minutes)}
                      </span>
                      {entry.invoiced ? (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e" }} data-testid={`badge-billed-${entry.id}`}>
                          Billed
                        </span>
                      ) : (
                        <span className="text-[10px] px-2 py-0.5" style={{ color: "var(--lux-text-muted)" }} data-testid={`badge-unbilled-${entry.id}`}>
                          Unbilled
                        </span>
                      )}
                      {!entry.invoiced && (
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity sm:opacity-100">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => onDuplicateEntry(entry)}
                            data-testid={`button-duplicate-time-${entry.id}`}
                            title="Duplicate to today"
                            aria-label="Duplicate to today"
                          >
                            <Copy className="w-3 h-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => onStartInlineEdit(entry)}
                            data-testid={`button-edit-time-${entry.id}`}
                            aria-label="Edit entry"
                          >
                            <Pencil className="w-3 h-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-red-500"
                            onClick={() => onOpenDeleteEntry(entry)}
                            data-testid={`button-delete-time-${entry.id}`}
                            aria-label="Delete entry"
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
