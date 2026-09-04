/**
 * Shared fixture orgs for the brands / marketing storage tests.
 *
 * Those files pin two org ids (ORG_A / ORG_B) that used to exist in the seeded
 * database. `brands.org_id` now has a foreign key to `orgs.id`, and a fresh
 * `cwp_test` only carries the QA seed orgs, so a brand insert for a pinned id
 * fails before any assertion runs. Each file calls `ensureFixtureOrgs` in its
 * beforeAll; the rows are idempotent and deliberately never deleted, because
 * several files share the ids and run in parallel workers.
 */
import { pool } from "../../server/db";

export const FIXTURE_ORG_A = "c89d120d-1f07-4010-938f-070a0e13b8f2";
export const FIXTURE_ORG_B = "30cb6705-f98e-44c5-8e2a-fbe3f150a3eb";

export async function ensureFixtureOrgs(...ids: string[]): Promise<void> {
  const wanted = ids.length > 0 ? ids : [FIXTURE_ORG_A, FIXTURE_ORG_B];
  for (const id of wanted) {
    await pool.query(
      `INSERT INTO orgs (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
      [id, `Fixture Org ${id.slice(0, 8)}`, `fixture-${id.slice(0, 8)}`],
    );
  }
}
