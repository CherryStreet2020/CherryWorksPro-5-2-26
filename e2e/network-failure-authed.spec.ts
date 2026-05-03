/**
 * Network-failure resilience for authed forms (Task #444).
 * Pattern: stub aborts the FIRST POST → assert form stays mounted /
 * no double-submit → release stub → second click POSTs again.
 */
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
  // Lines must be added through the dedicated endpoint.
  const lineRes = await iso.request.post(`/api/invoices/${invoice.id}/lines`, {
    data: { description: "Work", quantity: 1, unitRate: 200 },
    headers: { "X-CSRF-Token": iso.csrf },
  });
  expect(lineRes.ok(), `line add failed (${lineRes.status()})`).toBe(true);
  return invoice;
}

test.describe("Network failure — authed payment record", () => {
  test("aborted POST keeps dialog mounted; retry POSTs again", async ({
    page,
    isolatedOrg,
  }) => {
    const ab = makeOneShotPostAborter();
    await page.route("**/api/payments", ab.handler);

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

    // Pick the seeded invoice from the combobox so invoiceId is set.
    await page.locator('[data-testid="select-payment-invoice"]').click();
    await page.locator('[role="option"]').first().click();
    await page.locator('[data-testid="input-payment-amount"]').fill("50");

    const submit = page.locator('[data-testid="button-submit-payment"]');
    await submit.click();
    await page.waitForTimeout(1000);
    expect(ab.postAttempts(), "first POST should be aborted exactly once").toBe(1);
    await expect(submit).toBeEnabled({ timeout: 10_000 });

    await submit.click();
    await page.waitForTimeout(1000);
    expect(ab.postAttempts(), "retry should issue a second POST").toBe(2);
  });
});

test.describe("Network failure — authed expense create", () => {
  test("aborted POST keeps form mounted; retry POSTs again", async ({
    page,
    isolatedOrg,
  }) => {
    // Seed an expense category so the form has a valid selectable option.
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

    // Pick the first available category to satisfy form validation.
    await page.locator('[data-testid="select-expense-category"]').click();
    await page.locator('[role="option"]').first().click();

    const save = page.locator('[data-testid="button-save-expense"]');
    await save.click();
    await page.waitForTimeout(1000);
    expect(ab.postAttempts(), "first POST should be aborted exactly once").toBe(1);
    await expect(save).toBeVisible({ timeout: 10_000 });

    await save.click();
    await page.waitForTimeout(1500);
    expect(ab.postAttempts(), "retry should issue a second POST").toBe(2);
  });
});

test.describe("Network failure — authed invoice send", () => {
  test("aborted POST surfaces failure; retry POSTs again", async ({
    page,
    isolatedOrg,
  }) => {
    const ab = makeOneShotPostAborter();
    await page.route(/\/api\/invoices\/[^/]+\/send$/, ab.handler);

    const client = await seedClient(isolatedOrg, "NF Send");
    const invoice = await seedInvoice(isolatedOrg, client.id);

    await loginIsolated(page, isolatedOrg);
    await page.goto(`/invoices`);
    // Open the invoice detail by clicking the row (first invoice in list).
    const row = page.locator(`[data-testid="row-invoice-${invoice.id}"]`).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();

    const sendBtn = page.locator('[data-testid="button-send-invoice"]').first();
    await expect(sendBtn).toBeVisible({ timeout: 15_000 });
    await sendBtn.click();

    // SendEmailModal opens; fire the actual send POST from inside it.
    const confirm = page.locator('[data-testid="button-confirm-send"]');
    await expect(confirm).toBeVisible({ timeout: 10_000 });
    await page.fill('[data-testid="input-email-to"]', "client@example.com");
    await confirm.click();
    await page.waitForTimeout(1000);
    expect(ab.postAttempts(), "first POST should be aborted exactly once").toBe(1);
    await expect(confirm).toBeVisible({ timeout: 10_000 });

    await confirm.click();
    await page.waitForTimeout(1500);
    expect(ab.postAttempts(), "retry should issue a second POST").toBe(2);
  });
});
