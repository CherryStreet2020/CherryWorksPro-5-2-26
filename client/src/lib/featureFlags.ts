/**
 * Marketing OS — client-side feature flag gate.
 *
 * This is the SINGLE source of truth for `import.meta.env.VITE_MARKETING_OS_ENABLED`
 * on the client. Do NOT read the env var directly anywhere else.
 */
export const isMarketingOsEnabled = (): boolean => true;
