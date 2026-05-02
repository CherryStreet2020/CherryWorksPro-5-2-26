let testOverride: boolean | null = null;

export function isEmailOauthEnabled(): boolean {
  if (testOverride !== null) return testOverride;
  return process.env.EMAIL_OAUTH_ENABLED === "true";
}

export function __setEmailOauthEnabledForTests(value: boolean | null): void {
  testOverride = value;
}

export function __resetEmailOauthFlagForTests(): void {
  testOverride = null;
}
