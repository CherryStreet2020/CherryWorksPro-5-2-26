/**
 * Task #437 — env-level kill-switch coverage for `MARKETING_OS_ENABLED`.
 *
 * Pairs with `e2e/feature-flag-email-oauth.spec.ts`. The dev-only
 * runtime override endpoint at `POST /api/__test__/feature-flags`
 * (gated by NODE_ENV !== "production" + requireAuth + a sentinel
 * header) lets us flip the in-memory flag without restarting the
 * server. All overrides are reset in `afterEach` so spec ordering is
 * safe; the spec runs under the `serial` Playwright project for the
 * same reason.
 */
import { test, expect } from "../tests/helpers/po/fixtures";
import { setEntitlement, setOrgTier } from "../tests/helpers/po/tier";
import { BASE } from "../tests/helpers/po/auth";
import { type APIRequestContext } from "@playwright/test";

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

test.describe("MARKETING_OS_ENABLED env kill switch", () => {
  test.afterEach(async ({ isolatedOrg }) => {
    await resetFlags(isolatedOrg.request, isolatedOrg.csrf);
  });

  test("flag OFF + entitlement granted: every gated marketing surface 404s", async ({
    isolatedOrg,
  }) => {
    const { request, orgId, csrf } = isolatedOrg;
    // Grant entitlement explicitly so we prove the kill switch wins
    // over a present, active entitlement (not a missing one).
    await setEntitlement(orgId, "marketing_os", true);

    await setFlag(request, csrf, { marketingOs: false });

    // Routes that read isMarketingOsEnabled() directly:
    const brands = await request.get(`${BASE}/api/brands`);
    expect(brands.status(), "/api/brands must 404 when env flag is OFF").toBe(404);

    const chat = await request.post(`${BASE}/api/marketing/chat`, {
      data: {
        brandSlug: "any-slug",
        sessionToken: "00000000-0000-0000-0000-000000000000",
        message: "ping",
      },
      headers: { "X-CSRF-Token": csrf },
    });
    expect(chat.status(), "POST /api/marketing/chat must 404 when env flag is OFF").toBe(404);

    const embed = await request.get(`${BASE}/embed/chat.js`);
    expect(embed.status(), "GET /embed/chat.js must 404 when env flag is OFF").toBe(404);

    // Routes wrapped with `requireFeature("marketing_os")` — the
    // chokepoint middleware now also honors the env kill switch
    // (see server/services/entitlements.ts:requireFeature).
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
      expect(
        r.status(),
        `${path} must 404 when env flag is OFF (kill switch beats entitlement)`,
      ).toBe(404);
    }
  });

  test("flag ON + entitlement granted: marketing surfaces reachable + chat embed serves", async ({
    isolatedOrg,
  }) => {
    const { request, orgId, csrf } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);

    await setFlag(request, csrf, { marketingOs: true });

    const brands = await request.get(`${BASE}/api/brands`);
    expect(brands.status(), "/api/brands must 200 when both flag + entitlement ON").toBe(200);
    expect(Array.isArray(await brands.json())).toBe(true);

    const contacts = await request.get(`${BASE}/api/marketing/contacts`);
    expect(
      contacts.status(),
      "/api/marketing/contacts must 200 when both flag + entitlement ON",
    ).toBe(200);

    // embed/chat.js is also gated by isMarketingOsEnabled and must
    // serve JS rather than 404 once the kill switch is released.
    const embed = await request.get(`${BASE}/embed/chat.js`);
    expect(embed.status(), "/embed/chat.js must serve when env flag is ON").toBe(200);
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

  test("test-override endpoint requires the X-E2E-Flag-Override header", async ({
    isolatedOrg,
  }) => {
    const { request, csrf } = isolatedOrg;
    // Same authenticated session, but missing the sentinel header → 404.
    const r = await request.post(`${BASE}/api/__test__/feature-flags`, {
      data: { marketingOs: false },
      headers: { "X-CSRF-Token": csrf },
    });
    expect(r.status(), "missing override header must 404 (defense-in-depth)").toBe(404);
  });
});
