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
interface SlaResponse { policy: Policy; isDefault: boolean; supportInboundAddress: string | null }
interface PortalInfo { orgSlug: string; portalUrl: string }

export default function SupportSettingsPage() {
  useDocumentTitle("Support settings");
  const { toast } = useToast();
  const { data, isLoading } = useQuery<SlaResponse>({ queryKey: ["/api/support/sla"] });
  const { data: portal } = useQuery<PortalInfo>({ queryKey: ["/api/support/portal-info"] });
  const [p, setP] = useState<Policy | null>(null);
  const [inbound, setInbound] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (data) { setP(data.policy); setInbound(data.supportInboundAddress ?? ""); } }, [data]);

  const savePolicy = useMutation({
    mutationFn: async () => (await apiRequest("PUT", "/api/support/sla", p)).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/support/sla"] }); toast({ title: "Service levels saved" }); },
    onError: (err: Error) => toast({ title: "Could not save", description: err.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
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
          <p className="text-sm mt-0.5" style={muted}>Service levels, the customer portal link, and the mailbox that turns emails into cases.</p>
        </div>
      </div>

      <section className="rounded-2xl p-5 border-0 space-y-3" style={card}>
        <h2 className="text-[11px] font-bold uppercase tracking-wider" style={muted}>Customer portal</h2>
        <p className="text-sm" style={{ color: "var(--lux-text-secondary)" }}>Send clients this link. They sign in with a one-time email link; you can also send it from any case with a saved requester.</p>
        <div className="flex items-center gap-2">
          <Input readOnly value={portal?.portalUrl ?? ""} style={fieldStyle} data-testid="input-portal-url" />
          <Button variant="outline" onClick={() => { if (portal?.portalUrl) { navigator.clipboard.writeText(portal.portalUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); } }} data-testid="button-copy-portal-url">
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          </Button>
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

      <section className="rounded-2xl p-5 border-0 space-y-3" style={card}>
        <h2 className="text-[11px] font-bold uppercase tracking-wider" style={muted}>Email to case</h2>
        <p className="text-sm" style={{ color: "var(--lux-text-secondary)" }}>
          Emails delivered to this address become cases (from known contacts) or replies (when the subject carries the case key, which every case email includes). Point your inbound mail route at CherryWorks and enter the address here.
        </p>
        <form className="flex items-center gap-2" onSubmit={e => { e.preventDefault(); saveInbound.mutate(); }}>
          <Input type="email" value={inbound} onChange={e => setInbound(e.target.value)} placeholder="support@yourfirm.com" style={fieldStyle} data-testid="input-inbound-address" />
          <Button type="submit" variant="outline" disabled={saveInbound.isPending} data-testid="button-save-inbound">Save</Button>
        </form>
      </section>
    </div>
  );
}
