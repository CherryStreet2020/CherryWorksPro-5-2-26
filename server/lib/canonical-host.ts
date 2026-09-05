import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Canonical-host redirect: www.<apex> → <apex>, permanently.
 *
 * The app is configured for exactly one origin. APP_BASE_URL / BASE_URL drive
 * the OAuth redirect URIs, the Stripe webhook and every emailed link, and the
 * session cookie is host-only. A visitor who lands on www.cherryworkspro.com
 * would otherwise get a second, independent session whose OAuth callbacks come
 * back to the apex without it. Sending www to the apex once, before anything
 * else runs, keeps every cookie, CSRF token and callback on one host.
 *
 * Only the www form of the canonical hostname is redirected. The Azure FQDN,
 * localhost, and the pod-IP hosts Azure's probes use all pass straight through.
 */

export interface CanonicalOrigin {
  /** Scheme + host (+ port) exactly as configured, e.g. "https://cherryworkspro.com". */
  origin: string;
  /** Lower-cased hostname without port, e.g. "cherryworkspro.com". */
  hostname: string;
}

/**
 * The canonical origin from the configured base URL, or null when it is unset,
 * malformed, not http(s), or itself a www host (a www base would make the redirect loop).
 */
export function resolveCanonicalOrigin(baseUrl: string | undefined): CanonicalOrigin | null {
  if (!baseUrl) return null;
  try {
    const url = new URL(baseUrl);
    // Only http(s) has a usable origin; anything else serialises `origin` as the string "null".
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const hostname = url.hostname.toLowerCase();
    if (!hostname || hostname.startsWith("www.")) return null;
    return { origin: url.origin.toLowerCase(), hostname };
  } catch {
    return null;
  }
}

export function canonicalHostRedirect(canonical: CanonicalOrigin | null): RequestHandler {
  if (!canonical) {
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }
  const wwwHostname = `www.${canonical.hostname}`;
  const { origin } = canonical;

  return (req: Request, res: Response, next: NextFunction) => {
    // req.hostname honours X-Forwarded-Host under `trust proxy` and strips the port.
    const hostname = (req.hostname || "").toLowerCase();
    if (hostname !== wwwHostname) return next();
    // 301 for safe methods; 308 keeps the method and body for anything else.
    const status = req.method === "GET" || req.method === "HEAD" ? 301 : 308;
    res.redirect(status, `${origin}${req.originalUrl}`);
  };
}
