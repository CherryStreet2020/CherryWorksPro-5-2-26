/**
 * The public origin to put in emails and redirects.
 *
 * Order: APP_BASE_URL, BASE_URL, then the proxy-forwarded origin, then the
 * Host header. Onboarding mail used to build links from `req.headers.host`
 * alone (four copies in team-routes), which is attacker-controlled on any
 * request and pointed at "localhost:5000" when absent. On Azure both
 * variables are set to https://cherryworkspro.com.
 */
import type { Request } from "express";

/** The origin from configuration only (APP_BASE_URL, BASE_URL, then the Replit domain); null when none is set. */
export function configuredBaseUrl(): string | null {
  const configured = (process.env.APP_BASE_URL || process.env.BASE_URL || "").trim();
  if (configured) return configured.replace(/\/+$/, "");
  const replit = (process.env.REPLIT_DOMAINS || "").split(",")[0]?.trim();
  if (replit) return `https://${replit}`;
  return null;
}

/**
 * For security-sensitive links (password reset): never derived from the
 * request. In production an unconfigured origin fails closed rather than
 * letting a forged X-Forwarded-Host point a victim's reset link elsewhere.
 */
export function trustedBaseUrl(): string {
  const configured = configuredBaseUrl();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") throw new Error("APP_BASE_URL is not configured; refusing to build a public link from request headers");
  return "http://localhost:5000";
}

export function appBaseUrl(req?: Request): string {
  const configured = configuredBaseUrl();
  if (configured) return configured;
  if (req) {
    const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() || req.protocol || "http";
    const host = (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim() || req.get("host") || "localhost:5000";
    return `${proto}://${host}`;
  }
  return "http://localhost:5000";
}
