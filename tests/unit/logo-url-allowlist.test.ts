/**
 * Task #478 — Direct unit coverage for the shared logo allowlist helper.
 *
 * Task #474 extracted the org-logo SSRF allowlist into
 * `server/lib/logo-url-allowlist.ts`. The pre-existing regression suite
 * at `tests/unit/pdf-logo-loader-ssrf.test.ts` exercises the helper
 * transitively through `server/pdf.ts` and the live PATCH
 * /api/org/settings route — but nothing imports the new module
 * directly. This file pins the contract of each export so a future
 * refactor that re-exports a different function from `server/pdf.ts`
 * (or settings-routes) can't silently hide a regression in the helper
 * itself.
 */
import { describe, it, expect, afterEach } from "vitest";

import {
  ALLOWED_LOGO_PATH_PREFIXES,
  getAllowedLogoHosts,
  isAllowedLogoPath,
  isAllowedLogoUrl,
} from "../../server/lib/logo-url-allowlist";

describe("Task #478 — ALLOWED_LOGO_PATH_PREFIXES", () => {
  it("contains exactly the three expected hosted-logo prefixes", () => {
    // Sort both sides so a future re-ordering of the array (cosmetic)
    // doesn't break the test, but adding/removing a prefix does.
    expect([...ALLOWED_LOGO_PATH_PREFIXES].sort()).toEqual(
      [
        "/api/public-objects/org-logos/",
        "/api/public-objects/brand-logos/",
        "/api/uploads/logos/",
      ].sort(),
    );
  });

  it("has length 3 (locks in the closed set)", () => {
    expect(ALLOWED_LOGO_PATH_PREFIXES).toHaveLength(3);
  });
});

describe("Task #478 — getAllowedLogoHosts()", () => {
  const ENV_KEYS = ["APP_BASE_URL", "BASE_URL", "REPLIT_DOMAINS"] as const;
  const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  function snapshotEnv() {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
  }

  it("always includes the dev fallback hosts (localhost:5000 and 127.0.0.1:5000)", () => {
    snapshotEnv();
    delete process.env.APP_BASE_URL;
    delete process.env.BASE_URL;
    delete process.env.REPLIT_DOMAINS;

    const hosts = getAllowedLogoHosts();
    expect(hosts.has("localhost:5000")).toBe(true);
    expect(hosts.has("127.0.0.1:5000")).toBe(true);
  });

  it("parses APP_BASE_URL via URL parsing (host only, not substring)", () => {
    snapshotEnv();
    process.env.APP_BASE_URL = "https://app.example.com/some/path?x=1";
    delete process.env.BASE_URL;
    delete process.env.REPLIT_DOMAINS;

    const hosts = getAllowedLogoHosts();
    expect(hosts.has("app.example.com")).toBe(true);
    // The path/query must NOT have leaked into the host set.
    expect(hosts.has("app.example.com/some/path")).toBe(false);
  });

  it("parses BASE_URL via URL parsing", () => {
    snapshotEnv();
    delete process.env.APP_BASE_URL;
    process.env.BASE_URL = "https://base.example.com";
    delete process.env.REPLIT_DOMAINS;

    expect(getAllowedLogoHosts().has("base.example.com")).toBe(true);
  });

  it("splits REPLIT_DOMAINS on commas and parses each entry", () => {
    snapshotEnv();
    delete process.env.APP_BASE_URL;
    delete process.env.BASE_URL;
    process.env.REPLIT_DOMAINS = "one.replit.app, two.replit.app ,three.replit.app";

    const hosts = getAllowedLogoHosts();
    expect(hosts.has("one.replit.app")).toBe(true);
    expect(hosts.has("two.replit.app")).toBe(true);
    expect(hosts.has("three.replit.app")).toBe(true);
  });

  it("does not treat a host-confusion APP_BASE_URL as the embedded host", () => {
    // `https://evil.com#cherry-app.replit.app` parses to host=evil.com.
    // Proves we use URL parsing, not substring matching.
    snapshotEnv();
    process.env.APP_BASE_URL = "https://evil.com#cherry-app.replit.app";
    delete process.env.BASE_URL;
    delete process.env.REPLIT_DOMAINS;

    const hosts = getAllowedLogoHosts();
    expect(hosts.has("evil.com")).toBe(true);
    expect(hosts.has("cherry-app.replit.app")).toBe(false);
  });

  it("ignores malformed env entries without throwing", () => {
    snapshotEnv();
    process.env.APP_BASE_URL = "::::not a url::::";
    delete process.env.BASE_URL;
    process.env.REPLIT_DOMAINS = ",,not a url either,,";

    expect(() => getAllowedLogoHosts()).not.toThrow();
    // Dev fallbacks still present even when every env entry is junk.
    const hosts = getAllowedLogoHosts();
    expect(hosts.has("localhost:5000")).toBe(true);
  });

  it("accepts REPLIT_DOMAINS entries without a scheme by prepending https://", () => {
    snapshotEnv();
    delete process.env.APP_BASE_URL;
    delete process.env.BASE_URL;
    process.env.REPLIT_DOMAINS = "bare-host.replit.app";

    expect(getAllowedLogoHosts().has("bare-host.replit.app")).toBe(true);
  });
});

describe("Task #478 — isAllowedLogoPath()", () => {
  it("accepts each of the three allowed prefixes", () => {
    expect(isAllowedLogoPath("/api/public-objects/org-logos/foo.png")).toBe(true);
    expect(isAllowedLogoPath("/api/public-objects/brand-logos/bar.png")).toBe(true);
    expect(isAllowedLogoPath("/api/uploads/logos/baz.png")).toBe(true);
  });

  it("rejects /api/admin/...", () => {
    expect(isAllowedLogoPath("/api/admin/users")).toBe(false);
  });

  it("rejects bare '/'", () => {
    expect(isAllowedLogoPath("/")).toBe(false);
  });

  it("rejects the empty string", () => {
    expect(isAllowedLogoPath("")).toBe(false);
  });

  it("rejects a near-miss prefix without trailing slash", () => {
    // `/api/uploads/logos` (no trailing slash) must not match
    // `/api/uploads/logos/` — trailing slash is part of the prefix.
    expect(isAllowedLogoPath("/api/uploads/logos")).toBe(false);
    expect(isAllowedLogoPath("/api/uploads/logosX/foo.png")).toBe(false);
  });
});

describe("Task #478 — isAllowedLogoUrl()", () => {
  // Pin a known APP_BASE_URL so these cases don't depend on the
  // ambient test env. afterEach restores.
  const saved = {
    APP_BASE_URL: process.env.APP_BASE_URL,
    BASE_URL: process.env.BASE_URL,
    REPLIT_DOMAINS: process.env.REPLIT_DOMAINS,
  };

  afterEach(() => {
    for (const k of Object.keys(saved) as Array<keyof typeof saved>) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  function setHostedEnv() {
    process.env.APP_BASE_URL = "https://app.example.com";
    delete process.env.BASE_URL;
    delete process.env.REPLIT_DOMAINS;
  }

  it("rejects AWS instance metadata IP", () => {
    setHostedEnv();
    expect(
      isAllowedLogoUrl("http://169.254.169.254/latest/meta-data/"),
    ).toBe(false);
  });

  it("rejects RFC1918 private network literal (10.0.0.1)", () => {
    setHostedEnv();
    expect(isAllowedLogoUrl("http://10.0.0.1/logo.png")).toBe(false);
  });

  it("rejects an allowed host with a non-allowed path", () => {
    setHostedEnv();
    expect(
      isAllowedLogoUrl("https://app.example.com/api/admin/users"),
    ).toBe(false);
  });

  it("rejects http:// on a non-dev allowed host (https-only enforcement)", () => {
    setHostedEnv();
    expect(
      isAllowedLogoUrl(
        "http://app.example.com/api/public-objects/org-logos/x.png",
      ),
    ).toBe(false);
  });

  it("rejects file: and javascript: schemes outright", () => {
    setHostedEnv();
    expect(isAllowedLogoUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedLogoUrl("javascript:alert(1)")).toBe(false);
  });

  it("rejects a host-confusion attempt via URL fragment", () => {
    // `https://evil.com/...#app.example.com` parses to host=evil.com.
    setHostedEnv();
    expect(
      isAllowedLogoUrl(
        "https://evil.com/api/public-objects/org-logos/x.png#app.example.com",
      ),
    ).toBe(false);
  });

  it("rejects a malformed URL string", () => {
    setHostedEnv();
    expect(isAllowedLogoUrl("not a url")).toBe(false);
  });

  it("accepts an allowed host with an allowed prefix on https", () => {
    setHostedEnv();
    expect(
      isAllowedLogoUrl(
        "https://app.example.com/api/public-objects/org-logos/foo.png",
      ),
    ).toBe(true);
  });

  it("accepts the dev fallback host on http for allowed prefixes", () => {
    setHostedEnv();
    expect(
      isAllowedLogoUrl(
        "http://localhost:5000/api/public-objects/org-logos/foo.png",
      ),
    ).toBe(true);
    expect(
      isAllowedLogoUrl(
        "http://127.0.0.1:5000/api/uploads/logos/foo.png",
      ),
    ).toBe(true);
  });

  it("rejects loopback dev host on a non-allowed path", () => {
    setHostedEnv();
    expect(
      isAllowedLogoUrl("http://127.0.0.1:5000/api/admin/users"),
    ).toBe(false);
  });
});
