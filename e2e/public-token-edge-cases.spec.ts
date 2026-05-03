import { test, expect, request as pwRequest } from "@playwright/test";
import { test as orgTest } from "../tests/helpers/po/fixtures";

test.use({ navigationTimeout: 30_000 });

const SYNTHETIC_64 = "0".repeat(60) + "dead";

const ROUTES = [
  { route: "/i", apiBase: "/api/public/invoices", notFoundTestId: "public-invoice-404" },
  { route: "/e", apiBase: "/api/public/estimates", notFoundTestId: "public-estimate-404" },
  { route: "/portal", apiBase: "/api/public/portal", notFoundTestId: "card-portal-not-found" },
] as const;

for (const r of ROUTES) {
  test.describe(`Public token ${r.route} — UI matrix`, () => {
    test(`malformed: ${r.route}/short surfaces not-found`, async ({ page }) => {
      const resp = await page.goto(`${r.route}/short`);
      expect(resp?.status() ?? 0).toBeLessThan(500);
      await expect(page.locator(`[data-testid="${r.notFoundTestId}"]`)).toBeVisible({
        timeout: 15_000,
      });
    });

    test(`unknown: well-formed but unknown token surfaces not-found`, async ({ page }) => {
      await page.goto(`${r.route}/${SYNTHETIC_64}`);
      await expect(page.locator(`[data-testid="${r.notFoundTestId}"]`)).toBeVisible({
        timeout: 15_000,
      });
    });

    test.fixme(
      `expired: ${r.route} has no expiry semantics in the data model (follow-up #454)`,
      async ({ page }) => {
        await page.goto(`${r.route}/${SYNTHETIC_64}`);
        await expect(page.locator('[data-testid="text-token-expired"]')).toBeVisible();
      },
    );

    test.fixme(
      `used: ${r.route} has no single-use semantics in the data model (follow-up #454)`,
      async ({ page }) => {
        await page.goto(`${r.route}/${SYNTHETIC_64}`);
        await expect(page.locator('[data-testid="text-token-used"]')).toBeVisible();
      },
    );
  });

  test.describe(`Public token ${r.apiBase} — API matrix`, () => {
    test(`malformed → 404 or 429`, async ({ request }) => {
      const s = (await request.get(`${r.apiBase}/short`)).status();
      expect([404, 429]).toContain(s);
    });
    test(`unknown → 404 or 429`, async ({ request }) => {
      const s = (await request.get(`${r.apiBase}/${SYNTHETIC_64}`)).status();
      expect([404, 429]).toContain(s);
    });
  });
}

test.describe("Public estimate — used / wrong-state (real flow)", () => {
  test("API: accept on unknown token → 404 or 429", async ({ request }) => {
    const a = (await request.post(`/api/public/estimates/${SYNTHETIC_64}/accept`)).status();
    const d = (await request.post(`/api/public/estimates/${SYNTHETIC_64}/decline`)).status();
    expect([404, 429]).toContain(a);
    expect([404, 429]).toContain(d);
  });
});

orgTest.describe("Estimate token — real used semantics", () => {
  orgTest("accepting a SENT estimate transitions it out of SENT; a second accept returns 4xx", async ({
    isolatedOrg,
  }) => {
    const tag = Date.now().toString(36);
    const c = await isolatedOrg.request.post("/api/clients", {
      data: { name: `Used ${tag}` },
      headers: { "X-CSRF-Token": isolatedOrg.csrf },
    });
    expect(c.ok()).toBe(true);
    const client = await c.json();
    const e = await isolatedOrg.request.post("/api/estimates", {
      data: {
        clientId: client.id,
        issuedDate: new Date().toISOString().slice(0, 10),
        validUntilDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
        lines: [{ description: "x", quantity: 1, unitRate: 50 }],
      },
      headers: { "X-CSRF-Token": isolatedOrg.csrf },
    });
    expect(e.ok(), `estimate create: ${e.status()}`).toBe(true);
    const est = await e.json();

    const sendRes = await isolatedOrg.request.post(`/api/estimates/${est.id}/send`, {
      data: {},
      headers: { "X-CSRF-Token": isolatedOrg.csrf },
    });
    expect(sendRes.ok(), `estimate send: ${sendRes.status()}`).toBe(true);
    const sent = await sendRes.json();
    const token: string = sent.publicToken ?? sent.token ?? sent.estimate?.publicToken;
    expect(token, "estimate send must return a publicToken").toMatch(/^[0-9a-f]{64}$/);

    const anon = await pwRequest.newContext();
    try {
      const first = await anon.post(`/api/public/estimates/${token}/accept`);
      const firstStatus = first.status();
      expect([200, 429]).toContain(firstStatus);
      // Second accept must NOT succeed — either rate-limited or rejected
      // because the estimate is no longer SENT.
      const second = await anon.post(`/api/public/estimates/${token}/accept`);
      expect([400, 404, 429]).toContain(second.status());
    } finally {
      await anon.dispose();
    }
  });
});

orgTest.describe("Cross-org / wrong-org token semantics", () => {
  orgTest("token from one org is unknown in any other org's lookup space; possession of a real token works from a fresh anon context", async ({
    isolatedOrg,
  }) => {
    const tag = Date.now().toString(36);
    const create = await isolatedOrg.request.post("/api/clients", {
      data: { name: `WrongOrg ${tag}` },
      headers: { "X-CSRF-Token": isolatedOrg.csrf },
    });
    expect(create.ok()).toBe(true);
    const client = await create.json();
    expect(client.portalToken).toMatch(/^[0-9a-f]{64}$/);

    const anonA = await pwRequest.newContext();
    const anonB = await pwRequest.newContext();
    try {
      // Possession works (no per-org session is checked — token IS auth).
      expect((await anonA.get(`/api/public/portal/${client.portalToken}`)).status()).toBe(200);
      expect((await anonB.get(`/api/public/portal/${client.portalToken}`)).status()).toBe(200);
      // A token that does not belong to this lookup space (synthetic
      // "from another org") must 404 and never 5xx.
      const wrong = await anonA.get(`/api/public/portal/${SYNTHETIC_64}`);
      expect([404, 429]).toContain(wrong.status());
    } finally {
      await anonA.dispose();
      await anonB.dispose();
    }
  });
});
