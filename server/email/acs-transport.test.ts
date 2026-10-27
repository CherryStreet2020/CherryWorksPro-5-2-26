import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessToken, TokenCredential } from "@azure/identity";
import {
  ACS_API_VERSION,
  ACS_POLL_BUDGET_PER_HOUR,
  acquireAcsPollSlot,
  acsCooldownActive,
  acsGetOperation,
  acsPollBackoffMs,
  acsSend,
  buildAcsSendBody,
  classifyAcsFailureCode,
  extendAcsCooldown,
  getCachedAcsToken,
  parseRetryAfterMs,
  refreshAcsTokenIfNeeded,
  resetAcsStateForTests,
  setAcsCredentialForTests,
} from "./acs-transport";
import { EmailTransportError } from "./types";

const ENDPOINT = "https://cwp-comms.unitedstates.communication.azure.com/";
const MSG = {
  to: "pat@example.com",
  subject: "Hi",
  html: "<p>Hi</p>",
  text: "Hi",
  replyTo: "dean@cherrystconsulting.com",
  headers: { "List-Unsubscribe": "<https://cherryworkspro.com/u/x>" },
};

function credential(token: AccessToken | null | (() => Promise<AccessToken | null>)): TokenCredential & {
  calls: number;
} {
  const c = {
    calls: 0,
    async getToken() {
      c.calls++;
      return typeof token === "function" ? token() : token;
    },
  };
  return c;
}

const fresh = (): AccessToken => ({ token: "tok-1", expiresOnTimestamp: Date.now() + 60 * 60_000 });

function respond(status: number, body: unknown = null, headers: Record<string, string> = {}): Response {
  return new Response(body == null ? null : JSON.stringify(body), { status, headers });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  resetAcsStateForTests();
  setAcsCredentialForTests(credential(fresh()));
  await refreshAcsTokenIfNeeded({ force: true });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  (global as any).__emailTestSleep = async () => {};
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (global as any).__emailTestSleep;
  delete process.env.ACS_EMAIL_TEST_URL_OVERRIDE;
  setAcsCredentialForTests(null);
  resetAcsStateForTests();
  vi.restoreAllMocks();
});

describe("buildAcsSendBody", () => {
  it("maps the message, turns ACS's own tracking off and passes headers", () => {
    const body = buildAcsSendBody("hello@news.cherryworkspro.com", MSG);
    expect(body).toEqual({
      senderAddress: "hello@news.cherryworkspro.com",
      content: { subject: "Hi", html: "<p>Hi</p>", plainText: "Hi" },
      recipients: { to: [{ address: "pat@example.com" }] },
      userEngagementTrackingDisabled: true,
      replyTo: [{ address: "dean@cherrystconsulting.com" }],
      headers: { "List-Unsubscribe": "<https://cherryworkspro.com/u/x>" },
    });
  });

  it("refuses a header that could inject", () => {
    expect(() => buildAcsSendBody("a@b.co", { ...MSG, headers: { "X-A": "x\r\nBcc: y@z.co" } }))
      .toThrow(EmailTransportError);
  });
});

describe("acsSend", () => {
  const input = { endpoint: ENDPOINT, operationId: "op-1", senderAddress: "hello@news.x.com", message: MSG };

  it("202 ⇒ accepted, with Operation-Id and bearer token on the request", async () => {
    fetchMock.mockResolvedValue(respond(202, { id: "op-1", status: "Running" }, { "retry-after": "7" }));
    expect(await acsSend(input)).toEqual({ kind: "accepted", retryAfterMs: 7000 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `https://cwp-comms.unitedstates.communication.azure.com/emails:send?api-version=${ACS_API_VERSION}`,
    );
    expect(init.method).toBe("POST");
    expect(init.headers["Operation-Id"]).toBe("op-1");
    expect(init.headers.Authorization).toBe("Bearer tok-1");
  });

  it("the test URL override replaces only the base URL", async () => {
    process.env.ACS_EMAIL_TEST_URL_OVERRIDE = "http://127.0.0.1:9999/";
    fetchMock.mockResolvedValue(respond(202));
    await acsSend(input);
    expect(fetchMock.mock.calls[0][0]).toMatch(/^http:\/\/127\.0\.0\.1:9999\/emails:send\?/);
  });

  it("no usable cached token ⇒ deferred ACS_AUTH and nothing sent", async () => {
    setAcsCredentialForTests(credential(null));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await acsSend(input)).toMatchObject({ kind: "deferred", code: "ACS_AUTH" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a token close to expiry is not used", async () => {
    setAcsCredentialForTests(credential({ token: "old", expiresOnTimestamp: Date.now() + 60_000 }));
    await refreshAcsTokenIfNeeded({ force: true });
    expect(getCachedAcsToken()).toBeNull();
    expect(await acsSend(input)).toMatchObject({ kind: "deferred", code: "ACS_AUTH" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([401, 403])("%i ⇒ deferred ACS_AUTH", async (status) => {
    fetchMock.mockResolvedValue(respond(status));
    expect(await acsSend(input)).toMatchObject({ kind: "deferred", code: "ACS_AUTH" });
  });

  it("429 ⇒ deferred ACS_THROTTLED honouring Retry-After", async () => {
    fetchMock.mockResolvedValue(respond(429, null, { "retry-after": "120" }));
    expect(await acsSend(input)).toEqual({ kind: "deferred", code: "ACS_THROTTLED", retryAfterMs: 120_000 });
  });

  it.each([400, 404])("%i ⇒ rejected with a sanitised provider code", async (status) => {
    fetchMock.mockResolvedValue(respond(status, { error: { code: "Invalid<Sender>!" } }));
    expect(await acsSend(input)).toEqual({ kind: "rejected", code: "ACS_REJECTED", providerCode: "InvalidSender" });
  });

  it.each([500, 502, 503])("%i ⇒ ambiguous (poll, never POST again)", async (status) => {
    fetchMock.mockResolvedValue(respond(status));
    expect(await acsSend(input)).toEqual({ kind: "ambiguous", code: "ACS_POST_AMBIGUOUS" });
  });

  it("a network error or timeout ⇒ ambiguous", async () => {
    fetchMock.mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    expect(await acsSend(input)).toEqual({ kind: "ambiguous", code: "ACS_POST_AMBIGUOUS" });
  });
});

describe("acsGetOperation", () => {
  it("encodes the id into the operations URL", async () => {
    fetchMock.mockResolvedValue(respond(200, { status: "Succeeded" }));
    expect(await acsGetOperation(ENDPOINT, "a/b")).toEqual({ kind: "succeeded" });
    expect(fetchMock.mock.calls[0][0]).toBe(
      `https://cwp-comms.unitedstates.communication.azure.com/emails/operations/a%2Fb?api-version=${ACS_API_VERSION}`,
    );
  });

  it.each([
    [{ status: "Running" }, { kind: "pending", retryAfterMs: null }],
    [{ status: "NotStarted" }, { kind: "pending", retryAfterMs: null }],
    [{ status: "Canceled" }, { kind: "failed", code: "ACS_CANCELED" }],
    [{ status: "Failed", error: { code: "EmailDroppedRecipientSuppressed" } },
      { kind: "permanent", code: "ACS_EmailDroppedRecipientSuppressed" }],
    [{ status: "Failed", error: { code: "TooManyRequests" } }, { kind: "throttled", code: "ACS_THROTTLED" }],
    [{ status: "Failed", error: { code: "SomethingNew" } }, { kind: "failed", code: "ACS_SomethingNew" }],
    [{ status: "Failed" }, { kind: "failed", code: "ACS_FAILED" }],
    [{ status: "Weird" }, { kind: "error" }],
  ])("200 %j ⇒ %j", async (body, outcome) => {
    fetchMock.mockResolvedValue(respond(200, body));
    expect(await acsGetOperation(ENDPOINT, "op")).toEqual(outcome);
  });

  it("404 ⇒ not_found; 5xx, 401 and timeouts ⇒ error", async () => {
    fetchMock.mockResolvedValueOnce(respond(404));
    expect(await acsGetOperation(ENDPOINT, "op")).toEqual({ kind: "not_found" });
    fetchMock.mockResolvedValueOnce(respond(503));
    expect(await acsGetOperation(ENDPOINT, "op")).toEqual({ kind: "error" });
    fetchMock.mockResolvedValueOnce(respond(401));
    expect(await acsGetOperation(ENDPOINT, "op")).toEqual({ kind: "error" });
    fetchMock.mockRejectedValueOnce(new Error("reset"));
    expect(await acsGetOperation(ENDPOINT, "op")).toEqual({ kind: "error" });
  });

  it("429 sets the poll cooldown, which closes the poll gate", async () => {
    fetchMock.mockResolvedValue(respond(429, null, { "retry-after": "30" }));
    expect(await acsGetOperation(ENDPOINT, "op")).toEqual({ kind: "poll_throttled", retryAfterMs: 30_000 });
    expect(await acquireAcsPollSlot(Date.now() + 60 * 60_000)).toBe(false);
  });
});

describe("poll gate", () => {
  it("allows at most the hourly budget", async () => {
    const deadline = Date.now() + 365 * 24 * 60 * 60_000;
    let granted = 0;
    for (let i = 0; i < ACS_POLL_BUDGET_PER_HOUR + 5; i++) {
      if (await acquireAcsPollSlot(deadline)) granted++;
    }
    expect(granted).toBe(ACS_POLL_BUDGET_PER_HOUR);
  });

  it("refuses without waiting when pacing would overrun the deadline", async () => {
    const sleeps: number[] = [];
    (global as any).__emailTestSleep = async (ms: number) => { sleeps.push(ms); };
    expect(await acquireAcsPollSlot(Date.now() + 60_000)).toBe(true);
    // The next slot is ≥1.1 s away plus a 5 s GET: a 2 s deadline can't fit it.
    expect(await acquireAcsPollSlot(Date.now() + 2_000)).toBe(false);
    expect(sleeps.every((ms) => ms === 0)).toBe(true);
  });
});

describe("send cooldown", () => {
  it("extends but never shortens", () => {
    const now = Date.now();
    extendAcsCooldown(now + 60_000);
    extendAcsCooldown(now + 1_000);
    expect(acsCooldownActive(now + 30_000)).toBe(true);
    expect(acsCooldownActive(now + 61_000)).toBe(false);
  });
});

describe("token refresher", () => {
  it("is single-flight and never re-enters while an acquisition is outstanding", async () => {
    let release!: (t: AccessToken) => void;
    const c = credential(() => new Promise<AccessToken>((r) => { release = r; }));
    setAcsCredentialForTests(c);
    const a = refreshAcsTokenIfNeeded();
    const b = refreshAcsTokenIfNeeded();
    expect(c.calls).toBe(1);
    release(fresh());
    await Promise.all([a, b]);
    expect(getCachedAcsToken()).toBe("tok-1");
  });

  it("does not refresh a token with plenty of life", async () => {
    const c = credential(fresh());
    setAcsCredentialForTests(c);
    await refreshAcsTokenIfNeeded();
    await refreshAcsTokenIfNeeded();
    expect(c.calls).toBe(1);
  });

  it("a stalled acquisition raises the degraded alert once and does not block", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const c = credential(() => new Promise<AccessToken>(() => {}));
    setAcsCredentialForTests(c);
    void refreshAcsTokenIfNeeded();
    const degraded = vi.fn();
    const { startAcsTokenRefresher, stopAcsTokenRefresher } = await import("./acs-transport");
    startAcsTokenRefresher(degraded);
    stopAcsTokenRefresher();
    void refreshAcsTokenIfNeeded({ now: Date.now() + 31_000 });
    void refreshAcsTokenIfNeeded({ now: Date.now() + 62_000 });
    expect(degraded).toHaveBeenCalledTimes(1);
    expect(degraded).toHaveBeenCalledWith("ACS_AUTH");
    expect(c.calls).toBe(1);
    expect(err).toHaveBeenCalled();
    // A send never waits on it.
    expect(await acsSend({ endpoint: ENDPOINT, operationId: "x", senderAddress: "a@b.co", message: MSG }))
      .toMatchObject({ kind: "deferred", code: "ACS_AUTH" });
  });

  it("a failed acquisition keeps nothing in the cache", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setAcsCredentialForTests(credential(async () => { throw new Error("no identity"); }));
    await refreshAcsTokenIfNeeded({ force: true });
    expect(getCachedAcsToken()).toBeNull();
  });
});

describe("helpers", () => {
  it("parseRetryAfterMs reads seconds and HTTP dates", () => {
    const now = Date.parse("2026-10-27T12:00:00Z");
    expect(parseRetryAfterMs("5", 1, now)).toBe(5000);
    expect(parseRetryAfterMs("Tue, 27 Oct 2026 12:00:30 GMT", 1, now)).toBe(30_000);
    expect(parseRetryAfterMs(null, 42, now)).toBe(42);
    expect(parseRetryAfterMs("soon", 42, now)).toBe(42);
  });

  it("classifyAcsFailureCode", () => {
    expect(classifyAcsFailureCode("RecipientMailboxFull")).toBe("recipient");
    expect(classifyAcsFailureCode("EmailDroppedAllRecipientsSuppressed")).toBe("recipient");
    expect(classifyAcsFailureCode("QuotaExceeded")).toBe("quota");
    expect(classifyAcsFailureCode("Throttled")).toBe("quota");
    expect(classifyAcsFailureCode("InternalError")).toBe("unknown");
    expect(classifyAcsFailureCode(null)).toBe("unknown");
  });

  it("acsPollBackoffMs: 1 m, 5 m, 15 m, then hourly", () => {
    expect([1, 2, 3, 4, 9].map(acsPollBackoffMs)).toEqual([60_000, 300_000, 900_000, 3_600_000, 3_600_000]);
  });
});
