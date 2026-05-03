import { test, expect } from "../tests/helpers/po/fixtures";
import { BASE } from "../tests/helpers/po/auth";

test.describe("EMAIL_OAUTH_ENABLED=false (against the dedicated flag-off web server)", () => {
  test("API: oauth start + callback both 404; email-provider reports flag OFF", async ({
    isolatedOrg,
  }) => {
    const { request } = isolatedOrg;

    const msStart = await request.get(
      `${BASE}/api/auth/oauth/microsoft/start`,
      { maxRedirects: 0 },
    );
    expect(msStart.status()).toBe(404);

    const ggStart = await request.get(
      `${BASE}/api/auth/oauth/google/start`,
      { maxRedirects: 0 },
    );
    expect(ggStart.status()).toBe(404);

    const msCb = await request.get(
      `${BASE}/api/auth/oauth/microsoft/callback?code=x&state=y`,
    );
    expect(msCb.status()).toBe(404);

    const ggCb = await request.get(
      `${BASE}/api/auth/oauth/google/callback?code=x&state=y`,
    );
    expect(ggCb.status()).toBe(404);

    const ep = await request.get(`${BASE}/api/org/email-provider`);
    expect(ep.status()).toBe(200);
    expect((await ep.json()).oauthFlagEnabled).toBe(false);
  });

  test("API: SMTP send path is still alive (flag OFF disables OAuth, not SMTP)", async ({
    isolatedOrg,
  }) => {
    const { request, csrf } = isolatedOrg;

    // The isolated org has no SMTP creds, so the actual send will fail
    // — but the failure must come from the SMTP transport (provider_error
    // on a 502), NOT from an oauth-disabled 404. Reaching the transport
    // proves the SMTP code path executes when EMAIL_OAUTH_ENABLED=false.
    const r = await request.post(`${BASE}/api/email/test-send`, {
      data: { to: "smoke@example.com" },
      headers: { "X-CSRF-Token": csrf },
    });
    expect(r.status(), "route must not 404 when SMTP path is the fallback").not.toBe(404);
    const body = await r.json();
    expect(body.code, "SMTP path was reached (no oauth-disabled short-circuit)").not.toBe("oauth_disabled");
  });

  test("UI: settings shows SMTP only — no provider radio, no OAuth options, no Connect Mailbox", async ({
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

    // The unconfigured-SMTP panel shows the "Configure SMTP" CTA — wait
    // for it so we know the Email Settings card actually mounted before
    // asserting the OAuth controls are absent.
    await expect(page.locator('[data-testid="button-configure-smtp"]')).toBeVisible({
      timeout: 15000,
    });

    expect(
      await page.locator('[data-testid="radio-email-provider"]').count(),
      "provider radio must NOT render when EMAIL_OAUTH_ENABLED is OFF",
    ).toBe(0);
    expect(
      await page.locator('[data-testid="option-provider-m365"]').count(),
    ).toBe(0);
    expect(
      await page.locator('[data-testid="option-provider-google"]').count(),
    ).toBe(0);
    expect(
      await page.locator('[data-testid="button-connect-mailbox"]').count(),
    ).toBe(0);
  });
});
