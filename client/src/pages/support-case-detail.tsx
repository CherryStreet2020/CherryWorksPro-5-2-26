import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/lib/use-document-title";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import TimeEntryDialog from "@/components/time/time-entry-dialog";
import type { ProjectOption, ServiceOption } from "@/components/time/utils";
import { Clock, MessageSquare, Lock, Send, Trash2, Pencil, Check, X, Building2, User as UserIcon, Paperclip, FileText, Eye, UserPlus } from "lucide-react";
import {
  type CaseDetail, type CaseStatus, type CasePriority, type CaseType, type CaseColleague, type SupportCaseIntake,
  STATUS_LABEL, PRIORITY_LABEL, CASE_STATUS_ORDER, CASE_PRIORITY_ORDER, IMPACT_LABEL, INTAKE_FIELD_LABELS, hoursLabel, relativeTime, fileSizeLabel,
} from "@/lib/support-cases";
import { useRef } from "react";
import { StatusChip, PriorityChip, SlaChip } from "@/pages/support-cases";

interface Agent { id: string; name: string }
interface PickerProject { id: string; name: string }

export default function SupportCaseDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const isManager = user?.role === "ADMIN" || user?.role === "MANAGER";

  const { data: c, isLoading, isError } = useQuery<CaseDetail>({
    queryKey: ["/api/support/cases", id],
    queryFn: async () => {
      const res = await fetch(`/api/support/cases/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled: !!id,
  });
  useDocumentTitle(c ? `${c.caseKey} · ${c.subject}` : "Support case");

  const { data: agents } = useQuery<Agent[]>({ queryKey: ["/api/support/agents"] });
  const { data: types } = useQuery<CaseType[]>({ queryKey: ["/api/support/types"] });
  const { data: projects } = useQuery<PickerProject[]>({
    queryKey: ["/api/support/clients", c?.clientId, "projects"],
    queryFn: () => fetch(`/api/support/clients/${c!.clientId}/projects`, { credentials: "include" }).then(r => r.json()),
    enabled: !!c?.clientId,
  });
  const { data: myProjects } = useQuery<ProjectOption[]>({ queryKey: ["/api/time-entries/my-projects"] });
  const { data: services } = useQuery<ServiceOption[]>({ queryKey: ["/api/services"] });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/support/cases", id] });
    queryClient.invalidateQueries({ queryKey: ["/api/support/cases"] });
    queryClient.invalidateQueries({ queryKey: ["/api/support/summary"] });
  };

  const patch = useMutation({
    mutationFn: async (body: Record<string, unknown>) => (await apiRequest("PATCH", `/api/support/cases/${id}`, body)).json(),
    onSuccess: invalidate,
    onError: (err: Error) => toast({ title: "Could not update the case", description: err.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });

  const [visibility, setVisibility] = useState<"CUSTOMER" | "INTERNAL">("CUSTOMER");
  const [body, setBody] = useState("");
  const post = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/support/cases/${id}/messages`, { body: body.trim(), visibility })).json(),
    onSuccess: () => { setBody(""); invalidate(); toast({ title: visibility === "INTERNAL" ? "Internal note added" : "Reply posted" }); },
    onError: (err: Error) => toast({ title: "Could not post", description: err.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });

  const { data: settings } = useQuery<{ portalShowHours: boolean }>({
    queryKey: ["/api/support/clients", c?.clientId, "settings"],
    queryFn: () => fetch(`/api/support/clients/${c!.clientId}/settings`, { credentials: "include" }).then(r => r.json()),
    enabled: !!c?.clientId && isManager,
  });
  const setShowHours = useMutation({
    mutationFn: async (on: boolean) => (await apiRequest("PATCH", `/api/support/clients/${c!.clientId}/settings`, { portalShowHours: on })).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/support/clients", c?.clientId, "settings"] }),
    onError: (err: Error) => toast({ title: "Could not update", description: err.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });
  const invite = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/support/contacts/${c!.requesterContactId}/portal-invite`)).json(),
    onSuccess: () => toast({ title: `Sign-in link sent to ${c?.requesterEmail}` }),
    onError: (err: Error) => toast({ title: "Could not send the link", description: err.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });

  const fileInput = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: async (files: FileList) => {
      const fd = new FormData();
      Array.from(files).forEach(f => fd.append("files", f));
      const { getCSRFToken, ensureCSRFToken } = await import("@/lib/queryClient");
      await ensureCSRFToken();
      const res = await fetch(`/api/support/cases/${id}/attachments`, { method: "POST", credentials: "include", headers: { "X-CSRF-Token": getCSRFToken() || "" }, body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || `${res.status}`);
      return data;
    },
    onSuccess: (rows: unknown[]) => { invalidate(); toast({ title: `${rows.length} file${rows.length === 1 ? "" : "s"} attached` }); if (fileInput.current) fileInput.current.value = ""; },
    onError: (err: Error) => toast({ title: "Upload failed", description: err.message, variant: "destructive" }),
  });
  const removeAttachment = useMutation({
    mutationFn: async (attId: string) => (await apiRequest("DELETE", `/api/support/attachments/${attId}`)).json(),
    onSuccess: () => invalidate(),
    onError: (err: Error) => toast({ title: "Could not remove the file", description: err.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });

  // Watchers: colleagues at the client who follow the case. The colleagues
  // endpoint already excludes the requester and current watchers.
  const [watcherToAdd, setWatcherToAdd] = useState("");
  const { data: colleagues } = useQuery<CaseColleague[]>({
    queryKey: ["/api/support/cases", id, "colleagues"],
    queryFn: async () => {
      const res = await fetch(`/api/support/cases/${id}/colleagues`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled: !!id && !!c,
  });
  const invalidateWatchers = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/support/cases", id] });
    queryClient.invalidateQueries({ queryKey: ["/api/support/cases", id, "colleagues"] });
  };
  const [watcherRole, setWatcherRole] = useState<"watcher" | "reviewer">("watcher");
  const addWatcher = useMutation({
    mutationFn: async (contactId: string) => (await apiRequest("POST", `/api/support/cases/${id}/watchers`, { contactId, role: watcherRole })).json(),
    onSuccess: () => { setWatcherToAdd(""); invalidateWatchers(); toast({ title: "Watcher added" }); },
    onError: (err: Error) => toast({ title: "Could not add the watcher", description: err.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });
  const removeWatcher = useMutation({
    mutationFn: async (contactId: string) => (await apiRequest("DELETE", `/api/support/cases/${id}/watchers/${contactId}`)).json(),
    onSuccess: () => { invalidateWatchers(); toast({ title: "Watcher removed" }); },
    onError: (err: Error) => toast({ title: "Could not remove the watcher", description: err.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", `/api/support/cases/${id}`)).json(),
    onSuccess: () => { invalidate(); toast({ title: `${c?.caseKey} deleted` }); navigate("/support/cases"); },
    onError: (err: Error) => toast({ title: "Could not delete", description: err.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });

  const [editingSubject, setEditingSubject] = useState(false);
  const [subjectDraft, setSubjectDraft] = useState("");
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState("");
  const [showLogTime, setShowLogTime] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => { if (c) { setSubjectDraft(c.subject); setDescDraft(c.description ?? ""); } }, [c]);

  // Time logged from the case defaults to the case's project; if the case has
  // no project, the first of the agent's projects for this client.
  const logTimeProject = useMemo(() => {
    if (!c) return undefined;
    if (c.projectId) return c.projectId;
    return myProjects?.find(p => p.clientName === c.clientName)?.id;
  }, [c, myProjects]);
  const logTimeService = useMemo(() => types?.find(t => t.id === c?.typeId)?.defaultServiceId ?? undefined, [types, c?.typeId]);

  const thread = useMemo(() => {
    if (!c) return [];
    const msgs = c.messages.map(m => ({ kind: "message" as const, at: m.createdAt, m }));
    const evs = c.events.filter(e => e.kind !== "created").map(e => ({ kind: "event" as const, at: e.createdAt, e }));
    return [...msgs, ...evs].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }, [c]);

  if (isLoading) {
    return (
      <div className="px-6 lg:px-8 xl:px-10 py-6 max-w-7xl mx-auto space-y-4">
        <Skeleton className="h-4 w-48 rounded" />
        <Skeleton className="h-9 w-2/3 rounded-lg" />
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
          <Skeleton className="h-96 rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      </div>
    );
  }
  if (isError || !c) {
    return (
      <div className="px-6 py-10 text-center">
        <p className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>That support case could not be found.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/support/cases")}>Back to Support Cases</Button>
      </div>
    );
  }

  const card = { background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" } as const;
  const muted = { color: "var(--lux-text-muted)" } as const;
  const fieldStyle = { borderColor: "var(--lux-border)", color: "var(--lux-text)" } as const;
  const t = c.time.totals;
  const intakeRows = intakeEntries(c.intake);
  const watchers = c.watchers ?? [];

  return (
    <div className="px-6 lg:px-8 xl:px-10 py-6 max-w-7xl mx-auto space-y-5">
      <PageBreadcrumbs page={c.caseKey} items={[{ label: "Dashboard", href: "/", withBackArrow: true }, { label: "Support Cases", href: "/support/cases" }]} showDashboard={false} />

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-bold" style={{ color: "var(--lux-accent)" }} data-testid="text-case-key">{c.caseKey}</span>
            <StatusChip status={c.status} />
            <PriorityChip priority={c.priority} />
            {c.typeName && <span className="text-xs" style={muted}>{c.typeName}</span>}
          </div>
          {editingSubject ? (
            <div className="flex items-center gap-2 mt-1.5">
              <Input value={subjectDraft} onChange={e => setSubjectDraft(e.target.value)} maxLength={300} className="text-lg font-semibold" style={fieldStyle} data-testid="input-edit-subject" autoFocus />
              <Button size="icon" variant="ghost" onClick={() => { patch.mutate({ subject: subjectDraft.trim() }); setEditingSubject(false); }} disabled={!subjectDraft.trim()} aria-label="Save subject"><Check className="w-4 h-4" /></Button>
              <Button size="icon" variant="ghost" onClick={() => { setSubjectDraft(c.subject); setEditingSubject(false); }} aria-label="Cancel"><X className="w-4 h-4" /></Button>
            </div>
          ) : (
            <h1 className="text-2xl font-bold tracking-tight mt-1 flex items-center gap-2 group" style={{ color: "var(--lux-text)" }} data-testid="text-case-subject">
              <span className="min-w-0">{c.subject}</span>
              <button className="opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => setEditingSubject(true)} aria-label="Edit subject" data-testid="button-edit-subject"><Pencil className="w-4 h-4" style={muted} /></button>
            </h1>
          )}
          <p className="text-sm mt-1 flex items-center gap-3 flex-wrap" style={muted}>
            <span className="inline-flex items-center gap-1"><Building2 className="w-3.5 h-3.5" /> {c.clientName}</span>
            {c.requesterName && <span className="inline-flex items-center gap-1"><UserIcon className="w-3.5 h-3.5" /> {c.requesterName}{c.requesterEmail ? ` · ${c.requesterEmail}` : ""}</span>}
            <span>Opened {relativeTime(c.createdAt)}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button className="text-white" onClick={() => setShowLogTime(true)} disabled={!logTimeProject} title={logTimeProject ? undefined : "Add a project to this case (or join one for this client) to log time"} style={{ background: "var(--gradient-brand)" }} data-testid="button-log-time-on-case">
            <Clock className="w-4 h-4 mr-2" /> Log time
          </Button>
          {isManager && (
            <Button variant="outline" size="icon" onClick={() => setConfirmDelete(true)} aria-label="Delete case" data-testid="button-delete-case"><Trash2 className="w-4 h-4" /></Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
        <div className="space-y-5 min-w-0">
          <section className="rounded-2xl p-5 border-0" style={card}>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-[11px] font-bold uppercase tracking-wider" style={muted}>Description</h2>
              {!editingDesc && <button className="text-xs underline" style={muted} onClick={() => setEditingDesc(true)} data-testid="button-edit-description">Edit</button>}
            </div>
            {editingDesc ? (
              <div className="space-y-2">
                <Textarea value={descDraft} onChange={e => setDescDraft(e.target.value)} rows={6} style={fieldStyle} data-testid="input-edit-description" />
                <div className="flex gap-2 justify-end">
                  <Button size="sm" variant="outline" onClick={() => { setDescDraft(c.description ?? ""); setEditingDesc(false); }}>Cancel</Button>
                  <Button size="sm" className="text-white" style={{ background: "var(--gradient-brand)" }} onClick={() => { patch.mutate({ description: descDraft.trim() || null }); setEditingDesc(false); }}>Save</Button>
                </div>
              </div>
            ) : (
              <p className="text-sm whitespace-pre-wrap leading-relaxed" style={{ color: c.description ? "var(--lux-text)" : "var(--lux-text-muted)" }} data-testid="text-case-description">
                {c.description ? renderWithAttachmentMarkers(c.description, c.attachments) : "No description yet."}
              </p>
            )}
          </section>

          {intakeRows.length > 0 && (
            <section className="rounded-2xl p-5 border-0" style={card} data-testid="case-intake-card">
              <h2 className="text-[11px] font-bold uppercase tracking-wider mb-3" style={muted}>Customer intake</h2>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                {intakeRows.map(([key, label, value]) => (
                  <div key={key} className={key === "stepsToReproduce" || key === "expected" ? "sm:col-span-2" : ""} data-testid={`case-intake-${key}`}>
                    <dt className="text-[11px] font-medium mb-0.5" style={muted}>{label}</dt>
                    <dd className="whitespace-pre-wrap leading-relaxed" style={{ color: "var(--lux-text)" }}>{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          <section className="rounded-2xl p-5 border-0" style={card} data-testid="card-case-attachments">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[11px] font-bold uppercase tracking-wider" style={muted}>Attachments{c.attachments.length ? ` (${c.attachments.length})` : ""}</h2>
              <div>
                <input ref={fileInput} type="file" multiple className="hidden" onChange={e => { if (e.target.files?.length) upload.mutate(e.target.files); }} data-testid="input-case-files" />
                <Button size="sm" variant="outline" onClick={() => fileInput.current?.click()} disabled={upload.isPending} data-testid="button-attach-files">
                  <Paperclip className="w-3.5 h-3.5 mr-1.5" /> {upload.isPending ? "Uploading…" : "Attach files"}
                </Button>
              </div>
            </div>
            {c.attachments.length === 0 ? (
              <p className="text-xs" style={muted}>No files yet. Screenshots, PDFs and spreadsheets up to 15 MB.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {c.attachments.map(a => (
                  <figure key={a.id} className="group relative rounded-xl overflow-hidden border" style={{ borderColor: "var(--lux-border)", background: "var(--lux-surface-alt)" }} data-testid={`attachment-${a.id}`}>
                    <a href={a.url} target="_blank" rel="noopener" className="block">
                      {a.isImage ? (
                        <img src={a.url} alt={a.filename} className="w-full h-36 object-cover" loading="lazy" />
                      ) : (
                        <div className="h-36 flex items-center justify-center"><FileText className="w-8 h-8" style={muted} /></div>
                      )}
                    </a>
                    <figcaption className="px-2.5 py-2 text-[11px] flex items-center justify-between gap-2">
                      <span className="truncate" style={{ color: "var(--lux-text)" }} title={a.filename}>{a.filename}</span>
                      <span className="whitespace-nowrap" style={muted}>{fileSizeLabel(a.size)}</span>
                    </figcaption>
                    <button className="absolute top-1.5 right-1.5 rounded-md px-1.5 py-1 opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: "rgba(0,0,0,0.55)", color: "#fff" }} onClick={() => removeAttachment.mutate(a.id)} aria-label={`Remove ${a.filename}`} data-testid={`button-remove-attachment-${a.id}`}>
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </figure>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-2xl p-5 border-0" style={card}>
            <h2 className="text-[11px] font-bold uppercase tracking-wider mb-4" style={muted}>Conversation</h2>
            {thread.length === 0 ? (
              <p className="text-sm py-4 text-center" style={muted}>No messages yet. Reply to the customer or leave an internal note below.</p>
            ) : (
              <ol className="space-y-3" data-testid="list-case-thread">
                {thread.map(item => item.kind === "event" ? (
                  <li key={item.e.id} className="text-xs flex items-center gap-2 px-1" style={muted}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--lux-border-strong)" }} />
                    <span>{describeEvent(item.e.kind, item.e.fromValue, item.e.toValue, agents)}{item.e.actorName ? ` · ${item.e.actorName}` : ""}</span>
                    <span className="ml-auto">{relativeTime(item.e.createdAt)}</span>
                  </li>
                ) : (
                  <li
                    key={item.m.id}
                    className="rounded-xl p-4"
                    style={item.m.visibility === "INTERNAL"
                      ? { background: "rgba(184,148,46,0.08)", border: "1px dashed rgba(184,148,46,0.45)" }
                      : item.m.authorUserId
                        ? { background: "var(--lux-surface-alt)", border: "1px solid var(--lux-border)" }
                        : { background: "rgba(var(--lux-accent-rgb),0.06)", border: "1px solid rgba(var(--lux-accent-rgb),0.25)" }}
                    data-testid={`message-${item.m.visibility.toLowerCase()}`}
                  >
                    <div className="flex items-center gap-2 text-xs mb-1.5">
                      <span className="font-semibold" style={{ color: "var(--lux-text)" }}>{item.m.authorName}</span>
                      {item.m.visibility === "INTERNAL" ? (
                        <span className="inline-flex items-center gap-1 font-semibold" style={{ color: "var(--lux-gold)" }}><Lock className="w-3 h-3" /> Internal note</span>
                      ) : item.m.authorUserId ? (
                        <span style={muted}>replied to customer</span>
                      ) : (
                        <span style={muted}>customer</span>
                      )}
                      <span className="ml-auto" style={muted}>{new Date(item.m.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap leading-relaxed" style={{ color: "var(--lux-text)" }}>{renderWithAttachmentMarkers(item.m.body, c.attachments)}</p>
                  </li>
                ))}
              </ol>
            )}

            <form className="mt-5 space-y-2" onSubmit={e => { e.preventDefault(); if (body.trim()) post.mutate(); }}>
              <div className="flex items-center gap-1.5">
                {(["CUSTOMER", "INTERNAL"] as const).map(v => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setVisibility(v)}
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
                    style={visibility === v ? { background: "var(--lux-text)", color: "var(--lux-surface)" } : { background: "var(--lux-surface)", color: "var(--lux-text-secondary)", border: "1px solid var(--lux-border)" }}
                    data-testid={`toggle-visibility-${v.toLowerCase()}`}
                  >
                    {v === "CUSTOMER" ? <MessageSquare className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                    {v === "CUSTOMER" ? "Reply to customer" : "Internal note"}
                  </button>
                ))}
              </div>
              <Textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                rows={4}
                placeholder={visibility === "CUSTOMER" ? "Write to the customer — they see this in the Help Center and by email" : "Notes for the team only — the customer never sees this"}
                style={{ ...fieldStyle, ...(visibility === "INTERNAL" ? { background: "rgba(184,148,46,0.06)" } : {}) }}
                data-testid="input-message-body"
              />
              <div className="flex justify-end">
                <Button
                  type="submit"
                  disabled={!body.trim() || post.isPending}
                  // Internal notes are amber like their label; the customer reply keeps the brand gradient.
                  // (The text-colour token was used as a background here — near-white under white text in dark mode.)
                  style={visibility === "INTERNAL" ? { background: "#b8942e", color: "#0b0f14" } : { background: "var(--gradient-brand)", color: "#fff" }}
                  data-testid="button-post-message"
                >
                  <Send className="w-4 h-4 mr-2" /> {visibility === "INTERNAL" ? "Add note" : "Send reply"}
                </Button>
              </div>
            </form>
          </section>
        </div>

        <aside className="space-y-5">
          <section className="rounded-2xl p-5 border-0 space-y-3" style={card}>
            <h2 className="text-[11px] font-bold uppercase tracking-wider" style={muted}>Properties</h2>
            <Field label="Status">
              <Select value={c.status} onValueChange={v => patch.mutate({ status: v as CaseStatus })}>
                <SelectTrigger style={fieldStyle} data-testid="select-status"><SelectValue /></SelectTrigger>
                <SelectContent>{CASE_STATUS_ORDER.map(s => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Priority">
              <Select value={c.priority} onValueChange={v => patch.mutate({ priority: v as CasePriority })}>
                <SelectTrigger style={fieldStyle} data-testid="select-priority"><SelectValue /></SelectTrigger>
                <SelectContent>{CASE_PRIORITY_ORDER.map(p => <SelectItem key={p} value={p}>{PRIORITY_LABEL[p]}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Assignee">
              <Select value={c.assigneeUserId ?? "__none__"} onValueChange={v => patch.mutate({ assigneeUserId: v === "__none__" ? null : v })}>
                <SelectTrigger style={fieldStyle} data-testid="select-assignee"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Unassigned</SelectItem>
                  {agents?.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Type">
              <Select value={c.typeId ?? "__none__"} onValueChange={v => patch.mutate({ typeId: v === "__none__" ? null : v })}>
                <SelectTrigger style={fieldStyle} data-testid="select-type"><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {types?.map(x => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Project">
              <Select value={c.projectId ?? "__none__"} onValueChange={v => patch.mutate({ projectId: v === "__none__" ? null : v })}>
                <SelectTrigger style={fieldStyle} data-testid="select-project"><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {projects?.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            {c.externalRef && <Field label="Imported from"><p className="text-xs" style={muted}>{c.externalRef}</p></Field>}
          </section>

          <section className="rounded-2xl p-5 border-0" style={card} data-testid="card-case-hours">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[11px] font-bold uppercase tracking-wider" style={muted}>Hours on this case</h2>
              <button className="text-xs underline" style={muted} onClick={() => setShowLogTime(true)} disabled={!logTimeProject}>Log time</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Logged" value={hoursLabel(t.minutes)} />
              <Stat label="Billable" value={hoursLabel(t.billableMinutes)} />
              <Stat label="Unbilled" value={hoursLabel(t.unbilledMinutes)} accent />
              <Stat label="Invoiced" value={hoursLabel(t.invoicedMinutes)} />
            </div>
            {c.time.entries.length > 0 && (
              <ul className="mt-4 space-y-2 max-h-72 overflow-y-auto pr-1" data-testid="list-case-time">
                {c.time.entries.map(e => (
                  <li key={e.id} className="text-xs flex items-start justify-between gap-2 border-t pt-2" style={{ borderColor: "var(--lux-border)" }}>
                    <div className="min-w-0">
                      <p className="font-medium truncate" style={{ color: "var(--lux-text)" }}>{e.userName} <span style={muted}>· {new Date(e.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span></p>
                      <p className="truncate" style={muted}>{e.notes || e.serviceName || e.projectName}</p>
                    </div>
                    <div className="text-right whitespace-nowrap">
                      <p className="font-semibold tabular-nums" style={{ color: "var(--lux-text)" }}>{hoursLabel(e.minutes)}</p>
                      <p style={muted}>{e.invoiced ? "invoiced" : e.billable ? "unbilled" : "non-billable"}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl p-5 border-0" style={card} data-testid="card-case-portal">
            <h2 className="text-[11px] font-bold uppercase tracking-wider mb-2" style={muted}>Customer portal</h2>
            {c.requesterContactId && c.requesterEmail ? (
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs" style={muted}>{c.requesterName} can sign in with a one-time link.</p>
                <Button size="sm" variant="outline" onClick={() => invite.mutate()} disabled={invite.isPending} data-testid="button-send-portal-link">
                  {invite.isPending ? "Sending…" : "Send sign-in link"}
                </Button>
              </div>
            ) : (
              <p className="text-xs" style={muted}>Set a saved contact with an email as the requester to invite them to the portal.</p>
            )}
            {isManager && (
              <label className="mt-3 flex items-center gap-2 text-xs cursor-pointer" style={{ color: "var(--lux-text)" }}>
                <input type="checkbox" checked={!!settings?.portalShowHours} onChange={e => setShowHours.mutate(e.target.checked)} data-testid="toggle-portal-show-hours" />
                Customers at {c.clientName} see hours on their cases
              </label>
            )}
          </section>

          <section className="rounded-2xl p-5 border-0" style={card} data-testid="case-watchers-card">
            <h2 className="text-[11px] font-bold uppercase tracking-wider mb-2" style={muted}>Watchers{watchers.length ? ` (${watchers.length})` : ""}</h2>
            {watchers.length === 0 ? (
              <p className="text-xs" style={muted}>No colleagues are following this case yet.</p>
            ) : (
              <ul className="space-y-1.5" data-testid="list-case-watchers">
                {watchers.map(w => (
                  <li key={w.id} className="text-xs flex items-center justify-between gap-2" data-testid={`watcher-row-${w.contactId}`}>
                    <div className="min-w-0 flex items-center gap-1.5">
                      <Eye className="w-3.5 h-3.5 shrink-0" style={muted} />
                      <div className="min-w-0">
                        <p className="font-medium truncate" style={{ color: "var(--lux-text)" }}>{w.firstName} {w.lastName}{w.role === "reviewer" && <span className="font-normal" style={muted}> · review only</span>}</p>
                        {w.email && <p className="truncate" style={muted}>{w.email}</p>}
                      </div>
                    </div>
                    <button className="shrink-0 rounded-md p-1" style={muted} onClick={() => removeWatcher.mutate(w.contactId)} disabled={removeWatcher.isPending} aria-label={`Remove ${w.firstName} ${w.lastName} as a watcher`} data-testid={`watcher-remove-${w.contactId}`}>
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex items-center gap-2">
              <Select value={watcherRole} onValueChange={v => setWatcherRole(v as "watcher" | "reviewer")}>
                <SelectTrigger className="w-[128px] text-xs" style={fieldStyle} data-testid="watcher-add-role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="watcher">Can reply</SelectItem>
                  <SelectItem value="reviewer">Review only</SelectItem>
                </SelectContent>
              </Select>
              <Select value={watcherToAdd} onValueChange={setWatcherToAdd} disabled={!colleagues?.length}>
                <SelectTrigger className="flex-1 text-xs" style={fieldStyle} data-testid="watcher-add-select">
                  <SelectValue placeholder={colleagues?.length ? "Add colleague" : "No other contacts at this client"} />
                </SelectTrigger>
                <SelectContent>
                  {colleagues?.map(p => <SelectItem key={p.id} value={p.id}>{p.firstName} {p.lastName}{p.email ? ` · ${p.email}` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" onClick={() => { if (watcherToAdd) addWatcher.mutate(watcherToAdd); }} disabled={!watcherToAdd || addWatcher.isPending} aria-label="Add watcher" data-testid="watcher-add-button">
                <UserPlus className="w-3.5 h-3.5 mr-1.5" /> {addWatcher.isPending ? "Adding…" : "Add"}
              </Button>
            </div>
          </section>

          <section className="rounded-2xl p-5 border-0" style={card} data-testid="card-case-sla">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-[11px] font-bold uppercase tracking-wider" style={muted}>Service level</h2>
              <SlaChip sla={c.sla} />
            </div>
            <dl className="text-xs space-y-1.5">
              <Row k="First response" v={c.firstResponseAt ? `met ${relativeTime(c.firstResponseAt)}` : c.firstResponseDueAt ? `due ${new Date(c.firstResponseDueAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "no target"} />
              <Row k="Resolution" v={c.resolvedAt ? `met ${relativeTime(c.resolvedAt)}` : c.resolutionDueAt ? `due ${new Date(c.resolutionDueAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "no target"} />
              {c.slaPausedAt && <Row k="Clocks" v="paused while waiting on customer" />}
            </dl>
          </section>

          <section className="rounded-2xl p-5 border-0" style={card}>
            <h2 className="text-[11px] font-bold uppercase tracking-wider mb-2" style={muted}>Timeline</h2>
            <dl className="text-xs space-y-1.5">
              <Row k="Opened" v={new Date(c.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} />
              <Row k="First response" v={c.firstResponseAt ? relativeTime(c.firstResponseAt) : "not yet"} />
              <Row k="Last customer message" v={c.lastCustomerMessageAt ? relativeTime(c.lastCustomerMessageAt) : "—"} />
              <Row k="Last reply" v={c.lastAgentMessageAt ? relativeTime(c.lastAgentMessageAt) : "—"} />
              {c.resolvedAt && <Row k="Resolved" v={relativeTime(c.resolvedAt)} />}
              {c.closedAt && <Row k="Closed" v={relativeTime(c.closedAt)} />}
            </dl>
          </section>
        </aside>
      </div>

      <TimeEntryDialog
        open={showLogTime}
        onOpenChange={(o) => { setShowLogTime(o); if (!o) invalidate(); }}
        myProjects={myProjects}
        services={services}
        defaultProjectId={logTimeProject}
        defaultServiceId={logTimeService}
        defaultNotes={`${c.caseKey} - `}
        supportCase={{ id: c.id, caseKey: c.caseKey, subject: c.subject }}
      />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {c.caseKey}?</AlertDialogTitle>
            <AlertDialogDescription>
              The conversation and history are removed. Time already logged on this case stays on the books; it just loses the case link.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => del.mutate()} data-testid="button-confirm-delete-case">Delete case</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-medium mb-1" style={{ color: "var(--lux-text-muted)" }}>{label}</p>
      {children}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg px-3 py-2" style={{ background: "var(--lux-surface-alt)", border: "1px solid var(--lux-border)" }}>
      <p className="text-[10px] uppercase tracking-wider font-bold" style={{ color: "var(--lux-text-muted)" }}>{label}</p>
      <p className="text-base font-bold tabular-nums" style={{ color: accent ? "var(--lux-accent)" : "var(--lux-text)" }}>{value}</p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt style={{ color: "var(--lux-text-muted)" }}>{k}</dt>
      <dd className="text-right" style={{ color: "var(--lux-text)" }}>{v}</dd>
    </div>
  );
}

function describeEvent(kind: string, from: string | null, to: string | null, agents?: Agent[]): string {
  const name = (id: string | null) => (id ? agents?.find(a => a.id === id)?.name ?? "someone" : "unassigned");
  switch (kind) {
    case "status": return `Status ${from ? STATUS_LABEL[from as CaseStatus] ?? from : "—"} → ${to ? STATUS_LABEL[to as CaseStatus] ?? to : "—"}`;
    case "assignee": return `Assigned to ${name(to)}${from ? ` (was ${name(from)})` : ""}`;
    case "priority": return `Priority ${from ? PRIORITY_LABEL[from as CasePriority] ?? from : "—"} → ${to ? PRIORITY_LABEL[to as CasePriority] ?? to : "—"}`;
    case "type": return "Type changed";
    case "project": return "Project changed";
    case "watcher": return `${from === "removed" ? "Removed" : "Added"} ${to || "a colleague"} as a watcher`;
    default: return kind;
  }
}

/** Filled intake fields as [key, label, display value], in INTAKE_FIELD_LABELS order. */
function intakeEntries(intake: SupportCaseIntake | null | undefined): [keyof SupportCaseIntake, string, string][] {
  if (!intake) return [];
  const out: [keyof SupportCaseIntake, string, string][] = [];
  for (const key of Object.keys(INTAKE_FIELD_LABELS) as (keyof SupportCaseIntake)[]) {
    const raw = intake[key];
    if (raw === undefined || raw === null || raw === "") continue;
    const value = key === "impact" ? (IMPACT_LABEL[raw as keyof typeof IMPACT_LABEL] ?? String(raw)) : String(raw);
    out.push([key, INTAKE_FIELD_LABELS[key], value]);
  }
  return out;
}


/**
 * Imported Jira text carries "[attachment: name]" (or a bare "[attachment]")
 * where an inline image was. When the named file is on the case, show it
 * inline; otherwise a quiet marker pointing at the Attachments card.
 */
function renderWithAttachmentMarkers(text: string, attachments: CaseDetail["attachments"] = []): React.ReactNode {
  const re = /\[attachment(?::\s*([^\]]+))?\]/g;
  if (!re.test(text)) return text;
  re.lastIndex = 0;
  const out: React.ReactNode[] = [];
  let last = 0; let i = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const name = m[1]?.trim();
    const att = name ? attachments.find(a => a.filename === name || a.filename === name.replace(/[^\w.\- ()]+/g, "_")) : undefined;
    if (att && att.isImage) {
      out.push(<a key={`a${i++}`} href={att.url} target="_blank" rel="noopener" className="block my-2"><img src={att.url} alt={att.filename} className="max-h-72 rounded-lg border" style={{ borderColor: "var(--lux-border)" }} loading="lazy" /></a>);
    } else if (att) {
      out.push(<a key={`a${i++}`} href={att.url} target="_blank" rel="noopener" className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] align-middle" style={{ background: "var(--lux-surface-alt)", color: "var(--lux-accent)", border: "1px solid var(--lux-border)" }}><Paperclip className="w-3 h-3" /> {att.filename}</a>);
    } else {
      out.push(<span key={`m${i++}`} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] align-middle" style={{ background: "var(--lux-surface-alt)", color: "var(--lux-text-muted)", border: "1px solid var(--lux-border)" }}><Paperclip className="w-3 h-3" /> {name ? name : "see attachments"}</span>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
