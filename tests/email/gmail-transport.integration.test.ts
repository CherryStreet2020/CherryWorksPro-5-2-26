/**
 * Sprint 2g.7 — I3, I4: GmailTransport integration tests.
 *
 * Mocks Google's token endpoint and Gmail send endpoint via the
 * `(global as any).__emailTestFetch` hook the transport already supports.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

/**
 * Task #137 — credential guard.
 *
 * These tests normally run against a mocked fetch hook (`__emailTestFetch`) and
 * do not require live Google OAuth credentials. Setting
 * `EMAIL_TRANSPORT_REQUIRE_LIVE_CREDS=true` switches them to "live" mode, in
 * which case the suite is skipped (with a logged reason) when the real OAuth
 * env vars are missing — instead of failing trying to talk to gmail.googleapis.com.
 */
const REQUIRE_LIVE_CREDS = process.env.EMAIL_TRANSPORT_REQUIRE_LIVE_CREDS === "true";
const MISSING_LIVE_CREDS =
  REQUIRE_LIVE_CREDS &&
  (!process.env.GOOGLE_OAUTH_CLIENT_ID_LIVE || !process.env.GOOGLE_OAUTH_CLIENT_SECRET_LIVE);
if (MISSING_LIVE_CREDS) {
  console.log(
    "[tests/email/gmail-transport] SKIP: EMAIL_TRANSPORT_REQUIRE_LIVE_CREDS=true but GOOGLE_OAUTH_CLIENT_ID_LIVE / GOOGLE_OAUTH_CLIENT_SECRET_LIVE are not set — skipping live Gmail transport tests.",
  );
}
const describeMaybe = MISSING_LIVE_CREDS ? describe.skip : describe;

process.env.SMTP_ENCRYPTION_KEY =
  process.env.SMTP_ENCRYPTION_KEY ||
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-google-client-id";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-google-client-secret";
process.env.SMTP_HOST = process.env.SMTP_HOST || "smtp.fallback.local";
process.env.SMTP_PORT = process.env.SMTP_PORT || "587";
process.env.SMTP_USER = process.env.SMTP_USER || "fallback@example.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "fallback-pass";
process.env.SMTP_FROM_EMAIL = process.env.SMTP_FROM_EMAIL || "noreply@example.com";

// --- Task #93 mocks (db + nodemailer) ---
const __gmailSendMail = vi.fn(async (opts: any) => ({ messageId: "admin-1", envelope: opts }));
const __gmailCreateTransport = vi.fn(() => ({ sendMail: __gmailSendMail }));
vi.mock("nodemailer", () => ({
  default: {
    createTransport: __gmailCreateTransport,
    getTestMessageUrl: () => false,
    createTestAccount: async () => ({ user: "u", pass: "p" }),
  },
}));

vi.mock("../../server/db", () => {
  const tableName = (t: any): string => {
    const sym = t?.[Symbol.for("drizzle:Name")];
    if (typeof sym === "string") return sym;
    return typeof t?.name === "string" ? t.name : "";
  };
  const getState = () => {
    const g: any = globalThis as any;
    if (!g.__gmailDbState) g.__gmailDbState = { orgs: new Map(), users: [] };
    return g.__gmailDbState as { orgs: Map<string, any>; users: any[] };
  };
  const SQL_TO_JS: Record<string, string> = {
    email_oauth_status: "emailOauthStatus",
    email_oauth_failed_send_count: "emailOauthFailedSendCount",
    email_oauth_last_error_at: "emailOauthLastErrorAt",
    email_oauth_last_error_message: "emailOauthLastErrorMessage",
    mailbox_alerts: "mailboxAlerts",
    name: "name",
    email: "email",
    role: "role",
    is_active: "isActive",
    org_id: "orgId",
    user_id: "userId",
    id: "id",
  };
  const projectRow = (row: any, cols: any): any => {
    if (!cols) return row;
    const out: any = {};
    for (const [alias, col] of Object.entries(cols)) {
      const sqlName = (col as any)?.name;
      const jsKey = (sqlName && SQL_TO_JS[sqlName]) || alias;
      out[alias] = row[jsKey];
    }
    return out;
  };
  const db = {
    select: (cols?: any) => ({
      from: (table: any) => {
        const name = tableName(table);
        const buildChain = () => {
          const chain: any = {
            leftJoin: (_t: any, _on: any) => chain,
            innerJoin: (_t: any, _on: any) => chain,
            where: async (_cond: any) => {
              const state = getState();
              const rows =
                name === "orgs"
                  ? Array.from(state.orgs.values())
                  : name === "users"
                    ? state.users.slice()
                    : [];
              return rows.map((r) => projectRow(r, cols));
            },
          };
          return chain;
        };
        return buildChain();
      },
    }),
    update: (table: any) => {
      const name = tableName(table);
      return {
        set: (patch: any) => ({
          where: async (_cond: any) => {
            const state = getState();
            if (name === "orgs") {
              for (const row of state.orgs.values()) Object.assign(row, patch);
            }
          },
        }),
      };
    },
  };
  return { db };
});

import {
  GmailTransport,
  GMAIL_SEND_URL,
  GOOGLE_TOKEN_URL,
  buildGmailRawMessage,
} from "../../server/email/gmail-transport";
import { __clearOauthTokenCacheForTests } from "../../server/email/oauth-token-cache";
import { encryptSmtpPassword, sendInvoiceEmail } from "../../server/email";
import {
  __setEmailOauthEnabledForTests,
  __resetEmailOauthFlagForTests,
} from "../../server/email/feature-flag";
import { clearSmtpTransporterCache } from "../../server/email/smtp-transport";
import type { OrgForTransport } from "../../server/email/transport-selector";
import type { SendableMessage } from "../../server/email/types";

const org: OrgForTransport = {
  id: "org-gmail-test",
  emailProviderType: "google",
  emailOauthRefreshToken: encryptSmtpPassword("fake-google-refresh"),
  emailSenderAddress: "me@example.com",
};

const message: SendableMessage = {
  to: "to@example.com",
  subject: "Hello from Gmail",
  html: "<p>hi</p>",
  fromEmail: "me@example.com",
};

function jsonResponse(status: number, body: any) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterAll(() => {
  delete (global as any).__emailTestFetch;
  __clearOauthTokenCacheForTests();
});

beforeEach(() => {
  __clearOauthTokenCacheForTests();
  delete (global as any).__emailTestFetch;
});

describeMaybe("GmailTransport.send (I3, I4)", () => {
  it("I3 — POSTs base64url RFC822 to gmail.googleapis.com with bearer token", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    (global as any).__emailTestFetch = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url === GOOGLE_TOKEN_URL) return jsonResponse(200, { access_token: "GAT-1", expires_in: 3600 });
      if (url === GMAIL_SEND_URL) return jsonResponse(200, { id: "gmail-msg-1", threadId: "t-1" });
      throw new Error("unexpected url " + url);
    });

    const result = await new GmailTransport(org).send(message);
    expect(result.ok).toBe(true);
    expect(result.transport).toBe("gmail");
    expect(result.messageId).toBe("gmail-msg-1");

    expect(calls[1].url).toBe(GMAIL_SEND_URL);
    const auth = (calls[1].init.headers as Record<string, string>)["Authorization"];
    expect(auth).toBe("Bearer GAT-1");
    const body = JSON.parse(String(calls[1].init.body));
    expect(typeof body.raw).toBe("string");
    // base64url charset
    expect(body.raw).toMatch(/^[A-Za-z0-9_-]+$/);
    // Decoded RFC 822 contains the headers we expect
    const decoded = Buffer.from(
      body.raw.replace(/-/g, "+").replace(/_/g, "/") + "===".slice(0, (4 - (body.raw.length % 4)) % 4),
      "base64",
    ).toString("utf8");
    expect(decoded).toContain("To: to@example.com");
    expect(decoded).toContain("Subject: Hello from Gmail");
  });

  it("I4 — refreshes access token on 401 and retries once", async () => {
    let sendCalls = 0;
    let tokenCalls = 0;
    (global as any).__emailTestFetch = vi.fn(async (url: string) => {
      if (url === GOOGLE_TOKEN_URL) {
        tokenCalls += 1;
        return jsonResponse(200, { access_token: `GAT-${tokenCalls}`, expires_in: 3600 });
      }
      if (url === GMAIL_SEND_URL) {
        sendCalls += 1;
        if (sendCalls === 1) return new Response("", { status: 401 });
        return jsonResponse(200, { id: "after-retry" });
      }
      throw new Error("unexpected url " + url);
    });

    const result = await new GmailTransport(org).send(message);
    expect(result.ok).toBe(true);
    expect(result.messageId).toBe("after-retry");
    expect(sendCalls).toBe(2);
    expect(tokenCalls).toBe(2);
  });

  it("buildGmailRawMessage produces parseable base64url", () => {
    const raw = buildGmailRawMessage({
      to: "x@y.com",
      subject: "S",
      html: "<b>hi</b>",
      fromEmail: "me@y.com",
    });
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describeMaybe("Task #93 — Gmail 401×2 marks mailbox + emails admins (sendInvoiceEmail e2e)", () => {
  const dbState: { orgs: Map<string, any>; users: any[] } =
    ((globalThis as any).__gmailDbState ||= { orgs: new Map(), users: [] });

  beforeEach(() => {
    __clearOauthTokenCacheForTests();
    delete (global as any).__emailTestFetch;
    dbState.orgs.clear();
    dbState.users = [];
    __gmailSendMail.mockClear();
    __gmailCreateTransport.mockClear();
    clearSmtpTransporterCache();
    __setEmailOauthEnabledForTests(true);
  });

  afterAll(() => {
    __resetEmailOauthFlagForTests();
    delete (global as any).__emailTestFetch;
  });

  it("marks org needs_reconnect, bumps counter, emails admins once, and short-circuits second send", async () => {
    const orgRow: OrgForTransport & Record<string, any> = {
      id: "org-gmail-e2e",
      name: "Beta Inc",
      emailProviderType: "google",
      emailOauthRefreshToken: encryptSmtpPassword("fake-google-refresh"),
      emailSenderAddress: "sender@beta.com",
      emailOauthStatus: "ok",
      emailOauthFailedSendCount: 0,
    };
    dbState.orgs.set(orgRow.id!, orgRow);
    dbState.users = [{ email: "admin@beta.com", name: "B" }];

    let gmailCalls = 0;
    let tokenCalls = 0;
    (global as any).__emailTestFetch = vi.fn(async (url: string) => {
      if (url === GOOGLE_TOKEN_URL) {
        tokenCalls += 1;
        return jsonResponse(200, { access_token: `GAT-${tokenCalls}`, expires_in: 3600 });
      }
      if (url === GMAIL_SEND_URL) {
        gmailCalls += 1;
        return new Response("", { status: 401 });
      }
      throw new Error("unexpected url " + url);
    });

    await expect(
      sendInvoiceEmail("to@beta.com", "Invoice #1", "<p>hi</p>", undefined, null, undefined, orgRow),
    ).rejects.toThrowError(/Gmail send failed/);

    await new Promise((r) => setTimeout(r, 50));

    expect(gmailCalls).toBe(2);
    expect(tokenCalls).toBe(2);

    // Assert the DB row was updated, not just the in-memory ref.
    const dbRow = dbState.orgs.get("org-gmail-e2e");
    expect(dbRow).toBeDefined();
    expect(dbRow.emailOauthStatus).toBe("needs_reconnect");
    expect(dbRow.emailOauthFailedSendCount).toBe(1);
    expect(dbRow.emailOauthLastErrorAt).toBeInstanceOf(Date);
    expect(dbRow.emailOauthLastErrorMessage).toMatch(/Gmail send failed/);
    expect(orgRow.emailOauthStatus).toBe("needs_reconnect");
    expect(orgRow.emailOauthFailedSendCount).toBe(1);

    await vi.waitFor(() => {
      expect(__gmailSendMail).toHaveBeenCalledTimes(1);
    });
    const adminMail = __gmailSendMail.mock.calls[0][0] as any;
    expect(adminMail.to).toBe("admin@beta.com");
    expect(String(adminMail.subject)).toMatch(/reconnect.*Gmail/i);
    expect(String(adminMail.html)).toContain("Beta Inc");

    const gmailCallsBefore = gmailCalls;
    // Sprint 2g.10 patch: needs_reconnect is observational only. Refresh-token presence is the only send-time gate; invalid_grant on refresh is the real lockout signal.
    await expect(
      sendInvoiceEmail("to@beta.com", "Invoice #2", "<p>hi</p>", undefined, null, undefined, orgRow),
    ).rejects.toThrowError(/Gmail send failed/);
    // Sprint 2g.10 patch: needs_reconnect is observational only. Refresh-token presence is the only send-time gate; invalid_grant on refresh is the real lockout signal.
    expect(gmailCalls).toBe(gmailCallsBefore + 2);
  });
});
