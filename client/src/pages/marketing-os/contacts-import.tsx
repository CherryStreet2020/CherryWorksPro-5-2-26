/**
 * Marketing OS — Sprint 2c: CSV Contact Import Wizard
 * URL: /marketing/contacts/import
 *
 * Four-step wizard, single-file per fullstack-js minimize-files rule:
 *   1. Upload   — file picker, papaparse client-side, header preview
 *   2. Map      — fuzzy header → column mapping with manual override
 *   3. Review   — summary counts + dedupe strategy + Import button
 *   4. Results  — server response + error CSV download
 *
 * Backend: POST /api/marketing/contacts/import (server/routes/marketing-contact-import-routes.ts)
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import Papa from "papaparse";
import {
  ArrowLeft, ArrowRight, Check, FileUp, Loader2, AlertTriangle, Download, X, Save, Trash2, Plus, Tag as TagIcon, ChevronRight, Clock,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useBrand } from "@/hooks/useBrand";
import { isMarketingOsEnabled } from "@/lib/featureFlags";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { ContactImportPreset } from "@shared/schema";

const ALLOWED_COLUMNS: { value: string; label: string; required?: boolean }[] = [
  { value: "firstName",     label: "First Name",   required: true },
  { value: "lastName",      label: "Last Name",    required: true },
  { value: "email",         label: "Email" },
  { value: "phone",         label: "Phone" },
  { value: "title",         label: "Job Title" },
  { value: "role",          label: "Role" },
  { value: "companyName",   label: "Company" },
  { value: "location",      label: "Location" },
  { value: "linkedinUrl",   label: "LinkedIn URL" },
  { value: "twitterUrl",    label: "Twitter URL" },
  { value: "notes",         label: "Notes" },
  { value: "lifecycleStage",label: "Lifecycle Stage" },
  { value: "leadStatus",    label: "Lead Status" },
  { value: "source",        label: "Source" },
];

const SKIP_VALUE = "__skip__";

type Step = "upload" | "map" | "review" | "results";
type DedupeStrategy = "skip" | "update";

type ParsedCsv = {
  headers: string[];
  rows: Record<string, string>[];
  fileName: string;
};

type ImportResponse = {
  created: number;
  updated: number;
  skipped: number;
  tagged?: number;
  errors: { rowIndex: number; message: string }[];
  status: "completed" | "failed";
};

type ImportStatusResponse = {
  importId: string;
  fileName?: string;
  status: "pending" | "processing" | "completed" | "failed";
  rowCount: number;
  progressCount: number;
  imported: number;
  created: number;
  updated: number;
  skipped: number;
  // Number of contacts that received the user-selected tags. Populated by
  // the worker after the row loop; 0 when no tags were selected.
  tagged: number;
  errorCount: number;
  errors: { rowIndex: number; message: string }[];
};

type Tag = { id: string; name: string; color: string; brandId: string };

type RecentImportSummary = {
  importId: string;
  fileName: string;
  status: "pending" | "processing" | "completed" | "failed";
  rowCount: number;
  progressCount: number;
  successCount: number;
  errorCount: number;
  createdAt: string;
};

const ASYNC_IMPORT_MAX_ROWS = 50_000;

function normalizeHeader(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Fuzzy header → column suggestions. Conservative: only well-known synonyms. */
const COLUMN_SYNONYMS: Record<string, string> = {
  firstname:    "firstName",
  fname:        "firstName",
  givenname:    "firstName",
  lastname:     "lastName",
  lname:        "lastName",
  surname:      "lastName",
  familyname:   "lastName",
  email:        "email",
  emailaddress: "email",
  mail:         "email",
  phone:        "phone",
  phonenumber:  "phone",
  mobile:       "phone",
  cell:         "phone",
  title:        "title",
  jobtitle:     "title",
  position:     "title",
  role:         "role",
  company:      "companyName",
  companyname:  "companyName",
  organization: "companyName",
  organisation: "companyName",
  employer:     "companyName",
  account:      "companyName",
  location:     "location",
  city:         "location",
  country:      "location",
  linkedin:     "linkedinUrl",
  linkedinurl:  "linkedinUrl",
  twitter:      "twitterUrl",
  twitterurl:   "twitterUrl",
  x:            "twitterUrl",
  notes:        "notes",
  note:         "notes",
  comments:     "notes",
  lifecycle:    "lifecycleStage",
  lifecyclestage: "lifecycleStage",
  stage:        "lifecycleStage",
  leadstatus:   "leadStatus",
  status:       "leadStatus",
  source:       "source",
  leadsource:   "source",
};

/**
 * Levenshtein distance between two strings — small DP, fine for the short
 * normalized header strings we compare here (typically <= 30 chars).
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/**
 * Pre-computed normalized canonical names per allowed column. We compare
 * the normalized CSV header against (a) the canonical column key and (b)
 * the human label, taking the closer match.
 */
const COLUMN_NORMALIZED: { value: string; keys: string[] }[] = ALLOWED_COLUMNS.map((c) => ({
  value: c.value,
  keys: [normalizeHeader(c.value), normalizeHeader(c.label)].filter((k, i, a) => a.indexOf(k) === i),
}));

/**
 * Suggest a target column for a CSV header using a layered strategy:
 *   1. Exact synonym lookup (HubSpot/Pipedrive-style aliases).
 *   2. Exact normalized match against any canonical column key/label.
 *   3. Fuzzy Levenshtein match — accept if normalized distance / length
 *      <= 0.34 (i.e. ~roughly one typo per three chars).
 */
function suggestColumn(header: string): string {
  const key = normalizeHeader(header);
  if (!key) return SKIP_VALUE;
  if (COLUMN_SYNONYMS[key]) return COLUMN_SYNONYMS[key];
  for (const c of COLUMN_NORMALIZED) {
    if (c.keys.includes(key)) return c.value;
  }
  let best: { value: string; distance: number; len: number } | null = null;
  for (const c of COLUMN_NORMALIZED) {
    for (const k of c.keys) {
      const d = levenshtein(key, k);
      const refLen = Math.max(key.length, k.length);
      if (best == null || d < best.distance || (d === best.distance && refLen < best.len)) {
        best = { value: c.value, distance: d, len: refLen };
      }
    }
  }
  if (best && best.len > 0 && best.distance / best.len <= 0.34) {
    return best.value;
  }
  return SKIP_VALUE;
}

function downloadErrorCsv(
  errors: ImportResponse["errors"],
  parsed: ParsedCsv,
): void {
  const csv = Papa.unparse({
    fields: ["rowIndex", "message", ...parsed.headers],
    data: errors.map((e) => {
      const r = parsed.rows[e.rowIndex] ?? {};
      return [
        e.rowIndex + 2, // +1 for 0-index, +1 for header row
        e.message,
        ...parsed.headers.map((h) => r[h] ?? ""),
      ];
    }),
  });
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `import-errors-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ContactsImportPage() {
  const flagOn = isMarketingOsEnabled();
  const { toast } = useToast();
  const { activeBrand, brands } = useBrand();
  const [, setLocation] = useLocation();

  const [step, setStep] = useState<Step>("upload");
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [parsing, setParsing] = useState(false);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [dedupeStrategy, setDedupeStrategy] = useState<DedupeStrategy>("skip");
  // Tags the user picks at the Review step. Applied to every successfully
  // created/updated contact server-side (idempotent for updates).
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [importId, setImportId] = useState<string | null>(null);
  const [status, setStatus] = useState<ImportStatusResponse | null>(null);
  const [resumedFileName, setResumedFileName] = useState<string | null>(null);

  const brandId = activeBrand?.id ?? null;

  // ── Field-mapping presets ───────────────────────────────────────────────
  // List query is keyed on brand so switching brands shows the right set;
  // disabled until we have a brand to scope by.
  const presetsQuery = useQuery<ContactImportPreset[]>({
    queryKey: ["/api/marketing/contacts/import/presets", { brandId }],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/marketing/contacts/import/presets?brandId=${encodeURIComponent(brandId!)}`,
      );
      return res.json();
    },
    enabled: Boolean(brandId) && flagOn,
  });

  const savePresetMutation = useMutation({
    mutationFn: async (vars: { name: string; mapping: Record<string, string> }) => {
      const res = await apiRequest("POST", "/api/marketing/contacts/import/presets", {
        brandId,
        name: vars.name,
        mapping: vars.mapping,
      });
      return res.json() as Promise<ContactImportPreset>;
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/marketing/contacts/import/presets", { brandId }],
      });
      toast({
        title: "Preset saved",
        description: `"${saved.name}" can now be loaded on future imports.`,
      });
    },
    onError: (e: unknown) => {
      toast({
        title: "Could not save preset",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    },
  });

  const deletePresetMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/marketing/contacts/import/presets/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/marketing/contacts/import/presets", { brandId }],
      });
      toast({ title: "Preset deleted" });
    },
    onError: (e: unknown) => {
      toast({
        title: "Could not delete preset",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    },
  });

  /**
   * Apply a saved preset to the current mapping. We only assign target
   * columns for headers that actually exist in the just-uploaded CSV —
   * unknown headers from the preset are silently ignored, and any current
   * CSV header missing from the preset falls back to the auto-suggestion.
   */
  const applyPreset = (preset: ContactImportPreset) => {
    if (!parsed) return;
    const presetMap = (preset.mappingJson ?? {}) as Record<string, string>;
    const next: Record<string, string> = {};
    for (const h of parsed.headers) {
      next[h] = presetMap[h] ?? mapping[h] ?? SKIP_VALUE;
    }
    setMapping(next);
    toast({
      title: "Preset applied",
      description: `Loaded "${preset.name}".`,
    });
  };

  // ── Step 1: Upload ──────────────────────────────────────────────────────
  const handleFile = (file: File) => {
    setParsing(true);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: (result) => {
        setParsing(false);
        if (result.errors && result.errors.length > 0) {
          toast({
            title: "Failed to parse CSV",
            description: result.errors[0].message,
            variant: "destructive",
          });
          return;
        }
        const headers = result.meta.fields ?? [];
        if (headers.length === 0) {
          toast({
            title: "No columns detected",
            description: "Ensure the first row contains column names.",
            variant: "destructive",
          });
          return;
        }
        const rows = result.data;
        if (rows.length === 0) {
          toast({
            title: "No data rows",
            description: "The CSV has headers but no data.",
            variant: "destructive",
          });
          return;
        }
        if (rows.length > ASYNC_IMPORT_MAX_ROWS) {
          toast({
            title: "File too large",
            description: `Max ${ASYNC_IMPORT_MAX_ROWS.toLocaleString()} rows per import. This file has ${rows.length}.`,
            variant: "destructive",
          });
          return;
        }
        const auto: Record<string, string> = {};
        for (const h of headers) auto[h] = suggestColumn(h);
        setParsed({ headers, rows, fileName: file.name });
        setMapping(auto);
        setStep("map");
      },
      error: (err) => {
        setParsing(false);
        toast({
          title: "Failed to read file",
          description: err.message,
          variant: "destructive",
        });
      },
    });
  };

  // ── Step 2: Mapping validation ─────────────────────────────────────────
  const cleanedMapping = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [h, t] of Object.entries(mapping)) {
      if (t && t !== SKIP_VALUE) out[h] = t;
    }
    return out;
  }, [mapping]);

  const mappedTargets = useMemo(
    () => new Set(Object.values(cleanedMapping)),
    [cleanedMapping],
  );

  const hasFirstName = mappedTargets.has("firstName");
  const hasLastName = mappedTargets.has("lastName");
  const mappingIsValid = hasFirstName && hasLastName;

  const duplicateTargetCount = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const v of Object.values(cleanedMapping)) counts[v] = (counts[v] ?? 0) + 1;
    return Object.values(counts).filter((c) => c > 1).length;
  }, [cleanedMapping]);

  // ── Step 4: Submit (enqueue) ───────────────────────────────────────────
  const submit = async () => {
    if (!parsed || !brandId) return;
    setImporting(true);
    try {
      const res = await apiRequest("POST", "/api/marketing/contacts/import", {
        brandId,
        fileName: parsed.fileName,
        rows: parsed.rows,
        mapping: cleanedMapping,
        dedupeStrategy,
        tagIds,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      const json: { importId: string; status: string; rowCount: number } =
        await res.json();
      setImportId(json.importId);
      setStatus({
        importId: json.importId,
        status: "pending",
        rowCount: json.rowCount,
        progressCount: 0,
        imported: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        tagged: 0,
        errorCount: 0,
        errors: [],
      });
      setStep("results");
    } catch (e: unknown) {
      toast({
        title: "Import failed to start",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setImporting(false);
    }
  };

  // ── Polling: while we have an importId and the job isn't terminal,
  // refresh status every 1.5s. Stops on completed/failed.
  useEffect(() => {
    if (!importId) return;
    if (status && (status.status === "completed" || status.status === "failed")) {
      return;
    }
    let cancelled = false;
    // Throttle in-flight brand-list invalidations: while the import is
    // still "processing" and has actually progressed since the last
    // refresh, bust ["/api/brands"] roughly every 4 polls (~6s) so the
    // brand card's contactCount chip ticks up alongside the progress
    // bar. The on-completion invalidation below still fires for the
    // final, accurate value.
    let pollCount = 0;
    let lastInvalidatedProgress = 0;
    const tick = async () => {
      try {
        const res = await fetch(
          `/api/marketing/contacts/import/${importId}`,
          { credentials: "include" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: ImportStatusResponse = await res.json();
        if (cancelled) return;
        setStatus(json);
        pollCount += 1;
        if (
          json.status === "processing" &&
          json.progressCount > lastInvalidatedProgress &&
          pollCount % 4 === 0
        ) {
          lastInvalidatedProgress = json.progressCount;
          void queryClient.invalidateQueries({ queryKey: ["/api/brands"] });
        }
        if (json.status === "completed" || json.status === "failed") {
          // A finished import changes brand contactCount — bust the
          // brand list cache so its chips refresh without a reload.
          if (json.status === "completed" && json.imported > 0) {
            void queryClient.invalidateQueries({ queryKey: ["/api/brands"] });
            void queryClient.invalidateQueries({
              queryKey: ["/api/marketing/contacts"],
            });
          }
          toast({
            title:
              json.status === "failed" ? "Import failed" : "Import complete",
            description:
              `${json.imported} imported, ${json.skipped} skipped` +
              (json.tagged > 0 ? `, ${json.tagged} tagged` : "") +
              `, ${json.errorCount} errors.`,
            variant: json.status === "failed" ? "destructive" : undefined,
          });
        }
      } catch {
        // transient — keep polling
      }
    };
    const id = window.setInterval(tick, 1500);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [importId, status?.status, toast]);

  // ── Render guards ──────────────────────────────────────────────────────
  if (!flagOn) {
    return (
      <div className="px-6 lg:px-8 xl:px-10 py-6 max-w-7xl mx-auto">
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          Marketing is available on the Business plan. Upgrade anytime from Settings → Plan.
        </CardContent></Card>
      </div>
    );
  }

  if (brands.length === 0) {
    return (
      <div className="px-6 lg:px-8 xl:px-10 py-6 max-w-7xl mx-auto">
        <Card><CardContent className="py-12 text-center">
          <AlertTriangle className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
          <p className="mb-4">You need to create a brand before importing contacts.</p>
          <Link href="/settings/brands"><Button>Set up brands</Button></Link>
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="px-6 lg:px-8 xl:px-10 py-6 max-w-5xl mx-auto" data-testid="page-contacts-import">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-page-title">Import Contacts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {activeBrand ? `Importing into brand: ${activeBrand.name}` : "Select a brand to begin"}
          </p>
        </div>
        <Link href="/marketing/contacts">
          <Button variant="ghost" size="sm" data-testid="button-cancel-import">
            <X className="w-4 h-4 mr-1.5" /> Cancel
          </Button>
        </Link>
      </div>

      <StepIndicator step={step} />

      {step === "upload" && (
        <>
          <UploadStep parsing={parsing} onFile={handleFile} />
          {brandId && (
            <RecentImportsSection
              brandId={brandId}
              onOpen={(row) => {
                setImportId(row.importId);
                setResumedFileName(row.fileName);
                setParsed(null);
                setStatus({
                  importId: row.importId,
                  fileName: row.fileName,
                  status: row.status,
                  rowCount: row.rowCount,
                  progressCount: row.progressCount,
                  imported: row.successCount,
                  created: 0,
                  updated: 0,
                  skipped: Math.max(
                    0,
                    row.progressCount - row.successCount - row.errorCount,
                  ),
                  tagged: 0,
                  errorCount: row.errorCount,
                  errors: [],
                });
                setStep("results");
              }}
            />
          )}
        </>
      )}

      {step === "map" && parsed && (
        <MapStep
          parsed={parsed}
          mapping={mapping}
          setMapping={setMapping}
          mappingIsValid={mappingIsValid}
          duplicateTargetCount={duplicateTargetCount}
          hasFirstName={hasFirstName}
          hasLastName={hasLastName}
          presets={presetsQuery.data ?? []}
          presetsLoading={presetsQuery.isLoading}
          onApplyPreset={applyPreset}
          onDeletePreset={(id) => deletePresetMutation.mutate(id)}
          deletingPresetId={deletePresetMutation.isPending ? (deletePresetMutation.variables as string | undefined) : undefined}
          onBack={() => { setStep("upload"); setParsed(null); }}
          onNext={() => setStep("review")}
        />
      )}

      {step === "review" && parsed && brandId && (
        <ReviewStep
          parsed={parsed}
          cleanedMapping={cleanedMapping}
          dedupeStrategy={dedupeStrategy}
          setDedupeStrategy={setDedupeStrategy}
          tagIds={tagIds}
          setTagIds={setTagIds}
          importing={importing}
          brandId={brandId}
          onSavePreset={(name) =>
            savePresetMutation.mutate({ name, mapping: cleanedMapping })
          }
          isSavingPreset={savePresetMutation.isPending}
          onBack={() => setStep("map")}
          onSubmit={submit}
        />
      )}

      {step === "results" && status && (
        <ResultsStep
          status={status}
          parsed={parsed}
          fileName={parsed?.fileName ?? resumedFileName ?? status.fileName ?? "import"}
          onDone={() => setLocation("/marketing/contacts")}
          onImportAnother={() => {
            setStep("upload");
            setParsed(null);
            setStatus(null);
            setImportId(null);
            setResumedFileName(null);
            setMapping({});
            setDedupeStrategy("skip");
            setTagIds([]);
          }}
        />
      )}
    </div>
  );
}

// ───────────────────────── Step indicator ──────────────────────────────
function StepIndicator({ step }: { step: Step }) {
  const steps: { id: Step; label: string }[] = [
    { id: "upload",  label: "Upload" },
    { id: "map",     label: "Map" },
    { id: "review",  label: "Review" },
    { id: "results", label: "Done" },
  ];
  const currentIdx = steps.findIndex((s) => s.id === step);

  return (
    <div className="flex items-center mb-6" data-testid="step-indicator">
      {steps.map((s, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        return (
          <div key={s.id} className="flex items-center flex-1 last:flex-none">
            <div className="flex items-center gap-2">
              <div className={[
                "w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium",
                done ? "bg-primary text-primary-foreground"
                  : active ? "bg-primary/15 text-primary border-2 border-primary"
                  : "bg-muted text-muted-foreground",
              ].join(" ")}>
                {done ? <Check className="w-4 h-4" /> : i + 1}
              </div>
              <span className={[
                "text-sm",
                active ? "font-medium" : "text-muted-foreground",
              ].join(" ")}>
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={[
                "h-px flex-1 mx-3",
                done ? "bg-primary" : "bg-border",
              ].join(" ")} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ───────────────────────── Step 1: Upload ──────────────────────────────
function UploadStep({
  parsing, onFile,
}: { parsing: boolean; onFile: (f: File) => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload a CSV</CardTitle>
        <CardDescription>
          Up to 50,000 rows per file. The first row must be column headers.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <label
          htmlFor="csv-file-input"
          className="block border-2 border-dashed rounded-lg p-12 text-center cursor-pointer hover-elevate"
          data-testid="dropzone-csv"
        >
          {parsing ? (
            <>
              <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Parsing…</p>
            </>
          ) : (
            <>
              <FileUp className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
              <p className="font-medium mb-1">Choose a CSV file</p>
              <p className="text-sm text-muted-foreground">
                or drop it here
              </p>
            </>
          )}
          <input
            id="csv-file-input"
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            data-testid="input-csv-file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = "";
            }}
          />
        </label>
      </CardContent>
    </Card>
  );
}

// ───────────────────────── Step 2: Map ─────────────────────────────────
function MapStep({
  parsed, mapping, setMapping, mappingIsValid, duplicateTargetCount,
  hasFirstName, hasLastName, presets, presetsLoading, onApplyPreset,
  onDeletePreset, deletingPresetId, onBack, onNext,
}: {
  parsed: ParsedCsv;
  mapping: Record<string, string>;
  setMapping: (m: Record<string, string>) => void;
  mappingIsValid: boolean;
  duplicateTargetCount: number;
  hasFirstName: boolean;
  hasLastName: boolean;
  presets: ContactImportPreset[];
  presetsLoading: boolean;
  onApplyPreset: (preset: ContactImportPreset) => void;
  onDeletePreset: (id: string) => void;
  deletingPresetId: string | undefined;
  onBack: () => void;
  onNext: () => void;
}) {
  const [selectedPresetId, setSelectedPresetId] = useState<string>("");
  const selectedPreset = presets.find((p) => p.id === selectedPresetId) ?? null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Map CSV columns</CardTitle>
        <CardDescription>
          {parsed.fileName} · {parsed.rows.length.toLocaleString()} rows ·
          {" "}{parsed.headers.length} columns. First Name and Last Name are required.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Saved presets — load with one click, list scoped to brand+user. */}
        {presets.length > 0 && (
          <div
            className="flex items-end gap-2 p-3 rounded-md bg-muted/40 border"
            data-testid="preset-loader"
          >
            <div className="flex-1">
              <Label className="text-xs font-medium mb-1.5 block">
                Load saved preset
              </Label>
              <Select
                value={selectedPresetId}
                onValueChange={setSelectedPresetId}
              >
                <SelectTrigger data-testid="select-preset">
                  <SelectValue placeholder={presetsLoading ? "Loading…" : "Choose a preset…"} />
                </SelectTrigger>
                <SelectContent>
                  {presets.map((p) => (
                    <SelectItem
                      key={p.id}
                      value={p.id}
                      data-testid={`preset-option-${p.id}`}
                    >
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              size="sm"
              variant="default"
              disabled={!selectedPreset}
              onClick={() => selectedPreset && onApplyPreset(selectedPreset)}
              data-testid="button-apply-preset"
            >
              Apply
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!selectedPreset || deletingPresetId === selectedPresetId}
              onClick={() => {
                if (selectedPreset) {
                  onDeletePreset(selectedPreset.id);
                  setSelectedPresetId("");
                }
              }}
              data-testid="button-delete-preset"
              aria-label="Delete preset"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        )}

        {/* Spec-required preview: header row + first 5 data rows. */}
        <div className="border rounded-md overflow-x-auto" data-testid="upload-preview-table">
          <table className="w-full text-xs">
            <thead className="bg-muted/40">
              <tr>
                {parsed.headers.map((h) => (
                  <th key={h} className="text-left px-3 py-2 font-medium whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {parsed.rows.slice(0, 5).map((r, i) => (
                <tr key={i} data-testid={`preview-row-${i}`}>
                  {parsed.headers.map((h) => (
                    <td key={h} className="px-3 py-2 text-muted-foreground whitespace-nowrap max-w-[200px] truncate">
                      {r[h] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="border rounded-md divide-y">
          {parsed.headers.map((h) => {
            const sample = parsed.rows.slice(0, 3).map((r) => r[h]).filter(Boolean).slice(0, 1)[0] ?? "";
            return (
              <div key={h} className="grid grid-cols-12 gap-3 items-center p-3" data-testid={`row-mapping-${h}`}>
                <div className="col-span-5">
                  <div className="font-medium text-sm" data-testid={`text-header-${h}`}>{h}</div>
                  {sample && (
                    <div className="text-xs text-muted-foreground truncate mt-0.5">
                      e.g. {sample}
                    </div>
                  )}
                </div>
                <div className="col-span-1 text-center text-muted-foreground">
                  <ArrowRight className="w-4 h-4 mx-auto" />
                </div>
                <div className="col-span-6">
                  <Select
                    value={mapping[h] ?? SKIP_VALUE}
                    onValueChange={(v) => setMapping({ ...mapping, [h]: v })}
                  >
                    <SelectTrigger data-testid={`select-mapping-${h}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SKIP_VALUE}>— Skip this column —</SelectItem>
                      {ALLOWED_COLUMNS.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}{c.required ? " *" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            );
          })}
        </div>

        {!mappingIsValid && (
          <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm" data-testid="warning-required-fields">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              Required column{(!hasFirstName && !hasLastName) ? "s" : ""} not mapped:
              {!hasFirstName && " First Name"}{(!hasFirstName && !hasLastName) ? "," : ""}
              {!hasLastName && " Last Name"}.
            </div>
          </div>
        )}

        {duplicateTargetCount > 0 && (
          <div className="flex items-start gap-2 p-3 rounded-md bg-amber-100 dark:bg-amber-900/30 text-amber-900 dark:text-amber-100 text-sm" data-testid="warning-duplicate-mapping">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              Two or more CSV columns are mapped to the same field. Only the last one wins per row.
            </div>
          </div>
        )}

        <div className="flex justify-between pt-2">
          <Button variant="ghost" onClick={onBack} data-testid="button-back-to-upload">
            <ArrowLeft className="w-4 h-4 mr-1.5" /> Back
          </Button>
          <Button onClick={onNext} disabled={!mappingIsValid} data-testid="button-to-review">
            Continue <ArrowRight className="w-4 h-4 ml-1.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ───────────────────────── Step 3: Review ──────────────────────────────
function ReviewStep({
  parsed, cleanedMapping, dedupeStrategy, setDedupeStrategy,
  tagIds, setTagIds,
  importing, brandId, onSavePreset, isSavingPreset, onBack, onSubmit,
}: {
  parsed: ParsedCsv;
  cleanedMapping: Record<string, string>;
  dedupeStrategy: DedupeStrategy;
  setDedupeStrategy: (s: DedupeStrategy) => void;
  tagIds: string[];
  setTagIds: (next: string[]) => void;
  importing: boolean;
  brandId: string;
  onSavePreset: (name: string) => void;
  isSavingPreset: boolean;
  onBack: () => void;
  onSubmit: () => void;
}) {
  const [presetName, setPresetName] = useState("");
  const mappedCols = Object.entries(cleanedMapping);
  const skippedCols = parsed.headers.filter((h) => !cleanedMapping[h]);
  const emailMapped = Object.values(cleanedMapping).includes("email");

  // Spec-required pre-import duplicate insight: call the route in dry-run
  // mode whenever the mapping or dedupe strategy changes so the user sees
  // projected counts before they commit.
  const [preview, setPreview] = useState<ImportResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    (async () => {
      try {
        const res = await apiRequest("POST", "/api/marketing/contacts/import", {
          brandId,
          fileName: parsed.fileName,
          rows: parsed.rows,
          mapping: cleanedMapping,
          dedupeStrategy,
          tagIds,
          dryRun: true,
        });
        const json: ImportResponse = await res.json();
        if (!cancelled) setPreview(json);
      } catch (e: unknown) {
        if (!cancelled) setPreviewError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [brandId, parsed, cleanedMapping, dedupeStrategy, tagIds]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Review and import</CardTitle>
        <CardDescription>
          {parsed.rows.length.toLocaleString()} rows from {parsed.fileName}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="font-medium mb-1">Mapped columns ({mappedCols.length})</div>
            <ul className="text-muted-foreground space-y-1" data-testid="list-mapped-columns">
              {mappedCols.map(([h, t]) => (
                <li key={h}>
                  <span className="font-mono">{h}</span> → {ALLOWED_COLUMNS.find((c) => c.value === t)?.label ?? t}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="font-medium mb-1">Skipped columns ({skippedCols.length})</div>
            <ul className="text-muted-foreground space-y-1" data-testid="list-skipped-columns">
              {skippedCols.length === 0
                ? <li className="italic">None</li>
                : skippedCols.map((h) => <li key={h} className="font-mono">{h}</li>)}
            </ul>
          </div>
        </div>

        <div className="border-t pt-4">
          <div className="font-medium mb-2 text-sm">Projected outcome</div>
          {previewLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="preview-loading">
              <Loader2 className="w-4 h-4 animate-spin" /> Calculating duplicates…
            </div>
          )}
          {previewError && !previewLoading && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm" data-testid="preview-error">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>Unable to preview: {previewError}</div>
            </div>
          )}
          {preview && !previewLoading && !previewError && (
            <div
              className={tagIds.length > 0 ? "grid grid-cols-5 gap-2" : "grid grid-cols-4 gap-2"}
              data-testid="preview-stats"
            >
              <ResultStat label="Will create" value={preview.created} testId="preview-stat-created" />
              <ResultStat label="Will update" value={preview.updated} testId="preview-stat-updated" />
              <ResultStat label="Will skip"   value={preview.skipped} testId="preview-stat-skipped" />
              {tagIds.length > 0 && (
                <ResultStat
                  label="Will tag"
                  value={preview.tagged ?? 0}
                  testId="preview-stat-tagged"
                />
              )}
              <ResultStat
                label="Errors"
                value={preview.errors.length}
                testId="preview-stat-errors"
                tone={preview.errors.length > 0 ? "error" : "default"}
              />
            </div>
          )}
        </div>

        <div className="border-t pt-4">
          <Label className="font-medium mb-2 block">Apply tags to imported contacts</Label>
          <p className="text-xs text-muted-foreground mb-3">
            Selected tags will be added to every contact created or updated by this import.
            Existing tag assignments are preserved.
          </p>
          <TagPicker
            brandId={brandId}
            selected={tagIds}
            onChange={setTagIds}
          />
        </div>

        <div className="border-t pt-4">
          <Label className="font-medium mb-2 block">If a row's email matches an existing contact:</Label>
          {!emailMapped && (
            <p className="text-xs text-muted-foreground mb-2">
              No email column mapped — every row will be inserted as a new contact.
            </p>
          )}
          <RadioGroup
            value={dedupeStrategy}
            onValueChange={(v) => setDedupeStrategy(v as DedupeStrategy)}
            className="space-y-2"
            data-testid="radio-dedupe-strategy"
          >
            <div className="flex items-start gap-2">
              <RadioGroupItem value="skip" id="dedupe-skip" data-testid="radio-dedupe-skip" />
              <div>
                <Label htmlFor="dedupe-skip" className="cursor-pointer">Skip duplicates</Label>
                <p className="text-xs text-muted-foreground">Keep existing contacts unchanged.</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <RadioGroupItem value="update" id="dedupe-update" data-testid="radio-dedupe-update" />
              <div>
                <Label htmlFor="dedupe-update" className="cursor-pointer">Update existing</Label>
                <p className="text-xs text-muted-foreground">Overwrite mapped fields on the existing contact.</p>
              </div>
            </div>
          </RadioGroup>
        </div>

        <div className="border-t pt-4" data-testid="save-preset">
          <Label htmlFor="preset-name-input" className="font-medium mb-2 block">
            Save this mapping as a preset
          </Label>
          <p className="text-xs text-muted-foreground mb-2">
            Re-apply it on future imports for this brand with one click.
          </p>
          <div className="flex gap-2">
            <Input
              id="preset-name-input"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="e.g. HubSpot export"
              maxLength={80}
              disabled={isSavingPreset}
              data-testid="input-preset-name"
            />
            <Button
              type="button"
              variant="outline"
              disabled={isSavingPreset || presetName.trim().length === 0}
              onClick={() => {
                const name = presetName.trim();
                if (!name) return;
                onSavePreset(name);
                setPresetName("");
              }}
              data-testid="button-save-preset"
            >
              {isSavingPreset
                ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Saving…</>
                : <><Save className="w-4 h-4 mr-1.5" /> Save preset</>}
            </Button>
          </div>
        </div>

        <div className="flex justify-between pt-2">
          <Button variant="ghost" onClick={onBack} disabled={importing} data-testid="button-back-to-map">
            <ArrowLeft className="w-4 h-4 mr-1.5" /> Back
          </Button>
          <Button onClick={onSubmit} disabled={importing} data-testid="button-confirm-import">
            {importing ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Importing…</>
              : <>Import {parsed.rows.length.toLocaleString()} rows</>}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ───────────────────────── Step 4: Results ─────────────────────────────
function ResultsStep({
  status, parsed, fileName, onDone, onImportAnother,
}: {
  status: ImportStatusResponse;
  parsed: ParsedCsv | null;
  fileName: string;
  onDone: () => void;
  onImportAnother: () => void;
}) {
  const inProgress = status.status === "pending" || status.status === "processing";
  const pct = status.rowCount > 0
    ? Math.min(100, Math.round((status.progressCount / status.rowCount) * 100))
    : 0;

  let title: string;
  if (status.status === "failed") title = "Import failed";
  else if (status.status === "completed") title = "Import complete";
  else if (status.status === "processing") title = "Importing…";
  else title = "Queued";

  // Once the worker has finished, surface a "Tagged" stat alongside the
  // create/update/skip/error counts. Hidden while in progress because
  // tagging is the very last step of the worker, so any non-zero value
  // mid-run would be misleading.
  const showTagged = !inProgress && status.tagged > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle data-testid="text-results-title">{title}</CardTitle>
        <CardDescription>
          {inProgress
            ? `Processing ${status.rowCount.toLocaleString()} rows from ${fileName} in the background — you can leave this page open.`
            : `Processed ${status.rowCount.toLocaleString()} rows from ${fileName}.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {inProgress && (
          <div data-testid="import-progress">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
              <span data-testid="text-progress-counts">
                {status.progressCount.toLocaleString()} of {status.rowCount.toLocaleString()} rows
              </span>
              <span data-testid="text-progress-percent">{pct}%</span>
            </div>
            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${pct}%` }}
                data-testid="progress-bar"
              />
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {status.status === "pending" ? "Waiting for the worker to pick up the job…" : "Working through your file…"}
            </div>
          </div>
        )}

        {inProgress ? (
          <div className="grid grid-cols-3 gap-3">
            <ResultStat label="Imported" value={status.imported} testId="stat-imported" />
            <ResultStat label="Skipped" value={status.skipped} testId="stat-skipped" />
            <ResultStat
              label="Errors"
              value={status.errorCount}
              testId="stat-errors"
              tone={status.errorCount > 0 ? "error" : "default"}
            />
          </div>
        ) : (
          <div className={showTagged ? "grid grid-cols-5 gap-3" : "grid grid-cols-4 gap-3"}>
            <ResultStat label="Created" value={status.created} testId="stat-created" />
            <ResultStat label="Updated" value={status.updated} testId="stat-updated" />
            <ResultStat label="Skipped" value={status.skipped} testId="stat-skipped" />
            {showTagged && (
              <ResultStat label="Tagged" value={status.tagged} testId="stat-tagged" />
            )}
            <ResultStat
              label="Errors"
              value={status.errorCount}
              testId="stat-errors"
              tone={status.errorCount > 0 ? "error" : "default"}
            />
          </div>
        )}

        {!inProgress && status.errors.length > 0 && (
          <div className="border rounded-md p-4 bg-destructive/5">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <AlertTriangle className="w-4 h-4 text-destructive" />
                {status.errors.length.toLocaleString()} row{status.errors.length === 1 ? "" : "s"} could not be imported
              </div>
              {parsed && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => downloadErrorCsv(status.errors, parsed)}
                  data-testid="button-download-errors"
                >
                  <Download className="w-4 h-4 mr-1.5" /> Download error CSV
                </Button>
              )}
            </div>
            <ul className="text-xs text-muted-foreground max-h-40 overflow-auto space-y-1" data-testid="list-errors">
              {status.errors.slice(0, 20).map((e) => (
                <li key={e.rowIndex}>
                  Row {e.rowIndex + 2}: {e.message}
                </li>
              ))}
              {status.errors.length > 20 && (
                <li className="italic">…and {status.errors.length - 20} more (download CSV for full list)</li>
              )}
            </ul>
          </div>
        )}

        <div className="flex justify-between pt-2">
          <Button
            variant="ghost"
            onClick={onImportAnother}
            disabled={inProgress}
            data-testid="button-import-another"
          >
            Import another file
          </Button>
          <Button
            onClick={onDone}
            disabled={inProgress}
            data-testid="button-done"
          >
            Done
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ───────────────────────── Tag picker ──────────────────────────────────
/**
 * Multi-select tag picker for the Review step. Lists existing brand tags
 * (via `GET /api/marketing/tags?brandId=…`) with checkboxes, and offers an
 * inline create-new affordance that POSTs to `/api/marketing/tags` and
 * auto-selects the new tag.
 */
function TagPicker({
  brandId, selected, onChange,
}: {
  brandId: string;
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const tagsQuery = useQuery<Tag[]>({
    queryKey: ["/api/marketing/tags", brandId],
    enabled: !!brandId,
    queryFn: async () => {
      const res = await fetch(
        `/api/marketing/tags?brandId=${encodeURIComponent(brandId)}`,
        { credentials: "include" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      return res.json();
    },
  });

  const tags = tagsQuery.data ?? [];
  const selectedTags = useMemo(
    () => tags.filter((t) => selected.includes(t.id)),
    [tags, selected],
  );

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  const removeOne = (id: string) => onChange(selected.filter((x) => x !== id));

  const trimmed = newName.trim();
  const dupeName = !!trimmed && tags.some((t) => t.name.toLowerCase() === trimmed.toLowerCase());

  const handleCreate = async () => {
    if (!trimmed || dupeName) return;
    setCreating(true);
    try {
      const res = await apiRequest("POST", "/api/marketing/tags", {
        brandId,
        name: trimmed,
      });
      const created: Tag = await res.json();
      // Optimistically add to selection and refresh the cached list.
      onChange([...selected, created.id]);
      setNewName("");
      await qc.invalidateQueries({ queryKey: ["/api/marketing/tags", brandId] });
    } catch (e: unknown) {
      toast({
        title: "Could not create tag",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-2" data-testid="tag-picker">
      <div className="flex flex-wrap gap-1.5 items-center min-h-[2rem]">
        {selectedTags.length === 0 && (
          <span className="text-xs text-muted-foreground italic" data-testid="text-no-tags-selected">
            No tags selected
          </span>
        )}
        {selectedTags.map((t) => (
          <Badge
            key={t.id}
            variant="secondary"
            className="gap-1 pr-1"
            style={{ backgroundColor: `${t.color}20`, color: t.color, borderColor: `${t.color}40` }}
            data-testid={`badge-selected-tag-${t.id}`}
          >
            <TagIcon className="w-3 h-3" />
            {t.name}
            <button
              type="button"
              onClick={() => removeOne(t.id)}
              className="ml-0.5 rounded-sm hover:bg-black/10 dark:hover:bg-white/10 p-0.5"
              data-testid={`button-remove-tag-${t.id}`}
              aria-label={`Remove ${t.name}`}
            >
              <X className="w-3 h-3" />
            </button>
          </Badge>
        ))}

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              data-testid="button-open-tag-picker"
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              {selectedTags.length > 0 ? "Add more" : "Choose tags"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-2" align="start">
            <div className="space-y-2">
              <div className="flex gap-1">
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Create a new tag…"
                  className="h-8"
                  maxLength={64}
                  data-testid="input-new-tag-name"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleCreate();
                    }
                  }}
                />
                <Button
                  size="sm"
                  className="h-8"
                  disabled={!trimmed || dupeName || creating}
                  onClick={handleCreate}
                  data-testid="button-create-tag"
                >
                  {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Add"}
                </Button>
              </div>
              {dupeName && (
                <p className="text-xs text-muted-foreground" data-testid="text-tag-duplicate-warn">
                  A tag with that name already exists below.
                </p>
              )}

              <div className="max-h-56 overflow-auto -mx-1 px-1" data-testid="list-available-tags">
                {tagsQuery.isLoading && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading tags…
                  </div>
                )}
                {!tagsQuery.isLoading && tags.length === 0 && (
                  <p className="text-xs text-muted-foreground py-2 italic">
                    No tags yet. Create one above.
                  </p>
                )}
                {tags.map((t) => {
                  const isSelected = selected.includes(t.id);
                  return (
                    <label
                      key={t.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md hover-elevate cursor-pointer text-sm"
                      data-testid={`row-available-tag-${t.id}`}
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggle(t.id)}
                        data-testid={`checkbox-tag-${t.id}`}
                      />
                      <span
                        className="w-2.5 h-2.5 rounded-full inline-block"
                        style={{ backgroundColor: t.color }}
                      />
                      <span className="truncate">{t.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

// ───────────────────────── Recent imports list ─────────────────────────
function RecentImportsSection({
  brandId, onOpen,
}: {
  brandId: string;
  onOpen: (row: RecentImportSummary) => void;
}) {
  const [rows, setRows] = useState<RecentImportSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    const fetchOnce = async () => {
      try {
        const res = await fetch(
          `/api/marketing/contact-imports?brandId=${encodeURIComponent(brandId)}`,
          { credentials: "include" },
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message || `HTTP ${res.status}`);
        }
        const json: { imports: RecentImportSummary[] } = await res.json();
        if (cancelled) return;
        setRows(json.imports);
        setError(null);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchOnce();
    // Light polling so a job that's still in-flight updates its progress.
    timer = window.setInterval(fetchOnce, 5000);

    return () => {
      cancelled = true;
      if (timer != null) window.clearInterval(timer);
    };
  }, [brandId]);

  if (loading && !rows) {
    return (
      <Card className="mt-6" data-testid="card-recent-imports">
        <CardHeader>
          <CardTitle className="text-base">Recent imports</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading recent imports…
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error && !rows) {
    return (
      <Card className="mt-6" data-testid="card-recent-imports">
        <CardHeader>
          <CardTitle className="text-base">Recent imports</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>Could not load recent imports: {error}</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!rows || rows.length === 0) {
    return (
      <Card className="mt-6" data-testid="card-recent-imports">
        <CardHeader>
          <CardTitle className="text-base">Recent imports</CardTitle>
          <CardDescription>
            Past CSV imports for this brand will appear here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground italic" data-testid="text-recent-imports-empty">
            No imports yet.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mt-6" data-testid="card-recent-imports">
      <CardHeader>
        <CardTitle className="text-base">Recent imports</CardTitle>
        <CardDescription>
          The last {rows.length} {rows.length === 1 ? "import" : "imports"} for this brand. Click one to view its results.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y" data-testid="list-recent-imports">
          {rows.map((r) => {
            const created = (() => {
              try {
                return formatDistanceToNow(new Date(r.createdAt), { addSuffix: true });
              } catch {
                return "";
              }
            })();
            const inFlight = r.status === "pending" || r.status === "processing";
            return (
              <li key={r.importId}>
                <button
                  type="button"
                  onClick={() => onOpen(r)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover-elevate"
                  data-testid={`button-recent-import-${r.importId}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="font-medium text-sm truncate"
                        data-testid={`text-recent-filename-${r.importId}`}
                        title={r.fileName}
                      >
                        {r.fileName}
                      </span>
                      <StatusBadge status={r.status} />
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1 flex-wrap">
                      <span data-testid={`text-recent-rows-${r.importId}`}>
                        {r.rowCount.toLocaleString()} row{r.rowCount === 1 ? "" : "s"}
                      </span>
                      {inFlight ? (
                        <span data-testid={`text-recent-progress-${r.importId}`}>
                          {r.progressCount.toLocaleString()} / {r.rowCount.toLocaleString()} processed
                        </span>
                      ) : (
                        <span data-testid={`text-recent-success-${r.importId}`}>
                          {r.successCount.toLocaleString()} imported
                        </span>
                      )}
                      {r.errorCount > 0 && (
                        <span className="text-destructive" data-testid={`text-recent-errors-${r.importId}`}>
                          {r.errorCount.toLocaleString()} error{r.errorCount === 1 ? "" : "s"}
                        </span>
                      )}
                      {created && (
                        <span className="flex items-center gap-1" data-testid={`text-recent-created-${r.importId}`}>
                          <Clock className="w-3 h-3" /> {created}
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                </button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: RecentImportSummary["status"] }) {
  const map: Record<RecentImportSummary["status"], { label: string; cls: string }> = {
    pending:    { label: "Pending",    cls: "bg-muted text-muted-foreground" },
    processing: { label: "Processing", cls: "bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-100" },
    completed:  { label: "Completed",  cls: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100" },
    failed:     { label: "Failed",     cls: "bg-destructive/15 text-destructive" },
  };
  const m = map[status] ?? map.pending;
  return (
    <span
      className={`inline-flex items-center text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded ${m.cls}`}
      data-testid={`badge-import-status-${status}`}
    >
      {m.label}
    </span>
  );
}

function ResultStat({
  label, value, testId, tone = "default",
}: {
  label: string;
  value: number;
  testId: string;
  tone?: "default" | "error";
}) {
  return (
    <div
      className={[
        "border rounded-md p-3 text-center",
        tone === "error" && value > 0 ? "border-destructive/40 bg-destructive/5" : "",
      ].join(" ")}
      data-testid={testId}
    >
      <div className="text-2xl font-semibold tabular-nums">{value.toLocaleString()}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}
