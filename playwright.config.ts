import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [
    ["line"],
    ["json", { outputFile: "test-results/results.json" }],
  ],
  outputDir: "test-results",
  use: {
    baseURL: `http://localhost:${process.env.PORT || 5000}`,
    actionTimeout: 8_000,
    navigationTimeout: 15_000,
  },
});
