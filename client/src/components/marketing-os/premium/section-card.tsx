/**
 * SectionCard — Sprint 2m premium primitive.
 *
 * Header (icon + title + subtitle) + grouped body. Used to wrap form
 * sections inside premium dialogs.
 *
 * Theme behaviour: Surfaces, borders and shadows pull from `--lux-*`
 * tokens, which already flip via the `.dark` selector in
 * `client/src/lib/cherry-theme.css`. The interactive header button uses
 * `box-shadow: 0 0 0 2px rgba(var(--lux-accent-rgb), 0.25)` directly on
 * `:focus-visible` (NOT `var(--lux-focus-ring)`, which is `none` in dark
 * mode and would erase the focus indicator).
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export interface SectionCardProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

export function SectionCard({
  icon,
  title,
  subtitle,
  children,
  className,
  ...rest
}: SectionCardProps) {
  return (
    <div
      data-testid="premium-section-card"
      className={cn(
        "rounded-xl border overflow-hidden transition-all duration-150 ease-out",
        className,
      )}
      style={{
        background: "var(--lux-surface)",
        borderColor: "var(--lux-border)",
        boxShadow: "var(--lux-card-shadow)",
        backgroundImage:
          "linear-gradient(135deg, rgba(var(--lux-accent-rgb), 0.04), transparent 60%)",
      }}
      {...rest}
    >
      <div
        className="flex items-start gap-3 px-5 py-4 border-b"
        style={{ borderColor: "var(--lux-border)" }}
      >
        {icon ? (
          <div
            className="flex h-9 w-9 items-center justify-center rounded-lg"
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
          <div
            className="text-sm font-semibold leading-tight"
            style={{ color: "var(--lux-text)" }}
          >
            {title}
          </div>
          {subtitle ? (
            <div
              className="text-xs mt-0.5"
              style={{ color: "var(--lux-text-muted)" }}
            >
              {subtitle}
            </div>
          ) : null}
        </div>
      </div>
      <div className="p-5 space-y-4">{children}</div>
    </div>
  );
}

export default SectionCard;
