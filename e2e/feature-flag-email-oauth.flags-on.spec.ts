import { test, expect } from "../tests/helpers/po/fixtures";
import { BASE } from "../tests/helpers/po/auth";

test.describe("EMAIL_OAUTH_ENABLED=true (against the dev workflow)", () => {
  test("API: oauth start route is reachable and email-provider reports flag ON", async ({
    isolatedOrg,
  }) => {
    const { request } = isolatedOrg;

    const ep = await request.get(`${BASE}/api/org/email-provider`);
    expect(ep.status()).toBe(200);
    expect((await ep.json()).oauthFlagEnabled).toBe(true);

    const msStart = await request.get(
      `${BASE}/api/auth/oauth/microsoft/start`,
      { maxRedirects: 0 },
    );
    expect(
      [302, 500].includes(msStart.status()),
      `microsoft/start must NOT 404 when flag is ON (got ${msStart.status()})`,
    ).toBe(true);
  });

  test("UI: settings shows the provider radio with M365/Google options and Connect Mailbox", async ({
    page,
    isolatedOrg,
  }) => {
    const { email, password } = isolatedOrg;

    await page.goto("/login");
    await page.waitForSelector('[data-testid="input-email"]', { timeout: 15000 });
    await page.fill('[data-testid="input-email"]', email);
    await page.fill('[data-testid="input-password"]', password);
    await page.click('[data-testid="button-login"]');
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => undefined);

    await page.goto("/settings");
    await page
      .locator('[data-testid="tab-accounting-email"]')
      .click({ timeout: 15000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);

    await expect(page.locator('[data-testid="radio-email-provider"]')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator('[data-testid="option-provider-m365"]')).toBeVisible();
    await expect(page.locator('[data-testid="option-provider-google"]')).toBeVisible();

    await page.locator('[data-testid="option-provider-m365"]').click();
    await expect(page.locator('[data-testid="panel-oauth-m365"]')).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator('[data-testid="button-connect-mailbox"]')).toBeVisible();
    expect(
      await page.locator('[data-testid="panel-oauth-disabled-by-admin"]').count(),
    ).toBe(0);
  });
});
