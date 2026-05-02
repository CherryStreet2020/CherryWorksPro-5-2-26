/**
 * Sprint 2d — shared swatch palette for the marketing-tag color picker.
 *
 * Exactly 10 visually distinct, brand-coherent swatches. Includes the two
 * cherry-red brand tones (#cf3339, #C41E3A) per spec. Each has been
 * eyeball + tooling-verified for WCAG AA contrast ratio (>= 4.5:1) against
 * white text at the chip font size used in the contacts table — these are
 * background fills, never text colors. The order is intentional: warm
 * tones first, cool tones second, neutrals last so the picker grid reads
 * naturally left-to-right, top-to-bottom.
 */
export interface TagColorSwatch {
  hex: string;
  label: string;
}

export const MARKETING_TAG_COLORS: readonly TagColorSwatch[] = [
  { hex: "#C41E3A", label: "Cherry"   },
  { hex: "#cf3339", label: "Crimson"  },
  { hex: "#B45309", label: "Amber"    },
  { hex: "#92400E", label: "Bronze"   },
  { hex: "#15803D", label: "Forest"   },
  { hex: "#0F766E", label: "Teal"     },
  { hex: "#1D4ED8", label: "Cobalt"   },
  { hex: "#6D28D9", label: "Violet"   },
  { hex: "#A21CAF", label: "Magenta"  },
  { hex: "#475569", label: "Slate"    },
] as const;

export const DEFAULT_TAG_COLOR = MARKETING_TAG_COLORS[0].hex;
