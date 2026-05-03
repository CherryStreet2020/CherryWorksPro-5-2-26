export function isMarketingOsEnabled(): boolean {
  return process.env.MARKETING_OS_ENABLED === "true";
}
