// @vitest-environment jsdom
/**
 * Theme-flip regression tests for the Sprint 2m premium primitives
 * (task #180).
 *
 * Every premium primitive's JSDoc promises that its colors flow through
 * `--lux-*` (and friends) tokens that flip via the `.dark` class
 * selector. The render tests in `tests/unit/premium-*.test.tsx` only
 * exercise visible text, ARIA, and clicks — they would happily pass if
 * someone swapped a token for a hardcoded color.
 *
 * For every primitive this suite literally renders it twice — once
 * with `.dark` off and once with it on — by toggling
 * `document.documentElement.classList`. For each documented themed
 * surface/text/border it then asserts:
 *   1. both render passes emit the SAME `var(--token)` markup (so the
 *      primitive isn't sneakily branching on the active theme), and
 *   2. resolving that `var()` against the parsed theme files yields
 *      different values between light and dark.
 *
 * Resolution is grounded in the real `cherry-theme.css` + `index.css`
 * variable maps (see `premium-theme-flip.helper.ts`).
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import {
  applyTheme,
  expectFlips,
  expectFlipsAcrossRenders,
  getInlineProp,
  renderForStyles,
  renderInBothThemes,
  resolveValue,
  themeVars,
} from "./premium-theme-flip.helper";

import { AvatarStack } from "@/components/marketing-os/premium/avatar-stack";
import { ColorSwatchPicker } from "@/components/marketing-os/premium/color-swatch-picker";
import { EmailPreview } from "@/components/marketing-os/premium/email-preview";
import { FreshnessDot } from "@/components/marketing-os/premium/freshness-dot";
import { InlineEditableField } from "@/components/marketing-os/premium/inline-editable-field";
import { LogoDropzone } from "@/components/marketing-os/premium/logo-dropzone";
import { MetricCard } from "@/components/marketing-os/premium/metric-card";
import { PillTab } from "@/components/marketing-os/premium/pill-tab";
import { PremiumDialog } from "@/components/marketing-os/premium/premium-dialog";
import { SectionCard } from "@/components/marketing-os/premium/section-card";
import { StatusRibbon } from "@/components/marketing-os/premium/status-ribbon";

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark");
});

/**
 * Convenience: render `element` once per theme and pull both copies
 * of the same testid out for cross-render assertions.
 */
function pair(
  element: React.ReactElement,
  selector: string,
): { light: Element; dark: Element } {
  const { light, dark } = renderInBothThemes(element);
  const lightEl = light.querySelector(selector);
  const darkEl = dark.querySelector(selector);
  if (!lightEl || !darkEl) {
    throw new Error(
      `pair(${selector}): missing in renders (light=${!!lightEl}, dark=${!!darkEl})`,
    );
  }
  return { light: lightEl, dark: darkEl };
}

describe("theme map (sanity)", () => {
  it("parses both light and dark `--lux-surface` values", () => {
    expect(themeVars.light["--lux-surface"]).toBeDefined();
    expect(themeVars.dark["--lux-surface"]).toBeDefined();
    expect(themeVars.light["--lux-surface"]).not.toEqual(
      themeVars.dark["--lux-surface"],
    );
  });

  it("resolves nested var() references", () => {
    const light = resolveValue("var(--lux-text)", "light");
    const dark = resolveValue("var(--lux-text)", "dark");
    expect(light).not.toEqual(dark);
    expect(light).not.toMatch(/var\(--/);
    expect(dark).not.toMatch(/var\(--/);
  });
});

describe("theme flip — `.dark` class genuinely changes resolved tokens", () => {
  it("toggling `.dark` on the root flips `--lux-border` for the same MetricCard", () => {
    applyTheme("light");
    const { unmount } = render(<MetricCard label="ARR" value="$1M" />);
    const lightCard = screen.getByTestId("premium-metric-card");
    const borderRef = getInlineProp(lightCard, "border-color");
    expect(borderRef).toBe("var(--lux-border)");
    const lightResolved = resolveValue(borderRef!, "light");
    unmount();

    applyTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    render(<MetricCard label="ARR" value="$1M" />);
    const darkCard = screen.getByTestId("premium-metric-card");
    const darkRef = getInlineProp(darkCard, "border-color");
    expect(darkRef).toBe("var(--lux-border)");
    const darkResolved = resolveValue(darkRef!, "dark");

    expect(darkResolved).not.toBe(lightResolved);
    expect(lightResolved).toBe(themeVars.light["--lux-border"]);
    expect(darkResolved).toBe(themeVars.dark["--lux-border"]);
  });
});

describe("theme flip — every primitive's themed surfaces flip with `.dark`", () => {
  it("AvatarStack: fallback chip and overflow chip flip across light/dark renders", () => {
    const people = [{ name: "Ada Lovelace" }, { name: "Grace Hopper" }];
    const chipPair = pair(<AvatarStack people={people} />, '[data-testid="avatar-0"]');
    expectFlipsAcrossRenders(chipPair.light, chipPair.dark, "background");
    expectFlipsAcrossRenders(chipPair.light, chipPair.dark, "color");
    expectFlipsAcrossRenders(chipPair.light, chipPair.dark, "border");

    const overflowPair = pair(
      <AvatarStack
        people={[1, 2, 3, 4, 5, 6].map((n) => ({ name: `User ${n}` }))}
        max={2}
      />,
      '[data-testid="avatar-overflow"]',
    );
    expectFlipsAcrossRenders(overflowPair.light, overflowPair.dark, "border");
  });

  it("ColorSwatchPicker: label color flows through `--lux-text-secondary` and flips", () => {
    const labelPair = pair(
      <ColorSwatchPicker value="#cf3339" />,
      '[data-testid="premium-color-swatch-picker"] > div',
    );
    const { value } = expectFlipsAcrossRenders(
      labelPair.light,
      labelPair.dark,
      "color",
    );
    expect(value).toContain("--lux-text-secondary");
  });

  it("EmailPreview: container background and border flip across renders", () => {
    const rootPair = pair(
      <EmailPreview />,
      '[data-testid="premium-email-preview"]',
    );
    const { value: bg } = expectFlipsAcrossRenders(
      rootPair.light,
      rootPair.dark,
      "background",
    );
    expect(bg).toContain("--lux-surface-alt");
    const { value: border } = expectFlipsAcrossRenders(
      rootPair.light,
      rootPair.dark,
      "border-color",
    );
    expect(border).toContain("--lux-border");
  });

  it("FreshnessDot: secondary label color flows through `--lux-text-muted` and flips", () => {
    const labelPair = pair(
      <FreshnessDot lastActivityAt={new Date()} showLabel />,
      '[data-testid="premium-freshness-dot"] > span:last-child',
    );
    const { value } = expectFlipsAcrossRenders(
      labelPair.light,
      labelPair.dark,
      "color",
    );
    expect(value).toContain("--lux-text-muted");
  });

  it("InlineEditableField: idle trigger color flows through `--lux-text` and flips", () => {
    const triggerPair = pair(
      <InlineEditableField value="Acme Co." />,
      '[data-testid="inline-editable-trigger"]',
    );
    const { value } = expectFlipsAcrossRenders(
      triggerPair.light,
      triggerPair.dark,
      "color",
    );
    expect(value).toContain("--lux-text");
  });

  it("LogoDropzone: section label color flows through `--lux-text-secondary` and flips", () => {
    const labelPair = pair(
      <LogoDropzone />,
      '[data-testid="premium-logo-dropzone"] > div',
    );
    const { value } = expectFlipsAcrossRenders(
      labelPair.light,
      labelPair.dark,
      "color",
    );
    expect(value).toContain("--lux-text-secondary");
  });

  it("MetricCard: surface, border and shadow all flip across renders", () => {
    const cardPair = pair(
      <MetricCard label="MRR" value="$12,400" />,
      '[data-testid="premium-metric-card"]',
    );
    const { value: bg } = expectFlipsAcrossRenders(
      cardPair.light,
      cardPair.dark,
      "background",
    );
    expect(bg).toContain("--lux-surface");
    expectFlipsAcrossRenders(cardPair.light, cardPair.dark, "border-color");
    expectFlipsAcrossRenders(cardPair.light, cardPair.dark, "box-shadow");
  });

  it("PillTab: list background and border flip across renders", () => {
    const listPair = pair(
      <PillTab
        items={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ]}
        value="a"
        onValueChange={() => {}}
      />,
      '[data-testid="premium-pill-tab-list"]',
    );
    expectFlipsAcrossRenders(listPair.light, listPair.dark, "background");
    expectFlipsAcrossRenders(listPair.light, listPair.dark, "border");
  });

  it("PremiumDialog: dialog surface, border and shadow flip across renders", () => {
    // PremiumDialog uses a Radix portal that `renderToStaticMarkup`
    // does not materialise, so we render twice with Testing Library
    // (toggling `.dark` between renders) and inspect the dialog's
    // style attribute directly. The dialog itself sets only longhand
    // props (no `background-image` later overriding the shorthand),
    // so jsdom's IDL preserves them faithfully.
    applyTheme("light");
    const lightRender = render(
      <PremiumDialog
        open
        onOpenChange={() => {}}
        title="Edit brand"
        subtitle="Logo, colors, signature"
      >
        <div>body</div>
      </PremiumDialog>,
    );
    const lightDialog = screen.getByRole("dialog");
    const lightAttr = lightDialog.getAttribute("style") ?? "";
    lightRender.unmount();

    applyTheme("dark");
    render(
      <PremiumDialog
        open
        onOpenChange={() => {}}
        title="Edit brand"
        subtitle="Logo, colors, signature"
      >
        <div>body</div>
      </PremiumDialog>,
    );
    const darkDialog = screen.getByRole("dialog");
    const darkAttr = darkDialog.getAttribute("style") ?? "";

    // Build minimal stand-in elements carrying the captured style
    // strings so we can reuse `expectFlipsAcrossRenders` cleanly.
    const lightStandIn = document.createElement("div");
    lightStandIn.setAttribute("style", lightAttr);
    const darkStandIn = document.createElement("div");
    darkStandIn.setAttribute("style", darkAttr);

    const { value: bg } = expectFlipsAcrossRenders(
      lightStandIn,
      darkStandIn,
      "background",
    );
    expect(bg).toContain("--lux-surface");
    expectFlipsAcrossRenders(lightStandIn, darkStandIn, "border-color");
    expectFlipsAcrossRenders(lightStandIn, darkStandIn, "box-shadow");
  });

  it("SectionCard: surface, border and shadow all flip across renders", () => {
    const cardPair = pair(
      <SectionCard title="Brand identity" subtitle="Logo, colors, signature">
        <div>body</div>
      </SectionCard>,
      '[data-testid="premium-section-card"]',
    );
    const { value: bg } = expectFlipsAcrossRenders(
      cardPair.light,
      cardPair.dark,
      "background",
    );
    expect(bg).toContain("--lux-surface");
    expectFlipsAcrossRenders(cardPair.light, cardPair.dark, "border-color");
    expectFlipsAcrossRenders(cardPair.light, cardPair.dark, "box-shadow");
  });

  it("StatusRibbon: stage colors flow through `--stage-*` tokens (no hardcoded colors)", () => {
    // Stage tokens are intentionally brand-fixed so they read the same
    // value in both modes — but the JSDoc still promises token usage.
    // We render under both themes to confirm the markup is identical
    // (no theme-conditional branch) and that the tokens resolve to
    // concrete colors.
    const { light, dark } = renderInBothThemes(<StatusRibbon stage="customer" />);
    const sel = '[data-testid="premium-status-ribbon-customer"]';
    const lightRibbon = light.querySelector(sel)!;
    const darkRibbon = dark.querySelector(sel)!;

    const lightBg = getInlineProp(lightRibbon, "background-image");
    const darkBg = getInlineProp(darkRibbon, "background-image");
    expect(lightBg).toBe(darkBg);
    expect(lightBg).toMatch(/var\(--stage-customer-from\)/);
    expect(lightBg).toMatch(/var\(--stage-customer-to\)/);

    const color = getInlineProp(lightRibbon, "color");
    expect(color).toMatch(/var\(--stage-customer-text\)/);

    expect(resolveValue(lightBg!, "light")).not.toMatch(/var\(--/);
    expect(resolveValue(color!, "light")).not.toMatch(/var\(--/);
  });

  it("expectFlips (single-render fallback) still works for incidental token checks", () => {
    // Smoke test for the simpler resolution-only helper, which other
    // suites or future tests can use when a full re-render is overkill.
    const doc = renderForStyles(<MetricCard label="t" value="x" />);
    const card = doc.querySelector('[data-testid="premium-metric-card"]')!;
    expectFlips(card, "border-color");
  });
});
