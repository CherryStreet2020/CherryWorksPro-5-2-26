import { test, expect } from "../tests/helpers/po/fixtures";
import { loginAsIsoAdmin, seedCoa, findAccount, pickNonControlExpense, seedExtraRevenue } from "./_gl-helpers";

interface JournalEntry {
  id: number;
  memo: string | null;
  sourceType: string | null;
}

test.describe.configure({ mode: "serial" });

test.describe("Journal Entries", () => {
  test("create + post a balanced manual JE through the preview dialog", async ({
    isolatedOrg,
    browser,
  }) => {
    const seeded = await seedCoa(isolatedOrg);
    const dr = pickNonControlExpense(seeded);
    const cr = await seedExtraRevenue(isolatedOrg);

    const { page, close } = await loginAsIsoAdmin(browser, isolatedOrg);
    const memo = `E2E manual JE ${Date.now()}`;
    try {
      await page.goto("/gl/journal-entries");
      await page.getByTestId("button-new-journal-entry").click();
      await expect(page.getByTestId("input-entry-date")).toBeVisible();

      const today = new Date().toISOString().slice(0, 10);
      await page.getByTestId("input-entry-date").fill(today);
      await page.getByTestId("input-entry-memo").fill(memo);

      await page.getByTestId("select-line-account-0").click();
      await page.getByRole("option", { name: new RegExp(`^${dr.accountNumber}`) }).click();
      await page.getByTestId("input-line-debit-0").fill("123.45");

      await page.getByTestId("select-line-account-1").click();
      await page.getByRole("option", { name: new RegExp(`^${cr.accountNumber}`) }).click();
      await page.getByTestId("input-line-credit-1").fill("123.45");

      const submit = page.getByTestId("button-submit-journal-entry");
      await expect(submit).toBeEnabled({ timeout: 5000 });
      await submit.click();

      await expect(page.getByTestId("button-confirm-post-je")).toBeVisible();
      await page.getByTestId("button-confirm-post-je").click();

      await expect(page.getByText("Journal entry created")).toBeVisible({ timeout: 10000 });

      // Server-side check: our specific memo landed.
      const start = `${new Date().getFullYear()}-01-01`;
      const list = (await isolatedOrg.request
        .get(`/api/gl/journal-entries?startDate=${start}&endDate=${today}`)
        .then((r) => r.json())) as JournalEntry[];
      expect(list.some((j) => j.memo === memo && j.sourceType === null)).toBe(true);
    } finally {
      await close();
    }
  });

  test("submit is disabled until debits equal credits", async ({
    isolatedOrg,
    browser,
  }) => {
    const seeded = await seedCoa(isolatedOrg);
    const a = pickNonControlExpense(seeded);
    const b = await seedExtraRevenue(isolatedOrg);

    const { page, close } = await loginAsIsoAdmin(browser, isolatedOrg);
    try {
      await page.goto("/gl/journal-entries");
      await page.getByTestId("button-new-journal-entry").click();
      await page.getByTestId("input-entry-date").fill(new Date().toISOString().slice(0, 10));

      await page.getByTestId("select-line-account-0").click();
      await page.getByRole("option", { name: new RegExp(`^${a.accountNumber}`) }).click();
      await page.getByTestId("input-line-debit-0").fill("100.00");

      await page.getByTestId("select-line-account-1").click();
      await page.getByRole("option", { name: new RegExp(`^${b.accountNumber}`) }).click();
      await page.getByTestId("input-line-credit-1").fill("50.00");

      const submit = page.getByTestId("button-submit-journal-entry");
      await expect(submit).toBeDisabled();
      await expect(submit).toContainText(/Debits must equal Credits/i);

      await page.getByTestId("input-line-credit-1").fill("100.00");
      await expect(submit).toBeEnabled({ timeout: 5000 });
    } finally {
      await close();
    }
  });

  test("server rejects manual JE that touches a control account", async ({
    isolatedOrg,
  }) => {
    const seeded = await seedCoa(isolatedOrg);
    const cash = findAccount(seeded, "1000");
    const expense = pickNonControlExpense(seeded);

    const r = await isolatedOrg.request.post("/api/gl/journal-entries", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: {
        entryDate: new Date().toISOString().slice(0, 10),
        memo: "should be rejected",
        lines: [
          { accountId: cash.id, debit: "5.00", credit: "0.00" },
          { accountId: expense.id, debit: "0.00", credit: "5.00" },
        ],
      },
    });
    expect(r.status()).toBe(400);
    const body = (await r.json()) as { message: string };
    expect(body.message).toMatch(/control account/i);
  });
});
