/**
 * Marketing OS — client-side feature flag gate.
 *
 * Reads `import.meta.env.VITE_MARKETING_OS_ENABLED`. The Vite build
 * inlines this at server start, so flipping the env var requires a
 * server restart (the workflow `Start application` sets it to "true";
 * the dedicated flag-OFF Playwright web-server in
 * `playwright.feature-flags-off.config.ts` sets it to "false").
 *
 * Default-on: when the variable is absent or empty we treat the
 * feature as enabled, so existing dev/prod environments behave the
 * same as before this gate was introduced. Only the literal string
 * "false" disables the surface.
 */
export const isMarketingOsEnabled = (): boolean =>
  import.meta.env.VITE_MARKETING_OS_ENABLED !== "false";
