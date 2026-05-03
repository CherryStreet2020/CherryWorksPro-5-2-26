import { test, expect } from "../tests/helpers/po/fixtures";
import { BASE } from "../tests/helpers/po/auth";
import { type APIRequestContext } from "@playwright/test";

async function setFlag(
  api: APIRequestContext,
  csrf: string,
  patch: { marketingOs?: boolean | null; emailOauth?: boolean | null },
): Promise<void> {
  const r = await api.post(`${BASE}/api/__test__/feature-flags`, {
    data: patch,
    headers: { "X-CSRF-Token": csrf },
  });
  expect(r.status(), "test feature-flag override endpoint").toBe(200);
}

async function resetFlags(api: APIRequestContext, csrf: string): Promise<void> {
  await api.delete(`${BASE}/api/__test__/feature-flags`, {
    headers: { "X-CSRF-Token": csrf },
  });
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

  test("flag ON: email-provider reports oauthFlagEnabled=true and oauth start no longer 404s", async ({
    isolatedOrg,
  }) => {
    const { request, csrf } = isolatedOrg;

    await setFlag(request, csrf, { emailOauth: true });

    const ep = await request.get(`${BASE}/api/org/email-provider`);
    expect(ep.status()).toBe(200);
    expect((await ep.json()).oauthFlagEnabled).toBe(true);

    // With flag ON, the route is reachable. Without configured Microsoft
    // creds it 500s; with creds it 302-redirects. Both prove the kill
    // switch is no longer in effect.
    const ms = await request.get(`${BASE}/api/auth/oauth/microsoft/start`, {
      maxRedirects: 0,
    });
    expect(
      [302, 500].includes(ms.status()),
      `microsoft/start must NOT 404 when flag is ON (got ${ms.status()})`,
    ).toBe(true);
  });
});
