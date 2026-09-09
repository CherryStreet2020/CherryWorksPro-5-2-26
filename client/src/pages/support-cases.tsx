import { useMemo, useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/lib/use-document-title";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { PageHelpLink } from "@/components/page-help-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LifeBuoy, Plus, Search, Inbox, UserCircle2, Hourglass, CheckCircle2, Layers, AlarmClock, Settings2, Ban } from "lucide-react";
import {
  type CaseListRow, type CaseView, type CaseType, type CasePriority,
  STATUS_LABEL, STATUS_COLOR, PRIORITY_LABEL, PRIORITY_COLOR, CASE_PRIORITY_ORDER, hoursLabel, relativeTime,
} from "@/lib/support-cases";

export function StatusChip({ status }: { status: CaseListRow["status"] }) {
  const [fg, bg] = STATUS_COLOR[status] ?? STATUS_COLOR.NEW;
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap" style={{ color: fg, background: bg }} data-testid={`chip-status-${status}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function PriorityChip({ priority }: { priority: CaseListRow["priority"] }) {
  const [fg, bg] = PRIORITY_COLOR[priority] ?? PRIORITY_COLOR.MEDIUM;
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap" style={{ color: fg, background: bg }} data-testid={`chip-priority-${priority}`}>
      {PRIORITY_LABEL[priority] ?? priority}
    </span>
  );
}

const VIEWS: { key: CaseView; label: string; icon: any; countKey: "open" | "mine" | "unassigned" | "waiting" | "blocked" | "breaching" | "resolved" | "all" }[] = [
  { key: "open", label: "All open", icon: Inbox, countKey: "open" },
  { key: "mine", label: "Assigned to me", icon: UserCircle2, countKey: "mine" },
  { key: "unassigned", label: "Unassigned", icon: Layers, countKey: "unassigned" },
  { key: "waiting", label: "Waiting on customer", icon: Hourglass, countKey: "waiting" },
  { key: "blocked", label: "Blocked", icon: Ban, countKey: "blocked" },
  { key: "breaching", label: "Breaching soon", icon: AlarmClock, countKey: "breaching" },
  { key: "resolved", label: "Resolved", icon: CheckCircle2, countKey: "resolved" },
  { key: "all", label: "All", icon: LifeBuoy, countKey: "all" },
];

interface Summary { open: number; mine: number; unassigned: number; waiting: number; blocked: number; breaching: number; resolved: number; all: number }

export function SlaChip({ sla }: { sla?: CaseListRow["sla"] }) {
  if (!sla || !sla.label) return <span className="text-xs" style={{ color: "var(--lux-text-muted)" }}>—</span>;
  const active = sla.firstResponse === "met" || sla.firstResponse === "none" ? sla.resolution : sla.firstResponse;
  const color = active === "breached" ? "#b91c1c" : active === "warning" ? "#b45309" : active === "paused" ? "var(--lux-text-muted)" : "var(--lux-text-secondary)";
  const bg = active === "breached" ? "rgba(185,28,28,0.12)" : active === "warning" ? "rgba(180,83,9,0.14)" : "transparent";
  return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap tabular-nums" style={{ color, background: bg }} data-testid={`chip-sla-${active}`}>{sla.label}</span>;
}

export default function SupportCasesPage() {
  useDocumentTitle("Support Cases");
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const [view, setView] = useState<CaseView>("open");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const { data: summary } = useQuery<Summary>({ queryKey: ["/api/support/summary"] });
  const listKey = ["/api/support/cases", { view, q: debouncedQ }] as const;
  const { data: rows, isLoading } = useQuery<CaseListRow[]>({
    queryKey: listKey,
    queryFn: async () => {
      const params = new URLSearchParams({ view });
      if (debouncedQ) params.set("q", debouncedQ);
      const res = await fetch(`/api/support/cases?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });

  const isManager = user?.role === "ADMIN" || user?.role === "MANAGER";

  return (
    <div className="px-6 lg:px-8 xl:px-10 py-6 max-w-7xl mx-auto space-y-6">
      <PageBreadcrumbs group="Support" page="Support Cases" />
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(var(--lux-accent-rgb),0.15) 0%, rgba(var(--lux-accent-rgb),0.05) 100%)" }}>
            <LifeBuoy className="w-6 h-6" style={{ color: "var(--lux-accent)" }} />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--lux-text)" }} data-testid="text-support-cases-title">Support Cases</h1>
              <PageHelpLink />
            </div>
            <p className="text-sm mt-0.5" style={{ color: "var(--lux-text-muted)" }}>
              Client requests the team is working on. Log time on a case and it flows to the invoice.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-5">
            {([["open", "Open"], ["mine", "Mine"], ["unassigned", "Unassigned"]] as const).map(([k, label]) => (
              <div key={k} className="text-center">
                <p className="text-2xl font-bold tabular-nums" style={{ color: "var(--lux-text)" }} data-testid={`text-count-${k}`}>{summary?.[k] ?? "–"}</p>
                <p className="text-[10px] uppercase tracking-wider font-bold" style={{ color: "var(--lux-text-muted)" }}>{label}</p>
              </div>
            ))}
          </div>
          {isManager && (
            <Button variant="outline" size="icon" onClick={() => navigate("/support/settings")} aria-label="Support settings" data-testid="button-support-settings"><Settings2 className="w-4 h-4" /></Button>
          )}
          <Button className="text-white" onClick={() => setShowNew(true)} data-testid="button-new-case" style={{ background: "var(--gradient-brand)" }}>
            <Plus className="w-4 h-4 mr-2" /> New support case
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap" role="tablist" aria-label="Case views">
          {VIEWS.map(v => {
            const active = view === v.key;
            const Icon = v.icon;
            return (
              <button
                key={v.key}
                role="tab"
                aria-selected={active}
                onClick={() => setView(v.key)}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors"
                style={active
                  ? { background: "var(--lux-text)", color: "var(--lux-surface)" }
                  : { background: "var(--lux-surface)", color: "var(--lux-text-secondary)", border: "1px solid var(--lux-border)" }}
                data-testid={`tab-view-${v.key}`}
              >
                <Icon className="w-3.5 h-3.5" />
                {v.label}
                <span className="tabular-nums opacity-70">{summary?.[v.countKey] ?? ""}</span>
              </button>
            );
          })}
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--lux-text-muted)" }} />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search key, subject, client, requester" className="pl-9" style={{ borderColor: "var(--lux-border)", color: "var(--lux-text)" }} data-testid="input-case-search" />
        </div>
      </div>

      <div className="rounded-2xl border-0 overflow-hidden" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
        {isLoading ? (
          <div className="p-4 space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
        ) : !rows || rows.length === 0 ? (
          <div className="text-center py-14 px-6">
            <LifeBuoy className="w-8 h-8 mx-auto mb-3" style={{ color: "var(--lux-text-muted)" }} />
            <p className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>{debouncedQ ? "No cases match that search" : "No cases in this view"}</p>
            <p className="text-xs mt-1" style={{ color: "var(--lux-text-muted)" }}>Open one with the button above, or switch views.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "var(--lux-table-header-bg)" }}>
                  {["Key", "Subject", "Type", "Priority", "Status", "Assignee", "SLA", "Hours", "Updated"].map(h => (
                    <th key={h} className={`px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider ${h === "Hours" ? "text-right" : "text-left"}`} style={{ color: "var(--lux-text-muted)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr
                    key={r.id}
                    className="border-t cursor-pointer transition-colors"
                    style={{ borderColor: "var(--lux-border)" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "var(--lux-table-hover)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "")}
                    onClick={() => navigate(`/support/cases/${r.id}`)}
                    data-testid={`row-case-${r.caseKey}`}
                  >
                    <td className="px-4 py-3 font-mono text-xs font-semibold whitespace-nowrap" style={{ color: "var(--lux-accent)" }}>{r.caseKey}</td>
                    <td className="px-4 py-3 min-w-[260px]">
                      <p className="font-medium leading-snug" style={{ color: "var(--lux-text)" }}>{r.subject}</p>
                      <p className="text-xs mt-0.5" style={{ color: "var(--lux-text-muted)" }}>
                        {r.clientName}{r.requesterName ? ` · ${r.requesterName}` : ""}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: "var(--lux-text-secondary)" }}>{r.typeName ?? "—"}</td>
                    <td className="px-4 py-3"><PriorityChip priority={r.priority} /></td>
                    <td className="px-4 py-3"><StatusChip status={r.status} /></td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: r.assigneeName ? "var(--lux-text)" : "var(--lux-text-muted)" }}>{r.assigneeName ?? "Unassigned"}</td>
                    <td className="px-4 py-3"><SlaChip sla={r.sla} /></td>
                    <td className="px-4 py-3 text-right tabular-nums text-xs font-medium whitespace-nowrap" style={{ color: "var(--lux-text)" }}>{hoursLabel(r.minutesLogged)}</td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: "var(--lux-text-muted)" }}>{relativeTime(r.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <NewCaseDialog open={showNew} onOpenChange={setShowNew} isManager={isManager} onCreated={(id) => navigate(`/support/cases/${id}`)} />
    </div>
  );
}

interface PickerClient { id: string; name: string }
interface PickerProject { id: string; name: string }
interface PickerContact { id: string; firstName: string; lastName: string; email: string | null }
interface Agent { id: string; name: string }

export function NewCaseDialog({ open, onOpenChange, onCreated, defaultClientId }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void; isManager?: boolean; defaultClientId?: string }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [clientId, setClientId] = useState(defaultClientId ?? "");
  const [projectId, setProjectId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<CasePriority>("MEDIUM");
  const [assigneeUserId, setAssigneeUserId] = useState(user?.id ?? "");
  const [requesterContactId, setRequesterContactId] = useState("");
  const [requesterName, setRequesterName] = useState("");
  const [requesterEmail, setRequesterEmail] = useState("");

  useEffect(() => {
    if (open) {
      setClientId(defaultClientId ?? "");
      setProjectId(""); setTypeId(""); setSubject(""); setDescription("");
      setPriority("MEDIUM"); setAssigneeUserId(user?.id ?? "");
      setRequesterContactId(""); setRequesterName(""); setRequesterEmail("");
    }
  }, [open, defaultClientId, user?.id]);

  const { data: clients } = useQuery<PickerClient[]>({ queryKey: ["/api/support/clients"], enabled: open });
  const { data: types } = useQuery<CaseType[]>({ queryKey: ["/api/support/types"], enabled: open });
  const { data: agents } = useQuery<Agent[]>({ queryKey: ["/api/support/agents"], enabled: open });
  const { data: projects } = useQuery<PickerProject[]>({
    queryKey: ["/api/support/clients", clientId, "projects"],
    queryFn: () => fetch(`/api/support/clients/${clientId}/projects`, { credentials: "include" }).then(r => r.json()),
    enabled: open && !!clientId,
  });
  const { data: contacts } = useQuery<PickerContact[]>({
    queryKey: ["/api/clients", clientId, "contacts"],
    queryFn: () => fetch(`/api/clients/${clientId}/contacts`, { credentials: "include" }).then(r => r.ok ? r.json() : []),
    enabled: open && !!clientId,
  });

  useEffect(() => {
    // One project → pick it; the case's time will default there.
    if (projects && projects.length === 1 && !projectId) setProjectId(projects[0].id);
  }, [projects, projectId]);

  useEffect(() => {
    const t = types?.find(x => x.id === typeId);
    if (t) setPriority(t.defaultPriority);
  }, [typeId, types]);

  const create = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/support/cases", {
        clientId,
        projectId: projectId || null,
        typeId: typeId || null,
        subject: subject.trim(),
        description: description.trim() || null,
        priority,
        assigneeUserId: assigneeUserId || null,
        requesterContactId: requesterContactId || null,
        requesterName: requesterName.trim() || null,
        requesterEmail: requesterEmail.trim() || null,
      });
      return res.json();
    },
    onSuccess: (row: { id: string; caseKey: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/support/cases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/support/summary"] });
      toast({ title: `${row.caseKey} opened` });
      onOpenChange(false);
      onCreated(row.id);
    },
    onError: (err: Error) => toast({ title: "Could not open the case", description: err.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });

  const valid = !!clientId && subject.trim().length > 0;
  const fieldStyle = { borderColor: "var(--lux-border)", color: "var(--lux-text)" } as const;
  const labelStyle = { color: "var(--lux-text-muted)" } as const;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}>
        <DialogHeader>
          <DialogTitle style={{ color: "var(--lux-text)" }} data-testid="dialog-title-new-case">New support case</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={e => { e.preventDefault(); if (valid) create.mutate(); }}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs" style={labelStyle}>Client</Label>
              <Select value={clientId} onValueChange={v => { setClientId(v); setProjectId(""); setRequesterContactId(""); }}>
                <SelectTrigger style={fieldStyle} data-testid="select-case-client"><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent>{clients?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs" style={labelStyle}>Project <span style={{ color: "var(--lux-text-muted)" }}>(where time lands)</span></Label>
              <Select value={projectId} onValueChange={setProjectId} disabled={!clientId}>
                <SelectTrigger style={fieldStyle} data-testid="select-case-project"><SelectValue placeholder={clientId ? "Optional" : "Pick a client first"} /></SelectTrigger>
                <SelectContent>{projects?.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs" style={labelStyle}>Subject</Label>
            <Input value={subject} onChange={e => setSubject(e.target.value)} maxLength={300} placeholder="What does the client need?" style={fieldStyle} data-testid="input-case-subject" />
          </div>
          <div>
            <Label className="text-xs" style={labelStyle}>Description</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={4} placeholder="Details, steps, what they already tried…" style={fieldStyle} data-testid="input-case-description" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs" style={labelStyle}>Type</Label>
              <Select value={typeId} onValueChange={setTypeId}>
                <SelectTrigger style={fieldStyle} data-testid="select-case-type"><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>{types?.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs" style={labelStyle}>Priority</Label>
              <Select value={priority} onValueChange={v => setPriority(v as CasePriority)}>
                <SelectTrigger style={fieldStyle} data-testid="select-case-priority"><SelectValue /></SelectTrigger>
                <SelectContent>{CASE_PRIORITY_ORDER.map(p => <SelectItem key={p} value={p}>{PRIORITY_LABEL[p]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs" style={labelStyle}>Assignee</Label>
              <Select value={assigneeUserId || "__none__"} onValueChange={v => setAssigneeUserId(v === "__none__" ? "" : v)}>
                <SelectTrigger style={fieldStyle} data-testid="select-case-assignee"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Unassigned</SelectItem>
                  {agents?.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs" style={labelStyle}>Requester (contact)</Label>
              <Select value={requesterContactId || "__none__"} onValueChange={v => setRequesterContactId(v === "__none__" ? "" : v)} disabled={!clientId}>
                <SelectTrigger style={fieldStyle} data-testid="select-case-requester"><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Not a saved contact</SelectItem>
                  {contacts?.map(c => <SelectItem key={c.id} value={c.id}>{c.firstName} {c.lastName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs" style={labelStyle}>Requester name</Label>
              <Input value={requesterName} onChange={e => setRequesterName(e.target.value)} placeholder="If not a saved contact" style={fieldStyle} data-testid="input-case-requester-name" />
            </div>
            <div>
              <Label className="text-xs" style={labelStyle}>Requester email</Label>
              <Input type="email" value={requesterEmail} onChange={e => setRequesterEmail(e.target.value)} placeholder="name@client.com" style={fieldStyle} data-testid="input-case-requester-email" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-new-case">Cancel</Button>
            <Button type="submit" className="text-white" disabled={!valid || create.isPending} style={{ background: "var(--gradient-brand)" }} data-testid="button-submit-new-case">
              {create.isPending ? "Opening…" : "Open case"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function useCaseViewCounts() {
  return useMemo(() => VIEWS, []);
}
