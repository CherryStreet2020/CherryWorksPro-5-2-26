/**
 * Task #186 — lock in two boot-time contracts established by Task #171:
 *
 *   1. Boot-time migration failures are surfaced loudly via the greppable
 *      `[startup] migration <file> failed — refusing to seed` log line and
 *      via `getLastMigrationFailures()`.
 *   2. The startup orchestrator (`runMigrationsAndSeed` in
 *      `server/startup-orchestrator.ts`, which is what `server/index.ts`
 *      calls on boot) skips every seed step when any migration fails.
 *
 * We exercise the real orchestrator function — the same one the boot
 * sequence invokes — and assert that the seed modules' exported
 * functions are never called when migrations fail. If a future refactor
 * removes the loud log or removes the seed gate, this test will fail.
 *
 * Strategy: chdir into a temp directory containing a `migrations/`
 * folder with a single deliberately-broken SQL file so the real
 * `runPhase0SqlReplay` reads our fixture, then mock the three seed
 * modules so we can assert zero invocations under failure.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("../../server/seed", () => ({
  seedExpenseCategories: vi.fn(async () => {}),
  seedDatabase: vi.fn(async () => {}),
}));
vi.mock("../../server/seed-role-test-users", () => ({
  seedDevQaUsers: vi.fn(async () => {}),
}));
vi.mock("../../server/seed-org-entitlements", () => ({
  seedOrgEntitlements: vi.fn(async () => ({})),
}));

// Imported after vi.mock so the orchestrator picks up the mocked seeds.
import { runMigrationsAndSeed } from "../../server/startup-orchestrator";
import { getLastMigrationFailures } from "../../server/migrate-production";
import { seedExpenseCategories } from "../../server/seed";
import { seedDevQaUsers } from "../../server/seed-role-test-users";
import { seedOrgEntitlements } from "../../server/seed-org-entitlements";

const BAD_FILE = "9999-bad.sql";
const BAD_SQL =
  "-- task-186 deliberately broken migration\nTHIS IS NOT VALID SQL FOR TASK 186;\n";

describe("Task #186 — boot-time migration failures halt seeding", () => {
  let originalCwd: string;
  let tmpDir: string;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "task186-migrations-"));
    await fs.mkdir(path.join(tmpDir, "migrations"));
    await fs.writeFile(path.join(tmpDir, "migrations", BAD_FILE), BAD_SQL, "utf8");
    process.chdir(tmpDir);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(seedExpenseCategories).mockClear();
    vi.mocked(seedDevQaUsers).mockClear();
    vi.mocked(seedOrgEntitlements).mockClear();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    errorSpy.mockRestore();
    logSpy.mockRestore();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("emits the greppable refusing-to-seed log, records the failure, and skips every seed step", async () => {
    const result = await runMigrationsAndSeed();

    // (1) Loud, greppable per-file log line was emitted by Phase 0 replay.
    const calls = errorSpy.mock.calls.map((c) => c.join(" "));
    const refusing = calls.find(
      (line) =>
        line.includes(`[startup] migration ${BAD_FILE} failed`) &&
        line.includes("refusing to seed"),
    );
    expect(
      refusing,
      `expected loud refusing-to-seed log for ${BAD_FILE}; got:\n${calls.join("\n")}`,
    ).toBeTruthy();

    // The orchestrator also emits its own "skipping seed steps" line.
    const skipLine = calls.find((line) =>
      line.includes("[startup] skipping seed steps"),
    );
    expect(skipLine, `expected orchestrator to log a "skipping seed steps" line; got:\n${calls.join("\n")}`).toBeTruthy();

    // (2) Failures accessor surfaces the broken file.
    expect(getLastMigrationFailures()).toContain(BAD_FILE);
    expect(result.migrationsOk).toBe(false);
    expect(result.failures).toContain(BAD_FILE);

    // (3) THE core contract: NO seed step ran. If any of these fire,
    // the orchestrator's seed gate has regressed.
    expect(vi.mocked(seedExpenseCategories)).not.toHaveBeenCalled();
    expect(vi.mocked(seedDevQaUsers)).not.toHaveBeenCalled();
    expect(vi.mocked(seedOrgEntitlements)).not.toHaveBeenCalled();
  });
});
