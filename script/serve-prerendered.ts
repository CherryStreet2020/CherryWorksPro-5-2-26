/**
 * Static preview of the production client build: the real serveStatic() +
 * registerSeoRoutes() + compression over dist/, no database and no API (API paths
 * answer 404 JSON like production's unknown-route handler). Used by
 * e2e/prerender.spec.ts to check hydration and no-JS visibility of the pre-rendered
 * public pages exactly as the container would serve them.
 *   PORT=5010 npx tsx script/serve-prerendered.ts
 */
import path from "node:path";
import express from "express";
import compression from "compression";
import { serveStatic } from "../server/static";
import { registerSeoRoutes } from "../server/seo-meta";

const app = express();
app.use(compression({ threshold: 1024 }));
// Production answers for an anonymous visitor: health 200, auth/billing 401, the rest 404.
app.get("/api/health", (_req, res) => { res.json({ status: "ok", startup: "complete" }); });
app.get(["/api/auth/me", "/api/billing/status", "/api/me/entitlements"], (_req, res) => { res.status(401).json({ message: "Not authenticated" }); });
app.all("/api/{*path}", (req, res) => { res.status(404).json({ error: "API route not found", path: req.path }); });
registerSeoRoutes(app);
serveStatic(app, path.resolve(import.meta.dirname, "..", "dist"));
const port = Number(process.env.PORT || 5010);
app.listen(port, () => console.log(`[serve-prerendered] http://localhost:${port} (dist/)`));
