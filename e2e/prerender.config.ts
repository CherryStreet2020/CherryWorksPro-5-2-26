// Standalone Playwright config for e2e/prerender.spec.ts: runs against the static
// preview of the production build (script/serve-prerendered.ts), so no global setup,
// no database, no login. `PORT=5010 npx playwright test -c e2e/prerender.config.ts`.
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: /prerender\.spec\.ts/,
  timeout: 30_000,
  retries: 0,
  workers: 2,
  reporter: "line",
  use: { baseURL: `http://localhost:${process.env.PORT || 5010}` },
});
