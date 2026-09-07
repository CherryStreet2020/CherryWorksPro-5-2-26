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
import { Clock, MessageSquare, Lock, Send, Trash2, Pencil, Check, X, Building2, User as UserIcon } from "lucide-react";
import {
  type CaseDetail, type CaseStatus, type CasePriority, type CaseType,
  STATUS_LABEL, PRIORITY_LABEL, CASE_STATUS_ORDER, CASE_PRIORITY_ORDER, hoursLabel, relativeTime,
} from "@/lib/support-cases";
import { StatusChip, PriorityChip } from "@/pages/support-cases";

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
                {c.description || "No description yet."}
              </p>
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
                    <p className="text-sm whitespace-pre-wrap leading-relaxed" style={{ color: "var(--lux-text)" }}>{item.m.body}</p>
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
                placeholder={visibility === "CUSTOMER" ? "Write to the customer… (this will be visible on the portal and in email once those ship)" : "Notes for the team only — the customer never sees this"}
                style={{ ...fieldStyle, ...(visibility === "INTERNAL" ? { background: "rgba(184,148,46,0.06)" } : {}) }}
                data-testid="input-message-body"
              />
              <div className="flex justify-end">
                <Button type="submit" className="text-white" disabled={!body.trim() || post.isPending} style={{ background: visibility === "INTERNAL" ? "var(--lux-text)" : "var(--gradient-brand)" }} data-testid="button-post-message">
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
    default: return kind;
  }
}

