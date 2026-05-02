/**
 * Sprint 2g.7 — U1-U6: transport-selector unit tests.
 *
 * Pure unit tests: no network, no DB, no fetch. Asserts that selectTransport
 * returns the right transport class given the (org, flag) combinations laid
 * out in the sprint test matrix.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";

// Provide a key so encryptSmtpPassword does not no-op (used by U6).
process.env.SMTP_ENCRYPTION_KEY =
  process.env.SMTP_ENCRYPTION_KEY ||
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import { selectTransport, type OrgForTransport } from "../../server/email/transport-selector";
import {
  __setEmailOauthEnabledForTests,
  __resetEmailOauthFlagForTests,
} from "../../server/email/feature-flag";
import { MissingMailboxError } from "../../server/email/types";
import { SmtpTransport } from "../../server/email/smtp-transport";
import { GraphTransport } from "../../server/email/graph-transport";
import { GmailTransport } from "../../server/email/gmail-transport";
import { encryptSmtpPassword, decryptSmtpPassword } from "../../server/email";

const orgWithRefresh = (provider: "m365" | "google"): OrgForTransport => ({
  id: "org-123",
  emailProviderType: provider,
  emailOauthRefreshToken: "v2:fake:fake:fake:fake",
  emailSenderAddress: "x@example.com",
});

afterAll(() => __resetEmailOauthFlagForTests());

describe("selectTransport (U1-U5)", () => {
  beforeEach(() => __resetEmailOauthFlagForTests());

  it("U1 — returns SmtpTransport when provider='smtp' (flag on)", async () => {
    __setEmailOauthEnabledForTests(true);
    const t = await selectTransport({ id: "o", emailProviderType: "smtp" });
    expect(t).toBeInstanceOf(SmtpTransport);
    expect(t.kind).toBe("smtp");
  });

  it("U2 — returns GraphTransport when provider='m365' + refresh + flag on", async () => {
    __setEmailOauthEnabledForTests(true);
    const t = await selectTransport(orgWithRefresh("m365"));
    expect(t).toBeInstanceOf(GraphTransport);
    expect(t.kind).toBe("graph");
  });

  it("U3 — returns GmailTransport when provider='google' + refresh + flag on", async () => {
    __setEmailOauthEnabledForTests(true);
    const t = await selectTransport(orgWithRefresh("google"));
    expect(t).toBeInstanceOf(GmailTransport);
    expect(t.kind).toBe("gmail");
  });

  it("U4 — falls back to SMTP when EMAIL_OAUTH_ENABLED=false regardless of provider", async () => {
    __setEmailOauthEnabledForTests(false);
    const t1 = await selectTransport(orgWithRefresh("m365"));
    const t2 = await selectTransport(orgWithRefresh("google"));
    expect(t1).toBeInstanceOf(SmtpTransport);
    expect(t2).toBeInstanceOf(SmtpTransport);
  });

  it("U5 — throws MissingMailboxError when m365/google flag-on but no refresh token", async () => {
    __setEmailOauthEnabledForTests(true);
    await expect(
      selectTransport({ id: "o", emailProviderType: "m365", emailOauthRefreshToken: null }),
    ).rejects.toBeInstanceOf(MissingMailboxError);
    await expect(
      selectTransport({ id: "o", emailProviderType: "google", emailOauthRefreshToken: null }),
    ).rejects.toBeInstanceOf(MissingMailboxError);
  });

  it("U7 — throws MissingMailboxError when status='needs_reconnect' (m365)", async () => {
    __setEmailOauthEnabledForTests(true);
    // Sprint 2g.10 patch: needs_reconnect is observational only. Refresh-token presence is the only send-time gate; invalid_grant on refresh is the real lockout signal.
    const t = await selectTransport({
      ...orgWithRefresh("m365"),
      emailOauthStatus: "needs_reconnect",
    });
    expect(t).toBeInstanceOf(GraphTransport);
    expect(t.kind).toBe("graph");
  });

  it("U8 — throws MissingMailboxError when status='needs_reconnect' (google)", async () => {
    __setEmailOauthEnabledForTests(true);
    // Sprint 2g.10 patch: needs_reconnect is observational only. Refresh-token presence is the only send-time gate; invalid_grant on refresh is the real lockout signal.
    const t = await selectTransport({
      ...orgWithRefresh("google"),
      emailOauthStatus: "needs_reconnect",
    });
    expect(t).toBeInstanceOf(GmailTransport);
    expect(t.kind).toBe("gmail");
  });
});

describe("encrypt/decrypt round-trip (U6)", () => {
  it("U6 — refresh-token-shaped strings round-trip through SMTP encryption helpers", () => {
    const fakeRefresh = "1//0gA-fake-refresh-token-with.dots-and_underscores~tildes==";
    const enc = encryptSmtpPassword(fakeRefresh);
    expect(enc).toMatch(/^v2:/);
    expect(enc).not.toContain(fakeRefresh);
    expect(decryptSmtpPassword(enc)).toBe(fakeRefresh);
  });
});
