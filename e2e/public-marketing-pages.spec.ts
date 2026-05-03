/**
 * Smoke render coverage for static public marketing routes
 * (Task #431, audit §2.4).
 *
 * Each route is verified to:
 *  - Return 200 and load without a "page error" (uncaught JS exception)
 *  - Render its top-of-page anchor testid
 */
import { test, expect, type Page } from "@playwright/test";

// Vite-dev cold-compiles these marketing routes on first hit; under
// the parallel "anonymous" project (Task #432) several workers race
// for the same compile slot and the default 15s navigation budget can
// be exhausted on the first request. Bumping spec-locally only —
// production builds resolve these statically and don't need the extra
// headroom. (Same treatment as switch-from-pages.spec.ts.)
test.use({ navigationTimeout: 30_000 });

const ROUTES: Array<{
  path: string;
  anchor: string;
  description: string;
}> = [
  { path: "/features", anchor: '[data-testid="features-heading"]', description: "features" },
  { path: "/about", anchor: '[data-testid="about-heading"]', description: "about" },
  { path: "/security", anchor: '[data-testid="heading-security-title"]', description: "security" },
  { path: "/integrations", anchor: '[data-testid="link-zapier"]', description: "integrations" },
  { path: "/contact", anchor: '[data-testid="input-contact-name"]', description: "contact" },
];

async function expectNoPageErrors(
  page: Page,
  errors: string[],
  description: string,
): Promise<void> {
  // Auth probes 401 on public routes → not a real error.
  const real = errors.filter(
    (e) =>
      !/Failed to load resource.*40[13]/i.test(e) &&
      !/autocomplete attributes/i.test(e) &&
      !/DevTools/i.test(e),
  );
  expect(
    real,
    `[${description}] Unexpected page errors: ${real.join(" | ")}`,
  ).toEqual([]);
}

test.describe("Public marketing routes — smoke render", () => {
  for (const { path, anchor, description } of ROUTES) {
    test(`renders ${path}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

      const response = await page.goto(path);
      expect(response?.status() ?? 0, `${path} should not 5xx`).toBeLessThan(500);
      await expect(page.locator(anchor).first()).toBeVisible({ timeout: 15000 });
      await expectNoPageErrors(page, errors, description);
    });
  }
});
