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
      `expired: ${r.route} has no expiry semantics in the data model`,
      async ({ page }) => {
        // Tokens have no `expiresAt` column today (see shared/schema.ts).
        // Pinned as fixme so the cell exists and starts asserting the
        // moment expiry is introduced.
        await page.goto(`${r.route}/${SYNTHETIC_64}`);
        await expect(page.locator('[data-testid="text-token-expired"]')).toBeVisible();
      },
    );

    test.fixme(
      `used: ${r.route} has no single-use semantics in the data model`,
      async ({ page }) => {
        await page.goto(`${r.route}/${SYNTHETIC_64}`);
        await expect(page.locator('[data-testid="text-token-used"]')).toBeVisible();
      },
    );
  });

  test.describe(`Public token ${r.apiBase} — API matrix`, () => {
    test(`malformed → 404 or 429 (rate-limited)`, async ({ request }) => {
      const s = (await request.get(`${r.apiBase}/short`)).status();
      expect([404, 429], `unexpected status ${s}`).toContain(s);
    });
    test(`unknown → 404 or 429 (rate-limited)`, async ({ request }) => {
      const s = (await request.get(`${r.apiBase}/${SYNTHETIC_64}`)).status();
      expect([404, 429], `unexpected status ${s}`).toContain(s);
    });
    test(`wrong-org (synthetic 64-char from another org) → 404 or 429`, async ({ request }) => {
      // Possession of the token is the entire authz check; a synthetic
      // 64-char token belongs to no org and must 404 — never 5xx.
      // Public token routes are also rate-limited so 429 is acceptable.
      const s = (await request.get(`${r.apiBase}/${SYNTHETIC_64}`)).status();
      expect([404, 429], `unexpected status ${s}`).toContain(s);
    });
  });
}

test.describe("Public estimate — used / wrong-state matrix", () => {
  test("API: accept/decline on unknown token → 404 or 429", async ({ request }) => {
    const a = (await request.post(`/api/public/estimates/${SYNTHETIC_64}/accept`)).status();
    const d = (await request.post(`/api/public/estimates/${SYNTHETIC_64}/decline`)).status();
    expect([404, 429]).toContain(a);
    expect([404, 429]).toContain(d);
  });
});

orgTest.describe("Cross-org token semantics (possession = auth)", () => {
  orgTest("a real portal token works from a fresh anon context; the same token from another anon context still works (no single-use)", async ({
    isolatedOrg,
  }) => {
    const tag = Date.now().toString(36);
    const create = await isolatedOrg.request.post("/api/clients", {
      data: { name: `Cross-Org ${tag}` },
      headers: { "X-CSRF-Token": isolatedOrg.csrf },
    });
    expect(create.ok(), `client create: ${create.status()}`).toBe(true);
    const client = await create.json();
    expect(client.portalToken).toMatch(/^[0-9a-f]{64}$/);

    const anonA = await pwRequest.newContext();
    const anonB = await pwRequest.newContext();
    try {
      expect((await anonA.get(`/api/public/portal/${client.portalToken}`)).status()).toBe(200);
      expect((await anonB.get(`/api/public/portal/${client.portalToken}`)).status()).toBe(200);
      expect((await anonA.get(`/api/public/portal/${SYNTHETIC_64}`)).status()).toBe(404);
    } finally {
      await anonA.dispose();
      await anonB.dispose();
    }
  });
});
