import { test, expect } from "../tests/helpers/po/fixtures";
import { setEntitlement } from "../tests/helpers/po/tier";
import { BASE } from "../tests/helpers/po/auth";

test.describe("MARKETING_OS_ENABLED=true (against the dev workflow)", () => {
  test("API: /api/brands and a representative /api/marketing/* route are reachable when entitlement is granted", async ({
    isolatedOrg,
  }) => {
    const { request, orgId } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);

    const brands = await request.get(`${BASE}/api/brands`);
    expect(brands.status()).toBe(200);
    expect(Array.isArray(await brands.json())).toBe(true);

    const contacts = await request.get(`${BASE}/api/marketing/contacts`);
    expect(contacts.status()).toBe(200);

    const embed = await request.get(`${BASE}/embed/chat.js`);
    expect(embed.status()).toBe(200);
  });

  test("UI: marketing sidebar section renders for an entitled admin", async ({
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
      page.locator('[data-testid="section-marketing-active"]'),
    ).toBeVisible({ timeout: 15000 });
  });

  test("API: entitlement gate still 404s when entitlement is absent", async ({
    isolatedOrg,
  }) => {
    const { request, orgId } = isolatedOrg;
    const { setOrgTier } = await import("../tests/helpers/po/tier");
    await setOrgTier(orgId, "STARTER");
    await setEntitlement(orgId, "marketing_os", false);

    const contacts = await request.get(`${BASE}/api/marketing/contacts`);
    expect(contacts.status()).toBe(404);
  });
});
