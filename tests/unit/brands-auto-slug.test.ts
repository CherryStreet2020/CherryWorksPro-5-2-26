/**
 * Sprint 2n smoke test — brand modal auto-slug behavior.
 * Filesystem-based: scope-gate forbids adding jsdom/RTL or modifying
 * vitest.config.ts. Asserts only against the brand-modal source text.
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

describe("brand modal auto-slug", () => {
  it("ships the modal source", () => {
    expect(fs.existsSync(MODAL)).toBe(true);
  });

  const src = fs.readFileSync(MODAL, "utf8");

  it("modal source lowercases the name when deriving the slug", () => {
    expect(src).toMatch(/\.toLowerCase\(\)/);
  });

  it("modal source applies the [^a-z0-9]+ → '-' replacement", () => {
    expect(src).toMatch(/\.replace\(\/\[\^a-z0-9\]\+\/g/);
  });

  it("modal source tracks a `slugTouched` flag to gate auto-derivation", () => {
    expect(src).toContain("slugTouched");
  });
});
