import { useLocation } from "wouter";
import { UpgradeWall } from "@/components/upgrade-wall";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { Plus, Pencil, Trash2, AlertTriangle, Key, Webhook, Copy, RotateCw, Globe, Lock, Zap, Code, CheckCircle2, XCircle, Activity, RefreshCw, Loader2, Check, ArrowLeft } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useBillingStatus } from "@/hooks/use-billing-status";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { Plug2 } from "lucide-react";
import { useDocumentTitle } from "@/lib/use-document-title";

const ALL_PERMISSIONS = [
  "clients:read", "invoices:read", "payments:read", "time-entries:read",
  "projects:read", "team:read", "estimates:read", "expenses:read", "webhooks:manage",
] as const;

const ALL_WEBHOOK_EVENTS = [
  "invoice.created", "invoice.sent", "invoice.paid", "payment.received",
  "client.created", "timesheet.submitted", "timesheet.approved", "estimate.sent",
] as const;

export default function ApiIntegrationsPage() {
  useDocumentTitle("API Integrations");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { isProfessionalPlus, planTier } = useBillingStatus();

  const { data: apiKeysData, isLoading: apiKeysLoading, isError: apiKeysError, refetch: refetchApiKeys } = useQuery<any[]>({
    queryKey: ["/api/integrations/api-keys"],
    enabled: isProfessionalPlus,
  });

  const { data: webhooksData, isLoading: webhooksLoading, isError: webhooksError, refetch: refetchWebhooks } = useQuery<any[]>({
    queryKey: ["/api/integrations/webhooks"],
    enabled: isProfessionalPlus,
  });

  const [showCreateKeyDialog, setShowCreateKeyDialog] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyPermissions, setNewKeyPermissions] = useState<string[]>([...ALL_PERMISSIONS]);
  const [createdKeyValue, setCreatedKeyValue] = useState<string | null>(null);
  const [keyCopied, setKeyCopied] = useState(false);

  const [showWebhookDialog, setShowWebhookDialog] = useState(false);
  const [editingWebhookId, setEditingWebhookId] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookEvents, setWebhookEvents] = useState<string[]>([]);
  const [webhookDescription, setWebhookDescription] = useState("");

  const createKeyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/integrations/api-keys", {
        name: newKeyName.trim(),
        permissions: newKeyPermissions,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/api-keys"] });
      setCreatedKeyValue(data.key);
      setShowCreateKeyDialog(false);
      setNewKeyName("");
      setNewKeyPermissions([...ALL_PERMISSIONS]);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const revokeKeyMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/integrations/api-keys/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/api-keys"] });
      toast({ title: "API key revoked" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const rotateKeyMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/integrations/api-keys/${id}/rotate`);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/api-keys"] });
      setCreatedKeyValue(data.key);
      toast({ title: "API key rotated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const createWebhookMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/integrations/webhooks", {
        url: webhookUrl.trim(),
        events: webhookEvents,
        description: webhookDescription.trim() || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/webhooks"] });
      resetWebhookForm();
      toast({ title: "Webhook endpoint created" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateWebhookMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/integrations/webhooks/${editingWebhookId}`, {
        url: webhookUrl.trim(),
        events: webhookEvents,
        description: webhookDescription.trim() || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/webhooks"] });
      resetWebhookForm();
      toast({ title: "Webhook endpoint updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteWebhookMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/integrations/webhooks/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/webhooks"] });
      toast({ title: "Webhook endpoint deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const testWebhookMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/integrations/webhooks/${id}/test`);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/webhooks"] });
      if (data.success) {
        toast({ title: "Test ping delivered", description: `Status: ${data.statusCode}` });
      } else {
        toast({ title: "Test ping failed", description: data.error || `Status: ${data.statusCode}`, variant: "destructive" });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  function resetWebhookForm() {
    setShowWebhookDialog(false);
    setEditingWebhookId(null);
    setWebhookUrl("");
    setWebhookEvents([]);
    setWebhookDescription("");
  }

  function openEditWebhook(wh: any) {
    setEditingWebhookId(wh.id);
    setWebhookUrl(wh.url);
    setWebhookEvents(wh.events || []);
    setWebhookDescription(wh.description || "");
    setShowWebhookDialog(true);
  }

  function togglePermission(perm: string) {
    setNewKeyPermissions(prev =>
      prev.includes(perm) ? prev.filter(p => p !== perm) : [...prev, perm]
    );
  }

  function toggleWebhookEvent(evt: string) {
    setWebhookEvents(prev =>
      prev.includes(evt) ? prev.filter(e => e !== evt) : [...prev, evt]
    );
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setKeyCopied(true);
      setTimeout(() => setKeyCopied(false), 2000);
    } catch {
      toast({ title: "Failed to copy", variant: "destructive" });
    }
  }

  function isValidWebhookUrl(url: string): boolean {
    if (!url.trim()) return false;
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:";
    } catch {
      return false;
    }
  }

  const webhookUrlInvalid = webhookUrl.trim().length > 0 && !isValidWebhookUrl(webhookUrl);

  return (
    <>
    <div className="px-6 lg:px-8 xl:px-10 pt-6 max-w-5xl mx-auto">
      <PageBreadcrumbs group="System" page="API & Integrations" />
    </div>
    <UpgradeWall requiredTier="PROFESSIONAL" featureName="API & Integrations" description="Unlock API keys, webhooks, and external integrations. Available on Professional plans and above.">
    <div className="px-6 lg:px-8 xl:px-10 pt-2 pb-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg" style={{ background: "var(--gradient-brand)" }}>
          <Plug2 className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--lux-text)" }} data-testid="text-integrations-title">API & Integrations</h1>
          <p className="text-sm" style={{ color: "var(--lux-text-muted)" }}>Connect external services and automate workflows with the CherryWorks Pro API</p>
        </div>
      </div>

        <div className="space-y-6">
          <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }} data-testid="card-api-keys">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <Key className="w-5 h-5" style={{ color: "var(--lux-accent)" }} />
                  <div>
                    <h3 className="font-semibold" style={{ color: "var(--lux-text)" }}>API Keys</h3>
                    <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>Manage keys for authenticating external API requests</p>
                  </div>
                </div>
                <Button
                  size="sm"
                  className="text-white"
                  style={{ background: "var(--gradient-brand)" }}
                  onClick={() => setShowCreateKeyDialog(true)}
                  data-testid="button-create-api-key"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Create Key
                </Button>
              </div>

              {apiKeysLoading ? (
                <div className="text-sm py-8 text-center" style={{ color: "var(--lux-text-muted)" }}>Loading API keys...</div>
              ) : apiKeysError ? (
                <div className="text-center py-8 rounded-lg" style={{ background: "var(--lux-bg)", border: "1px dashed var(--lux-border)" }}>
                  <AlertTriangle className="w-8 h-8 mx-auto mb-2" style={{ color: "var(--lux-accent)" }} />
                  <p className="text-sm" style={{ color: "var(--lux-text-muted)" }}>Failed to load API keys</p>
                  <Button variant="ghost" size="sm" className="mt-2" onClick={() => refetchApiKeys()} data-testid="button-retry-api-keys">
                    <RefreshCw className="w-3.5 h-3.5 mr-1" /> Retry
                  </Button>
                </div>
              ) : !apiKeysData?.length ? (
                <div className="text-center py-8 rounded-lg" style={{ background: "var(--lux-bg)", border: "1px dashed var(--lux-border)" }}>
                  <Key className="w-8 h-8 mx-auto mb-2" style={{ color: "var(--lux-text-muted)" }} />
                  <p className="text-sm" style={{ color: "var(--lux-text-muted)" }}>No API keys created yet</p>
                  <p className="text-xs mt-1" style={{ color: "var(--lux-text-muted)" }}>Create one to start using the REST API</p>
                </div>
              ) : (
                <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--lux-border)" }}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ background: "var(--lux-bg)" }}>
                        <th className="text-left px-4 py-2.5 font-medium" style={{ color: "var(--lux-text-muted)", borderBottom: "1px solid var(--lux-border)" }}>Name</th>
                        <th className="text-left px-4 py-2.5 font-medium" style={{ color: "var(--lux-text-muted)", borderBottom: "1px solid var(--lux-border)" }}>Key Prefix</th>
                        <th className="text-left px-4 py-2.5 font-medium hidden md:table-cell" style={{ color: "var(--lux-text-muted)", borderBottom: "1px solid var(--lux-border)" }}>Created</th>
                        <th className="text-left px-4 py-2.5 font-medium hidden lg:table-cell" style={{ color: "var(--lux-text-muted)", borderBottom: "1px solid var(--lux-border)" }}>Last Used</th>
                        <th className="text-left px-4 py-2.5 font-medium" style={{ color: "var(--lux-text-muted)", borderBottom: "1px solid var(--lux-border)" }}>Status</th>
                        <th className="text-right px-4 py-2.5 font-medium" style={{ color: "var(--lux-text-muted)", borderBottom: "1px solid var(--lux-border)" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {apiKeysData.map((key: any) => (
                        <tr key={key.id} className="group" style={{ borderBottom: "1px solid var(--lux-border)" }} data-testid={`row-api-key-${key.id}`}>
                          <td className="px-4 py-3 font-medium" style={{ color: "var(--lux-text)" }}>{key.name}</td>
                          <td className="px-4 py-3">
                            <code className="px-2 py-0.5 rounded text-xs font-mono" style={{ background: "var(--lux-bg)", color: "var(--lux-text-secondary)", border: "1px solid var(--lux-border)" }}>
                              {key.keyPrefix}...
                            </code>
                          </td>
                          <td className="px-4 py-3 hidden md:table-cell text-xs" style={{ color: "var(--lux-text-muted)" }}>
                            {new Date(key.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                          </td>
                          <td className="px-4 py-3 hidden lg:table-cell text-xs" style={{ color: "var(--lux-text-muted)" }}>
                            {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Never"}
                          </td>
                          <td className="px-4 py-3">
                            {key.isActive ? (
                              <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e" }}>
                                <CheckCircle2 className="w-3 h-3" /> Active
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>
                                <XCircle className="w-3 h-3" /> Revoked
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                onClick={() => {
                                  if (confirm("Rotating this key will invalidate the current key immediately. Any integrations using it will break. Continue?")) {
                                    rotateKeyMutation.mutate(key.id);
                                  }
                                }}
                                disabled={rotateKeyMutation.isPending}
                                title="Rotate key"
                                aria-label={`Rotate API key ${key.name}`}
                                data-testid={`button-rotate-key-${key.id}`}
                              >
                                {rotateKeyMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "var(--lux-text-muted)" }} /> : <RotateCw className="w-3.5 h-3.5" style={{ color: "var(--lux-text-muted)" }} />}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                onClick={() => {
                                  if (confirm("Are you sure you want to revoke this API key? This action cannot be undone.")) {
                                    revokeKeyMutation.mutate(key.id);
                                  }
                                }}
                                disabled={revokeKeyMutation.isPending}
                                title="Revoke key"
                                aria-label={`Revoke API key ${key.name}`}
                                data-testid={`button-revoke-key-${key.id}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" style={{ color: "#ef4444" }} />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }} data-testid="card-webhooks">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <Webhook className="w-5 h-5" style={{ color: "var(--lux-accent)" }} />
                  <div>
                    <h3 className="font-semibold" style={{ color: "var(--lux-text)" }}>Webhooks</h3>
                    <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>Receive real-time event notifications at your endpoints</p>
                  </div>
                </div>
                <Button
                  size="sm"
                  className="text-white"
                  style={{ background: "var(--gradient-brand)" }}
                  onClick={() => { resetWebhookForm(); setShowWebhookDialog(true); }}
                  data-testid="button-add-webhook"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Add Endpoint
                </Button>
              </div>

              {webhooksLoading ? (
                <div className="text-sm py-8 text-center" style={{ color: "var(--lux-text-muted)" }}>Loading webhooks...</div>
              ) : webhooksError ? (
                <div className="text-center py-8 rounded-lg" style={{ background: "var(--lux-bg)", border: "1px dashed var(--lux-border)" }}>
                  <AlertTriangle className="w-8 h-8 mx-auto mb-2" style={{ color: "var(--lux-accent)" }} />
                  <p className="text-sm" style={{ color: "var(--lux-text-muted)" }}>Failed to load webhooks</p>
                  <Button variant="ghost" size="sm" className="mt-2" onClick={() => refetchWebhooks()} data-testid="button-retry-webhooks">
                    <RefreshCw className="w-3.5 h-3.5 mr-1" /> Retry
                  </Button>
                </div>
              ) : !webhooksData?.length ? (
                <div className="text-center py-8 rounded-lg" style={{ background: "var(--lux-bg)", border: "1px dashed var(--lux-border)" }}>
                  <Webhook className="w-8 h-8 mx-auto mb-2" style={{ color: "var(--lux-text-muted)" }} />
                  <p className="text-sm" style={{ color: "var(--lux-text-muted)" }}>No webhook endpoints configured</p>
                  <p className="text-xs mt-1" style={{ color: "var(--lux-text-muted)" }}>Add one to start receiving event notifications</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {webhooksData.map((wh: any) => (
                    <div
                      key={wh.id}
                      className="rounded-lg p-4"
                      style={{ background: "var(--lux-surface-alt)", border: "1px solid var(--lux-border)" }}
                      data-testid={`row-webhook-${wh.id}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Globe className="w-4 h-4 flex-shrink-0" style={{ color: "var(--lux-accent)" }} />
                            <code className="text-sm font-mono truncate block" style={{ color: "var(--lux-text)" }} data-testid={`text-webhook-url-${wh.id}`}>
                              {wh.url}
                            </code>
                            {wh.isActive ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e" }}>Active</span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>Inactive</span>
                            )}
                          </div>
                          {wh.description && (
                            <p className="text-xs ml-6 mb-1" style={{ color: "var(--lux-text-muted)" }}>{wh.description}</p>
                          )}
                          <div className="flex flex-wrap gap-1.5 ml-6 mt-2">
                            {(wh.events || []).map((evt: string) => (
                              <span key={evt} className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: "var(--lux-bg)", color: "var(--lux-text-secondary)", border: "1px solid var(--lux-border)" }}>
                                {evt}
                              </span>
                            ))}
                          </div>
                          <div className="flex items-center gap-4 ml-6 mt-2">
                            {wh.lastDeliveryAt && (
                              <span className="text-[10px]" style={{ color: "var(--lux-text-muted)" }}>
                                Last delivery: {new Date(wh.lastDeliveryAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })} —{" "}
                                <span style={{ color: wh.lastDeliveryStatus === "delivered" ? "#22c55e" : "#ef4444" }}>
                                  {wh.lastDeliveryStatus}
                                </span>
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => testWebhookMutation.mutate(wh.id)} disabled={testWebhookMutation.isPending} title="Send test ping" aria-label="Send test ping" data-testid={`button-test-webhook-${wh.id}`}>
                            {testWebhookMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "var(--lux-text-muted)" }} /> : <Activity className="w-3.5 h-3.5" style={{ color: "var(--lux-text-muted)" }} />}
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEditWebhook(wh)} title="Edit endpoint" aria-label="Edit webhook endpoint" data-testid={`button-edit-webhook-${wh.id}`}>
                            <Pencil className="w-3.5 h-3.5" style={{ color: "var(--lux-text-muted)" }} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => {
                              if (confirm("Delete this webhook endpoint? All delivery history will be lost.")) {
                                deleteWebhookMutation.mutate(wh.id);
                              }
                            }}
                            disabled={deleteWebhookMutation.isPending}
                            title="Delete endpoint"
                            aria-label="Delete webhook endpoint"
                            data-testid={`button-delete-webhook-${wh.id}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" style={{ color: "#ef4444" }} />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }} data-testid="card-api-docs">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <Code className="w-5 h-5" style={{ color: "var(--lux-accent)" }} />
                <div>
                  <h3 className="font-semibold" style={{ color: "var(--lux-text)" }}>API Documentation</h3>
                  <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>REST API reference for external integrations</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-lg p-4" style={{ background: "var(--lux-bg)", border: "1px solid var(--lux-border)" }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Base URL</span>
                  </div>
                  <code className="text-sm font-mono block" style={{ color: "var(--lux-text)" }} data-testid="text-api-base-url">
                    {window.location.origin}/api/v1
                  </code>
                </div>

                <div className="rounded-lg p-4" style={{ background: "var(--lux-bg)", border: "1px solid var(--lux-border)" }}>
                  <h4 className="text-sm font-semibold mb-3" style={{ color: "var(--lux-text)" }}>Authentication</h4>
                  <p className="text-xs mb-2" style={{ color: "var(--lux-text-muted)" }}>Include your API key in the Authorization header:</p>
                  <pre className="text-xs font-mono rounded-lg p-3 overflow-x-auto" style={{ background: "var(--lux-surface-alt)", color: "var(--lux-text-secondary)", border: "1px solid var(--lux-border)" }}>
{`Authorization: Bearer cwp_your_api_key_here`}
                  </pre>
                </div>

                <div className="rounded-lg p-4" style={{ background: "var(--lux-bg)", border: "1px solid var(--lux-border)" }}>
                  <h4 className="text-sm font-semibold mb-3" style={{ color: "var(--lux-text)" }}>Available Endpoints</h4>
                  <div className="space-y-2">
                    {[
                      { method: "GET", path: "/api/v1/clients", filters: "?limit=50&offset=0" },
                      { method: "GET", path: "/api/v1/clients/:id", filters: "" },
                      { method: "POST", path: "/api/v1/clients", filters: "" },
                      { method: "GET", path: "/api/v1/invoices", filters: "?limit=50&offset=0&status=SENT" },
                      { method: "GET", path: "/api/v1/invoices/:id", filters: "" },
                      { method: "POST", path: "/api/v1/invoices", filters: "(DRAFT only)" },
                      { method: "GET", path: "/api/v1/payments", filters: "?limit=50&offset=0" },
                      { method: "GET", path: "/api/v1/payments/:id", filters: "" },
                      { method: "GET", path: "/api/v1/time-entries", filters: "?limit=50&offset=0&userId=...&projectId=..." },
                      { method: "POST", path: "/api/v1/time-entries", filters: "" },
                      { method: "GET", path: "/api/v1/projects", filters: "?limit=50&offset=0&status=ACTIVE" },
                      { method: "GET", path: "/api/v1/projects/:id", filters: "" },
                      { method: "POST", path: "/api/v1/projects", filters: "" },
                      { method: "GET", path: "/api/v1/team", filters: "?limit=50&offset=0&role=TEAM_MEMBER" },
                    ].map(ep => (
                      <div key={`${ep.method}-${ep.path}`} className="flex items-center gap-2 text-xs font-mono" data-testid={`api-endpoint-${ep.method.toLowerCase()}-${ep.path.replace(/[/:]/g, "-")}`}>
                        <span className="inline-block w-12 text-center px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: ep.method === "POST" ? "rgba(59,130,246,0.1)" : "rgba(34,197,94,0.1)", color: ep.method === "POST" ? "#3b82f6" : "#22c55e" }}>
                          {ep.method}
                        </span>
                        <span style={{ color: "var(--lux-text)" }}>{ep.path}</span>
                        {ep.filters && <span style={{ color: "var(--lux-text-muted)" }}>{ep.filters}</span>}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg p-4" style={{ background: "var(--lux-bg)", border: "1px solid var(--lux-border)" }}>
                  <h4 className="text-sm font-semibold mb-3" style={{ color: "var(--lux-text)" }}>Example Requests</h4>
                  <p className="text-xs mb-2 font-medium" style={{ color: "var(--lux-text-muted)" }}>Read (GET)</p>
                  <pre className="text-xs font-mono rounded-lg p-3 overflow-x-auto whitespace-pre-wrap mb-3" style={{ background: "var(--lux-surface-alt)", color: "var(--lux-text-secondary)", border: "1px solid var(--lux-border)" }}>
{`curl -X GET "${window.location.origin}/api/v1/invoices?limit=10&status=SENT" \\
  -H "X-API-Key: cwp_your_api_key_here"`}
                  </pre>
                  <p className="text-xs mb-2 font-medium" style={{ color: "var(--lux-text-muted)" }}>Create Client (POST)</p>
                  <pre className="text-xs font-mono rounded-lg p-3 overflow-x-auto whitespace-pre-wrap mb-3" style={{ background: "var(--lux-surface-alt)", color: "var(--lux-text-secondary)", border: "1px solid var(--lux-border)" }}>
{`curl -X POST "${window.location.origin}/api/v1/clients" \\
  -H "X-API-Key: cwp_your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Acme Corp","email":"billing@acme.com"}'`}
                  </pre>
                  <p className="text-xs mb-2 font-medium" style={{ color: "var(--lux-text-muted)" }}>Create Project (POST)</p>
                  <pre className="text-xs font-mono rounded-lg p-3 overflow-x-auto whitespace-pre-wrap mb-3" style={{ background: "var(--lux-surface-alt)", color: "var(--lux-text-secondary)", border: "1px solid var(--lux-border)" }}>
{`curl -X POST "${window.location.origin}/api/v1/projects" \\
  -H "X-API-Key: cwp_your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{"clientId":"<client-id>","name":"Website Redesign"}'`}
                  </pre>
                  <p className="text-xs mb-2 font-medium" style={{ color: "var(--lux-text-muted)" }}>Create Time Entry (POST)</p>
                  <pre className="text-xs font-mono rounded-lg p-3 overflow-x-auto whitespace-pre-wrap mb-3" style={{ background: "var(--lux-surface-alt)", color: "var(--lux-text-secondary)", border: "1px solid var(--lux-border)" }}>
{`curl -X POST "${window.location.origin}/api/v1/time-entries" \\
  -H "X-API-Key: cwp_your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{"projectId":"<project-id>","userId":"<user-id>","date":"2026-04-09","minutes":120,"billable":true,"notes":"API integration work"}'`}
                  </pre>
                  <p className="text-xs mb-2 font-medium" style={{ color: "var(--lux-text-muted)" }}>Create Draft Invoice (POST)</p>
                  <pre className="text-xs font-mono rounded-lg p-3 overflow-x-auto whitespace-pre-wrap" style={{ background: "var(--lux-surface-alt)", color: "var(--lux-text-secondary)", border: "1px solid var(--lux-border)" }}>
{`curl -X POST "${window.location.origin}/api/v1/invoices" \\
  -H "X-API-Key: cwp_your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{"clientId":"<client-id>","issuedDate":"2026-04-09","dueDate":"2026-05-09","currency":"USD"}'`}
                  </pre>
                  <p className="text-xs mt-2" style={{ color: "var(--lux-text-muted)" }}>Write endpoints are rate-limited to 60 requests/min per API key. Invoices are always created as DRAFT.</p>
                </div>

                <div className="rounded-lg p-4" style={{ background: "var(--lux-bg)", border: "1px solid var(--lux-border)" }}>
                  <h4 className="text-sm font-semibold mb-3" style={{ color: "var(--lux-text)" }}>Webhook Events</h4>
                  <p className="text-xs mb-2" style={{ color: "var(--lux-text-muted)" }}>All webhook payloads are signed with HMAC-SHA256. Verify using the <code className="px-1 rounded" style={{ background: "var(--lux-surface-alt)" }}>X-Signature-256</code> header.</p>
                  <div className="grid grid-cols-2 gap-2">
                    {ALL_WEBHOOK_EVENTS.map(evt => (
                      <div key={evt} className="flex items-center gap-2 text-xs" data-testid={`webhook-event-doc-${evt}`}>
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: "var(--lux-accent)" }} />
                        <code style={{ color: "var(--lux-text-secondary)" }}>{evt}</code>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

      <Dialog open={showCreateKeyDialog} onOpenChange={setShowCreateKeyDialog}>
        <DialogContent className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
          <DialogHeader>
            <DialogTitle style={{ color: "var(--lux-text)" }}>Create API Key</DialogTitle>
            <DialogDescription style={{ color: "var(--lux-text-muted)" }}>
              Generate a new API key for external integrations. The full key will only be shown once.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="mb-1.5 block" style={{ color: "var(--lux-text-secondary)" }}>Key Name</Label>
              <Input
                value={newKeyName}
                onChange={e => setNewKeyName(e.target.value)}
                placeholder="e.g. Zapier Integration"
                data-testid="input-api-key-name"
              />
            </div>
            <div>
              <Label className="mb-2 block" style={{ color: "var(--lux-text-secondary)" }}>Permissions</Label>
              <div className="grid grid-cols-2 gap-2">
                {ALL_PERMISSIONS.map(perm => (
                  <label
                    key={perm}
                    className="flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer transition-colors text-xs"
                    style={{ background: newKeyPermissions.includes(perm) ? "var(--lux-bg)" : "transparent", border: `1px solid ${newKeyPermissions.includes(perm) ? "var(--lux-accent)" : "var(--lux-border)"}` }}
                    data-testid={`checkbox-perm-${perm}`}
                  >
                    <Checkbox
                      checked={newKeyPermissions.includes(perm)}
                      onCheckedChange={() => togglePermission(perm)}
                    />
                    <span style={{ color: "var(--lux-text)" }}>{perm}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateKeyDialog(false)} data-testid="button-cancel-create-key">Cancel</Button>
            <Button
              className="text-white"
              style={{ background: "var(--gradient-brand)" }}
              onClick={() => createKeyMutation.mutate()}
              disabled={!newKeyName.trim() || newKeyPermissions.length === 0 || createKeyMutation.isPending}
              data-testid="button-confirm-create-key"
            >
              {createKeyMutation.isPending ? "Creating..." : "Create Key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!createdKeyValue} onOpenChange={open => { if (!open) setCreatedKeyValue(null); }}>
        <DialogContent className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
          <DialogHeader>
            <DialogTitle style={{ color: "var(--lux-text)" }}>Your API Key</DialogTitle>
            <DialogDescription style={{ color: "var(--lux-text-muted)" }}>
              Copy this key now. It will not be shown again for security reasons.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <div className="flex items-center gap-2 rounded-lg p-3" style={{ background: "var(--lux-bg)", border: "1px solid var(--lux-border)" }}>
              <code className="flex-1 text-sm font-mono break-all" style={{ color: "var(--lux-text)" }} data-testid="text-created-key-value">
                {createdKeyValue}
              </code>
              <Button
                variant="ghost"
                size="sm"
                className="flex-shrink-0"
                onClick={() => copyToClipboard(createdKeyValue || "")}
                data-testid="button-copy-api-key"
              >
                {keyCopied ? <Check className="w-4 h-4" style={{ color: "#22c55e" }} /> : <Copy className="w-4 h-4" style={{ color: "var(--lux-text-muted)" }} />}
              </Button>
            </div>
            <div className="flex items-center gap-2 mt-3 p-2 rounded-lg" style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)" }}>
              <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: "#f59e0b" }} />
              <span className="text-xs" style={{ color: "#f59e0b" }}>Store this key securely. You will not be able to see it again.</span>
            </div>
          </div>
          <DialogFooter>
            <Button className="text-white" style={{ background: "var(--gradient-brand)" }} onClick={() => setCreatedKeyValue(null)} data-testid="button-close-key-dialog">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showWebhookDialog} onOpenChange={open => { if (!open) resetWebhookForm(); }}>
        <DialogContent className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
          <DialogHeader>
            <DialogTitle style={{ color: "var(--lux-text)" }}>{editingWebhookId ? "Edit Webhook Endpoint" : "Add Webhook Endpoint"}</DialogTitle>
            <DialogDescription style={{ color: "var(--lux-text-muted)" }}>
              {editingWebhookId ? "Update the endpoint configuration." : "Configure a URL to receive event notifications via HTTP POST."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="mb-1.5 block" style={{ color: "var(--lux-text-secondary)" }}>Endpoint URL</Label>
              <Input
                value={webhookUrl}
                onChange={e => setWebhookUrl(e.target.value)}
                placeholder="https://example.com/webhooks/cherryworks"
                type="url"
                data-testid="input-webhook-url"
              />
              {webhookUrlInvalid && (
                <p className="text-xs mt-1" style={{ color: "#ef4444" }} data-testid="text-webhook-url-error">
                  Please enter a valid URL starting with https://
                </p>
              )}
            </div>
            <div>
              <Label className="mb-1.5 block" style={{ color: "var(--lux-text-secondary)" }}>Description (optional)</Label>
              <Input
                value={webhookDescription}
                onChange={e => setWebhookDescription(e.target.value)}
                placeholder="e.g. Zapier catch hook for invoices"
                data-testid="input-webhook-description"
              />
            </div>
            <div>
              <Label className="mb-2 block" style={{ color: "var(--lux-text-secondary)" }}>Events</Label>
              <div className="grid grid-cols-2 gap-2">
                {ALL_WEBHOOK_EVENTS.map(evt => (
                  <label
                    key={evt}
                    className="flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer transition-colors text-xs"
                    style={{ background: webhookEvents.includes(evt) ? "var(--lux-bg)" : "transparent", border: `1px solid ${webhookEvents.includes(evt) ? "var(--lux-accent)" : "var(--lux-border)"}` }}
                    data-testid={`checkbox-event-${evt}`}
                  >
                    <Checkbox
                      checked={webhookEvents.includes(evt)}
                      onCheckedChange={() => toggleWebhookEvent(evt)}
                    />
                    <span style={{ color: "var(--lux-text)" }}>{evt}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => resetWebhookForm()} data-testid="button-cancel-webhook">Cancel</Button>
            <Button
              className="text-white"
              style={{ background: "var(--gradient-brand)" }}
              onClick={() => editingWebhookId ? updateWebhookMutation.mutate() : createWebhookMutation.mutate()}
              disabled={!webhookUrl.trim() || webhookUrlInvalid || webhookEvents.length === 0 || createWebhookMutation.isPending || updateWebhookMutation.isPending}
              data-testid="button-confirm-webhook"
            >
              {(createWebhookMutation.isPending || updateWebhookMutation.isPending) ? "Saving..." : editingWebhookId ? "Update" : "Add Endpoint"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </UpgradeWall>
    </>
  );
}
