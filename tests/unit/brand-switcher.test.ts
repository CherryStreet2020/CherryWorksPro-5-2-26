/**
 * Sprint 2e.1 — BrandSwitcher route gate.
 *
 * Verifies the composite early-return guard:
 *   flag → brands.length → location.startsWith('/marketing/')
 *
 * Strategy: mock wouter / useBrand / featureFlags, then invoke
 * BrandSwitcher() like a plain function. A null return proves the
 * gate fired; a non-null return proves the component would render.
 * (Vitest config uses environment: "node" and only matches *.test.ts,
 *  so we deliberately avoid @testing-library/react.)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
// Vitest's esbuild emits classic JSX (React.createElement) for .tsx imports
// in this repo, so provide React as a global before BrandSwitcher loads.
(globalThis as any).React = React;

let mockLocation = "/dashboard";
let mockBrands: Array<{ id: string; name: string }> = [];
let mockFlag = true;

vi.mock("wouter", () => ({
  useLocation: () => [mockLocation, () => {}] as const,
}));

vi.mock("@/hooks/useBrand", () => ({
  useBrand: () => ({
    activeBrand: mockBrands[0] ?? null,
    brands: mockBrands,
    setActiveBrand: () => {},
  }),
}));

vi.mock("@/lib/entitlements", () => ({
  useEntitlement: (_key: string) => ({ active: mockFlag }),
}));

vi.mock("lucide-react", () => ({ ChevronDown: () => null }));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: (props: any) => props.children,
  DropdownMenuTrigger: (props: any) => props.children,
  DropdownMenuContent: (props: any) => props.children,
  DropdownMenuItem: (props: any) => props.children,
  DropdownMenuSeparator: () => null,
}));

import { BrandSwitcher } from "../../client/src/components/BrandSwitcher";

function render() {
  return (BrandSwitcher as unknown as () => unknown)();
}

describe("BrandSwitcher route gate (Sprint 2e.1)", () => {
  beforeEach(() => {
    mockFlag = true;
    mockBrands = [{ id: "b1", name: "Acme" }];
    mockLocation = "/dashboard";
  });

  it("renders on /marketing/contacts when flag=true and brands=[one]", () => {
    mockLocation = "/marketing/contacts";
    expect(render()).not.toBeNull();
  });

  it("renders on /marketing/segments", () => {
    mockLocation = "/marketing/segments";
    expect(render()).not.toBeNull();
  });

  it("returns null on /dashboard", () => {
    mockLocation = "/dashboard";
    expect(render()).toBeNull();
  });

  it("returns null on /clients", () => {
    mockLocation = "/clients";
    expect(render()).toBeNull();
  });

  it("returns null on /settings/brands", () => {
    mockLocation = "/settings/brands";
    expect(render()).toBeNull();
  });

  it("preserves existing guards: returns null when flag=false even on /marketing/*", () => {
    mockFlag = false;
    mockLocation = "/marketing/contacts";
    expect(render()).toBeNull();
  });

  it("preserves existing guards: returns null when brands=[] even on /marketing/*", () => {
    mockBrands = [];
    mockLocation = "/marketing/contacts";
    expect(render()).toBeNull();
  });

  it("does NOT match /marketing-foo (strict prefix with trailing slash)", () => {
    mockLocation = "/marketing-foo";
    expect(render()).toBeNull();
  });

  it("does NOT match the literal /marketing (no trailing slash)", () => {
    mockLocation = "/marketing";
    expect(render()).toBeNull();
  });
});
