/**
 * Build-time pre-rendering: the slug mapping, document composition, and the static
 * server's contract for pre-rendered public pages (served only to cookie-less
 * requests, never reachable as files, 301/404/noindex rules from #64 unchanged).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { slugFor, composeDocument } from "../../script/prerender";
import { loadPrerendered, serveStatic } from "../../server/static";
import { sitemapPaths } from "@shared/seo-routes";

const TEMPLATE = '<!DOCTYPE html><html><head><meta charset="UTF-8" /></head><body><div id="root"></div></body></html>';

describe("prerender slugs and documents", () => {
  it("maps routes to file slugs and back", () => {
    expect(slugFor("/")).toBe("index");
    expect(slugFor("/pricing")).toBe("pricing");
    expect(slugFor("/switch-from-paymo")).toBe("switch-from-paymo");
    const dir = mkdtempSync(path.join(tmpdir(), "prerendered-"));
    const manifest: Record<string, string> = {};
    for (const p of sitemapPaths()) { writeFileSync(path.join(dir, `${slugFor(p)}.html`), `<html>${p}</html>`); manifest[p] = `${slugFor(p)}.html`; }
    writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
    const loaded = loadPrerendered(dir);
    expect([...loaded.keys()].sort()).toEqual([...sitemapPaths()].sort());
    expect(loaded.get("/")).toContain("/");
    rmSync(dir, { recursive: true, force: true });
  });

  it("composes the document with the shared head tags and the body in #root", () => {
    const doc = composeDocument(TEMPLATE, "<main><h1>Pricing</h1></main>", "/pricing");
    expect(doc).toContain('<div id="root"><main><h1>Pricing</h1></main></div>');
    expect(doc).toContain('rel="canonical" href="https://cherryworkspro.com/pricing"');
    expect(doc).not.toContain("noindex");
    expect(() => composeDocument("<html><body><div id=\"root\">x</div></body></html>", "<p/>", "/")).toThrow(/empty #root/);
  });
});

describe("serveStatic with pre-rendered pages", () => {
  let dist: string;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    dist = mkdtempSync(path.join(tmpdir(), "dist-"));
    mkdirSync(path.join(dist, "public"));
    mkdirSync(path.join(dist, "prerendered"));
    writeFileSync(path.join(dist, "public", "index.html"), TEMPLATE);
    writeFileSync(path.join(dist, "prerendered", "pricing.html"), composeDocument(TEMPLATE, "<h1>PRERENDERED PRICING</h1>", "/pricing"));
    writeFileSync(path.join(dist, "prerendered", "manifest.json"), JSON.stringify({ "/pricing": "pricing.html" }));
    const app = express();
    serveStatic(app, dist);
    await new Promise<void>((resolve) => { server = app.listen(0, resolve); });
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dist, { recursive: true, force: true });
  });

  const get = (p: string, headers: Record<string, string> = {}) => fetch(base + p, { redirect: "manual", headers });

  it("serves the pre-rendered document to a cookie-less request", async () => {
    const r = await get("/pricing");
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("PRERENDERED PRICING");
    expect(html).toContain('rel="canonical" href="https://cherryworkspro.com/pricing"');
  });

  it("serves the shell instead when a session cookie is present", async () => {
    const r = await get("/pricing", { cookie: "connect.sid=s%3Aabc.def" });
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).not.toContain("PRERENDERED");
    expect(html).toContain('<div id="root"></div>');
  });

  it("falls back to the shell for a public route without a pre-rendered file", async () => {
    const r = await get("/about");
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('<div id="root"></div>');
  });

  it("keeps the #64 rules: app shell noindex, unknown 404, retired 301 with query", async () => {
    expect(await (await get("/dashboard")).text()).toContain("noindex");
    expect((await get("/no-such-page")).status).toBe(404);
    const t = await get("/marketing-os?utm=1");
    expect(t.status).toBe(301);
    expect(t.headers.get("location")).toBe("/marketing?utm=1");
  });

  it("never exposes the pre-rendered files as static assets", async () => {
    for (const p of ["/prerendered/pricing.html", "/prerender/pricing.html", "/pricing.html"]) {
      expect((await get(p)).status, p).toBe(404);
    }
  });
});
