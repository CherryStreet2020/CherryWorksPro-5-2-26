/**
 * Sprint 2e — Marketing OS Saved Segments page (/marketing/segments).
 *
 * Brand-scoped via BrandContext (mirrors contacts.tsx + tags.tsx empty-
 * state + brand-pick patterns). Lists segments for the active brand with
 * name, filter summary, computed contactCount and "View" / "Edit" /
 * "Delete" actions. Creates / renames / deletes via shared dialog and
 * an AlertDialog for destructive deletes.
 *
 * "View" links to /marketing/contacts?segmentId={id} which loads the
 * segment's filter state on the contacts page (URL-canonicalised).
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Plus, Layers, Pencil, Trash2, Users, Search as SearchIcon,
} from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useBrand } from "@/hooks/useBrand";
import { isMarketingOsEnabled } from "@/lib/featureFlags";
import { Card, CardContent } from "@/components/ui/card";
import { PremiumDialog } from "@/components/marketing-os/premium/premium-dialog";
import { EmailPreview } from "@/components/marketing-os/premium/email-preview";
import { Layers as LayersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { ContactSegment, ContactTag } from "@shared/schema";
import { MarketingOsTabs } from "@/components/marketing-os/marketing-os-tabs";
import { BrandBadge } from "@/components/marketing-os/brand-badge";

type SegmentFilter = { tagIds: string[]; search: string };
type SegmentWithCount = ContactSegment & { contactCount: number };
type TagWithCounts = ContactTag & { contactCount: number; lastUsedAt: string | null };

function formatRelative(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const t = typeof d === "string" ? new Date(d) : d;
  const ms = Date.now() - t.getTime();
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return t.toLocaleDateString();
}

function readFilter(s: ContactSegment): SegmentFilter {
  const f = (s.filter ?? {}) as Record<string, unknown>;
  return {
    tagIds: Array.isArray(f.tagIds) ? (f.tagIds as string[]) : [],
    search: typeof f.search === "string" ? (f.search as string) : "",
  };
}

export default function SegmentsListPage() {
  const flagOn = isMarketingOsEnabled();
  const { activeBrand, brands, setActiveBrand } = useBrand();
  const brandId = activeBrand?.id ?? null;

  const { data: segments = [], isLoading } = useQuery<SegmentWithCount[]>({
    queryKey: ["/api/marketing/segments", brandId],
    enabled: flagOn && !!brandId,
    queryFn: async () => {
      const sp = new URLSearchParams({ brandId: brandId! });
      const res = await fetch(`/api/marketing/segments?${sp}`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  // Brand tags drive the multi-select inside the create/edit dialog.
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

  const tagsById = useMemo(() => {
    const m = new Map<string, TagWithCounts>();
    for (const t of brandTags) m.set(t.id, t);
    return m;
  }, [brandTags]);

  const [editing, setEditing]   = useState<SegmentWithCount | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<SegmentWithCount | null>(null);

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
            <Layers className="w-10 h-10 mx-auto mb-4" style={{ color: "var(--lux-text-muted)" }} />
            <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>Create a brand first</h2>
            <p className="text-sm mb-6" style={{ color: "var(--lux-text-muted)" }}>
              Segments are organized by brand. Create at least one brand before saving segments.
            </p>
            <Button asChild data-testid="link-create-brand">
              <Link href="/settings/brands">Go to Brands</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (brands && brands.length > 0 && !activeBrand) {
    return (
      <div className="px-6 lg:px-8 xl:px-10 py-6 max-w-3xl mx-auto">
        <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
          <CardContent className="p-12 text-center" data-testid="empty-state-select-brand">
            <Layers className="w-10 h-10 mx-auto mb-4" style={{ color: "var(--lux-text-muted)" }} />
            <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>Select a brand to view segments</h2>
            <p className="text-sm mb-6" style={{ color: "var(--lux-text-muted)" }}>
              Use the brand picker in the top bar to choose which brand's segments to manage.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {brands.map((b) => (
                <Button key={b.id} variant="outline" onClick={() => setActiveBrand(b.id)} data-testid={`button-pick-brand-${b.id}`}>
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

      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--lux-text)" }} data-testid="text-page-title">
            Segments
          </h1>
          <div className="mt-1">
            <BrandBadge />
          </div>
        </div>
        <Button onClick={() => setCreating(true)} data-testid="button-new-segment">
          <Plus className="w-4 h-4 mr-1.5" />
          New Segment
        </Button>
      </div>

      <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
        <CardContent className="p-0 overflow-x-auto">
          {isLoading ? (
            <div className="p-8 text-sm" style={{ color: "var(--lux-text-muted)" }} data-testid="status-loading">Loading segments…</div>
          ) : segments.length === 0 ? (
            <div className="text-center py-16" data-testid="empty-state-segments">
              <Layers className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--lux-text-muted)" }} />
              <p className="text-base mb-1" style={{ color: "var(--lux-text)" }}>No segments yet</p>
              <p className="text-sm mb-4" style={{ color: "var(--lux-text-muted)" }}>
                Save a contact filter as a reusable segment from the Contacts page,
                or create one here directly.
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead style={{ borderBottom: "1px solid var(--lux-border)" }}>
                <tr>
                  <th className="px-4 py-2 text-left font-medium" style={{ color: "var(--lux-text-muted)" }}>Name</th>
                  <th className="px-4 py-2 text-left font-medium" style={{ color: "var(--lux-text-muted)" }}>Filter</th>
                  <th className="px-4 py-2 text-right font-medium" style={{ color: "var(--lux-text-muted)" }}>Contacts</th>
                  <th className="px-4 py-2 text-left font-medium" style={{ color: "var(--lux-text-muted)" }}>Last updated</th>
                  <th className="px-4 py-2 w-44 text-right font-medium" style={{ color: "var(--lux-text-muted)" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {segments.map((s) => {
                  const f = readFilter(s);
                  return (
                    <tr key={s.id} className="hover:bg-[var(--lux-bg)] transition-colors" style={{ borderBottom: "1px solid var(--lux-border)" }} data-testid={`row-segment-${s.id}`}>
                      <td className="px-4 py-2">
                        <span className="font-medium" style={{ color: "var(--lux-text)" }} data-testid={`text-segment-name-${s.id}`}>
                          {s.name}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <FilterSummary filter={f} tagsById={tagsById} segmentId={s.id} />
                      </td>
                      <td className="px-4 py-2 text-right" style={{ color: "var(--lux-text)" }} data-testid={`text-segment-count-${s.id}`}>
                        {s.contactCount}
                      </td>
                      <td className="px-4 py-2" style={{ color: "var(--lux-text-muted)" }} data-testid={`text-segment-updated-${s.id}`}>
                        {formatRelative(s.updatedAt ?? s.createdAt)}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="inline-flex gap-1">
                          <Button
                            asChild
                            size="sm"
                            variant="ghost"
                            data-testid={`button-run-segment-${s.id}`}
                          >
                            <Link href={`/marketing/contacts?segmentId=${s.id}`}>
                              <Users className="w-3.5 h-3.5 mr-1" />
                              Run
                            </Link>
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditing(s)}
                            data-testid={`button-edit-segment-${s.id}`}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDeleting(s)}
                            data-testid={`button-delete-segment-${s.id}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" style={{ color: "var(--mc-red)" }} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {creating && brandId && (
        <SegmentFormDialog
          mode="create"
          brandId={brandId}
          existing={segments}
          brandTags={brandTags}
          onClose={() => setCreating(false)}
        />
      )}
      {editing && brandId && (
        <SegmentFormDialog
          mode="edit"
          brandId={brandId}
          segment={editing}
          existing={segments}
          brandTags={brandTags}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <DeleteSegmentDialog
          segment={deleting}
          brandId={brandId}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Filter summary chip row
// ─────────────────────────────────────────────────────────────────────────
function FilterSummary({
  filter, tagsById, segmentId,
}: {
  filter: SegmentFilter;
  tagsById: Map<string, TagWithCounts>;
  segmentId: string;
}) {
  const tagIds = filter.tagIds ?? [];
  if (tagIds.length === 0 && !filter.search) {
    return (
      <span className="text-xs" style={{ color: "var(--lux-text-muted)" }} data-testid={`text-segment-filter-empty-${segmentId}`}>
        All contacts
      </span>
    );
  }
  // Truncate per spec: at most 3 tag chips with "+N more", search snippet
  // capped at 60 chars (with ellipsis) so the table row stays readable.
  const SEARCH_MAX = 60;
  const TAG_MAX = 3;
  const searchSnippet = filter.search.length > SEARCH_MAX
    ? `${filter.search.slice(0, SEARCH_MAX)}…`
    : filter.search;
  const visibleTags = tagIds.slice(0, TAG_MAX);
  const hiddenCount = Math.max(0, tagIds.length - TAG_MAX);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {filter.search && (
        <span
          className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded"
          style={{ background: "var(--lux-bg)", border: "1px solid var(--lux-border)", color: "var(--lux-text)" }}
          data-testid={`chip-segment-search-${segmentId}`}
          title={filter.search}
        >
          <SearchIcon className="w-3 h-3" />
          “{searchSnippet}”
        </span>
      )}
      {visibleTags.map((id) => {
        const t = tagsById.get(id);
        return (
          <span
            key={id}
            className="text-[10px] px-1.5 py-0.5 rounded text-white"
            style={{ background: t?.color ?? "var(--lux-text-muted)" }}
            data-testid={`chip-segment-tag-${segmentId}-${id}`}
          >
            {t?.name ?? "(unknown)"}
          </span>
        );
      })}
      {hiddenCount > 0 && (
        <span
          className="text-[10px]"
          style={{ color: "var(--lux-text-muted)" }}
          data-testid={`chip-segment-tag-overflow-${segmentId}`}
        >
          +{hiddenCount} more
        </span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Shared create/edit dialog
// ─────────────────────────────────────────────────────────────────────────
function SegmentFormDialog({
  mode, brandId, segment, existing, brandTags, onClose,
}: {
  mode: "create" | "edit";
  brandId: string;
  segment?: SegmentWithCount;
  existing: SegmentWithCount[];
  brandTags: TagWithCounts[];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const initial = segment ? readFilter(segment) : { tagIds: [], search: "" };
  const [name, setName]       = useState(segment?.name ?? "");
  const [search, setSearch]   = useState(initial.search);
  const [tagIds, setTagIds]   = useState<string[]>(initial.tagIds);
  const [busy, setBusy]       = useState(false);

  const trimmed = name.trim();
  const dupeName = useMemo(() => !!trimmed && existing.some(
    (s) => s.id !== segment?.id && s.name.toLowerCase() === trimmed.toLowerCase(),
  ), [trimmed, existing, segment?.id]);

  const toggleTag = (id: string) =>
    setTagIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const submit = async () => {
    if (!trimmed) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    if (trimmed.length > 80) {
      toast({ title: "Name must be 80 characters or fewer", variant: "destructive" });
      return;
    }
    if (dupeName) {
      toast({ title: "A segment with that name already exists", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const filter = { tagIds, search: search.trim() };
      if (mode === "create") {
        await apiRequest("POST", "/api/marketing/segments", { brandId, name: trimmed, filter });
      } else if (segment) {
        await apiRequest("PATCH", `/api/marketing/segments/${segment.id}`, { name: trimmed, filter });
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/marketing/segments"] });
      toast({ title: mode === "create" ? "Segment created" : "Segment updated" });
      onClose();
    } catch (e: unknown) {
      toast({
        title: mode === "create" ? "Failed to create segment" : "Failed to update segment",
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
      icon={<LayersIcon className="w-5 h-5" />}
      title={mode === "create" ? "New Segment" : "Edit Segment"}
      subtitle="Segments save a reusable contact filter you can reapply on the Contacts page."
      preview={
        <EmailPreview
          subject={name.trim() ? `Reaching ${name.trim()}` : "Reaching your saved segment"}
          body={`Members of this segment match: ${
            search.trim() ? `"${search.trim()}"` : "(no search)"
          } across ${tagIds.length} tag${tagIds.length === 1 ? "" : "s"}.`}
          ctaLabel="Open in Contacts"
          fromName="Marketing OS"
          fromEmail="campaigns@cherryworks.app"
        />
      }
    >
      <div data-testid={mode === "create" ? "dialog-create-segment" : "dialog-edit-segment"} className="space-y-4">
          <div>
            <Label htmlFor="segment-name">Name *</Label>
            <Input
              id="segment-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              data-testid="input-segment-name"
            />
            {dupeName && (
              <p className="text-xs mt-1" style={{ color: "var(--mc-red)" }} data-testid="text-segment-name-dupe">
                A segment with that name already exists in this brand.
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="segment-search">Search text</Label>
            <Input
              id="segment-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Match name, email, company, title…"
              maxLength={200}
              data-testid="input-segment-search"
            />
          </div>
          <div>
            <Label>Tags (intersection)</Label>
            {brandTags.length === 0 ? (
              <p className="text-xs mt-1" style={{ color: "var(--lux-text-muted)" }} data-testid="text-segment-no-tags">
                No tags exist for this brand. You can save the segment with a search-only filter.
              </p>
            ) : (
              <div className="max-h-48 overflow-y-auto space-y-1 mt-1.5 border rounded p-2" style={{ borderColor: "var(--lux-border)" }}>
                {brandTags.map((t) => {
                  const checked = tagIds.includes(t.id);
                  return (
                    <label
                      key={t.id}
                      className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-[var(--lux-bg)] cursor-pointer"
                      data-testid={`row-segment-tag-${t.id}`}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleTag(t.id)}
                        data-testid={`checkbox-segment-tag-${t.id}`}
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
            )}
          </div>
      </div>
      <div className="flex justify-end gap-2 pt-2 border-t" style={{ borderColor: "var(--lux-border)" }}>
        <Button variant="outline" onClick={onClose} data-testid="button-cancel-segment-form">Cancel</Button>
        <Button onClick={submit} disabled={busy || dupeName} data-testid="button-submit-segment-form">
          {busy ? "Saving…" : mode === "create" ? "Create Segment" : "Save Changes"}
        </Button>
      </div>
    </PremiumDialog>
  );
}

function DeleteSegmentDialog({
  segment, brandId, onClose,
}: {
  segment: SegmentWithCount;
  brandId: string | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    try {
      await apiRequest("DELETE", `/api/marketing/segments/${segment.id}`);
      await queryClient.invalidateQueries({ queryKey: ["/api/marketing/segments", brandId] });
      toast({ title: "Segment deleted" });
      onClose();
    } catch (e: unknown) {
      toast({ title: "Failed to delete segment", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <AlertDialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <AlertDialogContent data-testid="dialog-delete-segment">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete "{segment.name}"?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the saved filter. Contacts and tags are unchanged.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-cancel-delete-segment">Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); remove(); }}
            disabled={busy}
            data-testid="button-confirm-delete-segment"
            style={{ background: "var(--mc-red)" }}
          >
            {busy ? "Deleting…" : "Delete Segment"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
