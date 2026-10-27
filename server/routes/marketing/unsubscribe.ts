/**
 * Public, session-less unsubscribe for marketing email.
 *
 *   GET  /unsubscribe/:token              confirm page (a link scanner that
 *                                         prefetches it changes nothing)
 *   GET  /api/public/unsubscribe/:token   redirects to the confirm page, for
 *                                         clients that open the List-Unsubscribe
 *                                         URL instead of POSTing to it
 *   POST /api/public/unsubscribe/:token   the page's button, and the RFC 8058
 *                                         one-click POST mail providers send
 *                                         from the List-Unsubscribe header
 *
 * /api/public/ is CSRF-exempt; the token alone authorises the change, which
 * is the point: the recipient has no account.
 */
import type { Express, Request, Response } from "express";
import {
  escapeHtml,
  findUnsubscribeTarget,
  isUnsubscribeToken,
  unsubscribeByToken,
} from "../../marketing/unsubscribe";

function page(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
  body { margin: 0; background: #f7f5f2; color: #1a1a2e; font-family: Arial, Helvetica, sans-serif; }
  main { max-width: 480px; margin: 64px auto; padding: 32px 24px; background: #fff; border: 1px solid #e6e3dd; border-radius: 8px; }
  h1 { font-size: 22px; margin: 0 0 12px; }
  p { font-size: 15px; line-height: 1.5; color: #555b66; margin: 0 0 20px; }
  button { font-size: 15px; padding: 10px 18px; border: 0; border-radius: 6px; background: #b3202a; color: #fff; cursor: pointer; }
  @media (max-width: 520px) { main { margin: 24px 16px; } }
</style>
</head>
<body><main>${bodyHtml}</main></body>
</html>`;
}

const notFoundPage = page(
  "Link not recognised",
  `<h1>Link not recognised</h1><p>This unsubscribe link is not valid. If you keep receiving email you did not ask for, reply to it and ask to be removed.</p>`,
);

function donePage(orgName: string): string {
  return page(
    "You are unsubscribed",
    `<h1>You are unsubscribed</h1><p>You will no longer receive marketing email from ${escapeHtml(orgName)}.</p>`,
  );
}

export function registerMarketingUnsubscribeRoutes(app: Express): void {
  app.get("/unsubscribe/:token", async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    try {
      const token = String(req.params.token);
      const target = isUnsubscribeToken(token) ? await findUnsubscribeTarget(token) : null;
      if (!target) return res.status(404).type("html").send(notFoundPage);
      if (target.alreadyUnsubscribed) return res.type("html").send(donePage(target.orgName));
      return res.type("html").send(
        page(
          "Unsubscribe",
          `<h1>Unsubscribe</h1>` +
            `<p>Stop receiving marketing email from ${escapeHtml(target.orgName)}?</p>` +
            `<form method="post" action="/api/public/unsubscribe/${encodeURIComponent(token)}">` +
            `<button type="submit">Unsubscribe</button></form>`,
        ),
      );
    } catch (err) {
      console.error("[marketing] unsubscribe page failed:", err);
      return res.status(500).type("html").send(page("Something went wrong", `<h1>Something went wrong</h1><p>Please try the link again in a minute.</p>`));
    }
  });

  app.get("/api/public/unsubscribe/:token", (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    return res.redirect(302, `/unsubscribe/${encodeURIComponent(String(req.params.token))}`);
  });

  app.post("/api/public/unsubscribe/:token", async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    // The mail provider's one-click POST (RFC 8058) carries this exact body;
    // it wants a status code, not a page.
    const oneClick = String(req.body?.["List-Unsubscribe"] ?? "") === "One-Click";
    try {
      const token = String(req.params.token);
      const target = isUnsubscribeToken(token) ? await unsubscribeByToken(token) : null;
      if (!target) {
        return oneClick
          ? res.status(404).json({ message: "Unknown unsubscribe token" })
          : res.status(404).type("html").send(notFoundPage);
      }
      return oneClick ? res.status(200).json({ ok: true }) : res.type("html").send(donePage(target.orgName));
    } catch (err) {
      console.error("[marketing] unsubscribe failed:", err);
      return oneClick
        ? res.status(500).json({ message: "Unsubscribe failed" })
        : res.status(500).type("html").send(page("Something went wrong", `<h1>Something went wrong</h1><p>Please try the link again in a minute.</p>`));
    }
  });
}
