const { chromium } = require("playwright");

async function run() {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const results = [];

  try {
    await page.goto("http://localhost:5000/login", { waitUntil: "networkidle" });
    await page.fill('[data-testid="input-email"]', "dean@cherrystconsulting.com");
    await page.fill('[data-testid="input-password"]', "CherryWorks2026!");
    await page.click('[data-testid="button-login"]');
    await page.waitForTimeout(3000);
    results.push("PASS: Logged in as admin");

    await page.goto("http://localhost:5000/gl/accounts", { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);
    results.push("PASS: Navigated to /gl/accounts");

    const title = await page.locator('[data-testid="text-page-title"]').textContent();
    results.push(
      title?.includes("Chart of Accounts")
        ? "PASS: Page title is 'Chart of Accounts'"
        : "FAIL: Page title expected 'Chart of Accounts', got '" + title + "'"
    );

    const rowCount = await page.locator('tr[data-testid^="row-account-"]').count();
    results.push(
      rowCount > 0
        ? "PASS: Found " + rowCount + " account row(s) (expected >= 1)"
        : "FAIL: No account rows found"
    );

    const cashRow = await page.locator("text=Cash - Operating").count();
    results.push(
      cashRow > 0
        ? "PASS: 'Cash - Operating' account found on page"
        : "FAIL: 'Cash - Operating' account NOT found"
    );

    const accountNumbers = [];
    for (let i = 0; i < rowCount; i++) {
      const cell = page.locator('tr[data-testid^="row-account-"]').nth(i).locator("td").first();
      const text = await cell.textContent();
      accountNumbers.push(parseInt(text || "0", 10));
    }
    const isSorted = accountNumbers.every((v, i) => i === 0 || v >= accountNumbers[i - 1]);
    results.push(
      isSorted
        ? "PASS: Accounts sorted by account number (" + accountNumbers.join(", ") + ")"
        : "FAIL: Accounts NOT sorted (" + accountNumbers.join(", ") + ")"
    );
  } catch (err) {
    results.push("ERROR: " + err.message);
  } finally {
    await browser.close();
  }

  const allPass = results.every((r) => r.startsWith("PASS"));
  const output = results.join("\n") + "\n\n" + (allPass ? "ALL TESTS PASSED" : "SOME TESTS FAILED");
  console.log(output);
  process.exit(allPass ? 0 : 1);
}

run();
