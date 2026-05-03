import { test, expect } from "../tests/helpers/po/fixtures";
import { setEntitlement, setOrgTier } from "../tests/helpers/po/tier";
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

test.describe("MARKETING_OS_ENABLED env kill switch", () => {
  test.afterEach(async ({ isolatedOrg }) => {
    await resetFlags(isolatedOrg.request, isolatedOrg.csrf);
  });

  test("flag OFF + entitlement granted: brands + marketing chat 404 (kill switch wins)", async ({
    isolatedOrg,
  }) => {
    const { request, orgId, csrf } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);

    await setFlag(request, csrf, { marketingOs: false });

    const brands = await request.get(`${BASE}/api/brands`);
    expect(brands.status(), "brands list must 404 when env flag is OFF").toBe(404);

    // POST /api/marketing/chat is the single-turn chat endpoint and
    // returns a stealth 404 from `requireMarketingOsForBrand` when the
    // env flag is off (server/routes/marketing/chat.ts line 104).
    const chat = await request.post(`${BASE}/api/marketing/chat`, {
      data: {
        brandSlug: "any-slug",
        sessionToken: "00000000-0000-0000-0000-000000000000",
        message: "ping",
      },
      headers: { "X-CSRF-Token": csrf },
    });
    expect(chat.status(), "marketing chat must 404 when env flag is OFF").toBe(404);

    const embed = await request.get(`${BASE}/embed/chat.js`);
    expect(embed.status(), "embed/chat.js must 404 when env flag is OFF").toBe(404);
  });

  test("flag ON + entitlement granted: brands list reachable + chat no longer stealth-404s on flag", async ({
    isolatedOrg,
  }) => {
    const { request, orgId, csrf } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);

    await setFlag(request, csrf, { marketingOs: true });

    const brands = await request.get(`${BASE}/api/brands`);
    expect(brands.status(), "brands list must succeed when both flag + entitlement ON").toBe(200);
    expect(Array.isArray(await brands.json())).toBe(true);

    // With the env flag ON, the chat endpoint advances past gate 1 and
    // 404s for a *different* reason (unknown brand slug). We can't
    // distinguish that from the flag-OFF stealth 404 here, but the
    // embed/chat.js script — which is also gated by isMarketingOsEnabled
    // — must now serve JS instead of 404.
    const embed = await request.get(`${BASE}/embed/chat.js`);
    expect(embed.status(), "embed/chat.js must serve when env flag is ON").toBe(200);
  });

  test("flag ON + entitlement absent: existing entitlement gate still 404s marketing CRUD", async ({
    isolatedOrg,
  }) => {
    const { request, orgId, csrf } = isolatedOrg;
    // BUSINESS tier auto-derives marketing_os via the tier overlay, so we
    // must also drop the tier to fully revoke the entitlement (see the
    // architectural caveat in tests/helpers/po/tier.ts).
    await setOrgTier(orgId, "STARTER");
    await setEntitlement(orgId, "marketing_os", false);

    await setFlag(request, csrf, { marketingOs: true });

    const contacts = await request.get(`${BASE}/api/marketing/contacts`);
    expect(
      contacts.status(),
      "entitlement gate must still 404 marketing/contacts when flag is ON but entitlement is absent",
    ).toBe(404);
  });
});
