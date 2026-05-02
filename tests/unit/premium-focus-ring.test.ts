/**
 * Static check — every premium primitive (`client/src/components/marketing-os/
 * premium/*.tsx`) uses the literal focus-ring rule (`box-shadow: 0 0 0 2px
 * rgba(var(--lux-accent-rgb), 0.25)` on `:focus-visible`) and NEVER references
 * `var(--lux-focus-ring)` in code, because that token resolves to `none` in
 * dark mode and would erase the focus indicator entirely.
 *
 * JSDoc mentions of the ban are allowed: comments are stripped before
 * scanning.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PREMIUM_DIR = path.resolve(
  __dirname,
  "../../client/src/components/marketing-os/premium",
);

function stripComments(code: string): string {
  // Block comments first (incl. JSDoc), then any // line comment whether
  // full-line or trailing after code. We deliberately do not try to
  // preserve // inside string literals — premium primitives do not embed
  // such sequences, and a stricter parser would be overkill for this
  // smoke check.
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

function listTsx(dir: string): string[] {
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

describe("premium primitives — focus-ring rule co-location", () => {
  const files = listTsx(PREMIUM_DIR);

  it("scans every premium primitive source file", () => {
    expect(files.length).toBeGreaterThanOrEqual(11);
  });

  for (const file of files) {
    const rel = path.relative(path.resolve(__dirname, "../.."), file);

    it(`${rel} — never references var(--lux-focus-ring) in code`, () => {
      const code = stripComments(fs.readFileSync(file, "utf8"));
      expect(code).not.toMatch(/var\(\s*--lux-focus-ring\s*\)/);
    });

    it(`${rel} — when it uses :focus-visible it co-locates the lux-accent-rgb shadow`, () => {
      const code = stripComments(fs.readFileSync(file, "utf8"));
      if (/focus-visible/.test(code)) {
        expect(code).toMatch(/--lux-accent-rgb/);
      } else {
        expect(true).toBe(true);
      }
    });
  }
});
