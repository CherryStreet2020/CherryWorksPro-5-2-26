import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  loginApi,
  loginViaPage as loginViaPageHelper,
  getCsrfToken,
  BASE,
} from "../tests/helpers/po/auth";

// Task #445: removed hardcoded `CherryWorks2026!` (drift from
// `e2e/global-setup.ts`, which resets the seed admin to `admin123`).
// `loginApi` / `loginViaPage` from the shared helper try the canonical
// password first and fall back to `admin123` so the spec works under
// both arrangements.

async function login(request: APIRequestContext) {
  await loginApi(request);
}

async function loginViaPage(page: import("@playwright/test").Page) {
  await loginViaPageHelper(page);
}

async function apiPost(
  request: APIRequestContext,
  csrfToken: string,
  path: string,
  data?: Record<string, unknown>,
) {
  return request.post(`${BASE}${path}`, {
    data,
    headers: { "X-CSRF-Token": csrfToken },
  });
}

async function getKpis(request: APIRequestContext) {
  const r = await request.get(`${BASE}/api/reports/executive-kpis`);
  expect(r.status()).toBe(200);
  return r.json();
}

async function getInvoice(request: APIRequestContext, id: string) {
  const r = await request.get(`${BASE}/api/invoices/${id}`);
  expect(r.status()).toBe(200);
  return r.json();
}

test.describe("Dashboard Outstanding KPI regression", () => {
  const lineRate = 500;
  const today = new Date().toISOString().split("T")[0];
  const dueDate = new Date(Date.now() + 30 * 86400000)
    .toISOString()
    .split("T")[0];

  test("Outstanding rises after sending an invoice, then drops after full payment", async ({
    request,
    page,
  }) => {
    await login(request);
    const csrf = await getCsrfToken(request);

    const clientsRes = await request.get(`${BASE}/api/clients`);
    const clients = await clientsRes.json();
    expect(clients.length).toBeGreaterThan(0);
    const clientId = clients[0].id;

    const kpiBefore = await getKpis(request);
    const outstandingBefore = Number(kpiBefore.totalOutstanding);
    const collectedBefore = Number(kpiBefore.collectedThisMonth);

    const createRes = await apiPost(request, csrf, "/api/invoices", {
      clientId,
      issuedDate: today,
      dueDate,
      currency: "USD",
    });
    expect(createRes.status()).toBe(200);
    const invoice = await createRes.json();
    const invoiceId = invoice.id;
    expect(invoice.status).toBe("DRAFT");

    const lineRes = await apiPost(
      request,
      csrf,
      `/api/invoices/${invoiceId}/lines`,
      {
        description: "E2E KPI test service",
        quantity: 1,
        unitRate: lineRate,
      },
    );
    expect(lineRes.status()).toBe(200);

    const invoiceAfterLine = await getInvoice(request, invoiceId);
    const invoiceTotal = Number(invoiceAfterLine.total);
    expect(invoiceTotal).toBeGreaterThanOrEqual(lineRate);

    const kpiWhileDraft = await getKpis(request);
    expect(Number(kpiWhileDraft.totalOutstanding)).toBeCloseTo(
      outstandingBefore,
      0,
    );

    const sendRes = await apiPost(
      request,
      csrf,
      `/api/invoices/${invoiceId}/send`,
    );
    expect(sendRes.status()).toBe(200);

    const kpiAfterSend = await getKpis(request);
    const outstandingAfterSend = Number(kpiAfterSend.totalOutstanding);
    expect(outstandingAfterSend).toBeCloseTo(
      outstandingBefore + invoiceTotal,
      0,
    );

    await loginViaPage(page);
    const outstandingCard = page.locator('[data-testid="kpi-outstanding"]');
    await expect(outstandingCard).toBeVisible({ timeout: 15000 });
    const ariaLabel = await outstandingCard.getAttribute("aria-label");
    expect(ariaLabel).toContain("Outstanding");

    const payRes = await apiPost(request, csrf, "/api/payments", {
      invoiceId,
      amount: invoiceTotal,
      date: today,
      method: "Bank Transfer",
    });
    expect(payRes.status()).toBe(200);

    const kpiAfterPay = await getKpis(request);
    const outstandingAfterPay = Number(kpiAfterPay.totalOutstanding);
    const collectedAfterPay = Number(kpiAfterPay.collectedThisMonth);

    expect(outstandingAfterPay).toBeCloseTo(outstandingBefore, 0);
    expect(collectedAfterPay).toBeCloseTo(
      collectedBefore + invoiceTotal,
      0,
    );

    await page.reload();
    await page.waitForLoadState("networkidle", { timeout: 15000 });
    await expect(
      page.locator('[data-testid="kpi-outstanding"]'),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.locator('[data-testid="kpi-collected"]'),
    ).toBeVisible({ timeout: 15000 });
  });
});
