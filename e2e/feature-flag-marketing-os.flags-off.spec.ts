import { test, expect } from "../tests/helpers/po/fixtures";
import { setEntitlement } from "../tests/helpers/po/tier";
import { BASE } from "../tests/helpers/po/auth";

test.describe("MARKETING_OS_ENABLED=false (against the dedicated flag-off web server)", () => {
  test("API: every gated /api/marketing/* surface 404s even with entitlement granted", async ({
    isolatedOrg,
  }) => {
    const { request, orgId } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);

    const brands = await request.get(`${BASE}/api/brands`);
    expect(brands.status(), "/api/brands").toBe(404);

    const embed = await request.get(`${BASE}/embed/chat.js`);
    expect(embed.status(), "/embed/chat.js").toBe(404);

    const surfaces = [
      "/api/marketing/contacts",
      "/api/marketing/companies",
      "/api/marketing/tags",
      "/api/marketing/segments",
      "/api/marketing/campaigns",
      "/api/marketing/activities",
      "/api/marketing/prospects",
    ];
    for (const path of surfaces) {
      const r = await request.get(`${BASE}${path}`);
      expect(r.status(), `${path} must 404 when env flag is OFF`).toBe(404);
    }
  });

  test("API: marketing chat POST stealth-404s", async ({ isolatedOrg }) => {
    const { request, csrf } = isolatedOrg;
    const r = await request.post(`${BASE}/api/marketing/chat`, {
      data: {
        brandSlug: "any",
        sessionToken: "00000000-0000-0000-0000-000000000000",
        message: "ping",
      },
      headers: { "X-CSRF-Token": csrf },
    });
    expect(r.status()).toBe(404);
  });

  test("UI: marketing sidebar section is hidden for an admin", async ({
    page,
    isolatedOrg,
  }) => {
    const { orgId, email, password } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);

    await page.goto("/login");
    await page.waitForSelector('[data-testid="input-email"]', { timeout: 15000 });
    await page.fill('[data-testid="input-email"]', email);
    await page.fill('[data-testid="input-password"]', password);
    await page.click('[data-testid="button-login"]');
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => undefined);

    await page.goto("/");
    await expect(
      page.locator('[role="navigation"][aria-label="Main navigation"]'),
    ).toBeVisible({ timeout: 15000 });

    expect(
      await page.locator('[data-testid="section-marketing-active"]').count(),
      "marketing sidebar section must be absent when MARKETING_OS_ENABLED is OFF",
    ).toBe(0);
    expect(
      await page.locator('[data-testid="section-marketing-locked"]').count(),
    ).toBe(0);
  });

  test("UI: navigating directly to /marketing/contacts does not render the marketing list", async ({
    page,
    isolatedOrg,
  }) => {
    const { orgId, email, password } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);

    await page.goto("/login");
    await page.waitForSelector('[data-testid="input-email"]', { timeout: 15000 });
    await page.fill('[data-testid="input-email"]', email);
    await page.fill('[data-testid="input-password"]', password);
    await page.click('[data-testid="button-login"]');
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => undefined);

    const resp = await page.goto("/marketing/contacts", { waitUntil: "domcontentloaded" });
    // Client-side router still mounts the SPA shell, but the marketing
    // contacts page must NOT render its data table or the "New Contact"
    // CTA when the env flag is OFF — its data fetch would 404 anyway.
    expect(resp?.status() ?? 200, "SPA shell still serves").toBeLessThan(500);
    await page.waitForTimeout(750);
    expect(
      await page.locator('[data-testid="table-contacts"]').count(),
      "marketing contacts table must not render under flag OFF",
    ).toBe(0);
    expect(
      await page.locator('[data-testid="button-new-contact"]').count(),
    ).toBe(0);
  });
});
