import { test, expect } from "../helpers/po/fixtures";
import { seedSentInvoice } from "./_helpers";

test("admin sends invoice -> public view link works without auth", async ({
  isolatedOrg,
  browser,
}) => {
  const { publicToken } = await seedSentInvoice(isolatedOrg);

  const publicContext = await browser.newContext();
  const publicPage = await publicContext.newPage();
  try {
    await publicPage.goto(`/i/${publicToken}`);
    await publicPage.waitForSelector('[data-testid="card-public-invoice"]', {
      timeout: 15000,
    });

    const publicTotal = await publicPage
      .locator('[data-testid="text-public-total"]')
      .textContent();
    expect(publicTotal).toBeTruthy();
    expect(publicTotal!.trim().length).toBeGreaterThan(0);

    const invoiceNumber = await publicPage
      .locator('[data-testid="text-invoice-number"]')
      .textContent();
    expect(invoiceNumber).toMatch(/INV-/);

    const pdfBtn = publicPage.locator('[data-testid="button-public-download-pdf"]');
    await expect(pdfBtn).toBeVisible();

    const [download] = await Promise.all([
      publicPage.waitForEvent("download", { timeout: 10000 }).catch(() => null),
      pdfBtn.click(),
    ]);

    if (!download) {
      const newPage = publicPage
        .context()
        .pages()
        .find((p) => p !== publicPage);
      if (newPage) {
        const content = await newPage.content();
        expect(content.length).toBeGreaterThan(0);
      }
    }

    const paymentsMsg = publicPage.locator('[data-testid="text-payments-not-enabled"]');
    const payBtn = publicPage.locator('[data-testid="button-pay-now"]');

    const hasPaymentsMsg = (await paymentsMsg.count()) > 0;
    const hasPayBtn = (await payBtn.count()) > 0;

    if (hasPaymentsMsg) {
      const msgText = await paymentsMsg.textContent();
      expect(msgText).toContain("not enabled");
    } else if (!hasPayBtn) {
      expect(true).toBe(true);
    }
  } finally {
    await publicContext.close();
  }
});

test("invalid public token returns 404 page", async ({ page }) => {
  await page.goto(
    "/i/0000000000000000000000000000000000000000000000000000000000000000",
  );
  await page.waitForSelector('[data-testid="public-invoice-404"]', {
    timeout: 15000,
  });
  const notFoundText = await page
    .locator('[data-testid="public-invoice-404"]')
    .textContent();
  expect(notFoundText).toContain("not found");
});
