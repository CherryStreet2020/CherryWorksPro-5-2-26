export function isValidRedirectUrl(url: string, allowedDomains: string[]): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    return allowedDomains.some(d => parsed.hostname === d || parsed.hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

export function isValidStripeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    return parsed.hostname === "stripe.com" || parsed.hostname.endsWith(".stripe.com");
  } catch {
    return false;
  }
}

export function isValidInternalUrl(url: string): boolean {
  if (!url.startsWith("/")) return false;
  if (url.startsWith("//")) return false;
  return true;
}

export function sanitizeRedirectUrl(url: string, allowedDomains: string[]): string | null {
  if (!url || typeof url !== "string") return null;
  const lower = url.trim().toLowerCase();
  if (lower.startsWith("javascript:") || lower.startsWith("data:") || lower.startsWith("vbscript:")) return null;
  if (isValidInternalUrl(url)) return url;
  if (isValidRedirectUrl(url, allowedDomains)) return url;
  return null;
}
