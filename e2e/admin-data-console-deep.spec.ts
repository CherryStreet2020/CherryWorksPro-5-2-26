import { test, expect } from "../tests/helpers/po/fixtures";
import { loginIsolated } from "./_iso-helpers";

test.use({ navigationTimeout: 30_000 });

test.describe("/admin/data console deep", () => {
  test("entity card click loads table and a created client appears", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);

    const tag = Date.now().toString(36);
    const create = await isolatedOrg.request.post("/api/admin/data/clients", {
      data: { name: `E2E Console ${tag}`, email: `e2e-${tag}@e2e.test` },
      headers: { "X-CSRF-Token": isolatedOrg.csrf },
    });
    expect(create.status()).toBe(201);
    const created = await create.json();

    await page.goto("/admin/data");
    await expect(page.locator('[data-testid="text-data-console-title"]')).toBeVisible({ timeout: 20_000 });

    await page.locator('[data-testid="card-entity-clients"]').click();
    await expect(page.locator('[data-testid="text-entity-title"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(`[data-testid="row-${created.id}"]`)).toBeVisible({ timeout: 10_000 });

    const search = page.locator('[data-testid="input-search"]');
    await expect(search).toBeVisible();
    await search.fill(tag);
    const searchPromise = page.waitForResponse(
      (r) => r.url().includes("/api/admin/data/clients") && r.url().includes(`query=${tag}`),
      { timeout: 10_000 },
    );
    await page.locator('[data-testid="button-search"]').click();
    const searchRes = await searchPromise;
    expect(searchRes.status()).toBe(200);
    await expect(page.locator(`[data-testid="row-${created.id}"]`)).toBeVisible({ timeout: 10_000 });

    const del = await isolatedOrg.request.delete(`/api/admin/data/clients/${created.id}`, {
      headers: { "X-CSRF-Token": isolatedOrg.csrf },
    });
    expect(del.ok()).toBe(true);
  });

  test("entities meta endpoint exposes a stable editable set", async ({ isolatedOrg }) => {
    const r = await isolatedOrg.request.get("/api/admin/data/entities");
    expect(r.status()).toBe(200);
    const meta = await r.json();
    expect(Array.isArray(meta.editable)).toBe(true);
    expect(meta.editable).toContain("clients");
  });
});
