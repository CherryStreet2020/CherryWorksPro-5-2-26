/**
 * Sprint 2k / Task #392 — MarketingOsUpgradeModal behavior.
 *
 * After Task #392, the primary CTA no longer kicks off a Stripe Checkout
 * — it closes the dialog and routes the admin to /settings/billing where
 * they can upgrade their plan tier. The telemetry event ID is preserved
 * so the existing funnel dashboard keeps working.
 *
 * Vitest config is environment: "node" — we follow the same pattern as
 * brand-switcher.test.ts: stub external imports, then call the component
 * as a plain function and walk its returned React tree to find the
 * buttons we care about. We avoid @testing-library/react.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
(globalThis as any).React = React;

// Stub React.useState so the modal can be invoked as a plain function
// outside of a real render. We always return [initial, noopSetter];
// the modal no longer uses useState after Task #392 but the stub remains
// harmless and future-proofs the test against a hook addition.
vi.mock("react", async () => {
  const actual: any = await vi.importActual("react");
  return {
    ...actual,
    useState: (initial: any) => [
      typeof initial === "function" ? initial() : initial,
      () => {},
    ],
  };
});

const navigateMock = vi.fn();
const trackMock = vi.fn();

// Wouter's useLocation returns [path, navigate]. We only care about the
// navigate setter — the modal calls it with "/settings/billing".
vi.mock("wouter", () => ({
  useLocation: () => ["/", navigateMock],
}));

vi.mock("@/lib/marketing-os-telemetry", () => ({
  trackMarketingOsEvent: (...args: unknown[]) => trackMock(...args),
}));

// Stub Dialog primitives so we get a deterministic tree regardless of
// Radix internals. Each one just renders its children.
vi.mock("@/components/ui/dialog", () => {
  const passthrough = (props: any) => props.children ?? null;
  return {
    Dialog: passthrough,
    DialogContent: passthrough,
    DialogHeader: passthrough,
    DialogTitle: passthrough,
    DialogDescription: passthrough,
    DialogFooter: passthrough,
  };
});

vi.mock("@/components/ui/button", async () => {
  const ReactMod = await import("react");
  return {
    Button: (props: any) =>
      ReactMod.createElement("button", { ...props }, props.children),
  };
});

vi.mock("lucide-react", () => ({
  Sparkles: () => null,
}));

beforeEach(() => {
  navigateMock.mockReset();
  trackMock.mockReset();
});

import { MarketingOsUpgradeModal } from "../../client/src/components/marketing-os-upgrade-modal";

interface AnyEl {
  type?: any;
  props?: any;
}

function flatten(node: AnyEl | AnyEl[] | string | number | null | undefined): AnyEl[] {
  if (node == null || typeof node === "string" || typeof node === "number") return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  const arr: AnyEl[] = [node];
  const kids = node?.props?.children;
  if (kids != null) arr.push(...flatten(kids));
  return arr;
}

function renderModal(open = true) {
  const onOpenChange = vi.fn();
  const tree = (MarketingOsUpgradeModal as unknown as (
    p: { open: boolean; onOpenChange: (o: boolean) => void },
  ) => any)({ open, onOpenChange });
  return { tree, nodes: flatten(tree), onOpenChange };
}

function findByTestId(nodes: AnyEl[], id: string): AnyEl | undefined {
  return nodes.find(n => n?.props && n.props["data-testid"] === id);
}

describe("MarketingOsUpgradeModal (Task #392 — tier-derived CTA)", () => {
  it("renders the headline, four feature bullets, price line, and both buttons", () => {
    const { nodes } = renderModal(true);
    expect(findByTestId(nodes, "dialog-marketing-os-upgrade")).toBeTruthy();
    expect(findByTestId(nodes, "text-upgrade-title")).toBeTruthy();
    expect(findByTestId(nodes, "text-upgrade-subtitle")).toBeTruthy();
    expect(findByTestId(nodes, "text-upgrade-price")).toBeTruthy();
    expect(findByTestId(nodes, "button-upgrade-marketing-os")).toBeTruthy();
    expect(findByTestId(nodes, "button-upgrade-not-now")).toBeTruthy();
    for (let i = 0; i < 4; i++) {
      expect(findByTestId(nodes, `text-upgrade-feature-${i}`)).toBeTruthy();
    }
  });

  it("price label communicates the new bundling instead of $99/mo", () => {
    const { nodes } = renderModal(true);
    const price = findByTestId(nodes, "text-upgrade-price");
    const text = (price?.props?.children ?? "") as string;
    expect(text).toContain("Business");
    expect(text).toContain("Enterprise");
    expect(text).not.toContain("$99");
  });

  it("primary button closes the dialog and navigates to /settings/billing", () => {
    const { nodes, onOpenChange } = renderModal(true);
    const primary = findByTestId(nodes, "button-upgrade-marketing-os");
    primary!.props.onClick();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(navigateMock).toHaveBeenCalledWith("/settings/billing");
  });

  it("primary button still fires the discovery telemetry event for funnel tracking", () => {
    const { nodes } = renderModal(true);
    const primary = findByTestId(nodes, "button-upgrade-marketing-os");
    primary!.props.onClick();
    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledWith(
      "marketing_os.discovery.checkout_clicked",
    );
  });

  it("secondary 'Not now' button closes the dialog without navigating", () => {
    const { nodes, onOpenChange } = renderModal(true);
    const secondary = findByTestId(nodes, "button-upgrade-not-now");
    secondary!.props.onClick();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
