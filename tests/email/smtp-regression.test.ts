/**
 * Sprint 2g.7 — R1, R2, R3: SMTP regression tests.
 *
 * Locks the rule that with the OAuth flag OFF, *and* with the flag ON but
 * provider='smtp', the transport selector returns the nodemailer-backed
 * SmtpTransport. This is the rollback contract.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

process.env.SMTP_ENCRYPTION_KEY =
  process.env.SMTP_ENCRYPTION_KEY ||
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const sendMail = vi.fn(async (opts: any) => ({ messageId: "regression-id", envelope: opts }));
const createTransport = vi.fn(() => ({ sendMail }));
vi.mock("nodemailer", () => ({
  default: {
    createTransport,
    getTestMessageUrl: () => false,
    createTestAccount: async () => ({ user: "u", pass: "p" }),
  },
}));

import {
  selectTransport,
  type OrgForTransport,
} from "../../server/email/transport-selector";
import {
  __setEmailOauthEnabledForTests,
  __resetEmailOauthFlagForTests,
} from "../../server/email/feature-flag";
import { SmtpTransport, clearSmtpTransporterCache } from "../../server/email/smtp-transport";
import { encryptSmtpPassword } from "../../server/email";

const orgWithSmtp: OrgForTransport & Record<string, any> = {
  id: "org-smtp",
  emailProviderType: "smtp",
  smtpHost: "smtp.example.com",
  smtpPort: 587,
  smtpUser: "noreply@example.com",
  smtpPass: encryptSmtpPassword("smtp-pass"),
  smtpFromName: "Acme",
  smtpFromEmail: "noreply@example.com",
};

afterAll(() => __resetEmailOauthFlagForTests());

beforeEach(() => {
  __resetEmailOauthFlagForTests();
  sendMail.mockClear();
  createTransport.mockClear();
  clearSmtpTransporterCache();
});

describe("SMTP regression (R1, R2, R3)", () => {
  it("R1 — flag OFF: even an m365-configured org resolves to SmtpTransport", async () => {
    __setEmailOauthEnabledForTests(false);
    const t = await selectTransport({
      ...orgWithSmtp,
      emailProviderType: "m365",
      emailOauthRefreshToken: encryptSmtpPassword("rt"),
    });
    expect(t).toBeInstanceOf(SmtpTransport);
    expect(t.kind).toBe("smtp");

    await t.send({
      to: "x@y.com",
      subject: "R1",
      html: "<p>r1</p>",
    });
    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it("R2 — flag ON + provider='smtp' still routes to SmtpTransport / nodemailer", async () => {
    __setEmailOauthEnabledForTests(true);
    const t = await selectTransport(orgWithSmtp);
    expect(t).toBeInstanceOf(SmtpTransport);

    await t.send({ to: "x@y.com", subject: "R2", html: "<p>r2</p>" });
    expect(createTransport).toHaveBeenCalledTimes(1);
    const transportArg = createTransport.mock.calls[0][0] as any;
    expect(transportArg.host).toBe("smtp.example.com");
    expect(transportArg.auth.user).toBe("noreply@example.com");
  });

  it("R3 — clearSmtpTransporterCache invalidates the cached transporter", async () => {
    __setEmailOauthEnabledForTests(true);
    const t1 = await selectTransport(orgWithSmtp);
    await t1.send({ to: "x@y.com", subject: "R3a", html: "<p>r3a</p>" });
    expect(createTransport).toHaveBeenCalledTimes(1);

    // second send reuses cached transporter
    await t1.send({ to: "x@y.com", subject: "R3b", html: "<p>r3b</p>" });
    expect(createTransport).toHaveBeenCalledTimes(1);

    // after clearing the cache, a new transporter is built
    clearSmtpTransporterCache();
    const t2 = await selectTransport(orgWithSmtp);
    await t2.send({ to: "x@y.com", subject: "R3c", html: "<p>r3c</p>" });
    expect(createTransport).toHaveBeenCalledTimes(2);
  });
});
