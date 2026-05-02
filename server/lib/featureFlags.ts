/**
 * Marketing OS — server-side feature flag gate.
 *
 * This is the SINGLE source of truth for `process.env.MARKETING_OS_ENABLED`
 * on the server. Do NOT read the env var directly anywhere else.
 *
 * Independent from the in-memory `featureFlagStore` at
 * `server/routes/feature-flags-routes.ts` — that system uses a different
 * keyspace for runtime toggles.
 */
export function isMarketingOsEnabled(): boolean {
  return process.env.MARKETING_OS_ENABLED === "true";
}
