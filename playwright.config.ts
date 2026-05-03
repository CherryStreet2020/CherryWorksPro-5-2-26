import { defineConfig } from "@playwright/test";

/**
 * Sharding & parallelism (Task #432).
 *
 * - `PW_WORKERS`        : worker count for the parallel project. Defaults to 4.
 * - `PW_SHARD` / `PW_TOTAL` : standard shard/of-N pair, e.g. 1/2 + 2/2 across two CI nodes.
 *
 * The suite is split into two projects so existing serial specs (which
 * mutate the shared seed admin) don't race each other while the
 * read-only public/anonymous specs get to fan out:
 *
 *   - `anonymous` : public marketing pages, error pages, switch-from
 *                   landing pages, public-token invalid surfaces, and
 *                   the parallel-safety smoke test. Runs with
 *                   `fullyParallel: true` and N workers.
 *   - `serial`    : everything else (authed CRUD, tenant-scoped specs
 *                   against the shared seed admin). Single worker so
 *                   the shared admin can't race itself. New specs that
 *                   want true isolation should use the `isolatedOrg`
 *                   fixture and re-tag themselves into the parallel
 *                   project (or a dedicated one).
 */
// Default of 2 workers is tuned for the local Vite-dev backend, which
// cold-compiles marketing routes on first hit and chokes around 4+
// parallel navigations. CI runs against a pre-built server and can
// safely crank `PW_WORKERS=8` (or higher) via env. The `serial`
// project is unaffected — it always runs at workers:1.
const PW_WORKERS = Number(process.env.PW_WORKERS || 2);

// Specs eligible for the parallel "anonymous" project: must NOT log in
// as the shared seed admin (race risk) and must NOT mutate global DB
// state. `error-pages.spec.ts` is intentionally excluded because it
// authenticates as the shared admin via `loginViaPage`. It belongs on
// the serial project until it's migrated to the `isolatedOrg` fixture.
const ANON_SPECS = [
  "_isolation-smoke.spec.ts",
  "_fixtures-smoke.spec.ts",
  "public-pricing.spec.ts",
  "public-marketing-pages.spec.ts",
  "public-token-pages.spec.ts",
  "switch-from-pages.spec.ts",
  // Task #442 — public marketing site CTA + interaction coverage.
  "public-marketing-home.spec.ts",
  "public-marketing-static-cta.spec.ts",
  "public-pricing-deeplink.spec.ts",
  "public-marketing-os-landing.spec.ts",
  "public-contact-form.spec.ts",
  // Public-token edge cases run isolatedOrg-scoped mutations (mints
  // its own org's tokens) and network-failure resilience hits anon
  // public forms; neither shares the seed-admin session, so they
  // are safe under fullyParallel.
  "public-token-edge-cases.spec.ts",
  "network-failure-resilience.spec.ts",
  "public-demo.spec.ts",
  "public-compare-switch-cta.spec.ts",
  // Flag specs use the isolatedOrg fixture (Task #432) so each test
  // logs in as its own org-specific admin — never the shared seed
  // admin — and is safe under fullyParallel.
  "feature-flag-marketing-os.flags-on.spec.ts",
  "feature-flag-email-oauth.flags-on.spec.ts",
];

function parseShard(): { current: number; total: number } | undefined {
  const cur = process.env.PW_SHARD;
  const total = process.env.PW_TOTAL;
  if (!cur || !total) return undefined;
  const c = Number(cur);
  const t = Number(total);
  if (!Number.isFinite(c) || !Number.isFinite(t) || c < 1 || t < 1 || c > t) {
    return undefined;
  }
  return { current: c, total: t };
}

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  retries: 0,
  reporter: [
    ["line"],
    ["json", { outputFile: "test-results/results.json" }],
  ],
  outputDir: "test-results",
  shard: parseShard(),
  use: {
    baseURL: `http://localhost:${process.env.PORT || 5000}`,
    actionTimeout: 8_000,
    navigationTimeout: 15_000,
  },
  projects: [
    {
      name: "anonymous",
      testMatch: ANON_SPECS,
      fullyParallel: true,
      workers: PW_WORKERS,
      // One automatic retry absorbs the residual Vite-dev cold-compile
      // flake under parallel load (a marketing route's first navigation
      // can race itself across workers and produce a transient
      // pageerror). The retry runs against a now-warm dev server, so it
      // is deterministic — not a hidden flake. Production CI against a
      // pre-built server should set `--retries=0` (or remove this).
      retries: 1,
    },
    {
      name: "serial",
      testIgnore: [...ANON_SPECS, /\.flags-off\.spec\.ts$/],
      fullyParallel: false,
      workers: 1,
    },
    // Task #445: pick up the 21 specs under `tests/e2e/` that the
    // audit (§5.1, §6.2.8) flagged as invisible to the default
    // Playwright invocation. They predate `e2e/` and use the legacy
    // direct-login pattern (canonical seed password reset by
    // `e2e/global-setup.ts`), so they all share the seed admin and
    // must run serially. They reuse the same `globalSetup` /
    // `globalTeardown` hooks because the top-level `globalSetup`
    // declaration applies project-wide; only `testDir` is
    // overridden per project.
    {
      name: "tests-e2e",
      testDir: "./tests/e2e",
      testMatch: /.*\.spec\.ts$/,
      fullyParallel: false,
      workers: 1,
      retries: 0,
    },
  ],
});
