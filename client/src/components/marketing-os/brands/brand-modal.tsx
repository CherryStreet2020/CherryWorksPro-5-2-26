/**
 * BrandModal — Sprint 2n.
 *
 * Two-column premium dialog (60% form, 40% sticky preview) built on
 * Sprint 2m primitives: PremiumDialog, SectionCard, ColorSwatchPicker,
 * LogoDropzone, EmailPreview. Used for both Add and Edit. The parent
 * owns the API mutation — this component is pure form state + UI.
 *
 * Section order (left column, top to bottom):
 *   1. Identity         — name + auto-derived slug (slugTouched gate)
 *   2. Sending Identity — fromName, fromEmail (on-blur format check),
 *                         replyTo, domain + disabled "Verify DNS →"
 *                         tooltip
 *   3. Visual Identity  — 12 spec preset swatches with arrow-key nav,
 *                         bidirectional #RRGGBB input, LogoDropzone in
 *                         an aria-live="polite" region
 *   4. Signature        — 6-row monospace textarea on
 *                         --lux-surface-alt; live preview rendered via
 *                         the inline allowlist sanitizer
 *
 * Right column: sticky EmailPreview that receives primaryColor,
 * fromName, fromEmail (binding contract enforced by
 * brands-email-preview.test.ts).
 *
 * Footer: "X of 3 required fields complete" (live counter) flipping to
 * "Ready to save" when name + slug + fromEmail are all valid; the
 * primary button is disabled until then. Cancel + Save tab-order:
 * Identity → Sending → Visual → Signature → Cancel → Save (preview
 * pane is not tabbable — it's pointer-events:none on focus, but
 * remains visually live). Pressing Enter inside any input does NOT
 * submit the form (suppressed at form level).
 *
 * The 12 brand preset hexes below are the canonical Sprint 2n
 * palette in the exact spec order; brands-color-picker.test.ts
 * asserts they appear verbatim in this order.
 *
 * Theme: surfaces / borders inherit from PremiumDialog and SectionCard
 * (`--lux-*` tokens, light/dark flip). Custom swatch buttons follow
 * the focus-ring rule: `box-shadow: 0 0 0 2px
 * rgba(var(--lux-accent-rgb), 0.25)` directly on `:focus-visible`,
 * never `var(--lux-focus-ring)` (which is `none` in dark mode).
 */
import * as React from "react";
import { Sparkles, Send, Palette, PenLine, ShieldCheck } from "lucide-react";
import { PremiumDialog } from "@/components/marketing-os/premium/premium-dialog";
import { SectionCard } from "@/components/marketing-os/premium/section-card";
import { ColorSwatchPicker } from "@/components/marketing-os/premium/color-swatch-picker";
import { LogoDropzone } from "@/components/marketing-os/premium/logo-dropzone";
import { EmailPreview } from "@/components/marketing-os/premium/email-preview";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { sanitizeSignatureHtml } from "./sanitize-html";
import type { Brand } from "@shared/schema";

export const BRAND_COLOR_PRESETS = [
  "#cf3339",
  "#0f172a",
  "#1e3a8a",
  "#0891b2",
  "#059669",
  "#7c3aed",
  "#db2777",
  "#d97706",
  "#dc2626",
  "#334155",
  "#6b7280",
  "#000000",
] as const;

// Inline slug derivation — kept in the modal source so
// brands-auto-slug.test.ts can assert the regex literally.
function deriveSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface BrandFormState {
  name: string;
  slug: string;
  primaryColor: string;
  domain: string;
  fromEmail: string;
  fromName: string;
  replyTo: string;
  signatureHtml: string;
  logoUrl: string;
}

export const EMPTY_BRAND_FORM: BrandFormState = {
  name: "",
  slug: "",
  primaryColor: "#cf3339",
  domain: "",
  fromEmail: "",
  fromName: "",
  replyTo: "",
  signatureHtml: "",
  logoUrl: "",
};

export function brandToForm(b: Brand): BrandFormState {
  return {
    name: b.name ?? "",
    slug: b.slug ?? "",
    primaryColor: b.primaryColor ?? "#cf3339",
    domain: b.domain ?? "",
    fromEmail: b.fromEmail ?? "",
    fromName: b.fromName ?? "",
    replyTo: b.replyTo ?? "",
    signatureHtml: b.signatureHtml ?? "",
    logoUrl: b.logoUrl ?? "",
  };
}

export interface BrandModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "add" | "edit";
  initial?: BrandFormState;
  busy?: boolean;
  onSubmit: (form: BrandFormState) => void | Promise<void>;
  /**
   * Brand id used to target the hosted logo upload endpoint
   * (`POST /api/brands/:id/logo`). Required for edit-mode hosted
   * uploads. In add-mode it's absent; the dropzone then targets
   * `POST /api/brands/draft-logo` so the picked file still lands in
   * object storage as a hosted URL (instead of a base64 data URL)
   * before the brand row exists.
   */
  brandId?: string;
  /**
   * Server-side validation message for the pasted logo URL (task #164).
   * Surfaced inline in the LogoDropzone's error slot so admins can tell
   * which field a 400 came from. The parent owns the lifecycle: set it
   * from the brands API rejection, clear it via `onLogoUrlErrorClear`
   * once the admin edits the URL field, picks a file, removes the logo,
   * or otherwise touches `logoUrl`.
   */
  logoUrlError?: string | null;
  onLogoUrlErrorClear?: () => void;
}

export function BrandModal({
  open,
  onOpenChange,
  mode,
  initial,
  busy = false,
  onSubmit,
  brandId,
  logoUrlError,
  onLogoUrlErrorClear,
}: BrandModalProps) {
  const [form, setForm] = React.useState<BrandFormState>(
    initial ?? EMPTY_BRAND_FORM,
  );
  const [slugTouched, setSlugTouched] = React.useState<boolean>(
    Boolean(initial?.slug),
  );
  const [emailBlurred, setEmailBlurred] = React.useState<boolean>(false);
  const [logoAnnounce, setLogoAnnounce] = React.useState<string>("");
  const swatchRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  React.useEffect(() => {
    if (open) {
      setForm(initial ?? EMPTY_BRAND_FORM);
      setSlugTouched(Boolean(initial?.slug));
      setEmailBlurred(false);
      setLogoAnnounce("");
    }
  }, [open, initial]);

  const set = <K extends keyof BrandFormState>(k: K, v: BrandFormState[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const onNameChange = (v: string) => {
    setForm((prev) => ({
      ...prev,
      name: v,
      slug: slugTouched ? prev.slug : deriveSlug(v),
    }));
  };

  const onSlugChange = (v: string) => {
    setSlugTouched(true);
    set("slug", v);
  };

  // Required-fields tally (3): name, slug, fromEmail (valid format).
  const nameOk = form.name.trim().length > 0;
  const slugOk = form.slug.trim().length > 0;
  const emailOk = EMAIL_RE.test(form.fromEmail.trim());
  const requiredCount = [nameOk, slugOk, emailOk].filter(Boolean).length;
  const allValid = requiredCount === 3;
  const canSubmit = !busy && allValid;
  const showEmailError = emailBlurred && form.fromEmail.length > 0 && !emailOk;

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!canSubmit) return;
    onSubmit(form);
  };

  // Suppress Enter-as-submit inside text inputs (Save still works via
  // the explicit submit button).
  const onFormKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    const target = e.target as HTMLElement;
    if (
      e.key === "Enter" &&
      target.tagName === "INPUT" &&
      (target as HTMLInputElement).type !== "submit"
    ) {
      e.preventDefault();
    }
  };

  const onSwatchKeyDown = (i: number) => (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = swatchRefs.current[(i + 1) % BRAND_COLOR_PRESETS.length];
      next?.focus();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      const prev =
        swatchRefs.current[
          (i - 1 + BRAND_COLOR_PRESETS.length) % BRAND_COLOR_PRESETS.length
        ];
      prev?.focus();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      set("primaryColor", BRAND_COLOR_PRESETS[i]);
    }
  };

  const previewBody = (
    <span>
      Just wanted to follow up on our last conversation — let me know if
      there's a good time this week to chat.
    </span>
  );

  // Wrap the preview pane in `inert` so keyboard tab order skips it
  // entirely (spec: tab order ends at Save). EmailPreview now accepts
  // primaryColor natively — the CTA repaints with the brand color as
  // the user picks swatches.
  const previewPane = (
    <div
      className="space-y-4 md:sticky md:top-4"
      tabIndex={-1}
      {...({ inert: "" } as Record<string, unknown>)}
    >
      <EmailPreview
        primaryColor={form.primaryColor}
        fromName={form.fromName || form.name || "Brand sender"}
        fromEmail={form.fromEmail || "you@example.com"}
        subject={`A note from ${form.name || "your brand"}`}
        body={previewBody}
        ctaLabel="Book a 15-min call"
        signatureName={form.fromName || form.name || "Brand sender"}
        signatureTitle={form.domain || "Marketing"}
      />
      {form.signatureHtml ? (
        <div
          className="rounded-lg border p-3 text-xs"
          style={{
            background: "var(--lux-surface)",
            borderColor: "var(--lux-border)",
            color: "var(--lux-text)",
          }}
          data-testid="signature-rendered-preview"
        >
          <div
            className="mb-1 text-[10px] font-semibold uppercase tracking-wide"
            style={{ color: "var(--lux-text-muted)" }}
          >
            Signature
          </div>
          <div
            dangerouslySetInnerHTML={{
              __html: sanitizeSignatureHtml(form.signatureHtml),
            }}
          />
        </div>
      ) : null}
    </div>
  );

  return (
    <PremiumDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={<Sparkles className="h-5 w-5" />}
      title={mode === "add" ? "Add brand" : "Edit brand"}
      subtitle={
        mode === "add"
          ? "Set up a new brand for your marketing campaigns."
          : "Update brand details. Changes apply to future sends."
      }
      preview={previewPane}
      gridClassName="grid-cols-1 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
    >
      <form
        onSubmit={handleSubmit}
        onKeyDown={onFormKeyDown}
        className="space-y-4"
        data-testid={`form-brand-${mode}`}
      >
        <SectionCard
          icon={<Sparkles className="h-4 w-4" />}
          title="Identity"
          subtitle="What customers see in their inbox."
        >
          <div className="space-y-3">
            <div>
              <Label htmlFor="brand-name">
                Name <span style={{ color: "var(--lux-accent)" }}>*</span>
              </Label>
              <Input
                id="brand-name"
                value={form.name}
                onChange={(e) => onNameChange(e.target.value)}
                placeholder="Acme Co"
                data-testid="input-brand-name"
              />
            </div>
            <div>
              <Label htmlFor="brand-slug">
                Slug <span style={{ color: "var(--lux-accent)" }}>*</span>
              </Label>
              <Input
                id="brand-slug"
                value={form.slug}
                onChange={(e) => onSlugChange(e.target.value)}
                placeholder="acme-co"
                data-testid="input-brand-slug"
              />
              <p
                className="mt-1 text-xs"
                style={{ color: "var(--lux-text-muted)" }}
              >
                {slugTouched
                  ? "Auto-slug disabled — editing manually."
                  : "Auto-generated from name. Type to override."}
              </p>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          icon={<Send className="h-4 w-4" />}
          title="Sending Identity"
          subtitle="From, reply-to and sending domain."
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="brand-fromName">From name</Label>
              <Input
                id="brand-fromName"
                value={form.fromName}
                onChange={(e) => set("fromName", e.target.value)}
                placeholder="Mira from Acme"
                data-testid="input-brand-fromName"
              />
            </div>
            <div>
              <Label htmlFor="brand-fromEmail">
                From email{" "}
                <span style={{ color: "var(--lux-accent)" }}>*</span>
              </Label>
              <Input
                id="brand-fromEmail"
                type="email"
                value={form.fromEmail}
                onChange={(e) => set("fromEmail", e.target.value)}
                onBlur={() => setEmailBlurred(true)}
                placeholder="hello@acme.com"
                data-testid="input-brand-fromEmail"
                aria-invalid={showEmailError || undefined}
              />
              {showEmailError ? (
                <p
                  className="mt-1 text-xs"
                  style={{ color: "var(--lux-accent)" }}
                  data-testid="error-brand-fromEmail"
                >
                  Enter a valid email like hello@acme.com.
                </p>
              ) : null}
            </div>
            <div>
              <Label htmlFor="brand-replyTo">Reply-to</Label>
              <Input
                id="brand-replyTo"
                type="email"
                value={form.replyTo}
                onChange={(e) => set("replyTo", e.target.value)}
                placeholder="replies@acme.com"
                data-testid="input-brand-replyTo"
              />
            </div>
            <div>
              <Label htmlFor="brand-domain">Sending domain</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="brand-domain"
                  value={form.domain}
                  onChange={(e) => set("domain", e.target.value)}
                  placeholder="acme.com"
                  className="flex-1"
                  data-testid="input-brand-domain"
                />
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span tabIndex={0}>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled
                          className="whitespace-nowrap"
                          data-testid="button-verify-dns"
                        >
                          <ShieldCheck className="mr-1 h-3 w-3" />
                          Verify DNS →
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>DNS verification coming soon.</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          icon={<Palette className="h-4 w-4" />}
          title="Visual Identity"
          subtitle="Color and logo for emails and templates."
        >
          <div className="space-y-3">
            <div>
              <Label>Brand color</Label>
              <div
                className="mt-2 grid grid-cols-6 gap-2 sm:grid-cols-12"
                role="radiogroup"
                aria-label="Brand color presets"
              >
                {BRAND_COLOR_PRESETS.map((hex, i) => {
                  const selected =
                    form.primaryColor.toLowerCase() === hex.toLowerCase();
                  return (
                    <button
                      key={hex}
                      ref={(el) => {
                        swatchRefs.current[i] = el;
                      }}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={`Brand preset ${hex}`}
                      tabIndex={
                        selected ||
                        (!BRAND_COLOR_PRESETS.some(
                          (h) =>
                            h.toLowerCase() ===
                            form.primaryColor.toLowerCase(),
                        ) &&
                          i === 0)
                          ? 0
                          : -1
                      }
                      onClick={() => set("primaryColor", hex)}
                      onKeyDown={onSwatchKeyDown(i)}
                      className="relative h-7 w-7 rounded-full transition-transform duration-150 ease-out hover:scale-110 focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_rgba(var(--lux-accent-rgb),0.25)]"
                      style={{
                        background: hex,
                        boxShadow: selected
                          ? "0 0 0 2px var(--lux-surface), 0 0 0 4px var(--lux-accent)"
                          : "0 0 0 1px var(--lux-border)",
                      }}
                      data-testid={`brand-preset-${hex}`}
                    />
                  );
                })}
              </div>
            </div>
            <ColorSwatchPicker
              value={form.primaryColor}
              onChange={(v) => set("primaryColor", v)}
              label="Custom hex / native picker"
            />
            <div
              role="region"
              aria-live="polite"
              data-testid="logo-dropzone-region"
            >
              <LogoDropzone
                value={form.logoUrl || null}
                onChange={(v) => {
                  set("logoUrl", v ?? "");
                  setLogoAnnounce(v ? "Logo updated." : "Logo removed.");
                  // Any change to logoUrl retires a stale server-side
                  // rejection so the inline error doesn't outlive the
                  // value it was complaining about (task #164).
                  onLogoUrlErrorClear?.();
                }}
                uploadEndpoint={
                  brandId
                    ? `/api/brands/${brandId}/logo`
                    : "/api/brands/draft-logo"
                }
                error={logoUrlError ?? null}
                onErrorClear={onLogoUrlErrorClear}
              />
              <span className="sr-only">{logoAnnounce}</span>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          icon={<PenLine className="h-4 w-4" />}
          title="Signature"
          subtitle="Inline HTML — only p, br, strong, em, span, a, img tags are kept."
        >
          <Textarea
            id="brand-signatureHtml"
            rows={6}
            value={form.signatureHtml}
            onChange={(e) => set("signatureHtml", e.target.value)}
            placeholder="<p><strong>Mira Patel</strong><br/>Customer Success</p>"
            className="font-mono text-xs"
            style={{ background: "var(--lux-surface-alt)" }}
            data-testid="input-brand-signatureHtml"
          />
        </SectionCard>

        <div
          className="sticky bottom-0 z-10 -mx-6 -mb-6 flex items-center justify-between gap-3 border-t px-6 py-4"
          style={{
            borderColor: "var(--lux-border)",
            background: "var(--lux-surface)",
          }}
        >
          <span
            className="text-xs"
            style={{
              color: allValid ? "var(--lux-accent)" : "var(--lux-text-muted)",
            }}
            data-testid="status-required-count"
          >
            {allValid
              ? "Ready to save"
              : `${requiredCount} of 3 required fields complete`}
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
              data-testid={`button-cancel-${mode}`}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit}
              data-testid={`button-submit-${mode}`}
            >
              {busy
                ? mode === "add"
                  ? "Creating…"
                  : "Saving…"
                : mode === "add"
                  ? "Create brand"
                  : "Save changes"}
            </Button>
          </div>
        </div>
      </form>
    </PremiumDialog>
  );
}

export default BrandModal;
