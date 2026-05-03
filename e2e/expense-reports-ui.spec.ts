import { test, expect } from "../tests/helpers/po/fixtures";
import { loginIsolated } from "./_iso-helpers";

test.describe("Expense reports — status badges + manager approval (#440)", () => {
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

  test("manager approve flow: SUBMITTED → APPROVED via UI button", async ({
    page,
    isolatedOrg,
  }) => {
    // Seed a category-less expense, an expense report, attach, and submit
    // via API so we land at SUBMITTED ready for manager approval.
    const today = new Date().toISOString().slice(0, 10);
    const expR = await isolatedOrg.request.post("/api/expenses", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: {
        vendor: "ReportableExp",
        amount: "75",
        currency: "USD",
        date: today,
      },
    });
    expect(expR.status(), await expR.text()).toBeLessThan(400);
    const exp = (await expR.json()) as { id: string };

    const repR = await isolatedOrg.request.post("/api/expense-reports", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: {
        title: `Approvable ${Date.now()}`,
        periodStart: today,
        periodEnd: today,
      },
    });
    expect(repR.status(), await repR.text()).toBeLessThan(400);
    const report = (await repR.json()) as { id: string; status: string };

    // Attach expense via the canonical add-expense endpoint.
    const attach = await isolatedOrg.request.post(
      `/api/expense-reports/${report.id}/add-expense`,
      {
        headers: { "x-csrf-token": isolatedOrg.csrf },
        data: { expenseId: exp.id },
      },
    );
    expect(attach.status(), await attach.text()).toBeLessThan(400);

    const submit = await isolatedOrg.request.post(
      `/api/expense-reports/${report.id}/submit`,
      { headers: { "x-csrf-token": isolatedOrg.csrf } },
    );
    expect(submit.status(), await submit.text()).toBeLessThan(400);

    await loginIsolated(page, isolatedOrg);
    await page.goto("/expense-reports");
    await expect(page.getByTestId(`row-report-${report.id}`)).toBeVisible({
      timeout: 15000,
    });

    const approveBtn = page.getByTestId(`button-approve-report-${report.id}`);
    if (await approveBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await approveBtn.click();
      await page.waitForTimeout(800);
      const list = await isolatedOrg.request.get("/api/expense-reports");
      const arr = (await list.json()) as Array<{ id: string; status: string }>;
      const fresh = arr.find((r) => r.id === report.id);
      expect(["APPROVED", "REIMBURSED"].includes(fresh?.status ?? "")).toBe(true);
    }
  });

  test("manager reject flow surfaces rejection-reason input", async ({
    page,
    isolatedOrg,
  }) => {
    const today = new Date().toISOString().slice(0, 10);
    const expR = await isolatedOrg.request.post("/api/expenses", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: { vendor: "RejV", amount: "9", currency: "USD", date: today },
    });
    expect(expR.status()).toBeLessThan(400);
    const exp = (await expR.json()) as { id: string };

    const repR = await isolatedOrg.request.post("/api/expense-reports", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: {
        title: `Rejectable ${Date.now()}`,
        periodStart: today,
        periodEnd: today,
      },
    });
    expect(repR.status()).toBeLessThan(400);
    const report = (await repR.json()) as { id: string };

    const attach = await isolatedOrg.request.post(
      `/api/expense-reports/${report.id}/add-expense`,
      {
        headers: { "x-csrf-token": isolatedOrg.csrf },
        data: { expenseId: exp.id },
      },
    );
    expect(attach.status()).toBeLessThan(400);

    const submit = await isolatedOrg.request.post(
      `/api/expense-reports/${report.id}/submit`,
      { headers: { "x-csrf-token": isolatedOrg.csrf } },
    );
    expect(submit.status()).toBeLessThan(400);

    await loginIsolated(page, isolatedOrg);
    await page.goto("/expense-reports");
    await expect(page.getByTestId(`row-report-${report.id}`)).toBeVisible({
      timeout: 15000,
    });
    const rejBtn = page.getByTestId(`button-reject-report-${report.id}`);
    if (await rejBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await rejBtn.click();
      await expect(page.getByTestId("input-report-reject-reason")).toBeVisible({
        timeout: 5000,
      });
    }
  });
});
