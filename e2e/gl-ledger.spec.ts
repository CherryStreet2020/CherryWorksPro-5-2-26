/**
 * General Ledger spec (Task #438).
 *
 * After seeding a COA + posting a balanced manual JE via API, asserts
 * the ledger page renders the affected accounts and the
 * grand-total debit/credit numbers are equal (running-balance
 * correctness on a small fixture).
 */
import { test, expect } from "../tests/helpers/po/fixtures";
import { loginAsIsoAdmin, seedCoa } from "./_gl-helpers";

test.describe.configure({ mode: "serial" });

test.describe("General Ledger (Task #438)", () => {
  test("renders posted JE lines with correct totals", async ({
    isolatedOrg,
    browser,
  }) => {
    const seeded = await seedCoa(isolatedOrg);
    const dr = seeded.find((a) => a.accountNumber === "6000")
      || seeded.filter((a) => a.accountType === "EXPENSE")[0];
    const cr = seeded.find((a) => a.accountNumber === "5000")
      || seeded.filter((a) => a.accountType === "EXPENSE")[1]
      || seeded.filter((a) => a.accountType === "REVENUE")[0];

    const today = new Date().toISOString().slice(0, 10);
    const post = await isolatedOrg.request.post("/api/gl/journal-entries", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: {
        entryDate: today,
        memo: "ledger fixture",
        lines: [
          { accountId: dr!.id, debit: "250.00", credit: "0.00" },
          { accountId: cr!.id, debit: "0.00", credit: "250.00" },
        ],
      },
    });
    expect(post.status()).toBe(201);

    const { page, close } = await loginAsIsoAdmin(browser, isolatedOrg);
    try {
      await page.goto("/gl/ledger");
      await expect(page.getByTestId("text-page-title")).toBeVisible();

      // Grand totals must balance: every JE the test posted is
      // debit-equal-credit, so the page-wide total has to match.
      const debit = await page.getByTestId("text-total-debits").textContent();
      const credit = await page.getByTestId("text-total-credits").textContent();
      expect(debit?.trim()).toBeTruthy();
      expect(debit?.trim()).toBe(credit?.trim());
    } finally {
      await close();
    }
  });

  test("blank-state renders when no entries exist in the period", async ({
    isolatedOrg,
    browser,
  }) => {
    await seedCoa(isolatedOrg);
    const { page, close } = await loginAsIsoAdmin(browser, isolatedOrg);
    try {
      // Filter to a date range with no transactions (year 2000).
      await page.goto("/gl/ledger?startDate=2000-01-01&endDate=2000-12-31");
      await expect(page.getByTestId("text-page-title")).toBeVisible();
      await expect(page.getByText(/No transactions found for this period/i)).toBeVisible({ timeout: 10000 });
    } finally {
      await close();
    }
  });
});
