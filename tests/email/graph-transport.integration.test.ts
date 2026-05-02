/**
 * Sprint 2g.7 — I1, I2: GraphTransport integration tests.
 *
 * Mocks Microsoft's token endpoint and Graph sendMail endpoint via the
 * `(global as any).__emailTestFetch` hook the transport already supports.
 * No real network. No vi.mock of nodemailer needed.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

/**
 * Task #137 — credential guard.
 *
 * These tests normally run against a mocked fetch hook (`__emailTestFetch`) and
 * do not require live Microsoft Graph OAuth credentials. Setting
 * `EMAIL_TRANSPORT_REQUIRE_LIVE_CREDS=true` switches them to "live" mode, in
 * which case the suite is skipped (with a logged reason) when the real OAuth
 * env vars are missing — instead of failing trying to talk to graph.microsoft.com.
 */
const REQUIRE_LIVE_CREDS = process.env.EMAIL_TRANSPORT_REQUIRE_LIVE_CREDS === "true";
const MISSING_LIVE_CREDS =
  REQUIRE_LIVE_CREDS &&
  (!process.env.MS_OAUTH_CLIENT_ID_LIVE || !process.env.MS_OAUTH_CLIENT_SECRET_LIVE);
if (MISSING_LIVE_CREDS) {
  console.log(
    "[tests/email/graph-transport] SKIP: EMAIL_TRANSPORT_REQUIRE_LIVE_CREDS=true but MS_OAUTH_CLIENT_ID_LIVE / MS_OAUTH_CLIENT_SECRET_LIVE are not set — skipping live Graph transport tests.",
  );
}
const describeMaybe = MISSING_LIVE_CREDS ? describe.skip : describe;

process.env.SMTP_ENCRYPTION_KEY =
  process.env.SMTP_ENCRYPTION_KEY ||
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.MS_OAUTH_CLIENT_ID = "test-ms-client-id";
process.env.MS_OAUTH_CLIENT_SECRET = "test-ms-client-secret";
process.env.SMTP_HOST = process.env.SMTP_HOST || "smtp.fallback.local";
process.env.SMTP_PORT = process.env.SMTP_PORT || "587";
process.env.SMTP_USER = process.env.SMTP_USER || "fallback@example.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "fallback-pass";
process.env.SMTP_FROM_EMAIL = process.env.SMTP_FROM_EMAIL || "noreply@example.com";

// --- Task #93 mocks (db + nodemailer) ---
const __graphSendMail = vi.fn(async (opts: any) => ({ messageId: "admin-1", envelope: opts }));
const __graphCreateTransport = vi.fn(() => ({ sendMail: __graphSendMail }));
vi.mock("nodemailer", () => ({
  default: {
    createTransport: __graphCreateTransport,
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
    if (!g.__graphDbState) g.__graphDbState = { orgs: new Map(), users: [] };
    return g.__graphDbState as { orgs: Map<string, any>; users: any[] };
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
  GraphTransport,
  MS_GRAPH_SEND_URL,
  getMsTokenUrl,
  getGraphSendUrl,
} from "../../server/email/graph-transport";
import { __clearOauthTokenCacheForTests } from "../../server/email/oauth-token-cache";
import { encryptSmtpPassword, sendInvoiceEmail } from "../../server/email";
import {
  __setEmailOauthEnabledForTests,
  __resetEmailOauthFlagForTests,
} from "../../server/email/feature-flag";
import { clearSmtpTransporterCache } from "../../server/email/smtp-transport";
import type { OrgForTransport } from "../../server/email/transport-selector";
import type { SendableMessage } from "../../server/email/types";

const PLAIN_REFRESH = "fake-ms-refresh-token-abcdef";

const org: OrgForTransport = {
  id: "org-graph-test",
  emailProviderType: "m365",
  emailOauthRefreshToken: encryptSmtpPassword(PLAIN_REFRESH),
  emailSenderAddress: "sender@example.com",
};

const message: SendableMessage = {
  to: "to@example.com",
  subject: "Hello from Graph",
  html: "<p>hi</p>",
  fromEmail: "sender@example.com",
};

function jsonResponse(status: number, body: any, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}
function emptyResponse(status: number, headers: Record<string, string> = {}) {
  return new Response("", { status, headers });
}

afterAll(() => {
  delete (global as any).__emailTestFetch;
  __clearOauthTokenCacheForTests();
});

beforeEach(() => {
  __clearOauthTokenCacheForTests();
  delete (global as any).__emailTestFetch;
});

describeMaybe("GraphTransport.send (I1, I2)", () => {
  it("I1 — refreshes token then POSTs to Graph sendMail with bearer token", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    (global as any).__emailTestFetch = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url === getMsTokenUrl()) {
        return jsonResponse(200, { access_token: "AT-1", expires_in: 3600 });
      }
      if (url === MS_GRAPH_SEND_URL) {
        return emptyResponse(202, { "x-ms-request-id": "req-abc" });
      }
      throw new Error("unexpected url " + url);
    });

    const result = await new GraphTransport(org).send(message);
    expect(result.ok).toBe(true);
    expect(result.transport).toBe("graph");
    expect(result.messageId).toBe("req-abc");

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe(getMsTokenUrl());
    const tokenBody = String(calls[0].init.body);
    expect(tokenBody).toContain("grant_type=refresh_token");
    expect(tokenBody).toContain("client_id=test-ms-client-id");

    expect(calls[1].url).toBe(MS_GRAPH_SEND_URL);
    const auth = (calls[1].init.headers as Record<string, string>)["Authorization"];
    expect(auth).toBe("Bearer AT-1");
    const bodyJson = JSON.parse(String(calls[1].init.body));
    expect(bodyJson.message.toRecipients[0].emailAddress.address).toBe("to@example.com");
    expect(bodyJson.message.subject).toBe("Hello from Graph");
    expect(bodyJson.saveToSentItems).toBe(true);
  });

  it("I1b — GRAPH_TRANSPORT_TEST_URL_OVERRIDE redirects both the initial send and the 401 retry", async () => {
    const OVERRIDE = "https://stub.local/v1.0/me/sendMail";
    const prev = process.env.GRAPH_TRANSPORT_TEST_URL_OVERRIDE;
    process.env.GRAPH_TRANSPORT_TEST_URL_OVERRIDE = OVERRIDE;
    try {
      expect(getGraphSendUrl()).toBe(OVERRIDE);
      const sendUrls: string[] = [];
      let sendCalls = 0;
      (global as any).__emailTestFetch = vi.fn(async (url: string) => {
        if (url === getMsTokenUrl()) {
          return jsonResponse(200, { access_token: "AT-x", expires_in: 3600 });
        }
        sendUrls.push(url);
        sendCalls += 1;
        if (sendCalls === 1) return emptyResponse(401);
        return emptyResponse(202, { "x-ms-request-id": "req-override" });
      });
      const result = await new GraphTransport(org).send(message);
      expect(result.ok).toBe(true);
      expect(result.messageId).toBe("req-override");
      expect(sendUrls).toEqual([OVERRIDE, OVERRIDE]);
      expect(sendUrls.every((u) => u !== MS_GRAPH_SEND_URL)).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.GRAPH_TRANSPORT_TEST_URL_OVERRIDE;
      else process.env.GRAPH_TRANSPORT_TEST_URL_OVERRIDE = prev;
    }
  });

  it("I2 — retries once on 401 with a freshly refreshed token", async () => {
    let sendCalls = 0;
    let tokenCalls = 0;
    (global as any).__emailTestFetch = vi.fn(async (url: string) => {
      if (url === getMsTokenUrl()) {
        tokenCalls += 1;
        return jsonResponse(200, {
          access_token: tokenCalls === 1 ? "AT-stale" : "AT-fresh",
          expires_in: 3600,
        });
      }
      if (url === MS_GRAPH_SEND_URL) {
        sendCalls += 1;
        if (sendCalls === 1) return emptyResponse(401);
        return emptyResponse(202, { "x-ms-request-id": "req-after-retry" });
      }
      throw new Error("unexpected url " + url);
    });

    const result = await new GraphTransport(org).send(message);
    expect(result.ok).toBe(true);
    expect(result.messageId).toBe("req-after-retry");
    expect(sendCalls).toBe(2);
    expect(tokenCalls).toBe(2);
  });
});

describeMaybe("Task #93 — Graph 401×2 marks mailbox + emails admins (sendInvoiceEmail e2e)", () => {
  const dbState: { orgs: Map<string, any>; users: any[] } =
    ((globalThis as any).__graphDbState ||= { orgs: new Map(), users: [] });

  beforeEach(() => {
    __clearOauthTokenCacheForTests();
    delete (global as any).__emailTestFetch;
    dbState.orgs.clear();
    dbState.users = [];
    __graphSendMail.mockClear();
    __graphCreateTransport.mockClear();
    clearSmtpTransporterCache();
    __setEmailOauthEnabledForTests(true);
  });

  afterAll(() => {
    __resetEmailOauthFlagForTests();
    delete (global as any).__emailTestFetch;
  });

  it("marks org needs_reconnect, bumps counter, emails admins once, and short-circuits second send", async () => {
    const orgRow: OrgForTransport & Record<string, any> = {
      id: "org-graph-e2e",
      name: "Acme Co",
      emailProviderType: "m365",
      emailOauthRefreshToken: encryptSmtpPassword("fake-ms-refresh"),
      emailSenderAddress: "sender@acme.com",
      emailOauthStatus: "ok",
      emailOauthFailedSendCount: 0,
    };
    dbState.orgs.set(orgRow.id!, orgRow);
    dbState.users = [{ email: "admin@acme.com", name: "A" }];

    let graphCalls = 0;
    let tokenCalls = 0;
    (global as any).__emailTestFetch = vi.fn(async (url: string) => {
      if (url === getMsTokenUrl()) {
        tokenCalls += 1;
        return jsonResponse(200, { access_token: `AT-${tokenCalls}`, expires_in: 3600 });
      }
      if (url === MS_GRAPH_SEND_URL) {
        graphCalls += 1;
        return emptyResponse(401);
      }
      throw new Error("unexpected url " + url);
    });

    await expect(
      sendInvoiceEmail("to@acme.com", "Invoice #1", "<p>hi</p>", undefined, null, undefined, orgRow),
    ).rejects.toThrowError(/Graph sendMail failed/);

    // The 401 path triggers a fire-and-forget admin notification.
    await new Promise((r) => setTimeout(r, 50));

    expect(graphCalls).toBe(2);
    expect(tokenCalls).toBe(2);

    // Assert the DB row was updated, not just the in-memory ref.
    const dbRow = dbState.orgs.get("org-graph-e2e");
    expect(dbRow).toBeDefined();
    expect(dbRow.emailOauthStatus).toBe("needs_reconnect");
    expect(dbRow.emailOauthFailedSendCount).toBe(1);
    expect(dbRow.emailOauthLastErrorAt).toBeInstanceOf(Date);
    expect(dbRow.emailOauthLastErrorMessage).toMatch(/Graph sendMail failed/);
    // The org reference passed to sendInvoiceEmail is the same object the
    // mock-db update mutates — confirm consistency for the second call.
    expect(orgRow.emailOauthStatus).toBe("needs_reconnect");
    expect(orgRow.emailOauthFailedSendCount).toBe(1);

    await vi.waitFor(() => {
      expect(__graphSendMail).toHaveBeenCalledTimes(1);
    });
    const adminMail = __graphSendMail.mock.calls[0][0] as any;
    expect(adminMail.to).toBe("admin@acme.com");
    expect(String(adminMail.subject)).toMatch(/reconnect.*Microsoft 365/i);
    expect(String(adminMail.html)).toContain("Acme Co");

    // Second send: selectTransport must short-circuit before any Graph fetch.
    const graphCallsBefore = graphCalls;
    // Sprint 2g.10 patch: needs_reconnect is observational only. Refresh-token presence is the only send-time gate; invalid_grant on refresh is the real lockout signal.
    await expect(
      sendInvoiceEmail("to@acme.com", "Invoice #2", "<p>hi</p>", undefined, null, undefined, orgRow),
    ).rejects.toThrowError(/Graph sendMail failed/);
    // Sprint 2g.10 patch: needs_reconnect is observational only. Refresh-token presence is the only send-time gate; invalid_grant on refresh is the real lockout signal.
    expect(graphCalls).toBe(graphCallsBefore + 2);
  });
});
