/**
 * Marketing OS Sprint 2b — domain normalization + free-mail detection.
 *
 * SINGLE SOURCE OF TRUTH for any code path that touches a domain string.
 * No ad-hoc lower/split/regex anywhere else (route validators, storage
 * helpers, and contact auto-link MUST go through these helpers).
 */

const DOMAIN_RE = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

const FREE_MAIL_DOMAINS = new Set<string>([
  "gmail.com", "googlemail.com",
  "outlook.com", "hotmail.com", "live.com", "msn.com",
  "yahoo.com", "ymail.com", "rocketmail.com",
  "icloud.com", "me.com", "mac.com",
  "aol.com",
  "proton.me", "protonmail.com", "pm.me",
  "mail.com",
  "gmx.com", "gmx.us",
  "zoho.com", "yandex.com", "fastmail.com",
  "hey.com", "duck.com",
]);

// Merge env-supplied additions at module load.
{
  const extra = process.env.MARKETING_FREE_MAIL_EXTRA;
  if (extra) {
    for (const raw of extra.split(",")) {
      const d = normalizeDomain(raw);
      if (d) FREE_MAIL_DOMAINS.add(d);
    }
  }
}

/**
 * Normalize a domain string to its canonical lower-case form.
 * Returns null if the input is empty, malformed, or fails the validation regex.
 *
 * Examples:
 *   normalizeDomain(" FOO.COM ")  → "foo.com"
 *   normalizeDomain(".foo.com")   → null  (leading dot rejected)
 *   normalizeDomain("foo..com")   → null  (double-dot rejected)
 *   normalizeDomain("-foo.com")   → null  (leading hyphen rejected)
 *   normalizeDomain("foo")        → null  (no TLD)
 *   normalizeDomain("foo.c")      → null  (TLD < 2 chars)
 */
export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  // Only trim whitespace + lowercase. Do NOT strip leading/trailing dots —
  // the regex must reject malformed inputs like ".foo.com" or "foo.com.".
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  return DOMAIN_RE.test(trimmed) ? trimmed : null;
}

/**
 * Extract the domain portion of an email address and normalize it.
 * Returns null on any malformed input.
 */
export function extractDomainFromEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  if (at < 0 || at === email.length - 1) return null;
  return normalizeDomain(email.slice(at + 1));
}

/**
 * Returns true if the given (already-normalized) domain is a known
 * consumer free-mail provider. Such domains MUST NOT trigger company
 * auto-create on contact create/update.
 */
export function isFreeMailDomain(domain: string): boolean {
  return FREE_MAIL_DOMAINS.has(domain);
}

// Exposed for tests only — do not mutate from production code paths.
export const __FREE_MAIL_DOMAINS_FOR_TESTS = FREE_MAIL_DOMAINS;
export const __DOMAIN_RE_FOR_TESTS = DOMAIN_RE;
