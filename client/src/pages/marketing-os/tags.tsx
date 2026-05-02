/**
 * Sprint 2d — Marketing OS Tags management page (/marketing/tags).
 *
 * Brand-scoped via BrandContext (mirrors contacts.tsx + companies.tsx
 * empty-state + brand-pick patterns). Lists tags for the active brand
 * with name, color swatch, contact count and last-used timestamp;
 * supports create / rename / recolor / delete via the shared dialog
 * and an AlertDialog for destructive deletes.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Plus, Tag as TagIcon, Pencil, Trash2,
} from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useBrand } from "@/hooks/useBrand";
import { isMarketingOsEnabled } from "@/lib/featureFlags";
import { Card, CardContent } from "@/components/ui/card";
import { PremiumDialog } from "@/components/marketing-os/premium/premium-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { ContactTag } from "@shared/schema";
import { MARKETING_TAG_COLORS, DEFAULT_TAG_COLOR } from "@/lib/marketing-colors";
import { MarketingOsTabs } from "@/components/marketing-os/marketing-os-tabs";
import { BrandBadge } from "@/components/marketing-os/brand-badge";

type TagWithCounts = ContactTag & { contactCount: number; lastUsedAt: string | null };

function fmtLastUsed(iso: string | null): string {
  if (!iso) return "Never";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "Never";
  }
}

export default function TagsListPage() {
  const flagOn = isMarketingOsEnabled();
  const { activeBrand, brands, setActiveBrand } = useBrand();
  const brandId = activeBrand?.id ?? null;

  const { data: tags = [], isLoading } = useQuery<TagWithCounts[]>({
    queryKey: ["/api/marketing/tags", brandId],
    enabled: flagOn && !!brandId,
    queryFn: async () => {
      const sp = new URLSearchParams({ brandId: brandId! });
      const res = await fetch(`/api/marketing/tags?${sp}`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  const [editing, setEditing]   = useState<TagWithCounts | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<TagWithCounts | null>(null);

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
            <TagIcon className="w-10 h-10 mx-auto mb-4" style={{ color: "var(--lux-text-muted)" }} />
            <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>Create a brand first</h2>
            <p className="text-sm mb-6" style={{ color: "var(--lux-text-muted)" }}>
              Tags are organized by brand. Create at least one brand before managing tags.
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
            <TagIcon className="w-10 h-10 mx-auto mb-4" style={{ color: "var(--lux-text-muted)" }} />
            <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>Select a brand to view tags</h2>
            <p className="text-sm mb-6" style={{ color: "var(--lux-text-muted)" }}>
              Use the brand picker in the top bar to choose which brand's tags to manage.
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
            Tags
          </h1>
          <div className="mt-1">
            <BrandBadge />
          </div>
        </div>
        <Button onClick={() => setCreating(true)} data-testid="button-new-tag">
          <Plus className="w-4 h-4 mr-1.5" />
          New Tag
        </Button>
      </div>

      <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
        <CardContent className="p-0 overflow-x-auto">
          {isLoading ? (
            <div className="p-8 text-sm" style={{ color: "var(--lux-text-muted)" }} data-testid="status-loading">Loading tags…</div>
          ) : tags.length === 0 ? (
            <div className="text-center py-16" data-testid="empty-state-tags">
              <TagIcon className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--lux-text-muted)" }} />
              <p className="text-base mb-1" style={{ color: "var(--lux-text)" }}>No tags yet</p>
              <p className="text-sm" style={{ color: "var(--lux-text-muted)" }}>
                Create your first tag to start segmenting contacts.
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead style={{ borderBottom: "1px solid var(--lux-border)" }}>
                <tr>
                  <th className="px-4 py-2 text-left font-medium" style={{ color: "var(--lux-text-muted)" }}>Name</th>
                  <th className="px-4 py-2 text-left font-medium" style={{ color: "var(--lux-text-muted)" }}>Color</th>
                  <th className="px-4 py-2 text-right font-medium" style={{ color: "var(--lux-text-muted)" }}>Contacts</th>
                  <th className="px-4 py-2 text-left font-medium" style={{ color: "var(--lux-text-muted)" }}>Last Used</th>
                  <th className="px-4 py-2 w-32 text-right font-medium" style={{ color: "var(--lux-text-muted)" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {tags.map((t) => (
                  <tr key={t.id} className="hover:bg-[var(--lux-bg)] transition-colors" style={{ borderBottom: "1px solid var(--lux-border)" }} data-testid={`row-tag-${t.id}`}>
                    <td className="px-4 py-2">
                      <span className="font-medium" style={{ color: "var(--lux-text)" }} data-testid={`text-tag-name-${t.id}`}>
                        {t.name}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block w-4 h-4 rounded"
                          style={{ background: t.color, border: "1px solid var(--lux-border)" }}
                          data-testid={`swatch-tag-${t.id}`}
                        />
                        <span className="text-xs uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>
                          {t.color}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right" style={{ color: "var(--lux-text)" }} data-testid={`text-tag-count-${t.id}`}>
                      {t.contactCount}
                    </td>
                    <td className="px-4 py-2" style={{ color: "var(--lux-text-muted)" }} data-testid={`text-tag-last-used-${t.id}`}>
                      {fmtLastUsed(t.lastUsedAt)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="inline-flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditing(t)}
                          data-testid={`button-edit-tag-${t.id}`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDeleting(t)}
                          data-testid={`button-delete-tag-${t.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" style={{ color: "var(--mc-red)" }} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {creating && brandId && (
        <TagFormDialog
          mode="create"
          brandId={brandId}
          existing={tags}
          onClose={() => setCreating(false)}
        />
      )}
      {editing && brandId && (
        <TagFormDialog
          mode="edit"
          brandId={brandId}
          tag={editing}
          existing={tags}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <DeleteTagDialog
          tag={deleting}
          brandId={brandId}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Shared create/edit dialog
// ─────────────────────────────────────────────────────────────────────────
function TagFormDialog({
  mode, brandId, tag, existing, onClose,
}: {
  mode: "create" | "edit";
  brandId: string;
  tag?: TagWithCounts;
  existing: TagWithCounts[];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [name, setName]   = useState(tag?.name ?? "");
  const [color, setColor] = useState(tag?.color ?? DEFAULT_TAG_COLOR);
  const [busy, setBusy]   = useState(false);

  const trimmed = name.trim();
  const dupeName = useMemo(() => !!trimmed && existing.some(
    (t) => t.id !== tag?.id && t.name.toLowerCase() === trimmed.toLowerCase(),
  ), [trimmed, existing, tag?.id]);

  const submit = async () => {
    if (!trimmed) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    if (dupeName) {
      toast({ title: "A tag with that name already exists", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      if (mode === "create") {
        await apiRequest("POST", "/api/marketing/tags", { brandId, name: trimmed, color });
      } else if (tag) {
        await apiRequest("PATCH", `/api/marketing/tags/${tag.id}`, { name: trimmed, color });
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/marketing/tags"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/marketing/contacts"] });
      toast({ title: mode === "create" ? "Tag created" : "Tag updated" });
      onClose();
    } catch (e: unknown) {
      toast({
        title: mode === "create" ? "Failed to create tag" : "Failed to update tag",
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
      icon={<TagIcon className="w-5 h-5" />}
      title={mode === "create" ? "New Tag" : "Edit Tag"}
      subtitle={mode === "create"
        ? "Tags help you segment marketing contacts within a brand."
        : "Rename or recolor this tag. Existing assignments are preserved."}
      className="max-w-lg"
    >
      <div data-testid={mode === "create" ? "dialog-create-tag" : "dialog-edit-tag"} className="space-y-4">
          <div>
            <Label htmlFor="tag-name">Name *</Label>
            <Input
              id="tag-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={64}
              data-testid="input-tag-name"
            />
            {dupeName && (
              <p className="text-xs mt-1" style={{ color: "var(--mc-red)" }} data-testid="text-tag-name-dupe">
                A tag with that name already exists in this brand.
              </p>
            )}
          </div>
          <div>
            <Label>Color</Label>
            <div className="grid grid-cols-5 gap-2 mt-1.5">
              {MARKETING_TAG_COLORS.map((s) => (
                <button
                  key={s.hex}
                  type="button"
                  onClick={() => setColor(s.hex)}
                  className="w-9 h-9 rounded transition-transform hover:scale-105"
                  style={{
                    background: s.hex,
                    border: color.toLowerCase() === s.hex.toLowerCase()
                      ? "2px solid var(--lux-text)"
                      : "1px solid var(--lux-border)",
                  }}
                  aria-label={s.label}
                  title={s.label}
                  data-testid={`swatch-pick-${s.hex.toLowerCase().replace("#", "")}`}
                />
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Preview:</span>
            <span
              className="text-[10px] px-1.5 py-0.5 rounded text-white"
              style={{ background: color }}
              data-testid="preview-tag-chip"
            >
              {trimmed || "tag"}
            </span>
          </div>
        </div>
      <div className="flex justify-end gap-2 pt-2 border-t" style={{ borderColor: "var(--lux-border)" }}>
        <Button variant="outline" onClick={onClose} data-testid="button-cancel-tag-form">Cancel</Button>
        <Button onClick={submit} disabled={busy || dupeName} data-testid="button-submit-tag-form">
          {busy ? "Saving…" : mode === "create" ? "Create Tag" : "Save Changes"}
        </Button>
      </div>
    </PremiumDialog>
  );
}

function DeleteTagDialog({
  tag, brandId, onClose,
}: {
  tag: TagWithCounts;
  brandId: string | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    try {
      await apiRequest("DELETE", `/api/marketing/tags/${tag.id}`);
      await queryClient.invalidateQueries({ queryKey: ["/api/marketing/tags", brandId] });
      await queryClient.invalidateQueries({ queryKey: ["/api/marketing/contacts"] });
      toast({ title: "Tag deleted" });
      onClose();
    } catch (e: unknown) {
      toast({ title: "Failed to delete tag", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <AlertDialogContent data-testid="dialog-delete-tag">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete "{tag.name}"?</AlertDialogTitle>
          <AlertDialogDescription>
            {tag.contactCount === 0
              ? "This tag is not assigned to any contacts. It will be permanently removed."
              : `This tag is assigned to ${tag.contactCount} contact${tag.contactCount === 1 ? "" : "s"}. Deleting it will remove the tag from those contacts. Their data is otherwise unchanged.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-cancel-delete-tag">Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); remove(); }}
            disabled={busy}
            data-testid="button-confirm-delete-tag"
            style={{ background: "var(--mc-red)" }}
          >
            {busy ? "Deleting…" : "Delete Tag"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
