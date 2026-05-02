/**
 * BrandCard — Sprint 2n.
 *
 * Premium card row for a single brand on /settings/brands. Layout:
 *   - 8px top color ribbon in `brand.primaryColor`
 *   - Header row: 48×48 logo or initials chip on `primaryColor`,
 *     name + active/archived badge, slug
 *   - Sender row: from email + sending domain
 *   - Footer chips: Contacts (count or "—"), Last sent (FreshnessDot
 *     + relative time or "Never"), driven by `BrandWithStats` returned
 *     by `GET /api/brands`
 *   - 3-dot menu (Edit / Duplicate-disabled / Delete)
 *
 * The entire card is click-to-edit (except the 3-dot menu, which
 * stops propagation). Hover lifts elevation via
 * `--lux-card-shadow-hover`. Counts and last-sent gracefully fall back
 * to "—"/"Never" when the caller passes a plain `Brand` without stats.
 *
 * Theme: surfaces and borders use `--lux-*` tokens. Focus indicator
 * on the card-level button uses `box-shadow: 0 0 0 2px
 * rgba(var(--lux-accent-rgb), 0.25)` directly on `:focus-visible`,
 * never `var(--lux-focus-ring)`.
 */
import * as React from "react";
import { MoreHorizontal, Pencil, Copy, Trash2 } from "lucide-react";
import { FreshnessDot } from "@/components/marketing-os/premium/freshness-dot";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Brand, BrandWithStats } from "@shared/schema";

export interface BrandCardProps {
  brand: Brand | BrandWithStats;
  isActive: boolean;
  onEdit: () => void;
  onArchive: () => void;
}

function formatRelative(input: Date | string | null | undefined): string {
  if (!input) return "Never";
  const ts = input instanceof Date ? input.getTime() : new Date(input).getTime();
  if (Number.isNaN(ts)) return "Never";
  const diffMs = Date.now() - ts;
  if (diffMs < 0) return "Just now";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "Just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const week = Math.floor(day / 7);
  if (week < 5) return `${week}w ago`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month}mo ago`;
  const year = Math.floor(day / 365);
  return `${year}y ago`;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function BrandCard({
  brand,
  isActive,
  onEdit,
  onArchive,
}: BrandCardProps) {
  const accent = brand.primaryColor || "var(--lux-accent)";
  const contactCount =
    "contactCount" in brand && typeof brand.contactCount === "number"
      ? brand.contactCount
      : null;
  const lastSentAt: Date | string | null =
    "lastSentAt" in brand ? (brand.lastSentAt as Date | string | null) : null;

  // Hover-elevation handled inline so we can swap CSS vars; cleaner
  // than a Tailwind arbitrary value with mixed token interpolation.
  const [hovered, setHovered] = React.useState(false);

  const onCardKeyDown = (e: React.KeyboardEvent) => {
    // Only react when the card itself is focused — never when a nested
    // control (3-dot menu trigger, menu items) is the actual key target.
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onEdit();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={onCardKeyDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border text-left transition-all duration-150 ease-out hover:-translate-y-[1px] focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_rgba(var(--lux-accent-rgb),0.25)]"
      style={{
        background: "var(--lux-surface)",
        borderColor: "var(--lux-border)",
        boxShadow: hovered
          ? "var(--lux-card-shadow-hover)"
          : "var(--lux-card-shadow)",
      }}
      data-testid={`card-brand-${brand.id}`}
    >
      {/* 8px top color ribbon */}
      <div
        className="h-2 w-full"
        style={{ background: accent }}
        aria-hidden
        data-testid={`ribbon-brand-${brand.id}`}
      />

      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <div
            className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg text-base font-semibold text-white"
            style={{ background: accent }}
            aria-hidden
          >
            {brand.logoUrl ? (
              <img
                src={brand.logoUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <span>{initials(brand.name) || "?"}</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div
                className="truncate text-sm font-semibold"
                style={{ color: "var(--lux-text)" }}
                data-testid={`text-brand-name-${brand.id}`}
              >
                {brand.name}
              </div>
              {isActive ? (
                <span
                  className="rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                  style={{
                    background: "rgba(var(--lux-accent-rgb), 0.12)",
                    color: "var(--lux-accent)",
                  }}
                  data-testid={`badge-active-${brand.id}`}
                >
                  Active
                </span>
              ) : null}
              {!brand.active ? (
                <span
                  className="rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                  style={{
                    background: "var(--lux-border)",
                    color: "var(--lux-text-muted)",
                  }}
                  data-testid={`badge-archived-${brand.id}`}
                >
                  Archived
                </span>
              ) : null}
            </div>
            <div
              className="truncate text-xs"
              style={{ color: "var(--lux-text-muted)" }}
              data-testid={`text-brand-slug-${brand.id}`}
            >
              {brand.slug}
            </div>
          </div>

          {/* 3-dot menu — stops propagation so it doesn't trigger
              the card's click-to-edit. */}
          <div onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="rounded-md p-1.5 transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_rgba(var(--lux-accent-rgb),0.25)] dark:hover:bg-white/5"
                  style={{ color: "var(--lux-text-muted)" }}
                  aria-label="Brand actions"
                  data-testid={`button-brand-menu-${brand.id}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => onEdit()}
                  data-testid={`menu-edit-brand-${brand.id}`}
                >
                  <Pencil className="mr-2 h-3.5 w-3.5" />
                  Edit
                </DropdownMenuItem>
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <DropdownMenuItem
                          disabled
                          data-testid={`menu-duplicate-brand-${brand.id}`}
                        >
                          <Copy className="mr-2 h-3.5 w-3.5" />
                          Duplicate
                        </DropdownMenuItem>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="left">Coming soon</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <DropdownMenuItem
                  onSelect={() => onArchive()}
                  className="text-[color:var(--lux-accent)]"
                  data-testid={`menu-delete-brand-${brand.id}`}
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div
          className="flex flex-col gap-0.5 text-xs"
          style={{ color: "var(--lux-text-muted)" }}
        >
          <span
            className="truncate"
            data-testid={`text-brand-from-${brand.id}`}
          >
            {brand.fromEmail || "No from address"}
          </span>
          <span
            className="truncate"
            data-testid={`text-brand-domain-${brand.id}`}
          >
            {brand.domain || "No sending domain"}
          </span>
        </div>

        <div
          className="mt-auto flex items-center justify-between gap-2 border-t pt-3 text-[11px]"
          style={{
            borderColor: "var(--lux-border)",
            color: "var(--lux-text-muted)",
          }}
        >
          <span
            className="inline-flex items-center gap-1"
            data-testid={`chip-brand-contacts-${brand.id}`}
          >
            <span style={{ color: "var(--lux-text)" }}>
              {contactCount === null ? "—" : contactCount.toLocaleString()}
            </span>
            <span>contacts</span>
          </span>
          <span
            className="inline-flex items-center gap-1.5"
            data-testid={`chip-brand-lastsent-${brand.id}`}
          >
            <FreshnessDot lastActivityAt={lastSentAt} />
            <span>Last sent: {formatRelative(lastSentAt)}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

export default BrandCard;
