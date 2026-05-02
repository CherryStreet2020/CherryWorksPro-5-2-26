/**
 * Sprint 2g.7 — I5, I6, I7, I8: OAuth mailbox route tests.
 *
 * Mounts `registerOauthMailboxRoutes` onto a fresh Express app with stubbed
 * session + storage, then exercises start/callback for both providers.
 *
 *   I5  /api/auth/oauth/microsoft/callback persists encrypted refresh token
 *   I6  /api/auth/oauth/google/callback persists encrypted refresh token
 *   I7  /api/auth/oauth/{ms,google}/start rejected when EMAIL_OAUTH_ENABLED=false
 *   I8  CSRF guard: tampered / mismatched state on callback → 400
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import http, { type Server } from "http";
import { AddressInfo } from "net";

process.env.SMTP_ENCRYPTION_KEY =
  process.env.SMTP_ENCRYPTION_KEY ||
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret-do-not-use-in-prod";
process.env.MS_OAUTH_CLIENT_ID = "test-ms-client-id";
process.env.MS_OAUTH_CLIENT_SECRET = "test-ms-client-secret";
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-google-client-id";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-google-client-secret";

// Storage stub: routes call storage.getOrg/updateOrg, requireAuth calls getUserById.
const storedOrg: Record<string, any> = {
  id: "org-1",
  emailProviderType: "smtp",
};
const updateOrg = vi.fn(async (id: string, patch: any) => {
  Object.assign(storedOrg, patch, { id });
  return storedOrg;
});
const getOrg = vi.fn(async (id: string) => (id === "org-1" ? storedOrg : null));
const getUserById = vi.fn(async (_id: string) => ({
  id: "user-1",
  email: "u@example.com",
  isActive: true,
  role: "ADMIN",
}));
const createAuditLog = vi.fn(async (entry: any) => ({ id: "audit-1", ...entry }));

vi.mock("../../server/storage", () => ({
  storage: {
    getOrg: (...a: any[]) => getOrg(...(a as [string])),
    updateOrg: (...a: any[]) => updateOrg(...(a as [string, any])),
    getUserById: (...a: any[]) => getUserById(...(a as [string])),
    createAuditLog: (...a: any[]) => createAuditLog(...(a as [any])),
  },
}));

// The callback handlers call clearMailboxStatus(), which talks to the real
// drizzle `db` to flip `orgs.email_oauth_status` back to "ok" after a
// successful reconnect. These tests stub `storage` but do not stand up a real
// database, so we replace the helper with a no-op to avoid an unrelated 500
// out of the route handler's catch block.
vi.mock("../../server/email/mailbox-status", () => ({
  clearMailboxStatus: vi.fn(async () => {}),
}));

// The new operator-only m365-rescope endpoint calls into a helper that
// talks to the real `db`. These tests don't stand up a database, so
// stub the helper with a controllable spy.
const rescanSpy = vi.fn(async (_opts?: { notify?: boolean }) => ({
  scanned: 0,
  affected: [],
  notified: [],
  dryRun: true,
}));
vi.mock("../../server/email/m365-scope-rescan", () => ({
  rescanM365LegacyScopes: (...a: any[]) => rescanSpy(...(a as [any])),
}));

import { registerOauthMailboxRoutes } from "../../server/routes/oauth-mailbox-routes";
import {
  __setEmailOauthEnabledForTests,
  __resetEmailOauthFlagForTests,
} from "../../server/email/feature-flag";
import { signOauthState } from "../../server/email/oauth-state";
import { decryptSmtpPassword } from "../../server/email";

let server: Server;
let baseUrl: string;
const realFetch = global.fetch;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = {
      userId: "user-1",
      orgId: "org-1",
      destroy: (cb: () => void) => cb(),
    };
    next();
  });
  registerOauthMailboxRoutes(app);
  return app;
}

beforeEach(async () => {
  __resetEmailOauthFlagForTests();
  Object.keys(storedOrg).forEach((k) => k !== "id" && delete storedOrg[k]);
  storedOrg.emailProviderType = "smtp";
  updateOrg.mockClear();
  getOrg.mockClear();
  getUserById.mockClear();
  createAuditLog.mockClear();
  getUserById.mockImplementation(async (_id: string) => ({
    id: "user-1",
    email: "u@example.com",
    isActive: true,
    role: "ADMIN",
  }));
  delete process.env.PLATFORM_OPERATOR_EMAILS;
  rescanSpy.mockClear();
  rescanSpy.mockImplementation(async (_opts?: { notify?: boolean }) => ({
    scanned: 0,
    affected: [],
    notified: [],
    dryRun: true,
  }));
  global.fetch = realFetch;
  if (server) await new Promise<void>((r) => server.close(() => r()));
  const app = buildApp();
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, () => r()));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  global.fetch = realFetch;
  __resetEmailOauthFlagForTests();
  if (server) await new Promise<void>((r) => server.close(() => r()));
});

describe("OAuth mailbox routes — flag gate (I7)", () => {
  it("I7 — microsoft/start returns 404 when flag is OFF", async () => {
    __setEmailOauthEnabledForTests(false);
    const r = await fetch(`${baseUrl}/api/auth/oauth/microsoft/start`, { redirect: "manual" });
    expect(r.status).toBe(404);
  });
  it("I7 — google/start returns 404 when flag is OFF", async () => {
    __setEmailOauthEnabledForTests(false);
    const r = await fetch(`${baseUrl}/api/auth/oauth/google/start`, { redirect: "manual" });
    expect(r.status).toBe(404);
  });
  it("I7 — microsoft/start redirects to authorize URL when flag is ON", async () => {
    __setEmailOauthEnabledForTests(true);
    const r = await fetch(`${baseUrl}/api/auth/oauth/microsoft/start`, { redirect: "manual" });
    expect([301, 302]).toContain(r.status);
    expect(r.headers.get("location")).toContain("login.microsoftonline.com");
    expect(r.headers.get("location")).toContain("client_id=test-ms-client-id");
  });
});

describe("OAuth mailbox routes — state CSRF guard (I8)", () => {
  beforeEach(() => __setEmailOauthEnabledForTests(true));

  it("I8 — microsoft/callback with missing state → 400", async () => {
    const r = await fetch(`${baseUrl}/api/auth/oauth/microsoft/callback?code=abc`);
    expect(r.status).toBe(400);
  });
  it("I8 — microsoft/callback with tampered state → 400", async () => {
    const good = signOauthState({ orgId: "org-1", userId: "user-1", provider: "m365" });
    const tampered = good.slice(0, -3) + "xxx";
    const r = await fetch(
      `${baseUrl}/api/auth/oauth/microsoft/callback?code=abc&state=${encodeURIComponent(tampered)}`,
    );
    expect(r.status).toBe(400);
  });
  it("I8 — microsoft/callback with wrong-provider state → 400", async () => {
    const wrong = signOauthState({ orgId: "org-1", userId: "user-1", provider: "google" });
    const r = await fetch(
      `${baseUrl}/api/auth/oauth/microsoft/callback?code=abc&state=${encodeURIComponent(wrong)}`,
    );
    expect(r.status).toBe(400);
  });
});

describe("OAuth token-exchange failure formatting (Sprint 2g.12)", () => {
  beforeEach(() => __setEmailOauthEnabledForTests(true));

  it("microsoft/callback failure with JSON error_description renders the full description in the popup HTML", async () => {
    const longDescription =
      "The redirect URI in the request, https://wrong.example.com/api/auth/oauth/microsoft/callback, " +
      "does not match the reply URLs configured for the application. Configure the reply URL at " +
      "https://portal.azure.com under App registrations > Authentication.";
    global.fetch = vi.fn(async (input: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.startsWith("https://login.microsoftonline.com/")) {
        return new Response(
          JSON.stringify({ error: "redirect_uri_mismatch", error_description: longDescription }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
      return realFetch(input as any);
    }) as any;

    const state = signOauthState({ orgId: "org-1", userId: "user-1", provider: "m365" });
    const r = await fetch(
      `${baseUrl}/api/auth/oauth/microsoft/callback?code=auth-code&state=${encodeURIComponent(state)}`,
    );
    expect(r.status).toBe(502);
    const html = await r.text();
    // Full description, prefixed with the error code, must appear in the popup body
    // (apostrophes/angle-brackets are HTML-entity-escaped by renderClosePopupHtml).
    expect(html).toContain("redirect_uri_mismatch");
    expect(html).toContain("does not match the reply URLs configured for the application");
    expect(html).toContain("portal.azure.com");
    // No mid-sentence cutoff at the old 200-char boundary
    expect(html).not.toContain("Token exchange failed: {");
  });

  it("google/callback failure with non-JSON body falls back to raw text under the 1500 cap", async () => {
    const raw = "X".repeat(2000) + "TAIL";
    global.fetch = vi.fn(async (input: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url === "https://oauth2.googleapis.com/token") {
        return new Response(raw, { status: 500, headers: { "Content-Type": "text/plain" } });
      }
      return realFetch(input as any);
    }) as any;

    const state = signOauthState({ orgId: "org-1", userId: "user-1", provider: "google" });
    const r = await fetch(
      `${baseUrl}/api/auth/oauth/google/callback?code=auth-code&state=${encodeURIComponent(state)}`,
    );
    expect(r.status).toBe(502);
    const html = await r.text();
    expect(html).toContain("Token exchange failed:");
    // Sliced to the 1500-char cap; the trailing "TAIL" past 2000 chars must NOT appear
    expect(html).not.toContain("TAIL");
  });
});

describe("OAuth mailbox callback persistence (I5, I6)", () => {
  beforeEach(() => __setEmailOauthEnabledForTests(true));

  it("I5 — microsoft/callback exchanges code, encrypts refresh_token, persists to org", async () => {
    // id_token payload with email claim (Azure AD returns this when openid+email+profile scopes are requested)
    const claims = Buffer.from(JSON.stringify({ email: "alice@example.com" }), "utf8")
      .toString("base64")
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const idToken = `header.${claims}.sig`;

    global.fetch = vi.fn(async (input: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.startsWith("https://login.microsoftonline.com/")) {
        return new Response(
          JSON.stringify({
            access_token: "MS-AT",
            refresh_token: "MS-RT-secret",
            expires_in: 3600,
            scope: "Mail.Send offline_access openid email profile",
            id_token: idToken,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      // Fall through to real fetch for the in-process Express server call.
      return realFetch(input as any);
    }) as any;

    const state = signOauthState({ orgId: "org-1", userId: "user-1", provider: "m365" });
    const r = await fetch(
      `${baseUrl}/api/auth/oauth/microsoft/callback?code=auth-code&state=${encodeURIComponent(state)}`,
    );
    expect(r.status).toBe(200);
    expect(updateOrg).toHaveBeenCalledTimes(1);
    const [orgIdArg, patch] = updateOrg.mock.calls[0] as [string, any];
    expect(orgIdArg).toBe("org-1");
    expect(patch.emailProviderType).toBe("m365");
    expect(patch.emailSenderAddress).toBe("alice@example.com");
    expect(patch.emailOauthRefreshToken).toMatch(/^v2:/); // encrypted
    expect(decryptSmtpPassword(patch.emailOauthRefreshToken)).toBe("MS-RT-secret");
  });

  it("m365-rescope endpoint rejects tenant-admin sessions without the operator token (cross-tenant guard)", async () => {
    // No INTERNAL_MAINTENANCE_TOKEN env var → endpoint must look like 404
    delete process.env.INTERNAL_MAINTENANCE_TOKEN;
    const r1 = await fetch(`${baseUrl}/api/admin/email/m365-rescope`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notify: true }),
    });
    expect(r1.status).toBe(404);

    // With env var set, requests without the matching header are also 404
    process.env.INTERNAL_MAINTENANCE_TOKEN = "operator-only-secret";
    try {
      const r2 = await fetch(`${baseUrl}/api/admin/email/m365-rescope`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notify: true }),
      });
      expect(r2.status).toBe(404);

      // Wrong token also rejected
      const r3 = await fetch(`${baseUrl}/api/admin/email/m365-rescope`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-maintenance-token": "wrong",
        },
        body: JSON.stringify({ notify: true }),
      });
      expect(r3.status).toBe(404);

      // updateOrg must NOT have been called (no cross-tenant side effects)
      expect(updateOrg).not.toHaveBeenCalled();
      // The rescan helper must NOT have been invoked on rejected requests.
      expect(rescanSpy).not.toHaveBeenCalled();
    } finally {
      delete process.env.INTERNAL_MAINTENANCE_TOKEN;
    }
  });

  it("m365-rescope endpoint dry-run with the matching operator token returns the scan result", async () => {
    process.env.INTERNAL_MAINTENANCE_TOKEN = "operator-only-secret";
    rescanSpy.mockResolvedValueOnce({
      scanned: 2,
      affected: [
        { id: "org-a", name: "Cherry Street", scopes: "Mail.Send User.Read offline_access", connectedAt: null },
        { id: "org-b", name: "Acme Inc", scopes: "User.Read Mail.Send openid", connectedAt: null },
      ],
      notified: [],
      dryRun: true,
    });
    try {
      const r = await fetch(`${baseUrl}/api/admin/email/m365-rescope`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-maintenance-token": "operator-only-secret",
        },
        body: JSON.stringify({}),
      });
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.scanned).toBe(2);
      expect(body.dryRun).toBe(true);
      expect(body.affected).toHaveLength(2);
      expect(body.notified).toEqual([]);
      // Default body (no notify flag) → helper called with notify:false
      expect(rescanSpy).toHaveBeenCalledTimes(1);
      expect(rescanSpy).toHaveBeenCalledWith({ notify: false });
    } finally {
      delete process.env.INTERNAL_MAINTENANCE_TOKEN;
    }
  });

  it("m365-rescope endpoint with notify:true forwards the flag and returns the per-org email count", async () => {
    process.env.INTERNAL_MAINTENANCE_TOKEN = "operator-only-secret";
    rescanSpy.mockResolvedValueOnce({
      scanned: 1,
      affected: [
        { id: "org-a", name: "Cherry Street", scopes: "Mail.Send User.Read offline_access", connectedAt: null },
      ],
      notified: [{ orgId: "org-a", orgName: "Cherry Street", adminsEmailed: 3 }],
      dryRun: false,
    });
    try {
      const r = await fetch(`${baseUrl}/api/admin/email/m365-rescope`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-maintenance-token": "operator-only-secret",
        },
        body: JSON.stringify({ notify: true }),
      });
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.dryRun).toBe(false);
      expect(body.notified[0].adminsEmailed).toBe(3);
      expect(rescanSpy).toHaveBeenCalledWith({ notify: true });
    } finally {
      delete process.env.INTERNAL_MAINTENANCE_TOKEN;
    }
  });

  it("operator scan endpoint 404s when PLATFORM_OPERATOR_EMAILS is unset", async () => {
    delete process.env.PLATFORM_OPERATOR_EMAILS;
    const r = await fetch(`${baseUrl}/api/admin/email/m365-rescope/scan`);
    expect(r.status).toBe(404);
    expect(rescanSpy).not.toHaveBeenCalled();
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it("operator notify endpoint 404s when PLATFORM_OPERATOR_EMAILS is unset", async () => {
    delete process.env.PLATFORM_OPERATOR_EMAILS;
    const r = await fetch(`${baseUrl}/api/admin/email/m365-rescope/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(404);
    expect(rescanSpy).not.toHaveBeenCalled();
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it("operator scan endpoint 404s for a tenant ADMIN whose email is not in the allow-list", async () => {
    process.env.PLATFORM_OPERATOR_EMAILS = "ops@example.com, sre@example.com";
    // Default getUserById returns u@example.com (ADMIN) — not allow-listed.
    try {
      const r = await fetch(`${baseUrl}/api/admin/email/m365-rescope/scan`);
      expect(r.status).toBe(404);
      expect(rescanSpy).not.toHaveBeenCalled();
      expect(createAuditLog).not.toHaveBeenCalled();
    } finally {
      delete process.env.PLATFORM_OPERATOR_EMAILS;
    }
  });

  it("operator notify endpoint 404s for a tenant ADMIN whose email is not in the allow-list", async () => {
    process.env.PLATFORM_OPERATOR_EMAILS = "ops@example.com";
    try {
      const r = await fetch(`${baseUrl}/api/admin/email/m365-rescope/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(r.status).toBe(404);
      expect(rescanSpy).not.toHaveBeenCalled();
      expect(createAuditLog).not.toHaveBeenCalled();
    } finally {
      delete process.env.PLATFORM_OPERATOR_EMAILS;
    }
  });

  it("operator scan endpoint returns the dry-run scan for an allow-listed user and writes a M365_LEGACY_SCOPE_SCAN audit log", async () => {
    process.env.PLATFORM_OPERATOR_EMAILS = "OPS@Example.com, u@example.com";
    rescanSpy.mockResolvedValueOnce({
      scanned: 2,
      affected: [
        { id: "org-a", name: "Cherry Street", scopes: "Mail.Send User.Read offline_access", connectedAt: null },
        { id: "org-b", name: "Acme Inc", scopes: "User.Read Mail.Send openid", connectedAt: null },
      ],
      notified: [],
      dryRun: true,
    });
    try {
      const r = await fetch(`${baseUrl}/api/admin/email/m365-rescope/scan`);
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.scanned).toBe(2);
      expect(body.dryRun).toBe(true);
      expect(body.affected).toHaveLength(2);
      // The scan endpoint always runs as dry-run (notify:false) regardless of body.
      expect(rescanSpy).toHaveBeenCalledTimes(1);
      expect(rescanSpy).toHaveBeenCalledWith({ notify: false });
      // Audit log row written under the operator's own org/userId.
      expect(createAuditLog).toHaveBeenCalledTimes(1);
      const entry = createAuditLog.mock.calls[0][0] as any;
      expect(entry.action).toBe("M365_LEGACY_SCOPE_SCAN");
      expect(entry.orgId).toBe("org-1");
      expect(entry.userId).toBe("user-1");
      expect(entry.entityType).toBe("platform_maintenance");
      expect(entry.entityId).toBe("m365-rescope");
      expect(entry.details.scanned).toBe(2);
      expect(entry.details.affectedOrgIds).toEqual(["org-a", "org-b"]);
    } finally {
      delete process.env.PLATFORM_OPERATOR_EMAILS;
    }
  });

  it("operator notify endpoint forwards notify:true and writes a M365_LEGACY_SCOPE_NOTIFY audit log", async () => {
    process.env.PLATFORM_OPERATOR_EMAILS = "u@example.com";
    rescanSpy.mockResolvedValueOnce({
      scanned: 1,
      affected: [
        { id: "org-a", name: "Cherry Street", scopes: "Mail.Send User.Read offline_access", connectedAt: null },
      ],
      notified: [{ orgId: "org-a", orgName: "Cherry Street", adminsEmailed: 3 }],
      dryRun: false,
    });
    try {
      const r = await fetch(`${baseUrl}/api/admin/email/m365-rescope/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.dryRun).toBe(false);
      expect(body.notified[0].adminsEmailed).toBe(3);
      expect(rescanSpy).toHaveBeenCalledTimes(1);
      expect(rescanSpy).toHaveBeenCalledWith({ notify: true });
      // Audit log row written with notified detail attached.
      expect(createAuditLog).toHaveBeenCalledTimes(1);
      const entry = createAuditLog.mock.calls[0][0] as any;
      expect(entry.action).toBe("M365_LEGACY_SCOPE_NOTIFY");
      expect(entry.orgId).toBe("org-1");
      expect(entry.userId).toBe("user-1");
      expect(entry.entityType).toBe("platform_maintenance");
      expect(entry.entityId).toBe("m365-rescope");
      expect(entry.details.scanned).toBe(1);
      expect(entry.details.affectedOrgIds).toEqual(["org-a"]);
      expect(entry.details.notified).toEqual([
        { orgId: "org-a", orgName: "Cherry Street", adminsEmailed: 3 },
      ]);
    } finally {
      delete process.env.PLATFORM_OPERATOR_EMAILS;
    }
  });

  it("I6 — google/callback exchanges code, encrypts refresh_token, persists to org", async () => {
    // id_token payload (base64url encoded) with email claim
    const claims = Buffer.from(JSON.stringify({ email: "bob@example.com" }), "utf8")
      .toString("base64")
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const idToken = `header.${claims}.sig`;

    global.fetch = vi.fn(async (input: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url === "https://oauth2.googleapis.com/token") {
        return new Response(
          JSON.stringify({
            access_token: "G-AT",
            refresh_token: "G-RT-secret",
            expires_in: 3600,
            scope: "https://www.googleapis.com/auth/gmail.send",
            id_token: idToken,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return realFetch(input as any);
    }) as any;

    const state = signOauthState({ orgId: "org-1", userId: "user-1", provider: "google" });
    const r = await fetch(
      `${baseUrl}/api/auth/oauth/google/callback?code=auth-code&state=${encodeURIComponent(state)}`,
    );
    expect(r.status).toBe(200);
    const [, patch] = updateOrg.mock.calls[0] as [string, any];
    expect(patch.emailProviderType).toBe("google");
    expect(patch.emailSenderAddress).toBe("bob@example.com");
    expect(decryptSmtpPassword(patch.emailOauthRefreshToken)).toBe("G-RT-secret");
  });
});
