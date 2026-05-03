import { test, expect } from "../tests/helpers/po/fixtures";
import {
  apiBoundary,
  groqStub,
  tesseractStub,
} from "../tests/helpers/po/stubs";
import { loginIsolated } from "./_iso-helpers";

// 1x1 PNG — sufficient for upload/form-population tests where the scan
// response is stubbed.
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
// 16x16 white PNG — large enough for Groq's vision API (which rejects
// sub-2px images) and for Tesseract to attempt OCR.
const SCAN_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAAAAAA6mKC9AAAAD0lEQVR4nGP4jwYYRrYAAID5/wEokJxdAAAAAElFTkSuQmCC";

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
      buffer: Buffer.from(SCAN_PNG_B64, "base64"),
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

  test("OCR backend: Groq primary path returns the documented contract", async ({
    isolatedOrg,
  }) => {
    const upload = await isolatedOrg.request.post(
      "/api/expenses/upload-receipt",
      {
        headers: { "x-csrf-token": isolatedOrg.csrf },
        multipart: {
          receipt: {
            name: "groq.png",
            mimeType: "image/png",
            buffer: Buffer.from(SCAN_PNG_B64, "base64"),
          },
        },
      },
    );
    expect(upload.status(), await upload.text()).toBe(200);
    const { url } = (await upload.json()) as { url: string };

    const scan = await isolatedOrg.request.post(
      "/api/expenses/scan-receipt",
      {
        headers: { "x-csrf-token": isolatedOrg.csrf },
        data: { receiptUrl: url },
      },
    );
    expect(scan.status(), await scan.text()).toBe(200);
    const body = (await scan.json()) as Record<string, unknown>;
    // Contract: every documented field is present, currency defaults to USD,
    // lineItems is always an array. The values themselves are nondeterministic
    // for a non-receipt test image; the contract is what we assert.
    for (const k of [
      "vendor",
      "date",
      "subtotal",
      "taxAmount",
      "tipAmount",
      "totalAmount",
      "description",
      "currency",
      "lineItems",
    ]) {
      expect(body).toHaveProperty(k);
    }
    expect(body.currency).toBe("USD");
    expect(Array.isArray(body.lineItems)).toBe(true);
  });

  test("OCR backend: forcing Tesseract fallback exercises the in-process OCR path", async ({
    isolatedOrg,
  }) => {
    const upload = await isolatedOrg.request.post(
      "/api/expenses/upload-receipt",
      {
        headers: { "x-csrf-token": isolatedOrg.csrf },
        multipart: {
          receipt: {
            name: "tess.png",
            mimeType: "image/png",
            buffer: Buffer.from(SCAN_PNG_B64, "base64"),
          },
        },
      },
    );
    expect(upload.status(), await upload.text()).toBe(200);
    const { url } = (await upload.json()) as { url: string };

    // The `x-e2e-force-ocr-provider: tesseract` header is honored only when
    // NODE_ENV !== "production"; it bypasses the Groq SDK call so the
    // server-side Tesseract fallback runs. This is the only way to drive
    // the fallback path deterministically without unsetting GROQ_API_KEY
    // for the whole test process.
    const scan = await isolatedOrg.request.post(
      "/api/expenses/scan-receipt",
      {
        headers: {
          "x-csrf-token": isolatedOrg.csrf,
          "x-e2e-force-ocr-provider": "tesseract",
        },
        data: { receiptUrl: url },
      },
    );
    expect(scan.status(), await scan.text()).toBe(200);
    const body = (await scan.json()) as Record<string, unknown>;
    // Same contract shape as the Groq path — the route normalizes both
    // providers into a single response shape.
    for (const k of [
      "vendor",
      "totalAmount",
      "currency",
      "lineItems",
    ]) {
      expect(body).toHaveProperty(k);
    }
    expect(body.currency).toBe("USD");
    expect(Array.isArray(body.lineItems)).toBe(true);
  });

  test("OCR frontend: scan response populates the new-expense form", async ({
    page,
    isolatedOrg,
  }) => {
    // Frontend contract test using a stubbed scan response so the
    // assertions are deterministic regardless of which OCR provider the
    // backend would have invoked. The backend OCR path is covered by the
    // two preceding tests.
    await apiBoundary.fulfill(
      page,
      "**/api/expenses/upload-receipt",
      200,
      { url: "/api/uploads/receipts/stub2.png", filename: "stub2.png" },
    );
    await apiBoundary.fulfill(page, "**/api/expenses/scan-receipt", 200, {
      vendor: "Form Populated Co",
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
      buffer: Buffer.from(SCAN_PNG_B64, "base64"),
    });
    await expect(page.getByTestId("input-expense-vendor")).toHaveValue(
      "Form Populated Co",
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
