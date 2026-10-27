import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/storage", () => ({ storage: {} }));

import {
  MAX_TRACKED_LINKS,
  isTrackingToken,
  newTrackingToken,
  trackableUrl,
  withTracking,
} from "../../server/marketing/tracking";
import { withUnsubscribeFooter } from "../../server/marketing/unsubscribe";
import { JSDOM } from "jsdom";

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";
const BASE = "https://app.example.test";
const click = (i: number) => `${BASE}/api/public/email/c/${TOKEN}/${i}`;

describe("marketing tracking helpers", () => {
  const prevBase = process.env.APP_BASE_URL;
  beforeEach(() => {
    process.env.APP_BASE_URL = `${BASE}/`;
  });
  afterEach(() => {
    if (prevBase === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = prevBase;
  });

  it("mints 32-char url-safe tokens and validates the format", () => {
    const a = newTrackingToken();
    const b = newTrackingToken();
    expect(isTrackingToken(a)).toBe(true);
    expect(a).not.toBe(b);
    expect(isTrackingToken(TOKEN)).toBe(true);
    expect(isTrackingToken(`${TOKEN}x`)).toBe(false);
    expect(isTrackingToken("../../etc/passwd/aaaaaaaaaaaaaaaaa")).toBe(false);
    expect(isTrackingToken(undefined)).toBe(false);
  });

  it("decodes entities in hrefs the way HTML does", () => {
    const dest = (href: string) => withTracking(`<a href="${href}">x</a>`, TOKEN).links;
    expect(dest("https://x.test/?a=1&amp;b=2")).toEqual(["https://x.test/?a=1&b=2"]);
    expect(dest("&#104;ttps://x.test/")).toEqual(["https://x.test/"]);
    expect(dest("https://x.test/?a=1&semi;b=2")).toEqual(["https://x.test/?a=1;b=2"]);
    expect(dest("https://x.test/?a=1&amp=2")).toEqual(["https://x.test/?a=1&amp=2"]);
    // Object keys are not entities: kept literal, as a browser does.
    expect(dest("https://x.test/?v=&constructor;")).toEqual(["https://x.test/?v=&constructor;"]);
  });

  it("parses attributes one at a time: an href inside another attribute is not the link", () => {
    const html =
      `<a title='see href="https://evil.test/"' href="https://real.test/">x</a>` +
      `<a data-x="a>b" href="https://gt.test/">y</a>` +
      `<a title="href=https://only-title.test/">z</a>` +
      `<abbr href="https://not-an-anchor.test/">w</abbr>`;
    const { html: out, links } = withTracking(html, TOKEN);
    expect(links).toEqual(["https://real.test/", "https://gt.test/"]);
    expect(out).toContain(`title='see href="https://evil.test/"'`);
    expect(out).toContain(`title="href=https://only-title.test/"`);
    expect(out).toContain(`data-x="a>b" href="${BASE}/api/public/email/c/${TOKEN}/1"`);
    expect(out).not.toContain("https://real.test/");
  });

  it("tracks only absolute http(s) links that are not our own opt-out / public paths", () => {
    expect(trackableUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(trackableUrl("HTTP://Example.com")).toBe("http://example.com/");
    // Trimmed like the URL parser (U+0000–U+0020 only): a trailing &nbsp; stays in the path.
    expect(trackableUrl(" https://x.test/a\n")).toBe("https://x.test/a");
    expect(trackableUrl("https://x.test/path\u00a0")).toBe("https://x.test/path%C2%A0");
    expect(trackableUrl("\u00a0https://x.test/")).toBeNull();
    for (const skip of [
      "mailto:a@b.test", "tel:+15555550100", "#top", "/relative", "javascript:alert(1)",
      "data:text/html,hi", "//example.com", "https://user:pw@example.com/",
      `${BASE}/unsubscribe/3f2b8c1e-9a4d-4c7e-8b21-0d5e6f7a8b9c`,
      `${BASE}/api/public/unsubscribe/x`, `${BASE}/api/public/email/c/${TOKEN}/0`,
      "https://exa mple.com",
    ]) {
      expect(trackableUrl(skip), skip).toBeNull();
    }
  });

  it("rewrites double, single and bare quoted hrefs in order and records destinations", () => {
    const html =
      `<p><a href="https://a.test/x?y=1&amp;z=2">A</a> ` +
      `<a class="btn" href='https://b.test/'>B</a> ` +
      `<a href=https://c.test/c>C</a> ` +
      `<a href="mailto:hi@d.test">mail</a> <a name="anchor">n</a></p>`;
    const { html: out, links } = withTracking(html, TOKEN);
    expect(links).toEqual(["https://a.test/x?y=1&z=2", "https://b.test/", "https://c.test/c"]);
    expect(out).toContain(`<a href="${click(0)}">A</a>`);
    expect(out).toContain(`<a class="btn" href="${click(1)}">B</a>`);
    expect(out).toContain(`<a href="${click(2)}">C</a>`);
    expect(out).toContain(`<a href="mailto:hi@d.test">mail</a>`);
    expect(out).toContain(`<a name="anchor">n</a>`);
  });

  it("does not touch data-href or other attributes ending in href", () => {
    const html = `<a data-href="https://x.test" href="https://y.test">y</a>`;
    const { html: out, links } = withTracking(html, TOKEN);
    expect(links).toEqual(["https://y.test/"]);
    expect(out.startsWith(`<a data-href="https://x.test" href="${click(0)}">y</a><img `)).toBe(true);
  });

  it("stops tracking after the cap and leaves the rest untouched", () => {
    const html = Array.from({ length: MAX_TRACKED_LINKS + 2 }, (_, i) => `<a href="https://x.test/${i}">${i}</a>`).join("");
    const { html: out, links } = withTracking(html, TOKEN);
    expect(links).toHaveLength(MAX_TRACKED_LINKS);
    expect(out).toContain(`<a href="https://x.test/${MAX_TRACKED_LINKS}">`);
    expect(out).toContain(`<a href="https://x.test/${MAX_TRACKED_LINKS + 1}">`);
  });

  it("adds the pixel before </body>, and the unsubscribe footer added afterwards stays untouched", () => {
    const doc = `<html><body><a href="https://a.test">a</a></body></html>`;
    const { html, links } = withTracking(doc, TOKEN);
    expect(links).toEqual(["https://a.test/"]);
    expect(html).toMatch(new RegExp(`<img src="${BASE}/api/public/email/o/${TOKEN}\\.gif"[^>]*></body>`));
    const unsubToken = "3f2b8c1e-9a4d-4c7e-8b21-0d5e6f7a8b9c";
    const final = withUnsubscribeFooter(html, { token: unsubToken, org: { name: "Acme" } });
    expect(final).toContain(`href="${BASE}/unsubscribe/${unsubToken}"`);
    expect(final.match(/\/api\/public\/email\/c\//g)).toHaveLength(1);
  });

  it("appends the pixel to a fragment body with no links", () => {
    const { html, links } = withTracking("<p>Hello</p>", TOKEN);
    expect(links).toEqual([]);
    expect(html.startsWith("<p>Hello</p><img ")).toBe(true);
  });
});

describe("marketing tracking routes — pure parts", () => {
  it("serves a 43-byte GIF89a", async () => {
    const { PIXEL_GIF } = await import("../../server/routes/marketing/tracking");
    expect(PIXEL_GIF.length).toBe(43);
    expect(PIXEL_GIF.subarray(0, 6).toString("ascii")).toBe("GIF89a");
    expect(PIXEL_GIF[42]).toBe(0x3b); // GIF trailer
  });

  it("windowLimiter caps per key, caps distinct keys, and resets each window", async () => {
    vi.useFakeTimers();
    try {
      const { windowLimiter } = await import("../../server/routes/marketing/tracking");
      const allow = windowLimiter(2, 1_000, 3);
      expect([allow("a"), allow("a"), allow("a")]).toEqual([true, true, false]);
      expect(allow("b")).toBe(true);
      expect(allow("c")).toBe(true);
      expect(allow("d")).toBe(false); // key table full for this window
      expect(allow("b")).toBe(true); // known keys still counted
      vi.advanceTimersByTime(1_000);
      expect(allow("a")).toBe(true);
      expect(allow("d")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("derives the client IP from req.ip, ignoring a forged X-Forwarded-For prefix", async () => {
    const express = (await import("express")).default;
    const { clientIp } = await import("../../server/routes/marketing/tracking");
    const app = express();
    app.set("trust proxy", 1); // as in server/index.ts
    app.get("/ip", (req, res) => res.send(clientIp(req)));
    const server = app.listen(0);
    try {
      const port = (server.address() as { port: number }).port;
      const res = await fetch(`http://127.0.0.1:${port}/ip`, {
        headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.9" },
      });
      // The proxy appends the real client last; the forged first hop is ignored.
      expect(await res.text()).toBe("203.0.113.9");
    } finally {
      server.close();
    }
  });

  it("redacts capability tokens from logged paths", async () => {
    const { redactPath } = await import("../../server/lib/logging");
    expect(redactPath(`/api/public/email/o/${TOKEN}.gif`)).toBe("/api/public/email/o/:token");
    expect(redactPath(`/api/public/email/c/${TOKEN}/3`)).toBe("/api/public/email/c/:token/3");
    expect(redactPath("/api/public/unsubscribe/abc-123")).toBe("/api/public/unsubscribe/:token");
    expect(redactPath("/api/marketing/campaigns")).toBe("/api/marketing/campaigns");
    // Express routes case-insensitively, so redaction must too.
    expect(redactPath(`/api/public/Email/c/${TOKEN}/0`)).not.toContain(TOKEN);
    expect(redactPath(`/API/PUBLIC/EMAIL/O/${TOKEN}.gif`)).not.toContain(TOKEN);
    expect(redactPath("/api/public/Unsubscribe/abc-123")).not.toContain("abc-123");
    // Any other path under a capability prefix is cut at the prefix: a token
    // can sit in any of its segments.
    expect(redactPath(`/api/public/email/c/${TOKEN}/0/extra`)).toBe("/api/public/email/:redacted");
    expect(redactPath(`/api/public/Email/x/${TOKEN}%`)).toBe("/api/public/Email/:redacted");
    expect(redactPath(`/api/public/email/${TOKEN}`)).toBe("/api/public/email/:redacted");
    expect(redactPath(`/api/public/email/c/${TOKEN}`)).toBe("/api/public/email/:redacted");
    expect(redactPath("/api/public/unsubscribe/abc-123/again")).toBe("/api/public/unsubscribe/:redacted");
    expect(redactPath("/api/public/emails/x")).toBe("/api/public/emails/x");
  });

  it("answers a malformed tracking URL without the token in the response or logs", async () => {
    const express = (await import("express")).default;
    const { registerMarketingTrackingRoutes } = await import("../../server/routes/marketing/tracking");
    const { redactPath, structuredLog } = await import("../../server/lib/logging");
    const app = express();
    // Stand-in for server/index.ts's request logger: the same helpers, req.path
    // read on the way in (a mounted handler strips its prefix from it later),
    // logged when the response finishes.
    app.use((req, res, next) => {
      const path = req.path;
      res.on("finish", () => structuredLog({ method: req.method, path: redactPath(path), status: res.statusCode }));
      next();
    });
    registerMarketingTrackingRoutes(app);
    // Stand-ins for the rest of server/index.ts: the `/api/{*path}` fallback
    // (its param decoding throws on a bad `%`) and the global handler, which
    // echoes err.message.
    app.all("/api/{*path}", (_req, res) => { res.status(404).json({ error: "API route not found" }); });
    app.use((err: Error, _req: unknown, res: import("express").Response, _next: unknown) => {
      console.error("Internal Server Error:", err);
      res.status(500).json({ message: err.message });
    });
    const logged: string[] = [];
    const spies = (["log", "warn", "error", "info"] as const).map((k) =>
      vi.spyOn(console, k).mockImplementation((...args: unknown[]) => {
        logged.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : String(a))).join(" "));
      }));
    const server = app.listen(0);
    try {
      const port = (server.address() as { port: number }).port;
      for (const path of [
        `/api/public/email/c/${TOKEN}%/0`, `/api/public/email/c/${TOKEN}/%zz`, `/api/public/email/o/${TOKEN}%.gif`,
        `/api/public/email/c/${TOKEN}%/0/extra`, `/api/public/email/o/${TOKEN}%`, `/api/public/Email/x/${TOKEN}%`,
      ]) {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, { redirect: "manual" });
        const body = await res.text();
        expect(res.status, path).toBe(404);
        expect(body, path).not.toContain(TOKEN);
        expect(res.headers.get("location")).toBeNull();
      }
      await new Promise((r) => setTimeout(r, 20));
      expect(logged.filter((l) => l.includes('"path"')).length).toBe(6);
      expect(logged.join("\n")).not.toContain(TOKEN);
    } finally {
      server.close();
      for (const s of spies) s.mockRestore();
    }
  });

  it("asks a click to retry, without redirecting, when the lookup cannot run in time", async () => {
    const record = await import("../../server/marketing/tracking-record");
    const lookup = vi.spyOn(record, "findTrackedLinks")
      .mockRejectedValue(new record.TrackingUnavailableError("lookup: too many in flight"));
    const click = vi.spyOn(record, "recordClick").mockResolvedValue(true);
    const express = (await import("express")).default;
    const { registerMarketingTrackingRoutes } = await import("../../server/routes/marketing/tracking");
    const app = express();
    registerMarketingTrackingRoutes(app);
    const server = app.listen(0);
    try {
      const port = (server.address() as { port: number }).port;
      const res = await fetch(`http://127.0.0.1:${port}/api/public/email/c/${TOKEN}/0`, { redirect: "manual" });
      expect(res.status).toBe(503);
      expect(res.headers.get("retry-after")).toBe("30");
      expect(res.headers.get("location")).toBeNull();
      expect(click).not.toHaveBeenCalled();
    } finally {
      server.close();
      lookup.mockRestore();
      click.mockRestore();
    }
  });
});

// Differential: the destination we store must be the one an HTML parser + URL
// parser give the original anchor, and the rewritten anchor must resolve to the
// tracking URL. Anything we cannot read exactly must be left as written.
describe("link rewriting matches an HTML parser", () => {
  const prevBase = process.env.APP_BASE_URL;
  beforeEach(() => {
    process.env.APP_BASE_URL = `${BASE}/`;
  });
  afterEach(() => {
    if (prevBase === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = prevBase;
  });

  const browserHrefs = (html: string): string[] =>
    [...new JSDOM(`<!doctype html><body>${html}`, { url: "https://base.test/page" })
      .window.document.querySelectorAll("a[href]")]
      .map((a) => (a as HTMLAnchorElement).href);

  const tracked = [
    `<a href="https://x.test/a?b=1&amp;c=2">x</a>`,
    `<a href='https://x.test/q'>x</a>`,
    `<a href=https://x.test/u>x</a>`,
    `<a href=https://x.test/u/>x</a>`,
    `<A HREF="https://x.test/up">x</A>`,
    `<a title='see href="https://evil.test/"' href="https://x.test/t">x</a>`,
    `<a data-x="a>b" href="https://x.test/gt">x</a>`,
    `<a\nhref="https://x.test/nl">x</a>`,
    `<a\r\nhref="https://x.test/crlf">x</a>`,
    `<a/href="https://x.test/slash">x</a>`,
    `<a href = "https://x.test/sp">x</a>`,
    `<a href="https://x.test/path&nbsp;">x</a>`,
    `<a href="https://x.test/caf\u00e9">x</a>`,
    `<a href="  https://x.test/trim  ">x</a>`,
    `<a href="https://x.test/a\tb">x</a>`,
    `<a href="https://x.test/one two">x</a>`,
    `<a href="https://x.test/?q='foo'">x</a>`,
    `<a href=https://x.test/?q='foo'>x</a>`,
    `<a href="https://x.test/one\u00a0two">x</a>`,
    `<a href=https://x.test/one\u00a0two>x</a>`,
    `<a href="https://x.test/first" href="https://x.test/second">x</a>`,
    `<a href="https://x.test/a\u0000b">x</a>`,
    `<a title="t"href="https://x.test/glued">x</a>`,
    `<a href="https://x.test/?v=&constructor;">x</a>`,
    `<a href="https://x.test/?v=&semi;">x</a>`,
    `<a href="https://x.test/?v=&not/">x</a>`,
    `<a href="https://x.test/?v=&#128;">x</a>`,
    `<p>\u{1F600}</p><a href="https://x.test/astral">x</a>`,
  ];
  const untracked = [
    `<a\u00a0href="https://x.test/nbsp">x</a>`,
    `<a href\u00a0="https://x.test/name">x</a>`,
    `<a href="javascript:alert(1)">x</a>`,
    `<abbr href="https://x.test/abbr">x</abbr>`,
  ];

  const pixelRe = /<img src="[^"]*\/api\/public\/email\/o\/[^"]*"[^>]*>/;

  it.each(tracked)("tracks %j to the browser's destination", (html) => {
    const r = withTracking(html, TOKEN);
    expect(r.links).toEqual([browserHrefs(html)[0]]);
    expect(browserHrefs(r.html)[0]).toBe(click(0));
  });

  it.each(untracked)("leaves %j as written", (html) => {
    const r = withTracking(html, TOKEN);
    expect(r.links).toEqual([]);
    expect(r.html.replace(pixelRe, "")).toBe(html);
  });

  // Whole documents: after putting each stored destination back, the
  // rewritten body must parse to the same DOM as the original (bar the
  // pixel) — nothing outside a real <a href> may change.
  const serialized = (html: string, links?: string[]): string => {
    const dom = new JSDOM(html, { url: "https://base.test/page" });
    const doc = dom.window.document;
    for (const a of doc.querySelectorAll("a[href]")) {
      const el = a as HTMLAnchorElement;
      if (links) {
        const m = /\/api\/public\/email\/c\/[^/]+\/(\d+)$/.exec(el.href);
        if (m) el.setAttribute("href", links[Number(m[1])]);
      } else if (/^https?:/.test(el.href) && el.namespaceURI === "http://www.w3.org/1999/xhtml") {
        el.setAttribute("href", el.href);
      }
    }
    for (const img of doc.querySelectorAll("img[src*='/api/public/email/o/']")) img.remove();
    return dom.serialize();
  };

  const documents: [string, number][] = [
    [`<div title="<a href='https://e.test/'>">Hello</div><a href="https://r.test/">r</a>`, 1],
    [`<textarea><a href="https://t.test/">t</a></textarea><a href=https://r.test/>r</a>`, 1],
    [`<!-- <a href="https://c.test/">c</a> --><p>x</p><a href='https://r.test/'>r</a>`, 1],
    [`<script>var s = '<a href="https://s.test/">';</script><a href="https://r.test/">r</a>`, 1],
    [`<style>a[href="https://st.test/"] { color: red }</style><p>x</p>`, 0],
    [`<template><a href="https://tp.test/">t</a></template><a href="https://r.test/">r</a>`, 1],
    [`<svg><a href="https://svg.test/"><text>s</text></a></svg><a href="https://r.test/">r</a>`, 1],
    [`<!doctype html><html><head><title><a href="https://ti.test/"></title></head>` +
      `<body><table><tr><td><a href="https://r.test/a">a</a></td></tr></table>` +
      `<a href="https://r.test/b?x=1&amp;y=2">b</a></body></html>`, 2],
    [`<p>a</p></body><a href="https://r.test/after">after</a>`, 1],
    [`<a href="https://r.test/1"><a href="https://r.test/2">nested</a></a>`, 2],
    // Formatting reconstruction: the parser builds two <a> elements from one tag.
    [`<b><a href="https://r.test/one">one</b>two</a>`, 1],
    [`<a href="https://r.test/p"><p>para</p></a><i><a href=https://r.test/q>x</i>y</a>`, 2],
  ];

  it.each(documents)("rewrites only real anchors in %j", (html, count) => {
    const r = withTracking(html, TOKEN);
    expect(r.links).toHaveLength(count);
    expect(serialized(r.html, r.links)).toBe(serialized(html));
    expect(pixelRe.test(r.html)).toBe(true);
  });

  it("leaves the pixel out when the body ends inside an unclosed comment or raw text", () => {
    for (const html of [`<p>x</p><!-- unclosed`, `<textarea>open`, `<script>var x = 1;`]) {
      const r = withTracking(html, TOKEN);
      expect(r.html, html).toBe(html);
    }
  });

  it("puts the pixel inside the body of a full document", () => {
    const html = `<!doctype html><html><body><p>x</p></body></html>`;
    const doc = new JSDOM(withTracking(html, TOKEN).html).window.document;
    expect(doc.body.lastElementChild?.tagName).toBe("IMG");
  });

  it("parses in linear time on hostile bodies", () => {
    for (const html of ["<a ".repeat(16_000), "<b><i><a>".repeat(5_500), `<a href="${"&amp;".repeat(9_000)}">`]) {
      const t = performance.now();
      withTracking(html, TOKEN);
      expect(performance.now() - t, html.slice(0, 12)).toBeLessThan(1_000);
    }
  });

  it("throws, once per body, on a body the parser cannot handle", () => {
    const deep = "<template>".repeat(4999);
    expect(() => withTracking(deep, TOKEN)).toThrow();
    // Remembered: the next recipient fails fast instead of re-parsing.
    const started = Date.now();
    expect(() => withTracking(deep, "ZbCdEfGhIjKlMnOpQrStUvWxYz012345")).toThrow();
    expect(Date.now() - started).toBeLessThan(50);
    // A different body parses normally afterwards.
    expect(withTracking(`<a href="https://r.test/">r</a>`, TOKEN).links).toEqual(["https://r.test/"]);
  });

  it("parses a body once for all its recipients", () => {
    const html = `<a href="https://r.test/">r</a>`;
    const a = withTracking(html, TOKEN);
    const b = withTracking(html, "ZbCdEfGhIjKlMnOpQrStUvWxYz012345");
    expect(a.links).toEqual(b.links);
    expect(b.html).toContain("/api/public/email/c/ZbCdEfGhIjKlMnOpQrStUvWxYz012345/0");
    expect(b.html).not.toContain(TOKEN);
  });
});
