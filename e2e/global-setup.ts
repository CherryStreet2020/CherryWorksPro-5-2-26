import { Pool } from "pg";
import bcrypt from "bcryptjs";
// NOTE: do NOT eagerly import "../server/db" or
// "../scripts/cleanup-e2e-brand-pollution" — server/db throws on import
// when DATABASE_URL is unset, which would defeat the runtime DB-skip
// guard below. Both modules are dynamically imported inside
// `sweepStaleTestPollution` after the env check.

const TEST_ADMIN_EMAIL = "dean@cherrystconsulting.com";
const TEST_ADMIN_PASSWORD = "admin123";

async function resetTestAdminPassword(pool: Pool): Promise<void> {
  const { rows } = await pool.query(
    `SELECT id, password FROM users WHERE email = $1`,
    [TEST_ADMIN_EMAIL],
  );
  if (rows.length === 0) {
    console.warn(
      `[e2e global-setup] Seeded admin ${TEST_ADMIN_EMAIL} not found; skipping password reset`,
    );
    return;
  }

  const matches = await Promise.all(
    rows.map((r) =>
      r.password
        ? bcrypt.compare(TEST_ADMIN_PASSWORD, r.password)
        : Promise.resolve(false),
    ),
  );
  if (matches.every(Boolean)) {
    console.log(
      `[e2e global-setup] ${TEST_ADMIN_EMAIL} password already matches test value`,
    );
    return;
  }

  const newHash = await bcrypt.hash(TEST_ADMIN_PASSWORD, 10);
  const result = await pool.query(
    `UPDATE users SET password = $1, is_active = true, updated_at = NOW() WHERE email = $2`,
    [newHash, TEST_ADMIN_EMAIL],
  );
  console.log(
    `[e2e global-setup] Reset ${TEST_ADMIN_EMAIL} password to documented test value (${result.rowCount} row(s))`,
  );
}

async function lookupTestOrgId(pool: Pool): Promise<string | null> {
  const { rows } = await pool.query<{ org_id: string }>(
    `SELECT org_id FROM users WHERE email = $1 LIMIT 1`,
    [TEST_ADMIN_EMAIL],
  );
  return rows[0]?.org_id ?? null;
}

async function sweepStaleTestPollution(pool: Pool): Promise<void> {
  // Task #360: purge stale BrandB / Phase7 Activity Brand / E2E Test
  // Vendor rows left over by aborted runs. Scoped to the test admin's
  // org so we never touch real customer data, and the sweeper enforces
  // its own MAX_BRAND_IDS safety cap before issuing any writes.
  const orgId = await lookupTestOrgId(pool);
  if (!orgId) {
    // Refuse to run unscoped — better to skip the sweep loudly than to
    // accidentally delete rows from the wrong tenant.
    console.warn(
      `[e2e global-setup] Could not resolve org for ${TEST_ADMIN_EMAIL}; ` +
        `skipping pre-test sweep (refusing to run a global delete).`,
    );
    return;
  }

  // Dynamic imports — see top-of-file note. Importing these eagerly
  // would crash the module before the DATABASE_URL env-guard in
  // `globalSetup` could short-circuit gracefully on local dev runs that
  // have no DB. We only reach this point after that guard passed AND
  // we've already proved the DB is reachable (lookupTestOrgId ran).
  const { sweepE2ETestPollution } = await import(
    "../scripts/cleanup-e2e-brand-pollution"
  );
  const { pool: sharedPool } = await import("../server/db");

  try {
    const report = await sweepE2ETestPollution(orgId);
    if (
      report.brandsFound === 0 &&
      report.brandsDeleted === 0 &&
      report.expensesDeleted === 0
    ) {
      console.log(
        `[e2e global-setup] Pre-test sweep (org ${orgId}): nothing to clean.`,
      );
      return;
    }
    console.log(
      `[e2e global-setup] Pre-test sweep (org ${orgId}) removed ` +
        `${report.brandsDeleted} stale brand(s) (matched ${report.brandsFound}) ` +
        `and ${report.expensesDeleted} stale expense(s).`,
    );
  } catch (err) {
    // Fail loudly — silent cleanup failures are exactly what task #360
    // is here to prevent.
    console.error("[e2e global-setup] Pre-test sweep FAILED:", err);
    throw err;
  } finally {
    // The cleanup helpers ran against the shared server/db.ts pool.
    // End it so this Playwright globalSetup process doesn't keep an
    // open connection pool dangling for the rest of the run.
    await sharedPool.end().catch(() => {
      /* already closed */
    });
  }
}

export default async function globalSetup() {
  if (!process.env.DATABASE_URL) {
    console.warn(
      "[e2e global-setup] DATABASE_URL not set; skipping admin password reset and pre-test sweep",
    );
    return;
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await resetTestAdminPassword(pool);
    await sweepStaleTestPollution(pool);
  } catch (err) {
    console.error("[e2e global-setup] failed:", err);
    throw err;
  } finally {
    await pool.end();
  }
}
