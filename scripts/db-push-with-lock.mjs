/**
 * Applies the Drizzle schema push under a Postgres advisory lock.
 *
 * Why this exists as a Node script rather than three lines of shell:
 * advisory locks are SESSION-scoped. The obvious shell version —
 *   psql -c 'SELECT pg_advisory_lock(...)'; drizzle-kit push; psql -c 'unlock'
 * — provides ZERO exclusion, because the lock dies the instant the first psql
 * exits. Here one client holds the lock for the whole duration of the push.
 *
 * HONEST SCOPE: this guards two BOOTING revisions against each other. It does
 * nothing about an old revision still serving live writes while a new one
 * ALTERs the same tables. That is contained by deploys being button-only,
 * single-revision mode, and a max-replica of 1 — not by this lock.
 */
import { Client } from "pg";
import { spawnSync } from "node:child_process";

const LOCK_KEY = 0x63777021; // arbitrary, stable, CWP-specific
const url = process.env.DATABASE_URL;

if (!url) {
  console.error("[db-push] DATABASE_URL is not set — refusing to push.");
  process.exit(1);
}

const isProduction =
  (process.env.NODE_ENV || "").toLowerCase().trim() === "production";

// Mirrors server/db.ts so the push connects exactly like the app does.
const client = new Client({
  connectionString: url,
  connectionTimeoutMillis: 15_000,
  ...(isProduction ? { ssl: { rejectUnauthorized: true } } : {}),
});

let held = false;
let exitCode = 0;

try {
  await client.connect();
  console.log("[db-push] acquiring advisory lock…");
  await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
  held = true;
  console.log("[db-push] lock held; running drizzle-kit push --force");

  const res = spawnSync("node_modules/.bin/drizzle-kit", ["push", "--force"], {
    stdio: "inherit",
    env: process.env,
  });

  if (res.error) {
    console.error("[db-push] could not execute drizzle-kit:", res.error.message);
    exitCode = 1;
  } else if (res.status !== 0) {
    console.error(`[db-push] drizzle-kit push FAILED (exit ${res.status})`);
    exitCode = res.status ?? 1;
  } else {
    console.log("[db-push] schema push complete");
  }
} catch (err) {
  console.error("[db-push] fatal:", err?.message ?? err);
  exitCode = 1;
} finally {
  if (held) {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]);
    } catch {
      /* lock is released by the backend when the session ends anyway */
    }
  }
  try {
    await client.end();
  } catch {
    /* ignore */
  }
}

process.exit(exitCode);
