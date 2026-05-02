import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

function src(path: string) {
  return readFileSync(join(__dirname, "..", "..", path), "utf-8");
}

describe("FIXIT B4 LOW — 4 fixes", () => {

  it("L1: Dark mode sidebar accent bumped from 15% to 20% lightness", () => {
    const css = src("client/src/index.css");
    expect(css).toContain("--sidebar-accent: 0 0% 20%");
    expect(css).toContain("--sidebar-accent-foreground: 0 0% 98%");
  });

  it("L2: Dashboard KPI cards have aria-label attributes", () => {
    const code = src("client/src/pages/dashboard.tsx");
    expect(code).toContain('aria-label={`Revenue MTD:');
    expect(code).toContain('aria-label={`Collected MTD:');
    expect(code).toContain('aria-label={`Outstanding:');
    expect(code).toContain('aria-label={`Overdue:');
    expect(code).toContain('aria-label={`Net Cash MTD:');
    expect(code).toContain('aria-label={`Team:');
    expect(code).toContain('role="region"');
  });

  it("L3: Close-periods date uses explicit locale format instead of raw toLocaleString", () => {
    const code = src("client/src/pages/close-periods.tsx");
    expect(code).not.toContain('new Date(p.closedAt).toLocaleString()');
    expect(code).toContain('toLocaleDateString("en-US"');
  });

  it("L3: Integrations dates use explicit locale format", () => {
    const code = src("client/src/pages/integrations.tsx");
    expect(code).not.toContain('.toLocaleDateString()');
    expect(code).not.toContain('.toLocaleString()');
    const matches = code.match(/toLocaleDateString\("en-US"/g);
    expect(matches?.length).toBeGreaterThanOrEqual(3);
  });

  it("L4: Focus-visible ring has box-shadow glow for keyboard nav visibility", () => {
    const css = src("client/src/index.css");
    expect(css).toContain("*:focus-visible");
    expect(css).toContain("box-shadow: 0 0 0 4px hsl(var(--ring) / 0.25)");
  });
});
