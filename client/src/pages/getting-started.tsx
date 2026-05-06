import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  Building2, Briefcase, Users, UserPlus, FileText, CheckCircle, ArrowRight,
  ArrowLeft, Sparkles, Check, Rocket, Globe, CreditCard, Shield,
  BarChart3, Clock, Bot, Lightbulb, Zap, BookOpen, Receipt,
  Calculator, Download, Settings, Layout, PieChart, Banknote,
  ArrowUpRight, Star, Tag, ChevronDown, LayoutDashboard, FolderKanban,
  UserCircle,
} from "lucide-react";
import { formatRate, formatMoney } from "@/components/shared/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { CherryLogo } from "@/components/shared/cherry-logo";
import { CURRENCIES } from "../../../shared/currencies";
import { useDocumentTitle } from "@/lib/use-document-title";

interface Step { id: string; label: string; complete: boolean; }

const ADMIN_STEP_CONFIG = [
  { id: "firm", icon: Building2, title: "Set Up Your Firm", desc: "Your firm's details appear on every invoice, estimate, and email. Let's make them look professional." },
  { id: "services", icon: Briefcase, title: "Define Your Services", desc: "What does your team bill for? These become the line items on your invoices." },
  { id: "clients", icon: Users, title: "Add Your First Client", desc: "Every invoice needs a client. Start with one — you can add the rest later." },
  { id: "team", icon: UserPlus, title: "Build Your Team", desc: "Invite team members and employees so they can start tracking time immediately." },
  { id: "invoice", icon: FileText, title: "Send Your First Invoice", desc: "The moment you've been waiting for. Generate from tracked time or create one manually." },
];

const MANAGER_STEP_CONFIG = [
  { id: "explore_dashboard", icon: LayoutDashboard, title: "Explore Your Dashboard", desc: "Get familiar with your command center. See client activity, hours logged, and invoices at a glance." },
  { id: "review_clients", icon: Users, title: "Review Your Clients", desc: "See the clients assigned to your team. Open any client to review projects, recent activity, and outstanding work." },
  { id: "review_projects", icon: FolderKanban, title: "Review Active Projects", desc: "Check on projects your team is delivering. Track progress, budgets, and assignments from a single place." },
  { id: "invite_team", icon: UserPlus, title: "Grow Your Team", desc: "Invite team members so they can start tracking time and submitting expenses on the projects you manage." },
];

const TEAM_MEMBER_STEP_CONFIG = [
  { id: "explore_dashboard", icon: LayoutDashboard, title: "Explore Your Dashboard", desc: "Get oriented. Your dashboard shows the projects you're on, recent time entries, and anything waiting on you." },
  { id: "track_time", icon: Clock, title: "Track Your First Hour", desc: "Log time against a project and service. Use the timer or enter hours manually — whichever works best for you." },
  { id: "expenses", icon: Receipt, title: "Submit an Expense", desc: "Snap a receipt or enter an expense for reimbursement. Your manager will review and approve it from here." },
  { id: "profile", icon: UserCircle, title: "Complete Your Profile", desc: "Add your name and contact details so invoices, time sheets, and project assignments show the right person." },
];

function getStepConfig(role?: string) {
  if (role === "ADMIN") return ADMIN_STEP_CONFIG;
  if (role === "MANAGER") return MANAGER_STEP_CONFIG;
  return TEAM_MEMBER_STEP_CONFIG;
}

type StepConfigEntry = typeof ADMIN_STEP_CONFIG[number];

const ADVANCED_STEP_CONFIG = [
  { id: "gl", icon: BookOpen, title: "Set Up Your General Ledger", desc: "Initialize your chart of accounts and GL balances for full accounting control and financial reporting." },
  { id: "stripe", icon: CreditCard, title: "Enable Stripe Payments & Payouts", desc: "Accept client payments via credit card and ACH, and pay team members directly via Stripe Connect." },
  { id: "import", icon: Download, title: "Import Historical Data", desc: "Migrate invoices, GL, and projects from QuickBooks, Xero, Wave, or other platforms." },
  { id: "api", icon: Globe, title: "Enable REST API & Webhooks", desc: "Connect CherryWorks Pro to Zapier, Slack, Make, or build custom integrations. (Professional+ only)" },
];

function WhatsNewSection() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="my-12 max-w-2xl mx-auto px-6">
      <div
        className="rounded-2xl overflow-hidden transition-all"
        style={{
          background: "var(--mc-red-bg)",
          border: "2px solid rgba(207,51,57,0.15)",
          padding: "1.5rem",
        }}
      >
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center justify-between w-full cursor-pointer transition-colors hover:opacity-80"
          data-testid="whats-new-toggle"
        >
          <h3 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--mc-text)" }}>
            <Sparkles className="w-5 h-5" style={{ color: "var(--mc-red)" }} />
            What's New in CherryWorks Pro
          </h3>
          <ChevronDown
            className="w-5 h-5 transition-transform"
            style={{
              color: "var(--mc-text-muted)",
              transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            }}
          />
        </button>

        {expanded && (
          <div className="mt-4 space-y-3 text-sm" style={{ color: "var(--mc-text-secondary)" }}>
            <p className="flex items-start gap-2">
              <span style={{ color: "var(--mc-red)" }}>{"\u2192"}</span>
              <span><strong>General Ledger</strong> — Full chart of accounts, journal entries, trial balance, and GL reports for complete accounting control</span>
            </p>
            <p className="flex items-start gap-2">
              <span style={{ color: "var(--mc-red)" }}>{"\u2192"}</span>
              <span><strong>Manager Role</strong> — Empower team leads with approval permissions without giving them full admin access</span>
            </p>
            <p className="flex items-start gap-2">
              <span style={{ color: "var(--mc-red)" }}>{"\u2192"}</span>
              <span><strong>Stripe ACH Bank Transfers</strong> — Let clients pay invoices via bank transfer (lower fees, 0.8% vs 2.9%)</span>
            </p>
            <p className="flex items-start gap-2">
              <span style={{ color: "var(--mc-red)" }}>{"\u2192"}</span>
              <span><strong>Stripe Connect Payouts</strong> — Pay team members directly to their bank accounts in 1-2 days</span>
            </p>
            <p className="flex items-start gap-2">
              <span style={{ color: "var(--mc-red)" }}>{"\u2192"}</span>
              <span><strong>Multi-Platform Import</strong> — Migrate data from QuickBooks, Xero, Wave, and 5+ other platforms</span>
            </p>
            <p className="flex items-start gap-2">
              <span style={{ color: "var(--mc-red)" }}>{"\u2192"}</span>
              <span><strong>REST API & Webhooks</strong> — Connect CherryWorks Pro to Zapier, Make, Slack, or build custom integrations</span>
            </p>
            <p className="flex items-start gap-2">
              <span style={{ color: "var(--mc-red)" }}>{"\u2192"}</span>
              <span><strong>W-2/1099/C2C Classifications</strong> — Track employee type, separate first/last names, auto-connect to payroll</span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function AdvancedSetupPrompt({ onStart, onDismiss }: { onStart: () => void; onDismiss: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/30 dark:bg-black/50 flex items-center justify-center px-6 z-50">
      <div className="bg-gradient-to-br from-[#111827] to-[#1a1a2e] rounded-3xl max-w-lg w-full p-8 border border-[#333]">
        <div className="flex items-center gap-3 mb-4">
          <Sparkles className="w-6 h-6" style={{ color: "var(--mc-red)" }} />
          <h2 className="text-2xl font-bold mc-text">Ready for Advanced Features?</h2>
        </div>

        <p className="text-sm mb-6" style={{ color: "var(--mc-btn-secondary-text)" }}>
          Now that you've sent your first invoice, unlock powerful features: General Ledger, Stripe payouts, data import, and REST APIs.
        </p>

        <div className="space-y-2 mb-6">
          {ADVANCED_STEP_CONFIG.map(step => (
            <div key={step.id} className="flex items-start gap-2 text-sm" style={{ color: "var(--mc-text-muted)" }}>
              <step.icon className="w-4 h-4 mt-0.5" style={{ color: "var(--mc-red)" }} />
              <span>{step.title}</span>
            </div>
          ))}
        </div>

        <div className="flex gap-3">
          <button
            onClick={onStart}
            className="flex-1 px-4 py-2 rounded-lg font-medium text-white transition-all"
            style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)" }}
            data-testid="button-advanced-learn"
          >
            Learn More
          </button>
          <button
            onClick={onDismiss}
            className="flex-1 px-4 py-2 rounded-lg font-medium transition-all"
            style={{ background: "var(--mc-surface-hover)", color: "var(--mc-text-secondary)" }}
            data-testid="button-advanced-dismiss"
          >
            Not Now
          </button>
        </div>
      </div>
    </div>
  );
}

function WelcomeScreen({ onStart, role }: { onStart: () => void; role?: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setShow(true), 100); return () => clearTimeout(t); }, []);
  const isAdmin = role === "ADMIN";
  const isManager = role === "MANAGER";
  const heroCopy = isAdmin
    ? "Five quick steps. Takes about 3 minutes. You'll be sending your first invoice before your coffee gets cold."
    : isManager
      ? "Four quick steps to get productive. Review your team's work and keep projects on track."
      : "Four quick steps to get started. You'll be tracking time in under 2 minutes.";
  const iconRow: { icon: any; label: string }[] = isAdmin
    ? [
        { icon: Building2, label: "Firm" },
        { icon: Briefcase, label: "Services" },
        { icon: Users, label: "Clients" },
        { icon: UserPlus, label: "Team" },
        { icon: FileText, label: "Invoice" },
      ]
    : isManager
      ? [
          { icon: LayoutDashboard, label: "Dashboard" },
          { icon: Users, label: "Clients" },
          { icon: FolderKanban, label: "Projects" },
          { icon: UserPlus, label: "Team" },
        ]
      : [
          { icon: LayoutDashboard, label: "Dashboard" },
          { icon: Clock, label: "Time" },
          { icon: Receipt, label: "Expenses" },
          { icon: UserCircle, label: "Profile" },
        ];
  const gridCols = iconRow.length === 5 ? "grid-cols-5" : "grid-cols-4";

  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: "linear-gradient(135deg, #0a0f1c 0%, #111827 50%, #1a0a0a 100%)" }}>
      <div className="max-w-2xl w-full text-center transition-all duration-700" style={{ opacity: show ? 1 : 0, transform: show ? "translateY(0)" : "translateY(30px)" }}>
        <div className="w-20 h-20 rounded-3xl mx-auto mb-8 flex items-center justify-center" style={{ background: "rgba(207,51,57,0.12)", boxShadow: "0 0 60px rgba(207,51,57,0.15)" }}>
          <CherryLogo size={48} />
        </div>
        <h1 className="text-4xl md:text-5xl font-bold text-white tracking-tight mb-4">
          Welcome to CherryWorks Pro
        </h1>
        <p className="text-lg md:text-xl leading-relaxed mb-4" style={{ color: "var(--mc-text-secondary)" }}>
          You're about to set up the most powerful operating system for your professional services firm.
        </p>
        <p className="text-base mb-10" style={{ color: "var(--mc-text-faint)" }}>
          {heroCopy}
        </p>

        <div className={`grid ${gridCols} gap-3 max-w-xl mx-auto mb-12`}>
          {iconRow.map((s, i) => (
            <div key={i} className="text-center">
              <div className="w-12 h-12 rounded-xl mx-auto mb-2 flex items-center justify-center" style={{ background: "var(--mc-surface)", border: "1px solid var(--mc-border-subtle)" }}>
                <s.icon className="w-5 h-5" style={{ color: "var(--mc-text-muted)" }} />
              </div>
              <p className="text-[11px] font-medium" style={{ color: "var(--mc-text-faint)" }}>{s.label}</p>
            </div>
          ))}
        </div>

        <WhatsNewSection />

        <button
          onClick={onStart}
          className="inline-flex items-center gap-3 px-10 py-4 text-lg font-bold text-white rounded-2xl cursor-pointer transition-all hover:scale-[1.03]"
          style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)", boxShadow: "0 4px 30px rgba(207,51,57,0.4)" }}
          data-testid="button-get-started"
        >
          Let's Get Started <ArrowRight className="w-5 h-5" />
        </button>

        <div className="mt-8 flex items-center justify-center gap-6">
          {[
            { icon: Clock, text: "~3 minutes" },
            { icon: Shield, text: "Your data is encrypted" },
            { icon: Bot, text: "CherryAssist can help" },
          ].map((badge, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <badge.icon className="w-3.5 h-3.5" style={{ color: "var(--mc-text-faint)" }} />
              <span className="text-xs" style={{ color: "var(--mc-text-faint)" }}>{badge.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StepFirmProfile({ onNext }: { onNext: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: org } = useQuery<any>({ queryKey: ["/api/org/settings"] });
  const [street, setStreet] = useState("");
  const [suite, setSuite] = useState("");
  const [city, setCity] = useState("");
  const [addrState, setAddrState] = useState("");
  const [zip, setZip] = useState("");
  const [country, setCountry] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [baseCurrency, setBaseCurrency] = useState("USD");
  const [invoicePrefix, setInvoicePrefix] = useState("INV-");
  const [estimatePrefix, setEstimatePrefix] = useState("EST-");
  const [paymentTerms, setPaymentTerms] = useState(30);
  const [taxRate, setTaxRate] = useState(0);

  useEffect(() => {
    if (org) {
      const hasStructured = !!(org.addressStreet || org.addressSuite || org.addressCity || org.addressState || org.addressZip || org.addressCountry);
      if (hasStructured) {
        setStreet(org.addressStreet || "");
        setSuite(org.addressSuite || "");
        setCity(org.addressCity || "");
        setAddrState(org.addressState || "");
        setZip(org.addressZip || "");
        setCountry(org.addressCountry || "");
      } else if (org.address) {
        const parts = org.address.split(",").map((s: string) => s.trim());
        if (parts.length >= 6) {
          setStreet(parts[0]); setSuite(parts[1]); setCity(parts[2]);
          setAddrState(parts[3]); setCountry(parts[4]); setZip(parts[5]);
        } else if (parts.length >= 5) {
          setStreet(parts[0]); setCity(parts[1]); setAddrState(parts[2]);
          setCountry(parts[3]); setZip(parts[4]);
        } else if (parts.length >= 1) {
          setStreet(parts[0]); setCity(parts[1] || ""); setAddrState(parts[2] || "");
        }
      }
      setPhone(org.phone || "");
      setEmail(org.email || "");
      setWebsite(org.website || "");
      setBaseCurrency(org.baseCurrency || "USD");
      setInvoicePrefix(org.invoicePrefix || "INV-");
      setEstimatePrefix(org.estimatePrefix || "EST-");
      setPaymentTerms(org.defaultPaymentTermsDays ?? 30);
      setTaxRate(org.defaultTaxRate ? parseFloat(org.defaultTaxRate) : 0);
    }
  }, [org]);

  const save = useMutation({
    mutationFn: (data: any) => apiRequest("PATCH", "/api/org/settings", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/org/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/implementation-status"] });
      toast({ title: "Firm profile saved" });
      onNext();
    },
  });

  const handleSave = () => {
    const parts = [street, suite, [city, addrState, zip].filter(Boolean).join(", "), country].filter(Boolean);
    save.mutate({
      address: parts.join("\n"),
      addressStreet: street, addressSuite: suite, addressCity: city,
      addressState: addrState, addressZip: zip, addressCountry: country,
      phone, email, website, baseCurrency, invoicePrefix, estimatePrefix,
      defaultPaymentTermsDays: paymentTerms, defaultTaxRate: taxRate,
    });
  };

  const inputStyle = { background: "var(--mc-surface)", border: "1px solid var(--mc-border)", color: "#fff" };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="rounded-2xl p-6 mb-6" style={{ background: "var(--mc-surface)", border: "1px solid var(--mc-border-subtle)" }}>
        <div className="flex items-center gap-2 mb-5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "var(--mc-red-bg)" }}>
            <Building2 className="w-4 h-4" style={{ color: "var(--mc-red)" }} />
          </div>
          <div>
            <p className="text-sm font-bold mc-text">Mailing Address</p>
            <p className="text-xs" style={{ color: "var(--mc-text-faint)" }}>Appears on every invoice, estimate, and email</p>
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <Label className="text-xs font-semibold mc-text mb-1.5 block">Street Address</Label>
            <Input value={street} onChange={e => setStreet(e.target.value)} placeholder="123 Main Street" className="h-11 text-sm rounded-xl" style={inputStyle} />
          </div>
          <div>
            <Label className="text-xs font-semibold mc-text mb-1.5 block">Suite / Unit / Floor</Label>
            <Input value={suite} onChange={e => setSuite(e.target.value)} placeholder="Suite 400 (optional)" className="h-11 text-sm rounded-xl" style={inputStyle} />
          </div>
          <div className="grid grid-cols-6 gap-3">
            <div className="col-span-2">
              <Label className="text-xs font-semibold mc-text mb-1.5 block">City</Label>
              <Input value={city} onChange={e => setCity(e.target.value)} placeholder="New York" className="h-11 text-sm rounded-xl" style={inputStyle} />
            </div>
            <div className="col-span-1">
              <Label className="text-xs font-semibold mc-text mb-1.5 block">State</Label>
              <Input value={addrState} onChange={e => setAddrState(e.target.value)} placeholder="NY" className="h-11 text-sm rounded-xl" style={inputStyle} />
            </div>
            <div className="col-span-1">
              <Label className="text-xs font-semibold mc-text mb-1.5 block">ZIP</Label>
              <Input value={zip} onChange={e => setZip(e.target.value)} placeholder="10001" className="h-11 text-sm rounded-xl" style={inputStyle} />
            </div>
            <div className="col-span-2">
              <Label className="text-xs font-semibold mc-text mb-1.5 block">Country</Label>
              <Input value={country} onChange={e => setCountry(e.target.value)} placeholder="United States" className="h-11 text-sm rounded-xl" style={inputStyle} />
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl p-6 mb-6" style={{ background: "var(--mc-surface)", border: "1px solid var(--mc-border-subtle)" }}>
        <div className="flex items-center gap-2 mb-5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(59,130,246,0.1)" }}>
            <Globe className="w-4 h-4" style={{ color: "#3b82f6" }} />
          </div>
          <div>
            <p className="text-sm font-bold mc-text">Contact Information</p>
            <p className="text-xs" style={{ color: "var(--mc-text-faint)" }}>How clients reach your firm</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-xs font-semibold mc-text mb-1.5 block">Phone Number</Label>
            <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="(area code) prefix-line" className="h-11 text-sm rounded-xl" style={inputStyle} />
          </div>
          <div>
            <Label className="text-xs font-semibold mc-text mb-1.5 block">Billing Email</Label>
            <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="billing@yourfirm.com" type="email" className="h-11 text-sm rounded-xl" style={inputStyle} />
          </div>
          <div className="col-span-2">
            <Label className="text-xs font-semibold mc-text mb-1.5 block">Website</Label>
            <Input value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://yourfirm.com" className="h-11 text-sm rounded-xl" style={inputStyle} />
          </div>
        </div>
      </div>

      <div className="rounded-2xl p-6 mb-6" style={{ background: "var(--mc-surface)", border: "1px solid var(--mc-border-subtle)" }}>
        <div className="flex items-center gap-2 mb-5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "var(--mc-green-bg)" }}>
            <CreditCard className="w-4 h-4" style={{ color: "var(--mc-green)" }} />
          </div>
          <div>
            <p className="text-sm font-bold mc-text">Billing Defaults</p>
            <p className="text-xs" style={{ color: "var(--mc-text-faint)" }}>These apply to every new invoice and estimate</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-xs font-semibold mc-text mb-1.5 block">Base Currency</Label>
            <select value={baseCurrency} onChange={e => setBaseCurrency(e.target.value)} className="flex h-11 w-full rounded-xl px-3 py-2 text-sm" style={inputStyle}>
              {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.symbol} {c.code} — {c.name}</option>)}
            </select>
            <p className="text-[10px] mt-1" style={{ color: "var(--mc-text-faint)" }}>All reports roll up to this currency</p>
          </div>
          <div>
            <Label className="text-xs font-semibold mc-text mb-1.5 block">Default Payment Terms</Label>
            <div className="flex items-center gap-2">
              <Input value={paymentTerms} onChange={e => setPaymentTerms(parseInt(e.target.value) || 0)} type="number" className="h-11 text-sm rounded-xl w-20" style={inputStyle} />
              <span className="text-sm" style={{ color: "var(--mc-text-muted)" }}>days</span>
            </div>
          </div>
          <div>
            <Label className="text-xs font-semibold mc-text mb-1.5 block">Invoice Prefix</Label>
            <Input value={invoicePrefix} onChange={e => setInvoicePrefix(e.target.value)} placeholder="INV-" className="h-11 text-sm rounded-xl" style={inputStyle} />
            <p className="text-[10px] mt-1" style={{ color: "var(--mc-text-faint)" }}>e.g. INV-0001, INV-0002</p>
          </div>
          <div>
            <Label className="text-xs font-semibold mc-text mb-1.5 block">Estimate Prefix</Label>
            <Input value={estimatePrefix} onChange={e => setEstimatePrefix(e.target.value)} placeholder="EST-" className="h-11 text-sm rounded-xl" style={inputStyle} />
            <p className="text-[10px] mt-1" style={{ color: "var(--mc-text-faint)" }}>e.g. EST-0001, EST-0002</p>
          </div>
          <div>
            <Label className="text-xs font-semibold mc-text mb-1.5 block">Default Tax Rate</Label>
            <div className="flex items-center gap-2">
              <Input value={taxRate} onChange={e => setTaxRate(parseFloat(e.target.value) || 0)} type="number" step="0.01" className="h-11 text-sm rounded-xl w-24" style={inputStyle} />
              <span className="text-sm" style={{ color: "var(--mc-text-muted)" }}>%</span>
            </div>
          </div>
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={save.isPending}
        className="w-full flex items-center justify-center gap-2 h-14 text-base font-bold mc-text rounded-xl cursor-pointer transition-all hover:scale-[1.01] disabled:opacity-50"
        style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)", boxShadow: "0 4px 20px rgba(207,51,57,0.3)" }}
      >
        {save.isPending ? "Saving..." : "Save & Continue"} <ArrowRight className="w-5 h-5" />
      </button>
    </div>
  );
}

function StepServices({ onNext }: { onNext: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: services } = useQuery<any[]>({ queryKey: ["/api/services"] });
  const [name, setName] = useState("");
  const [rate, setRate] = useState("");

  const addService = useMutation({
    mutationFn: () => apiRequest("POST", "/api/services", { name, defaultRate: rate || null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/services"] });
      queryClient.invalidateQueries({ queryKey: ["/api/implementation-status"] });
      setName(""); setRate("");
      toast({ title: "Service added" });
    },
  });

  const suggestions = [
    { name: "Strategy", rate: "250" },
    { name: "Implementation", rate: "175" },
    { name: "Information Technology", rate: "185" },
    { name: "Project Management", rate: "145" },
    { name: "UX Design", rate: "165" },
    { name: "Development", rate: "150" },
  ];

  return (
    <div className="max-w-lg mx-auto">
      <p className="text-sm mb-6" style={{ color: "var(--mc-text-muted)" }}>
        Services are what your team bills for. Each time entry and invoice line item is tied to a service. Add at least one to continue.
      </p>

      {services && services.length > 0 && (
        <div className="mb-6 space-y-2">
          {services.map((s: any) => (
            <div key={s.id} className="flex items-center gap-3 px-4 py-3 rounded-xl" style={{ background: "rgba(34,197,94,0.04)", border: "1px solid rgba(34,197,94,0.1)" }}>
              <CheckCircle className="w-5 h-5" style={{ color: "var(--mc-green)" }} />
              <span className="text-sm font-semibold mc-text flex-1">{s.name}</span>
              {s.defaultRate && <span className="text-sm tabular-nums" style={{ color: "var(--mc-text-muted)" }}>{formatRate(s.defaultRate)}</span>}
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl p-5" style={{ background: "var(--mc-surface)", border: "1px solid var(--mc-border-subtle)" }}>
        <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: "var(--mc-text-faint)" }}>Add a service</p>
        <div className="flex gap-3">
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="Service name (e.g. Strategy)" className="flex-1 h-12 text-base rounded-xl" style={{ background: "var(--mc-surface)", border: "1px solid var(--mc-border)", color: "#fff" }} data-testid="input-service-name" />
          <Input value={rate} onChange={e => setRate(e.target.value)} placeholder="$/hr" className="w-24 h-12 text-base rounded-xl" type="number" style={{ background: "var(--mc-surface)", border: "1px solid var(--mc-border)", color: "#fff" }} data-testid="input-service-rate" />
          <button onClick={() => addService.mutate()} disabled={!name || addService.isPending} className="h-12 px-5 rounded-xl text-sm font-bold text-white cursor-pointer disabled:opacity-30" style={{ background: "rgba(207,51,57,0.8)" }} data-testid="button-add-service">Add</button>
        </div>

        {(!services || services.length === 0) && (
          <>
            <p className="text-xs mt-4 mb-2" style={{ color: "var(--mc-text-faint)" }}>Quick add from suggestions:</p>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((s, i) => (
                <button key={i} onClick={() => { setName(s.name); setRate(s.rate); }} className="text-xs px-3 py-1.5 rounded-full cursor-pointer transition-all hover:scale-105" style={{ background: "var(--mc-red-bg)", color: "#f87171", border: "1px solid rgba(207,51,57,0.15)" }} data-testid={`button-suggestion-${i}`}>
                  {s.name} · {formatMoney(s.rate)}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <button onClick={onNext} className="mt-8 w-full flex items-center justify-center gap-2 h-14 text-base font-bold text-white rounded-xl cursor-pointer transition-all hover:scale-[1.01] disabled:opacity-30" style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)", boxShadow: "0 4px 20px rgba(207,51,57,0.3)" }} data-testid="button-services-continue">
        Continue (or skip) <ArrowRight className="w-5 h-5" />
      </button>
    </div>
  );
}

function StepClients({ onNext }: { onNext: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: clients } = useQuery<any[]>({ queryKey: ["/api/clients"] });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [currency, setCurrency] = useState("USD");

  const addClient = useMutation({
    mutationFn: () => apiRequest("POST", "/api/clients", { name, email: email || null, billingCurrency: currency }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/implementation-status"] });
      setName(""); setEmail("");
      toast({ title: "Client added" });
    },
  });

  return (
    <div className="max-w-lg mx-auto">
      <p className="text-sm mb-6" style={{ color: "var(--mc-text-muted)" }}>
        Clients are the companies or people you invoice. Each client gets their own portal, billing currency, and invoice history.
      </p>

      {clients && clients.length > 0 && (
        <div className="mb-6 space-y-2">
          {clients.map((c: any) => (
            <div key={c.id} className="flex items-center gap-3 px-4 py-3 rounded-xl" style={{ background: "rgba(34,197,94,0.04)", border: "1px solid rgba(34,197,94,0.1)" }}>
              <CheckCircle className="w-5 h-5" style={{ color: "var(--mc-green)" }} />
              <span className="text-sm font-semibold mc-text flex-1">{c.name}</span>
              {c.email && <span className="text-xs" style={{ color: "var(--mc-text-faint)" }}>{c.email}</span>}
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl p-5" style={{ background: "var(--mc-surface)", border: "1px solid var(--mc-border-subtle)" }}>
        <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: "var(--mc-text-faint)" }}>Add a client</p>
        <div className="space-y-3">
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="Client name" className="h-12 text-base rounded-xl" style={{ background: "var(--mc-surface)", border: "1px solid var(--mc-border)", color: "#fff" }} data-testid="input-client-name" />
          <div className="grid grid-cols-2 gap-3">
            <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="Billing email (optional)" type="email" className="h-12 text-base rounded-xl" style={{ background: "var(--mc-surface)", border: "1px solid var(--mc-border)", color: "#fff" }} data-testid="input-client-email" />
            <select value={currency} onChange={e => setCurrency(e.target.value)} className="h-12 rounded-xl px-4 text-sm" style={{ background: "var(--mc-surface)", border: "1px solid var(--mc-border)", color: "#fff" }} data-testid="select-client-currency">
              {CURRENCIES.slice(0, 15).map(c => <option key={c.code} value={c.code}>{c.symbol} {c.code}</option>)}
            </select>
          </div>
          <button onClick={() => addClient.mutate()} disabled={!name.trim() || addClient.isPending} className="w-full h-12 rounded-xl text-sm font-bold text-white cursor-pointer disabled:opacity-30" style={{ background: "rgba(207,51,57,0.8)" }} data-testid="button-add-client">
            {addClient.isPending ? "Adding..." : "Add Client"}
          </button>
        </div>
      </div>

      <button onClick={onNext} className="mt-8 w-full flex items-center justify-center gap-2 h-14 text-base font-bold text-white rounded-xl cursor-pointer transition-all hover:scale-[1.01] disabled:opacity-30" style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)", boxShadow: "0 4px 20px rgba(207,51,57,0.3)" }} data-testid="button-clients-continue">
        Continue (or skip) <ArrowRight className="w-5 h-5" />
      </button>
    </div>
  );
}

function StepTeam({ onNext }: { onNext: () => void }) {
  const [, navigate] = useLocation();
  return (
    <div className="max-w-lg mx-auto text-center">
      <p className="text-base mb-4" style={{ color: "var(--mc-text-secondary)" }}>
        Invite your team from the Team page. Choose each person's worker type — 1099 Independent, W-2 Employee, or Corp-to-Corp — and they'll get a personalized onboarding experience with the right fields for their classification.
      </p>
      <div className="grid grid-cols-3 gap-3 mb-8">
        {[
          { type: "1099", label: "Independent", desc: "EIN, W-9, bank details", color: "#3b82f6" },
          { type: "W-2", label: "Employee", desc: "Streamlined 3-step flow", color: "var(--mc-green)" },
          { type: "C2C", label: "Corp-to-Corp", desc: "Company-level billing", color: "#f59e0b" },
        ].map((w, i) => (
          <div key={i} className="rounded-xl p-4 text-center" style={{ background: "var(--mc-surface)", border: "1px solid var(--mc-border-subtle)" }}>
            <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: `${w.color}15`, color: w.color }}>{w.type}</span>
            <p className="text-sm font-semibold mc-text mt-2">{w.label}</p>
            <p className="text-[11px] mt-1" style={{ color: "var(--mc-text-faint)" }}>{w.desc}</p>
          </div>
        ))}
      </div>
      <div className="p-4 bg-blue-50/5 rounded-lg border border-blue-500/10 mb-4">
        <p className="text-sm flex items-start gap-2" style={{ color: "var(--mc-btn-secondary-text)" }}>
          <Lightbulb className="w-4 h-4 mt-0.5" style={{ color: "#3b82f6" }} />
          <span>
            <strong>Pro tip:</strong> Once you have team members, promote your top lead to <strong>Manager</strong> so they can approve timesheets and expenses without seeing sensitive financial data.
          </span>
        </p>
      </div>
      <div className="flex gap-3 justify-center">
        <button onClick={() => navigate("/team")} className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold text-white cursor-pointer" style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)" }} data-testid="button-go-team">
          <UserPlus className="w-4 h-4" /> Go to Team Page
        </button>
        <button onClick={onNext} className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-medium cursor-pointer" style={{ color: "var(--mc-text-muted)", border: "1px solid var(--mc-border)" }} data-testid="button-skip-team">
          I'll do this later <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function StepInvoice({ onNext }: { onNext: () => void }) {
  const [, navigate] = useLocation();
  return (
    <div className="max-w-lg mx-auto text-center">
      <p className="text-base mb-4" style={{ color: "var(--mc-text-secondary)" }}>
        This is the moment everything comes together. Once your team logs time, you can generate professional invoices with one click — grouped by team member, with automatic tax and multi-currency support.
      </p>
      <div className="rounded-xl p-6 mb-8 text-left" style={{ background: "var(--mc-surface)", border: "1px solid var(--mc-border-subtle)" }}>
        <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: "var(--mc-text-faint)" }}>What happens when you invoice</p>
        {[
          { step: "1", text: "Approved billable hours auto-populate as line items" },
          { step: "2", text: "PDF generates with your firm details and branding" },
          { step: "3", text: "Client receives email with Pay Now button (Stripe)" },
          { step: "4", text: "Team payouts are auto-created for your team" },
        ].map((s, i) => (
          <div key={i} className="flex items-center gap-3 py-2" style={{ borderTop: i > 0 ? "1px solid var(--mc-border-subtle)" : "none" }}>
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: "var(--mc-red-bg)", color: "#f87171" }}>{s.step}</div>
            <p className="text-sm" style={{ color: "var(--mc-btn-secondary-text)" }}>{s.text}</p>
          </div>
        ))}
      </div>
      <div className="p-4 bg-emerald-50/5 rounded-lg border border-emerald-500/10 mb-4">
        <p className="text-sm flex items-start gap-2" style={{ color: "var(--mc-btn-secondary-text)" }}>
          <Lightbulb className="w-4 h-4 mt-0.5" style={{ color: "#10b981" }} />
          <span>
            <strong>Next:</strong> After sending your first invoice, CherryWorks Pro automatically posts journal entries to your <strong>General Ledger</strong> under GL {"\u2192"} Journal Entries. This keeps your books accurate automatically.
          </span>
        </p>
      </div>
      <div className="flex gap-3 justify-center">
        <button onClick={() => navigate("/invoices")} className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold text-white cursor-pointer" style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)" }} data-testid="button-create-invoice">
          <FileText className="w-4 h-4" /> Create First Invoice
        </button>
        <button onClick={onNext} className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-medium cursor-pointer" style={{ color: "var(--mc-text-muted)", border: "1px solid var(--mc-border)" }} data-testid="button-skip-invoice">
          I'll do this later <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function StepComplete() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const isAdmin = (user as any)?.role === "ADMIN";
  const [show, setShow] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  useEffect(() => { const t = setTimeout(() => setShow(true), 100); return () => clearTimeout(t); }, []);
  useEffect(() => { apiRequest("POST", "/api/onboarding/complete", {}).catch(() => {}); }, []);

  return (
    <div className="max-w-xl mx-auto text-center transition-all duration-700" style={{ opacity: show ? 1 : 0, transform: show ? "translateY(0)" : "translateY(20px)" }}>
      {showAdvanced && isAdmin && (
        <AdvancedSetupPrompt
          onStart={() => { setShowAdvanced(false); navigate("/settings"); }}
          onDismiss={() => setShowAdvanced(false)}
        />
      )}
      <div className="w-24 h-24 rounded-3xl mx-auto mb-8 flex items-center justify-center" style={{ background: "var(--mc-green-bg)", boxShadow: "0 0 60px rgba(34,197,94,0.1)" }}>
        <Rocket className="w-12 h-12" style={{ color: "var(--mc-green)" }} />
      </div>
      <h2 className="text-3xl md:text-4xl font-bold mc-text mb-4">You're ready to go.</h2>
      <p className="text-lg mb-4" style={{ color: "var(--mc-text-secondary)" }}>
        Your firm is set up and ready to operate. Track time, invoice clients, manage expenses, pay team members, and run reports — all from your dashboard.
      </p>
      {isAdmin && (
        <p className="text-sm mb-6" style={{ color: "var(--mc-text-muted)" }}>
          Ready to go deeper? Explore GL accounting, Stripe payouts, multi-platform import, and REST APIs in Settings.
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
        {[
          { icon: Clock, label: "Track Time", color: "var(--mc-red)" },
          { icon: FileText, label: "Send Invoices", color: "#a855f7" },
          { icon: BarChart3, label: "Run Reports", color: "#3b82f6" },
          { icon: Globe, label: "Go Global", color: "var(--mc-green)" },
        ].map((f, i) => (
          <div key={i} className="rounded-xl p-4 text-center" style={{ background: "var(--mc-surface)", border: "1px solid var(--mc-border-subtle)" }}>
            <f.icon className="w-6 h-6 mx-auto mb-2" style={{ color: f.color }} />
            <p className="text-xs font-semibold" style={{ color: "var(--mc-text-muted)" }}>{f.label}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-3 justify-center">
        <button
          onClick={() => navigate("/")}
          className="inline-flex items-center gap-3 px-10 py-4 text-lg font-bold text-white rounded-2xl cursor-pointer transition-all hover:scale-[1.03]"
          style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)", boxShadow: "0 4px 30px rgba(207,51,57,0.4)" }}
          data-testid="button-go-dashboard"
        >
          Go to Dashboard <ArrowRight className="w-5 h-5" />
        </button>
        {isAdmin && (
          <button
            onClick={() => setShowAdvanced(true)}
            className="inline-flex items-center gap-2 px-6 py-4 text-sm font-medium rounded-2xl cursor-pointer transition-all"
            style={{ background: "var(--mc-surface-hover)", color: "var(--mc-btn-secondary-text)", border: "1px solid var(--mc-border)" }}
            data-testid="button-explore-advanced"
          >
            <Sparkles className="w-4 h-4" /> Advanced Features
          </button>
        )}
      </div>
    </div>
  );
}

function NonAdminComplete({ firstName }: { firstName?: string }) {
  const [, navigate] = useLocation();
  const [show, setShow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setShow(true), 100); return () => clearTimeout(t); }, []);
  const greeting = firstName ? `You're all set, ${firstName}.` : "You're all set.";
  const tiles: { icon: any; label: string; href: string; color: string; testId: string }[] = [
    { icon: LayoutDashboard, label: "Dashboard", href: "/", color: "var(--mc-red)", testId: "tile-dashboard" },
    { icon: Clock, label: "Track Time", href: "/time", color: "#3b82f6", testId: "tile-track-time" },
    { icon: Receipt, label: "Submit Expense", href: "/expenses", color: "#a855f7", testId: "tile-submit-expense" },
    { icon: UserCircle, label: "My Profile", href: "/settings", color: "var(--mc-green)", testId: "tile-my-profile" },
  ];
  return (
    <div className="max-w-xl mx-auto text-center transition-all duration-700" style={{ opacity: show ? 1 : 0, transform: show ? "translateY(0)" : "translateY(20px)" }}>
      <div className="w-24 h-24 rounded-3xl mx-auto mb-8 flex items-center justify-center" style={{ background: "var(--mc-green-bg)", boxShadow: "0 0 60px rgba(34,197,94,0.1)" }}>
        <Rocket className="w-12 h-12" style={{ color: "var(--mc-green)" }} />
      </div>
      <h2 className="text-3xl md:text-4xl font-bold mc-text mb-4" data-testid="text-non-admin-greeting">{greeting}</h2>
      <p className="text-lg mb-10" style={{ color: "var(--mc-text-secondary)" }}>
        Your profile is ready. Head to your dashboard to start tracking time and submitting expenses.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
        {tiles.map((t, i) => (
          <button
            key={i}
            onClick={() => navigate(t.href)}
            className="rounded-xl p-4 text-center cursor-pointer transition-all hover:scale-[1.03]"
            style={{ background: "var(--mc-surface)", border: "1px solid var(--mc-border-subtle)" }}
            data-testid={t.testId}
          >
            <t.icon className="w-6 h-6 mx-auto mb-2" style={{ color: t.color }} />
            <p className="text-xs font-semibold" style={{ color: "var(--mc-text-muted)" }}>{t.label}</p>
          </button>
        ))}
      </div>
      <button
        onClick={() => navigate("/")}
        className="inline-flex items-center gap-3 px-10 py-4 text-lg font-bold text-white rounded-2xl cursor-pointer transition-all hover:scale-[1.03]"
        style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)", boxShadow: "0 4px 30px rgba(207,51,57,0.4)" }}
        data-testid="button-go-dashboard"
      >
        Go to Dashboard <ArrowRight className="w-5 h-5" />
      </button>
    </div>
  );
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function ProgressRing({ progress, size = 48 }: { progress: number; size?: number }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (progress / 100) * c;
  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--mc-progress-track)" strokeWidth={3} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#cf3339" strokeWidth={3} strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.6s ease" }} />
    </svg>
  );
}

const TABS = [
  { id: "setup", label: "Setup", icon: Rocket },
  { id: "guide", label: "Implementation Guide", icon: BookOpen },
  { id: "discover", label: "Discover", icon: Sparkles },
  { id: "whats-new", label: "What's New", icon: Star },
  { id: "tips", label: "Tips & Tricks", icon: Lightbulb },
  { id: "actions", label: "Quick Actions", icon: Zap },
] as const;

type TabId = typeof TABS[number]["id"];

const FEATURES = [
  { title: "Time Tracking", desc: "Log hours by project, service, and team member. Week, month, and day views with a floating live timer.", icon: Clock, link: "/time", color: "var(--mc-red)" },
  { title: "Invoicing", desc: "Generate invoices from approved time, send via email with PDF, and accept Stripe payments.", icon: FileText, link: "/invoices", color: "#a855f7" },
  { title: "Expenses", desc: "Track expenses with AI receipt scanning, approval workflows, and reimbursement payouts.", icon: Receipt, link: "/expenses", color: "#ef4444" },
  { title: "Reports", desc: "Financial, receivables, operations, team, payout, and expense reports with CSV export.", icon: BarChart3, link: "/reports", color: "#3b82f6" },
  { title: "Team Management", desc: "Manage W-2 employees, 1099 independents, and C2C partners with full onboarding flows.", icon: Users, link: "/team", color: "#f97316" },
  { title: "General Ledger", desc: "Double-entry accounting with chart of accounts, journal entries, trial balance, and auto-posting.", icon: BookOpen, link: "/gl/accounts", color: "#0891b2" },
  { title: "Client Portal", desc: "Every client gets a self-service portal to view invoices, payment history, and balance.", icon: Globe, link: "/clients", color: "#14b8a6" },
  { title: "Estimates", desc: "Create professional quotes, send for client approval, and convert accepted estimates to invoices.", icon: Calculator, link: "/estimates", color: "#d946ef" },
  { title: "Payouts", desc: "Auto-generated team payouts with Stripe Connect for ACH direct deposits.", icon: Banknote, link: "/payouts", color: "var(--mc-green)" },
  { title: "Banking", desc: "Connect bank accounts via Stripe Financial Connections with auto-matching and reconciliation.", icon: CreditCard, link: "/banking", color: "#0d9488" },
  { title: "Import Data", desc: "Migrate from FreshBooks, QuickBooks, Harvest, Xero, and 4 more platforms with rollback.", icon: Download, link: "/import", color: "#ec4899" },
];

const CHANGELOG = [
  { date: "Mar 2026", title: "CherryAssist AI Upgrade", desc: "Ultra-premium chat assistant with animated gradient borders, expandable article cards, fuzzy search, typing indicators, and keyboard shortcuts.", category: "Enhancement" },
  { date: "Mar 2026", title: "Team Page W-2/1099/C2C Classification", desc: "Redesigned team management with grid cards, filter pills, tabbed member detail dialogs, and full payroll field support.", category: "New Feature" },
  { date: "Feb 2026", title: "Stripe ACH Direct Deposits", desc: "Pay team members via Stripe Connect with Express accounts, bulk execute, and real-time status tracking.", category: "Integration" },
  { date: "Feb 2026", title: "Expense Reports with GL Auto-Posting", desc: "Group expenses into submittable reports with full approval workflow and automatic journal entry creation.", category: "New Feature" },
  { date: "Jan 2026", title: "AI Receipt Scanner", desc: "Upload receipt photos and AI extracts vendor, date, amount, tax, and category automatically.", category: "New Feature" },
  { date: "Jan 2026", title: "General Ledger Module", desc: "Full double-entry accounting with chart of accounts, journal entries, trial balance, and GL migration.", category: "New Feature" },
  { date: "Dec 2025", title: "Group by Team Member Invoicing", desc: "Generate invoices grouped by team member, project, or service for detailed client billing.", category: "Enhancement" },
  { date: "Dec 2025", title: "Multi-Currency Support", desc: "Invoice in 30+ currencies with exchange rates captured at generation time. Per-client billing currency.", category: "New Feature" },
  { date: "Nov 2025", title: "Zapier-Ready Payroll Webhooks", desc: "API endpoints for syncing timesheet hours and employee data with external payroll providers.", category: "Integration" },
  { date: "Nov 2025", title: "Recurring Invoice Templates", desc: "Automate repetitive billing with daily, weekly, biweekly, monthly, quarterly, or yearly schedules.", category: "New Feature" },
];

const CATEGORY_COLORS: Record<string, string> = {
  "New Feature": "#22c55e",
  "Enhancement": "#3b82f6",
  "Integration": "#a855f7",
};

const TIPS = [
  { title: "CherryAssist Shortcut", body: "Press / anywhere in the app to instantly open CherryAssist and ask a question." },
  { title: "Invoice Grouping", body: "Group invoices by team member for detailed client billing, or by service for a cleaner summary." },
  { title: "Lower Processing Fees", body: "Set up Stripe ACH for bank-to-bank payments at lower fees than credit card processing." },
  { title: "Migrate in Minutes", body: "Import your FreshBooks, QuickBooks, or Harvest data with our 7-step migration wizard with full rollback." },
  { title: "Track Real Profitability", body: "Set cost rates on project assignments to see true margin on every project in real time." },
  { title: "Weekly Timesheet Workflow", body: "Submit timesheets weekly for faster approval cycles and more accurate invoicing." },
  { title: "Recurring Templates", body: "Set up recurring invoice templates for retainer clients to automate monthly billing." },
  { title: "Double-Entry Accounting", body: "Enable auto-post in Settings to automatically create GL journal entries for every financial event." },
  { title: "Utilization Tracking", body: "Track non-billable time alongside billable hours to measure your team's true utilization rate." },
  { title: "1099 Year-End Compliance", body: "Export 1099 reports from the Reports page at year-end for team member tax compliance." },
  { title: "AI Receipt Scanning", body: "Upload a photo of any receipt and AI auto-fills vendor, date, amount, and category for you." },
  { title: "Client Portal Links", body: "Every client automatically gets a portal link for self-service access to invoices and payments." },
];

const QUICK_ACTIONS = [
  { label: "Create Invoice", icon: FileText, link: "/invoices", color: "#a855f7" },
  { label: "Log Time", icon: Clock, link: "/time", color: "var(--mc-red)" },
  { label: "Add Client", icon: Users, link: "/clients", color: "#14b8a6" },
  { label: "Add Team Member", icon: UserPlus, link: "/team", color: "#f97316" },
  { label: "Create Expense", icon: Receipt, link: "/expenses", color: "#ef4444" },
  { label: "AR Aging Report", icon: BarChart3, link: "/reports", color: "#3b82f6" },
  { label: "View Dashboard", icon: Layout, link: "/", color: "#8b5cf6" },
  { label: "Import Data", icon: Download, link: "/import", color: "#ec4899" },
  { label: "Manage Services", icon: Briefcase, link: "/services", color: "#0ea5e9" },
  { label: "Org Settings", icon: Settings, link: "/settings", color: "#6b7280" },
];

function DiscoverTab() {
  const [, navigate] = useLocation();
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" style={{ animation: "mc-fadeStagger 0.4s ease-out" }}>
      {FEATURES.map((f, i) => {
        const Icon = f.icon;
        return (
          <button
            key={i}
            className="rounded-xl p-5 cursor-pointer transition-all hover:scale-[1.02] text-left"
            style={{
              background: "var(--mc-surface)",
              border: "1px solid var(--mc-border-subtle)",
              animationDelay: `${i * 50}ms`,
            }}
            onClick={() => navigate(f.link)}
            data-testid={`card-discover-${i}`}
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: `${f.color}12` }}>
              <Icon className="w-5 h-5" style={{ color: f.color }} />
            </div>
            <h3 className="text-sm font-bold mc-text mb-1">{f.title}</h3>
            <p className="text-[12px] leading-relaxed mb-3" style={{ color: "var(--mc-text-muted)" }}>{f.desc}</p>
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: f.color }}>
              Explore <ArrowUpRight className="w-3 h-3" />
            </span>
          </button>
        );
      })}
    </div>
  );
}

function WhatsNewTab() {
  return (
    <div className="max-w-2xl mx-auto" style={{ animation: "mc-fadeStagger 0.4s ease-out" }}>
      <div className="relative">
        <div className="absolute left-[18px] top-4 bottom-4 w-px" style={{ background: "var(--mc-surface-hover)" }} />
        <div className="space-y-6">
          {CHANGELOG.map((entry, i) => {
            const catColor = CATEGORY_COLORS[entry.category] || "#6b7280";
            return (
              <div key={i} className="flex gap-4 relative" style={{ animationDelay: `${i * 60}ms` }}>
                <div className="flex-shrink-0 w-9 flex justify-center pt-1 z-10">
                  <div className="w-3 h-3 rounded-full" style={{ background: catColor, boxShadow: `0 0 8px ${catColor}40` }} />
                </div>
                <div className="flex-1 rounded-xl p-4" style={{ background: "var(--mc-surface)", border: "1px solid var(--mc-border-subtle)" }}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] font-bold tabular-nums" style={{ color: "var(--mc-text-faint)" }}>{entry.date}</span>
                    <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: `${catColor}15`, color: catColor }}>
                      {entry.category}
                    </span>
                  </div>
                  <h3 className="text-sm font-bold mc-text mb-1">{entry.title}</h3>
                  <p className="text-[12px] leading-relaxed" style={{ color: "var(--mc-text-muted)" }}>{entry.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TipsTab() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4" style={{ animation: "mc-fadeStagger 0.4s ease-out" }}>
      {TIPS.map((tip, i) => (
        <div
          key={i}
          className="rounded-xl p-5"
          style={{
            background: "var(--mc-surface)",
            border: "1px solid var(--mc-border-subtle)",
            backdropFilter: "blur(8px)",
          }}
          data-testid={`card-tip-${i}`}
        >
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "var(--mc-red-bg)" }}>
              <Lightbulb className="w-4 h-4" style={{ color: "#f59e0b" }} />
            </div>
            <div>
              <h3 className="text-[13px] font-bold mc-text mb-1">{tip.title}</h3>
              <p className="text-[12px] leading-relaxed" style={{ color: "var(--mc-text-muted)" }}>{tip.body}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function QuickActionsTab() {
  const [, navigate] = useLocation();
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4" style={{ animation: "mc-fadeStagger 0.4s ease-out" }}>
      {QUICK_ACTIONS.map((action, i) => {
        const Icon = action.icon;
        return (
          <button
            key={i}
            onClick={() => navigate(action.link)}
            className="rounded-xl p-5 text-center cursor-pointer transition-all hover:scale-[1.04]"
            style={{
              background: "var(--mc-surface)",
              border: "1px solid var(--mc-border-subtle)",
            }}
            data-testid={`action-${i}`}
          >
            <div className="w-12 h-12 rounded-xl mx-auto mb-3 flex items-center justify-center" style={{ background: `${action.color}12` }}>
              <Icon className="w-6 h-6" style={{ color: action.color }} />
            </div>
            <p className="text-[12px] font-semibold mc-text">{action.label}</p>
          </button>
        );
      })}
    </div>
  );
}

function SetupRecap({ steps, onRedo, stepConfig }: { steps: Step[]; onRedo: () => void; stepConfig: StepConfigEntry[] }) {
  const [, navigate] = useLocation();
  const [showConfirm, setShowConfirm] = useState(false);

  return (
    <div className="max-w-xl mx-auto" style={{ animation: "mc-fadeStagger 0.4s ease-out" }}>
      <div className="text-center mb-8">
        <div className="w-16 h-16 rounded-2xl mx-auto mb-5 flex items-center justify-center" style={{ background: "var(--mc-green-bg)" }}>
          <CheckCircle className="w-8 h-8" style={{ color: "var(--mc-green)" }} />
        </div>
        <h2 className="text-2xl font-bold mc-text mb-2" data-testid="text-setup-complete">Setup Complete</h2>
        <p className="text-sm" style={{ color: "var(--mc-text-muted)" }}>All setup steps are done. You can revisit any step below or head to your dashboard.</p>
      </div>

      <div className="space-y-2 mb-8">
        {steps.map((step, i) => {
          const config = stepConfig[i];
          if (!config) return null;
          const Icon = config.icon;
          return (
            <div
              key={step.id}
              className="flex items-center gap-3 rounded-xl px-4 py-3"
              style={{ background: "var(--mc-surface)", border: "1px solid var(--mc-border-subtle)" }}
              data-testid={`recap-step-${step.id}`}
            >
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "var(--mc-green-bg)" }}>
                <Icon className="w-4 h-4" style={{ color: "var(--mc-green)" }} />
              </div>
              <span className="flex-1 text-sm font-medium mc-text">{config.title}</span>
              <Check className="w-4 h-4" style={{ color: "var(--mc-green)" }} />
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Dashboard", path: "/", icon: Layout, testId: "button-go-dashboard", primary: true },
          { label: "Clients", path: "/clients", icon: Users, testId: "button-go-clients", primary: false },
          { label: "Invoices", path: "/invoices", icon: FileText, testId: "button-go-invoices", primary: false },
          { label: "Time Tracking", path: "/time", icon: Clock, testId: "button-go-time", primary: false },
        ].map(link => (
          <button
            key={link.path}
            onClick={() => navigate(link.path)}
            className={`inline-flex items-center justify-center gap-2 px-4 py-3 text-sm font-bold rounded-2xl cursor-pointer transition-all hover:scale-[1.03] ${link.primary ? 'text-white' : ''}`}
            style={link.primary
              ? { background: "linear-gradient(135deg, #cf3339, #e74c3c)", boxShadow: "0 4px 30px rgba(207,51,57,0.4)" }
              : { background: "var(--mc-surface-hover)", color: "var(--mc-btn-secondary-text)", border: "1px solid var(--mc-border)" }
            }
            data-testid={link.testId}
          >
            <link.icon className="w-4 h-4" /> {link.label}
          </button>
        ))}
      </div>

      <div className="text-center mt-8">
        <button
          onClick={() => setShowConfirm(true)}
          className="text-xs font-medium cursor-pointer transition-colors hover:underline"
          style={{ color: "var(--mc-text-faint)" }}
          data-testid="button-redo-onboarding"
        >
          Redo onboarding
        </button>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 bg-black/30 dark:bg-black/50 flex items-center justify-center px-6 z-50">
          <div className="rounded-2xl max-w-sm w-full p-6" style={{ background: "var(--mc-modal-bg)", border: "1px solid var(--mc-border)" }}>
            <h3 className="text-lg font-bold mc-text mb-3" data-testid="text-redo-confirm-title">Redo Onboarding?</h3>
            <p className="text-sm mb-5" style={{ color: "var(--mc-text-muted)" }}>
              This will reset your onboarding progress. Continue?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => { setShowConfirm(false); onRedo(); }}
                className="flex-1 px-4 py-2 rounded-lg font-medium text-white text-sm"
                style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)" }}
                data-testid="button-confirm-redo"
              >
                Yes, redo
              </button>
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 px-4 py-2 rounded-lg font-medium text-sm"
                style={{ background: "var(--mc-surface-hover)", color: "var(--mc-text-secondary)" }}
                data-testid="button-cancel-redo"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SetupWizardTab({ status, steps, orgOnboardingComplete, stepConfig }: { status: any; steps: Step[]; orgOnboardingComplete: boolean; stepConfig: StepConfigEntry[] }) {
  const allComplete = status?.allComplete ?? false;
  const [currentStep, setCurrentStep] = useState(-1);
  const [redoMode, setRedoMode] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (steps.length > 0 && currentStep === -1) {
      const firstIncomplete = steps.findIndex(s => !s.complete);
      if (firstIncomplete >= 0) setCurrentStep(firstIncomplete);
      else setCurrentStep(steps.length);
    }
  }, [steps, currentStep]);

  const handleRedo = async () => {
    try {
      await apiRequest("POST", "/api/onboarding/reset", {});
      queryClient.invalidateQueries({ queryKey: ["/api/implementation-status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/status"] });
      setRedoMode(true);
      setCurrentStep(0);
    } catch {}
  };

  const showRecap = (allComplete || orgOnboardingComplete) && currentStep >= steps.length && !redoMode;
  if (showRecap) {
    return <SetupRecap steps={steps} onRedo={handleRedo} stepConfig={stepConfig} />;
  }

  const isComplete = currentStep >= steps.length;
  const goNext = () => setCurrentStep(c => Math.min(c + 1, steps.length));
  const goBack = () => setCurrentStep(c => Math.max(c - 1, 0));
  const config = !isComplete && currentStep >= 0 ? stepConfig[currentStep] : null;

  const remaining = steps.filter(s => !s.complete).length;

  const stepContent = () => {
    if (isComplete) return <StepComplete />;
    if (currentStep < 0) return null;
    switch (steps[currentStep]?.id) {
      case "firm": return <StepFirmProfile onNext={goNext} />;
      case "services": return <StepServices onNext={goNext} />;
      case "clients": return <StepClients onNext={goNext} />;
      case "team": return <StepTeam onNext={goNext} />;
      case "invoice": return <StepInvoice onNext={goNext} />;
      default: return null;
    }
  };

  if (currentStep === -1) return null;

  return (
    <div style={{ animation: "mc-fadeStagger 0.4s ease-out" }}>
      {!isComplete && (
        <div className="mb-8">
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold" style={{ color: "var(--mc-text-muted)" }} data-testid="text-step-label">
                {remaining === 0 ? "All done!" : remaining === 1 ? "1 step remaining" : `${remaining} steps remaining`}
              </span>
              <span className="text-xs" style={{ color: "var(--mc-text-faint)" }}>{status?.completedCount || 0} of {steps.length} complete</span>
            </div>
            <div className="flex gap-2">
              {steps.map((s, i) => (
                <button
                  key={s.id}
                  onClick={() => setCurrentStep(i)}
                  className="flex-1 h-2.5 rounded-full transition-all duration-500 cursor-pointer relative overflow-hidden"
                  style={{ background: "var(--mc-surface-hover)" }}
                  data-testid={`progress-step-${i}`}
                >
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: i < currentStep || s.complete ? "100%" : i === currentStep ? "50%" : "0%",
                      background: i < currentStep || s.complete ? "#22c55e" : "#cf3339",
                    }}
                  />
                </button>
              ))}
            </div>
            <div className="flex mt-2">
              {stepConfig.map((s, i) => (
                <button key={i} onClick={() => setCurrentStep(i)} className="flex-1 text-center cursor-pointer">
                  <span className="text-[10px] font-medium" style={{ color: i === currentStep ? "var(--mc-red)" : i < currentStep ? "var(--mc-green)" : "var(--mc-text-faint)" }}>{s.title.replace("Set Up Your ", "").replace("Define Your ", "").replace("Add Your First ", "").replace("Build Your ", "").replace("Send Your First ", "")}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div>
        {!isComplete && config && (
          <div className="text-center mb-12">
            <div className="w-16 h-16 rounded-2xl mx-auto mb-5 flex items-center justify-center" style={{ background: "var(--mc-red-bg)" }}>
              <config.icon className="w-8 h-8" style={{ color: "var(--mc-red)" }} />
            </div>
            <h1 className="text-2xl md:text-4xl font-bold mc-text mb-3">{config.title}</h1>
            <p className="text-base" style={{ color: "var(--mc-text-muted)" }}>{config.desc}</p>
          </div>
        )}
        {stepContent()}
        {!isComplete && currentStep > 0 && (
          <div className="text-center mt-6">
            <button onClick={goBack} className="text-sm font-medium cursor-pointer flex items-center gap-1 mx-auto" style={{ color: "var(--mc-text-faint)" }} data-testid="button-previous-step">
              <ArrowLeft className="w-4 h-4" /> Previous step
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ImplementationGuideTab() {
  const [expandedPhase, setExpandedPhase] = useState<number | null>(0);

  const togglePhase = (index: number) => {
    setExpandedPhase(expandedPhase === index ? null : index);
  };

  const phases = [
    {
      number: 1,
      title: "Foundation Setup",
      subtitle: "Firm profile, billing defaults, email delivery, and chart of accounts",
      duration: "~3 min",
      color: "var(--mc-red)",
      steps: [
        {
          title: "Complete Your Firm Profile",
          description: "Go to Settings \u2192 Firm Profile. Add your firm name, mailing address, phone, billing email, and website. These details appear on every invoice, estimate, and client-facing email.",
          link: "/getting-started",
          checklist: ["Firm name and legal entity", "Full mailing address (street, city, state, ZIP)", "Phone number and billing email", "Website URL"],
          proTip: "Upload your firm logo in Settings \u2192 Branding \u2014 it appears on invoices, estimates, and the client portal automatically.",
        },
        {
          title: "Configure Billing Defaults",
          description: "Go to Settings \u2192 Billing. Set your base currency, default payment terms, invoice/estimate prefixes, and default tax rate. Every new invoice inherits these settings.",
          link: "/settings",
          checklist: ["Base currency (e.g. USD, EUR, GBP)", "Default payment terms (e.g. Net 30)", "Invoice prefix (e.g. INV-) and estimate prefix (e.g. EST-)", "Default tax rate"],
          proTip: "You can override these defaults on any individual invoice \u2014 they\u2019re just starting points to save you time.",
        },
        {
          title: "Set Up Email Delivery (SMTP)",
          description: "Go to Settings \u2192 Email. Configure outbound email so invoices and reminders come from your domain instead of a generic address.",
          link: "/settings",
          checklist: ["SMTP host and port", "Sender email address (e.g. billing@yourfirm.com)", "Send a test email to verify delivery"],
          proTip: "If you skip SMTP setup, emails still send from noreply@cherryworkspro.com \u2014 but your own domain looks more professional.",
        },
        {
          title: "Initialize Chart of Accounts",
          description: "Go to General Ledger \u2192 Chart of Accounts. CherryWorks Pro ships with a default chart of accounts for professional services firms. Review and customize it for your business.",
          link: "/gl/accounts",
          checklist: ["Review the default account structure", "Add custom accounts if needed (e.g. specific expense categories)", "Verify revenue and expense account mappings"],
          proTip: "Migrating from QuickBooks or Xero? You can import your existing chart of accounts in Phase 5 instead of setting it up manually.",
        },
      ],
    },
    {
      number: 2,
      title: "Services & Rates",
      subtitle: "Create billing categories that become your invoice line items",
      duration: "~2 min",
      color: "#3b82f6",
      steps: [
        {
          title: "Create Billing Categories",
          description: "Go to Services. Services are the billable activities your team performs \u2014 every time entry and invoice line item ties to one. Create at least one to continue.",
          link: "/services",
          checklist: ["Add your primary service (e.g. Strategy, Development, Design)", "Set a default hourly rate for each service", "Add additional services for different work types or specialties"],
          proTip: "You can set per-project and per-team-member rate overrides later \u2014 default rates here are just the starting point.",
        },
      ],
    },
    {
      number: 3,
      title: "Team Onboarding",
      subtitle: "Add members, set worker types (W-2/1099/C2C), roles, and bill & cost rates",
      duration: "~3 min",
      color: "var(--mc-green)",
      steps: [
        {
          title: "Add Team Members",
          description: "Go to Team \u2192 Invite. Send email invitations to team members, employees, and managers. Each person gets their own login, onboarding flow, and time tracking dashboard.",
          link: "/team",
          checklist: ["Enter each member\u2019s first name, last name, and email", "Select worker classification: W-2 (employee), 1099 (team member), or C2C (corp-to-corp)", "Assign a role: Team Member (time only), Manager (approvals), or Admin (full access)"],
          proTip: "Managers can approve time and expenses but can\u2019t access billing or GL settings. Use this role for team leads and delivery managers.",
        },
        {
          title: "Set Bill Rates & Cost Rates",
          description: "For each team member, set their bill rate (what clients pay) and cost rate (your internal cost). This powers profitability reporting and margin analysis.",
          link: "/team",
          checklist: ["Set a default bill rate per team member", "Set a cost rate for margin calculations", "Review rate hierarchy: member rate > project rate > service rate"],
          proTip: "Cost rates are internal \u2014 clients never see them. Set them to the member\u2019s loaded cost (salary + benefits + overhead) for accurate profitability.",
        },
      ],
    },
    {
      number: 4,
      title: "Clients & Projects",
      subtitle: "Create clients, set up projects, and assign your team members",
      duration: "~3 min",
      color: "#f59e0b",
      steps: [
        {
          title: "Add Your First Client",
          description: "Go to Clients \u2192 New Client. Create a client record with their company name, billing contact, email, and address. Each client gets their own portal automatically.",
          link: "/clients",
          checklist: ["Client company name", "Primary billing contact name and email", "Billing address", "Payment terms (or use your firm\u2019s default from Phase 1)"],
          proTip: "Double-check the client contact\u2019s email \u2014 that\u2019s where invoices and estimates get delivered.",
        },
        {
          title: "Create Projects & Assign Team",
          description: "Go to Projects \u2192 New Project. Link each project to a client, assign team members, and optionally set project-specific rates and budgets.",
          link: "/projects",
          checklist: ["Project name and description", "Link to a client", "Assign team members from Phase 3", "Set project-specific rates or budgets (optional)"],
          proTip: "Team members only see projects they\u2019re assigned to \u2014 use this for client confidentiality between engagement teams.",
        },
      ],
    },
    {
      number: 5,
      title: "Data Migration",
      subtitle: "Import from FreshBooks, QuickBooks, Harvest, or Xero \u2014 or skip if starting fresh",
      duration: "~3 min",
      color: "#8b5cf6",
      steps: [
        {
          title: "Import Historical Data (Migrating Users)",
          description: "Go to Settings \u2192 Import. Use the import tool to bring in clients, invoices, time entries, and GL data from your previous platform. Supported: FreshBooks, QuickBooks, Harvest, Xero, Wave, and CSV.",
          link: "/import",
          checklist: ["Export data from your previous platform (CSV or native format)", "Upload to the CherryWorks Pro import tool", "Map fields to CherryWorks Pro schema", "Review the import preview before confirming"],
          proTip: "Run a small test import first (e.g. 5 invoices) to verify field mapping before importing everything. You can always re-import.",
        },
        {
          title: "Validate Imported Data",
          description: "After importing, spot-check a few records to make sure everything came through correctly. Compare totals from your old platform to CherryWorks Pro.",
          link: "/clients",
          checklist: ["Client names and contact info transferred correctly", "Invoice totals match your previous platform", "Time entry hours and rates are accurate", "GL account balances reconcile (if imported)"],
          proTip: "Check the Reports \u2192 Revenue by Client view to quickly compare totals against your old system\u2019s reports.",
        },
        {
          title: "Skip This Phase (Fresh Start Users)",
          description: "Starting from scratch? No data to migrate? You\u2019re all set \u2014 skip ahead to Phase 6. Everything you need is already configured from the previous phases.",
          link: "",
          checklist: ["Confirm you have no historical data to import", "Proceed directly to Go Live & Verify"],
          proTip: "You can always come back to import data later. The import tool is available anytime under Settings \u2192 Import.",
        },
      ],
    },
    {
      number: 6,
      title: "Go Live & Verify",
      subtitle: "Quick smoke test: time entry, invoice, and dashboard in under a minute",
      duration: "~1 min",
      color: "#ec4899",
      steps: [
        {
          title: "Log a Test Time Entry",
          description: "Go to Time Tracking. Select a project and service, enter 1 hour, add a description, and submit. This confirms time tracking is wired up correctly.",
          link: "/time",
          checklist: ["Select a project and service from your setup", "Enter 1 hour with a test description", "Submit and verify it appears in the time log"],
          proTip: "Use the week view to batch-enter time for an entire week \u2014 it\u2019s much faster than one entry at a time.",
        },
        {
          title: "Generate a Test Invoice",
          description: "Go to Invoices \u2192 New Invoice. Create an invoice from your test time entry. Review the line items, tax, and total, then preview the PDF.",
          link: "/invoices",
          checklist: ["Create an invoice from the test time entry", "Verify line items, rates, and tax calculation", "Preview the PDF to check your firm branding"],
          proTip: "Enable Stripe payments so clients can pay directly from the invoice email \u2014 average collection time drops to 3 days.",
        },
        {
          title: "Check Your Dashboard",
          description: "Go to Dashboard. Verify your test data is flowing through: revenue, hours tracked, outstanding invoices, and client count should all reflect your setup.",
          link: "/",
          checklist: ["Revenue widget shows your test invoice amount", "Hours tracked reflects your test time entry", "Client count matches the clients you added"],
          proTip: "Bookmark the dashboard \u2014 it\u2019s your daily command center for revenue, utilization, and cash flow at a glance.",
        },
      ],
    },
  ];

  return (
    <div style={{ animation: "mc-fadeStagger 0.4s ease-out" }}>
      <div className="text-center mb-10">
        <h2 className="text-2xl font-bold mc-text mb-2">Implementation Guide</h2>
        <p className="text-sm" style={{ color: "var(--mc-text-muted)" }}>
          Set up CherryWorks Pro in ~15 minutes — whether you're starting fresh or migrating from FreshBooks, QuickBooks, Harvest, or Xero
        </p>
      </div>

      <div className="max-w-3xl mx-auto relative">
        <div
          className="absolute left-[23px] top-8 bottom-8 w-[2px]"
          style={{
            background: "linear-gradient(180deg, #cf3339 0%, #3b82f6 20%, #22c55e 40%, #f59e0b 60%, #8b5cf6 80%, #ec4899 100%)",
            opacity: 0.3,
          }}
        />

        <div className="space-y-4">
          {phases.map((phase, index) => {
            const isExpanded = expandedPhase === index;
            return (
              <div key={phase.number} className="relative pl-14" data-testid={`phase-${phase.number}`}>
                <button
                  onClick={() => togglePhase(index)}
                  className="absolute left-0 top-0 w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold transition-all cursor-pointer"
                  style={{
                    background: isExpanded ? phase.color : "var(--mc-surface)",
                    border: `2px solid ${isExpanded ? phase.color : "var(--mc-border)"}`,
                    color: isExpanded ? "var(--mc-text)" : "var(--mc-text-muted)",
                    boxShadow: isExpanded ? `0 0 20px ${phase.color}33` : "none",
                  }}
                  data-testid={`phase-toggle-${phase.number}`}
                >
                  {phase.number}
                </button>

                <div
                  className="rounded-2xl overflow-hidden transition-all"
                  style={{
                    background: isExpanded ? "var(--mc-surface)" : "var(--mc-surface)",
                    border: `1px solid ${isExpanded ? `${phase.color}33` : "var(--mc-border-subtle)"}`,
                  }}
                  data-testid={`phase-header-${phase.number}`}
                >
                  <button
                    onClick={() => togglePhase(index)}
                    className="w-full text-left p-5 cursor-pointer"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2.5">
                          <h3 className="text-base font-bold mc-text">{phase.title}</h3>
                          <span
                            className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                            style={{ background: `${phase.color}20`, color: phase.color }}
                          >
                            {phase.duration}
                          </span>
                        </div>
                        <p className="text-xs mt-1" style={{ color: "var(--mc-text-muted)" }}>{phase.subtitle}</p>
                      </div>
                      <ChevronDown
                        className="w-4 h-4 transition-transform flex-shrink-0"
                        style={{
                          color: "var(--mc-text-faint)",
                          transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                        }}
                      />
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-5 pb-5 space-y-4">
                      {phase.steps.map((step, si) => (
                        <div
                          key={si}
                          className="rounded-xl p-4"
                          style={{ background: "var(--mc-surface)", border: "1px solid var(--mc-border-subtle)" }}
                          data-testid={`phase-${phase.number}-step-${si}`}
                        >
                          <div className="flex items-start justify-between gap-3 mb-2">
                            <div>
                              <h4 className="text-sm font-bold mc-text">{step.title}</h4>
                              <p className="text-xs mt-1" style={{ color: "var(--mc-text-muted)" }}>{step.description}</p>
                            </div>
                            {step.link && (
                              <Link href={step.link}>
                                <span
                                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg cursor-pointer transition-opacity hover:opacity-80 flex-shrink-0"
                                  style={{ background: `${phase.color}20`, color: phase.color }}
                                  data-testid={`go-link-${phase.number}-${si}`}
                                >
                                  Go <ArrowUpRight className="w-3 h-3" />
                                </span>
                              </Link>
                            )}
                          </div>

                          <div className="space-y-1.5 mt-3">
                            {step.checklist.map((item, ci) => (
                              <div key={ci} className="flex items-start gap-2">
                                <div
                                  className="w-4 h-4 rounded border flex-shrink-0 mt-0.5 flex items-center justify-center"
                                  style={{ borderColor: "var(--mc-border)", background: "var(--mc-surface)" }}
                                >
                                  <Check className="w-2.5 h-2.5" style={{ color: "var(--mc-text-faint)" }} />
                                </div>
                                <span className="text-xs" style={{ color: "var(--mc-text-muted)" }}>{item}</span>
                              </div>
                            ))}
                          </div>

                          {step.proTip && (
                            <div
                              className="mt-3 flex items-start gap-2 rounded-lg px-3 py-2.5"
                              style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.12)" }}
                            >
                              <Lightbulb className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: "#f59e0b" }} />
                              <span className="text-xs" style={{ color: "rgba(245,158,11,0.8)" }}>{step.proTip}</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="max-w-3xl mx-auto mt-10">
        <div
          className="rounded-2xl p-6 text-center"
          style={{ background: "rgba(207,51,57,0.04)", border: "1px solid rgba(207,51,57,0.12)" }}
          data-testid="guide-help-cta"
        >
          <p className="text-sm font-medium mc-text">Need help with any step?</p>
          <p className="text-xs mt-1" style={{ color: "var(--mc-text-muted)" }}>
            Click the red help button in the top-right corner to open CherryAssist.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function GettingStartedPage() {
  useDocumentTitle("Getting Started");
  const { user } = useAuth();
  const [, location] = useLocation();
  const role = (user as any)?.role as string | undefined;
  const isAdmin = role === "ADMIN";
  const isManager = role === "MANAGER";

  const { data: status, isLoading } = useQuery<{ steps: Step[]; completedCount: number; totalSteps: number; allComplete: boolean }>({
    queryKey: ["/api/implementation-status"],
    enabled: isAdmin,
  });
  const { data: onboardingStatus } = useQuery<{ onboardingComplete: boolean; completedSteps: number[]; totalSteps: number }>({
    queryKey: ["/api/onboarding/status"],
    enabled: isAdmin,
  });
  const [showWelcome, setShowWelcome] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("setup");

  const { data: clients } = useQuery<any[]>({ queryKey: ["/api/clients"], enabled: isAdmin });
  const { data: kpis } = useQuery<any>({ queryKey: ["/api/reports/executive-kpis"], enabled: isAdmin });
  const { data: timeEntries } = useQuery<any[]>({ queryKey: ["/api/time-entries"], enabled: isAdmin });

  useEffect(() => {
    if (!isAdmin) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("welcome") === "true") {
      setShowWelcome(true);
    }
  }, [isAdmin]);

  if (!isAdmin) {
    return (
      <div className="min-h-full flex items-center justify-center px-6 py-16" style={{ background: "var(--mc-page-bg)" }} data-testid="getting-started-non-admin">
        <NonAdminComplete firstName={(user as any)?.firstName || (user as any)?.name?.split(" ")[0]} />
      </div>
    );
  }

  if (isLoading) return (
    <div className="min-h-full flex items-center justify-center" style={{ background: "var(--mc-page-bg)" }}>
      <div className="text-center">
        <CherryLogo size={40} />
        <p className="text-sm mt-4 animate-pulse" style={{ color: "var(--mc-text-muted)" }}>Loading your workspace...</p>
      </div>
    </div>
  );

  const stepConfig = getStepConfig(role);

  if (showWelcome) {
    return <WelcomeScreen onStart={() => { setShowWelcome(false); }} role={role} />;
  }

  const steps = status?.steps || [];
  const completedCount = status?.completedCount || 0;
  const progressPct = steps.length > 0 ? Math.round((completedCount / steps.length) * 100) : 0;

  const totalClients = clients?.length || 0;
  const totalInvoiced = kpis?.revenueThisMonth || 0;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const hoursThisMonth = timeEntries?.reduce((sum: number, te: any) => {
    const d = new Date(te.date);
    if (d >= monthStart) return sum + ((parseFloat(te.minutes) || 0) / 60);
    return sum;
  }, 0) || 0;

  const firstName = (user as any)?.firstName || (user as any)?.name?.split(" ")[0] || "there";

  return (
    <div className="min-h-full" style={{ background: "var(--mc-page-bg)" }}>
      <style>{`
        @keyframes mc-fadeStagger {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div className="px-6 pt-6 pb-5" style={{ background: "var(--mc-hero-bg)", borderBottom: "1px solid var(--mc-hero-border)" }}>
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "var(--mc-red-bg)" }}>
                <CherryLogo size={24} />
              </div>
              <div>
                <h1 className="text-xl font-bold mc-text tracking-tight" data-testid="text-mission-control-title">Mission Control</h1>
                <p className="text-[12px]" style={{ color: "var(--mc-text-faint)" }}>Your command center for everything CherryWorks Pro</p>
              </div>
            </div>
            <Link href="/">
              <span className="text-xs font-medium cursor-pointer transition-colors hover:mc-text" style={{ color: "var(--mc-text-faint)" }}>Dashboard</span>
            </Link>
          </div>

          <p className="text-[15px] font-medium mc-text mb-5" data-testid="text-greeting">{getGreeting()}, {firstName}</p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <div className="rounded-xl p-4 flex items-center gap-3" style={{ background: "var(--mc-surface)", border: "1px solid var(--mc-border-subtle)" }} data-testid="stat-setup-progress">
              <div className="relative">
                <ProgressRing progress={progressPct} size={44} />
                <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold mc-text tabular-nums">{progressPct}%</span>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--mc-text-faint)" }}>Setup</p>
                <p className="text-sm font-bold mc-text tabular-nums">{completedCount}/{steps.length}</p>
              </div>
            </div>
            <div className="rounded-xl p-4" style={{ background: "var(--mc-surface)", border: "1px solid var(--mc-border-subtle)" }} data-testid="stat-clients">
              <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--mc-text-faint)" }}>Clients</p>
              <p className="text-xl font-bold mc-text tabular-nums">{totalClients}</p>
            </div>
            <div className="rounded-xl p-4" style={{ background: "var(--mc-surface)", border: "1px solid var(--mc-border-subtle)" }} data-testid="stat-invoiced">
              <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--mc-text-faint)" }}>Invoiced (This Month)</p>
              <p className="text-xl font-bold mc-text tabular-nums">${totalInvoiced.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
            </div>
            <div className="rounded-xl p-4" style={{ background: "var(--mc-surface)", border: "1px solid var(--mc-border-subtle)" }} data-testid="stat-hours">
              <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--mc-text-faint)" }}>Hours This Month</p>
              <p className="text-xl font-bold mc-text tabular-nums">{hoursThisMonth.toFixed(1)}</p>
            </div>
          </div>

          <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Mission Control sections" style={{ scrollbarWidth: "none" }}>
            {TABS.filter(tab => tab.id !== "guide" || isAdmin || isManager).map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`tabpanel-${tab.id}`}
                  onClick={() => setActiveTab(tab.id)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full text-[12px] font-semibold cursor-pointer transition-all whitespace-nowrap"
                  style={{
                    background: isActive ? "var(--mc-tab-active-bg)" : "var(--mc-surface)",
                    color: isActive ? "var(--mc-tab-active-text)" : "var(--mc-tab-inactive-text)",
                    border: isActive ? "1px solid rgba(207,51,57,0.25)" : "1px solid var(--mc-border-subtle)",
                  }}
                  data-testid={`tab-${tab.id}`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="px-6 py-8">
        <div className="max-w-6xl mx-auto" role="tabpanel" id={`tabpanel-${activeTab}`} aria-labelledby={`tab-${activeTab}`}>
          {activeTab === "setup" && <SetupWizardTab status={status} steps={steps} orgOnboardingComplete={onboardingStatus?.onboardingComplete ?? false} stepConfig={stepConfig} />}
          {activeTab === "guide" && (isAdmin || isManager) && <ImplementationGuideTab />}
          {activeTab === "discover" && <DiscoverTab />}
          {activeTab === "whats-new" && <WhatsNewTab />}
          {activeTab === "tips" && <TipsTab />}
          {activeTab === "actions" && <QuickActionsTab />}
        </div>
      </div>
    </div>
  );
}
