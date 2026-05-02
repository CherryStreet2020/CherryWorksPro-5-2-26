/**
 * Sprint 2n smoke test — brand modal exposes the canonical 12-color
 * brand preset palette in the exact spec order, and consumes the
 * Sprint 2m ColorSwatchPicker primitive. Filesystem-based.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MODAL = path.resolve(
  __dirname,
  "../../client/src/components/marketing-os/brands/brand-modal.tsx",
);

const SPEC_ORDER = [
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
];

describe("brand modal color picker", () => {
  const src = fs.readFileSync(MODAL, "utf8");

  it("imports ColorSwatchPicker from the premium primitives folder", () => {
    expect(src).toMatch(
      /import \{ ColorSwatchPicker \} from "@\/components\/marketing-os\/premium\/color-swatch-picker"/,
    );
  });

  it("renders <ColorSwatchPicker ... /> in the modal", () => {
    expect(src).toMatch(/<ColorSwatchPicker\b/);
  });

  it("declares all 12 spec hexes in strict-ascending source order", () => {
    let cursor = -1;
    for (const hex of SPEC_ORDER) {
      const idx = src.indexOf(hex, cursor + 1);
      expect(
        idx,
        `expected ${hex} to appear after offset ${cursor} in brand-modal.tsx`,
      ).toBeGreaterThan(cursor);
      cursor = idx;
    }
  });

  it("each preset hex is rendered as a clickable button via a template-literal testid", () => {
    // Single template-literal testid that interpolates the hex for all 12 presets.
    expect(src).toMatch(/data-testid=\{`brand-preset-\$\{hex\}`\}/);
    // The preset palette must be backed by a 12-entry constant.
    const m = src.match(/BRAND_COLOR_PRESETS\s*=\s*\[([\s\S]*?)\]/);
    expect(m, "BRAND_COLOR_PRESETS array literal must exist").not.toBeNull();
    const hexCount = (m![1].match(/#[0-9a-fA-F]{6}/g) ?? []).length;
    expect(hexCount).toBe(12);
  });
});
