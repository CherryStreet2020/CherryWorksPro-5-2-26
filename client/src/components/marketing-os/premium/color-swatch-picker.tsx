/**
 * ColorSwatchPicker — Sprint 2m premium primitive.
 *
 * Hex input + 10-swatch palette + native `<input type="color">`.
 * The 10 brand swatches below are the ONLY hardcoded colors permitted
 * in this sprint (per Sprint 2m scope).
 *
 * Theme behaviour: Selected swatch shows a `--lux-accent` ring. Focus
 * indicator on swatches uses `box-shadow: 0 0 0 2px
 * rgba(var(--lux-accent-rgb), 0.25)` directly on `:focus-visible`
 * (never `var(--lux-focus-ring)`, which is `none` in dark mode and
 * would erase the focus ring).
 */
import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const SWATCHES = [
  "#cf3339",
  "#e07a3a",
  "#d4a853",
  "#3aa676",
  "#3bb8b3",
  "#3a7bd5",
  "#7a4ad4",
  "#c14db8",
  "#1a1a2e",
  "#6b7280",
];

export interface ColorSwatchPickerProps {
  value?: string;
  onChange?: (hex: string) => void;
  className?: string;
  label?: string;
}

export function ColorSwatchPicker({
  value = "#cf3339",
  onChange,
  className,
  label = "Brand color",
}: ColorSwatchPickerProps) {
  const handle = (v: string) => onChange?.(v);
  return (
    <div className={cn("space-y-2", className)} data-testid="premium-color-swatch-picker">
      <div
        className="text-xs font-medium"
        style={{ color: "var(--lux-text-secondary)" }}
      >
        {label}
      </div>
      <div className="flex items-center gap-2">
        <Input
          value={value}
          onChange={(e) => handle(e.target.value)}
          maxLength={7}
          className="w-28 font-mono text-xs uppercase"
          data-testid="input-color-hex"
        />
        <input
          type="color"
          value={value}
          onChange={(e) => handle(e.target.value)}
          className="h-8 w-8 cursor-pointer rounded-md border"
          style={{ borderColor: "var(--lux-border)" }}
          aria-label="Color picker"
          data-testid="input-color-native"
        />
      </div>
      <div className="grid grid-cols-10 gap-2">
        {SWATCHES.map((hex) => {
          const selected = value.toLowerCase() === hex.toLowerCase();
          return (
            <button
              key={hex}
              type="button"
              onClick={() => handle(hex)}
              className="relative h-7 w-7 rounded-full transition-all duration-150 ease-out focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_rgba(var(--lux-accent-rgb),0.25)]"
              style={{
                background: hex,
                boxShadow: selected
                  ? "0 0 0 2px var(--lux-surface), 0 0 0 4px var(--lux-accent)"
                  : "0 0 0 1px var(--lux-border)",
              }}
              aria-label={`Select ${hex}`}
              aria-pressed={selected}
              data-testid={`swatch-${hex}`}
            />
          );
        })}
      </div>
    </div>
  );
}

export default ColorSwatchPicker;
