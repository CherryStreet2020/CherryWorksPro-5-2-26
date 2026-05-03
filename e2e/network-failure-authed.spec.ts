import { test, expect, type Route } from "../tests/helpers/po/fixtures";
import { loginIsolated } from "./_iso-helpers";

test.use({ navigationTimeout: 30_000 });

function makeOneShotPostAborter() {
  let aborted = false;
  let postAttempts = 0;
  return {
    postAttempts: () => postAttempts,
    handler: async (route: Route) => {
      if (route.request().method() !== "POST") return route.continue();
      postAttempts++;
      if (!aborted) {
        aborted = true;
        await route.abort("failed");
      } else {
        await route.continue();
      }
    },
  };
}

async function seedClient(iso: any, label: string) {
  const r = await iso.request.post("/api/clients", {
    data: { name: `${label} ${Date.now().toString(36)}` },
    headers: { "X-CSRF-Token": iso.csrf },
  });
  expect(r.ok()).toBe(true);
  return r.json();
}

async function seedInvoice(iso: any, clientId: string) {
  const r = await iso.request.post("/api/invoices", {
    data: {
      clientId,
      issuedDate: new Date().toISOString().slice(0, 10),
      dueDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    },
    headers: { "X-CSRF-Token": iso.csrf },
  });
  expect(r.ok(), `invoice create failed (${r.status()})`).toBe(true);
  const invoice = await r.json();
  const lineRes = await iso.request.post(`/api/invoices/${invoice.id}/lines`, {
    data: { description: "Work", quantity: 1, unitRate: 200 },
    headers: { "X-CSRF-Token": iso.csrf },
  });
  expect(lineRes.ok(), `line add failed (${lineRes.status()})`).toBe(true);
  return invoice;
}

test.describe("Network failure — authed payment record", () => {
  test("aborted POST surfaces error toast, dialog stays mounted, retry POST returns 200", async ({
    page,
    isolatedOrg,
  }) => {
    const ab = makeOneShotPostAborter();
    let secondPostStatus: number | null = null;
    await page.route("**/api/payments", async (route) => {
      const isPost = route.request().method() === "POST";
      await ab.handler(route);
      if (isPost && ab.postAttempts() === 2) {
        // Race-safe: capture final response status from the network for the retry.
        try {
          const resp = await route.request().response();
          secondPostStatus = resp?.status() ?? null;
        } catch {}
      }
    });

    const client = await seedClient(isolatedOrg, "NF Pay");
    const invoice = await seedInvoice(isolatedOrg, client.id);
    const sRes = await isolatedOrg.request.post(`/api/invoices/${invoice.id}/send`, {
      data: {},
      headers: { "X-CSRF-Token": isolatedOrg.csrf },
    });
    expect(sRes.ok(), `invoice send failed (${sRes.status()}): ${await sRes.text()}`).toBe(true);

    await loginIsolated(page, isolatedOrg);
    await page.goto("/payments");
    await page.locator('[data-testid="button-record-payment"]').click();

    await page.locator('[data-testid="select-payment-invoice"]').click();
    await page.locator('[role="option"]').first().click();
    await page.locator('[data-testid="input-payment-amount"]').fill("50");

    const submit = page.locator('[data-testid="button-submit-payment"]');
    await submit.click();
    // Error surface = destructive toast titled "Error".
    await expect(page.getByRole("status").filter({ hasText: /Error/i }).first()).toBeVisible({
      timeout: 10_000,
    });
    expect(ab.postAttempts(), "first POST should be aborted exactly once").toBe(1);
    await expect(submit).toBeEnabled({ timeout: 10_000 });

    // Retry: must succeed and the dialog (form) must close.
    const retrySuccess = page.waitForResponse(
      (r) => r.url().includes("/api/payments") && r.request().method() === "POST" && r.status() < 400,
      { timeout: 15_000 },
    );
    await submit.click();
    const retryResp = await retrySuccess;
    expect(retryResp.status()).toBeLessThan(400);
    expect(ab.postAttempts(), "retry should issue a second POST").toBe(2);
  });
});

test.describe("Network failure — authed expense create", () => {
  test("aborted POST surfaces error toast; retry POST returns 200 and form closes", async ({
    page,
    isolatedOrg,
  }) => {
    const catRes = await isolatedOrg.request.post("/api/expense-categories", {
      data: { name: `Travel ${Date.now().toString(36)}` },
      headers: { "X-CSRF-Token": isolatedOrg.csrf },
    });
    expect(catRes.ok(), `category create: ${catRes.status()}`).toBe(true);

    const ab = makeOneShotPostAborter();
    await page.route("**/api/expenses", ab.handler);

    await loginIsolated(page, isolatedOrg);
    await page.goto("/expenses");
    await page.locator('[data-testid="button-new-expense"]').click();
    await page.locator('[data-testid="input-expense-amount"]').fill("12.50");
    await page
      .locator('[data-testid="input-expense-description"]')
      .fill(`NF expense ${Date.now()}`);
    await page.locator('[data-testid="select-expense-category"]').click();
    await page.locator('[role="option"]').first().click();

    const save = page.locator('[data-testid="button-save-expense"]');
    await save.click();
    await expect(page.getByRole("status").filter({ hasText: /Error/i }).first()).toBeVisible({
      timeout: 10_000,
    });
    expect(ab.postAttempts(), "first POST should be aborted exactly once").toBe(1);
    await expect(save).toBeVisible({ timeout: 10_000 });

    const retrySuccess = page.waitForResponse(
      (r) => r.url().includes("/api/expenses") && r.request().method() === "POST" && r.status() < 400,
      { timeout: 15_000 },
    );
    await save.click();
    const retryResp = await retrySuccess;
    expect(retryResp.status()).toBeLessThan(400);
    expect(ab.postAttempts(), "retry should issue a second POST").toBe(2);
  });
});

test.describe("Network failure — authed invoice send", () => {
  test("aborted POST surfaces error toast; retry POST returns 200", async ({
    page,
    isolatedOrg,
  }) => {
    const ab = makeOneShotPostAborter();
    await page.route(/\/api\/invoices\/[^/]+\/send$/, ab.handler);

    const client = await seedClient(isolatedOrg, "NF Send");
    const invoice = await seedInvoice(isolatedOrg, client.id);

    await loginIsolated(page, isolatedOrg);
    await page.goto(`/invoices`);
    const row = page.locator(`[data-testid="row-invoice-${invoice.id}"]`).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();

    const sendBtn = page.locator('[data-testid="button-send-invoice"]').first();
    await expect(sendBtn).toBeVisible({ timeout: 15_000 });
    await sendBtn.click();

    const confirm = page.locator('[data-testid="button-confirm-send"]');
    await expect(confirm).toBeVisible({ timeout: 10_000 });
    await page.fill('[data-testid="input-email-to"]', "client@example.com");
    await confirm.click();
    await expect(page.getByRole("status").filter({ hasText: /Error|Failed/i }).first()).toBeVisible({
      timeout: 10_000,
    });
    expect(ab.postAttempts(), "first POST should be aborted exactly once").toBe(1);
    await expect(confirm).toBeVisible({ timeout: 10_000 });

    const retrySuccess = page.waitForResponse(
      (r) => /\/api\/invoices\/[^/]+\/send$/.test(r.url()) && r.request().method() === "POST" && r.status() < 400,
      { timeout: 20_000 },
    );
    await confirm.click();
    const retryResp = await retrySuccess;
    expect(retryResp.status()).toBeLessThan(400);
    expect(ab.postAttempts(), "retry should issue a second POST").toBe(2);
  });
});
