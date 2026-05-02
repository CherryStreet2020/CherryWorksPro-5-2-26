/**
 * Sprint 2g.7 — E2: end-to-end Graph send through GRAPH_TRANSPORT_TEST_URL_OVERRIDE.
 *
 * Drives the real `sendInvoiceEmail()` entrypoint with EMAIL_OAUTH_ENABLED=true
 * and an org configured for provider=m365 (encrypted refresh token in place).
 * Sets GRAPH_TRANSPORT_TEST_URL_OVERRIDE so the stubbed Graph endpoint stands
 * in for the real `https://graph.microsoft.com/v1.0/me/sendMail` URL, then
 * asserts the stub was actually called by the production send pipeline. This
 * proves: feature flag → transport selector → GraphTransport → override URL.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

process.env.SMTP_ENCRYPTION_KEY =
  process.env.SMTP_ENCRYPTION_KEY ||
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.MS_OAUTH_CLIENT_ID = "test-ms-client-id";
process.env.MS_OAUTH_CLIENT_SECRET = "test-ms-client-secret";

import { sendInvoiceEmail, encryptSmtpPassword } from "../../server/email";
import {
  __setEmailOauthEnabledForTests,
  __resetEmailOauthFlagForTests,
} from "../../server/email/feature-flag";
import { getMsTokenUrl, MS_GRAPH_SEND_URL } from "../../server/email/graph-transport";
import { __clearOauthTokenCacheForTests } from "../../server/email/oauth-token-cache";
import type { OrgForTransport } from "../../server/email/transport-selector";

const STUB_GRAPH_URL = "https://graph-stub.test.local/v1.0/me/sendMail";

const m365Org: OrgForTransport = {
  id: "org-e2",
  emailProviderType: "m365",
  emailOauthRefreshToken: encryptSmtpPassword("fake-ms-refresh-e2"),
  emailSenderAddress: "ceo@example.com",
};

beforeEach(() => {
  __clearOauthTokenCacheForTests();
  delete (global as any).__emailTestFetch;
  __setEmailOauthEnabledForTests(true);
  process.env.GRAPH_TRANSPORT_TEST_URL_OVERRIDE = STUB_GRAPH_URL;
});

afterAll(() => {
  delete (global as any).__emailTestFetch;
  delete process.env.GRAPH_TRANSPORT_TEST_URL_OVERRIDE;
  __resetEmailOauthFlagForTests();
  __clearOauthTokenCacheForTests();
});

describe("E2 — sendInvoiceEmail() routes through GRAPH_TRANSPORT_TEST_URL_OVERRIDE", () => {
  it("end-to-end: flag-on + provider=m365 → real send hits the stubbed Graph URL, never the production URL", async () => {
    const fetchCalls: { url: string; init?: RequestInit }[] = [];
    (global as any).__emailTestFetch = vi.fn(async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init });
      if (url === getMsTokenUrl()) {
        return new Response(
          JSON.stringify({ access_token: "AT-e2", expires_in: 3600 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url === STUB_GRAPH_URL) {
        return new Response("", { status: 202, headers: { "x-ms-request-id": "req-e2-stub" } });
      }
      throw new Error("E2 stub: unexpected fetch to " + url);
    });

    const result = await sendInvoiceEmail(
      "client@example.com",
      "Invoice INV-E2-001",
      "<p>Please find attached invoice INV-E2-001.</p>",
      Buffer.from("%PDF-1.4 fake-pdf"),
      null,
      undefined,
      m365Org,
    );

    expect(result.messageId).toBe("req-e2-stub");

    const sendUrlsHit = fetchCalls.map((c) => c.url).filter((u) => u !== getMsTokenUrl());
    expect(sendUrlsHit).toContain(STUB_GRAPH_URL);
    expect(sendUrlsHit.every((u) => u !== MS_GRAPH_SEND_URL)).toBe(true);

    const graphCall = fetchCalls.find((c) => c.url === STUB_GRAPH_URL);
    expect(graphCall).toBeDefined();
    const auth = (graphCall!.init!.headers as Record<string, string>)["Authorization"];
    expect(auth).toBe("Bearer AT-e2");
    const body = JSON.parse(String(graphCall!.init!.body));
    expect(body.message.subject).toBe("Invoice INV-E2-001");
    expect(body.message.toRecipients[0].emailAddress.address).toBe("client@example.com");
    expect(body.message.attachments).toHaveLength(1);
    expect(body.message.attachments[0].name).toBe("invoice.pdf");
  });
});
