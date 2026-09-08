// CLI entrypoint for the SQL-replay phase (`npm run db:migrate:prod`, used by
// `cwp vitest` / `cwp reset-dev` to prepare a fresh local database). It runs
// AFTER `drizzle-kit push --force`, like CI's check-migrations.sh: migrations/
// *.sql are idempotent ALTER/backfill steps over the Drizzle-managed base
// schema, so on an empty database every one of them fails until the push.
//
// server/migrate-production.ts only EXPORTS runProductionMigrations() — the app
// invokes it from the startup orchestrator. Executing that module directly
// defined the function and exited 0 without replaying a single migration, so
// the "replay migrations/*.sql, then push the schema" step only ever did the
// drizzle push. This file awaits the replay and fails the process on ANY
// migration failure, so a broken migration stops the suite instead of leaving
// a half-migrated database. Not imported by the server; never bundled.
import { pool } from "../server/db";
import { runProductionMigrations, getLastMigrationFailures, getLastDataMigrationError } from "../server/migrate-production";

async function main(): Promise<number> {
  try {
    await runProductionMigrations();
  } catch (err) {
    console.error(`[run-migrations] failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  // Outside NODE_ENV=production the replay throws on failure; in production it
  // only records them. Check the record too so this exit code is honest either way.
  const failures = getLastMigrationFailures();
  if (failures.length > 0) {
    console.error(`[run-migrations] ${failures.length} migration(s) failed: ${failures.join(", ")}`);
    return 1;
  }
  // The data-migration phase logs and swallows its own error (a boot must go
  // on); a database prepared by this CLI must not.
  const dataError = getLastDataMigrationError();
  if (dataError) {
    console.error(`[run-migrations] data migrations failed: ${dataError}`);
    return 1;
  }
  console.log("[run-migrations] migrations/*.sql replayed and data migrations applied");
  return 0;
}

main()
  .catch((err) => { console.error(`[run-migrations] ${err instanceof Error ? err.stack ?? err.message : String(err)}`); return 1; })
  .then(async (code) => { await pool.end().catch(() => {}); process.exit(code); });
