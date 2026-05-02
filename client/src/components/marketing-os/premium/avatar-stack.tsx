/**
 * AvatarStack — Sprint 2m premium primitive.
 *
 * Overlapping round avatars with `+N` overflow. Falls back to initials
 * when `imageUrl` is absent.
 *
 * Theme behaviour: Initials background uses `--lux-surface` and text
 * uses `--lux-text` so the fallback chips stay legible in both themes.
 * Ring color uses `--lux-bg` so avatars carve cleanly out of any
 * surface. No interactive controls; if wrapped in a button, that
 * button should use `box-shadow: 0 0 0 2px rgba(var(--lux-accent-rgb),
 * 0.25)` directly on `:focus-visible` (never `var(--lux-focus-ring)`).
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export interface AvatarItem {
  name: string;
  imageUrl?: string;
}

export interface AvatarStackProps {
  people: AvatarItem[];
  max?: number;
  className?: string;
  size?: number;
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");
}

export function AvatarStack({
  people,
  max = 4,
  className,
  size = 28,
}: AvatarStackProps) {
  const visible = people.slice(0, max);
  const overflow = Math.max(0, people.length - max);
  const dim = `${size}px`;
  const overlap = `-${Math.round(size * 0.3)}px`;
  return (
    <div
      data-testid="premium-avatar-stack"
      className={cn("inline-flex items-center", className)}
    >
      {visible.map((p, i) => (
        <div
          key={`${p.name}-${i}`}
          className="flex items-center justify-center overflow-hidden rounded-full text-xs font-semibold"
          style={{
            width: dim,
            height: dim,
            background: "var(--lux-surface)",
            color: "var(--lux-text)",
            border: "2px solid var(--lux-bg)",
            marginLeft: i === 0 ? 0 : overlap,
            boxShadow: "0 1px 2px rgba(0,0,0,0.12)",
          }}
          title={p.name}
          data-testid={`avatar-${i}`}
        >
          {p.imageUrl ? (
            <img
              src={p.imageUrl}
              alt={p.name}
              className="h-full w-full object-cover"
            />
          ) : (
            <span>{initials(p.name)}</span>
          )}
        </div>
      ))}
      {overflow > 0 ? (
        <div
          className="flex items-center justify-center rounded-full text-xs font-semibold"
          style={{
            width: dim,
            height: dim,
            background: "rgba(var(--lux-accent-rgb), 0.10)",
            color: "var(--lux-accent)",
            border: "2px solid var(--lux-bg)",
            marginLeft: overlap,
          }}
          data-testid="avatar-overflow"
        >
          +{overflow}
        </div>
      ) : null}
    </div>
  );
}

export default AvatarStack;
