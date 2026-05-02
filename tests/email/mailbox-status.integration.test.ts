/**
 * Task #93 — mailbox-status integration coverage.
 *
 * Exercises `markMailboxNeedsReconnect`, `clearMailboxStatus`, and
 * `isOauthAuthError` against an in-memory drizzle/db stub plus a mocked
 * env-SMTP transporter. Locks the contract that:
 *
 *   - the FIRST failure flips emailOauthStatus → 'needs_reconnect',
 *     bumps the failed-send counter, and emails active admins exactly once
 *     per active org via the env SMTP fallback transporter;
 *   - subsequent failures only bump the counter (no admin email re-spam);
 *   - clearMailboxStatus resets the row back to OK with count=0;
 *   - isOauthAuthError matches the auth-class strings the transports raise.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

process.env.SMTP_ENCRYPTION_KEY =
  process.env.SMTP_ENCRYPTION_KEY ||
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.SMTP_HOST = process.env.SMTP_HOST || "smtp.fallback.local";
process.env.SMTP_PORT = process.env.SMTP_PORT || "587";
process.env.SMTP_USER = process.env.SMTP_USER || "fallback@example.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "fallback-pass";
process.env.SMTP_FROM_EMAIL = process.env.SMTP_FROM_EMAIL || "noreply@example.com";

(globalThis as any).__mbStatusDbState ||= { orgs: new Map<string, any>(), users: [] as any[] };
const dbState: { orgs: Map<string, any>; users: any[] } = (globalThis as any).__mbStatusDbState;

const sendMailMock = vi.fn(async (opts: any) => ({ messageId: "admin-msg-1", envelope: opts }));
const createTransportMock = vi.fn(() => ({ sendMail: sendMailMock }));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: createTransportMock,
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
    if (!g.__mbStatusDbState) g.__mbStatusDbState = { orgs: new Map(), users: [] };
    return g.__mbStatusDbState as { orgs: Map<string, any>; users: any[] };
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
  markMailboxNeedsReconnect,
  clearMailboxStatus,
  isOauthAuthError,
} from "../../server/email/mailbox-status";
import { clearSmtpTransporterCache } from "../../server/email/smtp-transport";

async function flushFireAndForget(): Promise<void> {
  await new Promise((r) => setTimeout(r, 30));
}

beforeEach(() => {
  dbState.orgs.clear();
  dbState.users = [];
  sendMailMock.mockClear();
  createTransportMock.mockClear();
  clearSmtpTransporterCache();
});

afterAll(() => {
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.SMTP_FROM_EMAIL;
});

describe("mailbox-status (Task #93 integration)", () => {
  it("first failure marks needs_reconnect, bumps counter to 1, and emails admins once", async () => {
    dbState.orgs.set("org-1", {
      id: "org-1",
      name: "Acme Co",
      emailOauthStatus: "ok",
      emailOauthFailedSendCount: 0,
    });
    dbState.users = [
      { email: "admin1@acme.com", name: "A1" },
      { email: "admin2@acme.com", name: "A2" },
    ];

    const r = await markMailboxNeedsReconnect({
      orgId: "org-1",
      providerType: "m365",
      errorMessage: "Graph sendMail failed (401): unauthorized_client",
    });
    await flushFireAndForget();

    expect(r.firstFailure).toBe(true);
    expect(r.failedSendCount).toBe(1);

    const org = dbState.orgs.get("org-1");
    expect(org.emailOauthStatus).toBe("needs_reconnect");
    expect(org.emailOauthFailedSendCount).toBe(1);
    expect(org.emailOauthLastErrorAt).toBeInstanceOf(Date);
    expect(org.emailOauthLastErrorMessage).toContain("Graph sendMail failed");

    expect(sendMailMock).toHaveBeenCalledTimes(2);
    const recipients = sendMailMock.mock.calls.map((c: any[]) => c[0].to);
    expect(recipients.sort()).toEqual(["admin1@acme.com", "admin2@acme.com"]);
    const subj = String(sendMailMock.mock.calls[0][0].subject);
    expect(subj).toMatch(/reconnect.*Microsoft 365/i);
    const html = String(sendMailMock.mock.calls[0][0].html);
    expect(html).toContain("Acme Co");
    expect(html).toContain("Microsoft 365 mailbox disconnected");
  });

  it("second failure within the same needs_reconnect window does not re-spam admins", async () => {
    dbState.orgs.set("org-2", {
      id: "org-2",
      name: "Beta Inc",
      emailOauthStatus: "ok",
      emailOauthFailedSendCount: 0,
    });
    dbState.users = [{ email: "admin@beta.com", name: "B" }];

    await markMailboxNeedsReconnect({
      orgId: "org-2",
      providerType: "google",
      errorMessage: "Gmail send failed (401): invalid_grant",
    });
    await flushFireAndForget();
    expect(sendMailMock).toHaveBeenCalledTimes(1);

    const r2 = await markMailboxNeedsReconnect({
      orgId: "org-2",
      providerType: "google",
      errorMessage: "Gmail send failed (401): invalid_grant (retry)",
    });
    await flushFireAndForget();

    expect(r2.firstFailure).toBe(false);
    expect(r2.failedSendCount).toBe(2);
    expect(dbState.orgs.get("org-2").emailOauthFailedSendCount).toBe(2);
    // Still exactly one admin notification across both failures.
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it("clearMailboxStatus resets status + counter (preserving lastErrorAt as cooldown anchor)", async () => {
    const lastErrorAt = new Date(Date.now() - 60_000);
    dbState.orgs.set("org-3", {
      id: "org-3",
      name: "Gamma",
      emailOauthStatus: "needs_reconnect",
      emailOauthFailedSendCount: 7,
      emailOauthLastErrorAt: lastErrorAt,
      emailOauthLastErrorMessage: "stale",
    });

    await clearMailboxStatus("org-3");

    const org = dbState.orgs.get("org-3");
    expect(org.emailOauthStatus).toBe("ok");
    expect(org.emailOauthFailedSendCount).toBe(0);
    expect(org.emailOauthLastErrorMessage).toBeNull();
    // Intentionally preserved so the 24h reconnect-notification cooldown
    // survives a reconnect attempt.
    expect(org.emailOauthLastErrorAt).toEqual(lastErrorAt);
  });

  it("isOauthAuthError matches the auth-class strings the transports raise", () => {
    expect(isOauthAuthError("Graph sendMail failed (401): unauthorized_client")).toBe(true);
    expect(isOauthAuthError("Token refresh failed (400): invalid_grant")).toBe(true);
    expect(isOauthAuthError("AADSTS70008: refresh token expired")).toBe(true);
    expect(isOauthAuthError("consent_required for tenant")).toBe(true);
    expect(isOauthAuthError("")).toBe(false);
    expect(isOauthAuthError("Network timeout after 30s")).toBe(false);
    expect(isOauthAuthError("Graph sendMail failed (503): backend down")).toBe(false);
  });
});
