/**
 * Marketing OS — Sprint 2a: Contact detail (/marketing/contacts/:id).
 *
 * Layout:
 *  - Left column: editable form (PATCH /api/marketing/contacts/:id on Save)
 *  - Right column: activity timeline grouped by calendar day, with each
 *    entry's full payload collapsed by default and expandable on click.
 *
 * Brand-mismatch banner triggers when the user's active brand context
 * differs from the contact's brand_id (per Sprint 2a spec) — surfacing
 * "you're viewing a Brand A contact while operating under Brand B".
 *
 * Cross-link: when contact.clientId is set, a "View billing history"
 * button links to /clients/:clientId. Suppressed for pure marketing leads.
 *
 * Route MUST register BEFORE /marketing/contacts in App.tsx.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import {
  ArrowLeft, ExternalLink, Mail, Building2, MapPin, Briefcase, Plus,
  AlertTriangle, MessageSquare, MousePointer, MailOpen, MailX, FileText,
  Activity as ActivityIcon, Tag as TagIcon, Save, ChevronDown, ChevronRight,
} from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useBrand } from "@/hooks/useBrand";
import { isMarketingOsEnabled } from "@/lib/featureFlags";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Trash2, Phone, Calendar, UserPlus } from "lucide-react";
import { LogActivityDialog } from "@/components/marketing-os/log-activity-dialog";
import {
  StatusRibbon,
  type LifecycleStage,
} from "@/components/marketing-os/premium/status-ribbon";
import { FreshnessDot } from "@/components/marketing-os/premium/freshness-dot";
import type { ClientContact, ContactTag, ContactActivity, Company } from "@shared/schema";

const RIBBON_STAGES = new Set<LifecycleStage>([
  "lead", "mql", "sql", "opportunity", "customer", "evangelist",
]);

type ContactWithTags = ClientContact & { tags: ContactTag[] };

type LucideIcon = typeof Mail;

// Sprint 2f: combined manual + system + legacy types so the timeline can
// render every variant the read-side superset returns. Each entry maps to
// a label + lucide icon used for the row chip.
export const ACTIVITY_TYPE_LABELS: Record<string, { label: string; icon: LucideIcon }> = {
  // Manual writes (sprint 2f).
  note:           { label: "Note",            icon: MessageSquare },
  call:           { label: "Call",            icon: Phone },
  meeting:        { label: "Meeting",         icon: Calendar },
  email_manual:   { label: "Email (manual)",  icon: Mail },
  // System writes (sprint 2f).
  contact_created:{ label: "Contact created", icon: UserPlus },
  tag_added:      { label: "Tag added",       icon: TagIcon },
  tag_removed:    { label: "Tag removed",     icon: TagIcon },
  segment_added:  { label: "Added to segment",   icon: TagIcon },
  segment_removed:{ label: "Removed from segment", icon: TagIcon },
  imported:       { label: "Imported",        icon: Plus },
  // Legacy / future-reserved types (read-only display).
  email_sent:     { label: "Email sent",      icon: Mail },
  email_opened:   { label: "Email opened",    icon: MailOpen },
  email_clicked:  { label: "Link clicked",    icon: MousePointer },
  email_replied:  { label: "Email replied",   icon: MessageSquare },
  email_bounced:  { label: "Email bounced",   icon: MailX },
  form_submitted: { label: "Form submitted",  icon: FileText },
  page_viewed:    { label: "Page viewed",     icon: ActivityIcon },
  note_added:     { label: "Note added",      icon: MessageSquare },
  stage_changed:  { label: "Stage changed",   icon: TagIcon },
  unsubscribed:   { label: "Unsubscribed",    icon: MailX },
};

const LIFECYCLE_STAGES = ["lead", "mql", "sql", "opportunity", "customer", "evangelist"];
const LEAD_STATUSES   = ["new", "contacted", "qualified", "unqualified"];

// Strongly-typed form payload, derived from the schema row type.
type ContactFormValues = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  title: string;
  companyName: string;
  location: string;
  linkedinUrl: string;
  lifecycleStage: string;
  leadStatus: string;
  source: string;
  notes: string;
  companyId: string;
};

function dayKey(d: Date): string {
  // YYYY-MM-DD in local TZ — used as the day-bucket key for the timeline.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDayLabel(key: string): string {
  const today = dayKey(new Date());
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (key === today) return "Today";
  if (key === dayKey(y)) return "Yesterday";
  const [yy, mm, dd] = key.split("-").map(Number);
  return new Date(yy, mm - 1, dd).toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
}

export default function ContactDetailPage() {
  const flagOn = isMarketingOsEnabled();
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { activeBrand, brands } = useBrand();
  const [logOpen, setLogOpen] = useState(false);

  const { data: contact, isLoading } = useQuery<ContactWithTags>({
    queryKey: ["/api/marketing/contacts", id],
    enabled: flagOn && !!id,
  });

  const { data: activities = [] } = useQuery<ContactActivity[]>({
    queryKey: ["/api/marketing/contacts", id, "activities"],
    enabled: flagOn && !!id,
  });

  if (!flagOn) {
    return (
      <div className="p-10 text-center text-sm" style={{ color: "var(--lux-text-muted)" }} data-testid="status-flag-off">
        Marketing is available on the Business plan. Upgrade anytime from Settings → Plan.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-8 text-sm" style={{ color: "var(--lux-text-muted)" }} data-testid="status-loading">
        Loading contact…
      </div>
    );
  }

  if (!contact) {
    return (
      <div className="px-6 lg:px-8 xl:px-10 py-6 max-w-3xl mx-auto">
        <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
          <CardContent className="p-12 text-center" data-testid="empty-state-not-found">
            <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>Contact not found</h2>
            <Button asChild variant="outline" data-testid="link-back-list">
              <Link href="/marketing/contacts">Back to Contacts</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const contactBrandName = brands?.find((b) => b.id === contact.brandId)?.name;
  // Brand-mismatch: contact belongs to a different brand than the user's
  // currently-active brand context. This protects against editing the wrong
  // brand's contact while the operator's mental model is on Brand B.
  const brandMismatch =
    !!activeBrand &&
    !!contact.brandId &&
    activeBrand.id !== contact.brandId;

  return (
    <div className="px-6 lg:px-8 xl:px-10 py-6 max-w-5xl mx-auto">
      <Link
        href="/marketing/contacts"
        className="inline-flex items-center gap-1.5 text-sm mb-4 transition-colors hover:[color:var(--lux-accent,#cf3339)]"
        style={{ color: "var(--lux-text-muted)" }}
        data-testid="button-back-list"
      >
        <ArrowLeft className="w-3 h-3" />
        Back to Contacts
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--lux-text)" }} data-testid="text-contact-name">
            {contact.firstName} {contact.lastName}
          </h1>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            {contact.lifecycleStage && RIBBON_STAGES.has(contact.lifecycleStage as LifecycleStage) && (
              <StatusRibbon stage={contact.lifecycleStage as LifecycleStage} />
            )}
            <FreshnessDot lastActivityAt={contact.lastActivityAt ?? null} showLabel />
          </div>
          <div className="text-sm mt-2 flex items-center gap-3 flex-wrap" style={{ color: "var(--lux-text-muted)" }}>
            {contact.title && <span data-testid="text-title"><Briefcase className="inline w-3 h-3 mr-1" />{contact.title}</span>}
            {contact.companyName && <span data-testid="text-company"><Building2 className="inline w-3 h-3 mr-1" />{contact.companyName}</span>}
            {contact.location && <span><MapPin className="inline w-3 h-3 mr-1" />{contact.location}</span>}
            {contactBrandName && (
              <span className="text-xs px-2 py-0.5 rounded" style={{ background: "var(--lux-bg)", border: "1px solid var(--lux-border)" }} data-testid="badge-brand">
                {contactBrandName}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {contact.clientId && (
            <Button asChild variant="outline" data-testid="link-view-billing-history">
              <Link href={`/clients/${contact.clientId}`}>
                <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                View billing history
              </Link>
            </Button>
          )}
          <Button onClick={() => setLogOpen(true)} data-testid="button-log-activity">
            <Plus className="w-4 h-4 mr-1.5" />
            Log activity
          </Button>
        </div>
      </div>

      {/* Brand-mismatch banner — fires when the contact's brand_id differs
          from the operator's active brand context. */}
      {brandMismatch && (
        <div
          className="mb-4 p-3 rounded-lg flex items-start gap-2 text-sm"
          style={{ background: "rgba(207,51,57,0.08)", border: "1px solid rgba(207,51,57,0.3)", color: "var(--lux-text)" }}
          data-testid="banner-brand-mismatch"
        >
          <AlertTriangle className="w-4 h-4 mt-0.5" style={{ color: "var(--lux-accent, #cf3339)" }} />
          <div>
            <strong>Brand mismatch:</strong> you are operating under{" "}
            <em>{activeBrand?.name}</em>, but this contact belongs to{" "}
            <em>{contactBrandName ?? contact.brandId}</em>. Switch your active brand if you intend to make changes.
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Left: editable form */}
        <ContactEditForm contact={contact} />

        {/* Right: day-grouped activity timeline */}
        <Card className="border-0 md:col-span-2" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
          <CardContent className="p-4">
            <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--lux-text)" }} data-testid="text-timeline-title">
              Activity Timeline
            </h2>
            <ActivityTimeline activities={activities} />
          </CardContent>
        </Card>
      </div>

      <LogActivityDialog
        open={logOpen}
        onOpenChange={setLogOpen}
        prospectId={contact.id}
        brandId={contact.brandId}
        onLogged={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/marketing/prospects", id, "activities"] });
          queryClient.invalidateQueries({ queryKey: ["/api/marketing/contacts", id] });
          queryClient.invalidateQueries({ queryKey: ["/api/marketing/contacts"] });
        }}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// ContactEditForm — left column. PATCH /api/marketing/contacts/:id on Save.
// ────────────────────────────────────────────────────────────────────────
function ContactEditForm({ contact }: { contact: ContactWithTags }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const tags = contact.tags ?? [];

  const defaults: ContactFormValues = useMemo(() => ({
    firstName:      contact.firstName ?? "",
    lastName:       contact.lastName ?? "",
    email:          contact.email ?? "",
    phone:          contact.phone ?? "",
    title:          contact.title ?? "",
    companyName:    contact.companyName ?? "",
    location:       contact.location ?? "",
    linkedinUrl:    contact.linkedinUrl ?? "",
    lifecycleStage: contact.lifecycleStage ?? "lead",
    leadStatus:     contact.leadStatus ?? "new",
    source:         contact.source ?? "",
    notes:          contact.notes ?? "",
    companyId:      contact.companyId ?? "",
  }), [contact]);

  const form = useForm<ContactFormValues>({ defaultValues: defaults });

  // Re-sync defaults when the contact data updates (e.g. after Log activity
  // appends a stage change).
  useEffect(() => { form.reset(defaults); }, [defaults]);

  const onSubmit = async (values: ContactFormValues) => {
    setBusy(true);
    try {
      // Empty strings become null so we don't store empty whitespace fields.
      // companyId is forwarded as-is (UUID or null) so a manual unlink works.
      const patch: Record<string, string | null> = {};
      (Object.keys(values) as (keyof ContactFormValues)[]).forEach((k) => {
        const v = values[k];
        patch[k] = typeof v === "string" && v.trim() === "" ? null : v;
      });
      await apiRequest("PATCH", `/api/marketing/contacts/${contact.id}`, patch);
      await queryClient.invalidateQueries({ queryKey: ["/api/marketing/contacts", contact.id] });
      await queryClient.invalidateQueries({ queryKey: ["/api/marketing/contacts"] });
      toast({ title: "Contact updated" });
    } catch (e: unknown) {
      toast({ title: "Update failed", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-0 md:col-span-1" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
      <CardContent className="p-4">
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3 text-sm" data-testid="form-edit-contact">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="f-first">First name</Label>
              <Input id="f-first" {...form.register("firstName", { required: true })} data-testid="input-edit-first-name" />
            </div>
            <div>
              <Label htmlFor="f-last">Last name</Label>
              <Input id="f-last" {...form.register("lastName", { required: true })} data-testid="input-edit-last-name" />
            </div>
          </div>
          <div>
            <Label htmlFor="f-email"><Mail className="inline w-3 h-3 mr-1" />Email</Label>
            <Input id="f-email" type="email" {...form.register("email")} data-testid="input-edit-email" />
          </div>
          <div>
            <Label htmlFor="f-phone">Phone</Label>
            <Input id="f-phone" {...form.register("phone")} data-testid="input-edit-phone" />
          </div>
          <div>
            <Label htmlFor="f-title">Title</Label>
            <Input id="f-title" {...form.register("title")} data-testid="input-edit-title" />
          </div>
          <div>
            <Label htmlFor="f-company">Company (free text)</Label>
            <Input id="f-company" {...form.register("companyName")} data-testid="input-edit-company" />
          </div>
          <div>
            <Label>Linked company</Label>
            <CompanyPicker
              brandId={contact.brandId}
              value={form.watch("companyId")}
              onChange={(id) => form.setValue("companyId", id ?? "", { shouldDirty: true })}
            />
          </div>
          <div>
            <Label htmlFor="f-location">Location</Label>
            <Input id="f-location" {...form.register("location")} data-testid="input-edit-location" />
          </div>
          <div>
            <Label htmlFor="f-linkedin">LinkedIn URL</Label>
            <Input id="f-linkedin" {...form.register("linkedinUrl")} data-testid="input-edit-linkedin" />
          </div>
          <div>
            <Label>Lifecycle stage</Label>
            <Select
              value={form.watch("lifecycleStage")}
              onValueChange={(v) => form.setValue("lifecycleStage", v, { shouldDirty: true })}
            >
              <SelectTrigger data-testid="select-edit-lifecycle"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LIFECYCLE_STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Lead status</Label>
            <Select
              value={form.watch("leadStatus")}
              onValueChange={(v) => form.setValue("leadStatus", v, { shouldDirty: true })}
            >
              <SelectTrigger data-testid="select-edit-lead-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LEAD_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="f-source">Source</Label>
            <Input
              id="f-source"
              value={contact.source ?? ""}
              readOnly
              disabled
              data-testid="input-edit-source"
            />
          </div>
          <div>
            <Label htmlFor="f-notes">Notes</Label>
            <Textarea id="f-notes" rows={3} {...form.register("notes")} data-testid="input-edit-notes" />
          </div>

          {tags.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wider mb-1" style={{ color: "var(--lux-text-muted)" }}>Tags</div>
              <div className="flex flex-wrap gap-1">
                {tags.map((t) => (
                  <span key={t.id} className="text-[11px] px-1.5 py-0.5 rounded text-white" style={{ background: t.color }} data-testid={`tag-${t.id}`}>
                    {t.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          <Button type="submit" disabled={busy || !form.formState.isDirty} className="w-full" data-testid="button-save-contact">
            <Save className="w-3.5 h-3.5 mr-1.5" />
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────────
// ActivityTimeline — groups by calendar day; each row's payload is
// collapsed by default and toggled with a chevron.
// ────────────────────────────────────────────────────────────────────────
function ActivityTimeline({ activities }: { activities: ContactActivity[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { toast } = useToast();
  const [deleting, setDeleting] = useState<string | null>(null);

  // Sprint 2f: hard-delete via DELETE /api/marketing/activities/:id. The
  // AlertDialog wrapper around the trash button enforces the confirm step
  // (R10) so a stray click never wipes a logged note.
  const onDelete = async (activityId: string) => {
    setDeleting(activityId);
    try {
      await apiRequest("DELETE", `/api/marketing/activities/${activityId}`);
      // Invalidate both the per-contact timeline AND the firehose so an
      // open firehose tab in another window picks up the deletion.
      const first = activities[0];
      if (first) {
        await queryClient.invalidateQueries({
          queryKey: ["/api/marketing/prospects", first.prospectId, "activities"],
        });
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/marketing/activities"] });
      toast({ title: "Activity deleted" });
    } catch (e: unknown) {
      toast({
        title: "Delete failed",
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      });
    } finally {
      setDeleting(null);
    }
  };

  const groups = useMemo(() => {
    const map = new Map<string, ContactActivity[]>();
    for (const a of activities) {
      // Sprint 2f: bucket by occurredAt (the canonical activity time)
      // rather than createdAt, which can drift for backdated rows.
      const k = dayKey(new Date(a.occurredAt ?? a.createdAt));
      const arr = map.get(k) ?? [];
      arr.push(a);
      map.set(k, arr);
    }
    // Map insertion preserves order; activities arrive desc so days arrive desc.
    return Array.from(map.entries());
  }, [activities]);

  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpanded(next);
  };

  if (activities.length === 0) {
    return (
      <div className="text-center py-8 text-sm" style={{ color: "var(--lux-text-muted)" }} data-testid="empty-state-activities">
        No activity yet. Log a note or wait for marketing events.
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="list-activities">
      {groups.map(([day, items]) => (
        <section key={day} data-testid={`day-group-${day}`}>
          <div className="text-xs uppercase tracking-wider mb-2" style={{ color: "var(--lux-text-muted)" }} data-testid={`day-label-${day}`}>
            {formatDayLabel(day)}
          </div>
          <ol className="space-y-2">
            {items.map((a) => {
              const meta = ACTIVITY_TYPE_LABELS[a.type] ?? { label: a.type, icon: ActivityIcon };
              const Icon = meta.icon;
              const payload = (a.payload ?? {}) as Record<string, any>;
              const hasPayload = Object.keys(payload).length > 0;
              const isOpen = expanded.has(a.id);
              return (
                <li key={a.id} className="flex gap-3" data-testid={`activity-${a.id}`}>
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: "var(--lux-bg)", border: "1px solid var(--lux-border)" }}
                  >
                    <Icon className="w-3.5 h-3.5" style={{ color: "var(--lux-text-muted)" }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <button
                      type="button"
                      onClick={() => hasPayload && toggle(a.id)}
                      className={`text-left w-full flex items-center gap-1.5 ${hasPayload ? "cursor-pointer" : "cursor-default"}`}
                      data-testid={`button-toggle-activity-${a.id}`}
                      disabled={!hasPayload}
                    >
                      {hasPayload && (
                        isOpen
                          ? <ChevronDown className="w-3 h-3" style={{ color: "var(--lux-text-muted)" }} />
                          : <ChevronRight className="w-3 h-3" style={{ color: "var(--lux-text-muted)" }} />
                      )}
                      <span className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>{meta.label}</span>
                      {payload.subject && (
                        <span className="text-sm truncate" style={{ color: "var(--lux-text-muted)" }}>
                          — {payload.subject}
                        </span>
                      )}
                      <span className="ml-auto text-[11px] shrink-0" style={{ color: "var(--lux-text-muted)" }}>
                        {new Date(a.occurredAt ?? a.createdAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                      </span>
                    </button>
                    <div className="mt-1">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <button
                            type="button"
                            disabled={deleting === a.id}
                            className="text-[11px] inline-flex items-center gap-1 underline disabled:opacity-50"
                            style={{ color: "var(--lux-text-muted)" }}
                            data-testid={`button-delete-activity-${a.id}`}
                          >
                            <Trash2 className="w-3 h-3" />
                            {deleting === a.id ? "Deleting…" : "Delete"}
                          </button>
                        </AlertDialogTrigger>
                        <AlertDialogContent data-testid="dialog-confirm-delete-activity">
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete this activity?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This permanently removes the entry from the contact's timeline and the brand firehose. This cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel data-testid="button-cancel-delete-activity">Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => onDelete(a.id)}
                              data-testid="button-confirm-delete-activity"
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                    {isOpen && hasPayload && (
                      <pre
                        className="mt-1 p-2 rounded text-[11px] overflow-x-auto whitespace-pre-wrap"
                        style={{ background: "var(--lux-bg)", border: "1px solid var(--lux-border)", color: "var(--lux-text)" }}
                        data-testid={`payload-${a.id}`}
                      >
                        {JSON.stringify(payload, null, 2)}
                      </pre>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// CompanyPicker — typeahead select for linking a contact to a company.
// Sprint 2b. Brand-scoped. Empty-string value clears the link.
// ────────────────────────────────────────────────────────────────────────
function CompanyPicker({
  brandId, value, onChange,
}: { brandId: string | null; value: string | null; onChange: (id: string | null) => void }) {
  const [search, setSearch] = useState("");
  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ["/api/marketing/companies", brandId, search, "picker"],
    enabled: isMarketingOsEnabled(),
    queryFn: async () => {
      const sp = new URLSearchParams();
      if (brandId) sp.set("brandId", brandId);
      if (search.trim()) sp.set("q", search.trim());
      sp.set("limit", "50");
      const res = await fetch(`/api/marketing/companies?${sp.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return json.rows as Company[];
    },
  });

  const selected = companies.find((c) => c.id === value);

  return (
    <div className="space-y-1">
      <Input
        placeholder="Search companies…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        data-testid="input-company-picker-search"
      />
      <Select
        value={value || "__none__"}
        onValueChange={(v) => onChange(v === "__none__" ? null : v)}
      >
        <SelectTrigger data-testid="select-company-picker">
          <SelectValue placeholder="No company linked">
            {selected ? selected.name : "No company linked"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__" data-testid="option-company-none">— No company —</SelectItem>
          {companies.map((c) => (
            <SelectItem key={c.id} value={c.id} data-testid={`option-company-${c.id}`}>
              {c.name}{c.domain ? ` (${c.domain})` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selected && (
        <Link
          href={`/marketing/companies/${selected.id}`}
          className="text-xs underline"
          style={{ color: "var(--lux-text-muted)" }}
          data-testid="link-view-linked-company"
        >
          View company →
        </Link>
      )}
    </div>
  );
}
