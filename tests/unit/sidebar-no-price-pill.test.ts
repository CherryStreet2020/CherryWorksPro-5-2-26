/**
 * Sprint 2n smoke test — the Marketing sidebar group label no longer
 * renders the `$99/mo` price pill, and the `pill-marketing-price`
 * testid has been retired. The Lock icon is still imported from
 * lucide-react and rendered in the locked group label.
 *
 * Filesystem-based.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SRC = path.resolve(
  __dirname,
  "../../client/src/components/marketing-nav-section.tsx",
);

describe("sidebar Marketing group — no price pill", () => {
  const code = fs.readFileSync(SRC, "utf8");
  // Strip block + line comments so JSDoc mentions of the removal don't
  // trip the literal-string ban.
  const stripped = code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

  it("source no longer contains the literal $99 anywhere in code", () => {
    expect(stripped).not.toContain("$99");
  });

  it("source no longer contains the pill-marketing-price testid", () => {
    expect(stripped).not.toContain("pill-marketing-price");
  });

  it("Lock is imported from lucide-react", () => {
    // Match either single-import `import { Lock } from "lucide-react"` or
    // a multi-import list that includes Lock.
    expect(code).toMatch(
      /import\s+\{[^}]*\bLock\b[^}]*\}\s+from\s+["']lucide-react["']/,
    );
  });

  it("Lock icon is still rendered in the locked group label", () => {
    expect(stripped).toMatch(/icon-marketing-lock/);
  });
});
