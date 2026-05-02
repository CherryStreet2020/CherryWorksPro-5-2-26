/**
 * PremiumDialog — Sprint 2m premium primitive.
 *
 * Two-column dialog (form left, live preview right) built on shadcn
 * `Dialog`. Sectioned header (icon + title + subtitle). Stacks to a
 * single column on mobile.
 *
 * Theme behaviour: Background, border and header colors all consume
 * `--lux-*` tokens that flip via `.dark`. The preview pane is
 * `--lux-surface-alt` so it reads as a subtly distinct workspace in
 * both themes. The default close button (from shadcn `DialogContent`)
 * is hidden via `hideClose`; we render our own focusable close button
 * with the project focus-ring rule (`box-shadow: 0 0 0 2px
 * rgba(var(--lux-accent-rgb), 0.25)` directly on `:focus-visible`,
 * never `var(--lux-focus-ring)`).
 */
import * as React from "react";
import { X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface PremiumDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  preview?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Override the form/preview grid template. Defaults to `1fr 1fr`. */
  gridClassName?: string;
}

export function PremiumDialog({
  open,
  onOpenChange,
  icon,
  title,
  subtitle,
  preview,
  children,
  className,
  gridClassName,
}: PremiumDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        aria-describedby={subtitle ? "premium-dialog-desc" : undefined}
        className={cn(
          "max-w-4xl max-h-[90vh] overflow-y-auto border p-0 sm:rounded-xl",
          className,
        )}
        style={{
          background: "var(--lux-surface)",
          borderColor: "var(--lux-border)",
          boxShadow: "var(--lux-card-shadow-hover)",
        }}
      >
        <div
          className="sticky top-0 z-20 flex items-start gap-3 border-b px-6 py-4 backdrop-blur-sm"
          style={{
            borderColor: "var(--lux-border)",
            background:
              "linear-gradient(135deg, rgba(var(--lux-accent-rgb), 0.06), var(--lux-surface) 60%)",
          }}
        >
          {icon ? (
            <div
              className="flex h-10 w-10 items-center justify-center rounded-lg"
              style={{
                background: "rgba(var(--lux-accent-rgb), 0.10)",
                color: "var(--lux-accent)",
              }}
              aria-hidden
            >
              {icon}
            </div>
          ) : null}
          <div className="min-w-0 flex-1">
            <DialogTitle
              className="text-base font-semibold"
              style={{ color: "var(--lux-text)" }}
            >
              {title}
            </DialogTitle>
            {subtitle ? (
              <DialogDescription
                id="premium-dialog-desc"
                className="mt-0.5 text-xs"
                style={{ color: "var(--lux-text-muted)" }}
              >
                {subtitle}
              </DialogDescription>
            ) : null}
          </div>
          <DialogClose
            className="rounded-md p-1.5 transition-colors focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_rgba(var(--lux-accent-rgb),0.25)]"
            style={{ color: "var(--lux-text-muted)" }}
            aria-label="Close dialog"
            data-testid="button-premium-dialog-close"
          >
            <X className="h-4 w-4" />
          </DialogClose>
        </div>
        <div
          className={cn(
            "grid",
            preview
              ? gridClassName ??
                  "grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
              : "grid-cols-1",
          )}
        >
          <div
            className="space-y-4 p-6"
            style={{ background: "var(--lux-surface)" }}
          >
            {children}
          </div>
          {preview ? (
            <div
              className="border-t p-6 md:border-l md:border-t-0"
              style={{
                background: "var(--lux-surface-alt)",
                borderColor: "var(--lux-border)",
              }}
            >
              <div
                className="mb-3 text-xs font-semibold uppercase tracking-wide"
                style={{ color: "var(--lux-text-muted)" }}
              >
                Live preview
              </div>
              {preview}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default PremiumDialog;
