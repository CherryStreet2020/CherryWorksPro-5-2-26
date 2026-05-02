/**
 * Sprint 2i.5 — entitlement-off smoke (stealth-404 contract).
 *
 * Logs in as the seeded `cwpro-dev-pso` admin (PSO-only org with no
 * `marketing_os` row) and asserts the three guarantees Sprint 2i must
 * keep regression-proof:
 *
 *   1. GET /api/me/entitlements returns marketing_os: false.
 *   2. GET /api/marketing/contacts returns HTTP 404 (never 403, never
 *      a hint that the feature exists). Body must not name the feature.
 *   3. The Marketing sidebar group is NOT in the DOM at all.
 *   4. Visiting /marketing/contacts resolves to the standard NotFound
 *      page — no marketing UI renders.
 *
 * Login pattern + console-error filter mirror marketing-contacts-smoke.spec.ts.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";

const BASE = `http://localhost:${process.env.PORT || 5000}`;
const PSO_EMAIL = "admin.pso.test@cwpro.dev";
const PSO_PASS = "psoAdmin123";

async function loginApi(request: APIRequestContext) {
  const r = await request.post(`${BASE}/api/auth/login`, {
    data: { email: PSO_EMAIL, password: PSO_PASS },
  });
  expect(r.status()).toBe(200);
}

test.describe("Sprint 2i — entitlement OFF smoke (cwpro-dev-pso)", () => {
  test("stealth-404: API + sidebar + route resolve to NotFound", async ({ request, page }) => {
    // ── API layer ───────────────────────────────────────────────────
    await loginApi(request);

    const ent = await request.get(`${BASE}/api/me/entitlements`);
    expect(ent.status()).toBe(200);
    const entBody = await ent.json();
    expect(entBody.marketing_os).toBe(false);
    expect(entBody.pso_core).toBe(true);

    const contacts = await request.get(`${BASE}/api/marketing/contacts`);
    expect(contacts.status()).toBe(404);
    const contactsBody = await contacts.text();
    // Stealth: no mention of marketing or entitlements anywhere in the body.
    expect(contactsBody.toLowerCase()).not.toContain("marketing");
    expect(contactsBody.toLowerCase()).not.toContain("entitle");
    expect(contactsBody.toLowerCase()).not.toContain("forbidden");

    // Companies endpoint follows the same contract.
    const companies = await request.get(`${BASE}/api/marketing/companies`);
    expect(companies.status()).toBe(404);

    // ── UI layer ────────────────────────────────────────────────────
    const consoleErrors: string[] = [];
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(`console.error: ${m.text()}`);
    });

    await page.goto("/login");
    await page.fill('[data-testid="input-email"]', PSO_EMAIL);
    await page.fill('[data-testid="input-password"]', PSO_PASS);
    await page.click('[data-testid="button-login"]');
    await page.waitForLoadState("networkidle", { timeout: 15000 });

    // Sidebar Marketing group MUST NOT be rendered.
    await expect(page.locator('[data-testid="link-section-marketing"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="button-section-toggle-marketing"]')).toHaveCount(0);
    // No marketing nav links either.
    await expect(page.locator('[data-testid="link-contacts"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="link-companies"]')).toHaveCount(0);

    // Capture the non-entitled sidebar for the proof bundle.
    await page.screenshot({
      path: "proof/sprint-2i/screenshots/non-entitled-sidebar.png",
      fullPage: false,
      clip: { x: 0, y: 0, width: 320, height: 800 },
    });

    // /marketing/contacts must resolve to the app's NotFound page —
    // no marketing component code paths execute.
    await page.goto("/marketing/contacts");
    await page.waitForLoadState("networkidle", { timeout: 15000 });
    const errorTitle = page.locator('[data-testid="text-error-title"]');
    await expect(errorTitle).toBeVisible({ timeout: 10000 });
    // Tighten: must be the NotFound page specifically, not a 403/500/boundary
    // page that share the same test id.
    await expect(errorTitle).toHaveText(/Page Not Found/i);
    // Ensure no marketing UI leaked: contacts page-title must not exist.
    await expect(page.locator('[data-testid="text-page-title"]')).toHaveCount(0);

    // /marketing/companies — same contract.
    await page.goto("/marketing/companies");
    await page.waitForLoadState("networkidle", { timeout: 15000 });
    const errorTitle2 = page.locator('[data-testid="text-error-title"]');
    await expect(errorTitle2).toBeVisible({ timeout: 10000 });
    await expect(errorTitle2).toHaveText(/Page Not Found/i);

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
