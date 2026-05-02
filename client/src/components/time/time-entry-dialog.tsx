import { useState, useEffect, useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { FormSection } from "@/components/shared/form-section";
import { formatHoursMinutes } from "@/components/shared/format";
import { Briefcase } from "lucide-react";
import { getProjectColor } from "./utils";
import type { ProjectOption, ServiceOption } from "./utils";
import type { TimeEntry } from "@shared/schema";

interface TimeEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  myProjects: ProjectOption[] | undefined;
  services: ServiceOption[] | undefined;
  projectServices?: any[];
  defaultDate?: string;
  defaultProjectId?: string;
  defaultStartTime?: string;
  defaultEndTime?: string;
  existingEntries?: { endTime: string | null }[];
  editEntry?: TimeEntry | null;
}

export default function TimeEntryDialog({
  open, onOpenChange, myProjects, services, projectServices,
  defaultDate, defaultProjectId, defaultStartTime, defaultEndTime,
  existingEntries, editEntry,
}: TimeEntryDialogProps) {
  const { toast } = useToast();
  const todayStr = new Date().toISOString().split("T")[0];

  const smartStartTime = useMemo(() => {
    if (defaultStartTime) return defaultStartTime;
    if (existingEntries && existingEntries.length > 0) {
      const lastEnd = existingEntries
        .filter(e => e.endTime)
        .map(e => e.endTime!)
        .sort()
        .pop();
      if (lastEnd) return lastEnd;
    }
    return "09:00";
  }, [defaultStartTime, existingEntries]);

  const smartEndTime = defaultEndTime || (() => {
    const [h, m] = smartStartTime.split(":").map(Number);
    const endH = (h + 1) % 24;
    return `${String(endH).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  })();

  const [projectId, setProjectId] = useState("");

  const { data: fetchedProjectServices } = useQuery<any[]>({
    queryKey: ["/api/projects", projectId, "available-services"],
    queryFn: () => projectId
      ? fetch(`/api/projects/${projectId}/available-services`, { credentials: "include" }).then(r => r.json())
      : Promise.resolve([]),
    enabled: !!projectId && open,
  });

  const activeProjectServices = fetchedProjectServices && fetchedProjectServices.length > 0
    ? fetchedProjectServices
    : projectServices && projectServices.length > 0
      ? projectServices
      : null;

  const [date, setDate] = useState(todayStr);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [manualMinutes, setManualMinutes] = useState("");
  const [useManualMinutes, setUseManualMinutes] = useState(false);
  const [serviceId, setServiceId] = useState("");
  const [notes, setNotes] = useState("");
  const [billable, setBillable] = useState(true);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  useEffect(() => {
    if (open) {
      if (editEntry) {
        setProjectId(editEntry.projectId);
        setDate(editEntry.date);
        if (editEntry.startTime && editEntry.endTime) {
          setStartTime(editEntry.startTime);
          setEndTime(editEntry.endTime);
          setUseManualMinutes(false);
          setManualMinutes("");
        } else {
          setStartTime("09:00");
          setEndTime("10:00");
          setUseManualMinutes(true);
          setManualMinutes(String(editEntry.minutes));
        }
        setServiceId(editEntry.serviceId || "");
        setNotes(editEntry.notes || "");
        setBillable(editEntry.billable);
      } else {
        setProjectId(defaultProjectId || myProjects?.[0]?.id || "");
        setDate(defaultDate || todayStr);
        setStartTime(smartStartTime);
        setEndTime(smartEndTime);
        setUseManualMinutes(false);
        setManualMinutes("");
        setServiceId("");
        setNotes("");
        setBillable(true);
      }
      setSubmitAttempted(false);
    }
  }, [open, editEntry, defaultDate, defaultProjectId, smartStartTime, smartEndTime, myProjects, todayStr]);

  const computedDuration = useMemo(() => {
    if (!startTime || !endTime) return 0;
    const [sh, sm] = startTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    const startMins = sh * 60 + sm;
    let endMins = eh * 60 + em;
    if (endMins <= startMins) endMins += 24 * 60;
    return endMins - startMins;
  }, [startTime, endTime]);

  const durationMinutes = useManualMinutes ? (parseInt(manualMinutes) || 0) : computedDuration;

  const projectName = myProjects?.find(p => p.id === projectId)?.name || "";

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/time-entries", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/my-week"] });
      toast({ title: `Logged ${formatHoursMinutes(durationMinutes)} on ${projectName}` });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to log time", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("PATCH", `/api/time-entries/${editEntry!.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/my-week"] });
      toast({ title: `Updated entry on ${projectName}` });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update", description: err.message, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitAttempted(true);
    if (!isValid) return;
    const payload: Record<string, unknown> = {
      projectId,
      date,
      minutes: durationMinutes,
      serviceId: serviceId || null,
      notes: notes.trim(),
      billable,
    };
    if (!useManualMinutes) {
      payload.startTime = startTime;
      payload.endTime = endTime;
    }
    if (editEntry) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate(payload);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const isValid = projectId && date && durationMinutes > 0 && notes.trim().length > 0;

  const dateDisplay = (() => {
    const d = new Date(date + "T12:00:00");
    return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}>
        <DialogHeader>
          <DialogTitle style={{ color: "var(--lux-text)" }} data-testid="dialog-title-time-entry">
            {editEntry ? "Edit Time Entry" : "Log Time Entry"}
          </DialogTitle>
        </DialogHeader>
        {myProjects && myProjects.length === 0 && !editEntry ? (
          <div className="flex flex-col items-center justify-center py-10 px-4 text-center" data-testid="empty-state-no-projects">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ background: "rgba(var(--lux-accent-rgb),0.1)" }}>
              <Briefcase className="w-7 h-7" style={{ color: "var(--lux-accent)" }} />
            </div>
            <h2 className="text-lg font-semibold mb-1" style={{ color: "var(--lux-text)" }} data-testid="text-no-projects-title">No projects assigned</h2>
            <p className="text-sm mb-4" style={{ color: "var(--lux-text-muted)" }}>Ask your admin to add you to a project from the project detail page.</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText("support@cherryworkspro.com");
                toast({ title: "Admin contact copied to clipboard" });
              }}
              data-testid="button-copy-admin-contact"
            >
              Copy admin contact
            </Button>
          </div>
        ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          <FormSection title="Project" description="">
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger style={{ borderColor: "var(--lux-border)", color: "var(--lux-text)" }} data-testid="select-dialog-project">
                <div className="flex items-center gap-2">
                  {projectId && <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: getProjectColor(projectId) }} />}
                  <SelectValue placeholder="Select project" />
                </div>
              </SelectTrigger>
              <SelectContent>
                {myProjects?.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <div className="flex items-center gap-2">
                      <span className="inline-block w-2 h-2 rounded-full" style={{ background: getProjectColor(p.id) }} />
                      {p.name} ({p.clientName})
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormSection>

          <FormSection title="When" description="">
            <div className="space-y-3">
              <div>
                <Label className="text-xs" style={{ color: "var(--lux-text-muted)" }}>Date</Label>
                <Input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  style={{ borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                  data-testid="input-dialog-date"
                />
                <p className="text-xs mt-1" style={{ color: "var(--lux-text-muted)" }}>{dateDisplay}</p>
              </div>
              {useManualMinutes ? (
                <div className="grid grid-cols-2 gap-3 items-end">
                  <div>
                    <Label className="text-xs" style={{ color: "var(--lux-text-muted)" }}>Duration (minutes)</Label>
                    <Input
                      type="number"
                      min="1"
                      value={manualMinutes}
                      onChange={(e) => setManualMinutes(e.target.value)}
                      style={{ borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                      data-testid="input-dialog-manual-minutes"
                    />
                  </div>
                  <div className="pb-2">
                    <button
                      type="button"
                      className="text-xs underline"
                      style={{ color: "var(--color-accent)" }}
                      onClick={() => { setUseManualMinutes(false); setStartTime("09:00"); setEndTime("10:00"); }}
                      data-testid="button-switch-to-times"
                    >
                      Use start/end times instead
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-3 items-end">
                  <div>
                    <Label className="text-xs" style={{ color: "var(--lux-text-muted)" }}>Start Time</Label>
                    <Input
                      type="time"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      style={{ borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                      data-testid="input-dialog-start-time"
                    />
                  </div>
                  <div>
                    <Label className="text-xs" style={{ color: "var(--lux-text-muted)" }}>End Time</Label>
                    <Input
                      type="time"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      style={{ borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                      data-testid="input-dialog-end-time"
                    />
                  </div>
                  <div className="text-center pb-2">
                    <span
                      className="text-lg font-bold tabular-nums"
                      style={{ color: durationMinutes > 0 ? "var(--color-accent)" : "var(--lux-text-muted)" }}
                      data-testid="text-dialog-duration"
                    >
                      {formatHoursMinutes(durationMinutes)}
                    </span>
                    <p className="text-[10px]" style={{ color: "var(--lux-text-muted)" }}>duration</p>
                  </div>
                </div>
              )}
            </div>
          </FormSection>

          <FormSection title="What" description="">
            <div className="space-y-3">
              <div>
                <Label className="text-xs" style={{ color: "var(--lux-text-muted)" }}>Service</Label>
                <Select value={serviceId || "none"} onValueChange={(v) => setServiceId(v === "none" ? "" : v)}>
                  <SelectTrigger style={{ borderColor: "var(--lux-border)", color: "var(--lux-text)" }} data-testid="select-dialog-service">
                    <SelectValue placeholder="Select service (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No service</SelectItem>
                    {(activeProjectServices || services)?.filter((s: any) => s.isActive !== false).map((s: any) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs" style={{ color: "var(--lux-text-muted)" }}>Description *</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Describe the work performed..."
                  rows={3}
                  required
                  className={`resize-none ${!notes.trim() && submitAttempted ? "border-red-500" : ""}`}
                  style={{ borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                  data-testid="input-dialog-notes"
                />
                {!notes.trim() && submitAttempted && (
                  <p className="text-xs text-red-500 mt-1">Description is required</p>
                )}
              </div>
            </div>
          </FormSection>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Checkbox
                id="dialog-billable"
                checked={billable}
                onCheckedChange={(v) => setBillable(!!v)}
                data-testid="checkbox-dialog-billable"
              />
              <Label htmlFor="dialog-billable" className="text-sm cursor-pointer" style={{ color: "var(--lux-text)" }}>Billable</Label>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" style={{ borderColor: "var(--lux-border)", color: "var(--lux-text)" }} onClick={() => onOpenChange(false)} data-testid="button-dialog-cancel">
                Cancel
              </Button>
              <Button
                type="submit"
                className="text-white"
                style={{ background: "var(--gradient-brand)" }}
                disabled={isPending || !isValid}
                data-testid="button-dialog-submit"
              >
                {isPending ? "Saving..." : editEntry ? "Save Changes" : "Log Entry"}
              </Button>
            </div>
          </div>
        </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
