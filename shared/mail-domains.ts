/**
 * Consumer / shared mailbox domains. An address on one of these never identifies a
 * company: the demo form will not match it to a firm, and a client cannot list it as
 * an approved Help Center domain (anyone with a Gmail address would get in).
 */
export const SHARED_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "yahoo.com", "ymail.com", "icloud.com", "me.com", "mac.com", "aol.com", "proton.me",
  "protonmail.com", "pm.me", "gmx.com", "gmx.net", "zoho.com", "mail.com", "fastmail.com",
  "hey.com", "yandex.com",
]);

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Lower-cases and strips a leading "@" / whitespace. Returns null when not a valid public domain. */
export function normalizeDomain(raw: string): string | null {
  const d = String(raw ?? "").trim().toLowerCase().replace(/^@/, "").replace(/\.$/, "");
  return DOMAIN_RE.test(d) ? d : null;
}

export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  return at < 0 ? null : normalizeDomain(email.slice(at + 1));
}

export function isSharedMailDomain(domain: string): boolean {
  return SHARED_MAIL_DOMAINS.has(domain.toLowerCase());
}
