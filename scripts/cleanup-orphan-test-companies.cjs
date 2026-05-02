#!/usr/bin/env node
/**
 * Sprint 2b cleanup — purge orphan test companies created by smoke runs.
 *
 * Targets companies whose domain ends in `.test` AND name starts with
 * "Acme Co " or "Smoke " — the patterns produced by:
 *   • e2e/marketing-companies-smoke.spec.ts
 *   • the manual curl smoke during development
 *
 * Soft-delete already happens in the test cleanup, but a crashed run can
 * leave them behind. This script HARD-deletes (no audit trail) since they
 * are synthetic.
 *
 * Usage:  node scripts/cleanup-orphan-test-companies.cjs
 */
const { Pool } = require("pg");

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url });
  try {
    const { rows } = await pool.query(
      `SELECT id, name, domain
         FROM companies
        WHERE domain LIKE '%.test'
          AND (name LIKE 'Acme Co %' OR name LIKE 'Smoke %')`
    );
    if (rows.length === 0) {
      console.log("No orphan test companies found.");
      return;
    }
    console.log(`Found ${rows.length} orphan test compan${rows.length === 1 ? "y" : "ies"}:`);
    rows.forEach((r) => console.log(`  - ${r.name}  (${r.domain})  [${r.id}]`));
    const ids = rows.map((r) => r.id);
    // Null out any FK refs first (defensive — ON DELETE SET NULL covers it,
    // but explicit is clearer in logs).
    await pool.query(`UPDATE client_contacts SET company_id = NULL WHERE company_id = ANY($1::varchar[])`, [ids]);
    const del = await pool.query(`DELETE FROM companies WHERE id = ANY($1::varchar[])`, [ids]);
    console.log(`Deleted ${del.rowCount} compan${del.rowCount === 1 ? "y" : "ies"}.`);
  } finally {
    await pool.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
