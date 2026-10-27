/**
 * Public, session-less open/click tracking for marketing email.
 *
 *   GET /api/public/email/o/<token>.gif     1x1 pixel; always the GIF
 *   GET /api/public/email/c/<token>/<n>     302 to the n-th link stored for
 *                                           that send, else a 404 page
 *
 * Registered at the top of registerRoutes, ahead of the session middleware
 * and the global /api limiters: a stale session cookie must not turn a pixel
 * into a 401, and the few shared IPs Gmail / Outlook fetch images from must
 * not hit the 300/min per-IP bucket. These routes carry their own limits.
 *
 * The redirect target is never read from the request — only from the row
 * written at send time — so the click route is not an open redirect.
 */
import type { Express, NextFunction, Request, Response } from "express";
import { redactPath } from "../../lib/logging";
import { isTrackingToken } from "../../marketing/tracking";
import { findTrackedLinks, recordClick, recordOpen } from "../../marketing/tracking-record";
import { page } from "./unsubscribe";

const isTestEnv = process.env.NODE_ENV === "test";

// 43-byte transparent GIF89a.
export const PIXEL_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==",
  "base64",
);

const notFoundPage = page(
  "Link not recognised",
  `<h1>Link not recognised</h1><p>This link is not valid or has expired.</p>`,
);

/**
 * Fixed-window counter per key; the map is cleared every window. At most
 * `maxKeys` distinct keys are tracked per window — once full, unseen keys are
 * denied, so a flood of random tokens cannot grow memory without bound.
 */
export function windowLimiter(max: number, windowMs = 60_000, maxKeys = 50_000) {
  let windowStart = Date.now();
  let counts = new Map<string, number>();
  return (key: string): boolean => {
    const now = Date.now();
    if (now - windowStart >= windowMs) {
      windowStart = now;
      counts = new Map();
    }
    const seen = counts.get(key);
    if (seen === undefined && counts.size >= maxKeys) return false;
    const n = (seen ?? 0) + 1;
    counts.set(key, n);
    return n <= max;
  };
}

// Database lookups per client IP, and recordings per email.
const ipAllowed = windowLimiter(isTestEnv ? 1_000_000 : 1_200);
const recordAllowed = windowLimiter(isTestEnv ? 1_000_000 : 30);

/** `trust proxy` is 1 (server/index.ts), so req.ip is the client hop the proxy saw, not a forgeable header. */
export function clientIp(req: Pick<Request, "ip">): string {
  return req.ip || "unknown";
}

function noStore(res: Response): void {
  res.setHeader("Cache-Control", "no-store, no-cache, private, max-age=0");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Referrer-Policy", "no-referrer");
}

export function registerMarketingTrackingRoutes(app: Express): void {
  app.get("/api/public/email/o/:file", async (req: Request, res: Response) => {
    noStore(res);
    const match = /^(.+)\.gif$/.exec(String(req.params.file));
    const token = match?.[1] ?? "";
    // HEAD is answered by Express from this GET handler; only real GETs record.
    if (req.method === "GET" && isTrackingToken(token)
      && ipAllowed(clientIp(req)) && recordAllowed(token)) {
      await recordOpen(token);
    }
    res.type("image/gif").send(PIXEL_GIF);
  });

  app.get("/api/public/email/c/:token/:index", async (req: Request, res: Response) => {
    noStore(res);
    const token = String(req.params.token);
    const rawIndex = String(req.params.index);
    if (!isTrackingToken(token) || !/^\d{1,3}$/.test(rawIndex)) {
      return res.status(404).type("html").send(notFoundPage);
    }
    if (!ipAllowed(clientIp(req))) {
      res.setHeader("Retry-After", "60");
      return res.status(429).type("text/plain").send("Too many requests. Please try again in a minute.");
    }
    try {
      const links = await findTrackedLinks(token);
      const index = Number(rawIndex);
      const dest = links && index < links.length ? links[index] : null;
      if (typeof dest !== "string") return res.status(404).type("html").send(notFoundPage);
      if (req.method === "GET" && recordAllowed(token)) await recordClick(token, dest);
      return res.redirect(302, dest);
    } catch (err) {
      console.error("[marketing-tracking] click lookup failed:", err instanceof Error ? err.message : err);
      res.setHeader("Retry-After", "30");
      return res.status(503).type("html").send(
        page("Something went wrong", `<h1>Something went wrong</h1><p>Please try the link again in a minute.</p>`),
      );
    }
  });

  // Anything else under the prefix ends here, before the later
  // `/api/{*path}` fallback, whose param decoding would throw on a malformed
  // `%` with the raw path in the message.
  app.use("/api/public/email", (_req: Request, res: Response) => {
    noStore(res);
    res.status(404).type("html").send(notFoundPage);
  });

  // Errors raised while routing these URLs (a malformed `%` in a segment makes
  // Express throw "Failed to decode param '<raw>'") would reach the global
  // handler, which logs and returns err.message — the token with it. Answer
  // them here, logging only the redacted path.
  app.use("/api/public/email", (err: unknown, req: Request, res: Response, next: NextFunction) => {
    console.warn("[marketing-tracking] bad request:", redactPath(req.originalUrl.split("?")[0]));
    if (res.headersSent) return next(new Error("tracking response failed"));
    noStore(res);
    const status = (err as { status?: number })?.status;
    if (status !== undefined && status >= 400 && status < 500) {
      return res.status(404).type("html").send(notFoundPage);
    }
    return res.status(500).type("text/plain").send("Something went wrong.");
  });
}
