/**
 * Sprint 2g.10 — happy-path tests for POST /api/email/test-send.
 *
 * One test per provider (m365, google, smtp). Auth-guard / zod / tenant
 * isolation are covered by existing oauth-mailbox-routes tests and the
 * shared requireAuth middleware.
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
    getUserById: vi.fn(async (_id: string) => ({
      id: "user-1",
      email: "u@example.com",
      isActive: true,
      role: "ADMIN",
    })),
  },
}));

// Suppress real DB writes from markMailboxNeedsReconnect / clearMailboxStatus.
vi.mock("../../server/email/mailbox-status", () => ({
  isOauthAuthError: () => false,
  markMailboxNeedsReconnect: vi.fn(async () => ({ firstFailure: false, failedSendCount: 0 })),
  clearMailboxStatus: vi.fn(async () => {}),
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

describe("POST /api/email/test-send — happy paths", () => {
  it("m365 — exchanges refresh token, posts to Graph, returns ok", async () => {
    __setEmailOauthEnabledForTests(true);
    storedOrg.emailProviderType = "m365";
    storedOrg.emailOauthRefreshToken = encryptSmtpPassword("MS-RT-secret");
    storedOrg.emailOauthStatus = "ok";
    storedOrg.emailSenderAddress = "alice@acme.com";

    const calls: Array<{ url: string; body?: string }> = [];
    (global as any).__emailTestFetch = vi.fn(async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input.url;
      calls.push({ url, body: init?.body });
      if (url.includes("login.microsoftonline.com")) {
        return new Response(
          JSON.stringify({ access_token: "AT", expires_in: 3600 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("graph.microsoft.com")) {
        return new Response("", {
          status: 202,
          headers: { "x-ms-request-id": "graph-msg-1" },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const r = await fetch(`${baseUrl}/api/email/test-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: "dean@cherrystconsulting.com" }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.provider).toBe("m365");
    expect(body.providerMessageId).toBe("graph-msg-1");
    expect(calls.some((c) => c.url.includes("graph.microsoft.com"))).toBe(true);
  });

  it("google — exchanges refresh token, posts to Gmail, returns ok", async () => {
    __setEmailOauthEnabledForTests(true);
    storedOrg.emailProviderType = "google";
    storedOrg.emailOauthRefreshToken = encryptSmtpPassword("G-RT-secret");
    storedOrg.emailOauthStatus = "ok";
    storedOrg.emailSenderAddress = "bob@acme.com";

    (global as any).__emailTestFetch = vi.fn(async (input: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url === "https://oauth2.googleapis.com/token") {
        return new Response(
          JSON.stringify({ access_token: "AT", expires_in: 3600 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("gmail.googleapis.com")) {
        return new Response(JSON.stringify({ id: "gmail-msg-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const r = await fetch(`${baseUrl}/api/email/test-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: "dean@cherrystconsulting.com" }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.provider).toBe("google");
    expect(body.providerMessageId).toBe("gmail-msg-1");
  });

  it("oauth_disabled — m365 returns 503 with code when EMAIL_OAUTH_ENABLED=false", async () => {
    __setEmailOauthEnabledForTests(false);
    storedOrg.emailProviderType = "m365";
    storedOrg.emailOauthRefreshToken = encryptSmtpPassword("MS-RT-secret");
    storedOrg.emailOauthStatus = "ok";
    storedOrg.emailSenderAddress = "alice@acme.com";

    const r = await fetch(`${baseUrl}/api/email/test-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: "dean@cherrystconsulting.com" }),
    });
    expect(r.status).toBe(503);
    const body = await r.json();
    expect(body.code).toBe("oauth_disabled");
    expect(body.ok).toBe(false);
  });

  it("rate_limited — 11th send within an hour returns 429 with Retry-After", async () => {
    __setEmailOauthEnabledForTests(true);
    storedOrg.emailProviderType = "smtp";
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_USER = "smtp-user";
    process.env.SMTP_PASS = "smtp-pass";

    const sendMail = vi.fn(async () => ({ messageId: "msg" }));
    vi.doMock("nodemailer", () => ({
      default: {
        createTransport: () => ({ sendMail }),
        getTestMessageUrl: () => null,
        createTestAccount: async () => ({ user: "x", pass: "y" }),
      },
    }));
    const { clearSmtpTransporterCache } = await import("../../server/email/smtp-transport");
    clearSmtpTransporterCache();

    for (let i = 0; i < 10; i++) {
      const r = await fetch(`${baseUrl}/api/email/test-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: "dean@cherrystconsulting.com" }),
      });
      expect(r.status).toBe(200);
    }
    const r11 = await fetch(`${baseUrl}/api/email/test-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: "dean@cherrystconsulting.com" }),
    });
    expect(r11.status).toBe(429);
    expect(r11.headers.get("retry-after")).not.toBeNull();
    const body = await r11.json();
    expect(body.code).toBe("rate_limited");
  });

  it("smtp — uses nodemailer transport (mocked), returns ok", async () => {
    __setEmailOauthEnabledForTests(true);
    storedOrg.emailProviderType = "smtp";
    // SMTP env vars + a mocked nodemailer createTransport
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_USER = "smtp-user";
    process.env.SMTP_PASS = "smtp-pass";

    const sendMail = vi.fn(async () => ({ messageId: "smtp-msg-1" }));
    vi.doMock("nodemailer", () => ({
      default: {
        createTransport: () => ({ sendMail }),
        getTestMessageUrl: () => null,
        createTestAccount: async () => ({ user: "x", pass: "y" }),
      },
    }));
    // Bust the SmtpTransport's module-level transporter cache so the mock is picked up.
    const { clearSmtpTransporterCache } = await import("../../server/email/smtp-transport");
    clearSmtpTransporterCache();

    const r = await fetch(`${baseUrl}/api/email/test-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: "dean@cherrystconsulting.com" }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.provider).toBe("smtp");
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0].to).toBe("dean@cherrystconsulting.com");
    expect(sendMail.mock.calls[0][0].subject).toContain("Acme Co");
  });
});
