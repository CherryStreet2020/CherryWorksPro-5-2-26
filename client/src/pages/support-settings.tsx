import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/lib/use-document-title";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Settings2, Copy, Check } from "lucide-react";

interface Policy { firstResponseHours: number; resolutionHours: number; businessHoursOnly: boolean; businessStartHour: number; businessEndHour: number; timezone: string }
interface SlaResponse { policy: Policy; isDefault: boolean; supportInboundAddress: string | null; mailbox?: { provider: string; connected: boolean; status: string; canReadInbox: boolean; requiredScope: string; senderAddress: string | null } }
interface PortalInfo { orgSlug: string; helpUrl: string; portalUrl: string }
interface PickerClient { id: string; name: string }
interface PickerProject { id: string; name: string }
interface JiraTest { ok: boolean; connectedAs: string; issues: number; firstKey: string | null; lastKey: string | null; statuses: Record<string, number> }
interface ImportReport { pulled?: number; imported: number; skipped: string[]; contactsCreated: number; unmatchedAssignees: string[]; unmatchedTypes: string[]; timeEntriesLinked: number; nextCaseNumber: number; errors: { key: string; error: string }[]; contactConflicts?: string[] }

export default function SupportSettingsPage() {
  useDocumentTitle("Support settings");
  const { toast } = useToast();
  const { data, isLoading } = useQuery<SlaResponse>({ queryKey: ["/api/support/sla"] });
  const { data: portal } = useQuery<PortalInfo>({ queryKey: ["/api/support/portal-info"] });
  const [p, setP] = useState<Policy | null>(null);
  const [inbound, setInbound] = useState("");
  const [copied, setCopied] = useState<"help" | "portal" | null>(null);
  useEffect(() => { if (data) { setP(data.policy); setInbound(data.supportInboundAddress ?? ""); } }, [data]);

  const savePolicy = useMutation({
    mutationFn: async () => (await apiRequest("PUT", "/api/support/sla", p)).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/support/sla"] }); toast({ title: "Service levels saved" }); },
    onError: (err: Error) => toast({ title: "Could not save", description: err.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });
  const checkNow = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/support/inbound/check-now")).json(),
    onSuccess: (r: { scanned: number; processed: number; skipped: number; outcomes: Record<string, number>; error?: string }) => toast({ title: r.error ? "Inbox not readable yet" : `Checked ${r.scanned} unread, processed ${r.processed}`, description: r.error || Object.entries(r.outcomes).map(([k, v]) => `${k}: ${v}`).join(", ") || undefined, variant: r.error ? "destructive" : undefined }),
    onError: (err: Error) => toast({ title: "Inbox check failed", description: err.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });
  const saveInbound = useMutation({
    mutationFn: async () => (await apiRequest("PATCH", "/api/support/settings", { supportInboundAddress: inbound.trim() || null })).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/support/sla"] }); toast({ title: "Inbound address saved" }); },
    onError: (err: Error) => toast({ title: "Could not save", description: err.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });

  const card = { background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" } as const;
  const muted = { color: "var(--lux-text-muted)" } as const;
  const fieldStyle = { borderColor: "var(--lux-border)", color: "var(--lux-text)" } as const;

  return (
    <div className="px-6 lg:px-8 xl:px-10 py-6 max-w-4xl mx-auto space-y-6">
      <PageBreadcrumbs page="Settings" items={[{ label: "Dashboard", href: "/", withBackArrow: true }, { label: "Support Cases", href: "/support/cases" }]} showDashboard={false} />
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(var(--lux-accent-rgb),0.15) 0%, rgba(var(--lux-accent-rgb),0.05) 100%)" }}>
          <Settings2 className="w-6 h-6" style={{ color: "var(--lux-accent)" }} />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--lux-text)" }}>Support settings</h1>
          <p className="text-sm mt-0.5" style={muted}>Service levels, the Help Center and Customer Portal links, and the mailbox that turns emails into cases.</p>
        </div>
      </div>

      <section className="rounded-2xl p-5 border-0 space-y-4" style={card}>
        <div>
          <h2 className="text-[11px] font-bold uppercase tracking-wider" style={muted}>Help Center</h2>
          <p className="text-sm mt-1" style={{ color: "var(--lux-text-secondary)" }}>Support cases only — never invoices. Share this one link with a customer's whole team: anyone whose address is on that client's approved email domains signs in with a one-time link and is added as a contact automatically. Customer admins (set per contact on the client) see every case for their company, set priority, close and reopen, and invite colleagues.</p>
          <div className="flex items-center gap-2 mt-2">
            <Input readOnly value={portal?.helpUrl ?? ""} style={fieldStyle} data-testid="input-help-url" />
            <Button variant="outline" onClick={() => { if (portal?.helpUrl) { navigator.clipboard.writeText(portal.helpUrl); setCopied("help"); setTimeout(() => setCopied(null), 1500); } }} data-testid="button-copy-help-url">
              {copied === "help" ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
        </div>
        <div>
          <h2 className="text-[11px] font-bold uppercase tracking-wider" style={muted}>Customer Portal</h2>
          <p className="text-sm mt-1" style={{ color: "var(--lux-text-secondary)" }}>Invoices, estimates and payments. Only contacts with billing access (per contact on the client) can sign in here; send it from the client's Contacts tab.</p>
          <div className="flex items-center gap-2 mt-2">
            <Input readOnly value={portal?.portalUrl ?? ""} style={fieldStyle} data-testid="input-portal-url" />
            <Button variant="outline" onClick={() => { if (portal?.portalUrl) { navigator.clipboard.writeText(portal.portalUrl); setCopied("portal"); setTimeout(() => setCopied(null), 1500); } }} data-testid="button-copy-portal-url">
              {copied === "portal" ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </section>

      <section className="rounded-2xl p-5 border-0 space-y-3" style={card}>
        <h2 className="text-[11px] font-bold uppercase tracking-wider" style={muted}>Service levels</h2>
        {isLoading || !p ? <Skeleton className="h-24 rounded-lg" /> : (
          <form className="space-y-4" onSubmit={e => { e.preventDefault(); savePolicy.mutate(); }}>
            <p className="text-sm" style={{ color: "var(--lux-text-secondary)" }}>
              Targets for every new case{data?.isDefault ? " (these are the built-in defaults until you save)" : ""}. Clocks pause while a case waits on the customer. Warnings go to the assignee an hour before a target and again at breach.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs" style={muted}>First response within (hours)</Label>
                <Input type="number" step="0.25" min="0.25" value={p.firstResponseHours} onChange={e => setP({ ...p, firstResponseHours: Number(e.target.value) })} style={fieldStyle} data-testid="input-sla-first-response" />
              </div>
              <div>
                <Label className="text-xs" style={muted}>Resolution within (hours)</Label>
                <Input type="number" step="0.25" min="0.25" value={p.resolutionHours} onChange={e => setP({ ...p, resolutionHours: Number(e.target.value) })} style={fieldStyle} data-testid="input-sla-resolution" />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "var(--lux-text)" }}>
              <input type="checkbox" checked={p.businessHoursOnly} onChange={e => setP({ ...p, businessHoursOnly: e.target.checked })} data-testid="toggle-sla-business-hours" />
              Count business hours only (Monday to Friday)
            </label>
            {p.businessHoursOnly && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs" style={muted}>Day starts (hour, 0–23)</Label>
                  <Input type="number" min="0" max="23" value={p.businessStartHour} onChange={e => setP({ ...p, businessStartHour: Number(e.target.value) })} style={fieldStyle} data-testid="input-sla-start-hour" />
                </div>
                <div>
                  <Label className="text-xs" style={muted}>Day ends (hour, 1–24)</Label>
                  <Input type="number" min="1" max="24" value={p.businessEndHour} onChange={e => setP({ ...p, businessEndHour: Number(e.target.value) })} style={fieldStyle} data-testid="input-sla-end-hour" />
                </div>
                <div>
                  <Label className="text-xs" style={muted}>Timezone</Label>
                  <Input value={p.timezone} onChange={e => setP({ ...p, timezone: e.target.value })} placeholder="America/New_York" style={fieldStyle} data-testid="input-sla-timezone" />
                </div>
              </div>
            )}
            <div className="flex justify-end">
              <Button type="submit" className="text-white" disabled={savePolicy.isPending} style={{ background: "var(--gradient-brand)" }} data-testid="button-save-sla">{savePolicy.isPending ? "Saving…" : "Save service levels"}</Button>
            </div>
          </form>
        )}
      </section>

      <JiraImportCard card={card} muted={muted} fieldStyle={fieldStyle} />

      <section className="rounded-2xl p-5 border-0 space-y-3" style={card} data-testid="card-email-to-case">
        <h2 className="text-[11px] font-bold uppercase tracking-wider" style={muted}>Email to case (Microsoft 365)</h2>
        <p className="text-sm" style={{ color: "var(--lux-text-secondary)" }}>
          CherryWorks reads your connected Microsoft 365 inbox every two minutes. Unread mail sent to the address below becomes a case (from a known contact) or a reply (when the subject carries the case key, which every case email includes). File attachments come along. Processed mail is marked read.
        </p>
        {data?.mailbox && (
          <p className="text-xs" style={{ color: data.mailbox.canReadInbox ? "var(--lux-text)" : "#b45309" }} data-testid="text-mailbox-status">
            {data.mailbox.provider !== "m365" || !data.mailbox.connected
              ? "No Microsoft 365 mailbox is connected. Connect one under Settings → Email, then come back here."
              : data.mailbox.canReadInbox
                ? `Mailbox connected${data.mailbox.senderAddress ? ` (${data.mailbox.senderAddress})` : ""} with inbox access.`
                : `Mailbox connected, but it was authorised before inbox reading existed. Reconnect it once under Settings → Email to grant ${data.mailbox.requiredScope}.`}
          </p>
        )}
        <form className="flex items-center gap-2" onSubmit={e => { e.preventDefault(); saveInbound.mutate(); }}>
          <Input type="email" value={inbound} onChange={e => setInbound(e.target.value)} placeholder="support@yourfirm.com" style={fieldStyle} data-testid="input-inbound-address" />
          <Button type="submit" variant="outline" disabled={saveInbound.isPending} data-testid="button-save-inbound">Save</Button>
          <Button type="button" variant="outline" onClick={() => checkNow.mutate()} disabled={checkNow.isPending || !data?.supportInboundAddress} data-testid="button-check-inbox">{checkNow.isPending ? "Checking…" : "Check inbox now"}</Button>
        </form>
      </section>
    </div>
  );
}


interface JiraConnection { connected: boolean; baseUrl?: string; projectKey?: string; email?: string; clientId?: string | null; projectId?: string | null; connectedAs?: string | null; connectedAt?: string; lastImportAt?: string | null; lastImportSummary?: { pulled: number; imported: number; skipped: number; attachmentsImported?: number; errors: number } | null }

function JiraImportCard({ card, muted, fieldStyle }: { card: React.CSSProperties; muted: React.CSSProperties; fieldStyle: React.CSSProperties }) {
  const { toast } = useToast();
  const { data: saved, isLoading: savedLoading } = useQuery<JiraConnection>({ queryKey: ["/api/support/import/jira-connection"] });
  const [editing, setEditing] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [email, setEmail] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [projectKey, setProjectKey] = useState("");
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [test, setTest] = useState<JiraTest | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const { data: clients } = useQuery<PickerClient[]>({ queryKey: ["/api/support/clients"] });
  const { data: projects } = useQuery<PickerProject[]>({
    queryKey: ["/api/support/clients", clientId, "projects"],
    queryFn: async () => { const r = await fetch(`/api/support/clients/${clientId}/projects`, { credentials: "include" }); if (!r.ok) throw new Error(`${r.status}`); return r.json(); },
    enabled: !!clientId,
  });
  // A saved connection fills the form (token stays server-side) and its client/project choice.
  useEffect(() => {
    if (!saved?.connected) return;
    setBaseUrl(saved.baseUrl || baseUrl); setProjectKey(saved.projectKey || projectKey); setEmail(saved.email || "");
    if (saved.clientId) setClientId(saved.clientId); if (saved.projectId) setProjectId(saved.projectId);
  }, [saved?.connected, saved?.baseUrl, saved?.projectKey, saved?.email, saved?.clientId, saved?.projectId]);

  const showForm = !saved?.connected || editing;
  const conn = { baseUrl: baseUrl.trim(), email: email.trim(), apiToken: apiToken.trim(), projectKey: projectKey.trim().toUpperCase() };
  // A saved connection can be edited without re-typing the token (the server keeps it).
  const ready = !!conn.baseUrl && !!conn.email && !!conn.projectKey && (!!conn.apiToken || !!saved?.connected);
  const usable = saved?.connected || ready;

  const connect = useMutation({
    mutationFn: async () => (await apiRequest("PUT", "/api/support/import/jira-connection", { ...conn, apiToken: conn.apiToken || undefined, clientId: clientId || null, projectId: projectId || null })).json(),
    onSuccess: (r: JiraConnection) => { queryClient.setQueryData(["/api/support/import/jira-connection"], r); setApiToken(""); setEditing(false); toast({ title: `Connected to Jira as ${r.connectedAs || r.email}` }); },
    onError: (err: Error) => toast({ title: "Could not connect to Jira", description: err.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });
  const disconnect = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", "/api/support/import/jira-connection")).json(),
    onSuccess: () => { queryClient.setQueryData(["/api/support/import/jira-connection"], { connected: false }); setTest(null); setReport(null); setEditing(false); toast({ title: "Jira disconnected" }); },
  });
  const testConn = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/support/import/jira-test", { ...conn, apiToken: conn.apiToken || undefined })).json(),
    onSuccess: (r: JiraTest) => { setTest(r); setReport(null); },
    onError: (err: Error) => { setTest(null); toast({ title: "Could not connect to Jira", description: err.message.replace(/^\d+:\s*/, ""), variant: "destructive" }); },
  });
  const run = useMutation({
    mutationFn: async (dryRun: boolean) => (await apiRequest("POST", "/api/support/import/jira-fetch", { ...conn, apiToken: conn.apiToken || undefined, clientId, projectId: projectId || null, dryRun, relinkTime: true })).json(),
    onSuccess: (r: ImportReport, dryRun) => {
      setReport(r);
      if (!dryRun) { queryClient.invalidateQueries({ queryKey: ["/api/support/cases"] }); queryClient.invalidateQueries({ queryKey: ["/api/support/summary"] }); queryClient.invalidateQueries({ queryKey: ["/api/support/import/jira-connection"] }); toast({ title: `Imported ${r.imported} cases` }); }
    },
    onError: (err: Error) => toast({ title: "Import failed", description: err.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });

  return (
    <section className="rounded-2xl p-5 border-0 space-y-3" style={card} data-testid="card-jira-import">
      <h2 className="text-[11px] font-bold uppercase tracking-wider" style={muted}>Import from Jira Service Management</h2>
      <p className="text-sm" style={{ color: "var(--lux-text-secondary)" }}>
        Moving from Jira Service Management? Connect your Jira Cloud site once and import a project: every issue comes over with its comments, status history and attachments, keeps its key and dates, and case numbering continues from there. Run it again any time to pick up what's new. The API token is stored encrypted — create one at id.atlassian.com → Security → API tokens (use the same Atlassian account email).
      </p>
      {saved?.connected && !editing && (
        <div className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm" style={{ background: "var(--lux-surface-alt)", border: "1px solid var(--lux-border)", color: "var(--lux-text)" }} data-testid="text-jira-connected">
          <span>
            Connected as <strong>{saved.connectedAs || saved.email}</strong> · {saved.projectKey} on {saved.baseUrl?.replace(/^https?:\/\//, "")}
            {saved.lastImportAt && <span style={muted}> · last import {new Date(saved.lastImportAt).toLocaleString()}{saved.lastImportSummary ? ` (${saved.lastImportSummary.imported} new, ${saved.lastImportSummary.skipped} already here)` : ""}</span>}
          </span>
          <span className="flex gap-3 text-xs whitespace-nowrap">
            <button className="underline" onClick={() => setEditing(true)} data-testid="button-jira-edit">Change</button>
            <button className="underline" onClick={() => disconnect.mutate()} disabled={disconnect.isPending} data-testid="button-jira-disconnect">Disconnect</button>
          </span>
        </div>
      )}
      {showForm && !savedLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><Label className="text-xs" style={muted}>Jira URL</Label><Input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://yourcompany.atlassian.net" style={fieldStyle} data-testid="input-jira-url" /></div>
          <div><Label className="text-xs" style={muted}>Project key</Label><Input value={projectKey} onChange={e => setProjectKey(e.target.value)} placeholder="SUP — the prefix on your issue keys" style={fieldStyle} data-testid="input-jira-project" /></div>
          <div><Label className="text-xs" style={muted}>Atlassian account email</Label><Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@yourcompany.com" style={fieldStyle} data-testid="input-jira-email" /></div>
          <div><Label className="text-xs" style={muted}>API token</Label><Input type="password" value={apiToken} onChange={e => setApiToken(e.target.value)} placeholder={saved?.connected ? "Leave blank to keep the saved token" : ""} style={fieldStyle} data-testid="input-jira-token" autoComplete="off" /></div>
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        {showForm && <Button className="text-white" onClick={() => connect.mutate()} disabled={!ready || connect.isPending} style={{ background: "var(--gradient-brand)" }} data-testid="button-jira-connect">{connect.isPending ? "Connecting…" : saved?.connected ? "Save connection" : "Connect"}</Button>}
        {showForm && saved?.connected && <Button variant="outline" onClick={() => { setEditing(false); setApiToken(""); setBaseUrl(saved.baseUrl || ""); setProjectKey(saved.projectKey || ""); setEmail(saved.email || ""); }} data-testid="button-jira-cancel">Cancel</Button>}
        <Button variant="outline" onClick={() => testConn.mutate()} disabled={!usable || testConn.isPending} data-testid="button-jira-test">{testConn.isPending ? "Checking…" : "Check project"}</Button>
        {test && <span className="text-xs" style={{ color: "var(--lux-text)" }} data-testid="text-jira-test">Connected as {test.connectedAs} · {test.issues} issues ({test.firstKey} → {test.lastKey})</span>}
      </div>
      {usable && (
        <div className="space-y-3 pt-2 border-t" style={{ borderColor: "var(--lux-border)" }}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs" style={muted}>Import into client</Label>
              <select value={clientId} onChange={e => { setClientId(e.target.value); setProjectId(""); }} className="w-full h-9 rounded-md border px-3 text-sm" style={{ background: "var(--lux-surface)", ...fieldStyle }} data-testid="select-jira-client">
                <option value="">Select client</option>
                {clients?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs" style={muted}>Default project for the cases (optional)</Label>
              <select value={projectId} onChange={e => setProjectId(e.target.value)} disabled={!clientId} className="w-full h-9 rounded-md border px-3 text-sm" style={{ background: "var(--lux-surface)", ...fieldStyle }} data-testid="select-jira-project">
                <option value="">None</option>
                {projects?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => run.mutate(true)} disabled={!clientId || run.isPending} data-testid="button-jira-dry-run">Preview (dry run)</Button>
            <Button className="text-white" onClick={() => run.mutate(false)} disabled={!clientId || run.isPending} style={{ background: "var(--gradient-brand)" }} data-testid="button-jira-import">{run.isPending ? "Importing…" : "Import now"}</Button>
          </div>
        </div>
      )}
      {report && (
        <div className="rounded-lg p-3 text-xs space-y-1" style={{ background: "var(--lux-surface-alt)", border: "1px solid var(--lux-border)", color: "var(--lux-text)" }} data-testid="text-jira-report">
          <p><strong>{report.imported}</strong> imported{report.pulled !== undefined ? ` of ${report.pulled} pulled` : ""} · {report.skipped.length} already existed · {report.contactsCreated} contacts created · {report.timeEntriesLinked} time entries linked · next key number {report.nextCaseNumber}</p>
          {report.unmatchedAssignees.length > 0 && <p style={muted}>Assignees left unassigned (no matching team member): {report.unmatchedAssignees.join(", ")}</p>}
          {report.unmatchedTypes.length > 0 && <p style={muted}>Request types with no matching case type (left blank): {report.unmatchedTypes.join(", ")}</p>}
          {report.errors.length > 0 && <p style={{ color: "#b91c1c" }}>{report.errors.length} errors: {report.errors.slice(0, 5).map(e => `${e.key}: ${e.error}`).join("; ")}</p>}
        </div>
      )}
    </section>
  );
}
