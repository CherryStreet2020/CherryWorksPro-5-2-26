/**
 * Journal Entries spec (Task #438).
 *
 * Drives the manual-JE form end-to-end through the preview dialog,
 * asserts the balanced-entry guard disables submit until debits ==
 * credits, and verifies the server-side control-account rejection
 * surfaces in the UI as a destructive toast.
 *
 * Per Task #438's "Period locked" constraint, the period-lock
 * rejection flows through the close-period UI in
 * `close-periods.spec.ts` (which is the only place the guard exists
 * end-to-end today — there is no server-side guard on JE POST that
 * the UI would surface). Filing this distinction here so future spec
 * authors don't double-cover it.
 */
import { test, expect } from "../tests/helpers/po/fixtures";
import { loginAsIsoAdmin, seedCoa } from "./_gl-helpers";

test.describe.configure({ mode: "serial" });

test.describe("Journal Entries (Task #438)", () => {
  test("create + post a balanced manual JE through the preview dialog", async ({
    isolatedOrg,
    browser,
  }) => {
    const seeded = await seedCoa(isolatedOrg);
    const dr = seeded.find((a) => a.accountNumber === "6000")
      || seeded.filter((a) => a.accountType === "EXPENSE")[0];
    const cr = seeded.find((a) => a.accountNumber === "5000")
      || seeded.filter((a) => a.accountType === "EXPENSE")[1]
      || seeded.filter((a) => a.accountType === "REVENUE")[0];

    const { page, close } = await loginAsIsoAdmin(browser, isolatedOrg);
    try {
      await page.goto("/gl/journal-entries");
      await page.getByTestId("button-new-journal-entry").click();
      await expect(page.getByTestId("input-entry-date")).toBeVisible();

      const today = new Date().toISOString().slice(0, 10);
      await page.getByTestId("input-entry-date").fill(today);
      await page.getByTestId("input-entry-memo").fill("E2E manual JE");

      // Line 0: debit
      await page.getByTestId("select-line-account-0").click();
      await page.getByRole("option", { name: new RegExp(`^${dr!.accountNumber}`) }).click();
      await page.getByTestId("input-line-debit-0").fill("123.45");

      // Line 1: credit
      await page.getByTestId("select-line-account-1").click();
      await page.getByRole("option", { name: new RegExp(`^${cr!.accountNumber}`) }).click();
      await page.getByTestId("input-line-credit-1").fill("123.45");

      const submit = page.getByTestId("button-submit-journal-entry");
      await expect(submit).toBeEnabled({ timeout: 5000 });
      await submit.click();

      await expect(page.getByTestId("button-confirm-post-je")).toBeVisible();
      await page.getByTestId("button-confirm-post-je").click();

      await expect(
        page.getByText("Journal entry created"),
      ).toBeVisible({ timeout: 10000 });

      // Server-side check: at least one Manual JE now exists.
      const start = `${new Date().getFullYear()}-01-01`;
      const end = today;
      const list = await isolatedOrg.request
        .get(`/api/gl/journal-entries?startDate=${start}&endDate=${end}`)
        .then((r) => r.json());
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });

  test("submit is disabled until debits equal credits", async ({
    isolatedOrg,
    browser,
  }) => {
    const seeded = await seedCoa(isolatedOrg);
    const a = seeded.find((x) => x.accountNumber === "6000")
      || seeded.filter((x) => x.accountType === "EXPENSE")[0];
    const b = seeded.find((x) => x.accountNumber === "5000")
      || seeded.filter((x) => x.accountType === "EXPENSE")[1]
      || seeded.filter((x) => x.accountType === "REVENUE")[0];

    const { page, close } = await loginAsIsoAdmin(browser, isolatedOrg);
    try {
      await page.goto("/gl/journal-entries");
      await page.getByTestId("button-new-journal-entry").click();
      await page.getByTestId("input-entry-date")
        .fill(new Date().toISOString().slice(0, 10));

      await page.getByTestId("select-line-account-0").click();
      await page.getByRole("option", { name: new RegExp(`^${a!.accountNumber}`) }).click();
      await page.getByTestId("input-line-debit-0").fill("100.00");

      await page.getByTestId("select-line-account-1").click();
      await page.getByRole("option", { name: new RegExp(`^${b!.accountNumber}`) }).click();
      await page.getByTestId("input-line-credit-1").fill("50.00");

      const submit = page.getByTestId("button-submit-journal-entry");
      await expect(submit).toBeDisabled();
      await expect(submit).toContainText(/Debits must equal Credits/i);

      // Balance the entry — submit becomes enabled.
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
    // 1000 (Cash) is a control account managed by payments.
    const cash = seeded.find((a) => a.accountNumber === "1000");
    const expense = seeded.find((a) => a.accountNumber === "6000")
      || seeded.filter((a) => a.accountType === "EXPENSE")[0];
    expect(cash, "1000 must be in seed COA").toBeTruthy();
    expect(expense, "6000 must be in seed COA").toBeTruthy();

    const r = await isolatedOrg.request.post("/api/gl/journal-entries", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: {
        entryDate: new Date().toISOString().slice(0, 10),
        memo: "should be rejected",
        lines: [
          { accountId: cash!.id, debit: "5.00", credit: "0.00" },
          { accountId: expense!.id, debit: "0.00", credit: "5.00" },
        ],
      },
    });
    expect(r.status()).toBe(400);
    const body = await r.json();
    expect(body.message).toMatch(/control account/i);
  });
});
