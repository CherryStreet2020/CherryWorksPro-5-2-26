/**
 * The shared public-route map is the only source of titles/descriptions for
 * both the server head injection and the client <SEO>; these tests pin the
 * contract: length limits, route classification, noindex on everything that
 * is not a public page, no "$0" offer in the JSON-LD, one sitemap.
 */
import { describe, it, expect } from "vitest";
import { PUBLIC_ROUTES, PUBLIC_REDIRECTS, classifyPath, sitemapPaths, REPORT_COUNT } from "@shared/seo-routes";
import { getMetaTagsForPath, shellResponse } from "../../server/seo-meta";

describe("shared/seo-routes", () => {
  it("every public title is ≤ 60 chars and every description ≤ 155", () => {
    for (const [path, seo] of Object.entries(PUBLIC_ROUTES)) {
      expect(seo.title.length, `${path} title`).toBeLessThanOrEqual(60);
      expect(seo.description.length, `${path} description`).toBeLessThanOrEqual(155);
      expect(seo.description.length, `${path} description`).toBeGreaterThan(40);
    }
  });

  it("classifies public, redirect, app, token and unknown paths", () => {
    expect(classifyPath("/pricing").kind).toBe("public");
    expect(classifyPath("/pricing/").kind).toBe("public");
    expect(classifyPath("/pricing?utm=x#top").kind).toBe("public");
    expect(classifyPath("/marketing").kind).toBe("public");
    expect(classifyPath("/marketing/contacts").kind).toBe("app");
    expect(classifyPath("/tour")).toEqual({ kind: "redirect", to: "/demo" });
    expect(classifyPath("/dashboard").kind).toBe("app");
    expect(classifyPath("/admin/data/users").kind).toBe("app");
    expect(classifyPath("/i/abc123").kind).toBe("token");
    expect(classifyPath("/portal/acme/cases").kind).toBe("token");
    expect(classifyPath("/reset-password/0123abcd").kind).toBe("token"); // the link in the reset email
    expect(classifyPath("/reset-password").kind).toBe("public");
    expect(classifyPath("/i").kind).toBe("unknown");
    expect(classifyPath("/totally-bogus").kind).toBe("unknown");
    expect(classifyPath("/dashboardx").kind).toBe("unknown");
  });

  it("keeps noindex pages and redirects out of the sitemap", () => {
    const paths = sitemapPaths();
    expect(paths).toContain("/");
    expect(paths).toContain("/pricing");
    expect(paths).not.toContain("/login");
    expect(paths).not.toContain("/reset-password");
    for (const p of Object.keys(PUBLIC_REDIRECTS)) expect(paths).not.toContain(p);
  });

  it("REPORT_COUNT matches the app's report registry", async () => {
    const src = await import("node:fs").then((fs) => fs.readFileSync("client/src/pages/reports.tsx", "utf8"));
    const start = src.indexOf("REPORT_REGISTRY");
    const end = src.indexOf("REPORT_COUNT");
    expect(start, "reports.tsx must still declare REPORT_REGISTRY").toBeGreaterThan(-1);
    expect(end, "reports.tsx must still derive REPORT_COUNT after the registry").toBeGreaterThan(start);
    const registry = src.slice(start, end);
    const n = (registry.match(/^\s+[a-z]+: \[/gm) ?? []).reduce((sum, line) => {
      const lineStart = registry.indexOf(line);
      const arr = registry.slice(lineStart, registry.indexOf("]", lineStart));
      return sum + (arr.match(/"/g)!.length / 2);
    }, 0);
    expect(n).toBe(REPORT_COUNT);
  });
});

describe("server/seo-meta", () => {
  it("public pages get canonical + JSON-LD and no noindex", () => {
    const head = getMetaTagsForPath("/pricing");
    expect(head).toContain(`<title>${PUBLIC_ROUTES["/pricing"].title}</title>`);
    expect(head).toMatch(/<link rel="canonical" href="https:\/\/cherryworkspro\.com\/pricing"[^>]*\/>/);
    expect(head).toContain('"@type":"SoftwareApplication"');
    expect(head).not.toContain("noindex");
    expect(head).not.toMatch(/"price":"0"/);
    expect(head).not.toMatch(/"name":"Enterprise"/); // no unpriced offer in the JSON-LD
  });

  it("login is served with its title but noindex; the app shell and unknown paths are noindex with the bare site name", () => {
    expect(getMetaTagsForPath("/login")).toContain("noindex");
    expect(getMetaTagsForPath("/login")).toContain("Log In");
    expect(getMetaTagsForPath("/dashboard")).toContain('content="noindex,nofollow"');
    // Helmet must own the injected tags so client-side navigation can replace them
    expect(getMetaTagsForPath("/login")).toMatch(/name="robots"[^>]*data-rh="true"/);
    expect(getMetaTagsForPath("/pricing")).toMatch(/rel="canonical"[^>]*data-rh="true"/);
    expect(getMetaTagsForPath("/dashboard")).not.toContain("canonical");
    expect(getMetaTagsForPath("/i/tok")).toContain("noindex");
    expect(getMetaTagsForPath("/nope")).toContain("noindex");
  });

  it("shellResponse: 200 for public/app/token, 404 for unknown, 301 for retired paths", () => {
    expect(shellResponse("/")).toMatchObject({ status: 200 });
    expect(shellResponse("/dashboard")).toMatchObject({ status: 200 });
    expect(shellResponse("/e/tok")).toMatchObject({ status: 200 });
    expect(shellResponse("/reset-password/0123abcd")).toMatchObject({ status: 200 });
    expect(shellResponse("/totally-bogus")).toMatchObject({ status: 404 });
    expect(shellResponse("/blog")).toEqual({ redirect: "/" });
    expect(shellResponse("/tour/")).toEqual({ redirect: "/demo" });
  });
});
