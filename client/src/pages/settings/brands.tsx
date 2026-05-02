/**
 * Marketing OS — Sprint 2n: Brands settings page (/settings/brands).
 *
 * Thin orchestrator over the Sprint 2n premium brand components:
 *   - BrandModal      → Add / Edit (premium two-column dialog)
 *   - BrandCard       → premium card row in the grid
 *   - BrandEmptyState → premium empty state
 *
 * All API calls and mutations are preserved verbatim from the previous
 * implementation: same `apiRequest` shape, same `["/api/brands"]` query
 * key, same Delete (soft-archive) AlertDialog flow. The list query
 * returns `BrandWithStats[]` so each card can render real Contacts and
 * Last Sent values.
 *
 * Admin-only at the route level (AdminRoute wrapper in App.tsx).
 */
import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Plus } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useBrand } from "@/hooks/useBrand";
import { isMarketingOsEnabled } from "@/lib/featureFlags";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  BrandModal,
  EMPTY_BRAND_FORM,
  brandToForm,
  type BrandFormState,
} from "@/components/marketing-os/brands/brand-modal";
import { BrandCard } from "@/components/marketing-os/brands/brand-card";
import { BrandEmptyState } from "@/components/marketing-os/brands/brand-empty-state";
import type { Brand, BrandWithStats } from "@shared/schema";

function nullify(s: string): string | null {
  const t = s.trim();
  return t === "" ? null : t;
}

function payloadFromForm(f: BrandFormState) {
  return {
    name: f.name.trim(),
    slug: f.slug.trim(),
    primaryColor: nullify(f.primaryColor),
    domain: nullify(f.domain),
    fromEmail: nullify(f.fromEmail),
    fromName: nullify(f.fromName),
    replyTo: nullify(f.replyTo),
    signatureHtml: nullify(f.signatureHtml),
    logoUrl: nullify(f.logoUrl),
  };
}

export default function BrandsSettingsPage() {
  const { toast } = useToast();
  const { activeBrand, setActiveBrand } = useBrand();

  const flagOn = isMarketingOsEnabled();

  // Stats (`contactCount`, `lastSentAt`) are computed server-side and can
  // change from other pages (contact import, sending an email, logging an
  // email_manual activity). Most of those mutations explicitly invalidate
  // ["/api/brands"], but as a belt-and-braces measure we also opt this
  // query into refetch-on-focus so returning to the tab pulls fresh
  // numbers without a full reload.
  const { data: brands = [], isLoading } = useQuery<BrandWithStats[]>({
    queryKey: ["/api/brands"],
    enabled: flagOn,
    refetchOnWindowFocus: true,
  });

  const [addOpen, setAddOpen] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [addLogoError, setAddLogoError] = useState<string | null>(null);

  const [editing, setEditing] = useState<Brand | null>(null);
  const [editForm, setEditForm] = useState<BrandFormState>(EMPTY_BRAND_FORM);
  const [editBusy, setEditBusy] = useState(false);
  const [editLogoError, setEditLogoError] = useState<string | null>(null);

  // Task #164: server-side logo URL rejections (POST/PATCH /api/brands)
  // come back as `{ message: "Logo URL ..." }` and apiRequest re-throws
  // them as `Error("400: <raw body>")`. Pull the human message back out
  // and, when it's about the logo URL, surface it inline in the
  // dropzone instead of as a generic toast — that way admins know
  // exactly which field the 400 was about.
  const extractServerMessage = (raw: string | undefined | null): string => {
    if (!raw) return "";
    const m = /^\d{3}:\s*(.*)$/s.exec(raw);
    const body = (m ? m[1] : raw).trim();
    if (body.startsWith("{")) {
      try {
        const parsed = JSON.parse(body) as { message?: unknown };
        if (typeof parsed.message === "string") return parsed.message;
      } catch {
        /* fall through */
      }
    }
    return body;
  };
  const isLogoUrlError = (msg: string | undefined | null): boolean =>
    /^Logo URL\b/i.test(extractServerMessage(msg).trim());

  const [deleting, setDeleting] = useState<Brand | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const openAdd = () => {
    setAddLogoError(null);
    setAddOpen(true);
  };

  const openEdit = (b: Brand) => {
    setEditForm(brandToForm(b));
    setEditLogoError(null);
    setEditing(b);
  };

  const submitAdd = async (form: BrandFormState) => {
    if (!form.name.trim() || !form.slug.trim()) {
      toast({ title: "Name and slug are required", variant: "destructive" });
      return;
    }
    setAddBusy(true);
    setAddLogoError(null);
    try {
      await apiRequest("POST", "/api/brands", payloadFromForm(form));
      await queryClient.invalidateQueries({ queryKey: ["/api/brands"] });
      toast({ title: "Brand created" });
      setAddOpen(false);
    } catch (err: any) {
      const raw = err?.message ?? "";
      const serverMessage = extractServerMessage(raw);
      if (isLogoUrlError(raw)) {
        setAddLogoError(serverMessage);
      } else {
        toast({
          title: "Failed to create brand",
          description: serverMessage || raw,
          variant: "destructive",
        });
      }
    } finally {
      setAddBusy(false);
    }
  };

  const submitEdit = async (form: BrandFormState) => {
    if (!editing) return;
    if (!form.name.trim() || !form.slug.trim()) {
      toast({ title: "Name and slug are required", variant: "destructive" });
      return;
    }
    setEditBusy(true);
    setEditLogoError(null);
    try {
      await apiRequest(
        "PATCH",
        `/api/brands/${editing.id}`,
        payloadFromForm(form),
      );
      await queryClient.invalidateQueries({ queryKey: ["/api/brands"] });
      toast({ title: "Brand updated" });
      setEditing(null);
    } catch (err: any) {
      const raw = err?.message ?? "";
      const serverMessage = extractServerMessage(raw);
      if (isLogoUrlError(raw)) {
        setEditLogoError(serverMessage);
      } else {
        toast({
          title: "Failed to update brand",
          description: serverMessage || raw,
          variant: "destructive",
        });
      }
    } finally {
      setEditBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await apiRequest("DELETE", `/api/brands/${deleting.id}`);
      await queryClient.invalidateQueries({ queryKey: ["/api/brands"] });
      if (activeBrand?.id === deleting.id) setActiveBrand(null);
      toast({ title: "Brand archived" });
      setDeleting(null);
    } catch (err: any) {
      toast({
        title: "Failed to archive brand",
        description: err?.message ?? "",
        variant: "destructive",
      });
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="px-6 lg:px-8 xl:px-10 py-6 max-w-5xl mx-auto">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1.5 text-sm mb-4 transition-colors hover:[color:var(--lux-accent,#cf3339)]"
        style={{ color: "var(--lux-text-muted)" }}
        data-testid="button-back-settings"
      >
        <ArrowLeft className="w-3 h-3" />
        Back to Settings
      </Link>

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1
            className="text-2xl font-bold"
            style={{ color: "var(--lux-text)" }}
            data-testid="text-page-title"
          >
            Brands
          </h1>
          <p
            className="mt-1 text-sm"
            style={{ color: "var(--lux-text-muted)" }}
          >
            Identities you can send marketing email from.
          </p>
        </div>
        <Button
          onClick={openAdd}
          data-testid="button-add-brand"
          className="inline-flex items-center gap-1.5"
        >
          <Plus className="h-4 w-4" />
          Add brand
        </Button>
      </div>

      {isLoading ? (
        <div
          className="rounded-xl border p-6 text-sm"
          style={{
            background: "var(--lux-surface)",
            borderColor: "var(--lux-border)",
            color: "var(--lux-text-muted)",
          }}
          data-testid="status-loading"
        >
          Loading brands…
        </div>
      ) : brands.length === 0 ? (
        <BrandEmptyState onAdd={openAdd} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {brands.map((b) => (
            <BrandCard
              key={b.id}
              brand={b}
              isActive={activeBrand?.id === b.id}
              onEdit={() => openEdit(b)}
              onArchive={() => setDeleting(b)}
            />
          ))}
        </div>
      )}

      {/* Add */}
      <BrandModal
        open={addOpen}
        onOpenChange={(o) => {
          setAddOpen(o);
          if (!o) setAddLogoError(null);
        }}
        mode="add"
        busy={addBusy}
        onSubmit={submitAdd}
        logoUrlError={addLogoError}
        onLogoUrlErrorClear={() => setAddLogoError(null)}
      />

      {/* Edit */}
      <BrandModal
        open={editing !== null}
        onOpenChange={(o) => {
          if (!o) {
            setEditing(null);
            setEditLogoError(null);
          }
        }}
        mode="edit"
        initial={editForm}
        busy={editBusy}
        onSubmit={submitEdit}
        brandId={editing?.id}
        logoUrlError={editLogoError}
        onLogoUrlErrorClear={() => setEditLogoError(null)}
      />

      {/* Archive confirmation (preserved verbatim from prior impl) */}
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
      >
        <AlertDialogContent data-testid="dialog-delete-brand">
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this brand?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.name} will be marked inactive. You can restore it
              later from the database if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleteBusy}
              data-testid="button-confirm-delete"
            >
              {deleteBusy ? "Archiving…" : "Archive"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
