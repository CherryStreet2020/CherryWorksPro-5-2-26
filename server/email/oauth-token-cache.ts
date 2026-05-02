interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

const cache = new Map<string, CachedToken>();
const SAFETY_WINDOW_MS = 60_000;

export function getCachedAccessToken(key: string): string | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() + SAFETY_WINDOW_MS >= entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.accessToken;
}

export function setCachedAccessToken(key: string, accessToken: string, expiresInSec: number): void {
  cache.set(key, {
    accessToken,
    expiresAt: Date.now() + expiresInSec * 1000,
  });
}

export function invalidateCachedAccessToken(key: string): void {
  cache.delete(key);
}

export function __clearOauthTokenCacheForTests(): void {
  cache.clear();
}
