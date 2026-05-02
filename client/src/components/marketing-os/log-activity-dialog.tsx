/**
 * Sprint 2f — Shared "Log activity" dialog.
 *
 * Used from BOTH the contact-detail page and the brand-scoped activity
 * firehose so the manual-write surface stays in lock-step with the
 * `insertContactActivityManualSchema` discriminated union on the server.
 *
 * Manual write set (R7): note / call / meeting / email_manual.
 * `custom` was DROPPED — freeform entries use `note`.
 *
 * The dialog POSTs to /api/marketing/activities (Sprint 2f endpoint),
 * NOT the legacy /contacts/:id/activities path. brandId is REQUIRED by
 * the new endpoint (R6) so cross-brand writes are structurally impossible.
 */
import { useState } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { EmailPreview } from "@/components/marketing-os/premium/email-preview";

type ManualType = "note" | "call" | "meeting" | "email_manual";

const TYPE_OPTIONS: ReadonlyArray<{ value: ManualType; label: string }> = [
  { value: "note",         label: "Note"          },
  { value: "call",         label: "Call"          },
  { value: "meeting",      label: "Meeting"       },
  { value: "email_manual", label: "Email (manual)" },
];

export interface LogActivityDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  prospectId: string;
  brandId: string | null;
  /** Called after a successful POST so the caller can invalidate caches. */
  onLogged?: () => void;
}

export function LogActivityDialog({
  open, onOpenChange, prospectId, brandId, onLogged,
}: LogActivityDialogProps) {
  const { toast } = useToast();
  const [type, setType] = useState<ManualType>("note");
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [duration, setDuration] = useState<string>("");
  const [outcome, setOutcome] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setType("note"); setBody(""); setSubject("");
    setDuration(""); setOutcome(""); setNotes("");
  };

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) reset();
  };

  // Build the strict per-variant payload up-front so the server never sees
  // extra keys (the manual schema uses `.strict()` on every variant).
  const buildPayload = (): Record<string, unknown> | null => {
    if (type === "note") {
      const b = body.trim();
      if (!b) return null;
      return { body: b };
    }
    if (type === "email_manual") {
      const s = subject.trim();
      if (!s) return null;
      const p: Record<string, unknown> = { subject: s };
      if (body.trim()) p.body_preview = body.trim();
      return p;
    }
    if (type === "call") {
      const d = Number(duration);
      if (!Number.isFinite(d) || d < 0) return null;
      const p: Record<string, unknown> = { duration_minutes: Math.floor(d) };
      if (outcome.trim()) p.outcome = outcome.trim();
      if (notes.trim())   p.notes = notes.trim();
      return p;
    }
    // meeting
    const d = Number(duration);
    const s = subject.trim();
    if (!Number.isFinite(d) || d < 0 || !s) return null;
    const p: Record<string, unknown> = { duration_minutes: Math.floor(d), subject: s };
    if (notes.trim()) p.notes = notes.trim();
    return p;
  };

  const submit = async () => {
    if (!brandId) {
      toast({
        title: "Cannot log activity",
        description: "This contact has no brand assigned.",
        variant: "destructive",
      });
      return;
    }
    const payload = buildPayload();
    if (!payload) {
      toast({ title: "Please fill in the required fields", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      await apiRequest("POST", "/api/marketing/activities", {
        prospectId, brandId, type, payload,
      });
      // Invalidate both the per-prospect timeline and the firehose so
      // either caller sees the new row immediately.
      await queryClient.invalidateQueries({
        queryKey: ["/api/marketing/prospects", prospectId, "activities"],
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/marketing/activities"] });
      // The brand list's "Last sent" chip is derived from email_sent /
      // email_manual activity rows, so a manual email entry needs to
      // bust the brand cache too.
      if (type === "email_manual") {
        await queryClient.invalidateQueries({ queryKey: ["/api/brands"] });
      }
      toast({ title: "Activity logged" });
      reset();
      onOpenChange(false);
      onLogged?.();
    } catch (e: unknown) {
      toast({
        title: "Failed to log activity",
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent data-testid="dialog-log-activity">
        <DialogHeader>
          <DialogTitle>Log activity</DialogTitle>
          <DialogDescription>
            Add a manual entry to this contact's timeline.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as ManualType)}>
              <SelectTrigger data-testid="select-activity-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} data-testid={`option-activity-type-${o.value}`}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {type === "note" && (
            <div>
              <Label htmlFor="log-note">Note *</Label>
              <Textarea
                id="log-note" rows={5}
                value={body} onChange={(e) => setBody(e.target.value)}
                data-testid="input-log-note"
              />
            </div>
          )}

          {type === "email_manual" && (
            <>
              <div>
                <Label htmlFor="log-subject">Subject *</Label>
                <Input
                  id="log-subject" value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  data-testid="input-log-subject"
                />
              </div>
              <div>
                <Label htmlFor="log-body">Body preview</Label>
                <Textarea
                  id="log-body" rows={4}
                  value={body} onChange={(e) => setBody(e.target.value)}
                  data-testid="input-log-body-preview"
                />
              </div>
              <div data-testid="email-manual-preview">
                <Label>Inbox preview</Label>
                <EmailPreview
                  subject={subject.trim() || "(no subject)"}
                  body={body.trim() || "(no body yet — start typing above to see this preview update.)"}
                  ctaLabel="Open conversation"
                />
              </div>
            </>
          )}

          {type === "call" && (
            <>
              <div>
                <Label htmlFor="log-duration">Duration (minutes) *</Label>
                <Input
                  id="log-duration" type="number" min={0} max={1440}
                  value={duration} onChange={(e) => setDuration(e.target.value)}
                  data-testid="input-log-duration"
                />
              </div>
              <div>
                <Label htmlFor="log-outcome">Outcome</Label>
                <Input
                  id="log-outcome" value={outcome}
                  onChange={(e) => setOutcome(e.target.value)}
                  data-testid="input-log-outcome"
                />
              </div>
              <div>
                <Label htmlFor="log-notes">Notes</Label>
                <Textarea
                  id="log-notes" rows={3}
                  value={notes} onChange={(e) => setNotes(e.target.value)}
                  data-testid="input-log-notes"
                />
              </div>
            </>
          )}

          {type === "meeting" && (
            <>
              <div>
                <Label htmlFor="log-subject-m">Subject *</Label>
                <Input
                  id="log-subject-m" value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  data-testid="input-log-subject"
                />
              </div>
              <div>
                <Label htmlFor="log-duration-m">Duration (minutes) *</Label>
                <Input
                  id="log-duration-m" type="number" min={0} max={1440}
                  value={duration} onChange={(e) => setDuration(e.target.value)}
                  data-testid="input-log-duration"
                />
              </div>
              <div>
                <Label htmlFor="log-notes-m">Notes</Label>
                <Textarea
                  id="log-notes-m" rows={3}
                  value={notes} onChange={(e) => setNotes(e.target.value)}
                  data-testid="input-log-notes"
                />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} data-testid="button-cancel-log">
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy} data-testid="button-submit-log">
            {busy ? "Logging…" : "Log"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
