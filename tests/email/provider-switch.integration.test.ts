/**
 * Sprint 2g.10 hot-patch — provider-switch regression test.
 *
 * Reproduces Dean's 13:52:34 incident: after a fresh Google OAuth, the FIRST
 * test send hits a Gmail-API failure that flips emailOauthStatus to
 * "needs_reconnect"; the SECOND test send 8 seconds later used to short-circuit
 * at selectTransport with MissingMailboxError -> 409 no_mailbox even though
 * the refresh token was healthy. The hot-patch removes that short-circuit, so
 * the second send now actually attempts Gmail and succeeds.
 *
 * Single test, six steps end-to-end:
 *   1. Seed org with M365 tokens + providerType=m365 + status=ok.
 *   2. DELETE /api/org/email-provider/oauth -> tokens cleared, providerType
 *      unchanged (matches current disconnect handler behavior).
 *   3. PUT /api/org/email-provider {providerType:"google"}.
 *   4. Mock the Google OAuth callback's effect: write Google tokens directly
 *      to the org row (providerType=google, refresh token, sender, status=ok).
 *   5. Mock Gmail to reject the FIRST send with HTTP 403 -> assert 502
 *      provider_error AND emailOauthStatus is now "needs_reconnect" (this is
 *      the gmail-transport.ts:209 marking we intentionally LEFT in place).
 *   6. Mock Gmail to ACCEPT the SECOND send -> assert 200 ok. This is the
 *      assertion that returned 409 no_mailbox before the patch.
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

import { encryptSmtpPassword } from "../../server/email";

const storedOrg: Record<string, any> = {
  id: "org-1",
  name: "Acme Co",
  emailProviderType: "smtp",
};

vi.mock("../../server/storage", () => ({
  storage: {
    getOrg: vi.fn(async (id: string) => (id === "org-1" ? storedOrg : null)),
    updateOrg: vi.fn(async (id: string, patch: Record<string, any>) => {
      if (id !== "org-1") return null;
      Object.assign(storedOrg, patch);
      return storedOrg;
    }),
    getUserById: vi.fn(async (_id: string) => ({
      id: "user-1",
      email: "u@example.com",
      isActive: true,
      role: "ADMIN",
    })),
  },
}));

// Suppress real DB writes from clearMailboxStatus, but make
// markMailboxNeedsReconnect actually mutate the in-memory org row so we can
// assert step 5 marked the flag and step 6 still succeeds despite it.
vi.mock("../../server/email/mailbox-status", () => ({
  isOauthAuthError: () => false,
  markMailboxNeedsReconnect: vi.fn(async () => {
    storedOrg.emailOauthStatus = "needs_reconnect";
    return { firstFailure: true, failedSendCount: 1 };
  }),
  clearMailboxStatus: vi.fn(async () => {
    storedOrg.emailOauthStatus = "ok";
  }),
}));

import { registerTestEmailRoutes, __resetTestEmailRateLimit } from "../../server/routes/test-email-routes";
import {
  __setEmailOauthEnabledForTests,
  __resetEmailOauthFlagForTests,
} from "../../server/email/feature-flag";

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
  registerTestEmailRoutes(app);
  return app;
}

beforeEach(async () => {
  __resetEmailOauthFlagForTests();
  __resetTestEmailRateLimit();
  Object.keys(storedOrg).forEach((k) => {
    if (k !== "id" && k !== "name") delete storedOrg[k];
  });
  storedOrg.emailProviderType = "smtp";
  global.fetch = realFetch;
  delete (global as any).__emailTestFetch;
  if (server) await new Promise<void>((r) => server.close(() => r()));
  const app = buildApp();
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, () => r()));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  global.fetch = realFetch;
  delete (global as any).__emailTestFetch;
  __resetEmailOauthFlagForTests();
  if (server) await new Promise<void>((r) => server.close(() => r()));
});

describe("provider-switch regression — Sprint 2g.10 hot-patch", () => {
  it("MS connect -> disconnect MS -> connect Google -> Gmail 403 marks needs_reconnect -> next send still succeeds (no false 409 no_mailbox)", async () => {
    __setEmailOauthEnabledForTests(true);

    // ── Step 1: seed an org with MS tokens, status ok.
    storedOrg.emailProviderType = "m365";
    storedOrg.emailOauthRefreshToken = encryptSmtpPassword("MS-RT-secret");
    storedOrg.emailOauthStatus = "ok";
    storedOrg.emailSenderAddress = "alice@acme.com";
    storedOrg.emailOauthConnectedAt = new Date("2026-04-20T13:48:00Z");
    storedOrg.emailOauthScopes = "https://graph.microsoft.com/Mail.Send offline_access";

    // ── Step 2: simulate DELETE /api/org/email-provider/oauth (the disconnect
    // handler in oauth-mailbox-routes.ts clears tokens but NOT providerType).
    storedOrg.emailOauthRefreshToken = null;
    storedOrg.emailOauthExpiresAt = null;
    storedOrg.emailOauthScopes = null;
    storedOrg.emailOauthConnectedAt = null;
    storedOrg.emailSenderAddress = null;
    expect(storedOrg.emailProviderType).toBe("m365"); // documents current behavior

    // ── Step 3: simulate PUT /api/org/email-provider {providerType:"google"}.
    storedOrg.emailProviderType = "google";

    // ── Step 4: simulate Google OAuth callback success — tokens persisted,
    // status cleared to ok, sender set.
    storedOrg.emailOauthRefreshToken = encryptSmtpPassword("G-RT-secret");
    storedOrg.emailOauthExpiresAt = new Date(Date.now() + 3600_000);
    storedOrg.emailOauthScopes = "https://www.googleapis.com/auth/gmail.send openid email";
    storedOrg.emailSenderAddress = "dunagan.dean@gmail.com";
    storedOrg.emailOauthConnectedAt = new Date();
    storedOrg.emailOauthStatus = "ok";

    // ── Step 5: first send — Gmail rejects with 403, transport marks
    // emailOauthStatus = "needs_reconnect". Refresh succeeds, send fails.
    let gmailCallCount = 0;
    (global as any).__emailTestFetch = vi.fn(async (input: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url === "https://oauth2.googleapis.com/token") {
        return new Response(
          JSON.stringify({ access_token: "AT", expires_in: 3600 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("gmail.googleapis.com")) {
        gmailCallCount++;
        if (gmailCallCount === 1) {
          // First call: 403 with non-auth-class body to mirror the real
          // 13:52:26 incident (logged as provider_error, not token_expired).
          return new Response(
            JSON.stringify({
              error: {
                code: 403,
                message: "Request had insufficient authentication scopes.",
              },
            }),
            { status: 403, headers: { "Content-Type": "application/json" } },
          );
        }
        // Second call: success.
        return new Response(JSON.stringify({ id: "gmail-msg-recovery" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    // Force a fresh access-token round-trip on each call so refresh actually
    // runs against our mock both times.
    const { invalidateCachedAccessToken } = await import(
      "../../server/email/oauth-token-cache"
    );

    invalidateCachedAccessToken("google:org-1");
    const r1 = await fetch(`${baseUrl}/api/email/test-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: "dean@cherrystconsulting.com" }),
    });
    expect(r1.status).toBe(502);
    const b1 = await r1.json();
    expect(b1.code).toBe("provider_error");
    expect(storedOrg.emailOauthStatus).toBe("needs_reconnect");

    // ── Step 6: second send — Gmail accepts. Pre-patch this would have been
    // 409 no_mailbox because selectTransport short-circuited on
    // status==="needs_reconnect". Post-patch: 200 ok.
    invalidateCachedAccessToken("google:org-1");
    const r2 = await fetch(`${baseUrl}/api/email/test-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: "dean@cherrystconsulting.com" }),
    });
    expect(r2.status).toBe(200);
    const b2 = await r2.json();
    expect(b2.ok).toBe(true);
    expect(b2.provider).toBe("google");
    expect(b2.providerMessageId).toBe("gmail-msg-recovery");
    // Status was NOT auto-cleared by the second successful send — only the
    // recovery probe (or a fresh OAuth callback) clears it. We just don't
    // short-circuit on it any more.
    expect(storedOrg.emailOauthStatus).toBe("needs_reconnect");
    expect(gmailCallCount).toBe(2);
  });
});
