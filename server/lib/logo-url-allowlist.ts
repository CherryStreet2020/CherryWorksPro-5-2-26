/**
 * Single source of truth for the org-logo URL SSRF allowlist (Task #474).
 *
 * Two call sites need the same host + path guard:
 *   1. `server/pdf.ts` — `loadLogoBytes()` fetches `orgs.logo_url`
 *      server-side when rendering invoices/quotes to PDF. Without a guard
 *      an admin could point this at an internal target (AWS metadata,
 *      RFC1918, etc.) and pivot the PDF route into an SSRF gadget.
 *   2. `server/routes/settings-routes.ts` — PATCH /api/org/settings
 *      validates an admin-supplied `logoUrl` before persisting it, so a
 *      bad value can never reach the database in the first place.
 *
 * Task #467 introduced the guard, Task #470 added regression tests, but
 * the two copies were maintained by hand. Task #474 extracts them here
 * so a future change to one site can't silently drift from the other.
 *
 * The behaviour pinned by `tests/unit/pdf-logo-loader-ssrf.test.ts`
 * lives entirely in this module — `server/pdf.ts` re-exports
 * `isAllowedLogoUrl` to preserve the existing import path.
 */

/**
 * Pathname prefixes inside an allowed host that the logo loader is
 * permitted to fetch. Anything outside these (e.g. `/api/admin/...`,
 * `/internal/metadata`) is rejected — even on a same-host URL — so a
 * malicious admin can't pivot the PDF route into an arbitrary
 * same-origin GET.
 */
export const ALLOWED_LOGO_PATH_PREFIXES = [
  "/api/public-objects/org-logos/",
  "/api/public-objects/brand-logos/",
  "/api/uploads/logos/",
] as const;

/**
 * Every host the logo loader is permitted to fetch from. Built from
 * APP_BASE_URL / BASE_URL / every comma-separated entry in
 * REPLIT_DOMAINS, plus the explicit local dev origins. We use `URL`
 * parsing (not substring match) so attacker-controlled values like
 * `https://evil.com#cherry-app.replit.app` can't slip past.
 */
export function getAllowedLogoHosts(): Set<string> {
  const hosts = new Set<string>();
  const add = (u: string | undefined | null) => {
    if (!u) return;
    try {
      hosts.add(new URL(u).host.toLowerCase());
    } catch {
      // ignore malformed entries
    }
  };
  add(process.env.APP_BASE_URL);
  add(process.env.BASE_URL);
  const domains = process.env.REPLIT_DOMAINS?.split(",") ?? [];
  for (const d of domains) {
    const t = d.trim();
    if (!t) continue;
    add(t.startsWith("http") ? t : `https://${t}`);
  }
  // Dev fallbacks — these are the only HTTP origins ever allowed.
  hosts.add("localhost:5000");
  hosts.add("127.0.0.1:5000");
  return hosts;
}

/**
 * True iff `pathname` (a URL pathname, not a full URL) starts with one
 * of `ALLOWED_LOGO_PATH_PREFIXES`. Used by both the absolute-URL guard
 * (`isAllowedLogoUrl`) and the settings route's relative-path branch.
 */
export function isAllowedLogoPath(pathname: string): boolean {
  return ALLOWED_LOGO_PATH_PREFIXES.some((p) => pathname.startsWith(p));
}

/**
 * Full host + path + protocol check for an absolute logo URL.
 *
 * Pinned by `tests/unit/pdf-logo-loader-ssrf.test.ts`. A future refactor
 * that re-opens the SSRF hole closed by Task #467 must fail that suite.
 */
export function isAllowedLogoUrl(absoluteUrl: string): boolean {
  let u: URL;
  try {
    u = new URL(absoluteUrl);
  } catch {
    return false;
  }
  // Loopback and private IP literals are never allowed in production.
  // (We still allow `localhost:5000` for dev — handled by the host
  // allowlist above.)
  const allowedHosts = getAllowedLogoHosts();
  if (!allowedHosts.has(u.host.toLowerCase())) return false;
  // Only https in production. Allow http for the explicit dev hosts.
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (u.protocol === "http:") {
    const isDevHost = u.host === "localhost:5000" || u.host === "127.0.0.1:5000";
    if (!isDevHost) return false;
  }
  return isAllowedLogoPath(u.pathname);
}
