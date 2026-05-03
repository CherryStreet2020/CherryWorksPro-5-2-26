import { test, expect } from "../tests/helpers/po/fixtures";
import { loginAsIsoAdmin, seedCoa, pickNonControlExpense, seedExtraRevenue } from "./_gl-helpers";

test.describe.configure({ mode: "serial" });

test.describe("Trial Balance", () => {
  test("balanced badge + equal grand totals after a sequence of mixed JEs", async ({
    isolatedOrg,
    browser,
  }) => {
    const seeded = await seedCoa(isolatedOrg);
    const exp = pickNonControlExpense(seeded);
    const rev = await seedExtraRevenue(isolatedOrg);

    const today = new Date().toISOString().slice(0, 10);
    const amounts = ["100.00", "75.50", "12.34"];
    let expected = 0;
    for (const amt of amounts) {
      const r = await isolatedOrg.request.post("/api/gl/journal-entries", {
        headers: { "x-csrf-token": isolatedOrg.csrf },
        data: {
          entryDate: today,
          memo: "trial-balance fixture",
          lines: [
            { accountId: exp.id, debit: amt, credit: "0.00" },
            { accountId: rev.id, debit: "0.00", credit: amt },
          ],
        },
      });
      expect(r.status(), await r.text()).toBe(201);
      expected += Number(amt);
    }

    const { page, close } = await loginAsIsoAdmin(browser, isolatedOrg);
    try {
      await page.goto("/gl/trial-balance");
      await expect(page.getByTestId("text-page-title")).toBeVisible();

      const badge = page.getByTestId("badge-balance-status");
      await expect(badge).toBeVisible({ timeout: 10000 });
      await expect(badge).toContainText(/Balanced/i);

      const debit = (await page.getByTestId("text-total-debits").textContent())?.trim();
      const credit = (await page.getByTestId("text-total-credits").textContent())?.trim();
      expect(debit).toBeTruthy();
      expect(debit).toBe(credit);

      // Server-side check: the total debit equals our expected sum.
      const tb = await isolatedOrg.request
        .get(`/api/gl/report`)
        .then((r) => r.json());
      const expRow = (tb as Array<{ id: number; totalDebit: string }>)
        .find((row) => row.id === exp.id);
      expect(expRow).toBeTruthy();
      expect(Number(expRow!.totalDebit)).toBeCloseTo(expected, 2);

      // Per-account row for the expense account must be present.
      await expect(page.getByTestId(`row-trial-balance-${exp.id}`)).toBeVisible();
    } finally {
      await close();
    }
  });

  test("blank state: fresh org renders the empty message", async ({
    isolatedOrg,
    browser,
  }) => {
    await seedCoa(isolatedOrg);
    const { page, close } = await loginAsIsoAdmin(browser, isolatedOrg);
    try {
      await page.goto("/gl/trial-balance");
      await expect(page.getByTestId("text-page-title")).toBeVisible();
      await expect(
        page.getByText(/No account balances found/i),
      ).toBeVisible({ timeout: 10000 });
    } finally {
      await close();
    }
  });

  test("as-of-date filter narrows the report", async ({ isolatedOrg, browser }) => {
    const seeded = await seedCoa(isolatedOrg);
    const exp = pickNonControlExpense(seeded);
    const rev = await seedExtraRevenue(isolatedOrg);

    const r = await isolatedOrg.request.post("/api/gl/journal-entries", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: {
        entryDate: "1995-06-15",
        memo: "as-of fixture",
        lines: [
          { accountId: exp.id, debit: "500.00", credit: "0.00" },
          { accountId: rev.id, debit: "0.00", credit: "500.00" },
        ],
      },
    });
    expect(r.status(), await r.text()).toBe(201);

    const { page, close } = await loginAsIsoAdmin(browser, isolatedOrg);
    try {
      await page.goto("/gl/trial-balance");
      await expect(page.getByTestId("text-page-title")).toBeVisible();

      // Set as-of to before the JE date — the row must vanish.
      await page.getByTestId("input-as-of-date").fill("1990-01-01");
      await expect(page.getByTestId(`row-trial-balance-${exp.id}`)).toBeHidden({
        timeout: 10000,
      });

      // Set as-of forward — the row must reappear.
      await page.getByTestId("input-as-of-date").fill("1995-12-31");
      await expect(page.getByTestId(`row-trial-balance-${exp.id}`)).toBeVisible({
        timeout: 10000,
      });
    } finally {
      await close();
    }
  });
});
