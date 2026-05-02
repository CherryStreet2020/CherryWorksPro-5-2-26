/**
 * Task #160 — server-side guard for pasted brand logo URLs.
 *
 * Covers scheme rejection, SSRF/private-IP blocking, content-type
 * sniffing, redirect refusal, and exemption of hosted/data URLs.
 */
import { describe, it, expect, vi } from "vitest";
import {
  isExemptLogoUrl,
  validateExternalLogoUrl,
} from "../../server/lib/validate-logo-url";

function makeFetch(
  responder: (url: URL, init: RequestInit) => Response,
): typeof fetch {
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? new URL(input) : input as URL;
    return responder(url, init);
  }) as unknown as typeof fetch;
}

describe("isExemptLogoUrl", () => {
  it("treats null/empty/data-image and relative hosted paths as exempt", () => {
    expect(isExemptLogoUrl(null)).toBe(true);
    expect(isExemptLogoUrl("")).toBe(true);
    expect(isExemptLogoUrl("data:image/png;base64,AAAA")).toBe(true);
    expect(isExemptLogoUrl("/api/public-objects/brand-logos/x.png")).toBe(true);
  });

  it("exempts hosted URLs only when the origin matches APP_BASE_URL", () => {
    const prev = process.env.APP_BASE_URL;
    process.env.APP_BASE_URL = "https://app.example";
    try {
      expect(
        isExemptLogoUrl(
          "https://app.example/api/public-objects/brand-logos/x.png",
        ),
      ).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.APP_BASE_URL;
      else process.env.APP_BASE_URL = prev;
    }
  });

  it("does NOT exempt a path-spoof on an attacker domain (bypass guard)", () => {
    const prev = process.env.APP_BASE_URL;
    process.env.APP_BASE_URL = "https://app.example";
    try {
      expect(
        isExemptLogoUrl(
          "https://attacker.tld/api/public-objects/brand-logos/fake.png",
        ),
      ).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.APP_BASE_URL;
      else process.env.APP_BASE_URL = prev;
    }
  });

  it("does not exempt arbitrary external URLs", () => {
    expect(isExemptLogoUrl("https://cdn.example/foo.png")).toBe(false);
  });
});

describe("validateExternalLogoUrl — scheme & format", () => {
  it("rejects unparseable URLs", async () => {
    const r = await validateExternalLogoUrl("not a url");
    expect(r.ok).toBe(false);
  });
  it("rejects javascript: scheme", async () => {
    const r = await validateExternalLogoUrl("javascript:alert(1)");
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/http/i);
  });
  it("rejects file: scheme", async () => {
    const r = await validateExternalLogoUrl("file:///etc/passwd");
    expect(r.ok).toBe(false);
  });
  it("rejects URLs containing credentials", async () => {
    const r = await validateExternalLogoUrl("https://u:p@example.com/x.png");
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/credential/i);
  });
});

describe("validateExternalLogoUrl — SSRF guards", () => {
  it("blocks IPv4 loopback literals without ever fetching", async () => {
    const fetchImpl = vi.fn(makeFetch(() => new Response()));
    const r = await validateExternalLogoUrl("http://127.0.0.1/x.png", {
      fetchImpl,
    });
    expect(r.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("blocks RFC1918 literals", async () => {
    const fetchImpl = vi.fn(makeFetch(() => new Response()));
    const r = await validateExternalLogoUrl("http://10.0.0.5/x.png", {
      fetchImpl,
    });
    expect(r.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("blocks the AWS metadata IP", async () => {
    const r = await validateExternalLogoUrl(
      "http://169.254.169.254/latest/meta-data/",
    );
    expect(r.ok).toBe(false);
  });
  it("blocks IPv6 loopback", async () => {
    const r = await validateExternalLogoUrl("http://[::1]/x.png");
    expect(r.ok).toBe(false);
  });
  it("blocks the literal hostname 'localhost'", async () => {
    const fetchImpl = vi.fn(makeFetch(() => new Response()));
    const r = await validateExternalLogoUrl("http://localhost/x.png", {
      fetchImpl,
    });
    expect(r.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("validateExternalLogoUrl — content-type sniffing", () => {
  it("accepts a public host that returns image/png on HEAD", async () => {
    const fetchImpl = makeFetch(
      () =>
        new Response(null, {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
    );
    const r = await validateExternalLogoUrl("https://example.com/logo.png", {
      fetchImpl,
    });
    expect(r.ok).toBe(true);
  });
  it("rejects text/html responses", async () => {
    const fetchImpl = makeFetch(
      () =>
        new Response(null, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
    );
    const r = await validateExternalLogoUrl("https://example.com/page", {
      fetchImpl,
    });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/image/i);
  });
  it("rejects non-2xx HTTP statuses", async () => {
    const fetchImpl = makeFetch(() => new Response(null, { status: 404 }));
    const r = await validateExternalLogoUrl("https://example.com/missing", {
      fetchImpl,
    });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/404/);
  });
  it("refuses to follow redirects", async () => {
    const fetchImpl = makeFetch(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1/x" },
        }),
    );
    const r = await validateExternalLogoUrl("https://example.com/r", {
      fetchImpl,
    });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/redirect/i);
  });
  it("falls back to ranged GET when HEAD has no content-type", async () => {
    let calls = 0;
    const fetchImpl = makeFetch((_url, init) => {
      calls += 1;
      if (init.method === "HEAD") {
        return new Response(null, { status: 200 });
      }
      return new Response(null, {
        status: 206,
        headers: { "content-type": "image/jpeg" },
      });
    });
    const r = await validateExternalLogoUrl("https://example.com/logo", {
      fetchImpl,
    });
    expect(r.ok).toBe(true);
    expect(calls).toBe(2);
  });
});
