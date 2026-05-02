import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, getCSRFToken } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PageHelpLink } from "@/components/page-help-link";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useEffect, useMemo, useRef } from "react";
import { Send, Camera, FileText, Clock, Percent, Building2, Mail, Phone, Plus, Pencil, Trash2, Tag, DollarSign, X, Check, Layers, Server, Shield, Eye, EyeOff, Info, ChevronDown, ChevronUp, BookOpen, CreditCard, ExternalLink, Receipt, Tags, Calculator, Copy, Globe, Link2, Unlink, AlertTriangle, ArrowLeft } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { FormSection } from "@/components/shared/form-section";
import { AddressInput } from "@/components/shared/address-input";
import { AddressDisplay } from "@/components/shared/address-display";
import { StatCard } from "@/components/shared/stat-card";
import { formatMoney, formatPercent, formatRate } from "@/components/shared/format";
import { useBaseCurrency } from "@/hooks/use-base-currency";
import { CURRENCIES } from "../../../shared/currencies";
import { MoneyDisplay } from "@/components/shared/money-display";
import { useDocumentTitle } from "@/lib/use-document-title";
import { useAuth } from "@/lib/auth";
import { Link, useLocation } from "wouter";
import { MailboxReconnectBanner } from "@/components/mailbox-reconnect-banner";
import { EmailTransportHealthPanel } from "@/components/email-transport-health-panel";
import { EmailAlertWebhookPanel } from "@/components/email-alert-webhook-panel";

interface ServiceItem {
  id: string;
  name: string;
  description: string | null;
  defaultRate: string | null;
  isActive: boolean;
}

function readAddressFields(org: any) {
  return {
    addressStreet: org.addressStreet || "",
    addressSuite: org.addressSuite || "",
    addressCity: org.addressCity || "",
    addressState: org.addressState || "",
    addressZip: org.addressZip || "",
    addressCountry: org.addressCountry || "",
  };
}

function MailboxErrorDetails({
  providerLabel,
  message,
  lastErrorAt,
}: {
  providerLabel: string;
  message: string;
  lastErrorAt: string | null;
}) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const trimmed = message.trim();
  const PREVIEW = 160;
  const isLong = trimmed.length > PREVIEW;
  const preview = isLong ? `${trimmed.slice(0, PREVIEW).trimEnd()}…` : trimmed;
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(trimmed);
      toast({ title: "Error message copied" });
    } catch {
      toast({ title: "Could not copy", variant: "destructive" });
    }
  };
  return (
    <div
      className="mt-2 rounded border px-3 py-2 text-xs"
      style={{ background: "rgba(245,158,11,0.08)", borderColor: "rgba(245,158,11,0.35)", color: "var(--lux-text)" }}
      data-testid="container-mailbox-settings-error"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium uppercase tracking-wide text-[11px]" style={{ color: "var(--lux-text-muted)" }}>
          {providerLabel} reported{lastErrorAt ? ` · ${new Date(lastErrorAt).toLocaleString()}` : ""}
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium hover:underline underline-offset-2"
          style={{ color: "var(--color-accent)" }}
          data-testid="button-mailbox-settings-copy-error"
          aria-label="Copy error message"
        >
          <Copy className="w-3 h-3" aria-hidden="true" />
          Copy
        </button>
      </div>
      <p
        className="mt-1 whitespace-pre-wrap break-words font-mono text-[12px] leading-snug"
        data-testid="text-mailbox-settings-error"
      >
        {isLong && !open ? preview : trimmed}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-1 font-medium underline underline-offset-2"
          style={{ color: "var(--color-accent)" }}
          data-testid="button-mailbox-settings-toggle-details"
          aria-expanded={open}
        >
          {open ? "Hide details" : "Show details"}
        </button>
      )}
    </div>
  );
}

export default function SettingsPage() {
  useDocumentTitle("Settings");
  const { toast } = useToast();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const baseCurrency = useBaseCurrency();
  const isAdmin = user?.role === "ADMIN";
  const { data: org, isLoading } = useQuery<any>({
    queryKey: ["/api/org/settings"],
  });

  const { data: billingStatus, isLoading: billingLoading, isError: billingError, refetch: refetchBilling } = useQuery<any>({
    queryKey: ["/api/billing/status"],
    enabled: isAdmin && !!user,
    retry: 2,
    staleTime: 30000,
  });

  const [portalLoading, setPortalLoading] = useState(false);

  const { data: services } = useQuery<ServiceItem[]>({
    queryKey: ["/api/services"],
  });

  const { data: expenseCategories } = useQuery<any[]>({
    queryKey: ["/api/admin/expense-categories"],
  });

  const { data: smtpSettings, isLoading: smtpLoading } = useQuery<any>({
    queryKey: ["/api/org/smtp-settings"],
  });

  const { data: platformOperator } = useQuery<{ isPlatformOperator: boolean }>({
    queryKey: ["/api/auth/me/platform-operator"],
  });
  const isPlatformOperator = platformOperator?.isPlatformOperator === true;

  const oauthFlagEnabled = import.meta.env.VITE_EMAIL_OAUTH_ENABLED === "true";

  const { data: emailProvider } = useQuery<{
    providerType: "smtp" | "m365" | "google";
    senderAddress: string | null;
    isConnected: boolean;
    connectedAt: string | null;
    scopes: string | null;
    oauthFlagEnabled: boolean;
    status?: "ok" | "needs_reconnect";
    lastErrorMessage?: string | null;
    lastErrorAt?: string | null;
    failedSendCount?: number;
  }>({
    queryKey: ["/api/org/email-provider"],
  });

  const providerType = emailProvider?.providerType ?? "smtp";

  const setProviderTypeMutation = useMutation({
    mutationFn: async (next: "smtp" | "m365" | "google") => {
      await apiRequest("PUT", "/api/org/email-provider", { providerType: next });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/org/email-provider"] });
      toast({ title: "Email provider updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const disconnectMailboxMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", "/api/org/email-provider/oauth");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/org/email-provider"] });
      toast({ title: "Mailbox disconnected" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const [testEmailDialogOpen, setTestEmailDialogOpen] = useState(false);
  const [testEmailRecipient, setTestEmailRecipient] = useState("");

  useEffect(() => {
    if (testEmailDialogOpen && !testEmailRecipient && user?.email) {
      setTestEmailRecipient(user.email);
    }
  }, [testEmailDialogOpen, user?.email, testEmailRecipient]);

  const sendTestEmailMutation = useMutation<
    { ok: true; sentAt: string; providerMessageId: string; provider: string },
    Error,
    string
  >({
    mutationFn: async (to: string) => {
      const res = await apiRequest("POST", "/api/email/test-send", { to });
      return res.json();
    },
    onSuccess: (data, recipient) => {
      const sentLocal = data?.sentAt
        ? new Date(data.sentAt).toLocaleTimeString()
        : new Date().toLocaleTimeString();
      toast({
        title: "Test email sent",
        description: `Sent to ${recipient} at ${sentLocal}.`,
      });
      window.setTimeout(() => setTestEmailDialogOpen(false), 1500);
    },
    onError: (err) => {
      toast({
        title: "Test email failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const oauthPopupRef = useRef<Window | null>(null);
  const oauthPollRef = useRef<number | null>(null);

  function clearOauthPoll() {
    if (oauthPollRef.current !== null) {
      window.clearInterval(oauthPollRef.current);
      oauthPollRef.current = null;
    }
  }

  function openOauthPopup(provider: "microsoft" | "google") {
    const url = `/api/auth/oauth/${provider}/start`;
    clearOauthPoll();
    const popup = window.open(url, "_blank", "width=520,height=720");
    oauthPopupRef.current = popup;
    if (!popup || popup.closed || typeof popup.closed === "undefined") {
      toast({
        title: "Allow popups for this site to connect your mailbox.",
        description:
          "Your browser blocked the connection window. Enable popups for this site in the address bar, then try again.",
        variant: "destructive",
      });
      return;
    }
    oauthPollRef.current = window.setInterval(() => {
      const p = oauthPopupRef.current;
      if (!p || p.closed) {
        clearOauthPoll();
        oauthPopupRef.current = null;
        // Fallback to the postMessage path: when the popup closes for any
        // reason (success, cancel, or postMessage silently dropped by COOP),
        // refetch the mailbox status. No toast here — the message listener
        // already toasts on the fast path; firing another would duplicate.
        queryClient.invalidateQueries({ queryKey: ["/api/org/email-provider"] });
      }
    }, 500);
  }

  useEffect(() => {
    return () => {
      clearOauthPoll();
    };
  }, []);

  useEffect(() => {
    // De-dupe between BroadcastChannel and postMessage paths: when the same
    // result arrives via both channels in quick succession, only act once.
    let lastKey = "";
    let lastAt = 0;
    function handle(data: any) {
      if (!data || typeof data !== "object") return;
      const validProvider = data.provider === "m365" || data.provider === "google";
      if (!validProvider) return;
      const key = `${data.type}|${data.provider}|${data.error ?? ""}`;
      const now = Date.now();
      if (key === lastKey && now - lastAt < 2000) return;
      lastKey = key;
      lastAt = now;
      if (data.type === "oauth-mailbox-success") {
        queryClient.invalidateQueries({ queryKey: ["/api/org/email-provider"] });
        toast({ title: "Mailbox connected" });
      } else if (data.type === "oauth-mailbox-error") {
        toast({
          title: "Mailbox connection failed",
          description: typeof data.error === "string" ? data.error : undefined,
          variant: "destructive",
        });
      }
    }
    function onMessage(ev: MessageEvent) {
      if (ev.origin !== window.location.origin) return;
      handle(ev.data);
    }
    window.addEventListener("message", onMessage);
    // BroadcastChannel: same-origin signaling that survives Cross-Origin-Opener-Policy
    // isolation imposed during the Microsoft/Google redirect chain.
    let bc: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== "undefined") {
        bc = new BroadcastChannel("oauth-mailbox");
        bc.onmessage = (ev) => handle(ev.data);
      }
    } catch {
      // ignore
    }
    return () => {
      window.removeEventListener("message", onMessage);
      try { bc?.close(); } catch { /* ignore */ }
    };
  }, [toast]);

  const [smtpForm, setSmtpForm] = useState({
    smtpHost: "",
    smtpPort: "587",
    smtpUser: "",
    smtpPass: "",
    smtpFromName: "",
    smtpFromEmail: "",
    smtpReplyTo: "",
  });
  const [showSmtpPassword, setShowSmtpPassword] = useState(false);
  const [showProviderRef, setShowProviderRef] = useState(false);
  const [smtpEditing, setSmtpEditing] = useState(false);
  const [testEmailTo, setTestEmailTo] = useState("");

  useEffect(() => {
    if (smtpSettings?.configured) {
      setSmtpForm({
        smtpHost: smtpSettings.smtpHost || "",
        smtpPort: String(smtpSettings.smtpPort || "587"),
        smtpUser: smtpSettings.smtpUser || "",
        smtpPass: "",
        smtpFromName: smtpSettings.smtpFromName || "",
        smtpFromEmail: smtpSettings.smtpFromEmail || "",
        smtpReplyTo: smtpSettings.smtpReplyTo || "",
      });
    }
  }, [smtpSettings]);

  const saveSmtpMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PUT", "/api/org/smtp-settings", {
        smtpHost: smtpForm.smtpHost,
        smtpPort: Number(smtpForm.smtpPort),
        smtpUser: smtpForm.smtpUser,
        smtpPass: smtpForm.smtpPass || undefined,
        smtpFromName: smtpForm.smtpFromName || "",
        smtpFromEmail: smtpForm.smtpFromEmail || "",
        smtpReplyTo: smtpForm.smtpReplyTo || "",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/org/smtp-settings"] });
      setSmtpEditing(false);
      setSmtpForm(prev => ({ ...prev, smtpPass: "" }));
      toast({ title: "Email settings saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const removeSmtpMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", "/api/org/smtp-settings");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/org/smtp-settings"] });
      setSmtpForm({ smtpHost: "", smtpPort: "587", smtpUser: "", smtpPass: "", smtpFromName: "", smtpFromEmail: "", smtpReplyTo: "" });
      setSmtpEditing(false);
      toast({ title: "Email settings removed" });
    },
  });

  const testEmailMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/test-email", { to: testEmailTo || org?.email });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/org/smtp-settings"] });
      toast({ title: "Test email sent", description: data.previewUrl ? "Check Ethereal preview" : "Check your inbox" });
    },
    onError: (err: Error) => {
      toast({ title: "Test email failed", description: err.message, variant: "destructive" });
    },
  });

  const [form, setForm] = useState({
    invoicePrefix: "",
    estimatePrefix: "",
    defaultPaymentTermsDays: "30",
    defaultTaxRate: "0",
    baseCurrency: "USD",
    addressStreet: "",
    addressSuite: "",
    addressCity: "",
    addressState: "",
    addressZip: "",
    addressCountry: "",
    phone: "",
    email: "",
    website: "",
    reminderEnabled: false,
    reminderDaysOverdue: "7,14,30",
    reminderSubjectTemplate: "",
    reminderBodyTemplate: "",
    invoiceTheme: "classic",
    autoPostJournalEntries: true,
    defaultBillRate: "125",
    marketingSendMaxAttempts: "5",
    marketingSendRetryBaseMinutes: "5",
    marketingLargeAudienceThreshold: "1000",
  });

  // ── Expense categories ──
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatGlCode, setNewCatGlCode] = useState("");
  const [newCatDescription, setNewCatDescription] = useState("");
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editCatName, setEditCatName] = useState("");
  const [editCatGlCode, setEditCatGlCode] = useState("");
  const [editCatDescription, setEditCatDescription] = useState("");

  const createCategoryMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/expense-categories", {
        name: newCatName,
        glCode: newCatGlCode || null,
        description: newCatDescription || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/expense-categories"] });
      setNewCatName(""); setNewCatGlCode(""); setNewCatDescription("");
      setShowAddCategory(false);
      toast({ title: "Category created" });
    },
    onError: (err: Error) => { toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  const updateCategoryMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("PATCH", `/api/expense-categories/${id}`, {
        name: editCatName,
        glCode: editCatGlCode || null,
        description: editCatDescription || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/expense-categories"] });
      setEditingCatId(null);
      toast({ title: "Category updated" });
    },
    onError: (err: Error) => { toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  const toggleCategoryMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      await apiRequest("PATCH", `/api/expense-categories/${id}`, { isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/expense-categories"] });
      toast({ title: "Category updated" });
    },
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/expense-categories/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/expense-categories"] });
      toast({ title: "Category deleted" });
    },
    onError: (err: Error) => { toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  function startEditCategory(cat: any) {
    setEditingCatId(cat.id);
    setEditCatName(cat.name);
    setEditCatGlCode(cat.glCode || "");
    setEditCatDescription(cat.description || "");
  }

  const activeCats = (expenseCategories || []).filter(c => c.isActive);
  const inactiveCats = (expenseCategories || []).filter(c => !c.isActive);

  const [showAddService, setShowAddService] = useState(false);
  const [newServiceName, setNewServiceName] = useState("");
  const [newServiceDescription, setNewServiceDescription] = useState("");
  const [newServiceRate, setNewServiceRate] = useState("");
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [editServiceName, setEditServiceName] = useState("");
  const [editServiceDescription, setEditServiceDescription] = useState("");
  const [editServiceRate, setEditServiceRate] = useState("");

  useEffect(() => {
    if (org) {
      const next = {
        invoicePrefix: org.invoicePrefix || "",
        estimatePrefix: org.estimatePrefix || "",
        defaultPaymentTermsDays: String(org.defaultPaymentTermsDays ?? 30),
        defaultTaxRate: String(org.defaultTaxRate ?? 0),
        baseCurrency: org.baseCurrency || "USD",
        ...readAddressFields(org),
        phone: org.phone || "",
        email: org.email || "",
        website: org.website || "",
        reminderEnabled: org.reminderEnabled ?? false,
        reminderDaysOverdue: Array.isArray(org.reminderDaysOverdue) ? org.reminderDaysOverdue.join(",") : (org.reminderDaysOverdue || "7,14,30"),
        reminderSubjectTemplate: org.reminderSubjectTemplate || "",
        reminderBodyTemplate: org.reminderBodyTemplate || "",
        invoiceTheme: org.invoiceTheme || "classic",
        autoPostJournalEntries: org.autoPostJournalEntries ?? true,
        defaultBillRate: String(org.defaultBillRate ?? 125),
        marketingSendMaxAttempts: String(org.marketingSendMaxAttempts ?? 5),
        marketingSendRetryBaseMinutes: String(
          Math.max(1, Math.round((org.marketingSendRetryBaseMs ?? 300000) / 60000)),
        ),
        marketingLargeAudienceThreshold: String(org.marketingLargeAudienceThreshold ?? 1000),
      };
      setForm(next);
      setSavedForm(next);
    }
  }, [org]);

  const [savedForm, setSavedForm] = useState(form);

  const isDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(savedForm), [form, savedForm]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const saveMutation = useMutation({
    mutationFn: (data: any) => apiRequest("PATCH", "/api/org/settings", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/org/settings"] });
      setSavedForm(form);
      toast({ title: "Settings saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save settings", description: err.message, variant: "destructive" });
    },
  });

  const createServiceMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/services", {
        name: newServiceName,
        description: newServiceDescription || null,
        defaultRate: newServiceRate ? Number(newServiceRate) : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/services"] });
      setNewServiceName("");
      setNewServiceDescription("");
      setNewServiceRate("");
      setShowAddService(false);
      toast({ title: "Service created" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateServiceMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("PATCH", `/api/services/${id}`, {
        name: editServiceName,
        description: editServiceDescription || null,
        defaultRate: editServiceRate ? Number(editServiceRate) : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/services"] });
      setEditingServiceId(null);
      toast({ title: "Service updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const toggleServiceMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      await apiRequest("PATCH", `/api/services/${id}`, { isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/services"] });
      toast({ title: "Service updated" });
    },
  });

  const sendRemindersMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/reminders/process");
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: `Reminders: ${data.sent} sent, ${data.skipped} skipped, ${data.errors} errors` });
    },
    onError: () => {
      toast({ title: "Failed to process reminders", variant: "destructive" });
    },
  });

  function startEditService(svc: ServiceItem) {
    setEditingServiceId(svc.id);
    setEditServiceName(svc.name);
    setEditServiceDescription(svc.description || "");
    setEditServiceRate(svc.defaultRate || "");
  }

  function handleSave() {
    saveMutation.mutate({
      invoicePrefix: form.invoicePrefix || null,
      estimatePrefix: form.estimatePrefix || null,
      defaultPaymentTermsDays: Number(form.defaultPaymentTermsDays),
      defaultTaxRate: Number(form.defaultTaxRate),
      baseCurrency: form.baseCurrency,
      addressStreet: form.addressStreet || null,
      addressSuite: form.addressSuite || null,
      addressCity: form.addressCity || null,
      addressState: form.addressState || null,
      addressZip: form.addressZip || null,
      addressCountry: form.addressCountry || null,
      phone: form.phone || null,
      email: form.email || null,
      website: form.website || null,
      reminderEnabled: form.reminderEnabled,
      reminderDaysOverdue: form.reminderDaysOverdue || null,
      reminderSubjectTemplate: form.reminderSubjectTemplate || null,
      reminderBodyTemplate: form.reminderBodyTemplate || null,
      invoiceTheme: form.invoiceTheme,
      autoPostJournalEntries: form.autoPostJournalEntries,
      defaultBillRate: Number(form.defaultBillRate) || 125,
      marketingSendMaxAttempts: Math.max(1, Math.min(20, Number(form.marketingSendMaxAttempts) || 5)),
      marketingSendRetryBaseMs: Math.max(
        1_000,
        Math.min(24 * 60 * 60 * 1000, (Number(form.marketingSendRetryBaseMinutes) || 5) * 60_000),
      ),
      marketingLargeAudienceThreshold: Math.max(
        1,
        Math.min(10_000_000, Number(form.marketingLargeAudienceThreshold) || 1000),
      ),
    });
  }

  const validTabIds = ["organization", "billing-invoicing", "services-categories", "accounting-email", ...(isAdmin ? ["subscription"] : [])];

  const [activeTab, setActiveTab] = useState(() => {
    const hash = window.location.hash.replace("#", "");
    return validTabIds.includes(hash) ? hash : "organization";
  });

  useEffect(() => {
    const onHash = () => {
      const hash = window.location.hash.replace("#", "");
      if (validTabIds.includes(hash)) setActiveTab(hash);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const switchTab = (tabId: string) => {
    setActiveTab(tabId);
    window.history.replaceState(null, "", `#${tabId}`);
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <p style={{ color: "var(--lux-text-muted)" }}>Loading settings...</p>
      </div>
    );
  }

  const activeServices = services?.filter(s => s.isActive) || [];
  const inactiveServices = services?.filter(s => !s.isActive) || [];

  const TABS = [
    { id: "organization", label: "Organization", icon: Building2 },
    { id: "billing-invoicing", label: "Billing & Invoicing", icon: Receipt },
    { id: "services-categories", label: "Services & Categories", icon: Tags },
    { id: "accounting-email", label: "Accounting & Email", icon: Calculator },
    ...(isAdmin ? [{ id: "subscription", label: "Subscription", icon: CreditCard }] : []),
  ] as const;

  return (
    <div className="px-6 lg:px-8 xl:px-10 py-6 max-w-5xl mx-auto">
      <PageBreadcrumbs group="System" page="Settings" className="mb-4" />
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-bold" style={{ color: "var(--lux-text)" }} data-testid="text-page-title">
          Organization Settings
        </h1>
        <PageHelpLink />
      </div>

      <div className="sticky top-0 z-10 -mx-6 lg:-mx-8 xl:-mx-10 px-6 lg:px-8 xl:px-10 pb-px" style={{ background: "var(--lux-bg)" }}>
        <nav className="flex gap-1 overflow-x-auto" style={{ borderBottom: "1px solid var(--lux-border)" }} data-testid="settings-tab-bar">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => switchTab(tab.id)}
                data-testid={`tab-${tab.id}`}
                className="flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors relative shrink-0"
                style={{
                  color: isActive ? "var(--lux-text)" : "var(--lux-text-muted)",
                  borderBottom: isActive ? "2px solid var(--lux-accent, #dc2626)" : "2px solid transparent",
                  marginBottom: "-1px",
                }}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="pt-6 space-y-6">

        {activeTab === "organization" && (
          <>
            <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
              <CardContent className="p-6">
                <div className="flex items-start gap-5 flex-wrap">
                  <div className="flex flex-col items-center gap-2">
                    <label className="cursor-pointer group relative" data-testid="logo-upload-area">
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const formData = new FormData();
                          formData.append("logo", file);
                          try {
                            const csrfToken = getCSRFToken();
                            const res = await fetch("/api/org/logo", { method: "POST", body: formData, credentials: "include", headers: csrfToken ? { "X-CSRF-Token": csrfToken } : {} });
                            if (!res.ok) throw new Error((await res.json()).message);
                            const data = await res.json();
                            queryClient.invalidateQueries({ queryKey: ["/api/org/settings"] });
                            toast({ title: "Logo uploaded" });
                          } catch (err: any) {
                            toast({ title: "Upload failed", description: err.message, variant: "destructive" });
                          }
                        }}
                      />
                      {org?.logoUrl ? (
                        <div className="relative">
                          <img
                            src={org.logoUrl}
                            alt="Logo"
                            className="rounded-full object-cover"
                            style={{ width: 64, height: 64 }}
                          />
                          <div className="absolute inset-0 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: "rgba(0,0,0,0.5)" }}>
                            <Camera className="w-5 h-5 text-white" />
                          </div>
                        </div>
                      ) : (
                        <div
                          className="rounded-full flex items-center justify-center transition-transform group-hover:scale-105"
                          style={{ width: 64, height: 64, background: "var(--gradient-brand)" }}
                        >
                          <Camera className="w-6 h-6 text-white" />
                        </div>
                      )}
                    </label>
                    <span className="text-[10px] font-medium" style={{ color: "var(--lux-text-muted)" }}>
                      {org?.logoUrl ? "Change Logo" : "Upload Logo"}
                    </span>
                    {org?.logoUrl && (
                      <button
                        className="text-[10px] font-medium cursor-pointer"
                        style={{ color: "#ef4444" }}
                        onClick={async () => {
                          try {
                            const csrfDel = getCSRFToken();
                            await fetch("/api/org/logo", { method: "DELETE", credentials: "include", headers: csrfDel ? { "X-CSRF-Token": csrfDel } : {} });
                            queryClient.invalidateQueries({ queryKey: ["/api/org/settings"] });
                            toast({ title: "Logo removed" });
                          } catch (err: any) {
                            toast({ title: "Error", description: err.message, variant: "destructive" });
                          }
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-lg font-bold" style={{ color: "var(--lux-text)" }} data-testid="text-org-name-header">
                      {org?.name || "Organization"}
                    </h2>
                    <div className="mt-2 space-y-1">
                      {form.email && (
                        <div className="flex items-center gap-2 text-sm" style={{ color: "var(--lux-text-secondary)" }}>
                          <Mail className="w-3.5 h-3.5" style={{ color: "var(--lux-text-muted)" }} />
                          <span data-testid="text-org-email-display">{form.email}</span>
                        </div>
                      )}
                      {form.phone && (
                        <div className="flex items-center gap-2 text-sm" style={{ color: "var(--lux-text-secondary)" }}>
                          <Phone className="w-3.5 h-3.5" style={{ color: "var(--lux-text-muted)" }} />
                          <span data-testid="text-org-phone-display">{form.phone}</span>
                        </div>
                      )}
                      <AddressDisplay
                        street={form.addressStreet}
                        suite={form.addressSuite}
                        city={form.addressCity}
                        state={form.addressState}
                        zip={form.addressZip}
                        country={form.addressCountry}
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
              <CardContent className="p-6">
                <FormSection title="Contact Details" description="Your organization's contact information">
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Organization Name</Label>
                        <Input value={org?.name || ""} disabled data-testid="input-org-name" />
                      </div>
                      <div>
                        <Label>Email</Label>
                        <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="org@example.com" data-testid="input-org-email" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Phone</Label>
                        <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="(area code) prefix-line" data-testid="input-org-phone" />
                      </div>
                      <div>
                        <Label>Website</Label>
                        <Input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://example.com" data-testid="input-org-website" />
                      </div>
                    </div>
                  </div>
                </FormSection>
              </CardContent>
            </Card>

            <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
              <CardContent className="p-6">
                <FormSection title="Address" description="Your organization's mailing address">
                  <div data-testid="input-org-address">
                    <AddressInput
                      fields={{
                        line1: form.addressStreet,
                        line2: form.addressSuite,
                        city: form.addressCity,
                        state: form.addressState,
                        postal: form.addressZip,
                        country: form.addressCountry,
                      }}
                      onFieldsChange={(f) => setForm(prev => ({
                        ...prev,
                        addressStreet: f.line1,
                        addressSuite: f.line2,
                        addressCity: f.city,
                        addressState: f.state,
                        addressZip: f.postal,
                        addressCountry: f.country,
                      }))}
                    />
                  </div>
                </FormSection>
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={saveMutation.isPending || !isDirty} data-testid="button-save-settings">
                {saveMutation.isPending ? "Saving..." : isDirty ? "Save Settings" : "Settings Saved"}
              </Button>
            </div>
          </>
        )}

        {activeTab === "billing-invoicing" && (
          <>
            <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
              <CardContent className="p-6">
                <FormSection title="Invoice & Estimate Theme" description="Choose how your PDF invoices and estimates look to clients">
                  <div className="grid grid-cols-2 gap-4">
                    {[
                      { id: "classic", name: "Classic", desc: "Cherry red header, clean lines, traditional", preview: "linear-gradient(135deg, #cf3339 0%, #cf3339 25%, #ffffff 25%)" },
                      { id: "modern", name: "Modern", desc: "Navy header band, gold accents, contemporary", preview: "linear-gradient(135deg, #0f172a 0%, #0f172a 25%, #ffffff 25%)" },
                      { id: "minimal", name: "Minimal", desc: "No color, thin hairlines, maximum whitespace", preview: "linear-gradient(135deg, #f8fafc 0%, #f8fafc 25%, #ffffff 25%)" },
                      { id: "bold", name: "Bold", desc: "Full cherry banner, white text, dramatic", preview: "linear-gradient(135deg, #cf3339 0%, #cf3339 40%, #0f172a 40%)" },
                    ].map((theme) => (
                      <button
                        key={theme.id}
                        type="button"
                        data-testid={`theme-${theme.id}`}
                        onClick={() => setForm({ ...form, invoiceTheme: theme.id })}
                        className="text-left rounded-xl p-4 transition-all hover:shadow-md"
                        style={{
                          border: form.invoiceTheme === theme.id ? "2px solid var(--color-accent)" : "1px solid var(--lux-border)",
                          background: form.invoiceTheme === theme.id ? "var(--color-accent-soft)" : "var(--lux-surface)",
                        }}
                      >
                        <div className="h-16 rounded-lg mb-3" style={{ background: theme.preview, border: "1px solid rgba(0,0,0,0.08)" }} />
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-bold" style={{ color: "var(--lux-text)" }}>{theme.name}</span>
                          {form.invoiceTheme === theme.id && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white" style={{ background: "var(--color-accent)" }}>Active</span>
                          )}
                        </div>
                        <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>{theme.desc}</p>
                      </button>
                    ))}
                  </div>
                </FormSection>
              </CardContent>
            </Card>

            <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
              <CardContent className="p-6">
                <FormSection title="Billing Defaults" description="Default values applied to new invoices and estimates">
                  <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <Label>Invoice Number Prefix</Label>
                        <Input value={form.invoicePrefix} onChange={(e) => setForm({ ...form, invoicePrefix: e.target.value })} placeholder="INV-" data-testid="input-invoice-prefix" />
                      </div>
                      <div>
                        <Label>Estimate Number Prefix</Label>
                        <Input value={form.estimatePrefix} onChange={(e) => setForm({ ...form, estimatePrefix: e.target.value })} placeholder="EST-" data-testid="input-estimate-prefix" />
                      </div>
                      <div>
                        <Label>Base Currency</Label>
                        <select
                          value={form.baseCurrency}
                          onChange={(e) => setForm({ ...form, baseCurrency: e.target.value })}
                          className="flex h-10 w-full rounded-md border px-3 py-2 text-sm"
                          style={{ background: "var(--color-surface-1)", borderColor: "var(--color-border-1)", color: "var(--color-text-1)" }}
                          data-testid="select-base-currency"
                        >
                          {CURRENCIES.map(c => (
                            <option key={c.code} value={c.code}>{c.symbol} {c.code} — {c.name}</option>
                          ))}
                        </select>
                        <p className="text-xs mt-1" style={{ color: "var(--lux-text-muted)" }}>All reports roll up to this currency</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <Label>Default Payment Terms (days)</Label>
                        <Input type="number" value={form.defaultPaymentTermsDays} onChange={(e) => setForm({ ...form, defaultPaymentTermsDays: e.target.value })} data-testid="input-default-payment-terms" />
                      </div>
                      <div>
                        <Label>Default Tax Rate (%)</Label>
                        <Input type="number" step="0.01" value={form.defaultTaxRate} onChange={(e) => setForm({ ...form, defaultTaxRate: e.target.value })} data-testid="input-default-tax-rate" />
                      </div>
                      <div>
                        <Label>Default Bill Rate ($/hr)</Label>
                        <Input type="number" min="0" max="9999" value={form.defaultBillRate} onChange={(e) => setForm({ ...form, defaultBillRate: e.target.value })} data-testid="input-default-bill-rate" />
                        <p className="text-xs mt-1" style={{ color: "var(--lux-text-muted)" }}>Pre-filled when assigning team members to projects</p>
                      </div>
                    </div>
                  </div>
                </FormSection>
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={saveMutation.isPending || !isDirty} data-testid="button-save-settings">
                {saveMutation.isPending ? "Saving..." : isDirty ? "Save Settings" : "Settings Saved"}
              </Button>
            </div>
          </>
        )}

        {activeTab === "services-categories" && (
          <>
            <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
              <CardContent className="p-6">
                <FormSection title="Services" description="Your service catalog — assign these to projects for time tracking">
                  <div className="space-y-3">
                    {activeServices.map(svc => (
                      <div key={svc.id}>
                        {editingServiceId === svc.id ? (
                          <div className="rounded-lg p-3 space-y-2" style={{ background: "var(--lux-surface-alt)", border: "1px solid var(--lux-border-strong)" }} data-testid={`service-edit-${svc.id}`}>
                            <Input value={editServiceName} onChange={e => setEditServiceName(e.target.value)} placeholder="Service name" data-testid="input-edit-service-name" />
                            <Input value={editServiceDescription} onChange={e => setEditServiceDescription(e.target.value)} placeholder="Description (optional)" data-testid="input-edit-service-desc" />
                            <div className="flex items-center gap-2">
                              <div className="flex-1">
                                <Input type="number" step="0.01" min="0" value={editServiceRate} onChange={e => setEditServiceRate(e.target.value)} placeholder="Default rate ($/hr)" data-testid="input-edit-service-rate" />
                              </div>
                              <Button size="sm" className="text-white" style={{ background: "var(--gradient-brand)" }} onClick={() => updateServiceMutation.mutate(svc.id)} disabled={!editServiceName.trim() || updateServiceMutation.isPending} data-testid="button-save-edit-service" aria-label="Save service">
                                <Check className="w-4 h-4" />
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setEditingServiceId(null)} data-testid="button-cancel-edit-service" aria-label="Cancel editing">
                                <X className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between rounded-lg px-4 py-3" style={{ background: "var(--lux-surface-alt)" }} data-testid={`service-row-${svc.id}`}>
                            <div className="flex items-center gap-3">
                              <Tag className="w-4 h-4 flex-shrink-0" style={{ color: "var(--lux-accent, #cf3339)" }} />
                              <div>
                                <p className="text-sm font-semibold" style={{ color: "var(--lux-text)" }}>{svc.name}</p>
                                {svc.description && <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>{svc.description}</p>}
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              {svc.defaultRate && (
                                <span className="text-sm font-semibold tabular-nums" style={{ color: "var(--lux-text-secondary)" }} data-testid={`text-service-rate-${svc.id}`}>
                                  {formatRate(svc.defaultRate)}
                                </span>
                              )}
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEditService(svc)} data-testid={`button-edit-service-${svc.id}`} aria-label="Edit service">
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => toggleServiceMutation.mutate({ id: svc.id, isActive: false })} data-testid={`button-deactivate-service-${svc.id}`} aria-label="Deactivate service">
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}

                    {activeServices.length === 0 && !showAddService && (
                      <div className="text-center py-6">
                        <Tag className="w-8 h-8 mx-auto mb-2" style={{ color: "var(--lux-text-muted)" }} />
                        <p className="text-sm" style={{ color: "var(--lux-text-muted)" }}>No services yet. Create your first service to get started.</p>
                      </div>
                    )}

                    {showAddService ? (
                      <div className="rounded-lg p-3 space-y-2" style={{ border: "1px dashed var(--lux-border-strong)" }} data-testid="service-add-form">
                        <Input value={newServiceName} onChange={e => setNewServiceName(e.target.value)} placeholder="Service name *" data-testid="input-new-service-name" />
                        <Input value={newServiceDescription} onChange={e => setNewServiceDescription(e.target.value)} placeholder="Description (optional)" data-testid="input-new-service-desc" />
                        <div className="flex items-center gap-2">
                          <div className="flex-1">
                            <Input type="number" step="0.01" min="0" value={newServiceRate} onChange={e => setNewServiceRate(e.target.value)} placeholder="Default rate $/hr (optional)" data-testid="input-new-service-rate" />
                          </div>
                          <Button size="sm" className="text-white" style={{ background: "var(--gradient-brand)" }} onClick={() => createServiceMutation.mutate()} disabled={!newServiceName.trim() || createServiceMutation.isPending} data-testid="button-save-new-service">
                            {createServiceMutation.isPending ? "Creating..." : "Add"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => { setShowAddService(false); setNewServiceName(""); setNewServiceDescription(""); setNewServiceRate(""); }} data-testid="button-cancel-new-service">
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => setShowAddService(true)} className="w-full" data-testid="button-add-service">
                        <Plus className="w-4 h-4 mr-1" /> Add Service
                      </Button>
                    )}

                    {inactiveServices.length > 0 && (
                      <div className="pt-3 mt-3" style={{ borderTop: "1px solid var(--lux-border)" }}>
                        <p className="text-xs font-semibold mb-2" style={{ color: "var(--lux-text-muted)" }}>DEACTIVATED SERVICES</p>
                        {inactiveServices.map(svc => (
                          <div key={svc.id} className="flex items-center justify-between rounded-lg px-4 py-2 opacity-60" style={{ background: "var(--lux-surface-alt)" }} data-testid={`service-inactive-${svc.id}`}>
                            <div>
                              <p className="text-sm line-through" style={{ color: "var(--lux-text-muted)" }}>{svc.name}</p>
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => toggleServiceMutation.mutate({ id: svc.id, isActive: true })} data-testid={`button-reactivate-service-${svc.id}`}>
                              Reactivate
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </FormSection>
              </CardContent>
            </Card>

            <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }} data-testid="card-expense-categories">
              <CardContent className="p-6">
                <FormSection title="Expense Categories" description="Categorize expenses for tracking and reporting. Optional GL codes help your accountant map to their chart of accounts.">
                  <div className="space-y-3">
                    {activeCats.map(cat => (
                      <div key={cat.id}>
                        {editingCatId === cat.id ? (
                          <div className="rounded-lg p-3 space-y-2" style={{ background: "var(--lux-surface-alt)", border: "1px solid var(--lux-border-strong)" }}>
                            <Input value={editCatName} onChange={e => setEditCatName(e.target.value)} placeholder="Category name" data-testid="input-edit-cat-name" />
                            <div className="grid grid-cols-2 gap-2">
                              <Input value={editCatGlCode} onChange={e => setEditCatGlCode(e.target.value)} placeholder="GL Code (optional)" data-testid="input-edit-cat-gl" />
                              <Input value={editCatDescription} onChange={e => setEditCatDescription(e.target.value)} placeholder="Description (optional)" data-testid="input-edit-cat-desc" />
                            </div>
                            <div className="flex items-center gap-2">
                              <Button size="sm" className="text-white" style={{ background: "var(--gradient-brand)" }} onClick={() => updateCategoryMutation.mutate(cat.id)} disabled={!editCatName.trim()} data-testid="button-save-edit-cat" aria-label="Save category">
                                <Check className="w-4 h-4" />
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setEditingCatId(null)} data-testid="button-cancel-edit-cat" aria-label="Cancel editing">
                                <X className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between rounded-lg px-3 py-2.5" style={{ background: "var(--lux-surface-alt)" }} data-testid={`cat-row-${cat.id}`}>
                            <div className="flex items-center gap-3">
                              <Layers className="w-4 h-4 flex-shrink-0" style={{ color: "var(--color-accent)" }} />
                              <div>
                                <span className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>{cat.name}</span>
                                {cat.glCode && <span className="text-xs ml-2 px-1.5 py-0.5 rounded" style={{ background: "var(--lux-border)", color: "var(--lux-text-muted)" }}>{cat.glCode}</span>}
                                {cat.description && <p className="text-xs mt-0.5" style={{ color: "var(--lux-text-muted)" }}>{cat.description}</p>}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Button size="sm" variant="ghost" onClick={() => startEditCategory(cat)} data-testid={`button-edit-cat-${cat.id}`} aria-label="Edit category">
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Switch checked={cat.isActive} onCheckedChange={(v) => toggleCategoryMutation.mutate({ id: cat.id, isActive: v })} data-testid={`switch-cat-${cat.id}`} />
                            </div>
                          </div>
                        )}
                      </div>
                    ))}

                    {inactiveCats.length > 0 && (
                      <div className="pt-2 border-t" style={{ borderColor: "var(--lux-border)" }}>
                        <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--lux-text-muted)" }}>Inactive</p>
                        {inactiveCats.map(cat => (
                          <div key={cat.id} className="flex items-center justify-between rounded-lg px-3 py-2 opacity-50" style={{ background: "var(--lux-surface-alt)" }}>
                            <div className="flex items-center gap-3">
                              <Layers className="w-4 h-4" style={{ color: "var(--lux-text-muted)" }} />
                              <span className="text-sm" style={{ color: "var(--lux-text-muted)" }}>{cat.name}</span>
                              {cat.glCode && <span className="text-xs ml-1 px-1.5 py-0.5 rounded" style={{ background: "var(--lux-border)", color: "var(--lux-text-muted)" }}>{cat.glCode}</span>}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Switch checked={false} onCheckedChange={() => toggleCategoryMutation.mutate({ id: cat.id, isActive: true })} />
                              <Button size="sm" variant="ghost" onClick={() => deleteCategoryMutation.mutate(cat.id)} data-testid={`button-delete-cat-${cat.id}`} aria-label="Delete category">
                                <Trash2 className="w-3.5 h-3.5" style={{ color: "#ef4444" }} />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {showAddCategory ? (
                      <div className="rounded-lg p-3 space-y-2" style={{ border: "1px dashed var(--lux-border-strong)" }} data-testid="form-add-category">
                        <Input value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder="Category name (e.g., Travel, Meals, Software)" data-testid="input-new-cat-name" />
                        <div className="grid grid-cols-2 gap-2">
                          <Input value={newCatGlCode} onChange={e => setNewCatGlCode(e.target.value)} placeholder="GL Code (optional)" data-testid="input-new-cat-gl" />
                          <Input value={newCatDescription} onChange={e => setNewCatDescription(e.target.value)} placeholder="Description (optional)" data-testid="input-new-cat-desc" />
                        </div>
                        <div className="flex items-center gap-2">
                          <Button size="sm" className="text-white" style={{ background: "var(--gradient-brand)" }} onClick={() => createCategoryMutation.mutate()} disabled={!newCatName.trim() || createCategoryMutation.isPending} data-testid="button-save-new-cat">
                            <Check className="w-4 h-4 mr-1" /> Save
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => { setShowAddCategory(false); setNewCatName(""); setNewCatGlCode(""); setNewCatDescription(""); }} data-testid="button-cancel-new-cat">
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setShowAddCategory(true)} data-testid="button-add-category">
                        <Plus className="w-4 h-4 mr-1" /> Add Category
                      </Button>
                    )}
                  </div>
                </FormSection>
              </CardContent>
            </Card>
          </>
        )}

        {activeTab === "accounting-email" && (
          <>
            <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
              <CardContent className="p-6">
                <FormSection title="Accounting" description="Configure how transactions are posted to the General Ledger">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <Label>Auto-Post Journal Entries</Label>
                          <TooltipProvider delayDuration={200}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Info className="w-3.5 h-3.5 cursor-help" style={{ color: "var(--lux-text-muted)" }} data-testid="icon-autopost-tooltip" />
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
                                When ON, invoices and expenses post their journal entries to the GL automatically on Send. Turn OFF if you want to review every JE before it hits the books.
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                        <p className="text-xs mt-0.5" style={{ color: "var(--lux-text-muted)" }}>
                          Automatically create GL journal entries when invoices are sent, payments are recorded, and expenses are approved
                        </p>
                      </div>
                      <Switch
                        checked={form.autoPostJournalEntries}
                        onCheckedChange={(checked) => setForm({ ...form, autoPostJournalEntries: checked })}
                        data-testid="switch-auto-post-gl"
                      />
                    </div>
                    {!form.autoPostJournalEntries && (
                      <div className="rounded-md p-3 text-xs" style={{ background: "var(--lux-bg-muted)", color: "var(--lux-text-secondary)" }}>
                        <div className="flex items-start gap-2">
                          <BookOpen className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: "var(--lux-text-muted)" }} />
                          <span>
                            When auto-posting is off, a "Post to GL" button will appear on sent invoices, recorded payments, and approved expenses so you can manually post each transaction.
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </FormSection>
              </CardContent>
            </Card>

            <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
              <CardContent className="p-6">
                <FormSection title="Payment Reminders" description="Automatically remind clients about overdue invoices">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <Label>Enable Automatic Reminders</Label>
                        <p className="text-xs mt-0.5" style={{ color: "var(--lux-text-muted)" }}>Send email reminders for overdue invoices</p>
                      </div>
                      <Switch checked={form.reminderEnabled} onCheckedChange={(checked) => setForm({ ...form, reminderEnabled: checked })} data-testid="switch-reminder-enabled" />
                    </div>
                    <div>
                      <Label>Days Overdue (comma-separated)</Label>
                      <Input
                        value={form.reminderDaysOverdue}
                        onChange={(e) => setForm({ ...form, reminderDaysOverdue: e.target.value })}
                        onBlur={() => {
                          const nums = form.reminderDaysOverdue
                            .split(",")
                            .map(s => parseInt(s.trim(), 10))
                            .filter(n => !isNaN(n))
                            .map(n => Math.max(1, Math.min(365, n)));
                          const deduped = [...new Set(nums)].sort((a, b) => a - b);
                          setForm({ ...form, reminderDaysOverdue: deduped.join(",") });
                        }}
                        placeholder="7,14,30"
                        data-testid="input-reminder-days"
                      />
                      <p className="text-xs mt-1" style={{ color: "var(--lux-text-muted)" }}>Comma-separated days after due date (1–365). Example: 7,14,30</p>
                    </div>
                    <Button variant="outline" onClick={() => sendRemindersMutation.mutate()} disabled={sendRemindersMutation.isPending} data-testid="button-send-reminders">
                      <Send className="w-4 h-4 mr-2" />
                      {sendRemindersMutation.isPending ? "Processing..." : "Send Reminders Now"}
                    </Button>
                  </div>
                </FormSection>
              </CardContent>
            </Card>

            <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
              <CardContent className="p-6">
                <FormSection title="Email Settings" description="Configure outbound email delivery for invoices, estimates, and notifications">
                  <MailboxReconnectBanner withSettingsLink={false} className="mb-5" />
                  {isAdmin && <EmailTransportHealthPanel />}
                  {isAdmin && <EmailAlertWebhookPanel />}
                  {oauthFlagEnabled && (
                    <div className="mb-5 pb-5" style={{ borderBottom: "1px solid var(--lux-border)" }}>
                      <Label className="text-xs font-medium mb-2 block" style={{ color: "var(--lux-text-muted)" }}>
                        Email Provider
                      </Label>
                      <RadioGroup
                        value={providerType}
                        onValueChange={(v) => setProviderTypeMutation.mutate(v as "smtp" | "m365" | "google")}
                        className="grid grid-cols-3 gap-3"
                        data-testid="radio-email-provider"
                      >
                        {[
                          { value: "m365", label: "Microsoft 365", desc: "Outlook / Exchange Online via OAuth" },
                          { value: "google", label: "Google Workspace", desc: "Gmail via OAuth" },
                          { value: "smtp", label: "Custom SMTP", desc: "Any SMTP server with username + password" },
                        ].map((opt) => (
                          <label
                            key={opt.value}
                            htmlFor={`provider-${opt.value}`}
                            className="rounded-lg border p-3 cursor-pointer flex items-start gap-2 transition-colors hover-elevate"
                            style={{
                              borderColor: providerType === opt.value ? "var(--color-accent)" : "var(--lux-border)",
                              background: providerType === opt.value ? "var(--color-accent-soft)" : "transparent",
                            }}
                            data-testid={`option-provider-${opt.value}`}
                          >
                            <RadioGroupItem id={`provider-${opt.value}`} value={opt.value} className="mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>{opt.label}</p>
                              <p className="text-[11px] mt-0.5 leading-tight" style={{ color: "var(--lux-text-muted)" }}>{opt.desc}</p>
                            </div>
                          </label>
                        ))}
                      </RadioGroup>
                    </div>
                  )}

                  {!oauthFlagEnabled && (providerType === "m365" || providerType === "google") && (
                    <div className="rounded-lg p-4 flex items-start gap-3" style={{ background: "rgba(234,179,8,0.06)", border: "1px solid rgba(234,179,8,0.2)" }} data-testid="panel-oauth-disabled-by-admin">
                      <Shield className="w-5 h-5 mt-0.5 shrink-0" style={{ color: "rgb(202,138,4)" }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold" style={{ color: "var(--lux-text)" }}>OAuth mail disabled by admin</p>
                        <p className="text-xs mt-0.5" style={{ color: "var(--lux-text-muted)" }}>
                          Microsoft 365 and Google sending is paused. Test sends are unavailable until OAuth mail is re-enabled.
                        </p>
                        <div className="mt-3">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span tabIndex={0}>
                                  <Button size="sm" variant="outline" disabled data-testid="button-send-test-email-oauth">
                                    <Send className="w-3.5 h-3.5 mr-1.5" />
                                    Send Test Email
                                  </Button>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>OAuth mail disabled by admin.</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      </div>
                    </div>
                  )}

                  {oauthFlagEnabled && (providerType === "m365" || providerType === "google") ? (
                    <div className="space-y-4" data-testid={`panel-oauth-${providerType}`}>
                      {providerType === "m365"
                        && emailProvider?.isConnected
                        && (emailProvider?.scopes ?? "")
                          .split(/[\s,]+/)
                          .map((s) => s.trim().toLowerCase().replace(/^https?:\/\/[^/]+\//, ""))
                          .some((s) => s === "user.read") && (
                        <div
                          className="rounded-lg p-4 flex items-start gap-3"
                          style={{ background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.25)" }}
                          data-testid="banner-m365-legacy-scope"
                        >
                          <div
                            className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                            style={{ background: "rgba(59,130,246,0.15)" }}
                          >
                            <Shield className="w-5 h-5" style={{ color: "rgb(37,99,235)" }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold" style={{ color: "var(--lux-text)" }}>
                              Your Microsoft mailbox still has unused permissions
                            </p>
                            <p className="text-xs mt-0.5" style={{ color: "var(--lux-text-muted)" }}>
                              We tightened our Microsoft permission request and no longer need <span className="font-medium">User.Read</span>.
                              Reconnect once to drop the leftover consent — sending will keep working in the meantime.
                            </p>
                            <div className="mt-3">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openOauthPopup("microsoft")}
                                data-testid="button-reconnect-drop-permissions"
                              >
                                <Link2 className="w-3.5 h-3.5 mr-1.5" />
                                Reconnect to drop unused permissions
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}
                      {emailProvider?.isConnected ? (
                        <div
                          className="rounded-lg p-4 flex items-start gap-3"
                          style={
                            emailProvider.status === "needs_reconnect"
                              ? { background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.35)" }
                              : { background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.2)" }
                          }
                        >
                          <div
                            className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                            style={
                              emailProvider.status === "needs_reconnect"
                                ? { background: "rgba(245,158,11,0.18)" }
                                : { background: "rgba(34,197,94,0.15)" }
                            }
                          >
                            {emailProvider.status === "needs_reconnect" ? (
                              <AlertTriangle className="w-5 h-5" style={{ color: "rgb(217,119,6)" }} />
                            ) : (
                              <Check className="w-5 h-5" style={{ color: "rgb(22,163,74)" }} />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold" style={{ color: "var(--lux-text)" }}>
                              {emailProvider.status === "needs_reconnect"
                                ? "Mailbox needs to be reconnected"
                                : "Mailbox connected"}
                            </p>
                            {emailProvider.senderAddress && (
                              <p className="text-xs mt-0.5" style={{ color: "var(--lux-text-muted)" }} data-testid="text-sender-address">
                                Sending as <span className="font-medium" style={{ color: "var(--lux-text)" }}>{emailProvider.senderAddress}</span>
                              </p>
                            )}
                            {emailProvider.connectedAt && (
                              <p className="text-[11px] mt-0.5" style={{ color: "var(--lux-text-muted)" }}>
                                Connected {new Date(emailProvider.connectedAt).toLocaleString()}
                              </p>
                            )}
                            {emailProvider.status === "needs_reconnect" && emailProvider.lastErrorMessage && (
                              <MailboxErrorDetails
                                providerLabel={providerType === "m365" ? "Microsoft 365" : "Gmail"}
                                message={emailProvider.lastErrorMessage}
                                lastErrorAt={emailProvider.lastErrorAt ?? null}
                              />
                            )}
                            <div className="mt-3 flex items-center gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openOauthPopup(providerType === "m365" ? "microsoft" : "google")}
                                data-testid="button-reconnect-mailbox"
                              >
                                <Link2 className="w-3.5 h-3.5 mr-1.5" />
                                Reconnect
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => disconnectMailboxMutation.mutate()}
                                disabled={disconnectMailboxMutation.isPending}
                                data-testid="button-disconnect-mailbox"
                              >
                                <Unlink className="w-3.5 h-3.5 mr-1.5" />
                                {disconnectMailboxMutation.isPending ? "Disconnecting..." : "Disconnect mailbox"}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setTestEmailDialogOpen(true)}
                                data-testid="button-send-test-email-oauth"
                              >
                                <Send className="w-3.5 h-3.5 mr-1.5" />
                                Send Test Email
                              </Button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-lg border-2 border-dashed p-6 text-center" style={{ borderColor: "var(--lux-border)" }}>
                          <div className="flex justify-center mb-3">
                            <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: "var(--color-accent-soft)" }}>
                              <Mail className="w-6 h-6" style={{ color: "var(--color-accent)" }} />
                            </div>
                          </div>
                          <h3 className="text-sm font-semibold mb-1" style={{ color: "var(--lux-text)" }}>
                            Connect your {providerType === "m365" ? "Microsoft 365" : "Google Workspace"} mailbox
                          </h3>
                          <p className="text-xs mb-4 max-w-sm mx-auto" style={{ color: "var(--lux-text-muted)" }}>
                            Authorize CherryWorks Pro to send transactional emails on your behalf using OAuth — no passwords stored.
                          </p>
                          <Button
                            variant="outline"
                            onClick={() => openOauthPopup(providerType === "m365" ? "microsoft" : "google")}
                            data-testid="button-connect-mailbox"
                          >
                            <Link2 className="w-4 h-4 mr-2" />
                            Connect Mailbox
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : smtpLoading ? (
                    <div className="text-sm" style={{ color: "var(--lux-text-muted)" }}>Loading email settings...</div>
                  ) : !smtpSettings?.configured && !smtpEditing ? (
                    <div className="rounded-lg border-2 border-dashed p-6 text-center" style={{ borderColor: "var(--lux-border)" }}>
                      <div className="flex justify-center mb-3">
                        <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: "var(--color-accent-soft)" }}>
                          <Mail className="w-6 h-6" style={{ color: "var(--color-accent)" }} />
                        </div>
                      </div>
                      <h3 className="text-sm font-semibold mb-1" style={{ color: "var(--lux-text)" }}>No Email Server Configured</h3>
                      <p className="text-xs mb-4" style={{ color: "var(--lux-text-muted)" }}>
                        Set up SMTP to send invoices, estimates, and reminders directly from your email address.
                      </p>
                      <Button variant="outline" onClick={() => setSmtpEditing(true)} data-testid="button-configure-smtp">
                        <Server className="w-4 h-4 mr-2" />
                        Configure Email Server
                      </Button>
                    </div>
                  ) : smtpEditing || !smtpSettings?.configured ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        saveSmtpMutation.mutate();
                      }}
                      className="space-y-4"
                      data-testid="form-smtp-settings"
                    >
                      <div className="rounded-lg p-3 flex items-start gap-2" style={{ background: "rgba(59,130,246,0.06)" }}>
                        <Shield className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "#3b82f6" }} />
                        <p className="text-xs" style={{ color: "#3b82f6" }}>
                          Your password is encrypted before storage and never exposed in API responses.
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label>SMTP Host *</Label>
                          <Input
                            value={smtpForm.smtpHost}
                            onChange={(e) => setSmtpForm({ ...smtpForm, smtpHost: e.target.value })}
                            placeholder="smtp.gmail.com"
                            required
                            data-testid="input-smtp-host"
                          />
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <Label>Port *</Label>
                            <div className="group relative">
                              <Info className="w-3 h-3 cursor-help" style={{ color: "var(--lux-text-muted)" }} />
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2.5 py-1.5 rounded text-[11px] leading-tight whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50" style={{ background: "var(--lux-text)", color: "var(--lux-bg)" }}>
                                587 for TLS, 465 for SSL
                              </div>
                            </div>
                          </div>
                          <Input
                            type="number"
                            value={smtpForm.smtpPort}
                            onChange={(e) => setSmtpForm({ ...smtpForm, smtpPort: e.target.value })}
                            placeholder="587"
                            required
                            data-testid="input-smtp-port"
                          />
                          <p className="text-[10px] mt-0.5" style={{ color: "var(--lux-text-muted)" }}>587 (TLS) or 465 (SSL)</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label>Username *</Label>
                          <Input
                            value={smtpForm.smtpUser}
                            onChange={(e) => setSmtpForm({ ...smtpForm, smtpUser: e.target.value })}
                            placeholder="you@company.com"
                            required
                            data-testid="input-smtp-user"
                          />
                        </div>
                        <div>
                          <Label>Password {smtpSettings?.smtpPassSet ? "(leave blank to keep)" : "*"}</Label>
                          <div className="relative">
                            <Input
                              type={showSmtpPassword ? "text" : "password"}
                              value={smtpForm.smtpPass}
                              onChange={(e) => setSmtpForm({ ...smtpForm, smtpPass: e.target.value })}
                              placeholder={smtpSettings?.smtpPassSet ? "Unchanged" : "App password"}
                              required={!smtpSettings?.smtpPassSet}
                              data-testid="input-smtp-pass"
                            />
                            <button
                              type="button"
                              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-gray-100"
                              onClick={() => setShowSmtpPassword(!showSmtpPassword)}
                              tabIndex={-1}
                              aria-label={showSmtpPassword ? "Hide password" : "Show password"}
                            >
                              {showSmtpPassword ? <EyeOff className="w-4 h-4" style={{ color: "var(--lux-text-muted)" }} /> : <Eye className="w-4 h-4" style={{ color: "var(--lux-text-muted)" }} />}
                            </button>
                          </div>
                          <div className="flex items-start gap-1.5 mt-1.5">
                            <Info className="w-3 h-3 mt-0.5 shrink-0" style={{ color: "var(--lux-text-muted)" }} />
                            <p className="text-[10px] leading-relaxed" style={{ color: "var(--lux-text-muted)" }}>
                              Gmail requires an App Password (myaccount.google.com &gt; Security &gt; App Passwords). Outlook uses smtp.office365.com port 587.
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="border-t pt-4" style={{ borderColor: "var(--lux-border)" }}>
                        <p className="text-xs font-medium mb-3" style={{ color: "var(--lux-text-muted)" }}>Sender Details (optional)</p>
                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <Label>From Name</Label>
                            <Input
                              value={smtpForm.smtpFromName}
                              onChange={(e) => setSmtpForm({ ...smtpForm, smtpFromName: e.target.value })}
                              placeholder="CherryWorks Pro"
                              data-testid="input-smtp-from-name"
                            />
                          </div>
                          <div>
                            <Label>From Email</Label>
                            <Input
                              type="email"
                              value={smtpForm.smtpFromEmail}
                              onChange={(e) => setSmtpForm({ ...smtpForm, smtpFromEmail: e.target.value })}
                              placeholder="billing@company.com"
                              data-testid="input-smtp-from-email"
                            />
                          </div>
                          <div>
                            <Label>Reply-To</Label>
                            <Input
                              type="email"
                              value={smtpForm.smtpReplyTo}
                              onChange={(e) => setSmtpForm({ ...smtpForm, smtpReplyTo: e.target.value })}
                              placeholder="support@company.com"
                              data-testid="input-smtp-reply-to"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 pt-2">
                        <Button type="submit" disabled={saveSmtpMutation.isPending} data-testid="button-save-smtp">
                          {saveSmtpMutation.isPending ? "Saving..." : "Save Email Settings"}
                        </Button>
                        <Button type="button" variant="outline" onClick={() => { setSmtpEditing(false); if (smtpSettings?.configured) { setSmtpForm({ smtpHost: smtpSettings.smtpHost, smtpPort: String(smtpSettings.smtpPort), smtpUser: smtpSettings.smtpUser, smtpPass: "", smtpFromName: smtpSettings.smtpFromName, smtpFromEmail: smtpSettings.smtpFromEmail, smtpReplyTo: smtpSettings.smtpReplyTo }); } }}>
                          Cancel
                        </Button>
                      </div>

                      <div className="border-t pt-3 mt-1" style={{ borderColor: "var(--lux-border)" }}>
                        <button
                          type="button"
                          className="flex items-center gap-1.5 text-xs font-medium w-full text-left"
                          style={{ color: "var(--lux-text-muted)" }}
                          onClick={() => setShowProviderRef(!showProviderRef)}
                          data-testid="button-toggle-provider-ref"
                        >
                          {showProviderRef ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          Common Provider Settings
                        </button>
                        {showProviderRef && (
                          <div className="mt-3 space-y-2" data-testid="section-provider-ref">
                            {[
                              { name: "Gmail", host: "smtp.gmail.com", port: "587", note: "Use an App Password from myaccount.google.com > Security > App Passwords" },
                              { name: "Outlook / Microsoft 365", host: "smtp.office365.com", port: "587", note: "Use your account password or an app-specific password if MFA is enabled" },
                              { name: "Yahoo Mail", host: "smtp.mail.yahoo.com", port: "587", note: "Generate an App Password from Account Security settings" },
                              { name: "Custom SMTP", host: "your-server.com", port: "587 or 465", note: "Check with your email provider for the correct host, port, and authentication method" },
                            ].map((p) => (
                              <div key={p.name} className="rounded-md p-2.5 text-[11px]" style={{ background: "var(--lux-bg-muted)", border: "1px solid var(--lux-border)" }}>
                                <p className="font-semibold mb-0.5" style={{ color: "var(--lux-text)" }}>{p.name}</p>
                                <p style={{ color: "var(--lux-text-muted)" }}>
                                  Host: <span className="font-medium" style={{ fontVariantNumeric: "tabular-nums", color: "var(--lux-text)" }}>{p.host}</span>
                                  {" "} Port: <span className="font-medium" style={{ fontVariantNumeric: "tabular-nums", color: "var(--lux-text)" }}>{p.port}</span>
                                </p>
                                <p className="mt-0.5" style={{ color: "var(--lux-text-muted)" }}>{p.note}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </form>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center gap-3 rounded-lg p-3" style={{ background: "rgba(34,197,94,0.06)" }}>
                        <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(34,197,94,0.15)" }}>
                          <Check className="w-4 h-4" style={{ color: "#22c55e" }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>Email server configured</p>
                          <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
                            {smtpSettings.smtpHost}:{smtpSettings.smtpPort} as {smtpSettings.smtpUser}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Button variant="outline" size="sm" onClick={() => setSmtpEditing(true)} data-testid="button-edit-smtp">
                            <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => removeSmtpMutation.mutate()} className="text-red-500 hover:text-red-600" data-testid="button-remove-smtp">
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>

                      {smtpSettings.smtpFromName || smtpSettings.smtpFromEmail || smtpSettings.smtpReplyTo ? (
                        <div className="grid grid-cols-3 gap-3 text-xs">
                          {smtpSettings.smtpFromName && (
                            <div>
                              <span style={{ color: "var(--lux-text-muted)" }}>From Name:</span>
                              <p className="font-medium" style={{ color: "var(--lux-text)" }}>{smtpSettings.smtpFromName}</p>
                            </div>
                          )}
                          {smtpSettings.smtpFromEmail && (
                            <div>
                              <span style={{ color: "var(--lux-text-muted)" }}>From Email:</span>
                              <p className="font-medium" style={{ color: "var(--lux-text)" }}>{smtpSettings.smtpFromEmail}</p>
                            </div>
                          )}
                          {smtpSettings.smtpReplyTo && (
                            <div>
                              <span style={{ color: "var(--lux-text-muted)" }}>Reply-To:</span>
                              <p className="font-medium" style={{ color: "var(--lux-text)" }}>{smtpSettings.smtpReplyTo}</p>
                            </div>
                          )}
                        </div>
                      ) : null}

                      <div className="border-t pt-3" style={{ borderColor: "var(--lux-border)" }}>
                        <Label className="mb-2 block">Send Test Email</Label>
                        <div className="flex items-center gap-2">
                          <Input
                            type="email"
                            value={testEmailTo}
                            onChange={(e) => setTestEmailTo(e.target.value)}
                            placeholder={org?.email || "your@email.com"}
                            className="max-w-xs"
                            data-testid="input-test-email"
                          />
                          <Button
                            variant="outline"
                            onClick={() => testEmailMutation.mutate()}
                            disabled={testEmailMutation.isPending}
                            data-testid="button-send-test-email"
                          >
                            <Send className="w-4 h-4 mr-2" />
                            {testEmailMutation.isPending ? "Sending..." : "Send Test"}
                          </Button>
                        </div>
                      </div>

                      <div className="border-t pt-3" style={{ borderColor: "var(--lux-border)" }}>
                        <p className="text-xs" style={{ color: "var(--lux-text-muted)" }} data-testid="text-last-smtp-send">
                          {smtpSettings.lastSuccessfulSmtpSendAt
                            ? `Last successful send: ${(() => {
                                const d = new Date(smtpSettings.lastSuccessfulSmtpSendAt);
                                const diff = Date.now() - d.getTime();
                                const mins = Math.floor(diff / 60000);
                                if (mins < 1) return "just now";
                                if (mins < 60) return `${mins}m ago`;
                                const hrs = Math.floor(mins / 60);
                                if (hrs < 24) return `${hrs}h ago`;
                                const days = Math.floor(hrs / 24);
                                if (days < 7) return `${days}d ago`;
                                return d.toLocaleDateString();
                              })()}`
                            : "No successful sends yet"}
                        </p>
                      </div>

                      <Accordion type="single" collapsible className="border-t" style={{ borderColor: "var(--lux-border)" }}>
                        <AccordionItem value="dns-helper" className="border-0">
                          <AccordionTrigger className="py-3 text-sm hover:no-underline" data-testid="accordion-dns-helper">
                            <div className="flex items-center gap-2">
                              <Globe className="w-4 h-4" style={{ color: "var(--lux-text-muted)" }} />
                              DMARC / SPF quick check
                            </div>
                          </AccordionTrigger>
                          <AccordionContent>
                            {(() => {
                              const fromEmail = smtpSettings.smtpFromEmail || smtpSettings.smtpUser || "";
                              const domain = fromEmail.includes("@") ? fromEmail.split("@")[1] : "yourdomain.com";
                              const smtpHost = smtpSettings.smtpHost || "smtp.example.com";
                              const spfRecord = `v=spf1 include:_spf.${smtpHost} ~all`;
                              const dmarcRecord = `v=DMARC1; p=none; rua=mailto:dmarc@${domain}`;
                              return (
                                <div className="space-y-4 pb-2">
                                  <p className="text-xs leading-relaxed" style={{ color: "var(--lux-text-muted)" }}>
                                    To improve deliverability and prevent your emails from landing in spam, add these DNS TXT records to your domain <strong style={{ color: "var(--lux-text)" }}>{domain}</strong>. Your DNS provider (e.g. Cloudflare, GoDaddy, Namecheap) will have a section for adding TXT records.
                                  </p>
                                  <div className="space-y-1">
                                    <Label className="text-xs">SPF Record</Label>
                                    <div className="flex items-center gap-2">
                                      <code className="flex-1 text-xs px-3 py-2 rounded-md font-mono break-all" style={{ background: "var(--lux-bg-muted)", color: "var(--lux-text)" }} data-testid="text-spf-record">{spfRecord}</code>
                                      <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(spfRecord); toast({ title: "SPF record copied" }); }} data-testid="button-copy-spf">
                                        <Copy className="w-3.5 h-3.5" />
                                      </Button>
                                    </div>
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs">DMARC Record</Label>
                                    <div className="flex items-center gap-2">
                                      <code className="flex-1 text-xs px-3 py-2 rounded-md font-mono break-all" style={{ background: "var(--lux-bg-muted)", color: "var(--lux-text)" }} data-testid="text-dmarc-record">{dmarcRecord}</code>
                                      <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(dmarcRecord); toast({ title: "DMARC record copied" }); }} data-testid="button-copy-dmarc">
                                        <Copy className="w-3.5 h-3.5" />
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              );
                            })()}
                          </AccordionContent>
                        </AccordionItem>
                      </Accordion>
                    </div>
                  )}

                  {isPlatformOperator && (
                    <div
                      className="border-t pt-3 mt-4 flex flex-col gap-2"
                      style={{ borderColor: "var(--lux-border)" }}
                    >
                      <Link
                        href="/admin/m365-rescope"
                        className="inline-flex items-center gap-1.5 text-xs font-medium hover:underline"
                        style={{ color: "var(--lux-text-muted)" }}
                        data-testid="link-operator-m365-rescope"
                      >
                        <Shield className="w-3.5 h-3.5" />
                        Cross-org cleanup tools
                      </Link>
                      <Link
                        href="/admin/marketing-retry-policies"
                        className="inline-flex items-center gap-1.5 text-xs font-medium hover:underline"
                        style={{ color: "var(--lux-text-muted)" }}
                        data-testid="link-operator-marketing-retry-policies"
                      >
                        <Shield className="w-3.5 h-3.5" />
                        Aggressive marketing retry policies
                      </Link>
                    </div>
                  )}
                </FormSection>
              </CardContent>
            </Card>

            <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
              <CardContent className="p-6">
                <FormSection
                  title="Marketing Send Retries"
                  description="Control how aggressively the marketing worker retries transient send failures (network blips, 5xx, rate limits)."
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="input-marketing-max-attempts">Max attempts per recipient</Label>
                      <Input
                        id="input-marketing-max-attempts"
                        type="number"
                        min={1}
                        max={20}
                        value={form.marketingSendMaxAttempts}
                        onChange={(e) => setForm({ ...form, marketingSendMaxAttempts: e.target.value })}
                        data-testid="input-marketing-max-attempts"
                      />
                      <p className="text-xs mt-1" style={{ color: "var(--lux-text-muted)" }}>
                        Initial send + retries before giving up. 1–20. Default 5.
                      </p>
                    </div>
                    <div>
                      <Label htmlFor="input-marketing-retry-base">Base backoff (minutes)</Label>
                      <Input
                        id="input-marketing-retry-base"
                        type="number"
                        min={1}
                        max={1440}
                        value={form.marketingSendRetryBaseMinutes}
                        onChange={(e) => setForm({ ...form, marketingSendRetryBaseMinutes: e.target.value })}
                        data-testid="input-marketing-retry-base"
                      />
                      <p className="text-xs mt-1" style={{ color: "var(--lux-text-muted)" }}>
                        Delay before the first retry; doubles each subsequent attempt and is capped at 24h. Default 5 min.
                      </p>
                    </div>
                    <div>
                      <Label htmlFor="input-marketing-large-audience-threshold">Large-audience warning threshold</Label>
                      <Input
                        id="input-marketing-large-audience-threshold"
                        type="number"
                        min={1}
                        max={10_000_000}
                        value={form.marketingLargeAudienceThreshold}
                        onChange={(e) => setForm({ ...form, marketingLargeAudienceThreshold: e.target.value })}
                        data-testid="input-marketing-large-audience-threshold"
                      />
                      <p className="text-xs mt-1" style={{ color: "var(--lux-text-muted)" }}>
                        Recipients above this count trigger a soft warning in the campaign editor. Default 1000.
                      </p>
                    </div>
                  </div>
                </FormSection>
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={saveMutation.isPending || !isDirty} data-testid="button-save-settings">
                {saveMutation.isPending ? "Saving..." : isDirty ? "Save Settings" : "Settings Saved"}
              </Button>
            </div>
          </>
        )}

        {activeTab === "subscription" && isAdmin && (() => {
          const isTrial = !billingStatus || billingStatus.planTier === "TRIAL" || !billingStatus.planTier;
          const hasPayment = billingStatus?.hasPaymentMethod || billingStatus?.stripeCustomerId;
          const showStartCTA = isTrial && !hasPayment;
          const sectionTitle = showStartCTA ? "Start your subscription" : "Billing & Subscription";
          const sectionDesc = showStartCTA
            ? "Add a payment method to keep CherryWorks Pro running after your trial ends."
            : "Manage your plan, payment method, and billing history";
          return (
          <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
            <CardContent className="p-6">
              <FormSection title={sectionTitle} description={sectionDesc}>
                {billingLoading ? (
                  <div className="space-y-3" data-testid="billing-loading">
                    <Skeleton className="h-6 w-48" />
                    <Skeleton className="h-10 w-64" />
                    <Skeleton className="h-8 w-40" />
                  </div>
                ) : billingError ? (
                  <div className="rounded-lg border p-4 space-y-3" style={{ borderColor: "var(--lux-border)", background: "var(--lux-bg-muted)" }} data-testid="billing-error">
                    <p className="text-sm" style={{ color: "var(--lux-text-secondary)" }}>Unable to load billing information.</p>
                    <Button variant="outline" size="sm" onClick={() => refetchBilling()} data-testid="button-retry-billing">Try Again</Button>
                  </div>
                ) : billingStatus ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-4 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium" style={{ color: "var(--lux-text-secondary)" }}>Plan:</span>
                        <span className="text-sm font-semibold" data-testid="text-current-plan">{billingStatus.planTier || "TRIAL"}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium" style={{ color: "var(--lux-text-secondary)" }}>Status:</span>
                        <span className={`text-sm font-semibold ${billingStatus.subscriptionStatus === "active" ? "text-green-600" : billingStatus.subscriptionStatus === "trialing" ? "text-blue-600" : "text-amber-600"}`} data-testid="text-subscription-status">
                          {billingStatus.subscriptionStatus || "No subscription"}
                        </span>
                      </div>
                    </div>

                    {showStartCTA ? (
                      <div className="rounded-lg border-2 p-6 space-y-4" style={{ borderColor: "hsl(var(--primary) / 0.4)", background: "hsl(var(--primary) / 0.04)" }} data-testid="trial-start-subscription">
                        <div className="flex items-start gap-3">
                          <div className="rounded-full p-2" style={{ background: "hsl(var(--primary) / 0.1)" }}>
                            <CreditCard className="w-5 h-5" style={{ color: "hsl(var(--primary))" }} />
                          </div>
                          <div className="space-y-1">
                            <h4 className="text-base font-semibold" data-testid="text-start-subscription-headline">Start your subscription</h4>
                            <p className="text-sm" style={{ color: "var(--lux-text-secondary)" }}>
                              Add a payment method to keep CherryWorks Pro running after your trial ends.
                            </p>
                            {billingStatus.trialEndsAt && (
                              <p className="text-xs" style={{ color: "var(--lux-text-secondary)" }}>
                                Trial ends {new Date(billingStatus.trialEndsAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                              </p>
                            )}
                          </div>
                        </div>
                        <Button
                          disabled={portalLoading}
                          data-testid="button-add-payment-method"
                          onClick={async () => {
                            setPortalLoading(true);
                            try {
                              const res = await apiRequest("POST", "/api/billing/checkout", { plan: "PROFESSIONAL" });
                              const data = await res.json();
                              if (data.url) {
                                window.open(data.url, "_blank");
                              }
                            } catch (err: any) {
                              toast({ title: "Error", description: err.message || "Failed to start checkout", variant: "destructive" });
                            } finally {
                              setPortalLoading(false);
                            }
                          }}
                        >
                          <CreditCard className="w-4 h-4 mr-2" />
                          {portalLoading ? "Opening..." : "Add payment method"}
                        </Button>
                      </div>
                    ) : billingStatus.stripeCustomerId ? (
                      <div className="space-y-3">
                        <p className="text-xs" style={{ color: "var(--lux-text-secondary)" }}>
                          Your subscription renews automatically on each billing cycle. To avoid being charged, cancel before your renewal date.
                        </p>
                        <Button
                          variant="outline"
                          disabled={portalLoading}
                          data-testid="button-manage-subscription"
                          onClick={async () => {
                            setPortalLoading(true);
                            try {
                              const res = await apiRequest("POST", "/api/billing/portal");
                              const data = await res.json();
                              if (data.url) {
                                window.open(data.url, "_blank");
                              }
                            } catch (err: any) {
                              toast({ title: "Error", description: err.message || "Failed to open billing portal", variant: "destructive" });
                            } finally {
                              setPortalLoading(false);
                            }
                          }}
                        >
                          <CreditCard className="w-4 h-4 mr-2" />
                          {portalLoading ? "Opening..." : "Manage Subscription"}
                          <ExternalLink className="w-3.5 h-3.5 ml-2 opacity-50" />
                        </Button>
                      </div>
                    ) : (
                      <div className="rounded-lg border p-4 space-y-3" style={{ borderColor: "var(--lux-border)", background: "var(--lux-bg-muted)" }}>
                        <p className="text-sm" style={{ color: "var(--lux-text-secondary)" }}>
                          No payment method on file. Add one to ensure uninterrupted service.
                        </p>
                        <Link href="/pricing" className="inline-flex items-center text-sm font-medium underline" data-testid="link-pricing">
                          Choose a Plan
                        </Link>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-sm" style={{ color: "var(--lux-text-secondary)" }}>Loading billing information...</div>
                )}
              </FormSection>
            </CardContent>
          </Card>
          );
        })()}
      </div>
      <Dialog open={testEmailDialogOpen} onOpenChange={setTestEmailDialogOpen}>
        <DialogContent data-testid="dialog-test-email">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const trimmed = testEmailRecipient.trim();
              if (
                !sendTestEmailMutation.isPending &&
                /^\S+@\S+\.\S+$/.test(trimmed)
              ) {
                sendTestEmailMutation.mutate(trimmed);
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>Send Test Email</DialogTitle>
              <DialogDescription>
                Send a verification email through your connected mailbox
                {emailProvider?.senderAddress ? ` (${emailProvider.senderAddress})` : ""}.
                Limited to 10 sends per hour.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-2">
              <Label htmlFor="test-email-recipient">Recipient</Label>
              <Input
                id="test-email-recipient"
                type="email"
                autoFocus
                value={testEmailRecipient}
                onChange={(e) => setTestEmailRecipient(e.target.value)}
                placeholder="you@example.com"
                data-testid="input-test-email-recipient"
                disabled={sendTestEmailMutation.isPending}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setTestEmailDialogOpen(false)}
                disabled={sendTestEmailMutation.isPending}
                data-testid="button-test-email-cancel"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  sendTestEmailMutation.isPending ||
                  !/^\S+@\S+\.\S+$/.test(testEmailRecipient.trim())
                }
                data-testid="button-test-email-send"
              >
                <Send className="w-3.5 h-3.5 mr-1.5" />
                {sendTestEmailMutation.isPending ? "Sending..." : "Send"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
