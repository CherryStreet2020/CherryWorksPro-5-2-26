/**
 * Trial Balance spec (Task #438).
 *
 * Per audit §7 item 14: a sequence of mixed-side transactions must
 * produce equal grand totals on the trial balance. Mints the COA,
 * posts two balanced manual JEs via API, and asserts the
 * "Balanced" badge plus equal totals.
 */
import { test, expect } from "../tests/helpers/po/fixtures";
import { loginAsIsoAdmin, seedCoa } from "./_gl-helpers";

test.describe.configure({ mode: "serial" });

test.describe("Trial Balance (Task #438)", () => {
  test("balanced badge appears after posting balanced JEs", async ({
    isolatedOrg,
    browser,
  }) => {
    const seeded = await seedCoa(isolatedOrg);
    const exp1 = seeded.find((a) => a.accountNumber === "6000")
      || seeded.filter((a) => a.accountType === "EXPENSE")[0];
    const rev1 = seeded.find((a) => a.accountNumber === "4900")
      || seeded.filter((a) => a.accountType === "REVENUE" && a.accountNumber !== "4000")[0]
      || seeded.filter((a) => a.accountType === "EXPENSE")[1];
    const exp2 = seeded.filter((a) => a.accountType === "EXPENSE")
      .find((a) => a.id !== exp1!.id) || exp1;
    const rev2 = seeded.filter((a) => a.accountType === "REVENUE" && a.accountNumber !== "4000")
      .find((a) => a.id !== rev1!.id) || rev1;

    const today = new Date().toISOString().slice(0, 10);
    for (const [d, c, amt] of [
      [exp1!.id, rev1!.id, "100.00"],
      [exp2!.id, rev2!.id, "75.50"],
    ] as const) {
      const r = await isolatedOrg.request.post("/api/gl/journal-entries", {
        headers: { "x-csrf-token": isolatedOrg.csrf },
        data: {
          entryDate: today,
          memo: "trial-balance fixture",
          lines: [
            { accountId: d, debit: amt, credit: "0.00" },
            { accountId: c, debit: "0.00", credit: amt },
          ],
        },
      });
      expect(r.status(), await r.text()).toBe(201);
    }

    const { page, close } = await loginAsIsoAdmin(browser, isolatedOrg);
    try {
      await page.goto("/gl/trial-balance");
      await expect(page.getByTestId("text-page-title")).toBeVisible();

      const badge = page.getByTestId("badge-balance-status");
      await expect(badge).toBeVisible({ timeout: 10000 });
      await expect(badge).toContainText(/Balanced/i);

      const debit = await page.getByTestId("text-total-debits").textContent();
      const credit = await page.getByTestId("text-total-credits").textContent();
      expect(debit?.trim()).toBe(credit?.trim());
    } finally {
      await close();
    }
  });
});
