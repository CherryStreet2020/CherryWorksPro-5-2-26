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

export function appBaseUrl(req?: Request): string {
  const configured = (process.env.APP_BASE_URL || process.env.BASE_URL || "").trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (req) {
    const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() || req.protocol || "http";
    const host = (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim() || req.get("host") || "localhost:5000";
    return `${proto}://${host}`;
  }
  return "http://localhost:5000";
}
