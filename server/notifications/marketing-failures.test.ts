import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMailMock = vi.fn();
const createTransporterMock = vi.fn(() => ({ sendMail: sendMailMock }));
vi.mock("../email/smtp-transport", () => ({
  createEnvTransporter: () => createTransporterMock(),
}));

const listCampaignFailedRecipientsMock = vi.fn();
vi.mock("../storage", () => ({
  storage: {
    listCampaignFailedRecipients: (...args: unknown[]) =>
      listCampaignFailedRecipientsMock(...args),
  },
}));

const adminQueryMock = vi.fn();
const orgQueryMock = vi.fn();
const dueRowsMock = vi.fn(() => Promise.resolve([] as any[]));
const insertValuesMock = vi.fn(() => Promise.resolve());
const deleteWhereMock = vi.fn(() => Promise.resolve());
vi.mock("../db", () => {
  const orgChain = {
    from: () => ({ where: () => orgQueryMock() }),
  };
  const adminChain = {
    from: () => ({
      leftJoin: () => ({ where: () => adminQueryMock() }),
    }),
  };
  // Flush path: db.select().from(pendingAdminNotifications).where(...)
  const dueChain = {
    from: () => ({ where: () => dueRowsMock() }),
  };
  let calls = 0;
  return {
    db: {
      select: () => {
        calls++;
        // Pattern: org → admins for each notify call. Tests that exercise
        // the flush path call `flushPendingAdminNotifications` directly
        // and pre-set `__nextSelectIsDue = true` to route to the due
        // chain.
        if ((globalThis as any).__nextSelectIsDue) {
          (globalThis as any).__nextSelectIsDue = false;
          return dueChain;
        }
        return calls % 2 === 1 ? orgChain : adminChain;
      },
      insert: () => ({ values: (v: any) => insertValuesMock(v) }),
      delete: () => ({ where: (w: any) => deleteWhereMock(w) }),
    },
    // Real pool is unavailable in the unit-test env. Always-acquire so
    // the flush proceeds; advisory unlock is a no-op.
    pool: {
      connect: async () => ({
        query: async (sql: string) => {
          if (sql.includes("pg_try_advisory_lock")) {
            return { rows: [{ acquired: true }] };
          }
          return { rows: [] };
        },
        release: () => {},
      }),
    },
  };
});

import {
  summarizeFailures,
  buildCampaignDigestEmail,
  buildSequenceStepAlertEmail,
  buildSequenceFailureDigestEmail,
  notifyAdminsOfCampaignFailures,
  notifyAdminsOfSequenceStepPermanentFailure,
  flushPendingAdminNotifications,
  classifyAdminDelivery,
  flushSequenceFailureDigest,
  flushAllSequenceFailureDigests,
  setSequenceFailureDigestIntervalMs,
  _resetSequenceFailureDigests,
  _pendingSequenceDigestCount,
  FAILURE_DIGEST_MAX_ADDRESSES,
} from "./marketing-failures";

beforeEach(() => {
  sendMailMock.mockReset();
  createTransporterMock.mockReset();
  createTransporterMock.mockImplementation(() => ({ sendMail: sendMailMock }));
  listCampaignFailedRecipientsMock.mockReset();
  adminQueryMock.mockReset();
  orgQueryMock.mockReset();
  dueRowsMock.mockReset();
  dueRowsMock.mockImplementation(() => Promise.resolve([]));
  insertValuesMock.mockReset();
  insertValuesMock.mockImplementation(() => Promise.resolve());
  deleteWhereMock.mockReset();
  deleteWhereMock.mockImplementation(() => Promise.resolve());
  (globalThis as any).__nextSelectIsDue = false;
  _resetSequenceFailureDigests();
  setSequenceFailureDigestIntervalMs(60 * 60 * 1000);
});

describe("summarizeFailures", () => {
  it("counts permanent vs pending and dedupes sample addresses", () => {
    const rows = [
      { recipientEmail: "a@x.com", status: "permanent_failure" as const, errorCode: "VALIDATION_ERROR" },
      { recipientEmail: "a@x.com", status: "permanent_failure" as const, errorCode: "VALIDATION_ERROR" },
      { recipientEmail: "b@x.com", status: "permanent_failure" as const, errorCode: "SMTP_550" },
      { recipientEmail: "c@x.com", status: "failed" as const, errorCode: "TIMEOUT" },
    ];
    const s = summarizeFailures(rows);
    expect(s.totalCount).toBe(4);
    expect(s.permanentCount).toBe(3);
    expect(s.pendingRetryCount).toBe(1);
    expect(s.sampleAddresses).toEqual(["a@x.com", "b@x.com"]);
    expect(s.errorCodeCounts[0]).toEqual({ code: "VALIDATION_ERROR", count: 2 });
  });

  it("caps sample addresses to the configured maximum", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      recipientEmail: `r${i}@x.com`,
      status: "permanent_failure" as const,
      errorCode: "X",
    }));
    const s = summarizeFailures(rows);
    expect(s.sampleAddresses.length).toBe(FAILURE_DIGEST_MAX_ADDRESSES);
  });

  it("treats null error codes as UNKNOWN", () => {
    const rows = [
      { recipientEmail: "a@x.com", status: "permanent_failure" as const, errorCode: null },
    ];
    const s = summarizeFailures(rows);
    expect(s.errorCodeCounts[0].code).toBe("UNKNOWN");
  });
});

describe("buildCampaignDigestEmail", () => {
  it("includes campaign name, counts, addresses, and codes", () => {
    const summary = summarizeFailures([
      { recipientEmail: "a@x.com", status: "permanent_failure", errorCode: "SMTP_550" },
      { recipientEmail: "b@x.com", status: "permanent_failure", errorCode: "SMTP_550" },
    ]);
    const m = buildCampaignDigestEmail({
      orgName: "Acme",
      campaignName: "Spring Promo",
      recipientCount: 10,
      summary,
    });
    expect(m.subject).toContain("Spring Promo");
    expect(m.subject).toContain("2 recipients did not receive");
    expect(m.text).toContain("Acme");
    expect(m.text).toContain("a@x.com");
    expect(m.text).toContain("SMTP_550 x 2");
    expect(m.html).toContain("a@x.com");
    expect(m.html).toContain("SMTP_550");
  });

  it("escapes HTML in campaign name and addresses", () => {
    const summary = summarizeFailures([
      { recipientEmail: "a<script>@x.com", status: "permanent_failure", errorCode: "X" },
    ]);
    const m = buildCampaignDigestEmail({
      orgName: "<Acme>",
      campaignName: "<b>Promo</b>",
      recipientCount: 1,
      summary,
    });
    expect(m.html).not.toContain("<b>Promo</b>");
    expect(m.html).toContain("&lt;b&gt;Promo&lt;/b&gt;");
    expect(m.html).toContain("a&lt;script&gt;@x.com");
  });

  it("uses singular noun for a single failure", () => {
    const summary = summarizeFailures([
      { recipientEmail: "a@x.com", status: "permanent_failure", errorCode: "X" },
    ]);
    const m = buildCampaignDigestEmail({
      orgName: "Acme",
      campaignName: "Promo",
      recipientCount: 1,
      summary,
    });
    expect(m.subject).toContain("1 recipient did not receive");
  });
});

describe("buildSequenceStepAlertEmail", () => {
  it("displays 1-indexed step number and includes error info", () => {
    const m = buildSequenceStepAlertEmail({
      orgName: "Acme",
      sequenceName: "Onboarding",
      stepIndex: 2,
      recipientEmail: "a@x.com",
      errorCode: "SMTP_550",
      errorMessage: "Recipient address rejected",
      attemptCount: 5,
    });
    expect(m.subject).toContain("Step 3");
    expect(m.subject).toContain("Onboarding");
    expect(m.subject).toContain("a@x.com");
    expect(m.text).toContain("after 5 attempts");
    expect(m.text).toContain("SMTP_550");
    expect(m.text).toContain("Recipient address rejected");
  });

  it("handles single attempt singularization and missing message", () => {
    const m = buildSequenceStepAlertEmail({
      orgName: "Acme",
      sequenceName: "Drip",
      stepIndex: 0,
      recipientEmail: "z@x.com",
      errorCode: null,
      errorMessage: null,
      attemptCount: 1,
    });
    expect(m.text).toContain("after 1 attempt ");
    expect(m.text).toContain("UNKNOWN");
    expect(m.text).not.toContain("Last error:");
  });
});

describe("notifyAdminsOfCampaignFailures", () => {
  it("skips notification when there are zero permanent failures", async () => {
    listCampaignFailedRecipientsMock.mockResolvedValue([
      { recipientEmail: "a@x.com", status: "failed", errorCode: "TIMEOUT" },
    ]);
    const r = await notifyAdminsOfCampaignFailures(
      { id: "c1", orgId: "o1", name: "Promo" },
      10,
    );
    expect(r).toEqual({ notified: 0, permanentCount: 0 });
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("emails each opted-in admin with the digest", async () => {
    listCampaignFailedRecipientsMock.mockResolvedValue([
      { recipientEmail: "a@x.com", status: "permanent_failure", errorCode: "SMTP_550" },
      { recipientEmail: "b@x.com", status: "permanent_failure", errorCode: "SMTP_550" },
    ]);
    orgQueryMock.mockResolvedValue([{ name: "Acme" }]);
    adminQueryMock.mockResolvedValue([
      { email: "admin1@x.com", name: "One" },
      { email: "admin2@x.com", name: "Two" },
    ]);

    const r = await notifyAdminsOfCampaignFailures(
      { id: "c1", orgId: "o1", name: "Promo" },
      10,
    );
    expect(r).toEqual({ notified: 2, permanentCount: 2 });
    expect(sendMailMock).toHaveBeenCalledTimes(2);
    const args = sendMailMock.mock.calls[0][0];
    expect(args.to).toBe("admin1@x.com");
    expect(args.subject).toContain("Promo");
    expect(args.text).toContain("Acme");
  });

  it("returns notified=0 with a warning when no admins are opted in", async () => {
    listCampaignFailedRecipientsMock.mockResolvedValue([
      { recipientEmail: "a@x.com", status: "permanent_failure", errorCode: "X" },
    ]);
    orgQueryMock.mockResolvedValue([{ name: "Acme" }]);
    adminQueryMock.mockResolvedValue([]);
    const r = await notifyAdminsOfCampaignFailures(
      { id: "c1", orgId: "o1", name: "Promo" },
      1,
    );
    expect(r).toEqual({ notified: 0, permanentCount: 1 });
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("skips when no SMTP transporter is configured", async () => {
    listCampaignFailedRecipientsMock.mockResolvedValue([
      { recipientEmail: "a@x.com", status: "permanent_failure", errorCode: "X" },
    ]);
    orgQueryMock.mockResolvedValue([{ name: "Acme" }]);
    adminQueryMock.mockResolvedValue([{ email: "admin@x.com", name: "A" }]);
    createTransporterMock.mockImplementation(() => null);
    const r = await notifyAdminsOfCampaignFailures(
      { id: "c1", orgId: "o1", name: "Promo" },
      1,
    );
    expect(r?.notified).toBe(1);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("swallows errors from the storage layer", async () => {
    listCampaignFailedRecipientsMock.mockRejectedValue(new Error("db down"));
    const r = await notifyAdminsOfCampaignFailures(
      { id: "c1", orgId: "o1", name: "Promo" },
      1,
    );
    expect(r).toBeNull();
    expect(sendMailMock).not.toHaveBeenCalled();
  });
});

describe("buildSequenceFailureDigestEmail", () => {
  it("groups failures by step, lists samples, and aggregates error codes", () => {
    const m = buildSequenceFailureDigestEmail({
      orgName: "Acme",
      sequenceName: "Onboarding",
      failures: [
        {
          stepIndex: 0,
          recipientEmail: "a@x.com",
          errorCode: "SMTP_550",
          errorMessage: null,
          attemptCount: 5,
          occurredAt: new Date(),
        },
        {
          stepIndex: 0,
          recipientEmail: "b@x.com",
          errorCode: "SMTP_550",
          errorMessage: null,
          attemptCount: 5,
          occurredAt: new Date(),
        },
        {
          stepIndex: 2,
          recipientEmail: "c@x.com",
          errorCode: "VALIDATION_ERROR",
          errorMessage: null,
          attemptCount: 3,
          occurredAt: new Date(),
        },
      ],
    });
    expect(m.subject).toContain("3 recipients permanently failed");
    expect(m.text).toContain("Step 1 — 2 failed");
    expect(m.text).toContain("Step 3 — 1 failed");
    expect(m.text).toContain("a@x.com");
    expect(m.text).toContain("SMTP_550 x 2");
    expect(m.text).toContain("VALIDATION_ERROR x 1");
    expect(m.html).toContain("Step 1");
    expect(m.html).toContain("a@x.com");
  });

  it("uses singular noun for a single failure and lists every recipient (no truncation)", () => {
    const failures = Array.from({ length: 12 }, (_, i) => ({
      stepIndex: 0,
      recipientEmail: `r${i}@x.com`,
      errorCode: "X",
      errorMessage: null,
      attemptCount: 1,
      occurredAt: new Date(),
    }));
    const m = buildSequenceFailureDigestEmail({
      orgName: "Acme",
      sequenceName: "Drip",
      failures: [failures[0]],
    });
    expect(m.subject).toContain("1 recipient permanently failed");

    const big = buildSequenceFailureDigestEmail({
      orgName: "Acme",
      sequenceName: "Drip",
      failures,
    });
    // Every one of the 12 recipients must appear — the digest is the
    // authoritative record for the window, so we never truncate.
    for (const f of failures) {
      expect(big.text).toContain(f.recipientEmail);
      expect(big.html).toContain(f.recipientEmail);
    }
    expect(big.text).not.toContain("…and");
    expect(big.html).not.toContain("…and");
  });

  it("includes every distinct error code (no top-N truncation)", () => {
    const failures = Array.from({ length: 8 }, (_, i) => ({
      stepIndex: 0,
      recipientEmail: `r${i}@x.com`,
      errorCode: `CODE_${i}`,
      errorMessage: null,
      attemptCount: 1,
      occurredAt: new Date(),
    }));
    const m = buildSequenceFailureDigestEmail({
      orgName: "Acme",
      sequenceName: "Drip",
      failures,
    });
    for (let i = 0; i < 8; i++) {
      expect(m.text).toContain(`CODE_${i} x 1`);
    }
  });
});

describe("notifyAdminsOfSequenceStepPermanentFailure (digest)", () => {
  it("queues failures without sending email until the digest flushes", async () => {
    const r1 = await notifyAdminsOfSequenceStepPermanentFailure(
      { id: "s1", orgId: "o1", name: "Onboarding" },
      {
        stepIndex: 1,
        recipientEmail: "a@x.com",
        errorCode: "VALIDATION_ERROR",
        errorMessage: "Bad address",
        attemptCount: 3,
      },
    );
    const r2 = await notifyAdminsOfSequenceStepPermanentFailure(
      { id: "s1", orgId: "o1", name: "Onboarding" },
      {
        stepIndex: 1,
        recipientEmail: "b@x.com",
        errorCode: "SMTP_550",
        errorMessage: null,
        attemptCount: 5,
      },
    );
    expect(r1).toEqual({ queued: true, queuedFailures: 1 });
    expect(r2).toEqual({ queued: true, queuedFailures: 2 });
    expect(sendMailMock).not.toHaveBeenCalled();
    expect(_pendingSequenceDigestCount()).toBe(1);
  });

  it("flushSequenceFailureDigest sends one digest per sequence with all queued failures", async () => {
    await notifyAdminsOfSequenceStepPermanentFailure(
      { id: "s1", orgId: "o1", name: "Onboarding" },
      {
        stepIndex: 0,
        recipientEmail: "a@x.com",
        errorCode: "SMTP_550",
        errorMessage: null,
        attemptCount: 5,
      },
    );
    await notifyAdminsOfSequenceStepPermanentFailure(
      { id: "s1", orgId: "o1", name: "Onboarding" },
      {
        stepIndex: 1,
        recipientEmail: "b@x.com",
        errorCode: "VALIDATION_ERROR",
        errorMessage: "Bad",
        attemptCount: 3,
      },
    );

    orgQueryMock.mockResolvedValue([{ name: "Acme" }]);
    adminQueryMock.mockResolvedValue([
      { email: "admin1@x.com", name: "One" },
      { email: "admin2@x.com", name: "Two" },
    ]);

    const r = await flushSequenceFailureDigest("s1");
    expect(r).toEqual({ notified: 2, failureCount: 2 });
    expect(sendMailMock).toHaveBeenCalledTimes(2);
    const args = sendMailMock.mock.calls[0][0];
    expect(args.subject).toContain("Onboarding");
    expect(args.subject).toContain("2 recipients permanently failed");
    expect(args.text).toContain("a@x.com");
    expect(args.text).toContain("b@x.com");
    expect(args.text).toContain("Step 1 — 1 failed");
    expect(args.text).toContain("Step 2 — 1 failed");
    expect(_pendingSequenceDigestCount()).toBe(0);
  });

  it("keeps separate digests per sequence", async () => {
    await notifyAdminsOfSequenceStepPermanentFailure(
      { id: "s1", orgId: "o1", name: "Seq A" },
      {
        stepIndex: 0,
        recipientEmail: "a@x.com",
        errorCode: "X",
        errorMessage: null,
        attemptCount: 1,
      },
    );
    await notifyAdminsOfSequenceStepPermanentFailure(
      { id: "s2", orgId: "o1", name: "Seq B" },
      {
        stepIndex: 0,
        recipientEmail: "b@x.com",
        errorCode: "Y",
        errorMessage: null,
        attemptCount: 1,
      },
    );
    expect(_pendingSequenceDigestCount()).toBe(2);

    orgQueryMock.mockResolvedValue([{ name: "Acme" }]);
    adminQueryMock.mockResolvedValue([{ email: "admin@x.com", name: "A" }]);
    await flushAllSequenceFailureDigests();
    expect(sendMailMock).toHaveBeenCalledTimes(2);
    const subjects = sendMailMock.mock.calls.map((c) => c[0].subject).sort();
    expect(subjects[0]).toContain("Seq A");
    expect(subjects[1]).toContain("Seq B");
    expect(_pendingSequenceDigestCount()).toBe(0);
  });

  it("returns notified=0 when there are no opted-in admins", async () => {
    await notifyAdminsOfSequenceStepPermanentFailure(
      { id: "s1", orgId: "o1", name: "Onboarding" },
      {
        stepIndex: 0,
        recipientEmail: "a@x.com",
        errorCode: "X",
        errorMessage: null,
        attemptCount: 1,
      },
    );
    orgQueryMock.mockResolvedValue([{ name: "Acme" }]);
    adminQueryMock.mockResolvedValue([]);
    const r = await flushSequenceFailureDigest("s1");
    expect(r).toEqual({ notified: 0, failureCount: 1 });
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("flushSequenceFailureDigest returns null when nothing is queued", async () => {
    const r = await flushSequenceFailureDigest("missing");
    expect(r).toBeNull();
  });

  it("re-queues failures when sending the digest throws so nothing is lost", async () => {
    await notifyAdminsOfSequenceStepPermanentFailure(
      { id: "s1", orgId: "o1", name: "Onboarding" },
      {
        stepIndex: 0,
        recipientEmail: "a@x.com",
        errorCode: "X",
        errorMessage: null,
        attemptCount: 1,
      },
    );
    await notifyAdminsOfSequenceStepPermanentFailure(
      { id: "s1", orgId: "o1", name: "Onboarding" },
      {
        stepIndex: 1,
        recipientEmail: "b@x.com",
        errorCode: "Y",
        errorMessage: null,
        attemptCount: 1,
      },
    );
    expect(_pendingSequenceDigestCount()).toBe(1);

    // Simulate a DB / transport outage by making the admin query throw.
    // Per-admin SMTP errors are swallowed by sendToAdmins, but admin-
    // load failures bubble up to the catch block and must trigger the
    // re-queue path so a transient outage cannot drop the digest.
    orgQueryMock.mockResolvedValue([{ name: "Acme" }]);
    adminQueryMock.mockRejectedValueOnce(new Error("db boom"));

    const r = await flushSequenceFailureDigest("s1");
    expect(r).toBeNull();
    // Both failures must remain queued so the next flush retries them.
    expect(_pendingSequenceDigestCount()).toBe(1);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("interval=0 flushes synchronously per failure", async () => {
    setSequenceFailureDigestIntervalMs(0);
    orgQueryMock.mockResolvedValue([{ name: "Acme" }]);
    adminQueryMock.mockResolvedValue([{ email: "admin@x.com", name: "A" }]);

    const r = await notifyAdminsOfSequenceStepPermanentFailure(
      { id: "s1", orgId: "o1", name: "Onboarding" },
      {
        stepIndex: 0,
        recipientEmail: "a@x.com",
        errorCode: "X",
        errorMessage: null,
        attemptCount: 1,
      },
    );
    expect(r).toEqual({ queued: false, notified: 1, failureCount: 1 });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(_pendingSequenceDigestCount()).toBe(0);
  });
});

describe("classifyAdminDelivery", () => {
  it("sends now when quiet hours are off", () => {
    const r = classifyAdminDelivery(
      { quietHoursEnabled: false },
      new Date("2026-01-15T03:00:00Z"),
    );
    expect(r.defer).toBe(false);
  });
  it("defers when in window and returns the correct release time", () => {
    const r = classifyAdminDelivery(
      {
        quietHoursEnabled: true,
        quietHoursStart: "22:00",
        quietHoursEnd: "07:00",
        quietHoursTimezone: "UTC",
      },
      new Date("2026-01-15T03:00:00Z"),
    );
    expect(r.defer).toBe(true);
    if (r.defer) {
      expect(r.releaseAt.toISOString()).toBe("2026-01-15T07:00:00.000Z");
    }
  });
});

describe("quiet-hours buffering inside notify*", () => {
  it("buffers a campaign digest for an admin in quiet hours and sends to the rest", async () => {
    listCampaignFailedRecipientsMock.mockResolvedValue([
      { recipientEmail: "a@x.com", status: "permanent_failure", errorCode: "X" },
    ]);
    orgQueryMock.mockResolvedValue([{ name: "Acme" }]);
    adminQueryMock.mockResolvedValue([
      {
        email: "night@x.com",
        name: "Night",
        quietHoursEnabled: true,
        quietHoursStart: "00:00",
        quietHoursEnd: "23:59",
        quietHoursTimezone: "UTC",
      },
      { email: "day@x.com", name: "Day" },
    ]);

    const r = await notifyAdminsOfCampaignFailures(
      { id: "c1", orgId: "o1", name: "Promo" },
      1,
    );
    expect(r).toEqual({ notified: 2, permanentCount: 1 });
    expect(insertValuesMock).toHaveBeenCalledTimes(1);
    const buffered = insertValuesMock.mock.calls[0][0] as any;
    expect(buffered.recipientEmail).toBe("night@x.com");
    expect(buffered.contextTag).toBe("campaign=c1");
    expect(buffered.subject).toContain("Promo");
    expect(buffered.releaseAt).toBeInstanceOf(Date);
    // The other admin still got an immediate send.
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock.mock.calls[0][0].to).toBe("day@x.com");
  });

  it("buffers regardless of SMTP availability so admins still receive the digest later", async () => {
    listCampaignFailedRecipientsMock.mockResolvedValue([
      { recipientEmail: "a@x.com", status: "permanent_failure", errorCode: "X" },
    ]);
    orgQueryMock.mockResolvedValue([{ name: "Acme" }]);
    adminQueryMock.mockResolvedValue([
      {
        email: "night@x.com",
        name: "Night",
        quietHoursEnabled: true,
        quietHoursStart: "00:00",
        quietHoursEnd: "23:59",
        quietHoursTimezone: "UTC",
      },
    ]);
    createTransporterMock.mockImplementation(() => null);

    await notifyAdminsOfCampaignFailures(
      { id: "c1", orgId: "o1", name: "Promo" },
      1,
    );
    // Buffered even though the env transporter was missing.
    expect(insertValuesMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock).not.toHaveBeenCalled();
  });
});

describe("flushPendingAdminNotifications", () => {
  it("returns early when nothing is due", async () => {
    (globalThis as any).__nextSelectIsDue = true;
    dueRowsMock.mockResolvedValue([]);
    const r = await flushPendingAdminNotifications(new Date());
    expect(r).toEqual({ attempted: 0, delivered: 0 });
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("sends every due row and deletes them after delivery", async () => {
    (globalThis as any).__nextSelectIsDue = true;
    dueRowsMock.mockResolvedValue([
      {
        id: "p1",
        recipientEmail: "a@x.com",
        subject: "Buffered",
        html: "<p>x</p>",
        bodyText: "x",
        contextTag: "campaign=c1",
      },
      {
        id: "p2",
        recipientEmail: "b@x.com",
        subject: "Buffered",
        html: "<p>x</p>",
        bodyText: "x",
        contextTag: "campaign=c1",
      },
    ]);
    const r = await flushPendingAdminNotifications(new Date());
    expect(r).toEqual({ attempted: 2, delivered: 2 });
    expect(sendMailMock).toHaveBeenCalledTimes(2);
    expect(deleteWhereMock).toHaveBeenCalledTimes(2);
  });

  it("returns null and does not flush when another replica holds the advisory lock", async () => {
    const dbMod: any = await import("../db");
    const originalConnect = dbMod.pool.connect;
    dbMod.pool.connect = async () => ({
      query: async (sql: string) => {
        if (sql.includes("pg_try_advisory_lock")) {
          return { rows: [{ acquired: false }] };
        }
        return { rows: [] };
      },
      release: () => {},
    });
    try {
      (globalThis as any).__nextSelectIsDue = true;
      dueRowsMock.mockResolvedValue([
        {
          id: "p1",
          recipientEmail: "a@x.com",
          subject: "Buffered",
          html: "<p>x</p>",
          bodyText: "x",
          contextTag: "campaign=c1",
        },
      ]);
      const r = await flushPendingAdminNotifications(new Date());
      expect(r).toBeNull();
      expect(dueRowsMock).not.toHaveBeenCalled();
      expect(sendMailMock).not.toHaveBeenCalled();
    } finally {
      dbMod.pool.connect = originalConnect;
    }
  });

  it("still deletes a poisonous row even if SMTP rejects it", async () => {
    (globalThis as any).__nextSelectIsDue = true;
    dueRowsMock.mockResolvedValue([
      {
        id: "p1",
        recipientEmail: "bad@x.com",
        subject: "Buffered",
        html: "<p>x</p>",
        bodyText: "x",
        contextTag: "campaign=c1",
      },
    ]);
    sendMailMock.mockRejectedValue(new Error("550 rejected"));
    const r = await flushPendingAdminNotifications(new Date());
    expect(r).toEqual({ attempted: 1, delivered: 0 });
    expect(deleteWhereMock).toHaveBeenCalledTimes(1);
  });
});
