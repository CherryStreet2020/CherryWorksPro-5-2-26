import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  recordEmailFailure,
  redactErrorCode,
  getFailureSummary,
  resetFailureTrackerForTests,
  wrapTransportWithFailureTracking,
  trackSelection,
  transportLabelFromSelectionError,
  FAILURE_ALERT_THRESHOLD_PER_HOUR,
  maybeSendFailureWebhook,
  setFailureWebhookFetcherForTests,
  addPinnedAlertOrg,
  removePinnedAlertOrg,
  listPinnedAlertOrgs,
  getRecentFailureAlerts,
  listFailureAlerts,
  setOrgFailureWebhookConfig,
  clearOrgFailureWebhookConfig,
  getOrgFailureWebhookConfig,
  flushPendingFailureWebhooksForTests,
  type FailureWebhookPayload,
} from "./failure-tracker";
import { EmailTransportError, MissingMailboxError } from "./types";
import type { EmailTransport } from "./types";
import { db } from "../db";
import {
  auditLogs,
  emailAlertPinnedOrgs,
  emailFailureAlerts,
  emailRecipientSuppressions,
  orgs,
} from "@shared/schema";
import { and, desc, eq } from "drizzle-orm";

describe("redactErrorCode", () => {
  beforeEach(async () => { await resetFailureTrackerForTests(); });

  it("normalizes MissingMailboxError", () => {
    expect(redactErrorCode(new MissingMailboxError("m365", "org-1"))).toBe(
      "MISSING_MAILBOX",
    );
  });

  it("extracts HTTP status from Graph errors", () => {
    const err = new EmailTransportError(
      "graph",
      "Graph sendMail failed (401): Bearer eyJabc.def.ghi unauthorized for user@example.com",
    );
    const code = redactErrorCode(err);
    expect(code).toBe("SEND_FAILED_401");
  });

  it("extracts SMTP status code", () => {
    const err = new EmailTransportError(
      "smtp",
      "Server replied: 535 5.7.139 Authentication unsuccessful",
    );
    expect(redactErrorCode(err)).toBe("SMTP_535_5.7.139");
  });

  it("does not leak bearer tokens or emails in code", () => {
    const err = new Error(
      "Failed sending Bearer eyJverylongtokenstringhere1234567890abcdef to alice@example.com",
    );
    const code = redactErrorCode(err);
    expect(code).not.toMatch(/Bearer/);
    expect(code).not.toMatch(/@example/);
  });

  it("classifies network and timeout errors", () => {
    expect(redactErrorCode(new Error("connect ECONNREFUSED"))).toBe(
      "NETWORK_ERROR",
    );
    expect(redactErrorCode(new Error("Request ETIMEDOUT"))).toBe("TIMEOUT");
  });
});

describe("recordEmailFailure + getFailureSummary", () => {
  beforeEach(async () => { await resetFailureTrackerForTests(); });

  it("counts failures per transport and surfaces last error", () => {
    recordEmailFailure(
      "org-1",
      "graph",
      new EmailTransportError("graph", "Graph sendMail failed (500): boom"),
    );
    recordEmailFailure(
      "org-2",
      "graph",
      new MissingMailboxError("m365", "org-2"),
    );
    recordEmailFailure(
      "org-3",
      "gmail",
      new EmailTransportError("gmail", "Gmail send failed (429): rate"),
    );

    const summary = getFailureSummary();
    expect(summary.totalSinceBoot).toBe(3);
    expect(summary.windowCount).toBe(3);

    const graph = summary.byTransport.find((t) => t.transport === "graph")!;
    expect(graph.windowCount).toBe(2);
    expect(graph.lastError?.errorCode).toBe("MISSING_MAILBOX");
    expect(graph.lastError?.orgId).toBe("org-2");
  });

  it("captures a masked recipient on each sample for admin drill-down", () => {
    recordEmailFailure(
      "org-1",
      "graph",
      new EmailTransportError("graph", "Graph sendMail failed (500): boom"),
      "Alice.Smith@Example.com",
    );
    recordEmailFailure(
      "org-1",
      "smtp",
      new EmailTransportError("smtp", "SMTP error: 550 mailbox unavailable"),
      undefined,
    );

    const scoped = getFailureSummary("org-1");
    expect(scoped.recent.length).toBe(2);
    const withRecipient = scoped.recent.find((s) => s.transport === "graph")!;
    expect(withRecipient.recipient).toBeTruthy();
    // Masked: keep first letter of local + first letter of domain + tld + hash.
    expect(withRecipient.recipient).toMatch(/^a\*\*\*@e\*\*\*\.com \(#[0-9a-f]{4}\)$/);
    // Raw address must not leak.
    expect(withRecipient.recipient).not.toMatch(/Smith/i);
    expect(withRecipient.recipient).not.toMatch(/example/i);

    const noRecipient = scoped.recent.find((s) => s.transport === "smtp")!;
    expect(noRecipient.recipient).toBeNull();
  });

  it("breaches threshold after enough failures", () => {
    for (let i = 0; i < FAILURE_ALERT_THRESHOLD_PER_HOUR; i++) {
      recordEmailFailure(
        `org-${i}`,
        "graph",
        new EmailTransportError("graph", "Graph sendMail failed (500): x"),
      );
    }
    expect(getFailureSummary().threshold.breached).toBe(true);
  });
});

describe("wrapTransportWithFailureTracking", () => {
  beforeEach(async () => { await resetFailureTrackerForTests(); });

  it("records and rethrows when underlying transport throws", async () => {
    const inner: EmailTransport = {
      kind: "graph",
      send: vi.fn(async () => {
        throw new EmailTransportError(
          "graph",
          "Graph sendMail failed (502): upstream",
        );
      }),
    };
    const wrapped = wrapTransportWithFailureTracking(inner, "org-x");

    await expect(
      wrapped.send({ to: "a@b.co", subject: "s", html: "<p/>" }),
    ).rejects.toThrow(/sendMail failed/);

    const summary = getFailureSummary();
    expect(summary.totalSinceBoot).toBe(1);
    expect(summary.byTransport[0].lastError?.errorCode).toBe("SEND_FAILED_502");
    expect(summary.byTransport[0].lastError?.orgId).toBe("org-x");
  });

  it("threads message.to into the recorded sample (masked)", async () => {
    const inner: EmailTransport = {
      kind: "gmail",
      send: vi.fn(async () => {
        throw new EmailTransportError("gmail", "Gmail send failed (429): rate");
      }),
    };
    const wrapped = wrapTransportWithFailureTracking(inner, "org-z");
    await expect(
      wrapped.send({ to: "bob@vendor.io", subject: "s", html: "<p/>" }),
    ).rejects.toThrow();
    const summary = getFailureSummary("org-z");
    expect(summary.recent[0].recipient).toMatch(
      /^b\*\*\*@v\*\*\*\.io \(#[0-9a-f]{4}\)$/,
    );
  });

  it("passes through successful sends without recording", async () => {
    const inner: EmailTransport = {
      kind: "smtp",
      send: vi.fn(async () => ({
        ok: true,
        messageId: "abc",
        transport: "smtp" as const,
      })),
    };
    const wrapped = wrapTransportWithFailureTracking(inner, "org-y");
    const r = await wrapped.send({ to: "a@b.co", subject: "s", html: "<p/>" });
    expect(r.ok).toBe(true);
    expect(getFailureSummary().totalSinceBoot).toBe(0);
  });

  it("records noop sends with transport=noop (not the wrapper kind)", async () => {
    // Inner reports kind="smtp" but the actual result.transport is "noop"
    // (e.g. SMTP-not-configured fallback). The recorded failure must
    // reflect the actual outcome, not the selected transport kind.
    const inner: EmailTransport = {
      kind: "smtp",
      send: vi.fn(async () => ({
        ok: false,
        messageId: "not-sent-no-smtp",
        transport: "noop" as const,
      })),
    };
    const wrapped = wrapTransportWithFailureTracking(inner, undefined);
    await wrapped.send({ to: "a@b.co", subject: "s", html: "<p/>" });
    const summary = getFailureSummary();
    expect(summary.totalSinceBoot).toBe(1);
    expect(summary.byTransport[0].transport).toBe("noop");
    expect(summary.byTransport[0].lastError?.orgId).toBe("none");
  });
});

describe("trackSelection", () => {
  beforeEach(async () => { await resetFailureTrackerForTests(); });

  it("records pre-send MissingMailboxError with transport=graph for m365", async () => {
    await expect(
      trackSelection("org-a", async () => {
        throw new MissingMailboxError("m365", "org-a");
      }),
    ).rejects.toBeInstanceOf(MissingMailboxError);
    const s = getFailureSummary();
    expect(s.totalSinceBoot).toBe(1);
    expect(s.byTransport[0].transport).toBe("graph");
    expect(s.byTransport[0].lastError?.errorCode).toBe("MISSING_MAILBOX");
  });

  it("records pre-send MissingMailboxError with transport=gmail for google", async () => {
    await expect(
      trackSelection("org-b", async () => {
        throw new MissingMailboxError("google", "org-b");
      }),
    ).rejects.toBeInstanceOf(MissingMailboxError);
    expect(getFailureSummary().byTransport[0].transport).toBe("gmail");
  });

  it("returns a wrapped transport on success so subsequent send failures are captured", async () => {
    const inner: EmailTransport = {
      kind: "graph",
      send: vi.fn(async () => {
        throw new EmailTransportError("graph", "Graph sendMail failed (500): x");
      }),
    };
    const wrapped = await trackSelection("org-c", async () => inner);
    await expect(
      wrapped.send({ to: "a@b.co", subject: "s", html: "<p/>" }),
    ).rejects.toThrow();
    expect(getFailureSummary().totalSinceBoot).toBe(1);
  });
});

describe("transportLabelFromSelectionError", () => {
  it("maps providerType to transport name", () => {
    expect(
      transportLabelFromSelectionError(new MissingMailboxError("m365", "x")),
    ).toBe("graph");
    expect(
      transportLabelFromSelectionError(new MissingMailboxError("google", "x")),
    ).toBe("gmail");
    expect(
      transportLabelFromSelectionError(new EmailTransportError("smtp", "boom")),
    ).toBe("smtp");
    expect(transportLabelFromSelectionError(new Error("?"))).toBe("unknown");
  });
});

describe("maybeSendFailureWebhook", () => {
  const ORIGINAL_URL = process.env.EMAIL_FAILURE_WEBHOOK_URL;
  const ORIGINAL_COOLDOWN = process.env.EMAIL_FAILURE_WEBHOOK_COOLDOWN_MS;

  beforeEach(async () => {
    await resetFailureTrackerForTests();
    process.env.EMAIL_FAILURE_WEBHOOK_URL = "https://hooks.example.test/abc";
    process.env.EMAIL_FAILURE_WEBHOOK_COOLDOWN_MS = "60000";
  });

  afterEach(() => {
    if (ORIGINAL_URL === undefined) delete process.env.EMAIL_FAILURE_WEBHOOK_URL;
    else process.env.EMAIL_FAILURE_WEBHOOK_URL = ORIGINAL_URL;
    if (ORIGINAL_COOLDOWN === undefined)
      delete process.env.EMAIL_FAILURE_WEBHOOK_COOLDOWN_MS;
    else process.env.EMAIL_FAILURE_WEBHOOK_COOLDOWN_MS = ORIGINAL_COOLDOWN;
  });

  function pushFailures(n: number, transport = "graph") {
    for (let i = 0; i < n; i++) {
      recordEmailFailure(
        `org-${i}`,
        transport,
        new EmailTransportError(transport, `${transport} sendMail failed (500): boom`),
      );
    }
  }

  it("does nothing when EMAIL_FAILURE_WEBHOOK_URL is not set", async () => {
    delete process.env.EMAIL_FAILURE_WEBHOOK_URL;
    const fetcher = vi.fn(async () => {});
    setFailureWebhookFetcherForTests(fetcher);
    pushFailures(FAILURE_ALERT_THRESHOLD_PER_HOUR);
    await flushPendingFailureWebhooksForTests();
    await maybeSendFailureWebhook(Date.now());
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does nothing below the threshold", async () => {
    const fetcher = vi.fn(async () => {});
    setFailureWebhookFetcherForTests(fetcher);
    pushFailures(FAILURE_ALERT_THRESHOLD_PER_HOUR - 1);
    await flushPendingFailureWebhooksForTests();
    await maybeSendFailureWebhook(Date.now());
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("includes a top-affected-orgs breakdown when more than one org contributed", async () => {
    const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ORG_A = `t248-a-${RUN}`;
    const ORG_B = `t248-b-${RUN}`;
    const ORG_C = `t248-c-${RUN}`;
    await db.insert(orgs).values([
      { id: ORG_A, name: `Acme ${RUN}`, slug: `t248a-${RUN}` },
      { id: ORG_B, name: `Beta ${RUN}`, slug: `t248b-${RUN}` },
      { id: ORG_C, name: `Gamma ${RUN}`, slug: `t248c-${RUN}` },
    ]);

    try {
      const calls: Array<{ url: string; payload: FailureWebhookPayload }> = [];
      setFailureWebhookFetcherForTests(async (url, payload) => {
        calls.push({ url, payload });
      });

      // 6 to ORG_A, 3 to ORG_B, 1 to ORG_C — well above the threshold and
      // distributed across multiple orgs so the breakdown should appear.
      for (let i = 0; i < 6; i++) {
        recordEmailFailure(
          ORG_A,
          "graph",
          new EmailTransportError("graph", "Graph sendMail failed (500): x"),
        );
      }
      for (let i = 0; i < 3; i++) {
        recordEmailFailure(
          ORG_B,
          "graph",
          new EmailTransportError("graph", "Graph sendMail failed (500): x"),
        );
      }
      recordEmailFailure(
        ORG_C,
        "graph",
        new EmailTransportError("graph", "Graph sendMail failed (500): x"),
      );

      await flushPendingFailureWebhooksForTests();

      expect(calls.length).toBeGreaterThanOrEqual(1);
      const { payload } = calls[0];
      expect(payload.topOrgs).toBeDefined();
      expect(payload.topOrgs!.length).toBe(3);
      // Sorted by failureCount desc.
      expect(payload.topOrgs![0]).toMatchObject({
        orgId: ORG_A,
        name: `Acme ${RUN}`,
        failureCount: 6,
      });
      expect(payload.topOrgs![1]).toMatchObject({
        orgId: ORG_B,
        name: `Beta ${RUN}`,
        failureCount: 3,
      });
      expect(payload.text).toContain("Top affected orgs");
      expect(payload.text).toContain(`Acme ${RUN}`);
      expect(payload.text).toContain(`Beta ${RUN}`);
      expect(payload.text).toContain("6 failures");
      expect(payload.text).toContain("3 failures");
      expect(payload.text).toContain("1 failure");
    } finally {
      await db.delete(orgs).where(eq(orgs.id, ORG_A));
      await db.delete(orgs).where(eq(orgs.id, ORG_B));
      await db.delete(orgs).where(eq(orgs.id, ORG_C));
    }
  });

  it("keeps the original compact text when only one org contributed", async () => {
    const calls: Array<{ url: string; payload: FailureWebhookPayload }> = [];
    setFailureWebhookFetcherForTests(async (url, payload) => {
      calls.push({ url, payload });
    });

    for (let i = 0; i < FAILURE_ALERT_THRESHOLD_PER_HOUR; i++) {
      recordEmailFailure(
        "single-org",
        "graph",
        new EmailTransportError("graph", "Graph sendMail failed (500): x"),
      );
    }
    await flushPendingFailureWebhooksForTests();

    expect(calls.length).toBeGreaterThanOrEqual(1);
    const { payload } = calls[0];
    expect(payload.topOrgs).toBeUndefined();
    expect(payload.text).not.toContain("Top affected orgs");
  });

  it("forces pinned orgs into the breakdown even when outside the natural top 5", async () => {
    const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // Six "noisy" orgs with high failure counts (these will fill the
    // natural top-5 slots) plus one low-volume "VIP" org with a single
    // failure that we will pin so it must still appear.
    const NOISY = Array.from({ length: 6 }, (_, i) => `t280-noisy-${i}-${RUN}`);
    const VIP = `t280-vip-${RUN}`;
    await db.insert(orgs).values([
      ...NOISY.map((id, i) => ({
        id,
        name: `Noisy ${i} ${RUN}`,
        slug: `t280n${i}-${RUN}`,
      })),
      { id: VIP, name: `VIP ${RUN}`, slug: `t280vip-${RUN}` },
    ]);

    try {
      await addPinnedAlertOrg(VIP, { pinnedBy: "operator-test" });
      const pinned = await listPinnedAlertOrgs();
      expect(pinned.find((p) => p.orgId === VIP)).toBeTruthy();

      const calls: Array<{ url: string; payload: FailureWebhookPayload }> = [];
      setFailureWebhookFetcherForTests(async (url, payload) => {
        calls.push({ url, payload });
      });

      // Each noisy org gets 5 failures; VIP only gets 1. With 6 noisy
      // orgs ahead of VIP by raw count, VIP would be pruned by the
      // top-5 cap if pinning weren't honored.
      for (const id of NOISY) {
        for (let i = 0; i < 5; i++) {
          recordEmailFailure(
            id,
            "graph",
            new EmailTransportError("graph", "Graph sendMail failed (500): x"),
          );
        }
      }
      recordEmailFailure(
        VIP,
        "graph",
        new EmailTransportError("graph", "Graph sendMail failed (500): x"),
      );
      await flushPendingFailureWebhooksForTests();

      expect(calls.length).toBeGreaterThanOrEqual(1);
      const { payload } = calls[0];
      expect(payload.topOrgs).toBeDefined();
      // 5 organic + 1 pinned extra.
      expect(payload.topOrgs!.length).toBe(6);
      const vipEntry = payload.topOrgs!.find((o) => o.orgId === VIP);
      expect(vipEntry).toBeTruthy();
      expect(vipEntry!.pinned).toBe(true);
      expect(vipEntry!.failureCount).toBe(1);
      expect(payload.text).toContain(`VIP ${RUN}`);
      expect(payload.text).toContain("📌");

      // After unpinning, the same scenario must drop VIP from the cut.
      await removePinnedAlertOrg(VIP);
      await resetFailureTrackerForTests();
      // resetFailureTrackerForTests clears the fetcher override; re-set
      // it so we can capture the next payload.
      const calls2: Array<{ url: string; payload: FailureWebhookPayload }> = [];
      setFailureWebhookFetcherForTests(async (url, payload) => {
        calls2.push({ url, payload });
      });
      for (const id of NOISY) {
        for (let i = 0; i < 5; i++) {
          recordEmailFailure(
            id,
            "graph",
            new EmailTransportError("graph", "Graph sendMail failed (500): x"),
          );
        }
      }
      recordEmailFailure(
        VIP,
        "graph",
        new EmailTransportError("graph", "Graph sendMail failed (500): x"),
      );
      await flushPendingFailureWebhooksForTests();
      expect(calls2.length).toBeGreaterThanOrEqual(1);
      const { payload: payload2 } = calls2[0];
      expect(payload2.topOrgs!.length).toBe(5);
      expect(payload2.topOrgs!.find((o) => o.orgId === VIP)).toBeUndefined();
      expect(payload2.text).not.toContain("📌");
    } finally {
      try {
        await db.delete(emailAlertPinnedOrgs).where(eq(emailAlertPinnedOrgs.orgId, VIP));
      } catch {}
      for (const id of NOISY) {
        await db.delete(orgs).where(eq(orgs.id, id));
      }
      await db.delete(orgs).where(eq(orgs.id, VIP));
    }
  });

  it("posts a payload with top transport and top errorCode once breached", async () => {
    const calls: Array<{ url: string; payload: FailureWebhookPayload }> = [];
    setFailureWebhookFetcherForTests(async (url, payload) => {
      calls.push({ url, payload });
    });

    for (let i = 0; i < 8; i++) {
      recordEmailFailure(
        `org-${i}`,
        "graph",
        new EmailTransportError("graph", "Graph sendMail failed (500): x"),
      );
    }
    for (let i = 0; i < 2; i++) {
      recordEmailFailure(`org-g-${i}`, "gmail", new Error("Request ETIMEDOUT"));
    }

    await flushPendingFailureWebhooksForTests();
    await maybeSendFailureWebhook(Date.now());

    expect(calls.length).toBeGreaterThanOrEqual(1);
    const { url, payload } = calls[0];
    expect(url).toBe("https://hooks.example.test/abc");
    expect(payload.failureCount).toBeGreaterThanOrEqual(
      FAILURE_ALERT_THRESHOLD_PER_HOUR,
    );
    expect(payload.threshold).toBe(FAILURE_ALERT_THRESHOLD_PER_HOUR);
    expect(payload.topTransport).toBe("graph");
    expect(payload.topErrorCode).toBe("SEND_FAILED_500");
    expect(payload.text).toContain("threshold breached");
    expect(payload.text).not.toMatch(/Bearer|@/);
  });

  it("respects cooldown and does not spam repeated alerts", async () => {
    const fetcher = vi.fn(async () => {});
    setFailureWebhookFetcherForTests(fetcher);
    pushFailures(FAILURE_ALERT_THRESHOLD_PER_HOUR);
    await flushPendingFailureWebhooksForTests();
    const t = Date.now();
    await maybeSendFailureWebhook(t);
    await maybeSendFailureWebhook(t + 1000);
    await maybeSendFailureWebhook(t + 30_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("fires again after the cooldown window elapses", async () => {
    const fetcher = vi.fn(async () => {});
    setFailureWebhookFetcherForTests(fetcher);
    pushFailures(FAILURE_ALERT_THRESHOLD_PER_HOUR);
    await flushPendingFailureWebhooksForTests();
    const t = Date.now();
    await maybeSendFailureWebhook(t);
    await maybeSendFailureWebhook(t + 60_001);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("swallows fetcher errors so recordEmailFailure is never broken", async () => {
    setFailureWebhookFetcherForTests(async () => {
      throw new Error("network down");
    });
    pushFailures(FAILURE_ALERT_THRESHOLD_PER_HOUR);
    await flushPendingFailureWebhooksForTests();
    await expect(maybeSendFailureWebhook(Date.now())).resolves.toBeUndefined();
  });

  it("treats non-2xx HTTP responses as failed delivery", async () => {
    // Use the real default fetcher path by stubbing global fetch.
    setFailureWebhookFetcherForTests(null);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response("rate limited", { status: 429 }) as unknown as Response,
      );
    try {
      pushFailures(FAILURE_ALERT_THRESHOLD_PER_HOUR);
      await flushPendingFailureWebhooksForTests();
      await expect(
        maybeSendFailureWebhook(Date.now()),
      ).resolves.toBeUndefined();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("treats 2xx HTTP responses as successful delivery", async () => {
    setFailureWebhookFetcherForTests(null);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response("ok", { status: 200 }) as unknown as Response,
      );
    try {
      pushFailures(FAILURE_ALERT_THRESHOLD_PER_HOUR);
      await flushPendingFailureWebhooksForTests();
      await maybeSendFailureWebhook(Date.now());
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(init.method).toBe("POST");
      const body = JSON.parse(init.body as string);
      expect(body.threshold).toBe(FAILURE_ALERT_THRESHOLD_PER_HOUR);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe("getRecentFailureAlerts", () => {
  const ORIGINAL_URL = process.env.EMAIL_FAILURE_WEBHOOK_URL;
  const ORIGINAL_COOLDOWN = process.env.EMAIL_FAILURE_WEBHOOK_COOLDOWN_MS;

  beforeEach(async () => {
    await resetFailureTrackerForTests();
    process.env.EMAIL_FAILURE_WEBHOOK_URL = "https://hooks.example.test/abc";
    process.env.EMAIL_FAILURE_WEBHOOK_COOLDOWN_MS = "60000";
  });

  afterEach(() => {
    if (ORIGINAL_URL === undefined) delete process.env.EMAIL_FAILURE_WEBHOOK_URL;
    else process.env.EMAIL_FAILURE_WEBHOOK_URL = ORIGINAL_URL;
    if (ORIGINAL_COOLDOWN === undefined)
      delete process.env.EMAIL_FAILURE_WEBHOOK_COOLDOWN_MS;
    else process.env.EMAIL_FAILURE_WEBHOOK_COOLDOWN_MS = ORIGINAL_COOLDOWN;
  });

  function pushFailures(n: number, transport = "graph") {
    for (let i = 0; i < n; i++) {
      recordEmailFailure(
        `org-${i}`,
        transport,
        new EmailTransportError(transport, `${transport} sendMail failed (500): boom`),
      );
    }
  }

  it("captures alerts whenever the threshold is breached, regardless of delivery", async () => {
    setFailureWebhookFetcherForTests(async () => {
      throw new Error("network down");
    });
    pushFailures(FAILURE_ALERT_THRESHOLD_PER_HOUR);
    await flushPendingFailureWebhooksForTests();
    await maybeSendFailureWebhook(Date.now());

    const alerts = await getRecentFailureAlerts();
    expect(alerts.length).toBe(1);
    expect(alerts[0].thresholdBreached).toBe(true);
    expect(alerts[0].topTransport).toBe("graph");
    expect(alerts[0].topErrorCode).toBe("SEND_FAILED_500");
    expect(alerts[0].delivered).toBe(false);
  });

  it("returns most-recent first and respects the limit", async () => {
    setFailureWebhookFetcherForTests(async () => {});
    const t = Date.now();
    pushFailures(FAILURE_ALERT_THRESHOLD_PER_HOUR);
    await flushPendingFailureWebhooksForTests();
    await maybeSendFailureWebhook(t);
    pushFailures(FAILURE_ALERT_THRESHOLD_PER_HOUR);
    await flushPendingFailureWebhooksForTests();
    await maybeSendFailureWebhook(t + 60_001);
    pushFailures(FAILURE_ALERT_THRESHOLD_PER_HOUR);
    await flushPendingFailureWebhooksForTests();
    await maybeSendFailureWebhook(t + 120_002);

    const alerts = await getRecentFailureAlerts(2);
    expect(alerts.length).toBe(2);
    expect(alerts[0].ts).toBeGreaterThan(alerts[1].ts);
    expect(alerts[0].delivered).toBe(true);
  });

  it("returns nothing when no breaches have occurred", async () => {
    expect(await getRecentFailureAlerts()).toEqual([]);
  });

  it("scopes alerts to the requesting org and projects per-org slices", async () => {
    setFailureWebhookFetcherForTests(async () => {});

    // org-A: 8 graph SEND_FAILED_500 errors
    for (let i = 0; i < 8; i++) {
      recordEmailFailure(
        "org-A",
        "graph",
        new EmailTransportError("graph", "Graph sendMail failed (500): a"),
      );
    }
    // org-B: 3 gmail TIMEOUT errors (just enough to trip the global threshold of 10 with org-A)
    for (let i = 0; i < 3; i++) {
      recordEmailFailure("org-B", "gmail", new Error("Request ETIMEDOUT"));
    }

    await flushPendingFailureWebhooksForTests();
    await maybeSendFailureWebhook(Date.now());

    const aAlerts = await getRecentFailureAlerts(5, "org-A");
    expect(aAlerts.length).toBe(1);
    expect(aAlerts[0].failureCount).toBe(8);
    expect(aAlerts[0].topTransport).toBe("graph");
    expect(aAlerts[0].topErrorCode).toBe("SEND_FAILED_500");

    const bAlerts = await getRecentFailureAlerts(5, "org-B");
    expect(bAlerts.length).toBe(1);
    expect(bAlerts[0].failureCount).toBe(3);
    expect(bAlerts[0].topTransport).toBe("gmail");
    expect(bAlerts[0].topErrorCode).toBe("TIMEOUT");
    // Below the global threshold for org-B's own contribution
    expect(bAlerts[0].thresholdBreached).toBe(false);

    // An org with no contributing failures sees nothing.
    expect(await getRecentFailureAlerts(5, "org-C")).toEqual([]);
  });

  it("persists alerts so they survive a fresh in-memory state (simulated restart)", async () => {
    setFailureWebhookFetcherForTests(async () => {});

    // Record a breach the normal way: this should persist a row.
    for (let i = 0; i < FAILURE_ALERT_THRESHOLD_PER_HOUR; i++) {
      recordEmailFailure(
        "org-restart",
        "graph",
        new EmailTransportError("graph", "Graph sendMail failed (500): boom"),
      );
    }
    await flushPendingFailureWebhooksForTests();
    await maybeSendFailureWebhook(Date.now());

    // Confirm the row landed in the durable table (not just memory).
    const dbRows = await db.select().from(emailFailureAlerts);
    expect(dbRows.length).toBe(1);
    expect(dbRows[0].failureCount).toBeGreaterThanOrEqual(
      FAILURE_ALERT_THRESHOLD_PER_HOUR,
    );

    // Re-read via the public API and confirm the alert is still visible.
    // Reads now come straight from the table, so this models the post-
    // restart admin dashboard fetch.
    const alerts = await getRecentFailureAlerts(5, "org-restart");
    expect(alerts.length).toBe(1);
    expect(alerts[0].topTransport).toBe("graph");
    expect(alerts[0].topErrorCode).toBe("SEND_FAILED_500");
  });

  it("prunes alerts older than the retention window (default 30 days)", async () => {
    const { pruneOldFailureAlerts } = await import("./failure-tracker");
    const now = Date.now();
    const oldTs = new Date(now - 31 * 24 * 60 * 60 * 1000);
    const recentTs = new Date(now - 5 * 24 * 60 * 60 * 1000);
    await db.insert(emailFailureAlerts).values([
      {
        ts: oldTs,
        failureCount: 10,
        threshold: FAILURE_ALERT_THRESHOLD_PER_HOUR,
        thresholdBreached: true,
        topTransport: "graph",
        topErrorCode: "SEND_FAILED_500",
        delivered: true,
        byOrg: {} as Record<string, never>,
      },
      {
        ts: recentTs,
        failureCount: 10,
        threshold: FAILURE_ALERT_THRESHOLD_PER_HOUR,
        thresholdBreached: true,
        topTransport: "graph",
        topErrorCode: "SEND_FAILED_500",
        delivered: true,
        byOrg: {} as Record<string, never>,
      },
    ]);

    const stats = await pruneOldFailureAlerts(now);
    expect(stats.retentionDays).toBe(30);
    expect(stats.deleted).toBe(1);

    const remaining = await db.select().from(emailFailureAlerts);
    expect(remaining.length).toBe(1);
    expect(remaining[0].ts.getTime()).toBe(recentTs.getTime());
  });

  it("respects EMAIL_FAILURE_ALERT_RETENTION_DAYS override", async () => {
    const { pruneOldFailureAlerts } = await import("./failure-tracker");
    const original = process.env.EMAIL_FAILURE_ALERT_RETENTION_DAYS;
    process.env.EMAIL_FAILURE_ALERT_RETENTION_DAYS = "7";
    try {
      const now = Date.now();
      const eightDaysAgo = new Date(now - 8 * 24 * 60 * 60 * 1000);
      const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000);
      await db.insert(emailFailureAlerts).values([
        {
          ts: eightDaysAgo,
          failureCount: 10,
          threshold: FAILURE_ALERT_THRESHOLD_PER_HOUR,
          thresholdBreached: true,
          topTransport: "graph",
          topErrorCode: "SEND_FAILED_500",
          delivered: true,
          byOrg: {} as Record<string, never>,
        },
        {
          ts: twoDaysAgo,
          failureCount: 10,
          threshold: FAILURE_ALERT_THRESHOLD_PER_HOUR,
          thresholdBreached: true,
          topTransport: "graph",
          topErrorCode: "SEND_FAILED_500",
          delivered: true,
          byOrg: {} as Record<string, never>,
        },
      ]);

      const stats = await pruneOldFailureAlerts(now);
      expect(stats.retentionDays).toBe(7);
      expect(stats.deleted).toBe(1);

      const remaining = await db.select().from(emailFailureAlerts);
      expect(remaining.length).toBe(1);
      expect(remaining[0].ts.getTime()).toBe(twoDaysAgo.getTime());
    } finally {
      if (original === undefined) delete process.env.EMAIL_FAILURE_ALERT_RETENTION_DAYS;
      else process.env.EMAIL_FAILURE_ALERT_RETENTION_DAYS = original;
    }
  });

  it("piggybacks time-based pruning onto recordAlert", async () => {
    const now = Date.now();
    const oldTs = new Date(now - 45 * 24 * 60 * 60 * 1000);
    await db.insert(emailFailureAlerts).values({
      ts: oldTs,
      failureCount: 10,
      threshold: FAILURE_ALERT_THRESHOLD_PER_HOUR,
      thresholdBreached: true,
      topTransport: "graph",
      topErrorCode: "SEND_FAILED_500",
      delivered: true,
      byOrg: {} as Record<string, never>,
    });

    setFailureWebhookFetcherForTests(async () => {});
    process.env.EMAIL_FAILURE_WEBHOOK_URL = "https://example.com/hook";
    try {
      for (let i = 0; i < FAILURE_ALERT_THRESHOLD_PER_HOUR; i++) {
        recordEmailFailure(
          "org-prune-age",
          "graph",
          new EmailTransportError("graph", "Graph sendMail failed (500): x"),
        );
      }
      await flushPendingFailureWebhooksForTests();
      await maybeSendFailureWebhook(Date.now());
      await flushPendingFailureWebhooksForTests();

      const remaining = await db
        .select()
        .from(emailFailureAlerts)
        .orderBy(desc(emailFailureAlerts.ts));
      // The 45-day-old row should have been wiped by the piggybacked
      // time-based prune; only the freshly-inserted alert remains.
      expect(remaining.length).toBe(1);
      expect(remaining[0].ts.getTime()).toBeGreaterThan(
        now - 24 * 60 * 60 * 1000,
      );
    } finally {
      delete process.env.EMAIL_FAILURE_WEBHOOK_URL;
    }
  });

  it("does NOT prune by row count — every alert in the retention window is kept", async () => {
    // Task #283 — the previous post-insert "keep most-recent 200 rows"
    // prune was removed so admins can export every alert in the active
    // retention window. Insert more than the old cap (well within the
    // retention window), trigger another alert, and confirm no rows
    // were dropped beyond the time-based prune.
    const OLD_CAP = 200;
    const SEED = OLD_CAP + 25;
    const baseTs = Date.now() - 10 * 60 * 60 * 1000;
    const rows = Array.from({ length: SEED }, (_, i) => ({
      ts: new Date(baseTs + i * 1000),
      failureCount: 10,
      threshold: FAILURE_ALERT_THRESHOLD_PER_HOUR,
      thresholdBreached: true,
      topTransport: "graph",
      topErrorCode: "SEND_FAILED_500",
      delivered: true,
      byOrg: {} as Record<string, never>,
    }));
    await db.insert(emailFailureAlerts).values(rows);

    setFailureWebhookFetcherForTests(async () => {});
    process.env.EMAIL_FAILURE_WEBHOOK_URL = "https://example.com/hook";
    try {
      for (let i = 0; i < FAILURE_ALERT_THRESHOLD_PER_HOUR; i++) {
        recordEmailFailure(
          "org-prune",
          "graph",
          new EmailTransportError("graph", "Graph sendMail failed (500): x"),
        );
      }
      await flushPendingFailureWebhooksForTests();
      await maybeSendFailureWebhook(Date.now());
      await flushPendingFailureWebhooksForTests();

      const all = await db.select().from(emailFailureAlerts);
      // All seeded rows + the freshly-recorded alert(s) survive — the
      // total is strictly above the old 200-row cap.
      expect(all.length).toBeGreaterThan(OLD_CAP);
      expect(all.length).toBeGreaterThanOrEqual(SEED);
    } finally {
      delete process.env.EMAIL_FAILURE_WEBHOOK_URL;
    }
  });
});

describe("getFailureSummary org scoping", () => {
  beforeEach(async () => { await resetFailureTrackerForTests(); });

  it("only returns failures for the requested org when scoped", () => {
    recordEmailFailure(
      "org-1",
      "graph",
      new EmailTransportError("graph", "Graph sendMail failed (500): a"),
    );
    recordEmailFailure(
      "org-2",
      "graph",
      new EmailTransportError("graph", "Graph sendMail failed (500): b"),
    );
    recordEmailFailure(
      "org-1",
      "gmail",
      new EmailTransportError("gmail", "Gmail send failed (429): c"),
    );

    const scoped = getFailureSummary("org-1");
    expect(scoped.windowCount).toBe(2);
    expect(scoped.totalSinceBoot).toBe(2);
    const transports = scoped.byTransport.map((t) => t.transport).sort();
    expect(transports).toEqual(["gmail", "graph"]);
    for (const sample of scoped.recent) {
      expect(sample.orgId).toBe("org-1");
    }

    const global = getFailureSummary();
    expect(global.totalSinceBoot).toBe(3);
  });
});

describe("per-org failure webhook", () => {
  const ORIGINAL_URL = process.env.EMAIL_FAILURE_WEBHOOK_URL;

  beforeEach(async () => {
    await resetFailureTrackerForTests();
    delete process.env.EMAIL_FAILURE_WEBHOOK_URL;
  });

  afterEach(() => {
    if (ORIGINAL_URL === undefined) delete process.env.EMAIL_FAILURE_WEBHOOK_URL;
    else process.env.EMAIL_FAILURE_WEBHOOK_URL = ORIGINAL_URL;
  });

  it("set/get/clear round-trips per-org config", () => {
    expect(getOrgFailureWebhookConfig("org-1")).toBeNull();
    setOrgFailureWebhookConfig("org-1", {
      url: "https://hooks.example/abc",
      cooldownMs: 5000,
    });
    expect(getOrgFailureWebhookConfig("org-1")).toEqual({
      url: "https://hooks.example/abc",
      cooldownMs: 5000,
    });
    clearOrgFailureWebhookConfig("org-1");
    expect(getOrgFailureWebhookConfig("org-1")).toBeNull();
  });

  it("posts to the org webhook only when that org breaches the threshold", async () => {
    const calls: Array<{ url: string; payload: FailureWebhookPayload }> = [];
    setFailureWebhookFetcherForTests(async (url, payload) => {
      calls.push({ url, payload });
    });
    setOrgFailureWebhookConfig("org-a", {
      url: "https://hooks.example/org-a",
      cooldownMs: 60_000,
    });

    // Failures spread across orgs; org-a alone is below threshold.
    for (let i = 0; i < FAILURE_ALERT_THRESHOLD_PER_HOUR - 1; i++) {
      recordEmailFailure(
        "org-a",
        "graph",
        new EmailTransportError("graph", "Graph sendMail failed (500): x"),
      );
    }
    recordEmailFailure(
      "org-b",
      "graph",
      new EmailTransportError("graph", "Graph sendMail failed (500): x"),
    );
    expect(calls.length).toBe(0);

    // One more for org-a tips it over.
    recordEmailFailure(
      "org-a",
      "graph",
      new EmailTransportError("graph", "Graph sendMail failed (500): x"),
    );
    // Allow async webhook to flush.
    await new Promise((r) => setImmediate(r));

    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("https://hooks.example/org-a");
    expect(calls[0].payload.failureCount).toBe(
      FAILURE_ALERT_THRESHOLD_PER_HOUR,
    );
  });

  it("respects per-org cooldown override independently", async () => {
    const fetcher = vi.fn(async () => {});
    setFailureWebhookFetcherForTests(fetcher);
    setOrgFailureWebhookConfig("org-a", {
      url: "https://hooks.example/org-a",
      cooldownMs: 30_000,
    });

    for (let i = 0; i < FAILURE_ALERT_THRESHOLD_PER_HOUR; i++) {
      recordEmailFailure(
        "org-a",
        "graph",
        new EmailTransportError("graph", "Graph sendMail failed (500): x"),
      );
    }
    const t = Date.now();
    await maybeSendFailureWebhook(t, "org-a");
    await maybeSendFailureWebhook(t + 10_000, "org-a");
    expect(fetcher).toHaveBeenCalledTimes(1);

    await maybeSendFailureWebhook(t + 31_000, "org-a");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("env-var fallback still fires when no org config is set", async () => {
    const fetcher = vi.fn(async () => {});
    setFailureWebhookFetcherForTests(fetcher);
    process.env.EMAIL_FAILURE_WEBHOOK_URL = "https://hooks.example/global";

    for (let i = 0; i < FAILURE_ALERT_THRESHOLD_PER_HOUR; i++) {
      recordEmailFailure(
        `org-${i}`,
        "graph",
        new EmailTransportError("graph", "Graph sendMail failed (500): x"),
      );
    }
    await flushPendingFailureWebhooksForTests();
    expect(fetcher).toHaveBeenCalled();
    const [url] = fetcher.mock.calls[0] as [string, FailureWebhookPayload];
    expect(url).toBe("https://hooks.example/global");
  });

  it("delivers both global and per-org alerts when both apply", async () => {
    const fetcher = vi.fn(async () => {});
    setFailureWebhookFetcherForTests(fetcher);
    process.env.EMAIL_FAILURE_WEBHOOK_URL = "https://hooks.example/global";
    setOrgFailureWebhookConfig("org-a", {
      url: "https://hooks.example/org-a",
    });

    for (let i = 0; i < FAILURE_ALERT_THRESHOLD_PER_HOUR; i++) {
      recordEmailFailure(
        "org-a",
        "graph",
        new EmailTransportError("graph", "Graph sendMail failed (500): x"),
      );
    }
    await flushPendingFailureWebhooksForTests();
    const urls = fetcher.mock.calls.map((c) => c[0]);
    expect(urls).toContain("https://hooks.example/global");
    expect(urls).toContain("https://hooks.example/org-a");
  });
});

describe("listFailureAlerts", () => {
  beforeEach(async () => {
    await resetFailureTrackerForTests();
  });

  // Insert N alert rows directly into the durable table at deterministic
  // timestamps so we can exercise the date-range / pagination logic in
  // isolation from the breach/webhook pipeline.
  async function seedAlerts(
    rows: Array<{
      tsMs: number;
      failureCount?: number;
      topTransport?: string | null;
      topErrorCode?: string | null;
      delivered?: boolean;
      thresholdBreached?: boolean;
      byOrg?: Record<string, { failureCount: number; topTransport: string | null; topErrorCode: string | null }>;
    }>,
  ) {
    await db.insert(emailFailureAlerts).values(
      rows.map((r) => ({
        ts: new Date(r.tsMs),
        failureCount: r.failureCount ?? 10,
        threshold: FAILURE_ALERT_THRESHOLD_PER_HOUR,
        thresholdBreached: r.thresholdBreached ?? true,
        topTransport: r.topTransport ?? "graph",
        topErrorCode: r.topErrorCode ?? "SEND_FAILED_500",
        delivered: r.delivered ?? true,
        byOrg: r.byOrg ?? {},
      })),
    );
  }

  const DAY = 24 * 60 * 60 * 1000;

  it("filters out rows outside [fromMs, toMs] and reports total honoring the filter", async () => {
    const now = Date.now();
    await seedAlerts([
      { tsMs: now - 10 * DAY }, // out (too old)
      { tsMs: now - 5 * DAY },  // in
      { tsMs: now - 3 * DAY },  // in
      { tsMs: now - 1 * DAY },  // in
      { tsMs: now },            // out (after upper bound)
    ]);

    const fromMs = now - 6 * DAY;
    const toMs = now - 12 * 60 * 60 * 1000; // 12h ago, excludes `now`
    const page = await listFailureAlerts({ fromMs, toMs, limit: 50 });

    expect(page.total).toBe(3);
    expect(page.alerts.length).toBe(3);
    for (const a of page.alerts) {
      expect(a.ts).toBeGreaterThanOrEqual(fromMs);
      expect(a.ts).toBeLessThanOrEqual(toMs);
    }
    // Most-recent first.
    expect(page.alerts[0].ts).toBeGreaterThan(page.alerts[1].ts);
    expect(page.alerts[1].ts).toBeGreaterThan(page.alerts[2].ts);
  });

  it("treats fromMs and toMs as inclusive bounds", async () => {
    const t = Date.now();
    await seedAlerts([
      { tsMs: t - 1000 },
      { tsMs: t },
      { tsMs: t + 1000 },
    ]);
    const page = await listFailureAlerts({ fromMs: t, toMs: t, limit: 10 });
    expect(page.total).toBe(1);
    expect(page.alerts[0].ts).toBe(t);
  });

  it("applies offset/limit pagination and keeps total independent of limit", async () => {
    const now = Date.now();
    // 7 alerts, 1 hour apart, oldest first.
    const rows = Array.from({ length: 7 }, (_, i) => ({
      tsMs: now - (7 - i) * 60 * 60 * 1000,
    }));
    await seedAlerts(rows);

    const page1 = await listFailureAlerts({ limit: 2, offset: 0 });
    const page2 = await listFailureAlerts({ limit: 2, offset: 2 });
    const page3 = await listFailureAlerts({ limit: 2, offset: 4 });
    const page4 = await listFailureAlerts({ limit: 2, offset: 6 });

    // Total ignores limit/offset.
    for (const p of [page1, page2, page3, page4]) {
      expect(p.total).toBe(7);
    }

    expect(page1.alerts.length).toBe(2);
    expect(page2.alerts.length).toBe(2);
    expect(page3.alerts.length).toBe(2);
    expect(page4.alerts.length).toBe(1); // tail page

    // No overlap between consecutive pages, and ordering is desc.
    const flat = [...page1.alerts, ...page2.alerts, ...page3.alerts, ...page4.alerts];
    const ts = flat.map((a) => a.ts);
    expect(new Set(ts).size).toBe(ts.length);
    for (let i = 1; i < ts.length; i++) {
      expect(ts[i - 1]).toBeGreaterThan(ts[i]);
    }

    // Offset past the end yields an empty slice but the same total.
    const empty = await listFailureAlerts({ limit: 2, offset: 100 });
    expect(empty.alerts).toEqual([]);
    expect(empty.total).toBe(7);
  });

  it("scopes to org and filters by date together; total reflects both filters", async () => {
    const now = Date.now();
    const sliceA = {
      "org-A": { failureCount: 8, topTransport: "graph", topErrorCode: "SEND_FAILED_500" },
      "org-B": { failureCount: 3, topTransport: "gmail", topErrorCode: "TIMEOUT" },
    };
    const sliceAOnly = {
      "org-A": { failureCount: 4, topTransport: "graph", topErrorCode: "SEND_FAILED_500" },
    };
    const sliceBOnly = {
      "org-B": { failureCount: 5, topTransport: "gmail", topErrorCode: "TIMEOUT" },
    };

    await seedAlerts([
      // Old A+B alert: outside the date filter we'll apply.
      { tsMs: now - 10 * DAY, byOrg: sliceA },
      // In-window: A only.
      { tsMs: now - 4 * DAY, byOrg: sliceAOnly },
      // In-window: A+B.
      { tsMs: now - 2 * DAY, byOrg: sliceA },
      // In-window: B only — should not be returned for org-A.
      { tsMs: now - 1 * DAY, byOrg: sliceBOnly },
    ]);

    const fromMs = now - 6 * DAY;
    const toMs = now;

    const aPage = await listFailureAlerts({
      fromMs,
      toMs,
      orgScope: "org-A",
      limit: 10,
    });
    // Only the two in-window alerts that have an org-A slice.
    expect(aPage.total).toBe(2);
    expect(aPage.alerts.length).toBe(2);
    // Per-org projection: failureCount/topTransport/topErrorCode come
    // from the org-A slice, not the cross-tenant aggregate.
    for (const a of aPage.alerts) {
      expect(a.topTransport).toBe("graph");
      expect(a.topErrorCode).toBe("SEND_FAILED_500");
      expect([4, 8]).toContain(a.failureCount);
      // org-A's slice (8) is below the threshold of 10 in one alert and
      // (4) in the other, so neither should be marked as breached for
      // the per-tenant view.
      expect(a.thresholdBreached).toBe(false);
    }

    // org-B sees only the two alerts where it contributed, both in-window.
    const bPage = await listFailureAlerts({
      fromMs,
      toMs,
      orgScope: "org-B",
      limit: 10,
    });
    expect(bPage.total).toBe(2);
    for (const a of bPage.alerts) {
      expect(a.topTransport).toBe("gmail");
      expect(a.topErrorCode).toBe("TIMEOUT");
    }

    // org with no contributing slice in-window sees nothing.
    const cPage = await listFailureAlerts({
      fromMs,
      toMs,
      orgScope: "org-C",
      limit: 10,
    });
    expect(cPage.total).toBe(0);
    expect(cPage.alerts).toEqual([]);
  });

  it("paginates the org-scoped, date-filtered result and keeps total stable across pages", async () => {
    const now = Date.now();
    const sliceA = {
      "org-A": { failureCount: 6, topTransport: "graph", topErrorCode: "SEND_FAILED_500" },
    };
    // 5 in-window alerts for org-A, plus 1 out-of-window and 1 for a different org.
    const rows = [
      { tsMs: now - 100 * DAY, byOrg: sliceA }, // out of window
      { tsMs: now - 5 * DAY, byOrg: sliceA },
      { tsMs: now - 4 * DAY, byOrg: sliceA },
      { tsMs: now - 3 * DAY, byOrg: sliceA },
      { tsMs: now - 2 * DAY, byOrg: sliceA },
      { tsMs: now - 1 * DAY, byOrg: sliceA },
      {
        tsMs: now - 6 * 60 * 60 * 1000,
        byOrg: { "org-Z": { failureCount: 2, topTransport: "smtp", topErrorCode: "TIMEOUT" } },
      }, // in window but wrong org
    ];
    await seedAlerts(rows);

    const fromMs = now - 7 * DAY;
    const toMs = now;

    const p1 = await listFailureAlerts({ fromMs, toMs, orgScope: "org-A", limit: 2, offset: 0 });
    const p2 = await listFailureAlerts({ fromMs, toMs, orgScope: "org-A", limit: 2, offset: 2 });
    const p3 = await listFailureAlerts({ fromMs, toMs, orgScope: "org-A", limit: 2, offset: 4 });

    expect(p1.total).toBe(5);
    expect(p2.total).toBe(5);
    expect(p3.total).toBe(5);

    expect(p1.alerts.length).toBe(2);
    expect(p2.alerts.length).toBe(2);
    expect(p3.alerts.length).toBe(1);

    const seen = [...p1.alerts, ...p2.alerts, ...p3.alerts].map((a) => a.ts);
    expect(new Set(seen).size).toBe(5);
  });

  it("clamps out-of-range offset and ignores non-finite date bounds", async () => {
    const now = Date.now();
    await seedAlerts([{ tsMs: now }, { tsMs: now - 1000 }, { tsMs: now - 2000 }]);

    // Negative offset clamps to 0; limit omitted falls back to default.
    const page = await listFailureAlerts({ offset: -50 });
    expect(page.total).toBe(3);
    // Default limit is 5, so all 3 should fit.
    expect(page.alerts.length).toBe(3);

    // Ignores non-finite from/to values rather than treating as an empty range.
    const page2 = await listFailureAlerts({ fromMs: Number.NaN, toMs: Number.NaN });
    expect(page2.total).toBe(3);
  });
});

describe("masked-recipient suppressions", () => {
  beforeEach(async () => {
    await resetFailureTrackerForTests();
  });

  it("derives a stable hash matching maskRecipient's suffix", async () => {
    const { maskRecipient, recipientHashFor, extractRecipientHashFromMasked } =
      await import("./failure-tracker");
    const masked = maskRecipient("Spam-Target@Example.COM")!;
    expect(masked).toMatch(/\(#[a-f0-9]{4}\)$/);
    const fromMask = extractRecipientHashFromMasked(masked);
    const fromRaw = recipientHashFor("spam-target@example.com");
    expect(fromMask).toBe(fromRaw);
  });

  it("suppresses subsequent sends for the same recipient (case-insensitive)", async () => {
    const {
      addMaskedRecipientSuppression,
      isRecipientSuppressed,
      maskRecipient,
      recordSuppressedSend,
      getSuppressedSendSummary,
      listMaskedRecipientSuppressions,
      removeMaskedRecipientSuppression,
      flushPendingSuppressedSendWritesForTests,
    } = await import("./failure-tracker");
    const masked = maskRecipient("chronic@example.com")!;
    const entry = await addMaskedRecipientSuppression("org-a", masked, {
      reason: "manual:test",
      addedBy: "user-1",
    });
    expect(entry).not.toBeNull();
    expect(entry!.hash).toMatch(/^[a-f0-9]{4}$/);

    expect(await isRecipientSuppressed("org-a", "Chronic@Example.com")).not.toBeNull();
    expect(await isRecipientSuppressed("org-other", "chronic@example.com")).toBeNull();
    expect(await isRecipientSuppressed("org-a", "different@example.com")).toBeNull();

    recordSuppressedSend("org-a", "smtp", "chronic@example.com");
    recordSuppressedSend("org-a", "graph", "chronic@example.com");
    await flushPendingSuppressedSendWritesForTests();

    const summary = getSuppressedSendSummary("org-a");
    expect(summary.totalSinceBoot).toBe(2);
    expect(summary.byTransport.smtp).toBe(1);
    expect(summary.byTransport.graph).toBe(1);
    expect(summary.activeSuppressions).toBe(1);

    const list = await listMaskedRecipientSuppressions("org-a");
    expect(list).toHaveLength(1);
    expect(list[0].suppressedSends).toBe(2);
    expect(list[0].lastSuppressedAt).not.toBeNull();

    expect(await removeMaskedRecipientSuppression("org-a", entry!.hash)).toBe(true);
    expect(await isRecipientSuppressed("org-a", "chronic@example.com")).toBeNull();
  });

  it("breaks the silenced-send count down by suppression reason bucket (task #309)", async () => {
    const {
      addMaskedRecipientSuppression,
      maskRecipient,
      recordSuppressedSend,
      getSuppressedSendSummary,
      flushPendingSuppressedSendWritesForTests,
    } = await import("./failure-tracker");

    // Three recipients, one per reason bucket. The detail suffix
    // ("hard", "abuse", "admin") must be folded into the top-level
    // bucket so admins see "5 bounce · 2 complaint · 1 manual".
    const bounce = maskRecipient("bouncey@example.com")!;
    const complaint = maskRecipient("complainer@example.com")!;
    const manual = maskRecipient("manual@example.com")!;
    await addMaskedRecipientSuppression("org-reason", bounce, {
      reason: "bounce:hard",
    });
    await addMaskedRecipientSuppression("org-reason", complaint, {
      reason: "complaint:abuse",
    });
    await addMaskedRecipientSuppression("org-reason", manual, {
      reason: "manual:admin",
    });

    for (let i = 0; i < 5; i++) {
      recordSuppressedSend("org-reason", "smtp", "bouncey@example.com");
    }
    recordSuppressedSend("org-reason", "graph", "complainer@example.com");
    recordSuppressedSend("org-reason", "graph", "complainer@example.com");
    recordSuppressedSend("org-reason", "smtp", "manual@example.com");
    await flushPendingSuppressedSendWritesForTests();

    const scoped = getSuppressedSendSummary("org-reason");
    expect(scoped.byReason).toEqual({ bounce: 5, complaint: 2, manual: 1 });
    // Other-org isolation: another tenant must not see this breakdown.
    const other = getSuppressedSendSummary("org-other");
    expect(other.byReason).toEqual({});

    // Global (cross-tenant) view sees the same totals.
    const global = getSuppressedSendSummary();
    expect(global.byReason.bounce).toBe(5);
    expect(global.byReason.complaint).toBe(2);
    expect(global.byReason.manual).toBe(1);
  });

  it("rejects masked strings that do not contain the (#xxxx) suffix", async () => {
    const { addMaskedRecipientSuppression } = await import("./failure-tracker");
    expect(await addMaskedRecipientSuppression("org-a", "not-a-mask")).toBeNull();
    expect(await addMaskedRecipientSuppression("org-a", "")).toBeNull();
  });

  it("persists suppressions and counter increments across a simulated restart", async () => {
    const {
      addMaskedRecipientSuppression,
      isRecipientSuppressed,
      maskRecipient,
      recordSuppressedSend,
      listMaskedRecipientSuppressions,
      flushPendingSuppressedSendWritesForTests,
      resetMaskedRecipientSuppressionCacheForTests,
    } = await import("./failure-tracker");

    const masked = maskRecipient("survivor@example.com")!;
    const added = await addMaskedRecipientSuppression("org-restart", masked, {
      reason: "manual:test",
      addedBy: "user-1",
    });
    expect(added).not.toBeNull();

    // Simulate suppressed sends and wait for the counter to persist.
    recordSuppressedSend("org-restart", "smtp", "survivor@example.com");
    recordSuppressedSend("org-restart", "graph", "survivor@example.com");
    recordSuppressedSend("org-restart", "smtp", "survivor@example.com");
    await flushPendingSuppressedSendWritesForTests();

    // Confirm the row landed in the durable table.
    const dbRows = await db.select().from(emailRecipientSuppressions);
    expect(dbRows.length).toBe(1);
    expect(dbRows[0].orgId).toBe("org-restart");
    expect(dbRows[0].suppressedSends).toBe(3);
    expect(dbRows[0].lastSuppressedAt).not.toBeNull();

    // Drop the in-memory cache (models a server restart) and re-read.
    // The suppression must still apply and the counter must be intact.
    resetMaskedRecipientSuppressionCacheForTests();
    expect(
      await isRecipientSuppressed("org-restart", "survivor@example.com"),
    ).not.toBeNull();
    const list = await listMaskedRecipientSuppressions("org-restart");
    expect(list).toHaveLength(1);
    expect(list[0].suppressedSends).toBe(3);
    expect(list[0].reason).toBe("manual:test");
    expect(list[0].addedBy).toBe("user-1");
  });

  it("flags a silenced-send spike when the per-hour threshold is crossed", async () => {
    const {
      addMaskedRecipientSuppression,
      maskRecipient,
      recordSuppressedSend,
      getSuppressedSendSummary,
      flushPendingSuppressedSendWritesForTests,
      DEFAULT_SUPPRESSED_ALERT_THRESHOLD_PER_HOUR,
    } = await import("./failure-tracker");

    const prevEnv = process.env.EMAIL_SUPPRESSED_ALERT_THRESHOLD_PER_HOUR;
    process.env.EMAIL_SUPPRESSED_ALERT_THRESHOLD_PER_HOUR = "3";
    try {
      const masked = maskRecipient("noisy@example.com")!;
      await addMaskedRecipientSuppression("org-spike", masked);

      const before = getSuppressedSendSummary("org-spike");
      expect(before.threshold.perHour).toBe(3);
      expect(before.threshold.breached).toBe(false);
      expect(before.windowCount).toBe(0);

      recordSuppressedSend("org-spike", "smtp", "noisy@example.com");
      recordSuppressedSend("org-spike", "smtp", "noisy@example.com");
      const partial = getSuppressedSendSummary("org-spike");
      expect(partial.windowCount).toBe(2);
      expect(partial.threshold.breached).toBe(false);

      recordSuppressedSend("org-spike", "graph", "noisy@example.com");
      await flushPendingSuppressedSendWritesForTests();

      const breached = getSuppressedSendSummary("org-spike");
      expect(breached.windowCount).toBe(3);
      expect(breached.threshold.breached).toBe(true);

      // Other orgs are not affected by another tenant's spike.
      const otherOrg = getSuppressedSendSummary("org-other");
      expect(otherOrg.windowCount).toBe(0);
      expect(otherOrg.threshold.breached).toBe(false);

      expect(DEFAULT_SUPPRESSED_ALERT_THRESHOLD_PER_HOUR).toBeGreaterThan(0);
    } finally {
      if (prevEnv === undefined) {
        delete process.env.EMAIL_SUPPRESSED_ALERT_THRESHOLD_PER_HOUR;
      } else {
        process.env.EMAIL_SUPPRESSED_ALERT_THRESHOLD_PER_HOUR = prevEnv;
      }
    }
  });

  it("fires the global webhook with a distinct payload when silenced sends spike (Task #313)", async () => {
    const {
      addMaskedRecipientSuppression,
      maskRecipient,
      recordSuppressedSend,
      flushPendingSuppressedSendWritesForTests,
    } = await import("./failure-tracker");

    const prevThr = process.env.EMAIL_SUPPRESSED_ALERT_THRESHOLD_PER_HOUR;
    const prevUrl = process.env.EMAIL_FAILURE_WEBHOOK_URL;
    process.env.EMAIL_SUPPRESSED_ALERT_THRESHOLD_PER_HOUR = "3";
    process.env.EMAIL_FAILURE_WEBHOOK_URL = "https://hooks.example.com/silenced";

    const calls: Array<{ url: string; payload: FailureWebhookPayload }> = [];
    setFailureWebhookFetcherForTests(async (url, payload) => {
      calls.push({ url, payload });
    });

    try {
      const masked = maskRecipient("noisy@example.com")!;
      await addMaskedRecipientSuppression("org-spike-313", masked);

      // Two silenced sends: under threshold, no webhook.
      recordSuppressedSend("org-spike-313", "smtp", "noisy@example.com");
      recordSuppressedSend("org-spike-313", "smtp", "noisy@example.com");
      await flushPendingSuppressedSendWritesForTests();
      await flushPendingFailureWebhooksForTests();
      expect(calls.length).toBe(0);

      // Third silenced send crosses the threshold — webhook must fire.
      recordSuppressedSend("org-spike-313", "graph", "noisy@example.com");
      await flushPendingSuppressedSendWritesForTests();
      await flushPendingFailureWebhooksForTests();

      expect(calls.length).toBe(1);
      const { url, payload } = calls[0];
      expect(url).toBe("https://hooks.example.com/silenced");
      // Distinct payload shape — kind discriminator + suppressions link
      // back to the Suppressed tab + dedicated text the existing
      // transport-failure payload would never produce.
      expect(payload.alertKind).toBe("suppressed_spike");
      expect(payload.suppressionsUrl).toContain("suppressed");
      expect(payload.text).toMatch(/Silenced-send spike/i);
      expect(payload.text).toMatch(/Suppressed tab/i);
      expect(payload.failureCount).toBe(3);
      expect(payload.threshold).toBe(3);
      expect(payload.topErrorCode).toBe("SUPPRESSED_SEND_SPIKE");

      // Cooldown: a subsequent silenced send within the cooldown window
      // must not fire a second webhook.
      recordSuppressedSend("org-spike-313", "smtp", "noisy@example.com");
      await flushPendingSuppressedSendWritesForTests();
      await flushPendingFailureWebhooksForTests();
      expect(calls.length).toBe(1);

      // The alert must land in the durable history alongside
      // transport-failure alerts so admins can see it in the alert
      // history view.
      const alertRows = await db
        .select()
        .from(emailFailureAlerts)
        .orderBy(desc(emailFailureAlerts.ts));
      const spike = alertRows.find(
        (r) => r.alertKind === "suppressed_spike",
      );
      expect(spike).toBeTruthy();
      expect(spike!.delivered).toBe(true);
      expect(spike!.failureCount).toBe(3);
      expect(spike!.threshold).toBe(3);
      const sliceFromDb = spike!.byOrg["org-spike-313"];
      expect(sliceFromDb).toBeTruthy();
      expect(sliceFromDb!.failureCount).toBe(3);
    } finally {
      setFailureWebhookFetcherForTests(null);
      if (prevThr === undefined) {
        delete process.env.EMAIL_SUPPRESSED_ALERT_THRESHOLD_PER_HOUR;
      } else {
        process.env.EMAIL_SUPPRESSED_ALERT_THRESHOLD_PER_HOUR = prevThr;
      }
      if (prevUrl === undefined) {
        delete process.env.EMAIL_FAILURE_WEBHOOK_URL;
      } else {
        process.env.EMAIL_FAILURE_WEBHOOK_URL = prevUrl;
      }
    }
  });

  it("surfaces silenced-send-spike alerts via getRecentFailureAlerts for tenant admins (Task #313)", async () => {
    const {
      addMaskedRecipientSuppression,
      maskRecipient,
      recordSuppressedSend,
      flushPendingSuppressedSendWritesForTests,
      getRecentFailureAlerts,
    } = await import("./failure-tracker");

    const prevThr = process.env.EMAIL_SUPPRESSED_ALERT_THRESHOLD_PER_HOUR;
    const prevUrl = process.env.EMAIL_FAILURE_WEBHOOK_URL;
    process.env.EMAIL_SUPPRESSED_ALERT_THRESHOLD_PER_HOUR = "2";
    process.env.EMAIL_FAILURE_WEBHOOK_URL = "https://hooks.example.com/silenced2";
    setFailureWebhookFetcherForTests(async () => {});

    try {
      const masked = maskRecipient("bulk@example.com")!;
      await addMaskedRecipientSuppression("org-history-313", masked);
      recordSuppressedSend("org-history-313", "smtp", "bulk@example.com");
      recordSuppressedSend("org-history-313", "smtp", "bulk@example.com");
      await flushPendingSuppressedSendWritesForTests();
      await flushPendingFailureWebhooksForTests();

      const tenantView = await getRecentFailureAlerts(10, "org-history-313");
      const tenantSpike = tenantView.find(
        (a) => a.alertKind === "suppressed_spike",
      );
      expect(tenantSpike).toBeTruthy();
      expect(tenantSpike!.failureCount).toBe(2);
      expect(tenantSpike!.thresholdBreached).toBe(true);

      // Other tenants don't see this alert in their projection.
      const otherView = await getRecentFailureAlerts(10, "org-other-313");
      expect(
        otherView.find((a) => a.alertKind === "suppressed_spike"),
      ).toBeUndefined();

      // Operator (no orgScope) sees the same alert with byOrg attached.
      const opView = await listFailureAlerts({
        limit: 10,
        includeByOrg: true,
      });
      const opSpike = opView.alerts.find(
        (a) => a.alertKind === "suppressed_spike",
      );
      expect(opSpike).toBeTruthy();
      expect(opSpike!.byOrg?.["org-history-313"]?.failureCount).toBe(2);
    } finally {
      setFailureWebhookFetcherForTests(null);
      if (prevThr === undefined) {
        delete process.env.EMAIL_SUPPRESSED_ALERT_THRESHOLD_PER_HOUR;
      } else {
        process.env.EMAIL_SUPPRESSED_ALERT_THRESHOLD_PER_HOUR = prevThr;
      }
      if (prevUrl === undefined) {
        delete process.env.EMAIL_FAILURE_WEBHOOK_URL;
      } else {
        process.env.EMAIL_FAILURE_WEBHOOK_URL = prevUrl;
      }
    }
  });
});

describe("pruneStaleRecipientSuppressions", () => {
  beforeEach(async () => {
    await resetFailureTrackerForTests();
  });

  it("removes suppressions whose effective last activity is older than the retention window", async () => {
    const {
      pruneStaleRecipientSuppressions,
      listMaskedRecipientSuppressions,
    } = await import("./failure-tracker");

    const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ORG = `t276-${RUN}`;
    await db
      .insert(orgs)
      .values({ id: ORG, name: `Acme ${RUN}`, slug: `t276-${RUN}` });

    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const longAgo = new Date(now - 200 * day);
    const recent = new Date(now - 5 * day);

    await db.insert(emailRecipientSuppressions).values([
      {
        orgId: ORG,
        hash: "aaaa",
        maskedRecipient: "a***@e***.com (#aaaa)",
        reason: "bounce:hard",
        addedAt: longAgo,
        lastSuppressedAt: longAgo,
        suppressedSends: 4,
      },
      {
        orgId: ORG,
        hash: "bbbb",
        maskedRecipient: "b***@e***.com (#bbbb)",
        reason: "manual:admin",
        addedAt: longAgo,
        lastSuppressedAt: null,
        suppressedSends: 0,
      },
      {
        orgId: ORG,
        hash: "cccc",
        maskedRecipient: "c***@e***.com (#cccc)",
        reason: "bounce:hard",
        addedAt: longAgo,
        lastSuppressedAt: recent,
        suppressedSends: 1,
      },
      {
        orgId: ORG,
        hash: "dddd",
        maskedRecipient: "d***@e***.com (#dddd)",
        reason: "manual:admin",
        addedAt: recent,
        lastSuppressedAt: null,
        suppressedSends: 0,
      },
    ]);

    // Hydrate the in-memory cache so we can confirm the prune drops
    // entries from it, not just the table.
    const before = await listMaskedRecipientSuppressions(ORG);
    expect(before).toHaveLength(4);

    const stats = await pruneStaleRecipientSuppressions(now);
    expect(stats.retentionDays).toBe(90);
    expect(stats.deleted).toBe(2);
    expect(stats.cutoff).toBeInstanceOf(Date);

    const remaining = await db
      .select()
      .from(emailRecipientSuppressions)
      .where(eq(emailRecipientSuppressions.orgId, ORG));
    const remainingHashes = remaining.map((r) => r.hash).sort();
    expect(remainingHashes).toEqual(["cccc", "dddd"]);

    // The in-memory cache must reflect the deletes too.
    const after = await listMaskedRecipientSuppressions(ORG);
    const afterHashes = after.map((e) => e.hash).sort();
    expect(afterHashes).toEqual(["cccc", "dddd"]);

    // Audit entries are written for each removed row.
    const audits = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.orgId, ORG));
    const expired = audits.filter(
      (a) => a.action === "EMAIL_RECIPIENT_SUPPRESSION_AUTO_EXPIRED",
    );
    expect(expired).toHaveLength(2);
    const auditHashes = expired.map((a) => a.entityId).sort();
    expect(auditHashes).toEqual(["aaaa", "bbbb"]);
    for (const entry of expired) {
      const details = entry.details as Record<string, unknown>;
      expect(details.retentionDays).toBe(90);
      expect(typeof details.cutoff).toBe("string");
      expect(typeof details.maskedRecipient).toBe("string");
    }
  });

  it("respects EMAIL_RECIPIENT_SUPPRESSION_RETENTION_DAYS override", async () => {
    const { pruneStaleRecipientSuppressions, getRecipientSuppressionRetentionDays } =
      await import("./failure-tracker");

    const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ORG = `t276o-${RUN}`;
    await db
      .insert(orgs)
      .values({ id: ORG, name: `Beta ${RUN}`, slug: `t276o-${RUN}` });

    const original = process.env.EMAIL_RECIPIENT_SUPPRESSION_RETENTION_DAYS;
    process.env.EMAIL_RECIPIENT_SUPPRESSION_RETENTION_DAYS = "14";
    try {
      expect(getRecipientSuppressionRetentionDays()).toBe(14);

      const now = Date.now();
      const day = 24 * 60 * 60 * 1000;
      const fifteenDaysAgo = new Date(now - 15 * day);
      const tenDaysAgo = new Date(now - 10 * day);

      await db.insert(emailRecipientSuppressions).values([
        {
          orgId: ORG,
          hash: "1111",
          maskedRecipient: "x***@e***.com (#1111)",
          reason: "bounce:hard",
          addedAt: fifteenDaysAgo,
          lastSuppressedAt: fifteenDaysAgo,
          suppressedSends: 1,
        },
        {
          orgId: ORG,
          hash: "2222",
          maskedRecipient: "y***@e***.com (#2222)",
          reason: "manual:admin",
          addedAt: tenDaysAgo,
          lastSuppressedAt: null,
          suppressedSends: 0,
        },
      ]);

      const stats = await pruneStaleRecipientSuppressions(now);
      expect(stats.retentionDays).toBe(14);
      expect(stats.deleted).toBe(1);

      const remaining = await db
        .select()
        .from(emailRecipientSuppressions)
        .where(eq(emailRecipientSuppressions.orgId, ORG));
      expect(remaining).toHaveLength(1);
      expect(remaining[0].hash).toBe("2222");
    } finally {
      if (original === undefined)
        delete process.env.EMAIL_RECIPIENT_SUPPRESSION_RETENTION_DAYS;
      else process.env.EMAIL_RECIPIENT_SUPPRESSION_RETENTION_DAYS = original;
    }
  });

  it("does not evict cache or audit a row whose last_suppressed_at was bumped to recent before the delete ran", async () => {
    const {
      pruneStaleRecipientSuppressions,
      listMaskedRecipientSuppressions,
    } = await import("./failure-tracker");

    const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ORG = `t276r-${RUN}`;
    await db
      .insert(orgs)
      .values({ id: ORG, name: `Race ${RUN}`, slug: `t276r-${RUN}` });

    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const longAgo = new Date(now - 200 * day);

    await db.insert(emailRecipientSuppressions).values({
      orgId: ORG,
      hash: "race",
      maskedRecipient: "r***@e***.com (#race)",
      reason: "bounce:hard",
      addedAt: longAgo,
      lastSuppressedAt: longAgo,
      suppressedSends: 1,
    });

    // Hydrate cache.
    expect(await listMaskedRecipientSuppressions(ORG)).toHaveLength(1);

    // Simulate the race: a concurrent send bumps last_suppressed_at to
    // "now" before our prune's DELETE runs. The atomic
    // DELETE...RETURNING must skip this row.
    await db
      .update(emailRecipientSuppressions)
      .set({ lastSuppressedAt: new Date(now) })
      .where(
        and(
          eq(emailRecipientSuppressions.orgId, ORG),
          eq(emailRecipientSuppressions.hash, "race"),
        ),
      );

    const stats = await pruneStaleRecipientSuppressions(now);
    expect(stats.deleted).toBe(0);

    // Row still in DB.
    const remaining = await db
      .select()
      .from(emailRecipientSuppressions)
      .where(eq(emailRecipientSuppressions.orgId, ORG));
    expect(remaining).toHaveLength(1);

    // Cache still contains the entry — critical, since cache eviction
    // without DB removal would silently un-suppress the recipient.
    const after = await listMaskedRecipientSuppressions(ORG);
    expect(after).toHaveLength(1);
    expect(after[0].hash).toBe("race");

    // No spurious audit entry was written.
    const audits = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.orgId, ORG));
    const expired = audits.filter(
      (a) => a.action === "EMAIL_RECIPIENT_SUPPRESSION_AUTO_EXPIRED",
    );
    expect(expired).toHaveLength(0);
  });

  it("returns deleted=0 when nothing is stale", async () => {
    const { pruneStaleRecipientSuppressions } = await import("./failure-tracker");
    const stats = await pruneStaleRecipientSuppressions(Date.now());
    expect(stats.deleted).toBe(0);
    expect(stats.retentionDays).toBe(90);
  });
});
