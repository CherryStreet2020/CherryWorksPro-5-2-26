/**
 * Task #437 — env-level kill-switch coverage for `EMAIL_OAUTH_ENABLED`.
 *
 * Pairs with `e2e/feature-flag-marketing-os.spec.ts`. See that file
 * for the test-override mechanism and security model.
 *
 * Limitation acknowledged (intentional): the settings.tsx panel reads
 * `import.meta.env.VITE_EMAIL_OAUTH_ENABLED` directly, which Vite
 * bakes at server startup. The dev workflow boots with that variable
 * set to "true", so we can ONLY assert the FLAG-ON UI surface
 * (Connect Mailbox visible, panel-oauth-{m365,google} present) here.
 * The flag-OFF UI ("OAuth disabled by admin" panel) would require a
 * second Vite server with the env var unset and is tracked separately.
 */
import { test, expect } from "../tests/helpers/po/fixtures";
import { BASE } from "../tests/helpers/po/auth";
import { request as pwRequest, type APIRequestContext } from "@playwright/test";

const OVERRIDE_HEADERS = { "X-E2E-Flag-Override": "task-437-test-only" } as const;

async function setFlag(
  api: APIRequestContext,
  csrf: string,
  patch: { marketingOs?: boolean | null; emailOauth?: boolean | null },
): Promise<void> {
  const r = await api.post(`${BASE}/api/__test__/feature-flags`, {
    data: patch,
    headers: { "X-CSRF-Token": csrf, ...OVERRIDE_HEADERS },
  });
  expect(r.status(), "test feature-flag override endpoint").toBe(200);
}

async function resetFlags(api: APIRequestContext, csrf: string): Promise<void> {
  const r = await api.delete(`${BASE}/api/__test__/feature-flags`, {
    headers: { "X-CSRF-Token": csrf, ...OVERRIDE_HEADERS },
  });
  expect(r.status(), "test feature-flag reset endpoint").toBe(200);
}

test.describe("EMAIL_OAUTH_ENABLED env kill switch", () => {
  test.afterEach(async ({ isolatedOrg }) => {
    await resetFlags(isolatedOrg.request, isolatedOrg.csrf);
  });

  test("flag OFF: oauth start routes 404 + email-provider reports oauthFlagEnabled=false", async ({
    isolatedOrg,
  }) => {
    const { request, csrf } = isolatedOrg;

    await setFlag(request, csrf, { emailOauth: false });

    const ms = await request.get(`${BASE}/api/auth/oauth/microsoft/start`, {
      maxRedirects: 0,
    });
    expect(ms.status(), "microsoft/start must 404 with kill switch OFF").toBe(404);

    const gg = await request.get(`${BASE}/api/auth/oauth/google/start`, {
      maxRedirects: 0,
    });
    expect(gg.status(), "google/start must 404 with kill switch OFF").toBe(404);

    const ep = await request.get(`${BASE}/api/org/email-provider`);
    expect(ep.status()).toBe(200);
    const body = await ep.json();
    expect(body.oauthFlagEnabled, "email-provider must surface flag-off to UI").toBe(false);
  });

  test("flag OFF: callback routes 404 even with bogus query", async ({
    isolatedOrg,
  }) => {
    const { request, csrf } = isolatedOrg;

    await setFlag(request, csrf, { emailOauth: false });

    const msCb = await request.get(
      `${BASE}/api/auth/oauth/microsoft/callback?code=x&state=y`,
    );
    expect(msCb.status()).toBe(404);

    const ggCb = await request.get(
      `${BASE}/api/auth/oauth/google/callback?code=x&state=y`,
    );
    expect(ggCb.status()).toBe(404);
  });

  test("flag ON: API surface + settings UI both expose the OAuth controls", async ({
    isolatedOrg,
    page,
  }) => {
    const { request, csrf, email, password } = isolatedOrg;

    await setFlag(request, csrf, { emailOauth: true });

    // API contract.
    const ep = await request.get(`${BASE}/api/org/email-provider`);
    expect(ep.status()).toBe(200);
    expect((await ep.json()).oauthFlagEnabled).toBe(true);

    // With flag ON, the route is reachable. Without configured Microsoft
    // creds it 500s; with creds it 302-redirects. Both prove the kill
    // switch is no longer in effect (i.e. NOT a 404).
    const msStart = await request.get(`${BASE}/api/auth/oauth/microsoft/start`, {
      maxRedirects: 0,
    });
    expect(
      [302, 500].includes(msStart.status()),
      `microsoft/start must NOT 404 when flag is ON (got ${msStart.status()})`,
    ).toBe(true);

    // UI contract — log in as the isolated admin and inspect /settings.
    await page.goto("/login");
    await page.waitForSelector('[data-testid="input-email"]', { timeout: 15000 });
    await page.fill('[data-testid="input-email"]', email);
    await page.fill('[data-testid="input-password"]', password);
    await page.click('[data-testid="button-login"]');
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => undefined);

    await page.goto("/settings");
    // Email Settings live under the "Accounting & Email" tab.
    await page
      .locator('[data-testid="tab-accounting-email"]')
      .click({ timeout: 15000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);

    // FLAG-ON contract: the provider radio renders and at least one
    // OAuth provider option is present.
    await expect(page.locator('[data-testid="radio-email-provider"]')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator('[data-testid="option-provider-m365"]')).toBeVisible();
    await expect(page.locator('[data-testid="option-provider-google"]')).toBeVisible();

    // Pick M365 → the OAuth panel and Connect Mailbox button appear,
    // and the "OAuth disabled by admin" stub does NOT.
    await page.locator('[data-testid="option-provider-m365"]').click();
    await expect(page.locator('[data-testid="panel-oauth-m365"]')).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator('[data-testid="button-connect-mailbox"]')).toBeVisible();
    expect(
      await page.locator('[data-testid="panel-oauth-disabled-by-admin"]').count(),
      "disabled-by-admin panel must NOT render when flag is ON",
    ).toBe(0);
  });

  test("test-override endpoint requires the X-E2E-Flag-Override header", async ({
    isolatedOrg,
  }) => {
    const { request, csrf } = isolatedOrg;
    const r = await request.post(`${BASE}/api/__test__/feature-flags`, {
      data: { emailOauth: false },
      headers: { "X-CSRF-Token": csrf },
    });
    expect(r.status(), "missing override header must 404 (defense-in-depth)").toBe(404);
  });
});

// Ensure no stale request import warning in lint.
void pwRequest;
