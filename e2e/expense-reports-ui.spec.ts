import { test, expect } from "../tests/helpers/po/fixtures";
import { loginIsolated } from "./_iso-helpers";

async function seedReportInSubmittedState(iso: {
  request: import("@playwright/test").APIRequestContext;
  csrf: string;
  orgId: string;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const expR = await iso.request.post("/api/expenses", {
    headers: { "x-csrf-token": iso.csrf },
    data: { vendor: `RVendor ${Date.now()}`, amount: "75", currency: "USD", date: today },
  });
  expect(expR.status(), await expR.text()).toBeLessThan(400);
  const exp = (await expR.json()) as { id: string };

  const repR = await iso.request.post("/api/expense-reports", {
    headers: { "x-csrf-token": iso.csrf },
    data: { title: `Rep ${Date.now()}`, periodStart: today, periodEnd: today },
  });
  expect(repR.status(), await repR.text()).toBeLessThan(400);
  const report = (await repR.json()) as { id: string };

  const attach = await iso.request.post(
    `/api/expense-reports/${report.id}/add-expense`,
    {
      headers: { "x-csrf-token": iso.csrf },
      data: { expenseId: exp.id },
    },
  );
  expect(attach.status(), await attach.text()).toBeLessThan(400);

  const submit = await iso.request.post(
    `/api/expense-reports/${report.id}/submit`,
    { headers: { "x-csrf-token": iso.csrf } },
  );
  expect(submit.status(), await submit.text()).toBeLessThan(400);

  return { reportId: report.id, expenseId: exp.id };
}

async function fetchReportStatus(
  iso: { request: import("@playwright/test").APIRequestContext },
  reportId: string,
): Promise<string | null> {
  const list = await iso.request.get("/api/expense-reports");
  if (list.status() !== 200) return null;
  const arr = (await list.json()) as Array<{ id: string; status: string }>;
  return arr.find((r) => r.id === reportId)?.status ?? null;
}

test.describe("Expense reports — create + manager approve/reject/reimburse (#440)", () => {
  test("create a report via UI, list shows the row", async ({
    page,
    isolatedOrg,
  }) => {
    await loginIsolated(page, isolatedOrg);
    await page.goto("/expense-reports");
    await expect(page.getByTestId("text-expense-reports-title")).toBeVisible({
      timeout: 15000,
    });

    const title = `E2E Report ${Date.now()}`;
    await page.getByTestId("button-new-report").click();
    await page.getByTestId("input-report-title").fill(title);
    const today = new Date().toISOString().slice(0, 10);
    await page.getByTestId("input-report-period-start").fill(today);
    await page.getByTestId("input-report-period-end").fill(today);
    await page.getByTestId("button-save-report").click();

    await expect(page.getByText(title).first()).toBeVisible({ timeout: 10000 });
  });

  test("manager approve flow: SUBMITTED → APPROVED via row button", async ({
    page,
    isolatedOrg,
  }) => {
    const { reportId } = await seedReportInSubmittedState(isolatedOrg);

    await loginIsolated(page, isolatedOrg);
    await page.goto("/expense-reports");
    await expect(page.getByTestId(`row-report-${reportId}`)).toBeVisible({
      timeout: 15000,
    });

    const approveBtn = page.getByTestId(`button-approve-report-${reportId}`);
    await expect(approveBtn).toBeVisible({ timeout: 5000 });
    await approveBtn.click();

    // UI: the row must now show the APPROVED badge and the approve action goes away.
    const row = page.getByTestId(`row-report-${reportId}`);
    await expect(row.getByTestId("badge-status-approved")).toBeVisible({
      timeout: 10000,
    });
    await expect(approveBtn).toHaveCount(0);
    // Backend invariant.
    await expect
      .poll(() => fetchReportStatus(isolatedOrg, reportId), { timeout: 10000 })
      .toBe("APPROVED");
  });

  test("manager reject flow: SUBMITTED → REJECTED with reason", async ({
    page,
    isolatedOrg,
  }) => {
    const { reportId } = await seedReportInSubmittedState(isolatedOrg);

    await loginIsolated(page, isolatedOrg);
    await page.goto("/expense-reports");
    await expect(page.getByTestId(`row-report-${reportId}`)).toBeVisible({
      timeout: 15000,
    });

    const rejBtn = page.getByTestId(`button-reject-report-${reportId}`);
    await expect(rejBtn).toBeVisible({ timeout: 5000 });
    await rejBtn.click();

    await expect(page.getByTestId("input-report-reject-reason")).toBeVisible({
      timeout: 5000,
    });
    await page
      .getByTestId("input-report-reject-reason")
      .fill("Missing receipts");
    await page.getByTestId("button-confirm-reject-report").click();

    // UI: row shows REJECTED badge + the rejection reason snippet.
    const row = page.getByTestId(`row-report-${reportId}`);
    await expect(row.getByTestId("badge-status-rejected")).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.getByTestId(`text-rejection-reason-${reportId}`),
    ).toContainText("Missing receipts");
    await expect
      .poll(() => fetchReportStatus(isolatedOrg, reportId), { timeout: 10000 })
      .toBe("REJECTED");
  });

  test("reimburse flow: APPROVED → REIMBURSED via row button", async ({
    page,
    isolatedOrg,
  }) => {
    const { reportId } = await seedReportInSubmittedState(isolatedOrg);
    // Move from SUBMITTED → APPROVED via API so this test focuses on the
    // reimburse UI button (which only appears on APPROVED reports).
    const approve = await isolatedOrg.request.post(
      `/api/expense-reports/${reportId}/approve`,
      { headers: { "x-csrf-token": isolatedOrg.csrf } },
    );
    expect(approve.status(), await approve.text()).toBeLessThan(400);

    await loginIsolated(page, isolatedOrg);
    await page.goto("/expense-reports");
    await expect(page.getByTestId(`row-report-${reportId}`)).toBeVisible({
      timeout: 15000,
    });
    const reimburseBtn = page.getByTestId(`button-reimburse-report-${reportId}`);
    await expect(reimburseBtn).toBeVisible({ timeout: 5000 });
    await reimburseBtn.click();

    // UI: row flips to REIMBURSED and the reimburse action disappears.
    const row = page.getByTestId(`row-report-${reportId}`);
    await expect(row.getByTestId("badge-status-reimbursed")).toBeVisible({
      timeout: 10000,
    });
    await expect(reimburseBtn).toHaveCount(0);
    await expect
      .poll(() => fetchReportStatus(isolatedOrg, reportId), { timeout: 10000 })
      .toBe("REIMBURSED");
  });
});
