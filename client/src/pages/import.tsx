import { useState, useCallback, useRef, useMemo } from "react";
import { UpgradeWall } from "@/components/upgrade-wall";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, getCSRFToken } from "@/lib/queryClient";
import { PageHelpLink } from "@/components/page-help-link";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { formatMoney } from "@/components/shared/format";
import { useBillingStatus } from "@/hooks/use-billing-status";
import { Link, Redirect, useLocation } from "wouter";
import {
  Upload,
  FileText,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Play,
  Eye,
  Loader2,
  Filter,
  Check,
  CloudUpload,
  X,
  ArrowRight,
  Database,
  Clock,
  Layers,
  Zap,
  Hash,
  Users,
  BarChart3,
  Calendar,
  ShieldCheck,
  DollarSign,
  Receipt,
  CreditCard,
  Briefcase,
  BookOpen,
  Calculator,
  Sun,
  Waves,
  Timer,
  Copy,
  ChevronDown,
  ChevronRight,
  Info,
  CircleAlert,
  CircleX,
  Settings,
  RefreshCw,
  ArrowLeftRight,
  ArrowLeft,
  Ban,
  Lock,
} from "lucide-react";
import { useDocumentTitle } from "@/lib/use-document-title";

type WizardStep = "platform" | "upload" | "preflight" | "options" | "dryrun" | "execute" | "history";

type ImportPreset = "FULL_IMPORT" | "OPEN_AR_ONLY" | "LAST_12_MONTHS" | "PAYOUTS_ONLY" | "TIME_ENTRIES_ONLY" | "INVOICES_ONLY";

interface ExpenseBreakdowns {
  byParentCategory: Array<{ key: string; label: string; count: number; amount: number }>;
  byMerchant: Array<{ name: string; count: number; amount: number }>;
  byPayee: Array<{ name: string; count: number; amount: number }>;
  topN: number;
  merchantOther: { count: number; amount: number };
  payeeOther: { count: number; amount: number };
}

interface PreflightFile {
  type: string;
  filename: string;
  sha256: string;
  rowCount: number;
  dateRange: { min: string; max: string } | null;
  uniqueClients: string[];
  uniqueTeamMembers: string[];
  uniqueInvoiceNumbers: string[];
  totalInvoiceLineSum: number;
  openARSum: number;
  independentPayoutSum: number;
  duplicateTimeRows: number;
  nameNormalizationCandidates: string[];
  noServiceTimeRows: number;
  payeeBreakdown: {
    totalImportedPayoutRows: number;
    uniquePayees: string[];
    payeeParseFallbackCount: number;
  } | null;
  expenseBreakdowns: ExpenseBreakdowns | null;
  parseIntegrity?: {
    physicalLineCount: number;
    parsedRecordCount: number;
    ignoredRowCount: number;
    ignoredRowBreakdown: Record<string, number>;
  };
}

interface ImportOptions {
  importClients: boolean;
  importServices: boolean;
  servicesNonZeroOnly: boolean;
  importTeamMembers: boolean;
  importInvoices: boolean;
  invoicePaidCutoffStart: string;
  invoicePaidCutoffEnd: string;
  importHistoricalPayments: boolean;
  importTimeEntries: boolean;
  timeEntryDateStart: string;
  timeEntryDateEnd: string;
  timeEntrySkipDuplicates: boolean;
  importImportedPayouts: boolean;
  payoutDateStart: string;
  payoutDateEnd: string;
  expenseCategoryIncludeList: string[];
  payeeIncludeList: string[];
}

interface ReconciliationLeg {
  source: number;
  imported: number;
  diff: number;
}

interface Reconciliation {
  invoiceTotal: ReconciliationLeg;
  timeHours: ReconciliationLeg;
  expenseTotal: ReconciliationLeg;
  isBalanced: boolean;
}

interface RowIssueSummary {
  totalErrors: number;
  totalWarnings: number;
  skippedRows: number;
}

interface RowIssue {
  row: number;
  field?: string;
  severity: "error" | "warning";
  message: string;
  rawValue?: string;
}

interface FileRowCounts {
  totalSourceRows: number;
  processedRows: number;
  skippedRows: number;
  warningRows: number;
}

interface DryRunPlan {
  clientsToCreate: number;
  projectsToCreate: number;
  invoicesToCreate: number;
  invoiceLinesToCreate: number;
  paymentsToCreate: number;
  timeEntriesToCreate: number;
  payoutsToCreate: number;
  nameMerges: Array<{ original: string; normalized: string }>;
  skippedDuplicateKeys: number;
  planHash: string;
  ignoredBreakdown: Record<string, number>;
  opCountsByType: Record<string, number>;
  rowIssues: RowIssue[];
  rowIssueSummary: RowIssueSummary;
  reconciliation: Reconciliation;
  fileRowCounts: Record<string, FileRowCounts>;
}

interface VerificationCheck {
  entity: string;
  metric: string;
  expected: number;
  actual: number;
  passed: boolean;
}

interface ExecuteResult {
  status: string;
  counts: Record<string, number>;
  rowIssues: RowIssue[];
  rowIssueSummary: RowIssueSummary;
  reconciliation: Reconciliation;
  fileRowCounts: Record<string, FileRowCounts>;
  verification: {
    passed: boolean;
    checks: VerificationCheck[];
  };
}

const PRESET_CONFIGS: Record<ImportPreset, Partial<ImportOptions>> = {
  FULL_IMPORT: {
    importClients: true,
    importServices: true,
    importTeamMembers: true,
    importInvoices: true,
    importHistoricalPayments: true,
    importTimeEntries: true,
    importImportedPayouts: true,
  },
  OPEN_AR_ONLY: {
    importClients: true,
    importServices: false,
    importTeamMembers: false,
    importInvoices: true,
    importHistoricalPayments: false,
    importTimeEntries: false,
    importImportedPayouts: false,
  },
  LAST_12_MONTHS: {
    importClients: true,
    importServices: true,
    importTeamMembers: true,
    importInvoices: true,
    importHistoricalPayments: true,
    importTimeEntries: true,
    importImportedPayouts: true,
    invoicePaidCutoffStart: new Date(new Date().setMonth(new Date().getMonth() - 12)).toISOString().slice(0, 10),
    invoicePaidCutoffEnd: "",
    timeEntryDateStart: new Date(new Date().setMonth(new Date().getMonth() - 12)).toISOString().slice(0, 10),
    timeEntryDateEnd: "",
    payoutDateStart: new Date(new Date().setMonth(new Date().getMonth() - 12)).toISOString().slice(0, 10),
    payoutDateEnd: "",
  },
  PAYOUTS_ONLY: {
    importClients: false,
    importServices: false,
    importTeamMembers: true,
    importInvoices: false,
    importHistoricalPayments: false,
    importTimeEntries: false,
    importImportedPayouts: true,
    expenseCategoryIncludeList: ["independents"],
    payeeIncludeList: [],
  },
  TIME_ENTRIES_ONLY: {
    importClients: true,
    importServices: false,
    importTeamMembers: false,
    importInvoices: false,
    importHistoricalPayments: false,
    importTimeEntries: true,
    importImportedPayouts: false,
  },
  INVOICES_ONLY: {
    importClients: true,
    importServices: false,
    importTeamMembers: false,
    importInvoices: true,
    importHistoricalPayments: true,
    importTimeEntries: false,
    importImportedPayouts: false,
  },
};

const PRESET_LABELS: Record<ImportPreset, string> = {
  FULL_IMPORT: "Full Import",
  OPEN_AR_ONLY: "Open AR Only",
  LAST_12_MONTHS: "Last 12 Months",
  PAYOUTS_ONLY: "Payouts Only",
  TIME_ENTRIES_ONLY: "Time Entries Only",
  INVOICES_ONLY: "Invoices Only",
};

export default function ImportPage() {
  useDocumentTitle("Import");
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const { isProfessionalPlus, planTier, isLoading: billingLoading } = useBillingStatus();
  const [step, setStep] = useState<WizardStep>("platform");
  const [selectedPlatform, setSelectedPlatform] = useState<string>("");
  const [importRunId, setImportRunId] = useState<string | null>(null);
  const [preflightResults, setPreflightResults] = useState<PreflightFile[]>([]);
  const [dryRunPlan, setDryRunPlan] = useState<DryRunPlan | null>(null);
  const [planHash, setPlanHash] = useState<string>("");
  const [executeResult, setExecuteResult] = useState<ExecuteResult | null>(null);
  const [rollbackConfirmId, setRollbackConfirmId] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [hideNonSelected, setHideNonSelected] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<ImportPreset | null>("FULL_IMPORT");
  const [options, setOptions] = useState<ImportOptions>({
    importClients: true,
    importServices: true,
    servicesNonZeroOnly: false,
    importTeamMembers: true,
    importInvoices: true,
    invoicePaidCutoffStart: "",
    invoicePaidCutoffEnd: "",
    importHistoricalPayments: true,
    importTimeEntries: true,
    timeEntryDateStart: "",
    timeEntryDateEnd: "",
    timeEntrySkipDuplicates: false,
    importImportedPayouts: true,
    payoutDateStart: "",
    payoutDateEnd: "",
    expenseCategoryIncludeList: [],
    payeeIncludeList: [],
  });

  const applyPreset = (preset: ImportPreset) => {
    setSelectedPreset(preset);
    setOptions((prev) => ({ ...prev, ...PRESET_CONFIGS[preset] }));
  };

  const runsQuery = useQuery<any[]>({
    queryKey: ["/api/import/runs"],
    enabled: step === "history" || step === "execute",
  });

  const uploadMutation = useMutation({
    mutationFn: async (files: FileList) => {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append("files", files[i]);
      }
      const csrfToken = getCSRFToken();
      const res = await fetch("/api/import/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
        headers: csrfToken ? { "X-CSRF-Token": csrfToken } : {},
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (data) => {
      setImportRunId(data.importRunId);
      setPreflightResults(data.files);
      setStep("preflight");
      toast({ title: "Files uploaded", description: `${data.files.length} file(s) analyzed` });
    },
    onError: (err: Error) => {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    },
  });

  const dryRunMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/import/dry-run/${importRunId}`, options);
      return res.json();
    },
    onSuccess: (data) => {
      setDryRunPlan(data);
      setPlanHash(data.planHash || "");
      setStep("dryrun");
    },
    onError: (err: Error) => {
      toast({ title: "Dry run failed", description: err.message, variant: "destructive" });
    },
  });

  const executeMutation = useMutation({
    mutationFn: async () => {
      setIsExecuting(true);
      setStep("execute");
      const res = await apiRequest("POST", `/api/import/execute/${importRunId}`, {
        ...options,
        planHash,
      });
      return res.json();
    },
    onSuccess: (data: ExecuteResult) => {
      setIsExecuting(false);
      setExecuteResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/import/runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
    },
    onError: (err: Error) => {
      setIsExecuting(false);
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
      setStep("dryrun");
    },
  });

  const rollbackMutation = useMutation({
    mutationFn: async (runId: string) => {
      const res = await apiRequest("POST", `/api/import/rollback/${runId}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Rollback complete" });
      queryClient.invalidateQueries({ queryKey: ["/api/import/runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
    },
    onError: (err: Error) => {
      toast({ title: "Rollback failed", description: err.message, variant: "destructive" });
    },
  });

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        uploadMutation.mutate(e.target.files);
      }
    },
    [uploadMutation],
  );

  const allCategories = preflightResults
    .filter((f) => f.expenseBreakdowns)
    .flatMap((f) => f.expenseBreakdowns!.byParentCategory.map((c) => c.key));
  const uniqueCategories = Array.from(new Set(allCategories)).sort();

  const allPayees = preflightResults
    .filter((f) => f.payeeBreakdown)
    .flatMap((f) => f.payeeBreakdown!.uniquePayees);
  const uniquePayees = Array.from(new Set(allPayees)).sort();

  if (user?.role !== "ADMIN" && user?.role !== "MANAGER") {
    return <Redirect to="/" />;
  }

  return (
    <>
    <div className="px-6 lg:px-8 xl:px-10 pt-6">
      <PageBreadcrumbs group="System" page="Import" />
    </div>
    <UpgradeWall requiredTier="PROFESSIONAL" featureName="Import" description="The Import Wizard lets you migrate data from FreshBooks, QuickBooks, and other platforms. Available on Professional plans and above.">
    <div className="px-6 lg:px-8 xl:px-10 pt-2 pb-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold" style={{ color: "var(--lux-text)" }} data-testid="text-import-title">
            Import Wizard
          </h1>
          <PageHelpLink />
        </div>
        <Button
          variant="outline"
          onClick={() => setStep(step === "history" ? "upload" : "history")}
          data-testid="button-toggle-history"
        >
          {step === "history" ? "New Import" : "Import History"}
        </Button>
      </div>

      {step !== "history" && <ImportStepper currentStep={step} />}

      {step === "platform" && (
        <PlatformSelectionStep
          selectedPlatform={selectedPlatform}
          onSelectPlatform={setSelectedPlatform}
          onContinue={() => setStep("upload")}
        />
      )}

      {step === "upload" && (
        <FileUploadStep
          selectedPlatform={selectedPlatform}
          uploadMutation={uploadMutation}
          onBack={() => setStep("platform")}
        />
      )}

      {step === "preflight" && (
        <PreflightAuditDashboard
          preflightResults={preflightResults}
          options={options}
          hideNonSelected={hideNonSelected}
          onContinue={() => setStep("options")}
          onBack={() => setStep("upload")}
        />
      )}

      {step === "options" && (
        <OptionsPanel
          options={options}
          setOptions={setOptions}
          preflightResults={preflightResults}
          hideNonSelected={hideNonSelected}
          setHideNonSelected={setHideNonSelected}
          uniqueCategories={uniqueCategories}
          uniquePayees={uniquePayees}
          selectedPreset={selectedPreset}
          onApplyPreset={applyPreset}
          onDryRun={() => dryRunMutation.mutate()}
          onBack={() => setStep("preflight")}
          isDryRunPending={dryRunMutation.isPending}
        />
      )}

      {step === "dryrun" && dryRunPlan && (
        <DryRunResultsDashboard
          plan={dryRunPlan}
          planHash={planHash}
          onExecute={() => executeMutation.mutate()}
          onRerun={() => {
            dryRunMutation.mutate();
          }}
          onBack={() => setStep("options")}
          isExecutePending={executeMutation.isPending}
          isDryRunPending={dryRunMutation.isPending}
        />
      )}

      {step === "execute" && (
        <ExecuteResultsDashboard
          isExecuting={isExecuting}
          executeResult={executeResult}
          dryRunPlan={dryRunPlan}
          importRunId={importRunId}
          runsQuery={runsQuery}
          rollbackMutation={rollbackMutation}
          rollbackConfirmId={rollbackConfirmId}
          setRollbackConfirmId={setRollbackConfirmId}
          onNewImport={() => {
            setStep("platform");
            setSelectedPlatform("");
            setImportRunId(null);
            setPreflightResults([]);
            setDryRunPlan(null);
            setPlanHash("");
            setExecuteResult(null);
            setSelectedPreset("FULL_IMPORT");
          }}
          onViewHistory={() => setStep("history")}
        />
      )}

      {step === "history" && (
        <ImportHistoryPanel
          runsQuery={runsQuery}
          rollbackMutation={rollbackMutation}
          rollbackConfirmId={rollbackConfirmId}
          setRollbackConfirmId={setRollbackConfirmId}
        />
      )}
    </div>
    </UpgradeWall>
    </>
  );
}

const STEPPER_STEPS: { key: WizardStep; label: string }[] = [
  { key: "platform", label: "Platform" },
  { key: "upload", label: "Upload" },
  { key: "preflight", label: "Preflight" },
  { key: "options", label: "Options" },
  { key: "dryrun", label: "Dry Run" },
  { key: "execute", label: "Execute" },
];

function ImportStepper({ currentStep }: { currentStep: WizardStep }) {
  const currentIndex = STEPPER_STEPS.findIndex(s => s.key === currentStep);

  return (
    <div
      className="rounded-2xl px-8 py-6"
      style={{
        background: "var(--lux-surface)",
        boxShadow: "var(--lux-card-shadow)",
        border: "1px solid var(--lux-border)",
      }}
      data-testid="import-stepper"
    >
      <div className="flex items-center justify-between relative">
        <div
          className="absolute top-5 left-0 right-0 h-[2px]"
          style={{ background: "var(--lux-border)", zIndex: 0 }}
        />
        <div
          className="absolute top-5 left-0 h-[2px] transition-all duration-700 ease-out"
          style={{
            background: "var(--gradient-brand)",
            width: currentIndex === 0 ? "0%" : `${(currentIndex / (STEPPER_STEPS.length - 1)) * 100}%`,
            zIndex: 1,
          }}
        />
        {STEPPER_STEPS.map((s, i) => {
          const isCompleted = i < currentIndex;
          const isCurrent = i === currentIndex;
          const isFuture = i > currentIndex;

          return (
            <div
              key={s.key}
              className="flex flex-col items-center relative"
              style={{ zIndex: 2 }}
              data-testid={`badge-step-${s.key}`}
            >
              <div
                className="flex items-center justify-center rounded-full transition-all duration-500"
                style={{
                  width: isCurrent ? 44 : 36,
                  height: isCurrent ? 44 : 36,
                  background: isCompleted
                    ? "var(--color-accent)"
                    : isCurrent
                    ? "var(--lux-surface)"
                    : "var(--lux-surface)",
                  border: isCompleted
                    ? "2px solid var(--color-accent)"
                    : isCurrent
                    ? "3px solid var(--color-accent)"
                    : "2px solid var(--lux-border-strong, rgba(0,0,0,0.12))",
                  boxShadow: isCurrent
                    ? "0 0 0 4px rgba(var(--lux-accent-rgb), 0.15), 0 2px 8px rgba(var(--lux-accent-rgb), 0.2)"
                    : isCompleted
                    ? "0 2px 6px rgba(var(--lux-accent-rgb), 0.25)"
                    : "none",
                  animation: isCurrent ? "stepper-pulse 2s ease-in-out infinite" : "none",
                }}
              >
                {isCompleted ? (
                  <Check className="w-4 h-4 text-white" strokeWidth={3} />
                ) : (
                  <span
                    className="text-xs font-bold"
                    style={{
                      fontVariantNumeric: "tabular-nums",
                      color: isCurrent ? "var(--color-accent)" : "var(--lux-text-muted)",
                    }}
                  >
                    {i + 1}
                  </span>
                )}
              </div>
              <span
                className="text-[11px] font-medium mt-2 whitespace-nowrap transition-colors duration-300"
                style={{
                  color: isCompleted
                    ? "var(--color-accent)"
                    : isCurrent
                    ? "var(--lux-text)"
                    : "var(--lux-text-muted)",
                  fontWeight: isCurrent ? 600 : 500,
                }}
              >
                {s.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const PLATFORMS = [
  { id: "freshbooks", name: "FreshBooks", color: "#0075DD", icon: BookOpen, types: ["Clients", "Services", "Time", "Invoices", "Expenses", "Vendors", "GL / Opening Balances"] },
  { id: "quickbooks", name: "QuickBooks", color: "#2CA01C", icon: Calculator, types: ["Clients", "Services", "Time", "Invoices", "Expenses", "GL / Opening Balances"] },
  { id: "harvest", name: "Harvest", color: "#FA5D00", icon: Sun, types: ["Clients", "Time", "Invoices", "Expenses", "Projects"] },
  { id: "xero", name: "Xero", color: "#13B5EA", icon: BarChart3, types: ["Contacts", "Services", "Invoices", "Bills", "Expenses", "GL / Opening Balances"] },
  { id: "wave", name: "Wave", color: "#004A82", icon: Waves, types: ["Customers", "Invoices", "Transactions", "Receipts", "GL / Opening Balances"] },
  { id: "bigtime", name: "BigTime", color: "#1B75BC", icon: Briefcase, types: ["Clients", "Projects", "Time", "Invoices"] },
  { id: "scoro", name: "Scoro", color: "#3D5AFE", icon: Layers, types: ["Contacts", "Projects", "Time", "Invoices", "Expenses"] },
  { id: "paymo", name: "Paymo", color: "#F4511E", icon: Timer, types: ["Clients", "Projects", "Time", "Invoices"] },
];

function getPlatformDisplayName(id: string): string {
  return PLATFORMS.find(p => p.id === id)?.name || id.charAt(0).toUpperCase() + id.slice(1);
}

function PlatformSelectionStep({
  selectedPlatform,
  onSelectPlatform,
  onContinue,
}: {
  selectedPlatform: string;
  onSelectPlatform: (id: string) => void;
  onContinue: () => void;
}) {
  return (
    <div className="space-y-6">
      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)", border: "1px solid var(--lux-border)" }}
      >
        <div className="px-8 pt-8 pb-4">
          <h2 className="text-lg font-semibold mb-1" style={{ color: "var(--lux-text)" }}>
            Choose Your Platform
          </h2>
          <p className="text-sm" style={{ color: "var(--lux-text-muted)" }}>
            Select the platform you're importing from. We'll show you exactly which files to export.
          </p>
        </div>
        <div className="px-8 pb-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {PLATFORMS.map(p => {
              const isSelected = selectedPlatform === p.id;
              const Icon = p.icon;
              return (
                <button
                  key={p.id}
                  onClick={() => onSelectPlatform(p.id)}
                  className="relative rounded-xl p-5 text-left transition-all duration-200 cursor-pointer group"
                  data-testid={`platform-card-${p.id}`}
                  style={{
                    background: isSelected ? `${p.color}14` : "var(--lux-surface)",
                    borderLeft: `3px solid ${isSelected ? p.color : `${p.color}4D`}`,
                    borderTop: `1px solid ${isSelected ? p.color : `${p.color}4D`}`,
                    borderRight: `1px solid ${isSelected ? p.color : `${p.color}4D`}`,
                    borderBottom: `1px solid ${isSelected ? p.color : `${p.color}4D`}`,
                    boxShadow: isSelected
                      ? `0 0 0 1px ${p.color}4D, 0 4px 16px ${p.color}1F`
                      : "0 1px 3px rgba(0,0,0,0.04)",
                    transform: isSelected ? "scale(1.02)" : "scale(1)",
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = `${p.color}14`;
                      e.currentTarget.style.boxShadow = `0 4px 12px ${p.color}1F`;
                      e.currentTarget.style.transform = "scale(1.02)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = "var(--lux-surface)";
                      e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.04)";
                      e.currentTarget.style.transform = "scale(1)";
                    }
                  }}
                >
                  {isSelected && (
                    <div
                      className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center"
                      style={{ background: p.color }}
                    >
                      <Check className="w-3 h-3 text-white" strokeWidth={3} />
                    </div>
                  )}
                  <Icon
                    className="w-6 h-6 mb-3"
                    style={{ color: p.color }}
                  />
                  <div
                    className="text-sm font-semibold mb-2"
                    style={{ color: p.color }}
                  >
                    {p.name}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {p.types.map(t => (
                      <span
                        key={t}
                        className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                        style={{
                          background: isSelected ? `${p.color}12` : "var(--color-surface-3)",
                          color: isSelected ? p.color : "var(--lux-text-muted)",
                        }}
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-4 text-center">
            <button
              onClick={() => onSelectPlatform("generic")}
              className="text-xs underline underline-offset-2 transition-colors"
              style={{ color: "var(--lux-text-muted)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--color-accent)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--lux-text-muted)")}
              data-testid="link-generic-csv"
            >
              Not sure? Upload any CSV and we'll detect the format
            </button>
          </div>
        </div>

        {selectedPlatform && selectedPlatform !== "generic" && (
          <div
            className="mx-8 mb-6 rounded-xl p-5"
            style={{
              background: "var(--color-surface-2)",
              border: "1px solid var(--lux-border)",
            }}
          >
            <h4 className="text-sm font-semibold mb-3" style={{ color: "var(--lux-text)" }}>
              How to export from {getPlatformDisplayName(selectedPlatform)}
            </h4>
            <div className="text-xs leading-relaxed space-y-2" style={{ color: "var(--lux-text-secondary)" }}>
              {selectedPlatform === "freshbooks" && (
                <>
                  <p>In FreshBooks, export each data type separately as CSV files:</p>
                  <p><strong>Clients:</strong> Go to Clients → Manage Clients → Download CSV</p>
                  <p><strong>Services:</strong> Go to Accounting → Chart of Accounts → Export Services</p>
                  <p><strong>Time Entries:</strong> Go to Reports → Time Entry Details → Export CSV</p>
                  <p><strong>Invoices:</strong> Go to Reports → Invoice Details → Export CSV</p>
                  <p><strong>Expenses:</strong> Go to Expenses → Export Expenses → CSV</p>
                  <p><strong>Vendors:</strong> Go to Expenses → Manage Vendors → Download CSV</p>
                  <p><strong>GL / Opening Balances:</strong> Go to Reports → Trial Balance → Export CSV</p>
                </>
              )}
              {selectedPlatform === "quickbooks" && (
                <>
                  <p>In QuickBooks Online, export data from the Settings menu:</p>
                  <p><strong>Customers:</strong> Go to Settings (gear icon) → Export Data → select Customers</p>
                  <p><strong>Services/Products:</strong> Go to Settings → Products & Services → Export to Excel, save as CSV</p>
                  <p><strong>Invoices:</strong> Go to Reports → run Invoice List → Export to Excel, save as CSV</p>
                  <p><strong>Time:</strong> Go to Reports → run Time Activities → Export to Excel, save as CSV</p>
                  <p><strong>Expenses:</strong> Go to Reports → run Expenses by Vendor → Export to Excel, save as CSV</p>
                  <p><strong>GL / Opening Balances:</strong> Go to Reports → Balance Sheet → Export to CSV</p>
                </>
              )}
              {selectedPlatform === "harvest" && (
                <>
                  <p>In Harvest, export from Settings and Reports:</p>
                  <p><strong>All Time:</strong> Go to Settings → Import/Export → Export all time (CSV)</p>
                  <p><strong>Clients:</strong> Go to Manage → Clients → Export (CSV)</p>
                  <p><strong>Projects:</strong> Go to Projects → Export (CSV)</p>
                  <p><strong>Invoices:</strong> Go to Invoices → Report → Export (CSV)</p>
                  <p><strong>Expenses:</strong> Go to Reports → Detailed Expense → Export (CSV)</p>
                </>
              )}
              {selectedPlatform === "xero" && (
                <>
                  <p>In Xero, export from each section:</p>
                  <p><strong>Contacts:</strong> Go to Contacts → All Contacts → Export</p>
                  <p><strong>Invoices:</strong> Go to Business → Invoices → Export</p>
                  <p><strong>Bills:</strong> Go to Business → Bills to pay → Export</p>
                  <p><strong>Expenses:</strong> Go to Business → Expense claims → Export</p>
                  <p><strong>GL / Opening Balances:</strong> Go to Accounting → Reports → Trial Balance → Export</p>
                </>
              )}
              {selectedPlatform === "wave" && (
                <>
                  <p>In Wave, export from each section:</p>
                  <p><strong>Customers:</strong> Go to Sales → Customers → Export CSV</p>
                  <p><strong>Invoices:</strong> Go to Sales → Invoices → Export CSV</p>
                  <p><strong>Transactions:</strong> Go to Accounting → Transactions → Export CSV</p>
                  <p><strong>Receipts:</strong> Go to Accounting → Receipts → Export CSV</p>
                  <p><strong>GL / Opening Balances:</strong> Go to Reports → Balance Sheet → Export CSV</p>
                </>
              )}
              {selectedPlatform === "bigtime" && (
                <>
                  <p>In BigTime, export from Reports:</p>
                  <p><strong>Clients:</strong> Go to My Company → Clients → Export to CSV</p>
                  <p><strong>Projects:</strong> Go to My Company → Projects → Export to CSV</p>
                  <p><strong>Time:</strong> Go to Reports → Time & Expense Detail → Export CSV</p>
                  <p><strong>Invoices:</strong> Go to Reports → Invoice Detail → Export CSV</p>
                </>
              )}
              {selectedPlatform === "scoro" && (
                <>
                  <p>In Scoro, export from each module:</p>
                  <p><strong>Contacts:</strong> Go to Contacts → List view → Export CSV</p>
                  <p><strong>Projects:</strong> Go to Projects → List view → Export CSV</p>
                  <p><strong>Time:</strong> Go to Work → Time entries → Export CSV</p>
                  <p><strong>Invoices:</strong> Go to Finance → Invoices → Export CSV</p>
                  <p><strong>Expenses:</strong> Go to Finance → Expenses → Export CSV</p>
                </>
              )}
              {selectedPlatform === "paymo" && (
                <>
                  <p>In Paymo, export from each section:</p>
                  <p><strong>Clients:</strong> Go to Clients → Export CSV</p>
                  <p><strong>Projects:</strong> Go to Projects → Export CSV</p>
                  <p><strong>Time:</strong> Go to Reports → Time Reports → Export CSV</p>
                  <p><strong>Invoices:</strong> Go to Invoices → Export CSV</p>
                </>
              )}
            </div>
          </div>
        )}

        <div className="px-8 pb-8">
          <button
            onClick={onContinue}
            disabled={!selectedPlatform}
            className="w-full py-3.5 rounded-xl text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: selectedPlatform ? "var(--gradient-brand)" : "var(--lux-border)",
              boxShadow: selectedPlatform ? "0 4px 14px rgba(var(--lux-accent-rgb), 0.3)" : "none",
            }}
            data-testid="button-continue-to-upload"
            onMouseEnter={(e) => { if (selectedPlatform) e.currentTarget.style.transform = "translateY(-1px)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; }}
          >
            Continue to Upload
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

const FILE_TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  clients: { bg: "#dcfce7", text: "#166534" },
  services: { bg: "#fef3c7", text: "#92400e" },
  time_entry_details: { bg: "#dbeafe", text: "#1e40af" },
  invoice_details: { bg: "#ede9fe", text: "#5b21b6" },
  expense_details: { bg: "#fce7f3", text: "#9d174d" },
  vendors: { bg: "#e0e7ff", text: "#3730a3" },
  projects: { bg: "#ccfbf1", text: "#115e59" },
  unknown: { bg: "#f3f4f6", text: "#374151" },
};

function getFileTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    clients: "Clients",
    services: "Services",
    time_entry_details: "Time Entries",
    invoice_details: "Invoices",
    expense_details: "Expenses",
    vendors: "Vendors",
    projects: "Projects",
  };
  return labels[type] || type;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileUploadStep({
  selectedPlatform,
  uploadMutation,
  onBack,
}: {
  selectedPlatform: string;
  uploadMutation: ReturnType<typeof useMutation<any, Error, FileList>>;
  onBack: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadedFileInfos, setUploadedFileInfos] = useState<Array<{
    filename: string;
    size: number;
    type: string;
    sha256: string;
  }>>([]);

  const handleFiles = useCallback((files: FileList | File[]) => {
    const fileList = Array.from(files).filter(f => {
      const name = f.name.toLowerCase();
      return name.endsWith(".csv") || name.endsWith(".xlsx") || name.endsWith(".xls");
    });
    if (fileList.length === 0) return;
    setSelectedFiles(fileList);

    const dt = new DataTransfer();
    for (const f of fileList) dt.items.add(f);
    uploadMutation.mutate(dt.files, {
      onSuccess: (data: any) => {
        setUploadedFileInfos(
          data.files.map((f: any) => ({
            filename: f.filename,
            size: 0,
            type: f.type,
            sha256: f.sha256,
          }))
        );
      },
    });
  }, [uploadMutation]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
    }
  }, [handleFiles]);

  const removeFile = useCallback((index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
    setUploadedFileInfos(prev => prev.filter((_, i) => i !== index));
  }, []);

  const detectedTypes = useMemo(() => {
    return [...new Set(uploadedFileInfos.map(f => getFileTypeLabel(f.type)))];
  }, [uploadedFileInfos]);

  const hasUploadedFiles = uploadedFileInfos.length > 0;

  return (
    <div className="space-y-6">
      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)", border: "1px solid var(--lux-border)" }}
      >
        <div className="px-8 pt-8 pb-2">
          <div className="flex items-center gap-3 mb-1">
            <h2 className="text-lg font-semibold" style={{ color: "var(--lux-text)" }}>
              Upload CSV Files
            </h2>
            {selectedPlatform && selectedPlatform !== "generic" && (
              <span
                className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ background: "var(--color-surface-3)", color: "var(--lux-text-muted)" }}
              >
                from {getPlatformDisplayName(selectedPlatform)}
              </span>
            )}
          </div>
          <p className="text-sm mb-5" style={{ color: "var(--lux-text-muted)" }}>
            Upload one or more CSV files. CherryWorks Pro will automatically detect the data type and platform.
          </p>
        </div>

        <div className="px-8 pb-6">
          <input
            ref={fileInputRef}
            id="csv-upload-hidden"
            type="file"
            accept=".csv,.xlsx,.xls"
            multiple
            className="hidden"
            onChange={handleInputChange}
            disabled={uploadMutation.isPending}
            data-testid="input-csv-upload"
          />

          <label
            htmlFor="csv-upload-hidden"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            tabIndex={0}
            role="button"
            aria-label="Upload CSV files. Drag files here or click to browse."
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInputRef.current?.click(); } }}
            className="relative rounded-xl p-10 flex flex-col items-center justify-center cursor-pointer transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            style={{
              border: dragOver
                ? "2px solid var(--color-accent)"
                : "2px dashed var(--lux-border-strong, rgba(0,0,0,0.14))",
              background: dragOver
                ? "rgba(var(--lux-accent-rgb), 0.04)"
                : "var(--color-surface-2)",
              boxShadow: dragOver
                ? "inset 0 0 0 1px rgba(var(--lux-accent-rgb), 0.15), 0 0 20px rgba(var(--lux-accent-rgb), 0.08)"
                : "none",
              minHeight: 180,
              // @ts-expect-error CSS custom property not in CSSProperties
              "--tw-ring-color": "rgba(var(--lux-accent-rgb), 0.4)",
            }}
            data-testid="dropzone-csv"
          >
            {uploadMutation.isPending ? (
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="w-10 h-10 animate-spin" style={{ color: "var(--color-accent)" }} />
                <span className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>
                  Uploading and analyzing...
                </span>
              </div>
            ) : (
              <>
                <div
                  className="w-14 h-14 rounded-full flex items-center justify-center mb-4 transition-all duration-300"
                  style={{
                    background: dragOver
                      ? "rgba(var(--lux-accent-rgb), 0.12)"
                      : "var(--color-surface-3)",
                  }}
                >
                  <CloudUpload
                    className="w-7 h-7 transition-colors duration-300"
                    style={{
                      color: dragOver ? "var(--color-accent)" : "var(--lux-text-muted)",
                    }}
                  />
                </div>
                <span className="text-sm font-medium mb-1" style={{ color: "var(--lux-text)" }}>
                  Drag files here or click to browse
                </span>
                <span className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
                  Supports CSV files up to 50MB
                </span>
              </>
            )}
          </label>
        </div>

        {hasUploadedFiles && (
          <div className="px-8 pb-4">
            <div
              className="rounded-lg px-4 py-2.5 flex items-center gap-2 text-xs font-medium mb-4"
              style={{
                background: "rgba(var(--lux-accent-rgb), 0.06)",
                color: "var(--color-accent)",
                border: "1px solid rgba(var(--lux-accent-rgb), 0.12)",
              }}
              data-testid="text-file-summary"
            >
              <FileText className="w-3.5 h-3.5" />
              {uploadedFileInfos.length} file{uploadedFileInfos.length !== 1 ? "s" : ""} uploaded
              {detectedTypes.length > 0 && (
                <span style={{ color: "var(--lux-text-secondary)" }}>
                  {" "}  {detectedTypes.join(", ")} detected
                </span>
              )}
            </div>

            <div className="space-y-2">
              {uploadedFileInfos.map((file, idx) => {
                const typeColor = FILE_TYPE_COLORS[file.type] || FILE_TYPE_COLORS.unknown;
                const originalFile = selectedFiles[idx];
                return (
                  <div
                    key={idx}
                    className="flex items-center gap-3 rounded-lg px-4 py-3 transition-all group"
                    style={{
                      background: "var(--color-surface-2)",
                      border: "1px solid var(--lux-border)",
                    }}
                    data-testid={`file-card-${idx}`}
                  >
                    <FileText className="w-5 h-5 flex-shrink-0" style={{ color: "var(--lux-text-muted)" }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate" style={{ color: "var(--lux-text)" }}>
                          {file.filename}
                        </span>
                        {originalFile && (
                          <span className="text-[10px]" style={{ color: "var(--lux-text-muted)", fontVariantNumeric: "tabular-nums" }}>
                            {formatFileSize(originalFile.size)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                          style={{ background: typeColor.bg, color: typeColor.text }}
                        >
                          {getFileTypeLabel(file.type)}
                        </span>
                        <span
                          className="text-[10px] font-mono"
                          style={{ color: "var(--lux-text-muted)", fontVariantNumeric: "tabular-nums" }}
                        >
                          sha256: {file.sha256.substring(0, 8)}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFile(idx);
                      }}
                      aria-label={`Remove ${file.filename}`}
                      className="w-6 h-6 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity cursor-pointer focus-visible:outline-none focus-visible:ring-2"
                      style={{ background: "var(--color-surface-3)" }}
                      data-testid={`button-remove-file-${idx}`}
                    >
                      <X className="w-3 h-3" style={{ color: "var(--lux-text-muted)" }} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="px-8 pb-8 pt-2 flex gap-3">
          <button
            onClick={onBack}
            className="px-5 py-3 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer"
            style={{
              border: "1px solid var(--lux-border)",
              background: "var(--lux-surface)",
              color: "var(--lux-text-muted)",
            }}
            data-testid="button-back-to-platform"
          >
            Back
          </button>
        </div>
      </div>
    </div>
  );
}

function PreflightAuditDashboard({
  preflightResults,
  options,
  hideNonSelected,
  onContinue,
  onBack,
}: {
  preflightResults: PreflightFile[];
  options: ImportOptions;
  hideNonSelected: boolean;
  onContinue: () => void;
  onBack: () => void;
}) {
  const [expandedWarnings, setExpandedWarnings] = useState<Record<string, boolean>>({});
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [showExpenses, setShowExpenses] = useState(false);

  const totalClients = new Set(preflightResults.flatMap(f => f.uniqueClients)).size;
  const totalTeamMembers = new Set(preflightResults.flatMap(f => f.uniqueTeamMembers)).size;
  const totalInvoices = new Set(preflightResults.flatMap(f => f.uniqueInvoiceNumbers)).size;
  const totalRows = preflightResults.reduce((s, f) => s + f.rowCount, 0);

  const totalInvoiceSum = preflightResults.reduce((s, f) => s + f.totalInvoiceLineSum, 0);
  const totalOpenAR = preflightResults.reduce((s, f) => s + f.openARSum, 0);
  const totalPayments = totalInvoiceSum - totalOpenAR;
  const totalPayouts = preflightResults.reduce((s, f) => s + f.independentPayoutSum, 0);
  const hasFinancials = totalInvoiceSum > 0 || totalPayouts > 0;

  const totalDuplicates = preflightResults.reduce((s, f) => s + f.duplicateTimeRows, 0);
  const totalNoService = preflightResults.reduce((s, f) => s + f.noServiceTimeRows, 0);
  const allNormCandidates = preflightResults.flatMap(f => f.nameNormalizationCandidates);

  const warnings: Array<{ severity: "error" | "warning" | "info"; file: string; message: string }> = [];

  preflightResults.forEach(f => {
    if (f.parseIntegrity && f.parseIntegrity.ignoredRowCount > 0) {
      const reasons = Object.entries(f.parseIntegrity.ignoredRowBreakdown)
        .map(([r, c]) => `${r}: ${c}`)
        .join(", ");
      warnings.push({
        severity: "warning",
        file: f.filename,
        message: `${f.parseIntegrity.ignoredRowCount} rows ignored (${reasons})`,
      });
    }
    if (f.duplicateTimeRows > 0) {
      warnings.push({
        severity: "warning",
        file: f.filename,
        message: `${f.duplicateTimeRows} duplicate time entry rows detected`,
      });
    }
    if (f.noServiceTimeRows > 0) {
      warnings.push({
        severity: "info",
        file: f.filename,
        message: `${f.noServiceTimeRows} time rows have no service/category assigned`,
      });
    }
    if (f.nameNormalizationCandidates.length > 0) {
      warnings.push({
        severity: "info",
        file: f.filename,
        message: `Name normalization candidates: ${f.nameNormalizationCandidates.join(", ")}`,
      });
    }
    if (f.payeeBreakdown && f.payeeBreakdown.payeeParseFallbackCount > 0) {
      warnings.push({
        severity: "info",
        file: f.filename,
        message: `${f.payeeBreakdown.payeeParseFallbackCount} payee entries fell back to merchant name`,
      });
    }
  });

  const errorCount = warnings.filter(w => w.severity === "error").length;
  const warningCount = warnings.filter(w => w.severity === "warning").length;
  const infoCount = warnings.filter(w => w.severity === "info").length;

  const severityConfig = {
    error: { color: "#ef4444", bg: "#fee2e2", label: "Errors", icon: CircleX },
    warning: { color: "#f59e0b", bg: "#fef3c7", label: "Warnings", icon: CircleAlert },
    info: { color: "#3b82f6", bg: "#dbeafe", label: "Info", icon: Info },
  };

  const hasExpenses = preflightResults.some(f => f.expenseBreakdowns);

  const entityCards = [
    { label: "Clients", count: totalClients, icon: Users, show: totalClients > 0, primary: true },
    { label: "Invoices", count: totalInvoices, icon: Receipt, show: totalInvoices > 0, primary: false },
    { label: "Team Members", count: totalTeamMembers, icon: Briefcase, show: totalTeamMembers > 0, primary: false },
    { label: "Total Rows", count: totalRows, icon: Database, show: true, primary: false },
  ];

  return (
    <div className="space-y-5" data-testid="preflight-dashboard">
      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)", border: "1px solid var(--lux-border)" }}
      >
        <div className="px-8 pt-8 pb-4">
          <div className="flex items-center gap-3 mb-1">
            <ShieldCheck className="w-5 h-5" style={{ color: "var(--color-accent)" }} />
            <h2 className="text-lg font-semibold" style={{ color: "var(--lux-text)" }}>
              Preflight Audit
            </h2>
          </div>
          <p className="text-sm" style={{ color: "var(--lux-text-muted)" }}>
            Data quality checkpoint before import. Review the analysis below.
          </p>
        </div>

        <div className="px-8 pb-6 space-y-6">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--lux-text-muted)" }}>
              File Integrity
            </h3>
            <div className="space-y-3">
              {preflightResults.map((f, idx) => {
                const typeColor = FILE_TYPE_COLORS[f.type] || FILE_TYPE_COLORS.unknown;
                const parseOk = !f.parseIntegrity || f.parseIntegrity.ignoredRowCount === 0;
                return (
                  <div
                    key={idx}
                    className="rounded-xl p-4 flex items-start gap-4"
                    style={{
                      background: "var(--color-surface-2)",
                      border: "1px solid var(--lux-border)",
                    }}
                    data-testid={`card-preflight-${idx}`}
                  >
                    <div className="flex-shrink-0 mt-0.5">
                      {parseOk ? (
                        <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "#dcfce7" }}>
                          <Check className="w-4 h-4" style={{ color: "#16a34a" }} strokeWidth={3} />
                        </div>
                      ) : (
                        <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "#fef3c7" }}>
                          <AlertTriangle className="w-4 h-4" style={{ color: "#d97706" }} />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm font-semibold truncate" style={{ color: "var(--lux-text)" }}>
                          {f.filename}
                        </span>
                        <span
                          className="text-[10px] px-2 py-0.5 rounded-full font-semibold flex-shrink-0"
                          style={{ background: typeColor.bg, color: typeColor.text }}
                        >
                          {getFileTypeLabel(f.type)}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-2xl font-bold" style={{ color: "var(--lux-text)", fontVariantNumeric: "tabular-nums" }}>
                            {f.rowCount.toLocaleString()}
                          </span>
                          <span className="text-[10px] font-medium" style={{ color: "var(--lux-text-muted)" }}>rows</span>
                        </div>
                        <code
                          className="text-[10px] px-2 py-0.5 rounded font-mono"
                          style={{
                            background: "var(--color-surface-3)",
                            color: "var(--lux-text-muted)",
                            fontVariantNumeric: "tabular-nums",
                          }}
                          data-testid={`text-sha-${idx}`}
                        >
                          {f.sha256.slice(0, 16)}...
                        </code>
                        {f.dateRange && (
                          <span
                            className="text-[10px] px-2 py-0.5 rounded-full font-medium flex items-center gap-1"
                            style={{
                              background: "rgba(var(--lux-accent-rgb), 0.06)",
                              color: "var(--color-accent)",
                              border: "1px solid rgba(var(--lux-accent-rgb), 0.12)",
                            }}
                          >
                            <Calendar className="w-3 h-3" />
                            {f.dateRange.min} to {f.dateRange.max}
                          </span>
                        )}
                      </div>
                      {f.parseIntegrity && (
                        <div className="mt-1.5 text-[10px]" style={{ color: "var(--lux-text-muted)" }} data-testid={`text-integrity-${idx}`}>
                          {f.parseIntegrity.physicalLineCount} physical lines, {f.parseIntegrity.parsedRecordCount} parsed records
                          {f.parseIntegrity.ignoredRowCount > 0 && (
                            <span style={{ color: "#d97706" }} data-testid={`text-ignored-${idx}`}>
                              {" "}({f.parseIntegrity.ignoredRowCount} ignored)
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--lux-text-muted)" }}>
              Entity Summary
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {entityCards.filter(c => c.show).map(card => {
                const Icon = card.icon;
                return (
                  <div
                    key={card.label}
                    className="rounded-xl p-4 text-center"
                    style={{
                      background: "var(--lux-surface)",
                      border: card.primary ? "1px solid rgba(var(--lux-accent-rgb), 0.2)" : "1px solid var(--lux-border)",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                    }}
                    data-testid={`entity-card-${card.label.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    <Icon
                      className="w-5 h-5 mx-auto mb-2"
                      style={{ color: card.primary ? "var(--color-accent)" : "var(--lux-text-muted)" }}
                    />
                    <div
                      className="text-2xl font-bold mb-0.5"
                      style={{
                        color: card.primary ? "var(--color-accent)" : "var(--lux-text)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {card.count.toLocaleString()}
                    </div>
                    <div className="text-[11px] font-medium" style={{ color: "var(--lux-text-muted)" }}>
                      {card.label}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {hasFinancials && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--lux-text-muted)" }}>
                Financial Snapshot
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {totalInvoiceSum > 0 && (
                  <div
                    className="rounded-xl p-4"
                    style={{ background: "var(--lux-surface)", border: "1px solid var(--lux-border)", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}
                    data-testid="financial-total-invoices"
                  >
                    <DollarSign className="w-4 h-4 mb-1.5" style={{ color: "var(--lux-text-muted)" }} />
                    <div className="text-lg font-bold" style={{ color: "var(--lux-text)", fontVariantNumeric: "tabular-nums" }}>
                      {formatMoney(totalInvoiceSum)}
                    </div>
                    <div className="text-[10px] font-medium" style={{ color: "var(--lux-text-muted)" }}>
                      Total Invoiced
                    </div>
                  </div>
                )}
                {totalPayments > 0 && (
                  <div
                    className="rounded-xl p-4"
                    style={{ background: "var(--lux-surface)", border: "1px solid var(--lux-border)", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}
                    data-testid="financial-total-payments"
                  >
                    <CreditCard className="w-4 h-4 mb-1.5" style={{ color: "#16a34a" }} />
                    <div className="text-lg font-bold" style={{ color: "#16a34a", fontVariantNumeric: "tabular-nums" }}>
                      {formatMoney(totalPayments)}
                    </div>
                    <div className="text-[10px] font-medium" style={{ color: "var(--lux-text-muted)" }}>
                      Payments Received
                    </div>
                  </div>
                )}
                {totalOpenAR > 0 && (
                  <div
                    className="rounded-xl p-4"
                    style={{ background: "var(--lux-surface)", border: "1px solid var(--lux-border)", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}
                    data-testid="financial-open-ar"
                  >
                    <Receipt className="w-4 h-4 mb-1.5" style={{ color: "var(--color-accent)" }} />
                    <div className="text-lg font-bold" style={{ color: "var(--color-accent)", fontVariantNumeric: "tabular-nums" }}>
                      {formatMoney(totalOpenAR)}
                    </div>
                    <div className="text-[10px] font-medium" style={{ color: "var(--lux-text-muted)" }}>
                      Open A/R Balance
                    </div>
                  </div>
                )}
                {totalPayouts > 0 && (
                  <div
                    className="rounded-xl p-4"
                    style={{ background: "var(--lux-surface)", border: "1px solid var(--lux-border)", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}
                    data-testid="text-payout-sum"
                  >
                    <Briefcase className="w-4 h-4 mb-1.5" style={{ color: "var(--lux-text-muted)" }} />
                    <div className="text-lg font-bold" style={{ color: "var(--lux-text)", fontVariantNumeric: "tabular-nums" }}>
                      {formatMoney(totalPayouts)}
                    </div>
                    <div className="text-[10px] font-medium" style={{ color: "var(--lux-text-muted)" }}>
                      Independents
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--lux-text-muted)" }}>
              Warnings & Issues
            </h3>
            {warnings.length === 0 ? (
              <div
                className="rounded-xl p-4 flex items-center gap-3"
                style={{
                  background: "#dcfce7",
                  border: "1px solid #bbf7d0",
                }}
                data-testid="preflight-all-clear"
              >
                <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "#16a34a" }}>
                  <Check className="w-4 h-4 text-white" strokeWidth={3} />
                </div>
                <div>
                  <div className="text-sm font-semibold" style={{ color: "#166534" }}>All Clear</div>
                  <div className="text-xs" style={{ color: "#15803d" }}>No issues detected in your files. Ready to proceed.</div>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {(["error", "warning", "info"] as const).map(severity => {
                  const items = warnings.filter(w => w.severity === severity);
                  if (items.length === 0) return null;
                  const config = severityConfig[severity];
                  const Icon = config.icon;
                  const isExpanded = expandedWarnings[severity] !== false;
                  return (
                    <div
                      key={severity}
                      className="rounded-xl overflow-hidden"
                      style={{ border: `1px solid ${config.color}20`, background: "var(--lux-surface)" }}
                    >
                      <button
                        onClick={() => setExpandedWarnings(prev => ({ ...prev, [severity]: !isExpanded }))}
                        className="w-full px-4 py-3 flex items-center gap-3 cursor-pointer"
                        style={{ background: `${config.bg}60` }}
                        data-testid={`toggle-warnings-${severity}`}
                      >
                        <Icon className="w-4 h-4" style={{ color: config.color }} />
                        <span className="text-sm font-semibold flex-1 text-left" style={{ color: config.color }}>
                          {config.label}
                        </span>
                        <span
                          className="text-[10px] px-2 py-0.5 rounded-full font-bold"
                          style={{ background: config.color, color: "white" }}
                        >
                          {items.length}
                        </span>
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4" style={{ color: config.color }} />
                        ) : (
                          <ChevronRight className="w-4 h-4" style={{ color: config.color }} />
                        )}
                      </button>
                      {isExpanded && (
                        <div className="px-4 pb-3 space-y-1.5">
                          {items.map((item, i) => (
                            <div
                              key={i}
                              className="flex items-start gap-2 py-1.5 text-xs"
                              style={{ borderTop: i > 0 ? "1px solid var(--lux-border)" : "none" }}
                            >
                              <span
                                className="text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 mt-0.5"
                                style={{ background: "var(--color-surface-3)", color: "var(--lux-text-muted)" }}
                              >
                                {item.file}
                              </span>
                              <span style={{ color: "var(--lux-text-secondary)" }}>{item.message}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--lux-text-muted)" }}>
              Duplicates
            </h3>
            {totalDuplicates === 0 ? (
              <div
                className="rounded-xl p-3 flex items-center gap-2.5"
                style={{ background: "#dcfce7", border: "1px solid #bbf7d0" }}
                data-testid="preflight-no-duplicates"
              >
                <Check className="w-4 h-4" style={{ color: "#16a34a" }} strokeWidth={3} />
                <span className="text-xs font-medium" style={{ color: "#166534" }}>No duplicates detected</span>
              </div>
            ) : (
              <div
                className="rounded-xl overflow-hidden"
                style={{ border: "1px solid var(--lux-border)", background: "var(--lux-surface)" }}
              >
                <button
                  onClick={() => setShowDuplicates(!showDuplicates)}
                  className="w-full px-4 py-3 flex items-center gap-3 cursor-pointer"
                  style={{ background: "#fef3c780" }}
                  data-testid="toggle-duplicates"
                >
                  <Copy className="w-4 h-4" style={{ color: "#d97706" }} />
                  <span className="text-sm font-semibold flex-1 text-left" style={{ color: "#92400e" }}>
                    Duplicate Entries Found
                  </span>
                  <span
                    className="text-[10px] px-2 py-0.5 rounded-full font-bold"
                    style={{ background: "#f59e0b", color: "white" }}
                  >
                    {totalDuplicates}
                  </span>
                  {showDuplicates ? (
                    <ChevronDown className="w-4 h-4" style={{ color: "#d97706" }} />
                  ) : (
                    <ChevronRight className="w-4 h-4" style={{ color: "#d97706" }} />
                  )}
                </button>
                {showDuplicates && (
                  <div className="px-4 pb-3 space-y-1.5">
                    {preflightResults.filter(f => f.duplicateTimeRows > 0).map((f, i) => (
                      <div key={i} className="flex items-center gap-2 py-1.5 text-xs" style={{ borderTop: i > 0 ? "1px solid var(--lux-border)" : "none" }}>
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: "var(--color-surface-3)", color: "var(--lux-text-muted)" }}>
                          {f.filename}
                        </span>
                        <span style={{ color: "var(--lux-text-secondary)" }}>
                          Time Entries: {f.duplicateTimeRows} duplicate{f.duplicateTimeRows !== 1 ? "s" : ""} (by date + client + hours + note)
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {hasExpenses && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--lux-text-muted)" }}>
                Expense Breakdowns
              </h3>
              {preflightResults.filter(f => f.expenseBreakdowns).map((f, idx) => (
                <div
                  key={idx}
                  className="rounded-xl overflow-hidden"
                  style={{ border: "1px solid var(--lux-border)", background: "var(--lux-surface)" }}
                  data-testid={`div-expense-breakdowns-${idx}`}
                >
                  <button
                    onClick={() => setShowExpenses(!showExpenses)}
                    className="w-full px-4 py-3 flex items-center gap-3 cursor-pointer"
                    style={{ background: "var(--color-surface-2)" }}
                    data-testid={`toggle-expenses-${idx}`}
                  >
                    <BarChart3 className="w-4 h-4" style={{ color: "var(--lux-text-muted)" }} />
                    <span className="text-sm font-semibold flex-1 text-left" style={{ color: "var(--lux-text)" }}>
                      {f.filename} - Expense Analysis
                    </span>
                    {showExpenses ? (
                      <ChevronDown className="w-4 h-4" style={{ color: "var(--lux-text-muted)" }} />
                    ) : (
                      <ChevronRight className="w-4 h-4" style={{ color: "var(--lux-text-muted)" }} />
                    )}
                  </button>
                  {showExpenses && f.expenseBreakdowns && (
                    <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs" style={{ color: "var(--lux-text-secondary)" }}>
                      <div>
                        <div className="font-semibold mb-2" style={{ color: "var(--lux-text)" }}>By Category</div>
                        {f.expenseBreakdowns.byParentCategory
                          .filter(c => !hideNonSelected || options.expenseCategoryIncludeList.length === 0 || options.expenseCategoryIncludeList.includes(c.key))
                          .map(c => (
                            <div key={c.key} className="flex justify-between py-0.5">
                              <span>{c.label}</span>
                              <span style={{ fontVariantNumeric: "tabular-nums" }}>{c.count} ({formatMoney(c.amount)})</span>
                            </div>
                          ))}
                      </div>
                      <div>
                        <div className="font-semibold mb-2" style={{ color: "var(--lux-text)" }}>By Merchant (Top {f.expenseBreakdowns.topN})</div>
                        {f.expenseBreakdowns.byMerchant.map(m => (
                          <div key={m.name} className="flex justify-between py-0.5">
                            <span>{m.name}</span>
                            <span style={{ fontVariantNumeric: "tabular-nums" }}>{m.count} ({formatMoney(m.amount)})</span>
                          </div>
                        ))}
                        {f.expenseBreakdowns.merchantOther.count > 0 && (
                          <div className="flex justify-between py-0.5" style={{ color: "var(--lux-text-muted)" }}>
                            <span>Other</span>
                            <span style={{ fontVariantNumeric: "tabular-nums" }}>{f.expenseBreakdowns.merchantOther.count} ({formatMoney(f.expenseBreakdowns.merchantOther.amount)})</span>
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="font-semibold mb-2" style={{ color: "var(--lux-text)" }}>By Payee (Top {f.expenseBreakdowns.topN})</div>
                        {f.expenseBreakdowns.byPayee
                          .filter(p => !hideNonSelected || options.payeeIncludeList.length === 0 || options.payeeIncludeList.includes(p.name))
                          .map(p => (
                            <div key={p.name} className="flex justify-between py-0.5">
                              <span>{p.name}</span>
                              <span style={{ fontVariantNumeric: "tabular-nums" }}>{p.count} ({formatMoney(p.amount)})</span>
                            </div>
                          ))}
                        {f.expenseBreakdowns.payeeOther.count > 0 && (
                          <div className="flex justify-between py-0.5" style={{ color: "var(--lux-text-muted)" }}>
                            <span>Other</span>
                            <span style={{ fontVariantNumeric: "tabular-nums" }}>{f.expenseBreakdowns.payeeOther.count} ({formatMoney(f.expenseBreakdowns.payeeOther.amount)})</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {preflightResults.some(f => f.payeeBreakdown) && (
            <div className="text-xs rounded-lg p-3" style={{ background: "var(--color-surface-2)", border: "1px solid var(--lux-border)" }}>
              {preflightResults.filter(f => f.payeeBreakdown).map((f, idx) => (
                <div key={idx} data-testid="text-payee-breakdown" style={{ color: "var(--lux-text-muted)" }}>
                  {f.payeeBreakdown!.totalImportedPayoutRows} imported payout rows, {f.payeeBreakdown!.uniquePayees.length} unique payees
                  {f.payeeBreakdown!.payeeParseFallbackCount > 0 && (
                    <span style={{ color: "#d97706" }}> ({f.payeeBreakdown!.payeeParseFallbackCount} fallback to merchant)</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-8 pb-8 pt-2 flex gap-3">
          <button
            onClick={onBack}
            className="px-5 py-3 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer"
            style={{
              border: "1px solid var(--lux-border)",
              background: "var(--lux-surface)",
              color: "var(--lux-text-muted)",
            }}
            data-testid="button-back-to-upload"
          >
            Back
          </button>
          <button
            onClick={onContinue}
            className="flex-1 py-3.5 rounded-xl text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer"
            style={{
              background: "var(--gradient-brand)",
              boxShadow: "0 4px 14px rgba(var(--lux-accent-rgb), 0.3)",
            }}
            data-testid="button-continue-options"
            onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; }}
          >
            Continue to Import Options
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ExecuteProgressView({ dryRunPlan }: { dryRunPlan: DryRunPlan | null }) {
  const entitySteps = useMemo(() => {
    if (!dryRunPlan) return [];
    const steps = [
      { key: "clients", label: "Clients", count: dryRunPlan.clientsToCreate, icon: Users },
      { key: "projects", label: "Projects", count: dryRunPlan.projectsToCreate, icon: Database },
      { key: "invoices", label: "Invoices", count: dryRunPlan.invoicesToCreate, icon: Receipt },
      { key: "invoiceLines", label: "Invoice Lines", count: dryRunPlan.invoiceLinesToCreate, icon: FileText },
      { key: "payments", label: "Payments", count: dryRunPlan.paymentsToCreate, icon: CreditCard },
      { key: "timeEntries", label: "Time Entries", count: dryRunPlan.timeEntriesToCreate, icon: Clock },
      { key: "payouts", label: "Imported payouts", count: dryRunPlan.payoutsToCreate, icon: Briefcase },
    ];
    return steps.filter(s => s.count > 0);
  }, [dryRunPlan]);

  return (
    <div className="space-y-5" data-testid="execute-progress">
      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)", border: "1px solid var(--lux-border)" }}
      >
        <div
          className="h-1 w-full"
          style={{ background: "var(--lux-border)" }}
        >
          <div
            className="h-full transition-all duration-1000 ease-out"
            style={{
              background: "var(--gradient-brand)",
              width: "60%",
              animation: "execute-progress-bar 2s ease-in-out infinite",
            }}
          />
        </div>

        <div className="px-8 py-16 text-center">
          <div
            className="w-20 h-20 rounded-full mx-auto mb-6 flex items-center justify-center"
            style={{
              background: "rgba(var(--lux-accent-rgb), 0.08)",
              animation: "stepper-pulse 2s ease-in-out infinite",
            }}
          >
            <Loader2
              className="w-10 h-10"
              style={{ color: "var(--color-accent)", animation: "spin 1.2s linear infinite" }}
            />
          </div>
          <h2
            className="text-xl font-bold mb-2"
            style={{
              color: "var(--lux-text)",
              animation: "execute-text-pulse 2s ease-in-out infinite",
            }}
          >
            Importing your data...
          </h2>
          <p className="text-sm" style={{ color: "var(--lux-text-muted)" }}>
            Please wait while we process and verify your records
          </p>
        </div>

        {entitySteps.length > 0 && (
          <div className="px-8 pb-8">
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--lux-border)" }}>
              {entitySteps.map((step, idx) => {
                const Icon = step.icon;
                return (
                  <div
                    key={step.key}
                    className="px-4 py-3 flex items-center gap-3"
                    style={{
                      background: idx % 2 === 0 ? "var(--lux-surface)" : "var(--color-surface-2)",
                      borderTop: idx > 0 ? "1px solid var(--lux-border)" : "none",
                    }}
                  >
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ background: "rgba(var(--lux-accent-rgb), 0.08)" }}
                    >
                      <Icon className="w-3.5 h-3.5" style={{ color: "var(--color-accent)" }} />
                    </div>
                    <span className="text-sm font-medium flex-1" style={{ color: "var(--lux-text)" }}>
                      {step.label}
                    </span>
                    <span className="text-xs" style={{ color: "var(--lux-text-muted)", fontVariantNumeric: "tabular-nums" }}>
                      {step.count.toLocaleString()} records
                    </span>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "var(--lux-text-muted)" }} />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RollbackConfirmModal({
  runId,
  recordCount,
  onConfirm,
  onCancel,
  isPending,
}: {
  runId: string;
  recordCount: number;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={onCancel}
      data-testid="rollback-confirm-modal"
    >
      <div
        className="rounded-2xl p-8 max-w-md w-full mx-4"
        style={{
          background: "var(--lux-surface)",
          boxShadow: "0 25px 50px rgba(0,0,0,0.2)",
          border: "1px solid var(--lux-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "#fee2e2" }}>
            <AlertTriangle className="w-5 h-5" style={{ color: "#ef4444" }} />
          </div>
          <h3 className="text-lg font-bold" style={{ color: "var(--lux-text)" }}>
            Confirm Rollback
          </h3>
        </div>
        <p className="text-sm mb-6" style={{ color: "var(--lux-text-secondary)" }}>
          This will delete all <strong>{recordCount.toLocaleString()}</strong> records created by this import run. This action cannot be undone.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-3 rounded-xl text-sm font-medium cursor-pointer"
            style={{
              border: "1px solid var(--lux-border)",
              background: "var(--lux-surface)",
              color: "var(--lux-text-muted)",
            }}
            data-testid="button-cancel-rollback"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className="flex-1 py-3 rounded-xl text-sm font-semibold text-white cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60"
            style={{ background: "#ef4444", boxShadow: "0 4px 14px rgba(239,68,68,0.3)" }}
            data-testid="button-confirm-rollback"
          >
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
            Confirm Rollback
          </button>
        </div>
      </div>
    </div>
  );
}

function ImportHistoryPanel({
  runsQuery,
  rollbackMutation,
  rollbackConfirmId,
  setRollbackConfirmId,
}: {
  runsQuery: any;
  rollbackMutation: any;
  rollbackConfirmId: string | null;
  setRollbackConfirmId: (id: string | null) => void;
}) {
  const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
    COMPLETED: { bg: "#dcfce7", text: "#166534", label: "Success" },
    ROLLED_BACK: { bg: "#e5e7eb", text: "#374151", label: "Rolled Back" },
    FAILED: { bg: "#fee2e2", text: "#991b1b", label: "Failed" },
    RUNNING: { bg: "#dbeafe", text: "#1e40af", label: "Running" },
    PENDING: { bg: "#fef3c7", text: "#92400e", label: "Pending" },
  };

  return (
    <div className="space-y-5" data-testid="import-history-panel">
      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)", border: "1px solid var(--lux-border)" }}
      >
        <div className="px-8 pt-8 pb-4">
          <div className="flex items-center gap-3 mb-1">
            <Clock className="w-5 h-5" style={{ color: "var(--color-accent)" }} />
            <h2 className="text-lg font-semibold" style={{ color: "var(--lux-text)" }}>
              Import History
            </h2>
          </div>
          <p className="text-sm" style={{ color: "var(--lux-text-muted)" }}>
            All past import runs and their results.
          </p>
        </div>

        <div className="px-8 pb-8">
          {runsQuery.isLoading ? (
            <div className="flex items-center justify-center py-12 gap-3">
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--color-accent)" }} />
              <span className="text-sm" style={{ color: "var(--lux-text-muted)" }}>Loading history...</span>
            </div>
          ) : !runsQuery.data || runsQuery.data.length === 0 ? (
            <div
              className="rounded-xl p-8 text-center"
              style={{ background: "var(--color-surface-2)", border: "1px solid var(--lux-border)" }}
              data-testid="text-no-imports"
            >
              <Database className="w-8 h-8 mx-auto mb-3" style={{ color: "var(--lux-text-muted)" }} />
              <p className="text-sm font-medium" style={{ color: "var(--lux-text-muted)" }}>No import runs found.</p>
            </div>
          ) : (
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--lux-border)" }}>
              <div
                className="grid px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider"
                style={{
                  gridTemplateColumns: "1fr 120px 100px 80px 100px",
                  background: "var(--color-surface-2)",
                  color: "var(--lux-text-muted)",
                }}
              >
                <span>Run</span>
                <span>Date</span>
                <span>Records</span>
                <span>Status</span>
                <span className="text-right">Actions</span>
              </div>
              {runsQuery.data.map((run: any, idx: number) => {
                const sc = statusConfig[run.status] || statusConfig.PENDING;
                const totalRecords = run.summaryJson
                  ? Object.entries(run.summaryJson)
                    .filter(([k]) => !["rowIssueSummary", "reconciliation", "fileRowCounts", "verificationPassed", "verificationWarnings"].includes(k))
                    .reduce((s, [, v]) => s + (typeof v === "number" ? v : 0), 0)
                  : 0;
                return (
                  <div
                    key={run.id}
                    className="grid px-4 py-3 items-center group"
                    style={{
                      gridTemplateColumns: "1fr 120px 100px 80px 100px",
                      background: idx % 2 === 0 ? "var(--lux-surface)" : "var(--color-surface-2)",
                      borderTop: "1px solid var(--lux-border)",
                    }}
                    data-testid={`card-import-run-${run.id}`}
                  >
                    <div className="min-w-0">
                      <code className="text-[10px] font-mono" style={{ color: "var(--lux-text-muted)" }}>
                        {run.id.slice(0, 8)}...
                      </code>
                    </div>
                    <span className="text-xs" style={{ color: "var(--lux-text-secondary)", fontVariantNumeric: "tabular-nums" }}>
                      {new Date(run.startedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })}
                    </span>
                    <span className="text-xs font-semibold" style={{ color: "var(--lux-text)", fontVariantNumeric: "tabular-nums" }}>
                      {totalRecords.toLocaleString()}
                    </span>
                    <span
                      className="text-[10px] px-2 py-0.5 rounded-full font-semibold inline-block text-center w-fit"
                      style={{ background: sc.bg, color: sc.text }}
                      data-testid={`badge-run-status-${run.id}`}
                    >
                      {sc.label}
                    </span>
                    <div className="text-right">
                      {run.status === "COMPLETED" && (
                        <button
                          onClick={() => setRollbackConfirmId(run.id)}
                          className="text-[10px] px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition-all duration-150"
                          style={{
                            color: "var(--color-accent)",
                            border: "1px solid rgba(var(--lux-accent-rgb), 0.2)",
                            background: "transparent",
                          }}
                          data-testid={`button-rollback-${run.id}`}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = "rgba(var(--lux-accent-rgb), 0.06)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = "transparent";
                          }}
                        >
                          <span className="flex items-center gap-1">
                            <RotateCcw className="w-3 h-3" />
                            Rollback
                          </span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {rollbackConfirmId && (
        <RollbackConfirmModal
          runId={rollbackConfirmId}
          recordCount={
            runsQuery.data?.find((r: any) => r.id === rollbackConfirmId)?.summaryJson
              ? Object.entries(runsQuery.data.find((r: any) => r.id === rollbackConfirmId).summaryJson)
                .filter(([k]) => !["rowIssueSummary", "reconciliation", "fileRowCounts", "verificationPassed", "verificationWarnings"].includes(k))
                .reduce((s: number, [, v]) => s + (typeof v === "number" ? (v as number) : 0), 0)
              : 0
          }
          onConfirm={() => {
            rollbackMutation.mutate(rollbackConfirmId);
            setRollbackConfirmId(null);
          }}
          onCancel={() => setRollbackConfirmId(null)}
          isPending={rollbackMutation.isPending}
        />
      )}
    </div>
  );
}

function ExecuteResultsDashboard({
  isExecuting,
  executeResult,
  dryRunPlan,
  importRunId,
  runsQuery,
  rollbackMutation,
  rollbackConfirmId,
  setRollbackConfirmId,
  onNewImport,
  onViewHistory,
}: {
  isExecuting: boolean;
  executeResult: ExecuteResult | null;
  dryRunPlan: DryRunPlan | null;
  importRunId: string | null;
  runsQuery: any;
  rollbackMutation: any;
  rollbackConfirmId: string | null;
  setRollbackConfirmId: (id: string | null) => void;
  onNewImport: () => void;
  onViewHistory: () => void;
}) {
  const [issueFilter, setIssueFilter] = useState<"all" | "error" | "warning">("all");
  const [issuePage, setIssuePage] = useState(0);
  const issuesPerPage = 20;

  if (isExecuting || !executeResult) {
    return <ExecuteProgressView dryRunPlan={dryRunPlan} />;
  }

  const r = executeResult;
  const passed = r.verification?.passed ?? true;
  const totalCreated = Object.values(r.counts).reduce((s, v) => s + v, 0);
  const totalIssues = (r.rowIssueSummary?.totalErrors || 0) + (r.rowIssueSummary?.totalWarnings || 0);
  const filteredIssues = (r.rowIssues || []).filter(i =>
    issueFilter === "all" ? true : i.severity === issueFilter
  );
  const pagedIssues = filteredIssues.slice(issuePage * issuesPerPage, (issuePage + 1) * issuesPerPage);
  const totalPages = Math.ceil(filteredIssues.length / issuesPerPage);

  const entityCards = [
    { key: "clients", label: "Clients", icon: Users },
    { key: "projects", label: "Projects", icon: Database },
    { key: "invoices", label: "Invoices", icon: Receipt },
    { key: "invoice_lines", label: "Invoice Lines", icon: FileText },
    { key: "payments", label: "Payments", icon: CreditCard },
    { key: "time_entries", label: "Time Entries", icon: Clock },
    { key: "payouts", label: "Imported payouts", icon: Briefcase },
  ].filter(c => (r.counts[c.key] || 0) > 0);

  const reconcLegs: Array<{ label: string; leg: ReconciliationLeg; formatFn: (n: number) => string }> = [];
  if (r.reconciliation) {
    if (r.reconciliation.invoiceTotal.source > 0) {
      reconcLegs.push({ label: "Invoice Total", leg: r.reconciliation.invoiceTotal, formatFn: formatMoney });
    }
    if (r.reconciliation.timeHours.source > 0) {
      reconcLegs.push({ label: "Time Hours", leg: r.reconciliation.timeHours, formatFn: (n) => n.toFixed(1) + "h" });
    }
    if (r.reconciliation.expenseTotal.source > 0) {
      reconcLegs.push({ label: "Expense Total", leg: r.reconciliation.expenseTotal, formatFn: formatMoney });
    }
  }

  return (
    <div className="space-y-5" data-testid="execute-results-dashboard">
      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)", border: "1px solid var(--lux-border)" }}
      >
        <div
          className="px-8 py-6 flex items-center gap-4"
          style={{
            background: passed
              ? "linear-gradient(135deg, #dcfce7, #bbf7d0)"
              : "linear-gradient(135deg, #fef3c7, #fde68a)",
          }}
        >
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: passed ? "#16a34a" : "#d97706", boxShadow: `0 4px 14px ${passed ? "rgba(22,163,106,0.3)" : "rgba(217,119,6,0.3)"}` }}
          >
            {passed ? (
              <Check className="w-7 h-7 text-white" strokeWidth={3} />
            ) : (
              <AlertTriangle className="w-7 h-7 text-white" />
            )}
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-bold" style={{ color: passed ? "#166534" : "#92400e" }} data-testid="text-import-complete">
              {passed ? "Import Complete \u2014 All Records Verified" : "Import Complete \u2014 Verification Issues"}
            </h2>
            <div className="flex items-center gap-4 mt-1">
              <span className="text-sm font-medium" style={{ color: passed ? "#15803d" : "#b45309" }}>
                {totalCreated.toLocaleString()} records created
              </span>
              {importRunId && (
                <code
                  className="text-[9px] px-2 py-0.5 rounded font-mono"
                  style={{ background: "rgba(0,0,0,0.08)", color: passed ? "#166534" : "#92400e" }}
                >
                  Run: {importRunId.slice(0, 8)}...
                </code>
              )}
              <span className="text-[10px]" style={{ color: passed ? "#15803d" : "#b45309" }}>
                {new Date().toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        <div className="px-8 pb-6 pt-6 space-y-6">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--lux-text-muted)" }}>
              Entity Results
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {entityCards.map(card => {
                const Icon = card.icon;
                const count = r.counts[card.key] || 0;
                return (
                  <div
                    key={card.key}
                    className="rounded-xl p-4 text-center"
                    style={{
                      background: "var(--lux-surface)",
                      border: "1px solid var(--lux-border)",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                    }}
                    data-testid={`entity-result-${card.key}`}
                  >
                    <div
                      className="w-10 h-10 rounded-full mx-auto mb-2 flex items-center justify-center"
                      style={{ background: "#dcfce7" }}
                    >
                      <Icon className="w-5 h-5" style={{ color: "#16a34a" }} />
                    </div>
                    <div className="text-2xl font-bold mb-0.5" style={{ color: "var(--lux-text)", fontVariantNumeric: "tabular-nums" }}>
                      {count.toLocaleString()}
                    </div>
                    <div className="text-[10px] font-medium" style={{ color: "var(--lux-text-muted)" }}>
                      {card.label}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {totalIssues === 0 ? (
            <div
              className="rounded-xl p-6 text-center"
              style={{ background: "#dcfce7", border: "1px solid #bbf7d0" }}
              data-testid="preflight-all-clear"
            >
              <div className="w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center" style={{ background: "#16a34a" }}>
                <Check className="w-6 h-6 text-white" strokeWidth={3} />
              </div>
              <div className="text-base font-bold" style={{ color: "#166534" }}>Perfect Import \u2014 Zero Issues</div>
              <div className="text-xs mt-1" style={{ color: "#15803d" }}>All records were imported without any errors or warnings.</div>
            </div>
          ) : (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--lux-text-muted)" }}>
                Row-Level Issues
              </h3>
              <div
                className="rounded-xl overflow-hidden"
                style={{ border: "1px solid var(--lux-border)", background: "var(--lux-surface)" }}
              >
                <div className="px-4 py-3 flex items-center gap-2" style={{ background: "var(--color-surface-2)" }}>
                  {(["all", "error", "warning"] as const).map(filter => {
                    const count = filter === "all" ? totalIssues
                      : filter === "error" ? (r.rowIssueSummary?.totalErrors || 0)
                      : (r.rowIssueSummary?.totalWarnings || 0);
                    if (count === 0 && filter !== "all") return null;
                    return (
                      <button
                        key={filter}
                        onClick={() => { setIssueFilter(filter); setIssuePage(0); }}
                        className="px-3 py-1.5 rounded-lg text-[10px] font-semibold cursor-pointer transition-all duration-150"
                        style={{
                          background: issueFilter === filter
                            ? (filter === "error" ? "#fee2e2" : filter === "warning" ? "#fef3c7" : "rgba(var(--lux-accent-rgb), 0.1)")
                            : "transparent",
                          color: issueFilter === filter
                            ? (filter === "error" ? "#991b1b" : filter === "warning" ? "#92400e" : "var(--color-accent)")
                            : "var(--lux-text-muted)",
                          border: issueFilter === filter ? "none" : "1px solid transparent",
                        }}
                        data-testid={`button-issue-filter-${filter}`}
                      >
                        {filter === "all" ? "All" : filter === "error" ? "Errors" : "Warnings"} ({count})
                      </button>
                    );
                  })}
                </div>
                <div className="divide-y" style={{ borderColor: "var(--lux-border)" }}>
                  {pagedIssues.map((issue, i) => (
                    <div key={i} className="px-4 py-2.5 flex items-start gap-2 text-xs" style={{ borderColor: "var(--lux-border)" }}>
                      <span
                        className="text-[9px] px-1.5 py-0.5 rounded font-bold flex-shrink-0 mt-0.5"
                        style={{
                          background: issue.severity === "error" ? "#fee2e2" : "#fef3c7",
                          color: issue.severity === "error" ? "#991b1b" : "#92400e",
                        }}
                      >
                        {issue.severity === "error" ? "ERR" : "WARN"}
                      </span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 mt-0.5" style={{ background: "var(--color-surface-3)", color: "var(--lux-text-muted)", fontVariantNumeric: "tabular-nums" }}>
                        Row {issue.row}
                      </span>
                      {issue.field && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 mt-0.5" style={{ background: "var(--color-surface-3)", color: "var(--lux-text-muted)" }}>
                          {issue.field}
                        </span>
                      )}
                      <span className="flex-1" style={{ color: "var(--lux-text-secondary)" }}>{issue.message}</span>
                      {issue.rawValue && (
                        <code className="text-[9px] px-1.5 py-0.5 rounded font-mono flex-shrink-0 mt-0.5" style={{ background: "var(--color-surface-3)", color: "var(--lux-text-muted)" }}>
                          {issue.rawValue.length > 30 ? issue.rawValue.slice(0, 30) + "..." : issue.rawValue}
                        </code>
                      )}
                    </div>
                  ))}
                </div>
                {totalPages > 1 && (
                  <div className="px-4 py-3 flex items-center justify-between" style={{ background: "var(--color-surface-2)", borderTop: "1px solid var(--lux-border)" }}>
                    <span className="text-[10px]" style={{ color: "var(--lux-text-muted)" }}>
                      Page {issuePage + 1} of {totalPages} ({filteredIssues.length} issues)
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setIssuePage(p => Math.max(0, p - 1))}
                        disabled={issuePage === 0}
                        className="px-3 py-1 rounded text-[10px] font-medium cursor-pointer disabled:opacity-40"
                        style={{ border: "1px solid var(--lux-border)", color: "var(--lux-text-muted)" }}
                        data-testid="button-issues-prev"
                      >
                        Previous
                      </button>
                      <button
                        onClick={() => setIssuePage(p => Math.min(totalPages - 1, p + 1))}
                        disabled={issuePage >= totalPages - 1}
                        className="px-3 py-1 rounded text-[10px] font-medium cursor-pointer disabled:opacity-40"
                        style={{ border: "1px solid var(--lux-border)", color: "var(--lux-text-muted)" }}
                        data-testid="button-issues-next"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {reconcLegs.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--lux-text-muted)" }}>
                Final Verification
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {reconcLegs.map(({ label, leg, formatFn }) => {
                  const matched = Math.abs(leg.diff) < 0.01;
                  return (
                    <div
                      key={label}
                      className="rounded-xl p-4"
                      style={{
                        background: "var(--lux-surface)",
                        border: matched ? "1px solid #bbf7d0" : "1px solid #fecaca",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                      }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold" style={{ color: "var(--lux-text)" }}>{label}</span>
                        {matched ? (
                          <div className="flex items-center gap-1">
                            <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: "#16a34a" }}>
                              <Check className="w-3 h-3 text-white" strokeWidth={3} />
                            </div>
                            <span className="text-[10px] font-bold" style={{ color: "#16a34a" }}>Match</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: "#ef4444" }}>
                              <CircleX className="w-3 h-3 text-white" />
                            </div>
                            <span className="text-[10px] font-bold" style={{ color: "#ef4444" }}>Mismatch</span>
                          </div>
                        )}
                      </div>
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span style={{ color: "var(--lux-text-muted)" }}>Expected</span>
                          <span style={{ color: "var(--lux-text)", fontVariantNumeric: "tabular-nums" }}>{formatFn(leg.source)}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span style={{ color: "var(--lux-text-muted)" }}>Imported</span>
                          <span style={{ color: "var(--lux-text)", fontVariantNumeric: "tabular-nums" }}>{formatFn(leg.imported)}</span>
                        </div>
                        {!matched && (
                          <div className="flex justify-between text-xs pt-1" style={{ borderTop: "1px solid var(--lux-border)" }}>
                            <span style={{ color: "#ef4444" }}>Difference</span>
                            <span style={{ color: "#ef4444", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{formatFn(leg.diff)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {r.verification?.checks && r.verification.checks.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--lux-text-muted)" }}>
                Verification Checks
              </h3>
              <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--lux-border)" }}>
                {r.verification.checks.map((check, idx) => (
                  <div
                    key={idx}
                    className="px-4 py-3 flex items-center gap-3"
                    style={{
                      background: idx % 2 === 0 ? "var(--lux-surface)" : "var(--color-surface-2)",
                      borderTop: idx > 0 ? "1px solid var(--lux-border)" : "none",
                    }}
                  >
                    {check.passed ? (
                      <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "#16a34a" }}>
                        <Check className="w-3 h-3 text-white" strokeWidth={3} />
                      </div>
                    ) : (
                      <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "#ef4444" }}>
                        <CircleX className="w-3 h-3 text-white" />
                      </div>
                    )}
                    <span className="text-sm font-medium flex-1" style={{ color: "var(--lux-text)" }}>
                      {check.entity} {check.metric}
                    </span>
                    <span className="text-xs" style={{ color: "var(--lux-text-muted)", fontVariantNumeric: "tabular-nums" }}>
                      Expected: {check.expected} / Actual: {check.actual}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-8 pb-8 pt-2 flex gap-3">
          <button
            onClick={onNewImport}
            className="flex-1 py-3.5 rounded-xl text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer"
            style={{
              background: "var(--gradient-brand)",
              boxShadow: "0 4px 14px rgba(var(--lux-accent-rgb), 0.3)",
            }}
            data-testid="button-new-import"
            onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; }}
          >
            Start New Import
          </button>
          <button
            onClick={onViewHistory}
            className="px-5 py-3 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer"
            style={{
              border: "1px solid var(--lux-border)",
              background: "var(--lux-surface)",
              color: "var(--lux-text-secondary)",
            }}
            data-testid="button-view-history"
          >
            View Import History
          </button>
        </div>
      </div>

      {runsQuery.data && runsQuery.data.length > 0 && (
        <ImportHistoryPanel
          runsQuery={runsQuery}
          rollbackMutation={rollbackMutation}
          rollbackConfirmId={rollbackConfirmId}
          setRollbackConfirmId={setRollbackConfirmId}
        />
      )}
    </div>
  );
}

function LuxToggle({
  checked,
  onChange,
  testId,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  testId: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative w-10 h-[22px] rounded-full transition-colors duration-200 cursor-pointer flex-shrink-0"
      style={{
        background: checked ? "var(--gradient-brand)" : "#d1d5db",
        opacity: disabled ? 0.5 : 1,
      }}
      data-testid={testId}
    >
      <span
        className="absolute top-[2px] left-[2px] w-[18px] h-[18px] rounded-full bg-white transition-transform duration-200 shadow-sm"
        style={{ transform: checked ? "translateX(18px)" : "translateX(0)" }}
      />
    </button>
  );
}

function EntityToggleCard({
  icon: Icon,
  label,
  count,
  checked,
  onChange,
  testId,
}: {
  icon: any;
  label: string;
  count: number;
  checked: boolean;
  onChange: (v: boolean) => void;
  testId: string;
}) {
  return (
    <div
      className="rounded-xl p-4 flex items-center gap-3 transition-all duration-200"
      style={{
        background: checked ? "var(--lux-surface)" : "var(--color-surface-2)",
        border: checked ? "1px solid rgba(var(--lux-accent-rgb), 0.2)" : "1px solid var(--lux-border)",
        borderLeft: checked ? "3px solid var(--color-accent)" : "3px solid transparent",
        opacity: checked ? 1 : 0.6,
        boxShadow: checked ? "0 1px 3px rgba(0,0,0,0.04)" : "none",
      }}
      data-testid={testId}
    >
      <Icon
        className="w-5 h-5 flex-shrink-0"
        style={{ color: checked ? "var(--color-accent)" : "var(--lux-text-muted)" }}
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold" style={{ color: checked ? "var(--lux-text)" : "var(--lux-text-muted)" }}>
          {label}
        </div>
        <div className="text-[10px] font-medium" style={{ color: "var(--lux-text-muted)", fontVariantNumeric: "tabular-nums" }}>
          {count.toLocaleString()} found
        </div>
      </div>
      <LuxToggle checked={checked} onChange={onChange} testId={`${testId}-toggle`} />
    </div>
  );
}

function OptionsPanel({
  options,
  setOptions,
  preflightResults,
  hideNonSelected,
  setHideNonSelected,
  uniqueCategories,
  uniquePayees,
  selectedPreset,
  onApplyPreset,
  onDryRun,
  onBack,
  isDryRunPending,
}: {
  options: ImportOptions;
  setOptions: (o: ImportOptions | ((prev: ImportOptions) => ImportOptions)) => void;
  preflightResults: PreflightFile[];
  hideNonSelected: boolean;
  setHideNonSelected: (v: boolean) => void;
  uniqueCategories: string[];
  uniquePayees: string[];
  selectedPreset: ImportPreset | null;
  onApplyPreset: (p: ImportPreset) => void;
  onDryRun: () => void;
  onBack: () => void;
  isDryRunPending: boolean;
}) {
  const totalClients = new Set(preflightResults.flatMap(f => f.uniqueClients)).size;
  const totalInvoices = new Set(preflightResults.flatMap(f => f.uniqueInvoiceNumbers)).size;
  const totalRows = preflightResults.reduce((s, f) => s + f.rowCount, 0);
  const totalPayouts = preflightResults.reduce((s, f) => s + f.independentPayoutSum, 0);
  const hasPayouts = totalPayouts > 0;

  const dateRangeLabel = useMemo(() => {
    if (!options.invoicePaidCutoffStart && !options.invoicePaidCutoffEnd &&
        !options.timeEntryDateStart && !options.timeEntryDateEnd) return null;
    const starts = [options.invoicePaidCutoffStart, options.timeEntryDateStart, options.payoutDateStart].filter(Boolean);
    const ends = [options.invoicePaidCutoffEnd, options.timeEntryDateEnd, options.payoutDateEnd].filter(Boolean);
    const minDate = starts.length > 0 ? starts.sort()[0] : null;
    const maxDate = ends.length > 0 ? ends.sort().reverse()[0] : null;
    if (!minDate && !maxDate) return null;
    const fmt = (d: string) => {
      const p = new Date(d + "T00:00:00");
      return p.toLocaleDateString("en-US", { month: "short", year: "numeric" });
    };
    if (minDate && maxDate) {
      const d1 = new Date(minDate + "T00:00:00");
      const d2 = new Date(maxDate + "T00:00:00");
      const months = Math.round((d2.getTime() - d1.getTime()) / (30.44 * 24 * 3600 * 1000));
      return `Covering ${fmt(minDate)} \u2014 ${fmt(maxDate)} (${months} months)`;
    }
    if (minDate) return `From ${fmt(minDate)} onward`;
    return `Through ${fmt(maxDate!)}`;
  }, [options.invoicePaidCutoffStart, options.invoicePaidCutoffEnd, options.timeEntryDateStart, options.timeEntryDateEnd, options.payoutDateStart, options.payoutDateEnd]);

  return (
    <div className="space-y-5" data-testid="options-panel">
      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)", border: "1px solid var(--lux-border)" }}
      >
        <div className="px-8 pt-8 pb-4">
          <div className="flex items-center gap-3 mb-1">
            <Settings className="w-5 h-5" style={{ color: "var(--color-accent)" }} />
            <h2 className="text-lg font-semibold" style={{ color: "var(--lux-text)" }}>
              Import Options
            </h2>
          </div>
          <p className="text-sm" style={{ color: "var(--lux-text-muted)" }}>
            Configure which data to import and apply filters.
          </p>
        </div>

        <div className="px-8 pb-6 space-y-6">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--lux-text-muted)" }}>
              Quick Presets
            </h3>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(PRESET_LABELS) as ImportPreset[]).map((preset) => (
                <button
                  key={preset}
                  onClick={() => onApplyPreset(preset)}
                  className="px-4 py-2 rounded-full text-xs font-semibold transition-all duration-200 cursor-pointer"
                  style={{
                    background: selectedPreset === preset ? "var(--gradient-brand)" : "transparent",
                    color: selectedPreset === preset ? "white" : "var(--lux-text-secondary)",
                    border: selectedPreset === preset ? "1px solid transparent" : "1px solid var(--lux-border)",
                    boxShadow: selectedPreset === preset ? "0 2px 8px rgba(var(--lux-accent-rgb), 0.3)" : "none",
                  }}
                  data-testid={`button-preset-${preset}`}
                  onMouseEnter={(e) => { if (selectedPreset !== preset) e.currentTarget.style.borderColor = "var(--color-accent)"; }}
                  onMouseLeave={(e) => { if (selectedPreset !== preset) e.currentTarget.style.borderColor = "var(--lux-border)"; }}
                >
                  {PRESET_LABELS[preset]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--lux-text-muted)" }}>
              Date Range Filter
            </h3>
            <div
              className="rounded-xl p-5"
              style={{ background: "var(--color-surface-2)", border: "1px solid var(--lux-border)" }}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-[11px] font-medium mb-1.5 block" style={{ color: "var(--lux-text-muted)" }}>
                    Import data from
                  </label>
                  <input
                    type="date"
                    value={options.invoicePaidCutoffStart}
                    onChange={(e) => setOptions((prev: ImportOptions) => ({
                      ...prev,
                      invoicePaidCutoffStart: e.target.value,
                      timeEntryDateStart: e.target.value,
                      payoutDateStart: e.target.value,
                    }))}
                    className="w-full px-3 py-2.5 rounded-lg text-sm"
                    style={{
                      background: "var(--lux-surface)",
                      border: "1px solid var(--lux-border)",
                      color: "var(--lux-text)",
                      outline: "none",
                    }}
                    data-testid="input-date-range-start"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium mb-1.5 block" style={{ color: "var(--lux-text-muted)" }}>
                    to
                  </label>
                  <input
                    type="date"
                    value={options.invoicePaidCutoffEnd}
                    onChange={(e) => setOptions((prev: ImportOptions) => ({
                      ...prev,
                      invoicePaidCutoffEnd: e.target.value,
                      timeEntryDateEnd: e.target.value,
                      payoutDateEnd: e.target.value,
                    }))}
                    className="w-full px-3 py-2.5 rounded-lg text-sm"
                    style={{
                      background: "var(--lux-surface)",
                      border: "1px solid var(--lux-border)",
                      color: "var(--lux-text)",
                      outline: "none",
                    }}
                    data-testid="input-date-range-end"
                  />
                </div>
              </div>
              {dateRangeLabel && (
                <div className="mt-3 text-xs font-medium flex items-center gap-1.5" style={{ color: "var(--color-accent)" }}>
                  <Calendar className="w-3.5 h-3.5" />
                  {dateRangeLabel}
                </div>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--lux-text-muted)" }}>
              Entity Types
            </h3>

            <div
              className="rounded-xl p-4 mb-3 flex items-center gap-3"
              style={{
                background: "rgba(var(--lux-accent-rgb), 0.04)",
                border: "1px solid rgba(var(--lux-accent-rgb), 0.15)",
              }}
              data-testid="exclude-internal-client"
            >
              <Ban className="w-4 h-4 flex-shrink-0" style={{ color: "var(--color-accent)" }} />
              <div className="flex-1">
                <div className="text-sm font-semibold" style={{ color: "var(--lux-text)" }}>
                  Exclude internal / house client
                </div>
                <div className="text-[10px]" style={{ color: "var(--lux-text-muted)" }}>
                  Filters out the organization's own entity from client imports
                </div>
              </div>
              <LuxToggle
                checked={true}
                onChange={() => {}}
                testId="toggle-exclude-internal"
              />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <EntityToggleCard
                icon={Users}
                label="Clients"
                count={totalClients}
                checked={options.importClients}
                onChange={(v) => setOptions((prev: ImportOptions) => ({ ...prev, importClients: v }))}
                testId="toggle-import-clients"
              />
              <EntityToggleCard
                icon={Layers}
                label="Services"
                count={0}
                checked={options.importServices}
                onChange={(v) => setOptions((prev: ImportOptions) => ({ ...prev, importServices: v }))}
                testId="toggle-import-services"
              />
              <EntityToggleCard
                icon={Clock}
                label="Time Entries"
                count={totalRows}
                checked={options.importTimeEntries}
                onChange={(v) => setOptions((prev: ImportOptions) => ({ ...prev, importTimeEntries: v }))}
                testId="toggle-import-time"
              />
              <EntityToggleCard
                icon={Receipt}
                label="Invoices"
                count={totalInvoices}
                checked={options.importInvoices}
                onChange={(v) => setOptions((prev: ImportOptions) => ({ ...prev, importInvoices: v }))}
                testId="toggle-import-invoices"
              />
              <EntityToggleCard
                icon={CreditCard}
                label="Payments"
                count={0}
                checked={options.importHistoricalPayments}
                onChange={(v) => setOptions((prev: ImportOptions) => ({ ...prev, importHistoricalPayments: v }))}
                testId="toggle-historical-payments"
              />
              <EntityToggleCard
                icon={Briefcase}
                label="Imported payouts"
                count={0}
                checked={options.importImportedPayouts}
                onChange={(v) => setOptions((prev: ImportOptions) => ({ ...prev, importImportedPayouts: v }))}
                testId="toggle-import-payouts"
              />
            </div>

            {options.importServices && (
              <div
                className="mt-3 rounded-xl p-3 flex items-center gap-3"
                style={{ background: "var(--color-surface-2)", border: "1px solid var(--lux-border)" }}
              >
                <span className="text-xs font-medium" style={{ color: "var(--lux-text)" }}>Non-zero rates only</span>
                <LuxToggle
                  checked={options.servicesNonZeroOnly}
                  onChange={(v) => setOptions((prev: ImportOptions) => ({ ...prev, servicesNonZeroOnly: v }))}
                  testId="toggle-services-nonzero"
                />
              </div>
            )}

            {options.importTimeEntries && (
              <div
                className="mt-3 rounded-xl p-3 flex items-center gap-3"
                style={{ background: "var(--color-surface-2)", border: "1px solid var(--lux-border)" }}
              >
                <span className="text-xs font-medium" style={{ color: "var(--lux-text)" }}>Skip exact duplicate time rows</span>
                <LuxToggle
                  checked={options.timeEntrySkipDuplicates}
                  onChange={(v) => setOptions((prev: ImportOptions) => ({ ...prev, timeEntrySkipDuplicates: v }))}
                  testId="toggle-skip-duplicates"
                />
              </div>
            )}

            {options.importTeamMembers !== undefined && (
              <div
                className="mt-3 rounded-xl p-3 flex items-center gap-3"
                style={{ background: "var(--color-surface-2)", border: "1px solid var(--lux-border)" }}
              >
                <span className="text-xs font-medium" style={{ color: "var(--lux-text)" }}>Import Team Members Directory</span>
                <LuxToggle
                  checked={options.importTeamMembers}
                  onChange={(v) => setOptions((prev: ImportOptions) => ({ ...prev, importTeamMembers: v }))}
                  testId="toggle-import-team-members"
                />
              </div>
            )}
          </div>

          {hasPayouts && uniquePayees.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--lux-text-muted)" }}>
                Payee Mapping
              </h3>
              <div
                className="rounded-xl overflow-hidden"
                style={{ border: "1px solid var(--lux-border)", background: "var(--lux-surface)" }}
              >
                <div className="px-4 py-3 flex items-center gap-2" style={{ background: "var(--color-surface-2)" }}>
                  <Briefcase className="w-4 h-4" style={{ color: "var(--lux-text-muted)" }} />
                  <span className="text-xs font-semibold" style={{ color: "var(--lux-text)" }}>
                    {uniquePayees.length} payee{uniquePayees.length !== 1 ? "s" : ""} detected
                  </span>
                  {options.payeeIncludeList.length > 0 && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold ml-auto" style={{ background: "#fef3c7", color: "#92400e" }}>
                      {uniquePayees.length - options.payeeIncludeList.length} excluded
                    </span>
                  )}
                </div>
                <div className="divide-y" style={{ borderColor: "var(--lux-border)" }}>
                  {uniquePayees.map((payee) => {
                    const isIncluded = options.payeeIncludeList.length === 0 || options.payeeIncludeList.includes(payee);
                    const payoutFile = preflightResults.find(f => f.expenseBreakdowns);
                    const payoutInfo = payoutFile?.expenseBreakdowns?.byPayee.find(p => p.name === payee);
                    return (
                      <div
                        key={payee}
                        className="px-4 py-3 flex items-center gap-3"
                        style={{ opacity: isIncluded ? 1 : 0.5, borderColor: "var(--lux-border)" }}
                        data-testid={`payee-row-${payee}`}
                      >
                        <LuxToggle
                          checked={isIncluded}
                          onChange={(v) => {
                            setOptions((prev: ImportOptions) => {
                              if (v) {
                                const newList = prev.payeeIncludeList.filter(p => p !== payee);
                                return { ...prev, payeeIncludeList: newList.length === uniquePayees.length - 1 ? [] : newList.length === 0 ? [] : [...newList, payee] };
                              } else {
                                const currentList = prev.payeeIncludeList.length === 0 ? [...uniquePayees] : [...prev.payeeIncludeList];
                                return { ...prev, payeeIncludeList: currentList.filter(p => p !== payee) };
                              }
                            });
                          }}
                          testId={`toggle-payee-${payee}`}
                        />
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium truncate block" style={{ color: "var(--lux-text)" }}>{payee}</span>
                        </div>
                        {payoutInfo && (
                          <span className="text-xs font-medium" style={{ color: "var(--lux-text-muted)", fontVariantNumeric: "tabular-nums" }}>
                            {formatMoney(payoutInfo.amount)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {uniqueCategories.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--lux-text-muted)" }}>
                Expense Category Filters
              </h3>
              <div
                className="rounded-xl p-4"
                style={{ background: "var(--color-surface-2)", border: "1px solid var(--lux-border)" }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <Filter className="w-3.5 h-3.5" style={{ color: "var(--lux-text-muted)" }} />
                  <span className="text-[11px] font-medium" style={{ color: "var(--lux-text-muted)" }}>
                    {options.expenseCategoryIncludeList.length === 0 ? "All categories included" : `${options.expenseCategoryIncludeList.length} of ${uniqueCategories.length} selected`}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {uniqueCategories.map((cat) => {
                    if (hideNonSelected && options.expenseCategoryIncludeList.length > 0 && !options.expenseCategoryIncludeList.includes(cat)) return null;
                    const isSelected = options.expenseCategoryIncludeList.length === 0 || options.expenseCategoryIncludeList.includes(cat);
                    return (
                      <button
                        key={cat}
                        onClick={() => {
                          setOptions((prev: ImportOptions) => {
                            const isInList = prev.expenseCategoryIncludeList.includes(cat);
                            if (isInList) {
                              return { ...prev, expenseCategoryIncludeList: prev.expenseCategoryIncludeList.filter(c => c !== cat) };
                            } else {
                              return { ...prev, expenseCategoryIncludeList: [...prev.expenseCategoryIncludeList, cat] };
                            }
                          });
                        }}
                        className="px-3 py-1.5 rounded-full text-[11px] font-medium transition-all duration-150 cursor-pointer"
                        style={{
                          background: isSelected ? "rgba(var(--lux-accent-rgb), 0.1)" : "transparent",
                          color: isSelected ? "var(--color-accent)" : "var(--lux-text-muted)",
                          border: isSelected ? "1px solid rgba(var(--lux-accent-rgb), 0.2)" : "1px solid var(--lux-border)",
                        }}
                        data-testid={`badge-category-${cat}`}
                      >
                        {cat}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-[10px]" style={{ color: "var(--lux-text-muted)" }}>Hide non-selected from summary</span>
                  <LuxToggle
                    checked={hideNonSelected}
                    onChange={setHideNonSelected}
                    testId="toggle-hide-nonselected"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-8 pb-8 pt-2 flex gap-3">
          <button
            onClick={onBack}
            className="px-5 py-3 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer"
            style={{
              border: "1px solid var(--lux-border)",
              background: "var(--lux-surface)",
              color: "var(--lux-text-muted)",
            }}
            data-testid="button-back-to-preflight"
          >
            Back
          </button>
          <button
            onClick={onDryRun}
            disabled={isDryRunPending}
            className="flex-1 py-3.5 rounded-xl text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer disabled:opacity-60"
            style={{
              background: "var(--gradient-brand)",
              boxShadow: "0 4px 14px rgba(var(--lux-accent-rgb), 0.3)",
            }}
            data-testid="button-dry-run"
            onMouseEnter={(e) => { if (!isDryRunPending) e.currentTarget.style.transform = "translateY(-1px)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; }}
          >
            {isDryRunPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Eye className="w-4 h-4" />
            )}
            {isDryRunPending ? "Running Dry Run..." : "Run Dry Run"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DryRunResultsDashboard({
  plan,
  planHash,
  onExecute,
  onRerun,
  onBack,
  isExecutePending,
  isDryRunPending,
}: {
  plan: DryRunPlan;
  planHash: string;
  onExecute: () => void;
  onRerun: () => void;
  onBack: () => void;
  isExecutePending: boolean;
  isDryRunPending: boolean;
}) {
  const [expandedEntities, setExpandedEntities] = useState<Record<string, boolean>>({});
  const [showIssues, setShowIssues] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);
  const [showNameMerges, setShowNameMerges] = useState(false);
  const [issueLimit, setIssueLimit] = useState(10);

  const hasBlockingErrors = (plan.rowIssueSummary?.totalErrors || 0) > 0;
  const passed = !hasBlockingErrors;

  const entityRows = [
    { key: "clients", label: "Clients", icon: Users, count: plan.clientsToCreate },
    { key: "projects", label: "Projects", icon: Database, count: plan.projectsToCreate },
    { key: "invoices", label: "Invoices", icon: Receipt, count: plan.invoicesToCreate },
    { key: "invoiceLines", label: "Invoice Lines", icon: FileText, count: plan.invoiceLinesToCreate },
    { key: "payments", label: "Payments", icon: CreditCard, count: plan.paymentsToCreate },
    { key: "timeEntries", label: "Time Entries", icon: Clock, count: plan.timeEntriesToCreate },
    { key: "payouts", label: "Imported payouts", icon: Briefcase, count: plan.payoutsToCreate },
  ].filter(r => r.count > 0);

  const totalCreates = entityRows.reduce((s, r) => s + r.count, 0);

  const reconcLegs: Array<{ label: string; leg: ReconciliationLeg; unit: string; formatFn: (n: number) => string }> = [];
  if (plan.reconciliation) {
    if (plan.reconciliation.invoiceTotal.source > 0) {
      reconcLegs.push({ label: "Invoice Total", leg: plan.reconciliation.invoiceTotal, unit: "$", formatFn: formatMoney });
    }
    if (plan.reconciliation.timeHours.source > 0) {
      reconcLegs.push({ label: "Time Hours", leg: plan.reconciliation.timeHours, unit: "h", formatFn: (n) => n.toFixed(1) + "h" });
    }
    if (plan.reconciliation.expenseTotal.source > 0) {
      reconcLegs.push({ label: "Expense Total", leg: plan.reconciliation.expenseTotal, unit: "$", formatFn: formatMoney });
    }
  }

  const totalErrors = plan.rowIssueSummary?.totalErrors || 0;
  const totalWarnings = plan.rowIssueSummary?.totalWarnings || 0;
  const totalIssues = totalErrors + totalWarnings;

  return (
    <div className="space-y-5" data-testid="dryrun-dashboard">
      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)", border: "1px solid var(--lux-border)" }}
      >
        <div
          className="px-8 py-6 flex items-center gap-4"
          style={{
            background: passed ? "linear-gradient(135deg, #dcfce7, #bbf7d0)" : "linear-gradient(135deg, #fef3c7, #fde68a)",
          }}
        >
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: passed ? "#16a34a" : "#d97706" }}
          >
            {passed ? (
              <Check className="w-6 h-6 text-white" strokeWidth={3} />
            ) : (
              <AlertTriangle className="w-6 h-6 text-white" />
            )}
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-bold" style={{ color: passed ? "#166534" : "#92400e" }}>
              {passed ? "Dry Run Complete \u2014 Ready to Import" : "Dry Run Complete \u2014 Issues Found"}
            </h2>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-xs font-medium" style={{ color: passed ? "#15803d" : "#b45309" }}>
                {totalCreates.toLocaleString()} records will be created
              </span>
              {planHash && (
                <code
                  className="text-[9px] px-2 py-0.5 rounded font-mono"
                  style={{ background: "rgba(0,0,0,0.08)", color: passed ? "#166534" : "#92400e" }}
                  data-testid="text-plan-hash"
                >
                  {planHash.slice(0, 16)}...
                </code>
              )}
            </div>
          </div>
        </div>

        <div className="px-8 pb-6 pt-6 space-y-6">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--lux-text-muted)" }}>
              Entity Counts
            </h3>
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--lux-border)" }} data-testid="div-dryrun-summary">
              {entityRows.map((row, idx) => {
                const Icon = row.icon;
                const isExpanded = expandedEntities[row.key] === true;
                return (
                  <div key={row.key}>
                    <div
                      className="px-4 py-3 flex items-center gap-3 cursor-pointer"
                      style={{
                        background: idx % 2 === 0 ? "var(--lux-surface)" : "var(--color-surface-2)",
                        borderTop: idx > 0 ? "1px solid var(--lux-border)" : "none",
                      }}
                      onClick={() => setExpandedEntities(prev => ({ ...prev, [row.key]: !isExpanded }))}
                      data-testid={`entity-row-${row.key}`}
                    >
                      <Icon className="w-4 h-4" style={{ color: "var(--color-accent)" }} />
                      <span className="text-sm font-medium flex-1" style={{ color: "var(--lux-text)" }}>
                        {row.label}
                      </span>
                      <span className="text-lg font-bold" style={{ color: "var(--lux-text)", fontVariantNumeric: "tabular-nums" }}>
                        {row.count.toLocaleString()}
                      </span>
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4" style={{ color: "var(--lux-text-muted)" }} />
                      ) : (
                        <ChevronRight className="w-4 h-4" style={{ color: "var(--lux-text-muted)" }} />
                      )}
                    </div>
                    {isExpanded && plan.opCountsByType && (
                      <div className="px-6 pb-3 pt-1" style={{ background: "var(--color-surface-2)" }}>
                        <div className="text-[10px]" style={{ color: "var(--lux-text-muted)" }}>
                          Operation breakdown from dry-run plan
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {plan.skippedDuplicateKeys > 0 && (
                <div
                  className="px-4 py-3 flex items-center gap-3"
                  style={{ background: "var(--color-surface-2)", borderTop: "1px solid var(--lux-border)" }}
                >
                  <Copy className="w-4 h-4" style={{ color: "var(--lux-text-muted)" }} />
                  <span className="text-sm font-medium flex-1" style={{ color: "var(--lux-text-muted)" }}>
                    Skipped (idempotent)
                  </span>
                  <span className="text-lg font-bold" style={{ color: "var(--lux-text-muted)", fontVariantNumeric: "tabular-nums" }}>
                    {plan.skippedDuplicateKeys.toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          </div>

          {plan.opCountsByType && Object.keys(plan.opCountsByType).length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--lux-text-muted)" }}>
                Operation Breakdown
              </h3>
              <div className="flex flex-wrap gap-2">
                {Object.entries(plan.opCountsByType).sort((a, b) => a[0].localeCompare(b[0])).map(([type, count]) => (
                  <div
                    key={type}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium"
                    style={{
                      background: "rgba(var(--lux-accent-rgb), 0.06)",
                      color: "var(--color-accent)",
                      border: "1px solid rgba(var(--lux-accent-rgb), 0.12)",
                    }}
                    data-testid={`badge-opcount-${type}`}
                  >
                    {type}: {count}
                  </div>
                ))}
              </div>
            </div>
          )}

          {reconcLegs.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--lux-text-muted)" }}>
                Reconciliation
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {reconcLegs.map(({ label, leg, formatFn }) => {
                  const matched = Math.abs(leg.diff) < 0.01;
                  return (
                    <div
                      key={label}
                      className="rounded-xl p-4"
                      style={{
                        background: "var(--lux-surface)",
                        border: matched ? "1px solid #bbf7d0" : "1px solid #fecaca",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                      }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold" style={{ color: "var(--lux-text)" }}>{label}</span>
                        {matched ? (
                          <div className="flex items-center gap-1">
                            <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: "#16a34a" }}>
                              <Check className="w-3 h-3 text-white" strokeWidth={3} />
                            </div>
                            <span className="text-[10px] font-bold" style={{ color: "#16a34a" }}>Match</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: "#ef4444" }}>
                              <CircleX className="w-3 h-3 text-white" />
                            </div>
                            <span className="text-[10px] font-bold" style={{ color: "#ef4444" }}>Mismatch</span>
                          </div>
                        )}
                      </div>
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span style={{ color: "var(--lux-text-muted)" }}>Source</span>
                          <span style={{ color: "var(--lux-text)", fontVariantNumeric: "tabular-nums" }}>{formatFn(leg.source)}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span style={{ color: "var(--lux-text-muted)" }}>Imported</span>
                          <span style={{ color: "var(--lux-text)", fontVariantNumeric: "tabular-nums" }}>{formatFn(leg.imported)}</span>
                        </div>
                        {!matched && (
                          <div className="flex justify-between text-xs pt-1" style={{ borderTop: "1px solid var(--lux-border)" }}>
                            <span style={{ color: "#ef4444" }}>Difference</span>
                            <span style={{ color: "#ef4444", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{formatFn(leg.diff)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {totalIssues > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--lux-text-muted)" }}>
                Row Issues
              </h3>
              <div
                className="rounded-xl overflow-hidden"
                style={{
                  border: totalErrors > 0 ? "1px solid #fecaca" : "1px solid #fef3c7",
                  background: "var(--lux-surface)",
                }}
              >
                <button
                  onClick={() => setShowIssues(!showIssues)}
                  className="w-full px-4 py-3 flex items-center gap-3 cursor-pointer"
                  style={{ background: totalErrors > 0 ? "#fee2e260" : "#fef3c760" }}
                  data-testid="toggle-row-issues"
                >
                  <CircleAlert className="w-4 h-4" style={{ color: totalErrors > 0 ? "#ef4444" : "#f59e0b" }} />
                  <span className="text-sm font-semibold flex-1 text-left" style={{ color: "var(--lux-text)" }}>
                    Row-Level Issues
                  </span>
                  {totalErrors > 0 && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: "#ef4444", color: "white" }}>
                      {totalErrors} error{totalErrors !== 1 ? "s" : ""}
                    </span>
                  )}
                  {totalWarnings > 0 && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: "#f59e0b", color: "white" }}>
                      {totalWarnings} warning{totalWarnings !== 1 ? "s" : ""}
                    </span>
                  )}
                  {showIssues ? (
                    <ChevronDown className="w-4 h-4" style={{ color: "var(--lux-text-muted)" }} />
                  ) : (
                    <ChevronRight className="w-4 h-4" style={{ color: "var(--lux-text-muted)" }} />
                  )}
                </button>
                {showIssues && plan.rowIssues && (
                  <div className="px-4 pb-3">
                    <div className="space-y-1.5">
                      {plan.rowIssues.slice(0, issueLimit).map((issue, i) => (
                        <div
                          key={i}
                          className="flex items-start gap-2 py-1.5 text-xs"
                          style={{ borderTop: i > 0 ? "1px solid var(--lux-border)" : "none" }}
                        >
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded font-bold flex-shrink-0 mt-0.5"
                            style={{
                              background: issue.severity === "error" ? "#fee2e2" : "#fef3c7",
                              color: issue.severity === "error" ? "#991b1b" : "#92400e",
                            }}
                          >
                            {issue.severity === "error" ? "ERR" : "WARN"}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 mt-0.5" style={{ background: "var(--color-surface-3)", color: "var(--lux-text-muted)", fontVariantNumeric: "tabular-nums" }}>
                            Row {issue.row}
                          </span>
                          {issue.field && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 mt-0.5" style={{ background: "var(--color-surface-3)", color: "var(--lux-text-muted)" }}>
                              {issue.field}
                            </span>
                          )}
                          <span style={{ color: "var(--lux-text-secondary)" }}>{issue.message}</span>
                        </div>
                      ))}
                    </div>
                    {plan.rowIssues.length > issueLimit && (
                      <button
                        onClick={() => setIssueLimit(prev => prev + 20)}
                        className="mt-2 text-xs font-medium cursor-pointer"
                        style={{ color: "var(--color-accent)" }}
                        data-testid="button-show-more-issues"
                      >
                        View more ({plan.rowIssues.length - issueLimit} remaining)
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {plan.ignoredBreakdown && Object.keys(plan.ignoredBreakdown).length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--lux-text-muted)" }}>
                Skipped Rows
              </h3>
              <div
                className="rounded-xl overflow-hidden"
                style={{ border: "1px solid var(--lux-border)", background: "var(--lux-surface)" }}
              >
                <button
                  onClick={() => setShowSkipped(!showSkipped)}
                  className="w-full px-4 py-3 flex items-center gap-3 cursor-pointer"
                  style={{ background: "var(--color-surface-2)" }}
                  data-testid="toggle-skipped-rows"
                >
                  <Ban className="w-4 h-4" style={{ color: "var(--lux-text-muted)" }} />
                  <span className="text-sm font-semibold flex-1 text-left" style={{ color: "var(--lux-text)" }}>
                    Skipped Rows Breakdown
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: "var(--color-surface-3)", color: "var(--lux-text-muted)" }}>
                    {Object.values(plan.ignoredBreakdown).reduce((s: number, c: number) => s + c, 0)}
                  </span>
                  {showSkipped ? (
                    <ChevronDown className="w-4 h-4" style={{ color: "var(--lux-text-muted)" }} />
                  ) : (
                    <ChevronRight className="w-4 h-4" style={{ color: "var(--lux-text-muted)" }} />
                  )}
                </button>
                {showSkipped && (
                  <div className="px-4 pb-3 space-y-1.5">
                    {Object.entries(plan.ignoredBreakdown).sort((a, b) => a[0].localeCompare(b[0])).map(([reason, count], i) => (
                      <div
                        key={reason}
                        className="flex items-center justify-between py-1.5 text-xs"
                        style={{ borderTop: i > 0 ? "1px solid var(--lux-border)" : "none" }}
                        data-testid={`badge-ignored-${reason}`}
                      >
                        <span style={{ color: "var(--lux-text-secondary)" }}>{reason}</span>
                        <span className="font-bold" style={{ color: "var(--lux-text)", fontVariantNumeric: "tabular-nums" }}>{count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {plan.nameMerges && plan.nameMerges.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--lux-text-muted)" }}>
                Name Normalizations
              </h3>
              <div
                className="rounded-xl overflow-hidden"
                style={{ border: "1px solid var(--lux-border)", background: "var(--lux-surface)" }}
              >
                <button
                  onClick={() => setShowNameMerges(!showNameMerges)}
                  className="w-full px-4 py-3 flex items-center gap-3 cursor-pointer"
                  style={{ background: "var(--color-surface-2)" }}
                  data-testid="toggle-name-merges"
                >
                  <ArrowLeftRight className="w-4 h-4" style={{ color: "var(--lux-text-muted)" }} />
                  <span className="text-sm font-semibold flex-1 text-left" style={{ color: "var(--lux-text)" }}>
                    Name Normalizations
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: "var(--color-surface-3)", color: "var(--lux-text-muted)" }}>
                    {plan.nameMerges.length}
                  </span>
                  {showNameMerges ? (
                    <ChevronDown className="w-4 h-4" style={{ color: "var(--lux-text-muted)" }} />
                  ) : (
                    <ChevronRight className="w-4 h-4" style={{ color: "var(--lux-text-muted)" }} />
                  )}
                </button>
                {showNameMerges && (
                  <div className="px-4 pb-3 space-y-1.5">
                    {plan.nameMerges.map((m, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 py-1.5 text-xs"
                        style={{ borderTop: i > 0 ? "1px solid var(--lux-border)" : "none" }}
                      >
                        <span className="font-medium" style={{ color: "var(--lux-text-muted)" }}>"{m.original}"</span>
                        <ArrowRight className="w-3 h-3 flex-shrink-0" style={{ color: "var(--color-accent)" }} />
                        <span className="font-semibold" style={{ color: "var(--lux-text)" }}>"{m.normalized}"</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {plan.fileRowCounts && Object.keys(plan.fileRowCounts).length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--lux-text-muted)" }}>
                File Processing Summary
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {Object.entries(plan.fileRowCounts).map(([fileType, counts]) => (
                  <div
                    key={fileType}
                    className="rounded-xl p-4"
                    style={{ background: "var(--color-surface-2)", border: "1px solid var(--lux-border)" }}
                  >
                    <div className="text-xs font-semibold mb-2" style={{ color: "var(--lux-text)" }}>
                      {fileType}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                      <div>
                        <span style={{ color: "var(--lux-text-muted)" }}>Source Rows</span>
                        <div className="font-bold text-sm" style={{ color: "var(--lux-text)", fontVariantNumeric: "tabular-nums" }}>{counts.totalSourceRows}</div>
                      </div>
                      <div>
                        <span style={{ color: "var(--lux-text-muted)" }}>Processed</span>
                        <div className="font-bold text-sm" style={{ color: "#16a34a", fontVariantNumeric: "tabular-nums" }}>{counts.processedRows}</div>
                      </div>
                      {counts.skippedRows > 0 && (
                        <div>
                          <span style={{ color: "var(--lux-text-muted)" }}>Skipped</span>
                          <div className="font-bold text-sm" style={{ color: "#d97706", fontVariantNumeric: "tabular-nums" }}>{counts.skippedRows}</div>
                        </div>
                      )}
                      {counts.warningRows > 0 && (
                        <div>
                          <span style={{ color: "var(--lux-text-muted)" }}>Warnings</span>
                          <div className="font-bold text-sm" style={{ color: "#f59e0b", fontVariantNumeric: "tabular-nums" }}>{counts.warningRows}</div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-8 pb-8 pt-2 flex gap-3">
          <button
            onClick={onBack}
            className="px-5 py-3 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer"
            style={{
              border: "1px solid var(--lux-border)",
              background: "var(--lux-surface)",
              color: "var(--lux-text-muted)",
            }}
            data-testid="button-back-to-options"
          >
            Back to Options
          </button>
          <button
            onClick={onRerun}
            disabled={isDryRunPending}
            className="px-5 py-3 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer flex items-center gap-2 disabled:opacity-60"
            style={{
              border: "1px solid var(--lux-border)",
              background: "var(--lux-surface)",
              color: "var(--lux-text-secondary)",
            }}
            data-testid="button-rerun-dryrun"
          >
            {isDryRunPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Re-run Dry Run
          </button>
          <button
            onClick={onExecute}
            disabled={isExecutePending || hasBlockingErrors}
            className="flex-1 py-3.5 rounded-xl text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer disabled:opacity-60"
            style={{
              background: hasBlockingErrors ? "#9ca3af" : "var(--gradient-brand)",
              boxShadow: hasBlockingErrors ? "none" : "0 4px 14px rgba(var(--lux-accent-rgb), 0.3)",
            }}
            data-testid="button-execute-import"
            onMouseEnter={(e) => { if (!isExecutePending && !hasBlockingErrors) e.currentTarget.style.transform = "translateY(-1px)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; }}
          >
            {isExecutePending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            {isExecutePending ? "Executing Import..." : "Proceed to Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
