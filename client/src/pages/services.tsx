import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHelpLink } from "@/components/page-help-link";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Tag, Plus, Pencil, Trash2, Check, X, DollarSign,
  Briefcase, Zap, RotateCcw, ArrowLeft,
} from "lucide-react";
import { formatRate, formatMoney } from "@/components/shared/format";
import { useDocumentTitle } from "@/lib/use-document-title";
import { ErrorState } from "@/components/shared/error-state";

interface ServiceItem {
  id: string;
  name: string;
  description: string | null;
  defaultRate: string | null;
  isActive: boolean;
}

const TEMPLATES = [
  { name: "Strategy", rate: "250", desc: "Strategic advisory and business planning" },
  { name: "Management", rate: "200", desc: "Operations and organizational improvement" },
  { name: "Information Technology", rate: "175", desc: "Technology strategy and implementation" },
  { name: "Software Development", rate: "185", desc: "Custom software engineering and architecture" },
  { name: "UX/UI Design", rate: "150", desc: "User experience and interface design" },
  { name: "Project Management", rate: "145", desc: "Project planning, execution, and delivery" },
  { name: "Data Analytics", rate: "165", desc: "Data analysis, visualization, and insights" },
  { name: "Financial Advisory", rate: "225", desc: "Financial planning and analysis" },
  { name: "Marketing Strategy", rate: "160", desc: "Marketing planning and campaign management" },
  { name: "Legal", rate: "275", desc: "Legal advisory and compliance" },
  { name: "Training & Workshops", rate: "135", desc: "Team training and professional development" },
  { name: "Administrative", rate: "75", desc: "General admin and support tasks" },
];

export default function ServicesPage() {
  useDocumentTitle("Services");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: services, isLoading, isError, refetch } = useQuery<ServiceItem[]>({ queryKey: ["/api/services"] });

  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rate, setRate] = useState("");

  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editRate, setEditRate] = useState("");

  const activeServices = (services || []).filter(s => s.isActive);
  const inactiveServices = (services || []).filter(s => !s.isActive);
  const existingNames = new Set(activeServices.map(s => s.name.toLowerCase()));

  const createMutation = useMutation({
    mutationFn: (data: { name: string; description: string | null; defaultRate: number | null }) =>
      apiRequest("POST", "/api/services", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/services"] });
      queryClient.invalidateQueries({ queryKey: ["/api/implementation-status"] });
      setName(""); setDescription(""); setRate(""); setShowAdd(false);
      toast({ title: "Service created" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("PATCH", `/api/services/${id}`, { name: editName, description: editDesc || null, defaultRate: editRate ? Number(editRate) : null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/services"] });
      setEditId(null);
      toast({ title: "Service updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiRequest("PATCH", `/api/services/${id}`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/services"] });
      toast({ title: "Service updated" });
    },
  });

  const addTemplate = async (t: typeof TEMPLATES[0]) => {
    try {
      await apiRequest("POST", "/api/services", { name: t.name, description: t.desc, defaultRate: Number(t.rate) });
      queryClient.invalidateQueries({ queryKey: ["/api/services"] });
      queryClient.invalidateQueries({ queryKey: ["/api/implementation-status"] });
      toast({ title: `${t.name} added` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const startEdit = (s: ServiceItem) => {
    setEditId(s.id);
    setEditName(s.name);
    setEditDesc(s.description || "");
    setEditRate(s.defaultRate || "");
  };

  const availableTemplates = TEMPLATES.filter(t => !existingNames.has(t.name.toLowerCase()));

  if (isLoading) {
    return (
      <div className="px-6 lg:px-8 xl:px-10 py-6 max-w-6xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-12 w-12 rounded-xl" />
          <div><Skeleton className="h-7 w-36 rounded-lg" /><Skeleton className="h-4 w-56 rounded-md mt-1.5" /></div>
        </div>
        <Skeleton className="h-10 w-full rounded-xl" />
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
      </div>
    );
  }

  return (
    <div className="px-6 lg:px-8 xl:px-10 py-6 max-w-6xl mx-auto space-y-6">
      <PageBreadcrumbs group="Management" page="Services" />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(var(--lux-accent-rgb),0.15) 0%, rgba(var(--lux-accent-rgb),0.05) 100%)" }}>
            <Tag className="w-6 h-6" style={{ color: "var(--lux-accent)" }} />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--lux-text)" }} data-testid="text-services-title">Services</h1>
              <PageHelpLink />
            </div>
            <p className="text-sm mt-0.5" style={{ color: "var(--lux-text-muted)" }}>
              Define what your team bills for. Services are assigned to projects and used when tracking time.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-4">
            <div className="text-center">
              <p className="text-2xl font-bold" style={{ color: "var(--lux-text)" }} data-testid="text-active-count">{activeServices.length}</p>
              <p className="text-[10px] uppercase tracking-wider font-bold" style={{ color: "var(--lux-text-muted)" }}>Active</p>
            </div>
            {inactiveServices.length > 0 && (
              <div className="text-center">
                <p className="text-2xl font-bold" style={{ color: "var(--lux-text-muted)" }} data-testid="text-inactive-count">{inactiveServices.length}</p>
                <p className="text-[10px] uppercase tracking-wider font-bold" style={{ color: "var(--lux-text-muted)" }}>Inactive</p>
              </div>
            )}
          </div>
          <Button className="text-white" onClick={() => setShowAdd(true)} disabled={showAdd} data-testid="button-add-service" style={{ background: "var(--gradient-brand)" }}>
            <Plus className="w-4 h-4 mr-2" /> Add Service
          </Button>
        </div>
      </div>

      {activeServices.length === 0 && !showAdd && (
        <div className="rounded-2xl p-6 border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(var(--lux-accent-rgb),0.15) 0%, rgba(var(--lux-accent-rgb),0.05) 100%)" }}>
              <Zap className="w-5 h-5" style={{ color: "var(--lux-accent)" }} />
            </div>
            <div>
              <h2 className="text-base font-bold" style={{ color: "var(--lux-text)" }}>Quick Start: Add Common Services</h2>
              <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>Click any card to add it instantly. Rates are fully editable after adding.</p>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {TEMPLATES.map((t, i) => (
              <button
                key={i}
                onClick={() => addTemplate(t)}
                className="text-left rounded-xl p-4 transition-all cursor-pointer hover:scale-[1.02] hover:shadow-md"
                style={{ background: "var(--color-surface-0)", border: "1px solid var(--lux-border)" }}
                data-testid={`button-template-${i}`}
              >
                <div className="flex items-start justify-between mb-2">
                  <Briefcase className="w-4 h-4 mt-0.5" style={{ color: "var(--lux-text-muted)" }} />
                  <span className="text-[10px] tabular-nums font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e" }}>{formatRate(t.rate)}</span>
                </div>
                <p className="text-sm font-bold mb-1" style={{ color: "var(--lux-text)" }}>{t.name}</p>
                <p className="text-[10px] leading-relaxed" style={{ color: "var(--lux-text-muted)" }}>{t.desc}</p>
              </button>
            ))}
          </div>
          <p className="text-center text-xs mt-4" style={{ color: "var(--lux-text-muted)" }}>
            Or <button className="font-bold cursor-pointer" style={{ color: "var(--lux-accent)" }} onClick={() => setShowAdd(true)} data-testid="button-create-custom">create a custom service</button> from scratch
          </p>
        </div>
      )}

      {activeServices.length > 0 && availableTemplates.length > 0 && !showAdd && (
        <details className="rounded-xl border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
          <summary className="px-5 py-3 cursor-pointer text-sm font-medium" style={{ color: "var(--lux-text-muted)" }} data-testid="button-expand-templates">
            <Zap className="w-3.5 h-3.5 inline mr-2" style={{ color: "var(--lux-accent)" }} />
            Add from templates ({availableTemplates.length} available)
          </summary>
          <div className="px-5 pb-4 grid grid-cols-2 md:grid-cols-4 gap-2">
            {availableTemplates.map((t, i) => (
              <button
                key={i}
                onClick={() => addTemplate(t)}
                className="text-left rounded-lg p-3 transition-all cursor-pointer hover:scale-[1.02]"
                style={{ background: "var(--color-surface-0)", border: "1px solid var(--lux-border)" }}
                data-testid={`button-avail-template-${i}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold" style={{ color: "var(--lux-text)" }}>{t.name}</span>
                  <span className="text-[9px] tabular-nums font-bold" style={{ color: "#22c55e" }}>{formatMoney(t.rate)}</span>
                </div>
                <p className="text-[9px]" style={{ color: "var(--lux-text-muted)" }}>{t.desc}</p>
              </button>
            ))}
          </div>
        </details>
      )}

      {showAdd && (
        <div className="rounded-2xl p-6 border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
          <h3 className="text-sm font-bold mb-4" style={{ color: "var(--lux-text)" }}>New Service</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label className="text-xs font-semibold mb-1.5 block" style={{ color: "var(--lux-text-secondary)" }}>Service Name *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Strategy" data-testid="input-service-name" />
            </div>
            <div>
              <Label className="text-xs font-semibold mb-1.5 block" style={{ color: "var(--lux-text-secondary)" }}>Default Rate ($/hr)</Label>
              <Input type="number" step="0.01" min="0" value={rate} onChange={e => setRate(e.target.value)} placeholder="e.g. 175.00" data-testid="input-service-rate" />
            </div>
            <div>
              <Label className="text-xs font-semibold mb-1.5 block" style={{ color: "var(--lux-text-secondary)" }}>Description</Label>
              <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="What this service covers" data-testid="input-service-desc" />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <Button onClick={() => createMutation.mutate({ name, description: description || null, defaultRate: rate ? Number(rate) : null })} disabled={!name.trim() || createMutation.isPending} data-testid="button-submit-service">
              {createMutation.isPending ? "Creating..." : "Add Service"}
            </Button>
            <Button variant="ghost" onClick={() => { setShowAdd(false); setName(""); setDescription(""); setRate(""); }} data-testid="button-cancel-add">Cancel</Button>
          </div>
        </div>
      )}

      {activeServices.length > 0 && (
        <div className="rounded-2xl overflow-hidden border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
          <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--lux-border)" }}>
            <h3 className="text-sm font-bold" style={{ color: "var(--lux-text)" }}>Active Services</h3>
            <Badge variant="outline">{activeServices.length}</Badge>
          </div>
          <div>
            {activeServices.map((svc, i) => (
              <div key={svc.id}>
                {editId === svc.id ? (
                  <div className="px-5 py-4 space-y-3" style={{ background: "var(--color-surface-0)" }}>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <Input value={editName} onChange={e => setEditName(e.target.value)} placeholder="Service name" data-testid="input-edit-name" />
                      <Input type="number" step="0.01" value={editRate} onChange={e => setEditRate(e.target.value)} placeholder="Rate $/hr" data-testid="input-edit-rate" />
                      <Input value={editDesc} onChange={e => setEditDesc(e.target.value)} placeholder="Description" data-testid="input-edit-desc" />
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => updateMutation.mutate(svc.id)} disabled={!editName.trim()} data-testid="button-save-edit">
                        <Check className="w-4 h-4 mr-1" /> Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditId(null)} data-testid="button-cancel-edit">Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <div
                    className="flex items-center justify-between px-5 py-3.5 transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
                    style={{ borderBottom: i < activeServices.length - 1 ? "1px solid var(--lux-border)" : "none" }}
                    data-testid={`row-service-${svc.id}`}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg, rgba(var(--lux-accent-rgb),0.1) 0%, rgba(var(--lux-accent-rgb),0.03) 100%)" }}>
                        <Tag className="w-4 h-4" style={{ color: "var(--lux-accent)" }} />
                      </div>
                      <div>
                        <p className="text-sm font-semibold" style={{ color: "var(--lux-text)" }}>{svc.name}</p>
                        {svc.description && <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>{svc.description}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      {svc.defaultRate ? (
                        <div className="text-right">
                          <p className="text-sm font-bold tabular-nums" style={{ color: "#22c55e" }}>{formatMoney(svc.defaultRate)}</p>
                          <p className="text-[10px] uppercase" style={{ color: "var(--lux-text-muted)" }}>per hour</p>
                        </div>
                      ) : (
                        <span className="text-xs" style={{ color: "var(--lux-text-muted)" }}>No default rate</span>
                      )}
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => startEdit(svc)} data-testid={`button-edit-${svc.id}`} aria-label="Edit service">
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => toggleMutation.mutate({ id: svc.id, isActive: false })} data-testid={`button-deactivate-${svc.id}`} aria-label="Deactivate service">
                          <Trash2 className="w-3.5 h-3.5" style={{ color: "#ef4444" }} />
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {inactiveServices.length > 0 && (
        <div className="rounded-2xl overflow-hidden" style={{ background: "var(--lux-surface)", border: "1px solid var(--lux-border)", opacity: 0.7 }}>
          <div className="px-5 py-3" style={{ borderBottom: "1px solid var(--lux-border)" }}>
            <h3 className="text-sm font-bold" style={{ color: "var(--lux-text-muted)" }}>Inactive Services</h3>
          </div>
          {inactiveServices.map((svc, i) => (
            <div
              key={svc.id}
              className="flex items-center justify-between px-5 py-3"
              style={{ borderBottom: i < inactiveServices.length - 1 ? "1px solid var(--lux-border)" : "none" }}
              data-testid={`row-inactive-${svc.id}`}
            >
              <div className="flex items-center gap-3">
                <Tag className="w-4 h-4" style={{ color: "var(--lux-text-muted)" }} />
                <span className="text-sm line-through" style={{ color: "var(--lux-text-muted)" }}>{svc.name}</span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => toggleMutation.mutate({ id: svc.id, isActive: true })} data-testid={`button-reactivate-${svc.id}`}>
                <RotateCcw className="w-3.5 h-3.5 mr-1" /> Reactivate
              </Button>
            </div>
          ))}
        </div>
      )}

      {isError && (
        <ErrorState title="Failed to load services" description="We couldn't load service data. Please try again." onRetry={refetch} />
      )}
    </div>
  );
}
