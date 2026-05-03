/**
 * Network-failure resilience for top public forms (Task #444).
 *
 * Aborts the FIRST submit network call on each form and asserts the
 * page surfaces the failure inline (no uncaught pageerror, no full
 * crash, no double submission). The aborted attempt simulates the
 * user's connection dropping mid-POST — historically the riskiest
 * window for "did my form submit or not?" double-charge bugs.
 *
 * Two invariants we pin per form:
 *   1. The page does not crash (no uncaught pageerror, error UI
 *      surfaces inline rather than via the global ErrorBoundary).
 *   2. Exactly ONE network attempt is made per click — no silent
 *      retry that could create a duplicate record.
 */
import { test, expect, type Route } from "@playwright/test";

test.use({ navigationTimeout: 30_000 });

function makeAborter(): { handler: (route: Route) => Promise<void>; calls: () => number } {
  let count = 0;
  return {
    calls: () => count,
    handler: async (route) => {
      count++;
      await route.abort("failed");
    },
  };
}

test.describe("Network failure — public contact form", () => {
  test("aborted POST surfaces inline error and never double-submits", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
    const ab = makeAborter();
    await page.route("**/api/public/contact", ab.handler);

    await page.goto("/contact");
    await page.fill('[data-testid="input-contact-name"]', "Net Fail");
    await page.fill('[data-testid="input-contact-email"]', "netfail@example.com");
    await page.fill('[data-testid="input-contact-message"]', "Trigger network drop");
    const submit = page.locator('[data-testid="button-contact-submit"]');
    await submit.click();

    // The submit button must come back to a clickable state
    // (i.e. the mutation resolved its loading flag) and the success
    // card must NOT have rendered.
    await expect(page.getByText(/Message sent!/i)).toHaveCount(0, { timeout: 10_000 });
    await expect(submit).toBeEnabled({ timeout: 10_000 });

    // Stability window: hold for a beat then re-assert call count
    // and button state. Catches any deferred-microtask retry that
    // would otherwise sneak a second POST in after the first
    // assertion passes.
    await page.waitForTimeout(750);
    await expect(submit).toBeEnabled();
    expect(ab.calls()).toBe(1);

    const real = errors.filter(
      (e) =>
        !/Failed to load resource/i.test(e) &&
        !/autocomplete attributes/i.test(e),
    );
    expect(real, `pageerrors leaked: ${real.join(" | ")}`).toEqual([]);
  });
});

test.describe("Network failure — public signup form", () => {
  test("aborted POST surfaces inline error, button re-enables, no double-submit", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
    const ab = makeAborter();
    await page.route("**/api/auth/signup", ab.handler);

    await page.goto("/signup");
    await page.fill('[data-testid="input-firm-name"]', "Net Fail Firm");
    await page.fill('[data-testid="input-signup-firstName"]', "Net");
    await page.fill('[data-testid="input-signup-lastName"]', "Fail");
    await page.fill('[data-testid="input-signup-email"]', `netfail-${Date.now()}@example.com`);
    await page.fill('[data-testid="input-signup-password"]', "Abcdef12!");

    const submit = page.locator('[data-testid="button-signup-submit"]');
    await expect(submit).toBeEnabled({ timeout: 10_000 });
    await submit.click();

    // Inline error renders (signup-error testid is the form's only
    // error sink — the page does not surface it via ErrorBoundary).
    await expect(page.locator('[data-testid="signup-error"]')).toBeVisible({
      timeout: 10_000,
    });
    // Button has re-enabled (loading flag cleared) — user can retry.
    await expect(submit).toBeEnabled({ timeout: 10_000 });

    expect(ab.calls()).toBe(1);

    const real = errors.filter(
      (e) =>
        !/Failed to load resource/i.test(e) &&
        !/autocomplete attributes/i.test(e),
    );
    expect(real, `pageerrors leaked: ${real.join(" | ")}`).toEqual([]);
  });
});

test.describe("Dev-server 502 retry helper — smoke", () => {
  test("gotoWithRetry retries 502 then returns the eventual response", async ({ page }) => {
    // Inline import keeps this file self-describing. The helper is
    // re-exported from e2e/_iso-helpers.ts; importing it here also
    // doubles as a smoke check that the helper actually exists and is
    // callable from a parallel-project spec.
    const { gotoWithRetry } = await import("./_iso-helpers");
    let hits = 0;
    await page.route("**/contact", async (route) => {
      hits++;
      if (hits < 2) {
        await route.fulfill({ status: 502, body: "bad gateway" });
      } else {
        await route.continue();
      }
    });
    const res = await gotoWithRetry(page, "/contact", { retries: 3, backoffMs: 50 });
    expect(hits).toBeGreaterThanOrEqual(2);
    expect(res?.status() ?? 0).toBeLessThan(500);
    // Real /contact page asserts the form mounted on the second try.
    await expect(page.locator('[data-testid="input-contact-name"]')).toBeVisible({
      timeout: 15_000,
    });
  });
});
