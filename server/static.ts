import express, { type Express, type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import { classifyPath } from "@shared/seo-routes";
import { sendShell } from "./seo-meta";

/** express-session's default cookie name — server/routes.ts configures no `name`. */
const SESSION_COOKIE = "connect.sid";

/**
 * Build-time pre-rendered documents (script/prerender.ts → dist/prerendered/*.html),
 * keyed by path. They live OUTSIDE dist/public on purpose: express.static must never
 * serve them at /prerendered/… as indexable duplicates.
 */
export function loadPrerendered(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!fs.existsSync(dir)) return out;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".html")) continue;
    const slug = file.slice(0, -".html".length);
    const routePath = slug === "index" ? "/" : "/" + slug.replace(/_/g, "/");
    out.set(routePath, fs.readFileSync(path.join(dir, file), "utf-8"));
  }
  return out;
}

function hasSessionCookie(req: Request): boolean {
  const raw = req.headers.cookie;
  return typeof raw === "string" && raw.split(";").some((c) => c.trim().startsWith(`${SESSION_COOKIE}=`));
}

/**
 * Serve the client build. Public routes get the pre-rendered document (real HTML for
 * crawlers and a hydrated first paint for visitors) — but only for requests without a
 * session cookie: a signed-in browser at "/" must get the shell, whose first paint is
 * the auth skeleton → dashboard, so the pre-rendered marketing home never has to be
 * hydrated against a signed-in tree. Everything else follows sendShell's rules
 * (301 for retired paths, 404 for unknown, noindex shell for the app).
 */
export function serveStatic(app: Express, distDir = __dirname) {
  // distDir: the built dist/ (the server bundle's own directory in production; a
  // caller such as script/serve-prerendered.ts passes it explicitly).
  const distPath = path.resolve(distDir, "public");
  const prerenderedDir = path.resolve(distDir, "prerendered");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  const indexPath = path.resolve(distPath, "index.html");
  const rawHtml = fs.readFileSync(indexPath, "utf-8");
  const prerendered = loadPrerendered(prerenderedDir);
  console.log(`[static] ${prerendered.size} pre-rendered public page(s) loaded from ${prerenderedDir}`);

  const sendPage = (req: Request, res: Response) => {
    const route = classifyPath(req.originalUrl);
    if (route.kind === "public" && !hasSessionCookie(req)) {
      const html = prerendered.get(route.path);
      if (html) {
        res.status(200).set({ "Content-Type": "text/html", "Cache-Control": "no-cache" }).end(html);
        return;
      }
    }
    sendShell(req, res, rawHtml);
  };

  app.get("/", sendPage);

  app.get("/google1d3afafffa92f7ac.html", (_req, res) => {
    res.status(200).set({ "Content-Type": "text/html" }).end("google-site-verification: google1d3afafffa92f7ac.html");
  });

  app.use(express.static(distPath, {
    maxAge: "1y",
    immutable: true,
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  }));

  app.use("/{*path}", sendPage);
}
