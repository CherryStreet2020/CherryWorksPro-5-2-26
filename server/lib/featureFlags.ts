let testOverride: boolean | null = null;

export function isMarketingOsEnabled(): boolean {
  if (testOverride !== null) return testOverride;
  return process.env.MARKETING_OS_ENABLED === "true";
}

export function __setMarketingOsEnabledForTests(value: boolean | null): void {
  testOverride = value;
}

export function __resetMarketingOsFlagForTests(): void {
  testOverride = null;
}
