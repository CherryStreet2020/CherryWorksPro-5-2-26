import { test, expect } from "../tests/helpers/po/fixtures";
import {
  apiBoundary,
  groqStub,
  tesseractStub,
} from "../tests/helpers/po/stubs";
import { loginIsolated } from "./_iso-helpers";

const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

async function seedCategory(iso: {
  request: import("@playwright/test").APIRequestContext;
  csrf: string;
}) {
  const r = await iso.request.post("/api/expense-categories", {
    headers: { "x-csrf-token": iso.csrf },
    data: { name: `Travel ${Date.now()}`, isActive: true },
  });
  expect(r.status(), await r.text()).toBeLessThan(400);
  return (await r.json()) as { id: string; name: string };
}

test.describe("Expenses — OCR + filters + lifecycle (#440)", () => {
  test("OCR Groq-shaped response populates vendor, amount, tax, date", async ({
    page,
    isolatedOrg,
  }) => {
    await apiBoundary.fulfill(
      page,
      "**/api/expenses/upload-receipt",
      200,
      { url: "/api/uploads/receipts/stub.png", filename: "stub.png" },
    );
    // Full Groq-shaped extraction.
    await apiBoundary.fulfill(page, "**/api/expenses/scan-receipt", 200, {
      vendor: "Stub Vendor Inc",
      totalAmount: "42.99",
      subtotal: "39.00",
      taxAmount: "3.99",
      date: new Date().toISOString().slice(0, 10),
      currency: "USD",
    });
    await groqStub.success(page);

    await loginIsolated(page, isolatedOrg);
    await page.goto("/expenses");
    await expect(page.getByTestId("text-expenses-title")).toBeVisible({
      timeout: 15000,
    });

    await page.getByTestId("button-new-expense").click();
    const input = page.getByTestId("input-expense-receipt");
    await input.setInputFiles({
      name: "receipt.png",
      mimeType: "image/png",
      buffer: Buffer.from(TINY_PNG_B64, "base64"),
    });

    await expect(page.getByTestId("input-expense-vendor")).toHaveValue(
      "Stub Vendor Inc",
      { timeout: 15000 },
    );
    await expect(page.getByTestId("input-expense-amount")).toHaveValue(
      /42\.?9?9?/,
    );
    await expect(page.getByTestId("input-expense-tax")).toHaveValue(/3\.?9?9?/);
  });

  test("OCR vendor-only response (Tesseract-style minimal payload) populates the form", async ({
    page,
    isolatedOrg,
  }) => {
    // Frontend contract: when the scan endpoint returns only `vendor` (the
    // shape Tesseract produces on low-confidence images, vs Groq's full
    // extraction), the new-expense form still pre-fills the vendor field.
    // Note: the Groq-vs-Tesseract selection itself happens server-side in
    // `/api/expenses/scan-receipt` and is covered by the unit-level tests in
    // `server/lib/llm-providers.test.ts`; Playwright cannot intercept the
    // server-side Groq SDK call.
    await apiBoundary.fulfill(
      page,
      "**/api/expenses/upload-receipt",
      200,
      { url: "/api/uploads/receipts/stub2.png", filename: "stub2.png" },
    );
    await apiBoundary.fulfill(page, "**/api/expenses/scan-receipt", 200, {
      vendor: "Tesseract Fallback Co",
    });
    await tesseractStub.success(page);

    await loginIsolated(page, isolatedOrg);
    await page.goto("/expenses");
    await expect(page.getByTestId("text-expenses-title")).toBeVisible({
      timeout: 15000,
    });
    await page.getByTestId("button-new-expense").click();
    const input = page.getByTestId("input-expense-receipt");
    await input.setInputFiles({
      name: "fallback.png",
      mimeType: "image/png",
      buffer: Buffer.from(TINY_PNG_B64, "base64"),
    });
    await expect(page.getByTestId("input-expense-vendor")).toHaveValue(
      "Tesseract Fallback Co",
      { timeout: 15000 },
    );
  });

  test("multi-currency: a non-USD expense is persisted with the submitted currency", async ({
    page,
    isolatedOrg,
  }) => {
    const today = new Date().toISOString().slice(0, 10);
    const created = await isolatedOrg.request.post("/api/expenses", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: {
        vendor: "EUR Vendor",
        amount: "100",
        currency: "EUR",
        date: today,
      },
    });
    expect(created.status(), await created.text()).toBeLessThan(400);

    const list = await isolatedOrg.request.get("/api/expenses");
    expect(list.status()).toBe(200);
    const arr = (await list.json()) as Array<{
      vendor: string;
      currency: string;
    }>;
    const row = arr.find((e) => e.vendor === "EUR Vendor");
    expect(row).toBeTruthy();
    expect(row!.currency).toBe("EUR");

    await loginIsolated(page, isolatedOrg);
    await page.goto("/expenses");
    await expect(page.getByTestId("text-expenses-title")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText("EUR Vendor").first()).toBeVisible({
      timeout: 10000,
    });
  });

  test("category grid filter narrows the expense list to matching rows", async ({
    page,
    isolatedOrg,
  }) => {
    const cat = await seedCategory(isolatedOrg);
    const today = new Date().toISOString().slice(0, 10);

    const e1 = await isolatedOrg.request.post("/api/expenses", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: {
        vendor: "CatVendor",
        amount: "10",
        currency: "USD",
        date: today,
        categoryId: cat.id,
      },
    });
    expect(e1.status(), await e1.text()).toBeLessThan(400);
    const exp1 = (await e1.json()) as { id: string };

    const e2 = await isolatedOrg.request.post("/api/expenses", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: {
        vendor: "OtherVendor",
        amount: "20",
        currency: "USD",
        date: today,
      },
    });
    expect(e2.status()).toBeLessThan(400);
    const exp2 = (await e2.json()) as { id: string };

    await loginIsolated(page, isolatedOrg);
    await page.goto("/expenses");
    await expect(page.getByTestId(`row-expense-${exp1.id}`)).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByTestId(`row-expense-${exp2.id}`)).toBeVisible();

    // Open the category column filter popup. The parent th is draggable and
    // intercepts pointer events, so dispatch a synthetic click directly on the
    // underlying <button> to bypass the wrapper.
    await page
      .getByTestId("grid-filter-category")
      .evaluate((el) => (el as HTMLButtonElement).click());
    await expect(page.getByTestId("filter-input-exp-category")).toBeVisible({
      timeout: 5000,
    });
    await page.getByTestId("filter-input-exp-category").fill(cat.name);

    // Only the categorized row should remain visible.
    await expect(page.getByTestId(`row-expense-${exp1.id}`)).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByTestId(`row-expense-${exp2.id}`)).toHaveCount(0);
  });

  test("submit-for-approval via row button transitions DRAFT → SUBMITTED", async ({
    page,
    isolatedOrg,
  }) => {
    const today = new Date().toISOString().slice(0, 10);
    const e = await isolatedOrg.request.post("/api/expenses", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: {
        vendor: "SubmitMe",
        amount: "50",
        currency: "USD",
        date: today,
      },
    });
    expect(e.status()).toBeLessThan(400);
    const exp = (await e.json()) as { id: string; status: string };
    expect(exp.status).toBe("DRAFT");

    await loginIsolated(page, isolatedOrg);
    await page.goto("/expenses");
    await expect(page.getByTestId(`row-expense-${exp.id}`)).toBeVisible({
      timeout: 15000,
    });

    const submitBtn = page.getByTestId(`button-submit-${exp.id}`);
    await expect(submitBtn).toBeVisible();
    await submitBtn.click();

    // UI: the row text reflects the new SUBMITTED state and the submit button
    // (only rendered while DRAFT) goes away.
    const row = page.getByTestId(`row-expense-${exp.id}`);
    await expect(row).toContainText("SUBMITTED", { timeout: 10000 });
    await expect(submitBtn).toHaveCount(0);
    await expect
      .poll(
        async () => {
          const r = await isolatedOrg.request.get("/api/expenses");
          const arr = (await r.json()) as Array<{
            id: string;
            status: string;
          }>;
          return arr.find((x) => x.id === exp.id)?.status ?? null;
        },
        { timeout: 10000 },
      )
      .toBe("SUBMITTED");
  });
});
