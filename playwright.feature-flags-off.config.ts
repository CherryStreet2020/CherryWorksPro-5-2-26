import { defineConfig } from "@playwright/test";

const PORT_OFF = 5101;
process.env.PORT = String(PORT_OFF);

export default defineConfig({
  testDir: "./e2e",
  testMatch: /\.flags-off\.spec\.ts$/,
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 1,
  reporter: [["line"]],
  outputDir: "test-results",
  use: {
    baseURL: `http://localhost:${PORT_OFF}`,
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  webServer: {
    command:
      `MARKETING_OS_ENABLED=false VITE_MARKETING_OS_ENABLED=false ` +
      `EMAIL_OAUTH_ENABLED=false VITE_EMAIL_OAUTH_ENABLED=false ` +
      `PORT=${PORT_OFF} npm run dev`,
    url: `http://localhost:${PORT_OFF}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
