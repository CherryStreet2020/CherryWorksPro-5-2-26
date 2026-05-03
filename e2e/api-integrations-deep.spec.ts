import { test, expect } from "../tests/helpers/po/fixtures";
import { loginIsolated } from "./_iso-helpers";

test.use({ navigationTimeout: 30_000 });

test.describe("/api-integrations deep", () => {
  test("page renders three cards", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);
    await page.goto("/api-integrations");
    await expect(page.locator('[data-testid="text-integrations-title"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="card-api-keys"]')).toBeVisible();
    await expect(page.locator('[data-testid="card-webhooks"]')).toBeVisible();
    await expect(page.locator('[data-testid="card-api-docs"]')).toBeVisible();
  });

  test("API key create → row appears → rotate fires POST → revoke fires DELETE", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);
    await page.goto("/api-integrations");
    await expect(page.locator('[data-testid="card-api-keys"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="button-create-api-key"]')).toBeVisible({ timeout: 10_000 });

    const tag = `e2e-${Date.now().toString(36)}`;
    await page.locator('[data-testid="button-create-api-key"]').click();
    await expect(page.locator('[data-testid="input-api-key-name"]')).toBeVisible({ timeout: 5_000 });
    await page.locator('[data-testid="input-api-key-name"]').fill(tag);

    const createPromise = page.waitForResponse(
      (r) => /\/api\/integrations\/api-keys$/.test(r.url()) && r.request().method() === "POST",
      { timeout: 10_000 },
    );
    await page.locator('[data-testid="button-confirm-create-key"]').click();
    const createRes = await createPromise;
    expect(createRes.status()).toBeLessThan(300);
    const created = await createRes.json();

    await expect(page.locator('[data-testid="text-created-key-value"]')).toBeVisible({ timeout: 10_000 });
    await page.locator('[data-testid="button-close-key-dialog"]').click();

    const keyId = created.id;
    expect(keyId).toBeTruthy();
    const row = page.locator(`[data-testid="row-api-key-${keyId}"]`);
    await expect(row).toBeVisible({ timeout: 10_000 });

    page.once("dialog", (d) => d.accept());
    const rotatePromise = page.waitForResponse(
      (r) => r.url().includes(`/api/integrations/api-keys/${keyId}/rotate`) && r.request().method() === "POST",
      { timeout: 10_000 },
    );
    await row.locator(`[data-testid="button-rotate-key-${keyId}"]`).click();
    const rotateRes = await rotatePromise;
    expect(rotateRes.status()).toBeLessThan(300);

    await expect(page.locator('[data-testid="text-created-key-value"]')).toBeVisible({ timeout: 5_000 });
    await page.locator('[data-testid="button-close-key-dialog"]').click();
    await expect(page.locator('[data-testid="text-created-key-value"]')).toHaveCount(0, { timeout: 5_000 });

    page.once("dialog", (d) => d.accept());
    const revokePromise = page.waitForResponse(
      (r) => r.url().includes(`/api/integrations/api-keys/${keyId}`) && r.request().method() === "DELETE",
      { timeout: 10_000 },
    );
    await row.locator(`[data-testid="button-revoke-key-${keyId}"]`).click();
    const revokeRes = await revokePromise;
    expect(revokeRes.status()).toBeLessThan(300);
  });

  test("webhook URL validation: malformed URL disables confirm + shows inline error", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);
    await page.goto("/api-integrations");
    await expect(page.locator('[data-testid="card-webhooks"]')).toBeVisible({ timeout: 20_000 });

    await page.locator('[data-testid="button-add-webhook"]').click();
    const urlInput = page.locator('[data-testid="input-webhook-url"]');
    await expect(urlInput).toBeVisible({ timeout: 5_000 });
    await urlInput.fill("not-a-url");

    await expect(page.locator('[data-testid="text-webhook-url-error"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="button-confirm-webhook"]')).toBeDisabled();
    await page.locator('[data-testid="button-cancel-webhook"]').click();
  });

  test("webhook lifecycle: create via API → row → test → edit dialog → delete", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);

    const url = `https://e2e-${Date.now().toString(36)}.example.com/hook`;
    const create = await isolatedOrg.request.post("/api/integrations/webhooks", {
      data: { url, events: ["invoice.created"], description: "e2e" },
      headers: { "X-CSRF-Token": isolatedOrg.csrf },
    });
    expect(create.status()).toBeLessThan(300);
    const wh = await create.json();

    await page.goto("/api-integrations");
    const row = page.locator(`[data-testid="row-webhook-${wh.id}"]`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(`[data-testid="text-webhook-url-${wh.id}"]`)).toContainText(url);

    const testPromise = page.waitForResponse(
      (r) => r.url().includes(`/api/integrations/webhooks/${wh.id}/test`) && r.request().method() === "POST",
      { timeout: 10_000 },
    );
    await page.locator(`[data-testid="button-test-webhook-${wh.id}"]`).click();
    const testRes = await testPromise;
    expect(testRes.status()).toBeLessThan(500);

    await page.locator(`[data-testid="button-edit-webhook-${wh.id}"]`).click();
    await expect(page.locator('[data-testid="input-webhook-url"]')).toBeVisible({ timeout: 5_000 });
    await page.locator('[data-testid="button-cancel-webhook"]').click();

    page.once("dialog", (d) => d.accept());
    const delPromise = page.waitForResponse(
      (r) => r.url().includes(`/api/integrations/webhooks/${wh.id}`) && r.request().method() === "DELETE",
      { timeout: 10_000 },
    );
    await page.locator(`[data-testid="button-delete-webhook-${wh.id}"]`).click();
    const delRes = await delPromise;
    expect(delRes.status()).toBeLessThan(300);
  });
});
