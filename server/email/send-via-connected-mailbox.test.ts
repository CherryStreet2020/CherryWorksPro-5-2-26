import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMock = vi.hoisted(() => vi.fn());
const transportKind = vi.hoisted(() => ({ value: "smtp" as "smtp" | "graph" | "gmail" }));

vi.mock("../storage", () => ({
  storage: {
    getOrg: vi.fn(async () => ({
      id: "org",
      name: "Acme",
      emailProviderType: "smtp",
      emailSenderAddress: "mailbox@acme.test",
    })),
  },
}));
vi.mock("./transport-selector", () => ({
  selectTransport: vi.fn(async () => ({ kind: transportKind.value, send: sendMock })),
}));
vi.mock("./failure-tracker", () => ({
  isRecipientSuppressed: vi.fn(async () => null),
  recordSuppressedSend: vi.fn(),
}));

import { sendViaConnectedMailbox } from "./send-via-connected-mailbox";
import { EmailTransportError } from "./types";

const base = { orgId: "org", to: "x@example.com", subject: "s", html: "<p>h</p>" };

beforeEach(() => {
  sendMock.mockReset();
  transportKind.value = "smtp";
});

describe("sendViaConnectedMailbox", () => {
  it("throws when the transport did not send (unconfigured SMTP)", async () => {
    sendMock.mockResolvedValue({ ok: false, messageId: "not-sent-no-smtp", transport: "noop" });
    await expect(sendViaConnectedMailbox(base)).rejects.toBeInstanceOf(EmailTransportError);
  });

  it("uses the caller's from-address over SMTP", async () => {
    sendMock.mockResolvedValue({ ok: true, messageId: "m", transport: "smtp" });
    await sendViaConnectedMailbox({ ...base, fromEmail: "news@brand.test" });
    expect(sendMock.mock.calls[0][0].fromEmail).toBe("news@brand.test");
  });

  it("keeps the authorised mailbox identity for Microsoft 365", async () => {
    transportKind.value = "graph";
    sendMock.mockResolvedValue({ ok: true, messageId: "m", transport: "graph" });
    await sendViaConnectedMailbox({ ...base, fromEmail: "news@brand.test" });
    expect(sendMock.mock.calls[0][0].fromEmail).toBe("mailbox@acme.test");
  });
});
