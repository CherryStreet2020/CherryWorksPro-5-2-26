/**
 * Public competitor "switch-from-*" landing pages
 * (Task #431, audit §2.4 — every switch-from-* listed as Untested).
 *
 * For each LP route: navigate, assert no 5xx, no uncaught page error.
 * These pages are static marketing content; smoke render is the
 * appropriate level of coverage.
 */
import { test, expect } from "@playwright/test";

// Vite-dev cold-compiles these marketing routes on first hit; under
// the parallel "anonymous" project (Task #432) several workers race
// for the same compile slot, so the default 15s navigation budget can
// be exhausted on the first request. Bumping spec-locally only —
// production builds resolve these statically and don't need the
// extra headroom.
test.use({ navigationTimeout: 30_000 });

const ROUTES = [
  "/switch-from-quickbooks",
  "/switch-from-freshbooks",
  "/switch-from-xero",
  "/switch-from-wave",
  "/switch-from-harvest",
  "/switch-from-bigtime",
  "/switch-from-scoro",
  "/switch-from-paymo",
  "/compare",
];

test.describe("Public switch-from / compare pages", () => {
  for (const path of ROUTES) {
    test(`smoke renders ${path}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
      const response = await page.goto(path);
      expect(
        (response?.status() ?? 0) < 500,
        `${path} returned a 5xx`,
      ).toBeTruthy();
      // Some content must appear within the navigation budget; we
      // tolerate any visible <h1> as the proof-of-life anchor since
      // these LPs share no canonical testid.
      await expect(page.locator("h1").first()).toBeVisible({ timeout: 15000 });
      const real = errors.filter(
        (e) =>
          !/Failed to load resource.*40[13]/i.test(e) &&
          !/autocomplete attributes/i.test(e),
      );
      expect(real, `${path} page errors: ${real.join(" | ")}`).toEqual([]);
    });
  }
});
