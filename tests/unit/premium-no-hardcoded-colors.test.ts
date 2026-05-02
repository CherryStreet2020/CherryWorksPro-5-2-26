/**
 * Lint-style regression test for the Sprint 2m premium primitives
 * (task #199).
 *
 * The companion `premium-theme-flip.test.tsx` suite (task #180) verifies
 * that the *checked* style props on every primitive flow through
 * `--lux-*` / `--status-*` / `--stage-*` tokens. It cannot, however,
 * catch a future contributor sprinkling a stray `#ff0000`,
 * `rgb(255,0,0)`, or `hsl(0, 100%, 50%)` into a less-obvious spot
 * (e.g. a new shadow, a hover state, a new sub-element) — those would
 * still resolve to a fixed color and silently desync from the theme.
 *
 * This suite scans every file in
 * `client/src/components/marketing-os/premium/*.tsx` for color
 * literals (hex, rgb/rgba, hsl/hsla) and fails with the offending
 * file + line + literal whenever it finds one outside the documented
 * allow-list:
 *
 *   1. `rgba(0, 0, 0, *)` — neutral shadow / hairline border alpha.
 *      Used as a generic shadow recipe; not a "brand color".
 *   2. Anything inside a `var(...)` reference (e.g.
 *      `rgba(var(--lux-accent-rgb), 0.10)` or
 *      `hsl(var(--primary-foreground))`) — those are token-driven and
 *      flip with the theme.
 *   3. The 10 brand swatches in `color-swatch-picker.tsx` — the picker
 *      *is* the place where users pick from a fixed brand palette, so
 *      these hexes are the SOLE source of truth for the swatch grid.
 *   4. `#1a1a2e` inside `email-preview.tsx` — the email card body is
 *      deliberately white in BOTH themes (real inboxes render emails
 *      on white), so its body text uses a fixed near-black hex. The
 *      white background itself is the Tailwind `bg-white` utility,
 *      which is why no `#ffffff` literal needs allow-listing.
 *
 * If you legitimately need to add a new color literal to a premium
 * primitive (extremely rare — the design-system rule is "tokens
 * only"), extend the allow-list below AND document why in the JSDoc
 * of the consuming primitive.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const PREMIUM_DIR = path.resolve(
  __dirname,
  "../../client/src/components/marketing-os/premium",
);

/**
 * Brand swatch palette in `color-swatch-picker.tsx`. These ten hex
 * literals are the entire purpose of that file — they back the visible
 * swatch grid AND the default `value` prop. Lower-cased for matching.
 */
const COLOR_SWATCH_HEXES = new Set<string>([
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
]);

/**
 * Hex literals allowed inside `email-preview.tsx`. The email card body
 * is intentionally white-on-near-black in both themes (matches how real
 * inboxes render emails), so the body text uses a fixed hex.
 */
const EMAIL_PREVIEW_HEXES = new Set<string>(["#1a1a2e"]);

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
  // `rgba(0, 0, 0, *)` (with any whitespace) is the canonical neutral
  // shadow / hairline-border recipe — not a brand color.
  return /^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,/i.test(literal);
}

function isAllowed(literal: string, fileBasename: string): boolean {
  // Token-driven: the literal embeds a `var(--token)` reference. These
  // are exactly what the design system wants; flagging them would be
  // a false positive.
  if (/var\(/i.test(literal)) return true;
  if (isShadowRgba(literal)) return true;
  const lower = literal.toLowerCase();
  if (
    fileBasename === "color-swatch-picker.tsx" &&
    COLOR_SWATCH_HEXES.has(lower)
  ) {
    return true;
  }
  if (
    fileBasename === "email-preview.tsx" &&
    EMAIL_PREVIEW_HEXES.has(lower)
  ) {
    return true;
  }
  return false;
}

/**
 * Strip JS/TS comments before scanning so prose like
 * `Task #160` or `(task #156)` in JSDoc isn't mistaken for a 3-digit
 * hex color. We replace comment bodies with spaces so line numbers
 * stay aligned with the original file.
 */
export function stripComments(source: string): string {
  let out = "";
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "*") {
      // Block comment — preserve newlines so line numbers stay aligned.
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
        out += source[i] === "\n" ? "\n" : " ";
        i++;
      }
      i += 2; // skip closing */
      continue;
    }
    if (ch === "/" && next === "/") {
      // Line comment — blank to end of line.
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
        file: basename,
        line: idx + 1,
        literal: m,
        snippet: (rawLines[idx] ?? "").trim(),
      });
    }
  });
  return offenders;
}

function listPremiumFiles(): string[] {
  return fs
    .readdirSync(PREMIUM_DIR)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => path.join(PREMIUM_DIR, f))
    .sort();
}

describe("premium primitives — no hardcoded brand colors (task #199)", () => {
  const files = listPremiumFiles();

  it("scans every primitive (sanity: directory is non-empty)", () => {
    expect(files.length).toBeGreaterThan(0);
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
        `Found ${offenders.length} hardcoded color literal(s) in premium primitives.\n` +
          `Premium primitives must flow every color through --lux-*, --status-*, ` +
          `or --stage-* tokens. If a literal is genuinely required, extend the ` +
          `allow-list in tests/unit/premium-no-hardcoded-colors.test.ts and ` +
          `document why in the consuming component.\n\n${report}`,
      );
    }
    expect(offenders).toEqual([]);
  });

  describe("allow-list documentation matches reality", () => {
    it("color-swatch-picker.tsx actually contains all 10 documented swatches", () => {
      const text = fs.readFileSync(
        path.join(PREMIUM_DIR, "color-swatch-picker.tsx"),
        "utf-8",
      );
      for (const hex of COLOR_SWATCH_HEXES) {
        expect(text.toLowerCase()).toContain(hex);
      }
    });

    it("email-preview.tsx actually contains the documented near-black body text hex", () => {
      const text = fs.readFileSync(
        path.join(PREMIUM_DIR, "email-preview.tsx"),
        "utf-8",
      );
      for (const hex of EMAIL_PREVIEW_HEXES) {
        expect(text.toLowerCase()).toContain(hex);
      }
    });
  });

  describe("scanner self-checks", () => {
    it("flags a stray hex literal", () => {
      const fake = `const c = "#ff0000";`;
      const matches = fake.match(COLOR_LITERAL_RE) ?? [];
      expect(matches).toContain("#ff0000");
      expect(isAllowed("#ff0000", "metric-card.tsx")).toBe(false);
    });

    it("flags a stray rgb() literal", () => {
      const fake = `style={{ color: "rgb(255, 0, 0)" }}`;
      const matches = fake.match(COLOR_LITERAL_RE) ?? [];
      expect(matches.length).toBe(1);
      expect(isAllowed(matches[0], "metric-card.tsx")).toBe(false);
    });

    it("flags a stray hsl() literal", () => {
      const fake = `style={{ background: "hsl(0, 100%, 50%)" }}`;
      const matches = fake.match(COLOR_LITERAL_RE) ?? [];
      expect(matches.length).toBe(1);
      expect(isAllowed(matches[0], "metric-card.tsx")).toBe(false);
    });

    it("allows rgba(0, 0, 0, *) shadows everywhere", () => {
      expect(isAllowed("rgba(0,0,0,0.12)", "avatar-stack.tsx")).toBe(true);
      expect(isAllowed("rgba(0, 0, 0, 0.15)", "status-ribbon.tsx")).toBe(true);
    });

    it("allows token-bearing literals like rgba(var(--lux-accent-rgb), ...)", () => {
      expect(
        isAllowed("rgba(var(--lux-accent-rgb), 0.10)", "section-card.tsx"),
      ).toBe(true);
      expect(isAllowed("hsl(var(--primary-foreground))", "pill-tab.tsx")).toBe(
        true,
      );
    });

    it("only allows the swatch hexes inside color-swatch-picker.tsx", () => {
      expect(isAllowed("#cf3339", "color-swatch-picker.tsx")).toBe(true);
      // Same hex in a different file is NOT allowed.
      expect(isAllowed("#cf3339", "metric-card.tsx")).toBe(false);
    });

    it("strips block and line comments so task references aren't mistaken for hex colors", () => {
      const src = [
        "/* see task #160 */",
        'const c = "#ff0000";',
        "// task #164 inline",
      ].join("\n");
      const stripped = stripComments(src);
      expect(stripped).not.toContain("#160");
      expect(stripped).not.toContain("#164");
      // Real hex literal in code survives:
      expect(stripped).toContain("#ff0000");
      // Line numbers preserved:
      expect(stripped.split("\n").length).toBe(3);
    });

    it("only allows the email-body hex inside email-preview.tsx", () => {
      expect(isAllowed("#1a1a2e", "email-preview.tsx")).toBe(true);
      // `#1a1a2e` is also a swatch in color-swatch-picker, allowed there too.
      expect(isAllowed("#1a1a2e", "color-swatch-picker.tsx")).toBe(true);
      // But not in arbitrary primitives.
      expect(isAllowed("#1a1a2e", "metric-card.tsx")).toBe(false);
    });
  });
});
