/**
 * Sprint 2i.6 / Task #171 / Task #186 — startup orchestrator extraction.
 *
 * The boot sequence in `server/index.ts` runs Phase 0 SQL replay, decides
 * whether seeding is safe, and only then invokes the seed steps. Pulling
 * that decision into a single exported function lets integration tests
 * (notably `tests/integration/migration-failure-halts-seed.test.ts`)
 * exercise the real gating logic instead of re-implementing it.
 *
 * Behavior contract:
 *   - If `runProductionMigrations()` throws, no seed step runs.
 *   - If it resolves but `getLastMigrationFailures()` is non-empty, no
 *     seed step runs.
 *   - In both skip cases a loud, greppable
 *     `[startup] skipping seed steps because ...` line is logged.
 *   - Otherwise the three seed steps run in order, each guarded by its
 *     own try/catch so one failure does not block the others.
 */
import { runProductionMigrations, getLastMigrationFailures } from "./migrate-production";
import { seedExpenseCategories } from "./seed";
import { seedDevQaUsers } from "./seed-role-test-users";
import { seedOrgEntitlements } from "./seed-org-entitlements";

export type StartupOrchestratorResult = {
  migrationsOk: boolean;
  failures: string[];
};

export async function runMigrationsAndSeed(): Promise<StartupOrchestratorResult> {
  let migrationsOk = true;
  let migrationThrewReason: string | null = null;
  try {
    await runProductionMigrations();
  } catch (e: any) {
    migrationsOk = false;
    migrationThrewReason = `${e?.message ?? e} (code=${e?.code ?? "n/a"})`;
    console.error(`[startup] runProductionMigrations failed: ${migrationThrewReason}`);
  }
  // Task #171 — even when runProductionMigrations resolved (production
  // mode keeps replaying through failures), individual SQL files may
  // still have failed. In that case skip seeding so we don't paper
  // over a half-migrated schema with partially-seeded data.
  if (migrationsOk && getLastMigrationFailures().length > 0) {
    migrationsOk = false;
  }
  if (!migrationsOk) {
    const failed = getLastMigrationFailures();
    if (failed.length > 0) {
      console.error(
        `[startup] skipping seed steps because ${failed.length} Phase 0 migration(s) failed: ${failed.join(", ")}`,
      );
    } else {
      console.error(
        `[startup] skipping seed steps because runProductionMigrations threw outside Phase 0 replay: ${migrationThrewReason ?? "unknown error"}`,
      );
    }
  }
  if (migrationsOk) {
    try {
      await seedExpenseCategories();
    } catch (e: any) {
      console.error(`[startup] seedExpenseCategories failed: ${e?.message ?? e} (code=${e?.code ?? "n/a"})`);
    }
    if (process.env.NODE_ENV !== "production") {
      try {
        await seedDevQaUsers();
      } catch (e: any) {
        console.error(`[startup] seedDevQaUsers failed: ${e?.message ?? e} (code=${e?.code ?? "n/a"})`);
      }
    }
    try {
      // Sprint 2i.5 — ensure every org (including the PSO-only dev org
      // created above) has its baseline `pso_core` entitlement row, and
      // that `cwpro-dev-qa` keeps its `marketing_os` row. Idempotent.
      await seedOrgEntitlements();
    } catch (e: any) {
      console.error(`[startup] seedOrgEntitlements failed: ${e?.message ?? e} (code=${e?.code ?? "n/a"})`);
    }
  }
  return { migrationsOk, failures: getLastMigrationFailures() };
}
