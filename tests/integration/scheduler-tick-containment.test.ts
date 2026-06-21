/**
 * Audit #22: the reminder/recurring/retention processors each acquire their
 * advisory lock OUTSIDE their try block, so a transient DB error there rejects
 * the promise. The interval callback was a bare async function whose rejection
 * became an unhandledRejection -> process.exit(1), crashing the whole
 * multi-tenant server. The tick is now runReminderTick(), which guards each
 * processor so it can never reject.
 *
 * Here ./db is mocked so the very first thing each processor does — the
 * pg_try_advisory_lock query — rejects, reproducing the crash trigger. The test
 * asserts runReminderTick() RESOLVES (the error is contained) rather than
 * rejecting.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/db", () => ({
  pool: {
    query: vi.fn().mockRejectedValue(new Error("simulated transient DB error (failover)")),
    on: vi.fn(),
  },
  db: {},
}));

import { runReminderTick } from "../../server/reminders";

describe("scheduler tick contains transient DB errors (audit #22)", () => {
  it("runReminderTick resolves (no unhandled rejection) when every advisory-lock query rejects", async () => {
    await expect(runReminderTick()).resolves.toBeUndefined();
  });
});
