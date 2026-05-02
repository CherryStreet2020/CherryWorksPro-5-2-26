/**
 * Sprint 2i.5 — entitlement-on smoke.
 *
 * Logs in as the `cwpro-dev-qa` admin (the seeded org that has the
 * `marketing_os` entitlement active) and verifies the "happy path"
 * that PSO-only orgs must NOT see:
 *   1. GET /api/me/entitlements returns marketing_os: true
 *   2. GET /api/marketing/contacts returns 200 (route is reachable)
 *   3. The Marketing sidebar group renders
 *   4. Visiting /marketing/contacts does NOT resolve to NotFound
 *      (the page renders its own UI — either the brand picker or the
 *      contacts header — never the 404 page)
 *
 * Login pattern + console-error filter mirror marketing-contacts-smoke.spec.ts.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";

const BASE = `http://localhost:${process.env.PORT || 5000}`;
const QA_EMAIL = "admin.test@cwpro.dev";
const QA_PASS = "admin123";

async function loginApi(request: APIRequestContext) {
  const r = await request.post(`${BASE}/api/auth/login`, {
    data: { email: QA_EMAIL, password: QA_PASS },
  });
  expect(r.status()).toBe(200);
}

test.describe("Sprint 2i — entitlement ON smoke (cwpro-dev-qa)", () => {
  test("marketing API + sidebar + page render", async ({ request, page }) => {
    // ── API layer ───────────────────────────────────────────────────
    await loginApi(request);

    const ent = await request.get(`${BASE}/api/me/entitlements`);
    expect(ent.status()).toBe(200);
    const entBody = await ent.json();
    expect(entBody.marketing_os).toBe(true);
    expect(entBody.pso_core).toBe(true);

    const contacts = await request.get(`${BASE}/api/marketing/contacts`);
    expect(contacts.status()).toBe(200);
    expect(Array.isArray(await contacts.json())).toBe(true);

    // ── UI layer ────────────────────────────────────────────────────
    const consoleErrors: string[] = [];
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(`console.error: ${m.text()}`);
    });

    await page.goto("/login");
    await page.fill('[data-testid="input-email"]', QA_EMAIL);
    await page.fill('[data-testid="input-password"]', QA_PASS);
    await page.click('[data-testid="button-login"]');
    await page.waitForLoadState("networkidle", { timeout: 15000 });

    // Marketing sidebar group is present (label "Marketing"
    // → testid "link-section-marketing" or the toggle button when no hubUrl).
    const sidebarMarketing = page.locator(
      '[data-testid="link-section-marketing"], [data-testid="button-section-toggle-marketing"]',
    );
    await expect(sidebarMarketing.first()).toBeVisible({ timeout: 10000 });

    // Capture the entitled sidebar for the proof bundle.
    await page.screenshot({
      path: "proof/sprint-2i/screenshots/entitled-sidebar.png",
      fullPage: false,
      clip: { x: 0, y: 0, width: 320, height: 800 },
    });

    // /marketing/contacts must NOT resolve to NotFound. The page either
    // shows the brand picker empty state or the Contacts header — both
    // are valid; what we forbid is the NotFound 404.
    await page.goto("/marketing/contacts");
    await page.waitForLoadState("networkidle", { timeout: 15000 });
    await expect(page.locator('[data-testid="text-error-title"]')).toHaveCount(0);

    // /marketing/companies — same contract.
    await page.goto("/marketing/companies");
    await page.waitForLoadState("networkidle", { timeout: 15000 });
    await expect(page.locator('[data-testid="text-error-title"]')).toHaveCount(0);

    const realErrors = consoleErrors.filter(
      (e) =>
        !/Failed to load resource.*401/i.test(e) &&
        !/Failed to load resource.*404/i.test(e) &&
        !/autocomplete attributes/i.test(e) &&
        !/DevTools/i.test(e),
    );
    expect(realErrors, `Unexpected console errors: ${realErrors.join(" | ")}`).toEqual([]);
  });
});
