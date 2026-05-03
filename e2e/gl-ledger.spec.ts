import { test, expect } from "../tests/helpers/po/fixtures";
import { loginAsIsoAdmin, seedCoa, pickNonControlExpense, seedExtraRevenue } from "./_gl-helpers";

test.describe.configure({ mode: "serial" });

async function postJE(
  iso: { request: import("@playwright/test").APIRequestContext; csrf: string },
  date: string,
  drId: number,
  crId: number,
  amount: string,
  memo: string,
): Promise<void> {
  const r = await iso.request.post("/api/gl/journal-entries", {
    headers: { "x-csrf-token": iso.csrf },
    data: {
      entryDate: date,
      memo,
      lines: [
        { accountId: drId, debit: amount, credit: "0.00" },
        { accountId: crId, debit: "0.00", credit: amount },
      ],
    },
  });
  if (r.status() !== 201) {
    throw new Error(`postJE failed: ${r.status()} ${await r.text()}`);
  }
}

test.describe("General Ledger", () => {
  test("renders posted JE lines with balanced totals and per-account row", async ({
    isolatedOrg,
    browser,
  }) => {
    const seeded = await seedCoa(isolatedOrg);
    const dr = pickNonControlExpense(seeded);
    const cr = await seedExtraRevenue(isolatedOrg);

    const today = new Date().toISOString().slice(0, 10);
    await postJE(isolatedOrg, today, dr.id, cr.id, "250.00", "ledger fixture A");
    await postJE(isolatedOrg, today, dr.id, cr.id, "75.00", "ledger fixture B");

    const { page, close } = await loginAsIsoAdmin(browser, isolatedOrg);
    try {
      await page.goto("/gl/ledger");
      await expect(page.getByTestId("text-page-title")).toBeVisible();

      const totalDebit = (await page.getByTestId("text-total-debits").textContent())?.trim();
      const totalCredit = (await page.getByTestId("text-total-credits").textContent())?.trim();
      expect(totalDebit).toBeTruthy();
      expect(totalDebit).toBe(totalCredit);
      expect(totalDebit).toMatch(/325\.00/);

      // The two accounts the JE hit must each have a per-account row.
      await expect(page.getByTestId(`row-ledger-account-${dr.id}`)).toBeVisible();
      await expect(page.getByTestId(`row-ledger-account-${cr.id}`)).toBeVisible();
    } finally {
      await close();
    }
  });

  test("blank state: fresh org with no JEs renders the empty message", async ({
    isolatedOrg,
    browser,
  }) => {
    await seedCoa(isolatedOrg);
    const { page, close } = await loginAsIsoAdmin(browser, isolatedOrg);
    try {
      await page.goto("/gl/ledger");
      await expect(page.getByTestId("text-page-title")).toBeVisible();
      await expect(
        page.getByText(/No transactions found for this period/i),
      ).toBeVisible({ timeout: 10000 });
    } finally {
      await close();
    }
  });

  test("drill-down: expanding an account row reveals its underlying line", async ({
    isolatedOrg,
    browser,
  }) => {
    const seeded = await seedCoa(isolatedOrg);
    const dr = pickNonControlExpense(seeded);
    const cr = await seedExtraRevenue(isolatedOrg);
    const today = new Date().toISOString().slice(0, 10);
    await postJE(isolatedOrg, today, dr.id, cr.id, "42.00", "drill-down fixture");

    const lines = (await isolatedOrg.request
      .get(`/api/gl/report`)
      .then((r) => r.json())) as Array<{ id: number; lines: { lineId: number }[] }>;
    const drRow = lines.find((row) => row.id === dr.id)!;
    const lineId = drRow.lines[0].lineId;

    const { page, close } = await loginAsIsoAdmin(browser, isolatedOrg);
    try {
      await page.goto("/gl/ledger");
      const row = page.getByTestId(`row-ledger-account-${dr.id}`);
      await expect(row).toBeVisible();
      await row.click();
      await expect(page.getByTestId(`row-ledger-line-${lineId}`)).toBeVisible({
        timeout: 10000,
      });
    } finally {
      await close();
    }
  });

  test("date-range filter excludes out-of-range JEs", async ({ isolatedOrg, browser }) => {
    const seeded = await seedCoa(isolatedOrg);
    const dr = pickNonControlExpense(seeded);
    const cr = await seedExtraRevenue(isolatedOrg);

    await postJE(isolatedOrg, "1995-06-15", dr.id, cr.id, "999.00", "in-range");

    const { page, close } = await loginAsIsoAdmin(browser, isolatedOrg);
    try {
      await page.goto("/gl/ledger?startDate=1995-01-01&endDate=1995-12-31");
      await expect(page.getByTestId("text-page-title")).toBeVisible();
      await expect(page.getByTestId(`row-ledger-account-${dr.id}`)).toBeVisible({
        timeout: 10000,
      });

      // Now narrow to a window that excludes our JE.
      await page.getByTestId("input-start-date").fill("1996-01-01");
      await page.getByTestId("input-end-date").fill("1996-12-31");
      // Filter applies on change. Wait for the empty-state to land.
      await expect(page.getByTestId(`row-ledger-account-${dr.id}`)).toBeHidden({
        timeout: 10000,
      });
    } finally {
      await close();
    }
  });
});
