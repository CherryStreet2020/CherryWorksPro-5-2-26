import { test, expect } from "../tests/helpers/po/fixtures";
import { loginIsolated } from "./_iso-helpers";

test.use({ navigationTimeout: 30_000 });

test.describe("/settings/brands deep", () => {
  test("brand card renders, edit menu opens, archive removes from list", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);
    await page.goto("/settings/brands");
    await expect(page.locator('[data-testid="text-page-title"]')).toBeVisible({ timeout: 20_000 });

    const tag = Date.now().toString(36);
    const name = `E2E Brand ${tag}`;
    const slug = `e2e-brand-${tag}`;

    const create = await isolatedOrg.request.post("/api/brands", {
      data: { name, slug },
      headers: { "X-CSRF-Token": isolatedOrg.csrf },
    });
    expect(create.status()).toBe(201);
    const created = await create.json();

    await page.reload();
    const card = page.locator(`[data-testid="card-brand-${created.id}"]`);
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(`[data-testid="text-brand-name-${created.id}"]`)).toContainText(name);
    await expect(page.locator(`[data-testid="text-brand-slug-${created.id}"]`)).toContainText(slug);

    await card.locator(`[data-testid="button-brand-menu-${created.id}"]`).click();
    await expect(page.locator(`[data-testid="menu-edit-brand-${created.id}"]`)).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(`[data-testid="menu-delete-brand-${created.id}"]`)).toBeVisible();
    await page.keyboard.press("Escape");

    const del = await isolatedOrg.request.delete(`/api/brands/${created.id}`, {
      headers: { "X-CSRF-Token": isolatedOrg.csrf },
    });
    expect([200, 204]).toContain(del.status());

    await page.reload();
    await expect(page.locator(`[data-testid="card-brand-${created.id}"]`)).toHaveCount(0, { timeout: 10_000 });
  });

  test("Add Brand button opens the brand modal", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);
    await page.goto("/settings/brands");
    await expect(page.locator('[data-testid="text-page-title"]')).toBeVisible({ timeout: 20_000 });

    const addBtn = page.locator('[data-testid="button-add-brand"]');
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
    await addBtn.click();
    const nameInput = page.locator('input[name="name"], [data-testid*="brand-name"]').first();
    await expect(nameInput).toBeVisible({ timeout: 5_000 });
  });

  test("brand edit dialog: open menu → edit → modify name → submit fires PATCH and updates UI", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);
    const tag = Date.now().toString(36);
    const create = await isolatedOrg.request.post("/api/brands", {
      data: { name: `Edit Me ${tag}`, slug: `edit-me-${tag}`, fromEmail: `e2e-${tag}@e2e.test`, fromName: "E2E" },
      headers: { "X-CSRF-Token": isolatedOrg.csrf },
    });
    expect(create.status()).toBe(201);
    const created = await create.json();

    await page.goto("/settings/brands");
    const card = page.locator(`[data-testid="card-brand-${created.id}"]`);
    await expect(card).toBeVisible({ timeout: 15_000 });

    await card.locator(`[data-testid="button-brand-menu-${created.id}"]`).click();
    await page.locator(`[data-testid="menu-edit-brand-${created.id}"]`).click();

    const form = page.locator('[data-testid="form-brand-edit"]');
    await expect(form).toBeVisible({ timeout: 5_000 });
    const fromEmail = page.locator('[data-testid="input-brand-fromEmail"]');
    if (!(await fromEmail.inputValue())) await fromEmail.fill(`e2e-${tag}@e2e.test`);
    const nameInput = page.locator('[data-testid="input-brand-name"]');
    const updated = `Edited ${tag}`;
    await nameInput.fill(updated);
    await expect(page.locator('[data-testid="status-required-count"]')).toContainText(/Ready to save/i, { timeout: 5_000 });

    const patchPromise = page.waitForResponse(
      (r) => r.url().includes(`/api/brands/${created.id}`) && r.request().method() === "PATCH",
      { timeout: 10_000 },
    );
    await page.locator('[data-testid="button-submit-edit"]').click();
    const patchRes = await patchPromise;
    expect(patchRes.status()).toBeLessThan(300);

    await expect(page.locator(`[data-testid="text-brand-name-${created.id}"]`)).toContainText(updated, { timeout: 10_000 });

    await isolatedOrg.request.delete(`/api/brands/${created.id}`, {
      headers: { "X-CSRF-Token": isolatedOrg.csrf },
    });
  });
});
