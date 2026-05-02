/**
 * Marketing OS — Sprint 2a: Contacts list (/marketing/contacts).
 *
 * Layout follows client/src/pages/settings/brands.tsx:
 *   px-6 lg:px-8 xl:px-10 py-6 max-w-7xl mx-auto
 * but uses max-w-7xl (table view).
 *
 * Components are colocated in this file per fullstack-js minimize-files rule:
 *  - ContactsFilters
 *  - ContactsTable
 *  - BulkActionsBar
 *  - AddContactDialog
 *
 * Brand-scoping: reads activeBrand from BrandContext. If the user has no
 * brands yet, surfaces an empty-state with a link to /settings/brands.
 *
 * Cross-link from /clients/:id is honored via the ?clientId= query param —
 * when present, the brand picker is forced to that client's brand and the
 * filter UI shows a chip indicating the scope.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Plus, Search, X, Users, Trash2, ChevronRight, AlertTriangle, Upload,
  Tag as TagIcon, Bookmark, Layers, UserPlus, BookmarkPlus,
} from "lucide-react";
import { PremiumDialog } from "@/components/marketing-os/premium/premium-dialog";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { MarketingOsTabs } from "@/components/marketing-os/marketing-os-tabs";
import { BrandBadge } from "@/components/marketing-os/brand-badge";
import {
  StatusRibbon,
  type LifecycleStage,
} from "@/components/marketing-os/premium/status-ribbon";
import { FreshnessDot } from "@/components/marketing-os/premium/freshness-dot";

// Sprint 2m: stages we render as a premium gradient `StatusRibbon`. Any
// row whose lifecycle_stage falls outside this set falls back to plain
// text so we don't crash on legacy values.
const RIBBON_STAGES = new Set<LifecycleStage>([
  "lead", "mql", "sql", "opportunity", "customer", "evangelist",
]);
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useBrand } from "@/hooks/useBrand";
import { isMarketingOsEnabled } from "@/lib/featureFlags";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { ClientContact, ContactTag, ContactSegment, Brand } from "@shared/schema";

type ContactWithTags = ClientContact & { tags: ContactTag[] };
type TagWithCounts = ContactTag & { contactCount: number; lastUsedAt: string | null };
type SegmentWithCount = ContactSegment & { contactCount: number };

const LIFECYCLE_STAGES = [
  { value: "lead",         label: "Lead" },
  { value: "mql",          label: "MQL" },
  { value: "sql",          label: "SQL" },
  { value: "opportunity",  label: "Opportunity" },
  { value: "customer",     label: "Customer" },
  { value: "evangelist",   label: "Evangelist" },
];

const LEAD_STATUSES = [
  { value: "new",         label: "New" },
  { value: "contacted",   label: "Contacted" },
  { value: "qualified",   label: "Qualified" },
  { value: "unqualified", label: "Unqualified" },
];

function fullName(c: ContactWithTags): string {
  return `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "(unnamed)";
}

export default function ContactsListPage() {
  const flagOn = isMarketingOsEnabled();
  const { toast } = useToast();
  const { activeBrand, brands, setActiveBrand } = useBrand();
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const clientIdFilter = params.get("clientId") || undefined;
  // Sprint 2e: segmentId from URL drives an initial-load + every direct nav.
  const urlSegmentId = params.get("segmentId") || null;
  const [, setLocation] = useLocation();

  // ── filter state ──────────────────────────────────────────────────────
  const [searchTerm, setSearchTerm]       = useState("");
  const [lifecycleStage, setLifecycleStage] = useState<string>("all");
  const [leadStatus, setLeadStatus]       = useState<string>("all");
  const [sourceFilter, setSourceFilter]   = useState<string>("");
  const [selected, setSelected]           = useState<Set<string>>(new Set());
  // Sprint 2d: tag filter is multi-select with AND/intersection semantics
  // (a contact must carry every selected tag).
  const [tagFilterIds, setTagFilterIds]   = useState<string[]>([]);
  // Sprint 2e: currently-loaded segment id (drives the chip + Save-as button label).
  const [segmentId, setSegmentId]         = useState<string | null>(urlSegmentId);
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  // Cursor-pagination via offset+limit. Fetched pages are concatenated; each
  // change to filters resets `pages` to [0].
  const PAGE_SIZE = 50;
  const [pages, setPages] = useState<number>(1);

  const brandId = activeBrand?.id ?? null;

  // Reset page count when filters change.
  useEffect(() => {
    setPages(1);
  }, [brandId, lifecycleStage, leadStatus, sourceFilter, searchTerm, clientIdFilter, tagFilterIds]);

  // Reset tag filter + segment when active brand changes (both are brand-scoped).
  // The segment-load path may force-switch the active brand; in that case we
  // must NOT clear the just-loaded segment/tags. `skipNextBrandResetRef` is
  // armed by the loader before it calls `setActiveBrand` and consumed here.
  // We also skip the very first mount because that's not a "change" — running
  // it then would wipe `segmentId` initialised from the URL on direct nav.
  const skipNextBrandResetRef = useRef(false);
  const prevBrandIdRef = useRef<string | null>(brandId);
  useEffect(() => {
    if (prevBrandIdRef.current === brandId) {
      // First-mount effect (or brand stayed the same) — nothing to reset.
      return;
    }
    prevBrandIdRef.current = brandId;
    if (skipNextBrandResetRef.current) {
      skipNextBrandResetRef.current = false;
      return;
    }
    setTagFilterIds([]);
    setSegmentId(null);
  }, [brandId]);

  // Sprint 2e: load the segment indicated by ?segmentId=… and apply its filter
  // to local state. Tracks the last id we loaded so we don't loop when the
  // canonicalising effect rewrites the URL with the same id.
  const loadedSegmentRef = useRef<string | null>(null);
  // Mirror activeBrand in a ref so we can read its CURRENT value inside the
  // loader effect without depending on it (depending would re-run the effect
  // every time we switch brands and re-trigger the load loop).
  const activeBrandIdRef = useRef<string | null>(activeBrand?.id ?? null);
  useEffect(() => { activeBrandIdRef.current = activeBrand?.id ?? null; }, [activeBrand?.id]);
  useEffect(() => {
    if (!flagOn) return;
    if (!urlSegmentId) {
      loadedSegmentRef.current = null;
      return;
    }
    // Defer until the brand list is loaded so we can reliably force-switch
    // the active brand to the segment's brand when needed. Without this gate
    // the very first navigation can race the brand fetch and the segment
    // ends up applied under the wrong (or no) active brand.
    if (!brands) return;
    if (loadedSegmentRef.current === urlSegmentId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/marketing/segments/${urlSegmentId}`, { credentials: "include" });
        if (!res.ok) {
          if (cancelled) return;
          toast({ title: "Segment not found or no longer available", variant: "destructive" });
          // Clear local segment state AND strip the bad id from the URL so we
          // don't keep retrying or re-canonicalise it back into the URL.
          loadedSegmentRef.current = null;
          setSegmentId(null);
          setLocation("/marketing/contacts", { replace: true });
          return;
        }
        const seg = (await res.json()) as ContactSegment;
        if (cancelled) return;
        const f = (seg.filter ?? {}) as { tagIds?: string[]; search?: string };
        // If the segment lives under a different brand, force-switch the brand
        // FIRST and arm the brand-reset guard so the reset effect doesn't wipe
        // the segment + tag state we apply below. We read the CURRENT active
        // brand from the ref to avoid stale-closure bugs.
        if (seg.brandId && activeBrandIdRef.current !== seg.brandId) {
          skipNextBrandResetRef.current = true;
          setActiveBrand(seg.brandId);
        }
        loadedSegmentRef.current = urlSegmentId;
        setSegmentId(urlSegmentId);
        setTagFilterIds(Array.isArray(f.tagIds) ? f.tagIds : []);
        setSearchTerm(typeof f.search === "string" ? f.search : "");
      } catch {
        if (!cancelled) toast({ title: "Failed to load segment", variant: "destructive" });
      }
    })();
    return () => { cancelled = true; };
    
  }, [urlSegmentId, flagOn, brands]);

  // Sprint 2e: canonicalise the URL whenever segmentId or filter state changes
  // so that `/marketing/contacts?segmentId=X` always carries `tagIds` + `search`
  // alongside it, and direct edits to filter state drop a stale segmentId.
  useEffect(() => {
    if (!flagOn) return;
    const sp = new URLSearchParams();
    if (clientIdFilter) sp.set("clientId", clientIdFilter);
    if (segmentId)      sp.set("segmentId", segmentId);
    if (tagFilterIds.length > 0) sp.set("tagIds", tagFilterIds.join(","));
    if (searchTerm.trim())       sp.set("search", searchTerm.trim());
    const qs = sp.toString();
    const target = `/marketing/contacts${qs ? `?${qs}` : ""}`;
    if (typeof window !== "undefined") {
      const current = window.location.pathname + window.location.search;
      if (current !== target) setLocation(target, { replace: true });
    }
    
  }, [segmentId, tagFilterIds, searchTerm, clientIdFilter, flagOn]);

  // Sprint 2e: any direct mutation of the filter from the UI must drop the
  // segmentId (the audience no longer matches the saved one). The setters
  // below wrap the raw state setters to centralise this rule.
  const onSearchTermChange = (v: string) => {
    if (segmentId) setSegmentId(null);
    setSearchTerm(v);
  };
  const onTagFilterIdsChange = (next: string[]) => {
    if (segmentId) setSegmentId(null);
    setTagFilterIds(next);
  };

  // Sprint 2d: load brand tags for the filter chip-row + bulk picker.
  const { data: brandTags = [] } = useQuery<TagWithCounts[]>({
    queryKey: ["/api/marketing/tags", brandId],
    enabled: flagOn && !!brandId,
    queryFn: async () => {
      const res = await fetch(`/api/marketing/tags?brandId=${encodeURIComponent(brandId!)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  const { data: contacts = [], isLoading } = useQuery<ContactWithTags[]>({
    queryKey: [
      "/api/marketing/contacts",
      brandId,
      lifecycleStage,
      leadStatus,
      sourceFilter,
      searchTerm,
      clientIdFilter,
      tagFilterIds.join(","),
      pages,
    ],
    enabled: flagOn,
    queryFn: async () => {
      const sp = new URLSearchParams();
      if (brandId)                       sp.set("brandId", brandId);
      if (lifecycleStage && lifecycleStage !== "all") sp.set("lifecycleStage", lifecycleStage);
      if (leadStatus && leadStatus !== "all")         sp.set("leadStatus", leadStatus);
      if (sourceFilter.trim())            sp.set("source", sourceFilter.trim());
      if (searchTerm.trim())              sp.set("search", searchTerm.trim());
      if (clientIdFilter)                 sp.set("clientId", clientIdFilter);
      if (tagFilterIds.length > 0)        sp.set("tagIds", tagFilterIds.join(","));
      sp.set("limit", String(PAGE_SIZE * pages));
      const res = await fetch(`/api/marketing/contacts?${sp.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  const hasMore = contacts.length === PAGE_SIZE * pages;

  const allSelected = contacts.length > 0 && selected.size === contacts.length;
  const someSelected = selected.size > 0 && !allSelected;

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(contacts.map((c) => c.id)));
  };
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const clearFilters = () => {
    if (segmentId) setSegmentId(null);
    setSearchTerm("");
    setLifecycleStage("all");
    setLeadStatus("all");
    setTagFilterIds([]);
  };

  const toggleTagFilter = (id: string) => {
    if (segmentId) setSegmentId(null);
    setTagFilterIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const bulkTag = async (op: "assign" | "unassign", tagIds: string[]) => {
    if (selected.size === 0 || tagIds.length === 0 || !brandId) return;
    try {
      await apiRequest("POST", "/api/marketing/prospects/bulk-tag", {
        prospectIds: Array.from(selected),
        tagIds,
        brandId,
        op,
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/marketing/contacts"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/marketing/tags"] });
      toast({
        title: op === "assign"
          ? `Tagged ${selected.size} contact(s)`
          : `Untagged ${selected.size} contact(s)`,
      });
      setSelected(new Set());
    } catch (e: unknown) {
      toast({ title: "Bulk tag failed", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  };

  const bulkUpdate = async (patch: Record<string, any>, label: string) => {
    if (selected.size === 0) return;
    try {
      await apiRequest("POST", "/api/marketing/contacts/bulk-update", {
        ids: Array.from(selected),
        patch,
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/marketing/contacts"] });
      // A bulk patch can soft-delete contacts (deletedAt), which moves the
      // brand card's contactCount chip — refresh it.
      await queryClient.invalidateQueries({ queryKey: ["/api/brands"] });
      toast({ title: `Updated ${selected.size} contact(s): ${label}` });
      setSelected(new Set());
    } catch (e: unknown) {
      toast({ title: "Bulk update failed", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  };

  // ── flag-off / no-brand guards ────────────────────────────────────────
  if (!flagOn) {
    return (
      <div className="p-10 text-center text-sm" style={{ color: "var(--lux-text-muted)" }} data-testid="status-flag-off">
        Marketing is available on the Business plan. Upgrade anytime from Settings → Plan.
      </div>
    );
  }

  if (brands && brands.length === 0) {
    return (
      <div className="px-6 lg:px-8 xl:px-10 py-6 max-w-3xl mx-auto">
        <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
          <CardContent className="p-12 text-center" data-testid="empty-state-no-brands">
            <Users className="w-10 h-10 mx-auto mb-4" style={{ color: "var(--lux-text-muted)" }} />
            <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>
              Create a brand first
            </h2>
            <p className="text-sm mb-6" style={{ color: "var(--lux-text-muted)" }}>
              Contacts are organized by brand. You'll need to create at least one brand before adding contacts.
            </p>
            <Button asChild data-testid="link-create-brand">
              <Link href="/settings/brands">Go to Brands</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Sprint 2a contract: require an active brand. We do NOT show "All brands"
  // because contacts are partitioned by brand and surfacing them all would
  // make tag-picking, sequence-targeting, and analytics ambiguous.
  if (brands && brands.length > 0 && !activeBrand) {
    return (
      <div className="px-6 lg:px-8 xl:px-10 py-6 max-w-3xl mx-auto">
        <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
          <CardContent className="p-12 text-center" data-testid="empty-state-select-brand">
            <Users className="w-10 h-10 mx-auto mb-4" style={{ color: "var(--lux-text-muted)" }} />
            <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>
              Select a brand to view contacts
            </h2>
            <p className="text-sm mb-6" style={{ color: "var(--lux-text-muted)" }}>
              Use the brand picker in the top bar to choose which brand's contacts to view.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {brands.map((b) => (
                <Button
                  key={b.id}
                  variant="outline"
                  onClick={() => setActiveBrand(b.id)}
                  data-testid={`button-pick-brand-${b.id}`}
                >
                  {b.name}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="px-6 lg:px-8 xl:px-10 py-6 max-w-7xl mx-auto">
      <MarketingOsTabs />
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--lux-text)" }} data-testid="text-page-title">
            Contacts
          </h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <BrandBadge />
            {clientIdFilter && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs"
                style={{ background: "var(--lux-bg)", border: "1px solid var(--lux-border)" }}
                data-testid="chip-client-filter"
              >
                Filtered by client
                <Link
                  href="/marketing/contacts"
                  className="hover:opacity-80"
                  data-testid="button-clear-client-filter"
                >
                  <X className="w-3 h-3" />
                </Link>
              </span>
            )}
            {segmentId && (
              <SegmentLoadedChip
                segmentId={segmentId}
                onClear={() => setSegmentId(null)}
              />
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/marketing/contacts/import">
            <Button variant="outline" data-testid="button-import-csv">
              <Upload className="w-4 h-4 mr-1.5" />
              Import CSV
            </Button>
          </Link>
          <AddContactButton brandId={brandId} brands={brands ?? []} />
        </div>
      </div>

      {showSaveDialog && brandId && (
        <SaveAsSegmentDialog
          brandId={brandId}
          tagIds={tagFilterIds}
          search={searchTerm}
          onClose={() => setShowSaveDialog(false)}
          onSaved={(id) => { setSegmentId(id); setShowSaveDialog(false); }}
        />
      )}

      {/* Filters */}
      <Card className="border-0 mb-4" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <Label htmlFor="contacts-search">Search</Label>
            <div className="relative">
              <Search
                className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2"
                style={{ color: "var(--lux-text-muted)" }}
              />
              <Input
                id="contacts-search"
                placeholder="Name, email, company…"
                value={searchTerm}
                onChange={(e) => onSearchTermChange(e.target.value)}
                className="pl-9"
                data-testid="input-search-contacts"
              />
            </div>
          </div>

          {/*
            Sprint 2f.1: editable Brand <Select> retired here. The global
            topbar BrandSwitcher is the single source of truth for the
            active brand on every marketing list page (Redline R4 / R5).
            Bulk actions still source brandId from useBrand() above.
          */}

          <div className="min-w-[160px]">
            <Label>Lifecycle</Label>
            <Select value={lifecycleStage} onValueChange={setLifecycleStage}>
              <SelectTrigger data-testid="select-lifecycle"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All stages</SelectItem>
                {LIFECYCLE_STAGES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-[160px]">
            <Label>Lead Status</Label>
            <Select value={leadStatus} onValueChange={setLeadStatus}>
              <SelectTrigger data-testid="select-lead-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {LEAD_STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {(searchTerm || tagFilterIds.length > 0) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSaveDialog(true)}
              disabled={!brandId}
              data-testid="button-save-as-segment"
              className="self-end mb-1"
            >
              <Bookmark className="w-3.5 h-3.5 mr-1" />
              {segmentId ? "Save as new segment" : "Save as segment"}
            </Button>
          )}
          {(searchTerm || lifecycleStage !== "all" || leadStatus !== "all" || tagFilterIds.length > 0) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              data-testid="button-clear-filters"
              className="self-end mb-1"
            >
              <X className="w-3.5 h-3.5 mr-1" />
              Clear
            </Button>
          )}
        </CardContent>
        {brandTags.length > 0 && (
          <CardContent
            className="px-4 pb-4 pt-0 flex flex-wrap items-center gap-2"
            data-testid="row-tag-filter-chips"
          >
            <span
              className="text-xs uppercase tracking-wider mr-1"
              style={{ color: "var(--lux-text-muted)" }}
            >
              Tags:
            </span>
            {brandTags.map((t) => {
              const active = tagFilterIds.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleTagFilter(t.id)}
                  className="text-[11px] px-2 py-0.5 rounded transition-opacity"
                  style={{
                    background: active ? t.color : "transparent",
                    color: active ? "#fff" : "var(--lux-text)",
                    border: `1px solid ${active ? t.color : "var(--lux-border)"}`,
                    opacity: active ? 1 : 0.85,
                  }}
                  data-testid={`chip-tag-filter-${t.id}`}
                  aria-pressed={active}
                >
                  {t.name}
                  <span
                    className="ml-1 text-[10px] opacity-80"
                    data-testid={`chip-tag-count-${t.id}`}
                  >
                    ({t.contactCount})
                  </span>
                </button>
              );
            })}
            {tagFilterIds.length > 0 && (
              <button
                type="button"
                onClick={() => onTagFilterIdsChange([])}
                className="text-[11px] underline ml-1"
                style={{ color: "var(--lux-text-muted)" }}
                data-testid="button-clear-tag-filters"
              >
                clear tag filters
              </button>
            )}
          </CardContent>
        )}
      </Card>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <Card
          className="border-0 mb-3 sticky top-2 z-10"
          style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}
          data-testid="bar-bulk-actions"
        >
          <CardContent className="p-3 flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium" style={{ color: "var(--lux-text)" }} data-testid="text-bulk-count">
              {selected.size} selected
            </span>
            <Select onValueChange={(v) => bulkUpdate({ lifecycleStage: v }, `stage → ${v}`)}>
              <SelectTrigger className="w-[180px]" data-testid="select-bulk-lifecycle">
                <SelectValue placeholder="Set lifecycle…" />
              </SelectTrigger>
              <SelectContent>
                {LIFECYCLE_STAGES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select onValueChange={(v) => bulkUpdate({ leadStatus: v }, `status → ${v}`)}>
              <SelectTrigger className="w-[180px]" data-testid="select-bulk-lead-status">
                <SelectValue placeholder="Set lead status…" />
              </SelectTrigger>
              <SelectContent>
                {LEAD_STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => bulkUpdate({ unsubscribedAt: new Date().toISOString() }, "marked unsubscribed")}
              data-testid="button-bulk-unsubscribe"
            >
              Mark unsubscribed
            </Button>
            <BulkTagPicker
              mode="assign"
              tags={brandTags}
              disabled={!brandId || brandTags.length === 0}
              onApply={(ids) => bulkTag("assign", ids)}
            />
            <BulkTagPicker
              mode="unassign"
              tags={brandTags}
              disabled={!brandId || brandTags.length === 0}
              onApply={(ids) => bulkTag("unassign", ids)}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelected(new Set())}
              data-testid="button-bulk-clear"
              className="ml-auto"
            >
              Clear selection
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
        <CardContent className="p-0 overflow-x-auto">
          {isLoading ? (
            <div className="p-8 text-sm" style={{ color: "var(--lux-text-muted)" }} data-testid="status-loading">
              Loading contacts…
            </div>
          ) : contacts.length === 0 ? (
            <div className="text-center py-16" data-testid="empty-state-contacts">
              <Users className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--lux-text-muted)" }} />
              <p className="text-base mb-1" style={{ color: "var(--lux-text)" }}>No contacts yet</p>
              <p className="text-sm" style={{ color: "var(--lux-text-muted)" }}>
                Add a contact to get started.
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead style={{ borderBottom: "1px solid var(--lux-border)" }}>
                <tr>
                  <th className="px-4 py-2 w-10">
                    <Checkbox
                      checked={allSelected || (someSelected && "indeterminate")}
                      onCheckedChange={toggleAll}
                      data-testid="checkbox-select-all"
                    />
                  </th>
                  <th className="px-4 py-2 text-left font-medium" style={{ color: "var(--lux-text-muted)" }}>Name</th>
                  <th className="px-4 py-2 text-left font-medium" style={{ color: "var(--lux-text-muted)" }}>Email</th>
                  <th className="px-4 py-2 text-left font-medium" style={{ color: "var(--lux-text-muted)" }}>Company</th>
                  <th className="px-4 py-2 text-left font-medium" style={{ color: "var(--lux-text-muted)" }}>Lifecycle</th>
                  <th className="px-4 py-2 text-left font-medium" style={{ color: "var(--lux-text-muted)" }}>Status</th>
                  <th className="px-4 py-2 text-left font-medium" style={{ color: "var(--lux-text-muted)" }}>Tags</th>
                  <th className="px-4 py-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => {
                  // Sprint 2o.0: /api/marketing/contacts is a compat shim
                  // over marketing_prospects (HR4 split). The shim returns
                  // raw prospect rows with no tags join — defend against
                  // missing fields so the row renders instead of crashing
                  // the page via the error boundary.
                  const tags = c.tags ?? [];
                  return (
                  <tr
                    key={c.id}
                    className="hover:bg-[var(--lux-bg)] transition-colors"
                    style={{ borderBottom: "1px solid var(--lux-border)" }}
                    data-testid={`row-contact-${c.id}`}
                  >
                    <td className="px-4 py-2">
                      <Checkbox
                        checked={selected.has(c.id)}
                        onCheckedChange={() => toggleOne(c.id)}
                        data-testid={`checkbox-contact-${c.id}`}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <span className="inline-flex items-center gap-2">
                        <FreshnessDot lastActivityAt={c.lastActivityAt ?? null} />
                        <Link
                          href={`/marketing/contacts/${c.id}`}
                          className="font-medium hover:underline"
                          style={{ color: "var(--lux-text)" }}
                          data-testid={`link-contact-name-${c.id}`}
                        >
                          {fullName(c)}
                        </Link>
                      </span>
                      {c.unsubscribedAt && (
                        <span
                          className="ml-2 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded inline-flex items-center gap-1"
                          style={{ background: "var(--lux-border)", color: "var(--lux-text-muted)" }}
                          data-testid={`badge-unsubscribed-${c.id}`}
                        >
                          Unsub
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2" style={{ color: "var(--lux-text-muted)" }} data-testid={`text-email-${c.id}`}>
                      {c.email || "—"}
                    </td>
                    <td className="px-4 py-2" style={{ color: "var(--lux-text-muted)" }} data-testid={`text-company-${c.id}`}>
                      {c.companyName || "—"}
                    </td>
                    <td className="px-4 py-2" data-testid={`text-lifecycle-${c.id}`}>
                      {c.lifecycleStage && RIBBON_STAGES.has(c.lifecycleStage as LifecycleStage) ? (
                        <StatusRibbon stage={c.lifecycleStage as LifecycleStage} />
                      ) : (
                        <span style={{ color: "var(--lux-text-muted)" }}>
                          {LIFECYCLE_STAGES.find((s) => s.value === c.lifecycleStage)?.label ?? c.lifecycleStage ?? "—"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2" style={{ color: "var(--lux-text-muted)" }} data-testid={`text-lead-status-${c.id}`}>
                      {LEAD_STATUSES.find((s) => s.value === c.leadStatus)?.label ?? c.leadStatus ?? "—"}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1">
                        {tags.length === 0 ? (
                          <span style={{ color: "var(--lux-text-muted)" }}>—</span>
                        ) : (
                          tags.slice(0, 3).map((t) => (
                            <span
                              key={t.id}
                              className="text-[10px] px-1.5 py-0.5 rounded text-white"
                              style={{ background: t.color }}
                              data-testid={`tag-${c.id}-${t.id}`}
                            >
                              {t.name}
                            </span>
                          ))
                        )}
                        {tags.length > 3 && (
                          <span className="text-[10px]" style={{ color: "var(--lux-text-muted)" }}>+{tags.length - 3}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <Link href={`/marketing/contacts/${c.id}`} data-testid={`link-contact-detail-${c.id}`}>
                        <ChevronRight className="w-4 h-4" style={{ color: "var(--lux-text-muted)" }} />
                      </Link>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// AddContactButton + Dialog
// ─────────────────────────────────────────────────────────────────────────
function AddContactButton({ brandId, brands }: { brandId: string | null; brands: Brand[] }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Sprint 2f.2 (Task #72): the create dialog defaults-and-locks to the
  // currently active brand. This mirrors the read-only brand chip on the
  // list filters and prevents users from silently creating a record under
  // a brand they aren't viewing (which would then "disappear" from the
  // list). To create under a different brand, switch brands via the
  // BrandSwitcher first.
  const [form, setForm] = useState({
    firstName: "", lastName: "", email: "", companyName: "", title: "",
    brandId: brandId ?? (brands[0]?.id ?? ""),
  });

  useEffect(() => {
    setForm((f) => ({ ...f, brandId: brandId ?? (brands[0]?.id ?? "") }));
  }, [brandId, brands]);

  const activeBrand = brands.find((b) => b.id === (brandId ?? form.brandId)) ?? null;

  const submit = async () => {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      toast({ title: "First and last name are required", variant: "destructive" });
      return;
    }
    if (!form.brandId) {
      toast({ title: "Select a brand", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      await apiRequest("POST", "/api/marketing/contacts", {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim() || null,
        companyName: form.companyName.trim() || null,
        title: form.title.trim() || null,
        brandId: form.brandId,
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/marketing/contacts"] });
      // Brand cards show a contactCount chip — keep it fresh.
      await queryClient.invalidateQueries({ queryKey: ["/api/brands"] });
      toast({ title: "Contact created" });
      setForm({ firstName: "", lastName: "", email: "", companyName: "", title: "", brandId: form.brandId });
      setOpen(false);
    } catch (e: unknown) {
      toast({ title: "Failed to create contact", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button onClick={() => setOpen(true)} data-testid="button-add-contact">
        <Plus className="w-4 h-4 mr-1.5" />
        Add Contact
      </Button>
      <PremiumDialog
        open={open}
        onOpenChange={setOpen}
        icon={<UserPlus className="w-5 h-5" />}
        title="Add Contact"
        subtitle="Create a new marketing contact. Required: name + brand."
        className="max-w-2xl"
      >
        <div data-testid="dialog-add-contact" className="grid grid-cols-2 gap-3">
            {brands.length > 1 && (
              <div className="col-span-2">
                <Label>Brand *</Label>
                {brandId ? (
                  <div
                    className="flex items-center justify-between rounded-md px-3 py-2 text-sm"
                    style={{ background: "var(--lux-bg)", border: "1px solid var(--lux-border)" }}
                    data-testid="display-add-brand"
                  >
                    <span>{activeBrand?.name ?? "Active brand"}</span>
                    <span className="text-xs opacity-70">Locked to active brand</span>
                  </div>
                ) : (
                  <Select value={form.brandId} onValueChange={(v) => setForm({ ...form, brandId: v })}>
                    <SelectTrigger data-testid="select-add-brand"><SelectValue placeholder="Select a brand" /></SelectTrigger>
                    <SelectContent>
                      {brands.map((b) => (
                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
            <div>
              <Label htmlFor="add-fn">First Name *</Label>
              <Input id="add-fn" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} data-testid="input-add-firstName" />
            </div>
            <div>
              <Label htmlFor="add-ln">Last Name *</Label>
              <Input id="add-ln" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} data-testid="input-add-lastName" />
            </div>
            <div className="col-span-2">
              <Label htmlFor="add-email">Email</Label>
              <Input id="add-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="input-add-email" />
            </div>
            <div>
              <Label htmlFor="add-co">Company</Label>
              <Input id="add-co" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} data-testid="input-add-companyName" />
            </div>
            <div>
              <Label htmlFor="add-title">Title</Label>
              <Input id="add-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="input-add-title" />
            </div>
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t" style={{ borderColor: "var(--lux-border)" }}>
          <Button variant="outline" onClick={() => setOpen(false)} data-testid="button-cancel-add-contact">Cancel</Button>
          <Button onClick={submit} disabled={busy} data-testid="button-submit-add-contact">
            {busy ? "Creating…" : "Create Contact"}
          </Button>
        </div>
      </PremiumDialog>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Sprint 2e — Segment chip (shown when a saved segment is loaded). Clicking
// the X clears `segmentId` only, leaving the underlying filter state intact
// so the user can keep iterating on top of the segment's filter.
// ─────────────────────────────────────────────────────────────────────────
function SegmentLoadedChip({ segmentId, onClear }: { segmentId: string; onClear: () => void }) {
  const { data: seg } = useQuery<SegmentWithCount>({
    queryKey: ["/api/marketing/segments", "single", segmentId],
    queryFn: async () => {
      const res = await fetch(`/api/marketing/segments/${segmentId}`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });
  return (
    <span
      className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs"
      style={{ background: "var(--lux-bg)", border: "1px solid var(--lux-border)" }}
      data-testid="chip-segment-loaded"
    >
      <Layers className="w-3 h-3" />
      Loaded segment: {seg?.name ?? "…"}
      <button
        type="button"
        onClick={onClear}
        className="hover:opacity-80"
        data-testid="button-clear-segment"
        aria-label="Clear segment"
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Sprint 2e — Save-as-Segment dialog. Always POSTs a NEW segment record;
// it never updates an existing one (per v2 redline). Validates trim/max(80)
// and surfaces server errors verbatim (e.g., cross-brand tag refs).
// ─────────────────────────────────────────────────────────────────────────
function SaveAsSegmentDialog({
  brandId, tagIds, search, onClose, onSaved,
}: {
  brandId: string;
  tagIds: string[];
  search: string;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const trimmed = name.trim();

  const submit = async () => {
    if (!trimmed) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    if (trimmed.length > 80) {
      toast({ title: "Name must be 80 characters or fewer", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const res = await apiRequest("POST", "/api/marketing/segments", {
        brandId,
        name: trimmed,
        filter: { tagIds, search: search.trim() },
      });
      const created = (await res.json()) as ContactSegment;
      await queryClient.invalidateQueries({ queryKey: ["/api/marketing/segments"] });
      toast({ title: "Segment saved" });
      onSaved(created.id);
    } catch (e: unknown) {
      toast({
        title: "Failed to save segment",
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <PremiumDialog
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      icon={<BookmarkPlus className="w-5 h-5" />}
      title="Save as Segment"
      subtitle="Save the current tag filter and search text as a reusable segment for this brand."
      className="max-w-xl"
    >
      <div data-testid="dialog-save-as-segment" className="space-y-3">
          <div>
            <Label htmlFor="save-segment-name">Name *</Label>
            <Input
              id="save-segment-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              autoFocus
              data-testid="input-save-segment-name"
              placeholder="e.g. Hot leads in Q2"
            />
          </div>
          <div className="text-xs" style={{ color: "var(--lux-text-muted)" }} data-testid="text-save-segment-summary">
            <div>Tags: {tagIds.length === 0 ? "none" : `${tagIds.length} selected`}</div>
            <div>Search: {search.trim() ? `“${search.trim()}”` : "none"}</div>
          </div>
      </div>
      <div className="flex justify-end gap-2 pt-2 border-t" style={{ borderColor: "var(--lux-border)" }}>
        <Button variant="outline" onClick={onClose} data-testid="button-cancel-save-segment">Cancel</Button>
        <Button onClick={submit} disabled={busy} data-testid="button-submit-save-segment">
          {busy ? "Saving…" : "Save Segment"}
        </Button>
      </div>
    </PremiumDialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Sprint 2d — Bulk Tag/Untag picker (popover with multi-select + apply)
// ─────────────────────────────────────────────────────────────────────────
function BulkTagPicker({
  mode, tags, disabled, onApply,
}: {
  mode: "assign" | "unassign";
  tags: TagWithCounts[];
  disabled: boolean;
  onApply: (tagIds: string[]) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);

  // Reset selection when popover closes.
  useEffect(() => { if (!open) setPicked([]); }, [open]);

  const toggle = (id: string) => {
    setPicked((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const apply = async () => {
    await onApply(picked);
    setOpen(false);
  };

  const triggerLabel = mode === "assign" ? "Tag" : "Untag";
  const triggerTestId = mode === "assign" ? "button-bulk-tag" : "button-bulk-untag";
  const applyLabel    = mode === "assign" ? "Apply Tag(s)" : "Remove Tag(s)";
  const applyTestId   = mode === "assign" ? "button-bulk-tag-apply" : "button-bulk-untag-apply";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          data-testid={triggerTestId}
        >
          <TagIcon className="w-3.5 h-3.5 mr-1.5" />
          {triggerLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="start">
        {tags.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--lux-text-muted)" }} data-testid="text-bulk-no-tags">
            No tags exist for this brand. Create one on the Tags page first.
          </p>
        ) : (
          <>
            <p className="text-xs uppercase tracking-wider mb-2" style={{ color: "var(--lux-text-muted)" }}>
              Pick tag(s) to {mode === "assign" ? "add" : "remove"}
            </p>
            <div className="max-h-56 overflow-y-auto space-y-1">
              {tags.map((t) => {
                const checked = picked.includes(t.id);
                return (
                  <label
                    key={t.id}
                    className="flex items-center gap-2 px-2 py-1 rounded hover:bg-[var(--lux-bg)] cursor-pointer"
                    data-testid={`row-bulk-${mode}-${t.id}`}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggle(t.id)}
                      data-testid={`checkbox-bulk-${mode}-${t.id}`}
                    />
                    <span
                      className="inline-block w-3 h-3 rounded"
                      style={{ background: t.color, border: "1px solid var(--lux-border)" }}
                    />
                    <span className="text-sm flex-1" style={{ color: "var(--lux-text)" }}>{t.name}</span>
                    <span className="text-[10px]" style={{ color: "var(--lux-text-muted)" }}>{t.contactCount}</span>
                  </label>
                );
              })}
            </div>
            <Button
              size="sm"
              onClick={apply}
              disabled={picked.length === 0}
              data-testid={applyTestId}
              className="w-full mt-3"
              variant={mode === "assign" ? "default" : "outline"}
            >
              {applyLabel}
            </Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
