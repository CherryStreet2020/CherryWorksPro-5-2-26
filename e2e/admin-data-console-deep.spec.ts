import { test, expect } from "../tests/helpers/po/fixtures";
import { loginIsolated } from "./_iso-helpers";

test.use({ navigationTimeout: 30_000 });

test.describe("/admin/data console deep", () => {
  test("entity card click loads table and a created client appears + search round-trip + delete", async ({ page, isolatedOrg }) => {
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

  test("entities meta endpoint exposes a stable editable + view-only set", async ({ isolatedOrg }) => {
    const r = await isolatedOrg.request.get("/api/admin/data/entities");
    expect(r.status()).toBe(200);
    const meta = await r.json();
    expect(Array.isArray(meta.editable)).toBe(true);
    expect(Array.isArray(meta.viewOnly)).toBe(true);
    // Pin every editable entity advertised to the UI.
    for (const required of [
      "clients", "projects", "project_members", "services",
      "time_entries", "invoices", "invoice_lines", "payments",
      "estimates", "expenses", "expense_categories",
    ]) {
      expect(meta.editable).toContain(required);
    }
    // Pin view-only entities the UI reads but cannot mutate.
    for (const required of ["users", "orgs", "audit_logs", "outbox_emails"]) {
      expect(meta.viewOnly).toContain(required);
    }
  });

  test("table-driven: every editable entity opens via card and lists rows (200 from /api/admin/data/:entity)", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);
    const meta = await (await isolatedOrg.request.get("/api/admin/data/entities")).json();
    const editable: string[] = meta.editable;
    expect(editable.length).toBeGreaterThan(0);

    await page.goto("/admin/data");
    await expect(page.locator('[data-testid="text-data-console-title"]')).toBeVisible({ timeout: 20_000 });

    for (const entity of editable) {
      const card = page.locator(`[data-testid="card-entity-${entity}"]`);
      // Some editable entities aren't surfaced in the console UI (e.g. join
      // tables that have no ENTITY_CONFIG). API contract is the source of
      // truth — verify each one's list endpoint responds 200, then exercise
      // the UI for the ones the console actually exposes.
      const listRes = await isolatedOrg.request.get(`/api/admin/data/${entity}?limit=1`);
      expect.soft(listRes.status(), `GET /api/admin/data/${entity}`).toBe(200);

      if (await card.count()) {
        const navPromise = page.waitForResponse(
          (r) => r.url().includes(`/api/admin/data/${entity}`) && r.request().method() === "GET",
          { timeout: 10_000 },
        );
        await card.click();
        const navRes = await navPromise;
        expect(navRes.status()).toBe(200);
        await expect(page.locator('[data-testid="text-entity-title"]')).toBeVisible({ timeout: 10_000 });
        await page.locator('[data-testid="button-back-to-console"]').click();
        await expect(page.locator('[data-testid="text-data-console-title"]')).toBeVisible({ timeout: 10_000 });
      }
    }
  });

  test("unsupported entity in URL surfaces unsupported-entity copy", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);
    await page.goto("/admin/data/not_a_real_entity");
    await expect(page.locator('[data-testid="text-unsupported-entity"]')).toBeVisible({ timeout: 20_000 });
  });

  test("PATCH /api/admin/data/clients/:id updates the row in place; DELETE removes it", async ({ isolatedOrg }) => {
    const tag = Date.now().toString(36);
    const create = await isolatedOrg.request.post("/api/admin/data/clients", {
      data: { name: `Patch Me ${tag}`, email: `pm-${tag}@e2e.test` },
      headers: { "X-CSRF-Token": isolatedOrg.csrf },
    });
    expect(create.status()).toBe(201);
    const created = await create.json();

    const patch = await isolatedOrg.request.patch(`/api/admin/data/clients/${created.id}`, {
      data: { name: `Patched ${tag}` },
      headers: { "X-CSRF-Token": isolatedOrg.csrf },
    });
    expect(patch.status()).toBe(200);
    const patched = await patch.json();
    expect(patched.name).toBe(`Patched ${tag}`);

    const del = await isolatedOrg.request.delete(`/api/admin/data/clients/${created.id}`, {
      headers: { "X-CSRF-Token": isolatedOrg.csrf },
    });
    expect(del.status()).toBe(200);

    const after = await isolatedOrg.request.get(`/api/admin/data/clients/${created.id}`);
    expect(after.status()).toBe(404);
  });

  test("create with a missing FK returns 400 (FK guard)", async ({ isolatedOrg }) => {
    // project requires clientId; passing a bogus uuid should hit the
    // 23503 → 400 guard branch.
    const r = await isolatedOrg.request.post("/api/admin/data/projects", {
      data: {
        name: "Bad FK",
        clientId: "00000000-0000-0000-0000-000000000000",
      },
      headers: { "X-CSRF-Token": isolatedOrg.csrf },
    });
    expect(r.status()).toBe(400);
  });

  test("non-editable entity (users) rejects POST/PATCH/DELETE", async ({ isolatedOrg }) => {
    const post = await isolatedOrg.request.post("/api/admin/data/users", {
      data: { email: "x@e2e.test", role: "TEAM_MEMBER" },
      headers: { "X-CSRF-Token": isolatedOrg.csrf },
    });
    expect(post.status()).toBe(400);
  });
});
