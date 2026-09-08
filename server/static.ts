import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { sendShell } from "./seo-meta";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  const indexPath = path.resolve(distPath, "index.html");
  const rawHtml = fs.readFileSync(indexPath, "utf-8");

  app.get("/", (req, res) => sendShell(req, res, rawHtml));

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

  // Real status codes: 301 for retired paths, 404 for paths nothing owns, 200 shell
  // (with noindex for the signed-in app) otherwise — see shellResponse().
  app.use("/{*path}", (req, res) => sendShell(req, res, rawHtml));
}
