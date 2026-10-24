/**
 * IndexNow: the key's protocol format, the key file route, and the post-deploy ping
 * script's contract (key and URL list read back from the served site, only the
 * canonical host's URLs sent, every failure a warning with exit 0). Every server here
 * is local — no test ever reaches api.indexnow.org or cherryworkspro.com.
 */
import { describe, it, expect, afterEach } from "vitest";
import express, { type Express } from "express";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import path from "node:path";
import type { Server } from "node:http";
import { INDEXNOW_KEY } from "@shared/indexnow";
import { BASE_URL, sitemapPaths } from "@shared/seo-routes";
import { registerSeoRoutes } from "../../server/seo-meta";

const run = promisify(execFile);
const REPO = path.resolve(__dirname, "../..");
const SCRIPT = path.join(REPO, "scripts/indexnow-ping.sh");

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
});

async function listen(app: Express): Promise<string> {
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  servers.push(server);
  const addr = server.address();
  return `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}

/** Runs the real script. execFile rejects on a non-zero exit, so a resolve IS the exit-0 assertion. */
function ping(env: Record<string, string>) {
  const base = { ...process.env };
  delete base.ORIGIN;
  delete base.DRY_RUN;
  return run("bash", [SCRIPT], { env: { ...base, INDEXNOW_ENDPOINT: "http://127.0.0.1:9/unused", ...env } });
}

function siteWith(sitemapLocs: string[], keyBody = INDEXNOW_KEY): Express {
  const app = express();
  app.get(`/${INDEXNOW_KEY}.txt`, (_req, res) => { res.type("text/plain").send(keyBody); });
  app.get("/sitemap.xml", (_req, res) => {
    res.type("application/xml").send(`<urlset>${sitemapLocs.map((l) => `<url><loc>${l}</loc></url>`).join("")}</urlset>`);
  });
  return app;
}

describe("IndexNow key", () => {
  it("is a valid protocol key, on the one line the ping script reads", () => {
    expect(INDEXNOW_KEY).toMatch(/^[A-Za-z0-9-]{8,128}$/);
    const src = readFileSync(path.join(REPO, "shared/indexnow.ts"), "utf-8");
    // Same pattern as the sed in scripts/indexnow-ping.sh.
    const m = src.match(/^export const INDEXNOW_KEY = "([A-Za-z0-9-]{8,128})";$/m);
    expect(m?.[1]).toBe(INDEXNOW_KEY);
  });

  it("is served at /<key>.txt as exactly the key, and no other .txt answers", async () => {
    const app = express();
    registerSeoRoutes(app);
    const base = await listen(app);
    const r = await fetch(`${base}/${INDEXNOW_KEY}.txt`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(await r.text()).toBe(INDEXNOW_KEY);
    expect((await fetch(`${base}/0123456789abcdef0123456789abcdef.txt`)).status).toBe(404);
  });
});

describe("scripts/indexnow-ping.sh", () => {
  it("submits every sitemap URL the real routes serve, for the canonical host", async () => {
    const app = express();
    registerSeoRoutes(app);
    const base = await listen(app);
    const { stdout } = await ping({ DRY_RUN: "1", FETCH_FROM: base });
    expect(JSON.parse(stdout)).toEqual({
      host: new URL(BASE_URL).host,
      key: INDEXNOW_KEY,
      keyLocation: `${BASE_URL}/${INDEXNOW_KEY}.txt`,
      urlList: sitemapPaths().map((p) => `${BASE_URL}${p}`),
    });
  });

  it("drops every URL that is not on the canonical host, and unescapes &amp;", async () => {
    const base = await listen(siteWith([
      `${BASE_URL}/`,
      "https://evil.example/pricing",
      `${BASE_URL}.evil.example/pricing`,
      "http://cherryworkspro.com/pricing",
      `${BASE_URL}/pricing?a=1&amp;b=2`,
    ]));
    const { stdout } = await ping({ DRY_RUN: "1", FETCH_FROM: base });
    expect(JSON.parse(stdout).urlList).toEqual([`${BASE_URL}/`, `${BASE_URL}/pricing?a=1&b=2`]);
  });

  it("skips with a warning, exit 0, when the served key file is wrong", async () => {
    const base = await listen(siteWith([`${BASE_URL}/`], "not-the-key"));
    const { stdout } = await ping({ DRY_RUN: "1", FETCH_FROM: base });
    expect(stdout).toContain("::warning::IndexNow ping skipped");
    expect(stdout).toContain("does not serve the key");
    expect(stdout).not.toContain("urlList");
  });

  it("posts the body, reports success, and warns (exit 0) on a refusal", async () => {
    const received: unknown[] = [];
    let status = 202;
    const endpoint = express();
    endpoint.post("/indexnow", express.json(), (req, res) => { received.push(req.body); res.status(status).end(); });
    const api = await listen(endpoint);
    const site = await listen(siteWith([`${BASE_URL}/`, `${BASE_URL}/pricing`]));

    const ok = await ping({ FETCH_FROM: site, INDEXNOW_ENDPOINT: `${api}/indexnow` });
    expect(ok.stdout).toContain("IndexNow accepted 2 URL(s) for cherryworkspro.com (HTTP 202)");
    expect(received).toEqual([{
      host: "cherryworkspro.com",
      key: INDEXNOW_KEY,
      keyLocation: `${BASE_URL}/${INDEXNOW_KEY}.txt`,
      urlList: [`${BASE_URL}/`, `${BASE_URL}/pricing`],
    }]);

    status = 403;
    const refused = await ping({ FETCH_FROM: site, INDEXNOW_ENDPOINT: `${api}/indexnow` });
    expect(refused.stdout).toContain("::warning::IndexNow ping skipped — IndexNow said 403");
  });
});
