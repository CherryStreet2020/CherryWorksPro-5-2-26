/**
 * The site's crawler-facing behaviour, end to end against the live test
 * server: real status codes for unknown and retired paths, one sitemap and
 * one robots.txt derived from the shared route map, noindex on the app shell,
 * and compressed responses when the client accepts them.
 */
import { describe, it, expect } from "vitest";
import { TEST_BASE as BASE } from "../helpers/base";

const get = (path: string, headers: Record<string, string> = {}) =>
  fetch(`${BASE}${path}`, { redirect: "manual", headers });

describe("public site HTTP contract", () => {
  it("serves an unknown path as a real 404 that still carries the app shell", async () => {
    const r = await get(`/totally-bogus-${Date.now()}`);
    expect(r.status).toBe(404);
    const html = await r.text();
    expect(html).toContain('id="root"');
    expect(html).toContain('content="noindex,nofollow"');
  });

  it("301s retired public paths", async () => {
    const mos = await get("/marketing-os");
    expect(mos.status).toBe(301);
    expect(mos.headers.get("location")).toBe("/marketing");
    const utm = await get("/marketing-os?utm_source=newsletter");
    expect(utm.status).toBe(301);
    expect(utm.headers.get("location")).toBe("/marketing?utm_source=newsletter");
    const blog = await get("/blog");
    expect(blog.status).toBe(301);
    expect(blog.headers.get("location")).toBe("/");
  });

  it("serves the signed-in app shell with 200 + noindex, and a public page with its canonical", async () => {
    const reset = await get("/reset-password/0123abcd");
    expect(reset.status).toBe(200);
    const app = await get("/dashboard");
    expect(app.status).toBe(200);
    expect(await app.text()).toContain('content="noindex,nofollow"');
    const pricing = await get("/pricing");
    expect(pricing.status).toBe(200);
    const html = await pricing.text();
    expect(html).toContain('rel="canonical" href="https://cherryworkspro.com/pricing"');
    expect(html).not.toContain("noindex");
  });

  it("has exactly one sitemap, listing public pages only", async () => {
    const r = await get("/sitemap.xml");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/xml");
    const xml = await r.text();
    expect(xml).toContain("<loc>https://cherryworkspro.com/pricing</loc>");
    expect(xml).toContain("<loc>https://cherryworkspro.com/marketing</loc>");
    expect(xml).not.toContain("/login");
    expect(xml).toContain("/tour");
    expect(xml).toContain("/client-support");
    // the old duplicate implementations are gone
    expect((await get("/api/marketing/sitemap.xml")).status).toBe(404);
  });

  it("robots.txt keeps private surfaces out and points at the sitemap", async () => {
    const r = await get("/robots.txt");
    expect(r.status).toBe(200);
    const txt = await r.text();
    for (const line of ["Disallow: /api/", "Disallow: /portal/", "Disallow: /help/", "Disallow: /i/", "Disallow: /e/", "Disallow: /verify-email", "Sitemap: https://cherryworkspro.com/sitemap.xml"]) {
      expect(txt).toContain(line);
    }
    expect(txt).toMatch(/^Disallow: \/admin$/m); // the bare route, not only /admin/
  });

  it("compresses responses for clients that accept it", async () => {
    const r = await get("/pricing", { "Accept-Encoding": "br, gzip" });
    expect(r.status).toBe(200);
    expect(["br", "gzip"]).toContain(r.headers.get("content-encoding"));
  });
});
