import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Canonical-host redirect: www.<apex> → <apex>, permanently.
 *
 * The app is configured for exactly one origin. BASE_URL / APP_BASE_URL drive
 * the OAuth redirect URIs, the Stripe webhook and every emailed link, and the
 * session cookie is host-only. A visitor who lands on www.cherryworkspro.com
 * would otherwise get a second, independent session whose OAuth callbacks come
 * back to the apex without it. Sending www to the apex once, before anything
 * else runs, keeps every cookie, CSRF token and callback on one host.
 *
 * Only the www form of the canonical host is redirected. The Azure FQDN,
 * localhost, and the pod-IP hosts Azure's probes use all pass straight through.
 */

/** Host (with port, if any) of BASE_URL, or null when it is unset, malformed, or itself a www host. */
export function resolveCanonicalHost(baseUrl: string | undefined): string | null {
  if (!baseUrl) return null;
  try {
    const url = new URL(baseUrl);
    const host = url.host.toLowerCase();
    // A www BASE_URL would make the redirect point at itself. Refuse rather than loop.
    if (!host || url.hostname.toLowerCase().startsWith("www.")) return null;
    return host;
  } catch {
    return null;
  }
}

export function canonicalHostRedirect(canonicalHost: string | null): RequestHandler {
  if (!canonicalHost) {
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }
  const canonicalHostname = canonicalHost.replace(/:\d+$/, "");
  const wwwHostname = `www.${canonicalHostname}`;

  return (req: Request, res: Response, next: NextFunction) => {
    // req.hostname honours X-Forwarded-Host under `trust proxy` and strips the port.
    const hostname = (req.hostname || "").toLowerCase();
    if (hostname !== wwwHostname) return next();
    // 301 for safe methods; 308 keeps the method and body for anything else.
    const status = req.method === "GET" || req.method === "HEAD" ? 301 : 308;
    res.redirect(status, `https://${canonicalHost}${req.originalUrl}`);
  };
}
