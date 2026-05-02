/**
 * Sprint 2m smoke test — showcase.
 * Filesystem-based: scope-gate forbids adding jsdom/RTL or modifying vitest.config.ts.
 * See follow-up #150 for render-test upgrade.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SHOWCASE = path.resolve(
  __dirname,
  "../../client/src/pages/__premium-showcase.tsx",
);

const PRIMITIVE_NAMES = [
  "SectionCard",
  "LogoDropzone",
  "ColorSwatchPicker",
  "InlineEditableField",
  "MetricCard",
  "EmailPreview",
  "StatusRibbon",
  "AvatarStack",
  "FreshnessDot",
  "PillTab",
  "PremiumDialog",
] as const;

describe("premium showcase page", () => {
  it("(a) ships the showcase page and composes all 11 primitives", () => {
    expect(fs.existsSync(SHOWCASE)).toBe(true);
    const src = fs.readFileSync(SHOWCASE, "utf8");
    expect(src).toMatch(/export default /);
    for (const name of PRIMITIVE_NAMES) {
      expect(src).toContain(name);
    }
  });

  it("(b) wires the useTheme() toggle so the sun/moon button flips themes", () => {
    const src = fs.readFileSync(SHOWCASE, "utf8");
    expect(src).toMatch(/useTheme\(/);
    expect(src).toMatch(/toggle/);
  });
});
