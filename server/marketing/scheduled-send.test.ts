import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  computeNextSendAt,
  resolveCampaignRecipients,
  computeBackoffMs,
  isTransientErrorCode,
  decideRecipientAction,
  resolveOrgRetryPolicy,
  MAX_SEND_ATTEMPTS,
  RETRY_BACKOFF_BASE_MS,
} from "./scheduled-send";

vi.mock("../db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })),
    })),
  },
  pool: { query: vi.fn() },
}));

const getSegmentMock = vi.fn();
const resolveSegmentProspectsMock = vi.fn();
vi.mock("../storage", () => ({
  storage: {
    getSegment: (...args: unknown[]) => getSegmentMock(...args),
    resolveSegmentProspects: (...args: unknown[]) => resolveSegmentProspectsMock(...args),
  },
}));

const day = 24 * 60 * 60 * 1000;

describe("computeNextSendAt", () => {
  const now = new Date("2026-04-22T12:00:00.000Z");

  it("returns done when the dispatched step was the last one", () => {
    const steps = [{ delayDays: 0 }, { delayDays: 3 }];
    expect(computeNextSendAt(steps, 1, now)).toEqual({ done: true });
  });

  it("returns done for an empty step list", () => {
    expect(computeNextSendAt([], 0, now)).toEqual({ done: true });
  });

  it("schedules the next step exactly delayDays days from now", () => {
    const steps = [
      { delayDays: 0 },
      { delayDays: 3 },
      { delayDays: 7 },
    ];
    const r = computeNextSendAt(steps, 0, now);
    expect(r.done).toBe(false);
    if (!r.done) {
      expect(r.nextIndex).toBe(1);
      expect(r.nextSendAt.getTime() - now.getTime()).toBe(3 * day);
    }
  });

  it("clamps negative delayDays to zero (no time travel)", () => {
    const steps = [{ delayDays: 0 }, { delayDays: -5 }];
    const r = computeNextSendAt(steps, 0, now);
    expect(r.done).toBe(false);
    if (!r.done) {
      expect(r.nextSendAt.getTime()).toBe(now.getTime());
    }
  });

  it("treats null/undefined delayDays as zero", () => {
    const steps = [
      { delayDays: 0 },
      { delayDays: undefined as unknown as number },
    ];
    const r = computeNextSendAt(steps, 0, now);
    expect(r.done).toBe(false);
    if (!r.done) {
      expect(r.nextSendAt.getTime()).toBe(now.getTime());
    }
  });
});

describe("resolveCampaignRecipients (Task #234)", () => {
  beforeEach(() => {
    getSegmentMock.mockReset();
    resolveSegmentProspectsMock.mockReset();
  });

  it("returns no recipients when audienceType=segment but segmentId is null", async () => {
    const out = await resolveCampaignRecipients({
      orgId: "org-1",
      brandId: "brand-1",
      audienceType: "segment",
      audienceSegmentId: null,
    });
    expect(out).toEqual([]);
    expect(getSegmentMock).not.toHaveBeenCalled();
  });

  it("returns no recipients when the segment has been deleted", async () => {
    getSegmentMock.mockResolvedValue(undefined);
    const out = await resolveCampaignRecipients({
      orgId: "org-1",
      brandId: "brand-1",
      audienceType: "segment",
      audienceSegmentId: "seg-1",
    });
    expect(out).toEqual([]);
    expect(resolveSegmentProspectsMock).not.toHaveBeenCalled();
  });

  it("rejects a segment that belongs to a different brand", async () => {
    getSegmentMock.mockResolvedValue({ id: "seg-1", brandId: "brand-OTHER", filter: {} });
    const out = await resolveCampaignRecipients({
      orgId: "org-1",
      brandId: "brand-1",
      audienceType: "segment",
      audienceSegmentId: "seg-1",
    });
    expect(out).toEqual([]);
    expect(resolveSegmentProspectsMock).not.toHaveBeenCalled();
  });

  it("resolves segment contacts and drops rows without an email", async () => {
    getSegmentMock.mockResolvedValue({
      id: "seg-1",
      brandId: "brand-1",
      filter: { tagIds: ["tag-a"], search: "vip" },
    });
    resolveSegmentProspectsMock.mockResolvedValue([
      { id: "c1", email: "a@x.com" },
      { id: "c2", email: null },
      { id: "c3", email: "b@x.com" },
    ]);
    const out = await resolveCampaignRecipients({
      orgId: "org-1",
      brandId: "brand-1",
      audienceType: "segment",
      audienceSegmentId: "seg-1",
    });
    expect(out).toEqual([
      { id: "c1", email: "a@x.com" },
      { id: "c3", email: "b@x.com" },
    ]);
    expect(resolveSegmentProspectsMock).toHaveBeenCalledWith(
      "org-1",
      "brand-1",
      { tagIds: ["tag-a"], search: "vip" },
    );
  });

  it("falls back to the all-brand query when audienceType=all", async () => {
    const out = await resolveCampaignRecipients({
      orgId: "org-1",
      brandId: "brand-1",
      audienceType: "all",
      audienceSegmentId: null,
    });
    expect(out).toEqual([]); // mocked db returns []
    expect(getSegmentMock).not.toHaveBeenCalled();
  });
});

describe("isTransientErrorCode", () => {
  it("flags network/timeout/5xx/429/SMTP-4xx as transient", () => {
    expect(isTransientErrorCode("TIMEOUT")).toBe(true);
    expect(isTransientErrorCode("NETWORK_ERROR")).toBe(true);
    expect(isTransientErrorCode("HTTP_ERROR_503")).toBe(true);
    expect(isTransientErrorCode("HTTP_ERROR_429")).toBe(true);
    expect(isTransientErrorCode("SMTP_421")).toBe(true);
    expect(isTransientErrorCode("SMTP_450_4.3.2")).toBe(true);
    expect(isTransientErrorCode("TOKEN_REFRESH_FAILED_401")).toBe(true);
    expect(isTransientErrorCode("SEND_FAILED_502")).toBe(true);
    expect(isTransientErrorCode("UNKNOWN")).toBe(true);
  });

  it("treats validation/decrypt/SMTP-5xx as permanent", () => {
    expect(isTransientErrorCode("VALIDATION_ERROR")).toBe(false);
    expect(isTransientErrorCode("DECRYPT_FAILED")).toBe(false);
    expect(isTransientErrorCode("NOT_CONFIGURED")).toBe(false);
    expect(isTransientErrorCode("SMTP_550")).toBe(false);
    expect(isTransientErrorCode("HTTP_ERROR_404")).toBe(false);
  });
});

describe("computeBackoffMs", () => {
  it("doubles per failed attempt", () => {
    const base = 1000;
    expect(computeBackoffMs(1, base)).toBe(1000);
    expect(computeBackoffMs(2, base)).toBe(2000);
    expect(computeBackoffMs(3, base)).toBe(4000);
    expect(computeBackoffMs(4, base)).toBe(8000);
  });

  it("clamps the lower bound at attempt 1", () => {
    expect(computeBackoffMs(0, 1000)).toBe(1000);
    expect(computeBackoffMs(-5, 1000)).toBe(1000);
  });

  it("uses the configured default base when omitted", () => {
    expect(computeBackoffMs(1)).toBe(RETRY_BACKOFF_BASE_MS);
  });

  it("caps the backoff at 24h to avoid runaway retry timestamps", () => {
    expect(computeBackoffMs(50, 60_000)).toBe(24 * 60 * 60 * 1000);
  });
});

describe("decideRecipientAction", () => {
  const now = new Date("2026-04-22T12:00:00.000Z");
  const earlier = new Date(now.getTime() - 60_000);
  const later = new Date(now.getTime() + 60_000);

  it("sends immediately when there is no prior attempt", () => {
    expect(decideRecipientAction(null, now)).toEqual({
      action: "send",
      attemptNumber: 1,
    });
  });

  it("skips recipients whose last attempt succeeded", () => {
    const r = decideRecipientAction(
      { status: "success", attemptNumber: 1, nextRetryAt: null },
      now,
    );
    expect(r).toEqual({ action: "skip-done" });
  });

  it("skips recipients we have permanently given up on", () => {
    const r = decideRecipientAction(
      { status: "permanent_failure", attemptNumber: 3, nextRetryAt: null },
      now,
    );
    expect(r).toEqual({ action: "skip-done" });
  });

  it("waits for backoff when the next retry is in the future", () => {
    const r = decideRecipientAction(
      { status: "failed", attemptNumber: 2, nextRetryAt: later },
      now,
    );
    expect(r).toEqual({ action: "skip-pending", nextRetryAt: later });
  });

  it("retries (attempt N+1) when the backoff has elapsed", () => {
    const r = decideRecipientAction(
      { status: "failed", attemptNumber: 2, nextRetryAt: earlier },
      now,
    );
    expect(r).toEqual({ action: "send", attemptNumber: 3 });
  });

  it("treats a recipient that already hit MAX_SEND_ATTEMPTS as done", () => {
    const r = decideRecipientAction(
      {
        status: "failed",
        attemptNumber: MAX_SEND_ATTEMPTS,
        nextRetryAt: earlier,
      },
      now,
    );
    expect(r).toEqual({ action: "skip-done" });
  });

  it("respects a per-org override that lowers the attempt cap (Task #271)", () => {
    // With maxAttempts=2 and the recipient already at attempt 2, retrying is forbidden.
    const r = decideRecipientAction(
      { status: "failed", attemptNumber: 2, nextRetryAt: earlier },
      now,
      2,
    );
    expect(r).toEqual({ action: "skip-done" });
  });

  it("respects a per-org override that raises the attempt cap (Task #271)", () => {
    // With maxAttempts=10 and the recipient at attempt 6 with elapsed backoff,
    // we should retry as attempt 7 instead of skipping.
    const r = decideRecipientAction(
      { status: "failed", attemptNumber: 6, nextRetryAt: earlier },
      now,
      10,
    );
    expect(r).toEqual({ action: "send", attemptNumber: 7 });
  });
});

describe("resolveOrgRetryPolicy (Task #271)", () => {
  it("falls back to module defaults when the org row is missing", () => {
    expect(resolveOrgRetryPolicy(null)).toEqual({
      maxAttempts: MAX_SEND_ATTEMPTS,
      baseMs: RETRY_BACKOFF_BASE_MS,
    });
    expect(resolveOrgRetryPolicy(undefined)).toEqual({
      maxAttempts: MAX_SEND_ATTEMPTS,
      baseMs: RETRY_BACKOFF_BASE_MS,
    });
  });

  it("falls back to defaults for legacy rows without the new columns", () => {
    expect(resolveOrgRetryPolicy({})).toEqual({
      maxAttempts: MAX_SEND_ATTEMPTS,
      baseMs: RETRY_BACKOFF_BASE_MS,
    });
    expect(
      resolveOrgRetryPolicy({
        marketingSendMaxAttempts: null,
        marketingSendRetryBaseMs: null,
      }),
    ).toEqual({
      maxAttempts: MAX_SEND_ATTEMPTS,
      baseMs: RETRY_BACKOFF_BASE_MS,
    });
  });

  it("returns the configured per-org values when present", () => {
    expect(
      resolveOrgRetryPolicy({
        marketingSendMaxAttempts: 3,
        marketingSendRetryBaseMs: 60_000,
      }),
    ).toEqual({ maxAttempts: 3, baseMs: 60_000 });
  });

  it("clamps absurd values into the safe range", () => {
    expect(
      resolveOrgRetryPolicy({
        marketingSendMaxAttempts: 9999,
        marketingSendRetryBaseMs: 999 * 24 * 60 * 60 * 1000,
      }),
    ).toEqual({ maxAttempts: 20, baseMs: 24 * 60 * 60 * 1000 });
    expect(
      resolveOrgRetryPolicy({
        marketingSendMaxAttempts: 0,
        marketingSendRetryBaseMs: 0,
      }),
    ).toEqual({ maxAttempts: 1, baseMs: 1_000 });
  });

  it("floors fractional values", () => {
    expect(
      resolveOrgRetryPolicy({
        marketingSendMaxAttempts: 4.9,
        marketingSendRetryBaseMs: 12_345.7,
      }),
    ).toEqual({ maxAttempts: 4, baseMs: 12_345 });
  });
});
