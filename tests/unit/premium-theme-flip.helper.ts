/**
 * Helpers for premium-primitive theme-flip regression tests
 * (task #180).
 *
 * Parses the CSS custom-property declarations from
 * `client/src/lib/cherry-theme.css` and `client/src/index.css` so the
 * tests can:
 *   1. Toggle `.dark` on `document.documentElement` between renders
 *   2. Read the raw inline `style` attribute a primitive emitted
 *   3. Resolve any `var(--token)` reference against the parsed
 *      light-mode and dark-mode maps and assert the resolved values
 *      differ — which proves the primitive is actually consuming a
 *      themed token rather than a hardcoded color
 */
import fs from "node:fs";
import path from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const ROOT = path.resolve(__dirname, "../..");
const CHERRY_CSS = fs.readFileSync(
  path.join(ROOT, "client/src/lib/cherry-theme.css"),
  "utf-8",
);
const INDEX_CSS = fs.readFileSync(
  path.join(ROOT, "client/src/index.css"),
  "utf-8",
);

type VarMap = Record<string, string>;

function parseBlocks(css: string, selector: string): VarMap {
  const out: VarMap = {};
  const lines = css.split("\n");
  let depth = 0;
  let inBlock = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!inBlock) {
      // Match an exact selector line like `:root {` or `.dark {` —
      // we deliberately skip compound selectors that contain the
      // target as a prefix (e.g. `:root:not(.dark) ...`).
      if (line === `${selector} {` || line === `${selector}{`) {
        inBlock = true;
        depth = 1;
      }
      continue;
    }
    // Track braces in case a future block nests rules.
    for (const ch of line) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    if (depth <= 0) {
      inBlock = false;
      continue;
    }
    const m = line.match(/^(--[a-zA-Z0-9-]+)\s*:\s*(.+?);?\s*$/);
    if (m) out[m[1]] = m[2].replace(/;$/, "").trim();
  }
  return out;
}

const lightVars: VarMap = {
  ...parseBlocks(CHERRY_CSS, ":root"),
  ...parseBlocks(INDEX_CSS, ":root"),
};
const darkVars: VarMap = {
  ...lightVars,
  ...parseBlocks(CHERRY_CSS, ".dark"),
  ...parseBlocks(INDEX_CSS, ".dark"),
};

export const themeVars = { light: lightVars, dark: darkVars };

/**
 * Recursively expand every `var(--name[, fallback])` reference inside
 * `value` using the variable map for the requested theme. Resolves
 * nested vars (a token whose value points at another token) up to a
 * sane recursion depth.
 */
export function resolveValue(value: string, mode: "light" | "dark"): string {
  const map = themeVars[mode];
  let prev = "";
  let cur = value;
  let depth = 0;
  while (cur !== prev && depth < 12) {
    prev = cur;
    cur = cur.replace(
      /var\(\s*(--[a-zA-Z0-9-]+)\s*(?:,\s*([^)]*))?\)/g,
      (_m, name: string, fallback?: string) => {
        if (map[name] != null) return map[name];
        if (fallback != null) return fallback;
        return `var(${name})`;
      },
    );
    depth++;
  }
  return cur.trim();
}

/** Toggle `.dark` on the root element so primitives re-resolve themed tokens. */
export function applyTheme(mode: "light" | "dark"): void {
  document.documentElement.classList.toggle("dark", mode === "dark");
}

/**
 * Render a React element to static HTML and parse it back into a
 * Document so we can read the raw inline `style` attribute exactly as
 * React serialised it.
 *
 * We do NOT use `@testing-library/react`'s `render` for style
 * inspection because jsdom's `CSSStyleDeclaration` drops the
 * `background` shorthand when a longhand `background-image` is set
 * after it via the IDL — a quirk that masks legitimate `var()`
 * references in primitives like `MetricCard` / `SectionCard` (which
 * combine a themed `background` with a brand-fixed gradient overlay).
 * Parsing pre-serialised HTML side-steps the IDL altogether and gives
 * us the exact attribute string the component emitted.
 */
export function renderForStyles(element: React.ReactElement): Document {
  const html = renderToStaticMarkup(element);
  // jsdom is the active test env (`@vitest-environment jsdom`), so
  // `DOMParser` is available globally. Parsing via `parseFromString`
  // preserves `style` attribute strings verbatim — unlike setting
  // `style.X` through the IDL.
  const parser = new DOMParser();
  return parser.parseFromString(`<!doctype html>${html}`, "text/html");
}

/**
 * Read a single CSS property out of an element's raw inline `style`
 * attribute. We bypass `el.style.X` because jsdom normalises some
 * shorthand properties (e.g. `background`) and may swallow the raw
 * `var(...)` reference, which would defeat the test.
 */
export function getInlineProp(
  el: Element,
  prop: string,
): string | undefined {
  const attr = el.getAttribute("style") ?? "";
  // Match `prop: ...;` or end-of-string. Use a non-greedy capture and
  // require the property name to appear at the start of a declaration
  // so `border-color` does not match `border`.
  const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "i");
  const m = attr.match(re);
  return m?.[1].trim();
}

/**
 * Assert that `prop` on `el` is rendered through a `--lux-*`-style
 * token AND that the resolved value differs between light and dark.
 * Returns the resolved values for further inspection.
 */
export function expectFlips(
  el: Element,
  prop: string,
): { value: string; light: string; dark: string } {
  const value = getInlineProp(el, prop);
  if (!value) {
    throw new Error(
      `Expected element to have inline style \`${prop}\`, got: ${el.getAttribute("style")}`,
    );
  }
  if (!/var\(--/.test(value)) {
    throw new Error(
      `Expected inline \`${prop}\` to reference a CSS custom property, got: ${value}`,
    );
  }
  const light = resolveValue(value, "light");
  const dark = resolveValue(value, "dark");
  if (light === dark) {
    throw new Error(
      `Expected \`${prop}\` (${value}) to flip between light and dark, but both resolve to: ${light}`,
    );
  }
  return { value, light, dark };
}

/**
 * Render the same React element twice — once with `.dark` off and
 * once with it on — and return both Documents for inspection.
 *
 * This satisfies the task spec literally: "renders each primitive
 * twice (light and dark) by toggling document.documentElement.classList".
 * Even though premium primitives currently emit the same `var(--token)`
 * markup regardless of theme, doing the toggle for real would catch a
 * future regression where someone branches on `document.documentElement`
 * inside render and bakes the active theme into the markup.
 */
export function renderInBothThemes(
  element: React.ReactElement,
): { light: Document; dark: Document } {
  applyTheme("light");
  const light = renderForStyles(element);
  applyTheme("dark");
  const dark = renderForStyles(element);
  // Reset so subsequent tests start from a clean slate.
  applyTheme("light");
  document.documentElement.classList.remove("dark");
  return { light, dark };
}

/**
 * Cross-render variant of `expectFlips`: takes the same logical element
 * picked out of the light-theme and dark-theme renders, asserts that
 * (a) both render passes emit the SAME `var()` reference (proving the
 * primitive does not branch on the active theme), (b) the reference is
 * a token, and (c) the resolved value differs between the two themes.
 */
export function expectFlipsAcrossRenders(
  lightEl: Element | null,
  darkEl: Element | null,
  prop: string,
): { value: string; light: string; dark: string } {
  if (!lightEl || !darkEl) {
    throw new Error(
      `expectFlipsAcrossRenders: missing element (light=${!!lightEl}, dark=${!!darkEl})`,
    );
  }
  const lightVal = getInlineProp(lightEl, prop);
  const darkVal = getInlineProp(darkEl, prop);
  if (!lightVal || !darkVal) {
    throw new Error(
      `Expected inline style \`${prop}\` in both renders. light=${lightVal} dark=${darkVal}`,
    );
  }
  if (lightVal !== darkVal) {
    throw new Error(
      `Inline \`${prop}\` should be theme-agnostic in markup but differs: light=${lightVal} dark=${darkVal}`,
    );
  }
  if (!/var\(--/.test(lightVal)) {
    throw new Error(
      `Expected inline \`${prop}\` to reference a CSS custom property, got: ${lightVal}`,
    );
  }
  const light = resolveValue(lightVal, "light");
  const dark = resolveValue(darkVal, "dark");
  if (light === dark) {
    throw new Error(
      `Expected \`${prop}\` (${lightVal}) to flip between light and dark, but both resolve to: ${light}`,
    );
  }
  return { value: lightVal, light, dark };
}
