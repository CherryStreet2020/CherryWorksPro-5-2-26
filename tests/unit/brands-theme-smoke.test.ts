/**
 * Sprint 2n smoke test — every brands UI source file uses the project
 * focus-ring rule (`box-shadow: 0 0 0 2px rgba(var(--lux-accent-rgb),
 * 0.25)` on `:focus-visible`) and NEVER references `var(--lux-focus-ring)`,
 * which is `none` in dark mode and would erase the focus indicator.
 *
 * Filesystem-based. Strips // and /* comments before scanning so JSDoc
 * mentions of the ban are allowed.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BRANDS_DIR = path.resolve(
  __dirname,
  "../../client/src/components/marketing-os/brands",
);
const PAGE = path.resolve(
  __dirname,
  "../../client/src/pages/settings/brands.tsx",
);

function stripComments(code: string): string {
  // Remove block comments (incl. JSDoc), then line comments.
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

function listTsx(dir: string): string[] {
  // Recursive walk so nested folders under brands/ are also enforced.
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsx(full));
    } else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("brands theme smoke — focus-ring rule co-location", () => {
  const files = [...listTsx(BRANDS_DIR), PAGE];

  it("at least four brand source files are scanned", () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  for (const file of files) {
    const rel = path.relative(path.resolve(__dirname, "../.."), file);

    it(`${rel} — never references var(--lux-focus-ring) in code`, () => {
      const code = stripComments(fs.readFileSync(file, "utf8"));
      expect(code).not.toMatch(/var\(--lux-focus-ring\)/);
    });

    it(`${rel} — when it uses :focus-visible it co-locates the lux-accent-rgb shadow`, () => {
      const code = stripComments(fs.readFileSync(file, "utf8"));
      if (/focus-visible/.test(code)) {
        expect(code).toMatch(/--lux-accent-rgb/);
      } else {
        // No focus-visible in this file — vacuously fine.
        expect(true).toBe(true);
      }
    });
  }
});
