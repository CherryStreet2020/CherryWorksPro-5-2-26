/**
 * Shared base URL for HTTP integration tests.
 *
 * The Vitest global setup (`tests/setup/global-setup.ts`) boots a dedicated
 * test server on port 5100 with `NODE_ENV=test`, which puts `loginLimiter`
 * into its 1000-cap branch so parallel test files don't trip the rate
 * limiter on shared-IP login attempts.
 *
 * Tests should import `TEST_BASE` from here instead of hardcoding
 * `http://localhost:5000` so they stay decoupled from the dev workflow.
 */
export const TEST_BASE: string = process.env.TEST_BASE ?? "http://127.0.0.1:5100";
