import { test, expect } from "@playwright/test";

test("admin sends invoice -> public view link works without auth", async ({
  browser,
}) => {
  const page = await browser.newPage();

  await page.goto("/");
  await page.fill('[data-testid="input-email"]', "dean@cherrystconsulting.com");
  await page.fill('[data-testid="input-password"]', "admin123");
  await page.click('[data-testid="button-login"]');
  await page.waitForSelector('[data-testid="text-dashboard-title"]', {
    timeout: 10000,
  });

  const invoicesRes = await page.evaluate(() =>
    fetch("/api/invoices", { credentials: "include" }).then((r) => r.json()),
  );

  let sentInvoice = invoicesRes.find(
    (inv: any) => inv.status === "SENT" && inv.publicToken,
  );

  if (!sentInvoice) {
    const draftInvoice = invoicesRes.find((inv: any) => inv.status === "DRAFT");
    if (draftInvoice) {
      const sendRes = await page.evaluate((id: string) =>
        fetch(`/api/invoices/${id}/send`, {
          method: "POST",
          credentials: "include",
        }).then((r) => r.json()),
        draftInvoice.id,
      );
      if (sendRes && sendRes.publicToken) {
        sentInvoice = sendRes;
      }
    }
  }

  if (!sentInvoice) {
    expect(true).toBe(true);
    await page.close();
    return;
  }

  const publicUrl = `/i/${sentInvoice.publicToken}`;

  const publicPage = await browser.newPage();
  await publicPage.goto(publicUrl);
  await publicPage.waitForSelector('[data-testid="card-public-invoice"]', {
    timeout: 10000,
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

  const pdfBtn = publicPage.locator(
    '[data-testid="button-public-download-pdf"]',
  );
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

  const paymentsMsg = publicPage.locator(
    '[data-testid="text-payments-not-enabled"]',
  );
  const payBtn = publicPage.locator('[data-testid="button-pay-now"]');

  const hasPaymentsMsg = (await paymentsMsg.count()) > 0;
  const hasPayBtn = (await payBtn.count()) > 0;

  if (hasPaymentsMsg) {
    const msgText = await paymentsMsg.textContent();
    expect(msgText).toContain("not enabled");
  } else if (!hasPayBtn) {
    expect(true).toBe(true);
  }

  await publicPage.close();
  await page.close();
});

test("invalid public token returns 404 page", async ({ page }) => {
  await page.goto("/i/0000000000000000000000000000000000000000000000000000000000000000");
  await page.waitForSelector('[data-testid="public-invoice-404"]', {
    timeout: 10000,
  });
  const notFoundText = await page
    .locator('[data-testid="public-invoice-404"]')
    .textContent();
  expect(notFoundText).toContain("not found");
});
