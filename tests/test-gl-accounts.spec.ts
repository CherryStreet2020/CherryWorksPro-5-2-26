import { chromium, Browser, Page, BrowserContext } from "playwright";

async function run() {
  const browser: Browser = await chromium.launch({ args: ["--no-sandbox"] });
  const context: BrowserContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page: Page = await context.newPage();
  const results: string[] = [];

  try {
    // Login as admin
    await page.goto("http://localhost:5000/login", { waitUntil: "networkidle" });
    await page.fill('[data-testid="input-email"]', "dean@cherrystconsulting.com");
    await page.fill('[data-testid="input-password"]', "CherryWorks2026!");
    await page.click('[data-testid="button-login"]');
    await page.waitForTimeout(3000);
    results.push("PASS: Logged in as admin");

    // Navigate to /gl/accounts
    await page.goto("http://localhost:5000/gl/accounts", { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);
    results.push("PASS: Navigated to /gl/accounts");

    // Assert page title
    const title = await page.locator('[data-testid="text-page-title"]').textContent();
    if (title?.includes("Chart of Accounts")) {
      results.push("PASS: Page title is 'Chart of Accounts'");
    } else {
      results.push("FAIL: Page title expected 'Chart of Accounts', got '" + title + "'");
    }

    // Assert at least one row
    const rowCount = await page.locator('tr[data-testid^="row-account-"]').count();
    if (rowCount > 0) {
      results.push(`PASS: Found ${rowCount} account row(s) (expected >= 1)`);
    } else {
      results.push("FAIL: No account rows found");
    }

    // Assert 'Cash - Operating' exists
    const cashRow = await page.locator('text=Cash - Operating').count();
    if (cashRow > 0) {
      results.push("PASS: 'Cash - Operating' account found on page");
    } else {
      results.push("FAIL: 'Cash - Operating' account NOT found");
    }

    // Assert rows are sorted by account number (ascending)
    const accountNumbers: number[] = [];
    for (let i = 0; i < rowCount; i++) {
      const cell = page.locator('tr[data-testid^="row-account-"]').nth(i).locator("td").first();
      const text = await cell.textContent();
      accountNumbers.push(parseInt(text || "0", 10));
    }
    const isSorted = accountNumbers.every((v, i) => i === 0 || v >= accountNumbers[i - 1]);
    if (isSorted) {
      results.push(`PASS: Accounts sorted by account number (${accountNumbers.join(", ")})`);
    } else {
      results.push(`FAIL: Accounts NOT sorted (${accountNumbers.join(", ")})`);
    }

  } catch (err: any) {
    results.push("ERROR: " + err.message);
  } finally {
    await browser.close();
  }

  const output = results.join("\n");
  console.log(output);

  const allPass = results.every(r => r.startsWith("PASS"));
  console.log("\n" + (allPass ? "ALL TESTS PASSED" : "SOME TESTS FAILED"));

  const fs = await import("fs");
  fs.writeFileSync("/tmp/p2-fix/playwright-output.txt", output + "\n\n" + (allPass ? "ALL TESTS PASSED" : "SOME TESTS FAILED") + "\n");

  process.exit(allPass ? 0 : 1);
}

run();
