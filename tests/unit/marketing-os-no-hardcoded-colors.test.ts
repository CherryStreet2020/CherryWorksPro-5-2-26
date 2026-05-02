/**
 * Lint-style regression test for the broader marketing-os surface
 * (task #213).
 *
 * The companion scanner `premium-no-hardcoded-colors.test.ts`
 * (task #199) already blocks stray hex / rgb / hsl literals from
 * sneaking into `client/src/components/marketing-os/premium/*.tsx`.
 * The same `--lux-*` token contract applies to the wider marketing-os
 * surface — composer dialogs, brand cards, brand modals, segment /
 * sequence editors, dashboards, etc. — but those files have no guard
 * of their own. Without this test a future contributor could drop
 * `#ff0000` into `brand-card.tsx` (or anywhere else under
 * `client/src/components/marketing-os/`, excluding `premium/`) and
 * break the theme silently.
 *
 * This suite scans every `.tsx` file directly under
 * `client/src/components/marketing-os/` AND any nested directory
 * EXCEPT `premium/` (the premium primitives are owned by the
 * companion test, with their own per-file allow-list). It fails with
 * the offending file + line + literal whenever it finds a color
 * literal outside the documented allow-list:
 *
 *   1. `rgba(0, 0, 0, *)` — neutral shadow / hairline border alpha.
 *      Same allowance as the premium scanner; not a brand color.
 *   2. Anything inside a `var(...)` reference (e.g.
 *      `rgba(var(--lux-accent-rgb), 0.10)` or
 *      `hsl(var(--primary-foreground))`) — token-driven and theme-safe.
 *   3. The 12 brand-color presets exposed from `brand-modal.tsx` as
 *      `BRAND_COLOR_PRESETS`. That file IS the per-brand color picker
 *      (admins choose a brand's `primaryColor` from this fixed grid),
 *      so those hexes are the SOLE source of truth for the picker AND
 *      for the form's default value (`primaryColor: "#cf3339"`). All
 *      twelve are allow-listed inside `brand-modal.tsx` only.
 *
 * If you legitimately need a new color literal in a non-premium
 * marketing-os component (extremely rare — the design-system rule is
 * "tokens only"), extend the allow-list below AND document why in the
 * JSDoc of the consuming component.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const MARKETING_OS_DIR = path.resolve(
  __dirname,
  "../../client/src/components/marketing-os",
);

/**
 * `BRAND_COLOR_PRESETS` exported from `brand-modal.tsx`. These twelve
 * hex literals are the entire purpose of the brand color picker: they
 * back the visible swatch grid AND the default `primaryColor` value
 * on the form. Lower-cased for matching.
 */
const BRAND_COLOR_PRESET_HEXES = new Set<string>([
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
]);

/** Match every color literal: hex, rgb/rgba, hsl/hsla. */
const COLOR_LITERAL_RE =
  /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;

interface Offender {
  file: string;
  line: number;
  literal: string;
  snippet: string;
}

function isShadowRgba(literal: string): boolean {
  return /^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,/i.test(literal);
}

function isAllowed(literal: string, fileBasename: string): boolean {
  if (/var\(/i.test(literal)) return true;
  if (isShadowRgba(literal)) return true;
  const lower = literal.toLowerCase();
  if (
    fileBasename === "brand-modal.tsx" &&
    BRAND_COLOR_PRESET_HEXES.has(lower)
  ) {
    return true;
  }
  return false;
}

/**
 * Strip JS/TS comments before scanning so prose like `task #213` in
 * JSDoc isn't mistaken for a 3-digit hex. Newlines are preserved so
 * line numbers stay aligned with the original file.
 */
export function stripComments(source: string): string {
  let out = "";
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
        out += source[i] === "\n" ? "\n" : " ";
        i++;
      }
      i += 2;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < n && source[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function scanFile(absPath: string): Offender[] {
  const basename = path.basename(absPath);
  const raw = fs.readFileSync(absPath, "utf-8");
  const text = stripComments(raw);
  const rawLines = raw.split("\n");
  const offenders: Offender[] = [];
  const lines = text.split("\n");
  lines.forEach((line, idx) => {
    const matches = line.match(COLOR_LITERAL_RE);
    if (!matches) return;
    for (const m of matches) {
      if (isAllowed(m, basename)) continue;
      offenders.push({
        file: path.relative(MARKETING_OS_DIR, absPath),
        line: idx + 1,
        literal: m,
        snippet: (rawLines[idx] ?? "").trim(),
      });
    }
  });
  return offenders;
}

/**
 * Recursively list every `.tsx` under `marketing-os/`, skipping the
 * `premium/` subtree (owned by the companion test).
 */
function listMarketingOsFiles(): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "premium") continue;
        walk(full);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".tsx")) {
        out.push(full);
      }
    }
  }
  walk(MARKETING_OS_DIR);
  return out.sort();
}

describe("marketing-os (non-premium) — no hardcoded brand colors (task #213)", () => {
  const files = listMarketingOsFiles();

  it("scans the wider marketing-os surface (sanity: directory is non-empty)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("excludes premium/ — that subtree is covered by the companion scanner", () => {
    for (const f of files) {
      expect(f.includes(`${path.sep}premium${path.sep}`)).toBe(false);
    }
  });

  it("contains no disallowed hex / rgb / hsl literals", () => {
    const offenders: Offender[] = [];
    for (const file of files) {
      offenders.push(...scanFile(file));
    }
    if (offenders.length > 0) {
      const report = offenders
        .map(
          (o) =>
            `  • ${o.file}:${o.line}  →  ${o.literal}\n      ${o.snippet}`,
        )
        .join("\n");
      throw new Error(
        `Found ${offenders.length} hardcoded color literal(s) in marketing-os components.\n` +
          `marketing-os components must flow every color through --lux-*, --status-*, ` +
          `or --stage-* tokens. If a literal is genuinely required, extend the ` +
          `allow-list in tests/unit/marketing-os-no-hardcoded-colors.test.ts and ` +
          `document why in the consuming component.\n\n${report}`,
      );
    }
    expect(offenders).toEqual([]);
  });

  describe("allow-list documentation matches reality", () => {
    it("brand-modal.tsx actually contains all 12 documented brand-color presets", () => {
      const text = fs.readFileSync(
        path.join(MARKETING_OS_DIR, "brands", "brand-modal.tsx"),
        "utf-8",
      );
      for (const hex of BRAND_COLOR_PRESET_HEXES) {
        expect(text.toLowerCase()).toContain(hex);
      }
    });
  });

  describe("scanner self-checks", () => {
    it("flags a stray hex literal", () => {
      const fake = `const c = "#ff0000";`;
      const matches = fake.match(COLOR_LITERAL_RE) ?? [];
      expect(matches).toContain("#ff0000");
      expect(isAllowed("#ff0000", "brand-card.tsx")).toBe(false);
    });

    it("flags a stray rgb() literal", () => {
      const fake = `style={{ color: "rgb(255, 0, 0)" }}`;
      const matches = fake.match(COLOR_LITERAL_RE) ?? [];
      expect(matches.length).toBe(1);
      expect(isAllowed(matches[0], "brand-card.tsx")).toBe(false);
    });

    it("flags a stray hsl() literal", () => {
      const fake = `style={{ background: "hsl(0, 100%, 50%)" }}`;
      const matches = fake.match(COLOR_LITERAL_RE) ?? [];
      expect(matches.length).toBe(1);
      expect(isAllowed(matches[0], "brand-card.tsx")).toBe(false);
    });

    it("allows rgba(0, 0, 0, *) shadows everywhere", () => {
      expect(isAllowed("rgba(0,0,0,0.12)", "brand-card.tsx")).toBe(true);
      expect(isAllowed("rgba(0, 0, 0, 0.15)", "log-activity-dialog.tsx")).toBe(
        true,
      );
    });

    it("allows token-bearing literals like rgba(var(--lux-accent-rgb), ...)", () => {
      expect(
        isAllowed("rgba(var(--lux-accent-rgb), 0.10)", "brand-card.tsx"),
      ).toBe(true);
      expect(
        isAllowed("hsl(var(--primary-foreground))", "marketing-os-tabs.tsx"),
      ).toBe(true);
    });

    it("only allows the brand presets inside brand-modal.tsx", () => {
      expect(isAllowed("#cf3339", "brand-modal.tsx")).toBe(true);
      // Same hex in a different file is NOT allowed.
      expect(isAllowed("#cf3339", "brand-card.tsx")).toBe(false);
      expect(isAllowed("#000000", "brand-modal.tsx")).toBe(true);
      expect(isAllowed("#000000", "brand-badge.tsx")).toBe(false);
    });

    it("strips block and line comments so task references aren't mistaken for hex colors", () => {
      const src = [
        "/* see task #213 */",
        'const c = "#ff0000";',
        "// task #199 inline",
      ].join("\n");
      const stripped = stripComments(src);
      expect(stripped).not.toContain("#213");
      expect(stripped).not.toContain("#199");
      expect(stripped).toContain("#ff0000");
      expect(stripped.split("\n").length).toBe(3);
    });

    it("walker discovers nested files (brands/) and skips premium/", () => {
      const rels = files.map((f) => path.relative(MARKETING_OS_DIR, f));
      // Sanity: the brands subtree IS scanned.
      expect(rels.some((r) => r.startsWith(`brands${path.sep}`))).toBe(true);
      // And the premium subtree is NOT scanned by this suite.
      expect(rels.every((r) => !r.startsWith(`premium${path.sep}`))).toBe(true);
    });
  });
});
