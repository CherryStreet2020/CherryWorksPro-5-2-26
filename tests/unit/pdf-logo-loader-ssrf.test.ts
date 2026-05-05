/**
 * Task #470 — SSRF regression tests for the PDF logo loader.
 *
 * Task #467 hardened `loadLogoBytes()` in `server/pdf.ts` against SSRF
 * by adding a host + path allowlist and rejecting redirects. The fix
 * was reviewed by hand but had no automated coverage, so a future
 * refactor could silently re-open the hole.
 *
 * This suite pins:
 *   - `isAllowedLogoUrl` rejects AWS metadata, RFC1918 / loopback IPs,
 *     allowed-host with non-allowed path, and disallowed schemes.
 *   - `loadLogoBytes` never issues a network request for any of the
 *     above (cache-miss branch verified via stubbed `fetch`).
 *   - `loadLogoBytes` rejects a 302 from an allowed host (so an attacker
 *     can't bounce the fetch into an internal target).
 *   - `loadLogoBytes` accepts an allowed host + allowed path on 200.
 *   - `loadLogoBytes` falls back to local disk for legacy
 *     `/api/uploads/logos/...` paths without ever issuing fetch.
 *
 * The parallel guard at PATCH `/api/org/settings` (server/routes/
 * settings-routes.ts) is exercised end-to-end against the live test
 * server so a future refactor of either call site shows up here.
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
  vi,
} from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

import { isAllowedLogoUrl, loadLogoBytes } from "../../server/pdf";
import { TEST_BASE as BASE_URL } from "../helpers/base";

// In dev/test the env exposes BASE_URL=https://cherryworkspro.com so
// that's the host we target for the "accept" cases. Falls back to the
// dev fallback host if neither APP_BASE_URL nor BASE_URL is set.
const APP_HOST = (() => {
  const raw = process.env.APP_BASE_URL || process.env.BASE_URL;
  if (raw) {
    try {
      return new URL(raw).host;
    } catch {
      /* fall through */
    }
  }
  return "localhost:5000";
})();

const APP_PROTO = APP_HOST.startsWith("localhost") || APP_HOST.startsWith("127.")
  ? "http"
  : "https";

// Each loadLogoBytes() call is keyed in the in-memory cache by its
// input string. Tests must use unique URLs so a previous test's cached
// `null` (or bytes) doesn't poison a later assertion.
function uniqueSuffix(): string {
  return crypto.randomBytes(6).toString("hex");
}

describe("Task #470 — isAllowedLogoUrl host + path allowlist", () => {
  it("rejects AWS instance metadata IP (169.254.169.254)", () => {
    expect(
      isAllowedLogoUrl("http://169.254.169.254/latest/meta-data/"),
    ).toBe(false);
  });

  it("rejects loopback to a non-allowed path on a same-host port", () => {
    // 127.0.0.1:5000 IS in the host allowlist (dev fallback) but
    // /api/admin/... is NOT in the path allowlist, so the URL must
    // still be rejected — proves the path guard is the second gate.
    expect(
      isAllowedLogoUrl("http://127.0.0.1:5000/api/admin/users"),
    ).toBe(false);
  });

  it("rejects RFC1918 private network literal (10.0.0.1)", () => {
    expect(isAllowedLogoUrl("http://10.0.0.1/logo.png")).toBe(false);
  });

  it("rejects an allowed host with a non-allowed path (/api/admin/users)", () => {
    expect(
      isAllowedLogoUrl(`${APP_PROTO}://${APP_HOST}/api/admin/users`),
    ).toBe(false);
  });

  it("rejects file: and javascript: schemes outright", () => {
    expect(isAllowedLogoUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedLogoUrl("javascript:alert(1)")).toBe(false);
  });

  // Use `it.skipIf` so a CI run where only the dev fallback hosts are
  // available reports the case as skipped (clear signal) rather than
  // silently passing via early return.
  it.skipIf(APP_PROTO !== "https")(
    "rejects http:// on a non-dev allowed host (https-only enforcement)",
    () => {
      expect(
        isAllowedLogoUrl(
          `http://${APP_HOST}/api/public-objects/org-logos/x.png`,
        ),
      ).toBe(false);
    },
  );

  it("accepts an allowed host with /api/public-objects/org-logos/", () => {
    expect(
      isAllowedLogoUrl(
        `${APP_PROTO}://${APP_HOST}/api/public-objects/org-logos/foo.png`,
      ),
    ).toBe(true);
  });

  it("accepts the legacy /api/uploads/logos/ prefix on an allowed host", () => {
    expect(
      isAllowedLogoUrl(
        `${APP_PROTO}://${APP_HOST}/api/uploads/logos/foo.png`,
      ),
    ).toBe(true);
  });

  it("accepts the dev fallback host (localhost:5000) for hosted prefixes", () => {
    expect(
      isAllowedLogoUrl(
        "http://localhost:5000/api/public-objects/org-logos/foo.png",
      ),
    ).toBe(true);
  });

  it("rejects a host-confusion attempt (URL fragment carrying allowed host)", () => {
    // `https://evil.com#cherry-app.replit.app/...` parses to host=evil.com
    // — proves we use URL-parse, not substring match.
    expect(
      isAllowedLogoUrl(
        `https://evil.com/api/public-objects/org-logos/x.png#${APP_HOST}`,
      ),
    ).toBe(false);
  });
});

describe("Task #470 — loadLogoBytes SSRF guard (no network for disallowed URLs)", () => {
  beforeEach(() => {
    // Default to a tripwire fetch that fails the test if invoked. Each
    // accept-case test re-stubs with a real mock.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("fetch should not be called for disallowed URLs");
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("never fetches AWS metadata and returns null", async () => {
    const r = await loadLogoBytes(
      `http://169.254.169.254/latest/meta-data/?${uniqueSuffix()}`,
    );
    expect(r).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("never fetches loopback /api/admin/... on a same-host port", async () => {
    const r = await loadLogoBytes(
      `http://127.0.0.1:5000/api/admin/users?${uniqueSuffix()}`,
    );
    expect(r).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("never fetches a private network IP (10.0.0.1)", async () => {
    const r = await loadLogoBytes(
      `http://10.0.0.1/logo.png?${uniqueSuffix()}`,
    );
    expect(r).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("never fetches an allowed host with a non-allowed path", async () => {
    const r = await loadLogoBytes(
      `${APP_PROTO}://${APP_HOST}/api/admin/users?${uniqueSuffix()}`,
    );
    expect(r).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects a 302 redirect from an allowed host (no follow)", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const r = await loadLogoBytes(
      `${APP_PROTO}://${APP_HOST}/api/public-objects/org-logos/redir-${uniqueSuffix()}.png`,
    );

    expect(r).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The fetch call must have been issued with redirect: "manual" so
    // node's fetch never silently follows a server-side redirect.
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(init?.redirect).toBe("manual");
  });

  it("accepts an allowed host + allowed path on 200 and returns bytes", async () => {
    const pngBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const fetchMock = vi.fn(
      async () =>
        new Response(pngBytes, {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const r = await loadLogoBytes(
      `${APP_PROTO}://${APP_HOST}/api/public-objects/org-logos/ok-${uniqueSuffix()}.png`,
    );

    expect(r).not.toBeNull();
    expect(r!.length).toBe(pngBytes.length);
    expect(r!.equals(pngBytes)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("accepts the legacy /api/uploads/logos/ path with local-disk fallback", async () => {
    const dir = path.join(process.cwd(), "uploads", "logos");
    fs.mkdirSync(dir, { recursive: true });
    const filename = `t470-${uniqueSuffix()}.png`;
    const fp = path.join(dir, filename);
    const pngBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    fs.writeFileSync(fp, pngBytes);

    try {
      const r = await loadLogoBytes(`/api/uploads/logos/${filename}`);
      expect(r).not.toBeNull();
      expect(r!.equals(pngBytes)).toBe(true);
      // Local-disk hit must short-circuit before any network call.
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      try {
        fs.unlinkSync(fp);
      } catch {
        /* ignore */
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Parallel guard: PATCH /api/org/settings.
//
// The settings route validates `logoUrl` with the same host + path
// allowlist before persisting, so an admin can't sneak a SSRF URL into
// the org row that the PDF loader then dutifully fetches. Hit the live
// test server (booted by tests/setup/global-setup.ts) so a future
// refactor of either call site fails here.
// ---------------------------------------------------------------------------

interface Ctx {
  cookies: string;
  csrfToken: string;
}

interface ApiResp<T> {
  status: number;
  body: T;
}

async function loginAs(email: string, password: string): Promise<Ctx> {
  const csrfRes = await fetch(`${BASE_URL}/api/csrf-token`);
  const csrfCookies = csrfRes.headers.getSetCookie();
  const csrfToken = csrfRes.headers.get("x-csrf-token")!;
  const cookieJar = csrfCookies.map((c) => c.split(";")[0]).join("; ");
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieJar,
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({ email, password }),
    redirect: "manual",
  });
  expect(loginRes.status).toBe(200);
  const allCookies = [
    ...csrfCookies.map((c) => c.split(";")[0]),
    ...loginRes.headers.getSetCookie().map((c) => c.split(";")[0]),
  ].join("; ");
  return {
    cookies: allCookies,
    csrfToken: loginRes.headers.get("x-csrf-token") || csrfToken,
  };
}

async function api<T = unknown>(
  ctx: Ctx,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  body?: unknown,
): Promise<ApiResp<T>> {
  const headers: Record<string, string> = { Cookie: ctx.cookies };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") headers["X-CSRF-Token"] = ctx.csrfToken;
  const res = await fetch(`${BASE_URL}${url}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* empty */
  }
  return { status: res.status, body: json as T };
}

describe("Task #470 — PATCH /api/org/settings parallel logoUrl guard", () => {
  let admin: Ctx;
  let originalLogoUrl: string | null = null;

  beforeAll(async () => {
    admin = await loginAs("admin.test@cwpro.dev", "admin123");
    // Snapshot the current logoUrl so we can restore it after the
    // accept-case test mutates the row.
    const cur = await api<{ logoUrl?: string | null }>(
      admin,
      "GET",
      "/api/org/settings",
    );
    if (cur.status === 200) {
      originalLogoUrl = cur.body?.logoUrl ?? null;
    }
  }, 60000);

  const rejectionCases: Array<{ name: string; logoUrl: string }> = [
    { name: "AWS metadata IP", logoUrl: "http://169.254.169.254/latest/meta-data/" },
    { name: "loopback non-allowed path", logoUrl: "http://127.0.0.1:5000/api/admin/users" },
    { name: "RFC1918 private IP", logoUrl: "http://10.0.0.1/logo.png" },
    {
      name: "allowed host with /api/admin path",
      logoUrl: `${APP_PROTO}://${APP_HOST}/api/admin/users`,
    },
    {
      name: "relative path outside allowlist",
      logoUrl: "/api/admin/users",
    },
  ];

  for (const c of rejectionCases) {
    it(`rejects ${c.name} with 400`, async () => {
      const r = await api<{ message: string }>(
        admin,
        "PATCH",
        "/api/org/settings",
        { logoUrl: c.logoUrl },
      );
      expect(r.status).toBe(400);
      expect(r.body?.message ?? "").toMatch(/logo url/i);
    });
  }

  it("accepts a relative hosted /api/public-objects/org-logos path and persists it", async () => {
    const newUrl = `/api/public-objects/org-logos/t470-${uniqueSuffix()}.png`;
    const r = await api<{ logoUrl?: string | null }>(
      admin,
      "PATCH",
      "/api/org/settings",
      { logoUrl: newUrl },
    );
    expect(r.status).toBe(200);
    // The PATCH response itself should echo the persisted value so the
    // accept branch is proven, not just inferred from the 200.
    expect(r.body?.logoUrl).toBe(newUrl);
    // Re-read to confirm the value really hit the row (not just the
    // PATCH echo) before restoring the original.
    const after = await api<{ logoUrl?: string | null }>(
      admin,
      "GET",
      "/api/org/settings",
    );
    expect(after.status).toBe(200);
    expect(after.body?.logoUrl).toBe(newUrl);
    // Restore so downstream tests that read this org's settings aren't
    // polluted by the regression suite.
    await api(admin, "PATCH", "/api/org/settings", {
      logoUrl: originalLogoUrl,
    });
  });
});
