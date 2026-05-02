/**
 * Sprint 2c.1 SP1 — E2E brand pollution cleanup (library + CLI).
 *
 * Exposes `cleanupE2EBrandPollution(brandIds)` as a hard-delete cascade so
 * Playwright `afterAll` hooks (SP2) can call it directly with the brandIds
 * a spec created during setup, without going through the soft-delete
 * `DELETE /api/brands/:id` API and without inventing a new endpoint.
 *
 * When run as a CLI (`tsx scripts/cleanup-e2e-brand-pollution.ts`) it
 * resolves the polluting IDs by slug-prefix (`contacts-e2e-%`,
 * `companies-e2e-%`, `marketing-editors-e2e-%`, `t2a-bb-%`), prints per-prefix + per-table counts,
 * and exits 0. Idempotent on a clean DB.
 *
 * Hard constraints (see .local/tasks/task-64.md):
 *  - Reuse the shared pool from server/db.ts; never end the pool from
 *    the library function (CLI wrapper closes it instead).
 *  - Every UPDATE/DELETE is scoped by `WHERE … brand_id IN (<ids>)`.
 *  - Safety cap: throw if brandIds.length > MAX_BRAND_IDS.
 *  - Marketing-OS tables only — no billing/accounting/invoice tables.
 */

import { pool } from "../server/db";

export const MAX_BRAND_IDS = 50;

export interface CleanupCounts {
  clientsNulled: number;
  clientContactsNulled: number;
  companiesNulled: number;
  contactTagAssignmentsDeleted: number;
  contactTagsDeleted: number;
  contactSegmentsDeleted: number;
  contactActivitiesDeleted: number;
  contactImportsDeleted: number;
  contactImportPresetsDeleted: number;
  marketingCampaignsDeleted: number;
  marketingSequenceStepsDeleted: number;
  marketingSequencesDeleted: number;
  brandsDeleted: number;
}

function zeroCounts(): CleanupCounts {
  return {
    clientsNulled: 0,
    clientContactsNulled: 0,
    companiesNulled: 0,
    contactTagAssignmentsDeleted: 0,
    contactTagsDeleted: 0,
    contactSegmentsDeleted: 0,
    contactActivitiesDeleted: 0,
    contactImportsDeleted: 0,
    contactImportPresetsDeleted: 0,
    marketingCampaignsDeleted: 0,
    marketingSequenceStepsDeleted: 0,
    marketingSequencesDeleted: 0,
    brandsDeleted: 0,
  };
}

/**
 * Hard-delete every marketing-OS row referencing the given brandIds, then
 * delete the brand rows themselves. Single transaction; rolls back on any
 * error. No-op (returns zero counts, issues no SQL writes) when the input
 * is empty. Throws synchronously if `brandIds.length > MAX_BRAND_IDS`.
 */
export async function cleanupE2EBrandPollution(
  brandIds: string[],
): Promise<CleanupCounts> {
  if (brandIds.length > MAX_BRAND_IDS) {
    throw new Error(
      `cleanupE2EBrandPollution: refusing to operate on ${brandIds.length} brand IDs ` +
        `(safety cap is ${MAX_BRAND_IDS}). Aborting before any writes.`,
    );
  }
  if (brandIds.length === 0) {
    return zeroCounts();
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Each statement is parameterised through `= ANY($1::varchar[])` which
    // Postgres treats identically to `IN (…)` but keeps a single bind param
    // for any number of ids.
    const r1 = await client.query(
      `UPDATE clients          SET brand_id = NULL WHERE brand_id = ANY($1::varchar[])`,
      [brandIds],
    );
    const r2 = await client.query(
      `UPDATE client_contacts  SET brand_id = NULL WHERE brand_id = ANY($1::varchar[])`,
      [brandIds],
    );
    const r3 = await client.query(
      `UPDATE companies        SET brand_id = NULL WHERE brand_id = ANY($1::varchar[])`,
      [brandIds],
    );
    const r4 = await client.query(
      `DELETE FROM contact_tag_assignments
       WHERE tag_id IN (SELECT id FROM contact_tags WHERE brand_id = ANY($1::varchar[]))`,
      [brandIds],
    );
    const r5 = await client.query(
      `DELETE FROM contact_tags          WHERE brand_id = ANY($1::varchar[])`,
      [brandIds],
    );
    const r5b = await client.query(
      `DELETE FROM contact_segments      WHERE brand_id = ANY($1::varchar[])`,
      [brandIds],
    );
    const r6 = await client.query(
      `DELETE FROM contact_activities    WHERE brand_id = ANY($1::varchar[])`,
      [brandIds],
    );
    const r7 = await client.query(
      `DELETE FROM contact_imports       WHERE brand_id = ANY($1::varchar[])`,
      [brandIds],
    );
    const r8 = await client.query(
      `DELETE FROM contact_import_presets WHERE brand_id = ANY($1::varchar[])`,
      [brandIds],
    );
    // Sprint 2n: Marketing campaigns + sequences must be removed before
    // brands (FK marketing_campaigns.brand_id, marketing_sequences.brand_id).
    // marketing_sequence_steps cascades from marketing_sequences but we
    // delete it explicitly so the row count is observable.
    const r8a = await client.query(
      `DELETE FROM marketing_campaigns    WHERE brand_id = ANY($1::varchar[])`,
      [brandIds],
    );
    const r8b = await client.query(
      `DELETE FROM marketing_sequence_steps
       WHERE sequence_id IN (SELECT id FROM marketing_sequences WHERE brand_id = ANY($1::varchar[]))`,
      [brandIds],
    );
    const r8c = await client.query(
      `DELETE FROM marketing_sequences    WHERE brand_id = ANY($1::varchar[])`,
      [brandIds],
    );
    const r9 = await client.query(
      `DELETE FROM brands                 WHERE id       = ANY($1::varchar[])`,
      [brandIds],
    );

    await client.query("COMMIT");

    return {
      clientsNulled: r1.rowCount ?? 0,
      clientContactsNulled: r2.rowCount ?? 0,
      companiesNulled: r3.rowCount ?? 0,
      contactTagAssignmentsDeleted: r4.rowCount ?? 0,
      contactTagsDeleted: r5.rowCount ?? 0,
      contactSegmentsDeleted: r5b.rowCount ?? 0,
      contactActivitiesDeleted: r6.rowCount ?? 0,
      contactImportsDeleted: r7.rowCount ?? 0,
      contactImportPresetsDeleted: r8.rowCount ?? 0,
      marketingCampaignsDeleted: r8a.rowCount ?? 0,
      marketingSequenceStepsDeleted: r8b.rowCount ?? 0,
      marketingSequencesDeleted: r8c.rowCount ?? 0,
      brandsDeleted: r9.rowCount ?? 0,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
      /* swallow rollback failure; original error is what matters */
    });
    throw err;
  } finally {
    client.release();
    // Never end the shared pool here — see file header.
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Test-pollution sweeper — name + slug + expense-vendor
// ─────────────────────────────────────────────────────────────────────────

/**
 * Slug prefixes used by spec-local seed code. Brands matching any of these
 * are always test-only.
 */
const SLUG_PREFIXES = [
  "contacts-e2e-",
  "companies-e2e-",
  "marketing-editors-e2e-",
  "t2a-bb-",
  "phase7-act-",
  "brand-a-2f1-",
  "brand-b-2f1-",
  "a12-a-",
  "a12-b-",
] as const;
type SlugPrefix = (typeof SLUG_PREFIXES)[number];

/**
 * Brand-name prefixes called out in task #360 — these are seed names that
 * persisted in the dev DB after aborted runs. Sweeping by name (not just
 * slug) catches future spec authors who pick a stable name without a
 * matching slug prefix.
 */
const BRAND_NAME_PREFIXES = [
  "BrandB ",
  "Brand B 2f1 ",
  "Brand A 2f1 ",
  "Phase7 Activity Brand ",
  "A12 A ",
  "A12 B ",
] as const;

/**
 * Expenses.vendor strings inserted by tests.
 */
const EXPENSE_VENDOR_PREFIXES = ["E2E Test Vendor"] as const;

interface PollutingRow {
  id: string;
  slug: string;
  name: string;
}

async function resolvePollutingBrandIds(
  orgId?: string | null,
): Promise<PollutingRow[]> {
  const slugLikes = SLUG_PREFIXES.map((p, i) => `slug LIKE $${i + 1}`).join(" OR ");
  const slugParams = SLUG_PREFIXES.map((p) => `${p}%`);
  const nameLikes = BRAND_NAME_PREFIXES.map(
    (p, i) => `name LIKE $${SLUG_PREFIXES.length + i + 1}`,
  ).join(" OR ");
  const nameParams = BRAND_NAME_PREFIXES.map((p) => `${p}%`);

  const params: (string | string[])[] = [...slugParams, ...nameParams];
  let orgFilter = "";
  if (orgId) {
    params.push(orgId);
    orgFilter = ` AND org_id = $${params.length}`;
  }

  const { rows } = await pool.query<PollutingRow>(
    `SELECT id, slug, name FROM brands
       WHERE (${slugLikes} OR ${nameLikes})${orgFilter}
       ORDER BY slug`,
    params,
  );
  return rows;
}

export interface ExpenseSweepCounts {
  expensesDeleted: number;
}

/**
 * Delete every expense whose `vendor` matches a known test prefix. Scoped
 * by org when an `orgId` is supplied; otherwise applies globally (CLI
 * usage only). Returns the row count for visibility.
 */
export async function sweepE2EExpensePollution(
  orgId?: string | null,
): Promise<ExpenseSweepCounts> {
  const likes = EXPENSE_VENDOR_PREFIXES.map((p) => `${p}%`);
  if (orgId) {
    const r = await pool.query(
      `DELETE FROM expenses
         WHERE org_id = $1
           AND vendor IS NOT NULL
           AND vendor LIKE ANY($2::text[])`,
      [orgId, likes],
    );
    return { expensesDeleted: r.rowCount ?? 0 };
  }
  const r = await pool.query(
    `DELETE FROM expenses
       WHERE vendor IS NOT NULL
         AND vendor LIKE ANY($1::text[])`,
    [likes],
  );
  return { expensesDeleted: r.rowCount ?? 0 };
}

export interface SweepReport {
  brandsFound: number;
  brandsDeleted: number;
  expensesDeleted: number;
}

/**
 * Pre-test sweeper: purge stale test brands (by slug + name) and stale
 * E2E vendor expenses. Safe to call repeatedly; idempotent on a clean DB.
 *
 * Honors the same MAX_BRAND_IDS safety cap used by the CLI: if the
 * SELECT returns more than the cap, throws before issuing any writes so
 * a runaway pattern can't nuke real data.
 */
export async function sweepE2ETestPollution(
  orgId: string,
): Promise<SweepReport> {
  if (!orgId) {
    throw new Error(
      "sweepE2ETestPollution requires a non-empty orgId — refusing to " +
        "run unscoped to avoid touching another tenant's data.",
    );
  }
  const found = await resolvePollutingBrandIds(orgId);
  if (found.length > MAX_BRAND_IDS) {
    throw new Error(
      `sweepE2ETestPollution: SELECT returned ${found.length} brand row(s) ` +
        `for org ${orgId}, exceeds safety cap ${MAX_BRAND_IDS}. Aborting ` +
        `before any writes — investigate manually.`,
    );
  }
  const brandCounts = await cleanupE2EBrandPollution(found.map((r) => r.id));
  const expenseCounts = await sweepE2EExpensePollution(orgId);
  return {
    brandsFound: found.length,
    brandsDeleted: brandCounts.brandsDeleted,
    expensesDeleted: expenseCounts.expensesDeleted,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// CLI wrapper
// ─────────────────────────────────────────────────────────────────────────

function prefixOf(slug: string): SlugPrefix | null {
  for (const p of SLUG_PREFIXES) {
    if (slug.startsWith(p)) return p;
  }
  return null;
}

function namePrefixOf(name: string): string | null {
  for (const p of BRAND_NAME_PREFIXES) {
    if (name.startsWith(p)) return p;
  }
  return null;
}

async function runCli(): Promise<void> {
  const found = await resolvePollutingBrandIds();
  console.log(
    `[cleanup-e2e-brand-pollution] Found ${found.length} polluting brand row(s).`,
  );

  const perPrefix = new Map<SlugPrefix, number>();
  for (const p of SLUG_PREFIXES) perPrefix.set(p, 0);
  const perName = new Map<string, number>();
  for (const p of BRAND_NAME_PREFIXES) perName.set(p, 0);
  for (const row of found) {
    const sp = prefixOf(row.slug);
    if (sp) {
      perPrefix.set(sp, (perPrefix.get(sp) ?? 0) + 1);
      continue;
    }
    const np = namePrefixOf(row.name);
    if (np) perName.set(np, (perName.get(np) ?? 0) + 1);
  }
  console.log("[cleanup-e2e-brand-pollution] Per-slug counts (pre-delete):");
  for (const p of SLUG_PREFIXES) {
    console.log(`    ${p.padEnd(24)} ${perPrefix.get(p) ?? 0}`);
  }
  console.log("[cleanup-e2e-brand-pollution] Per-name counts (pre-delete):");
  for (const p of BRAND_NAME_PREFIXES) {
    console.log(`    ${p.padEnd(24)} ${perName.get(p) ?? 0}`);
  }

  if (found.length > MAX_BRAND_IDS) {
    throw new Error(
      `Slug/name SELECT returned ${found.length} rows, exceeds safety cap ${MAX_BRAND_IDS}. ` +
        `Aborting before any writes — investigate manually.`,
    );
  }

  const ids = found.map((r) => r.id);
  const counts = await cleanupE2EBrandPollution(ids);

  console.log("[cleanup-e2e-brand-pollution] Cascade counts:");
  console.log(`    clients          (brand_id → NULL)  ${counts.clientsNulled}`);
  console.log(`    client_contacts  (brand_id → NULL)  ${counts.clientContactsNulled}`);
  console.log(`    companies        (brand_id → NULL)  ${counts.companiesNulled}`);
  console.log(`    contact_tag_assignments  (delete)   ${counts.contactTagAssignmentsDeleted}`);
  console.log(`    contact_tags             (delete)   ${counts.contactTagsDeleted}`);
  console.log(`    contact_segments         (delete)   ${counts.contactSegmentsDeleted}`);
  console.log(`    contact_activities       (delete)   ${counts.contactActivitiesDeleted}`);
  console.log(`    contact_imports          (delete)   ${counts.contactImportsDeleted}`);
  console.log(`    contact_import_presets   (delete)   ${counts.contactImportPresetsDeleted}`);
  console.log(`    marketing_campaigns      (delete)   ${counts.marketingCampaignsDeleted}`);
  console.log(`    marketing_sequence_steps (delete)   ${counts.marketingSequenceStepsDeleted}`);
  console.log(`    marketing_sequences      (delete)   ${counts.marketingSequencesDeleted}`);
  console.log(`    brands                   (delete)   ${counts.brandsDeleted}`);

  // Sweep stale E2E vendor expenses (task #360).
  const expenseCounts = await sweepE2EExpensePollution(null);
  console.log(
    `    expenses (vendor LIKE 'E2E Test Vendor%')  ${expenseCounts.expensesDeleted}`,
  );

  // Post-commit verification.
  const verify = await resolvePollutingBrandIds();
  if (verify.length !== 0) {
    throw new Error(
      `Post-commit verification failed: ${verify.length} polluting brand row(s) remain.`,
    );
  }
  console.log(
    "[cleanup-e2e-brand-pollution] Post-commit verification: 0 rows remain. ✓",
  );
}

// Detect direct invocation under tsx/node. import.meta.url + argv[1].
const invokedDirectly = (() => {
  try {
    const entry = process.argv[1];
    if (!entry) return false;
    const thisFileUrl = new URL(import.meta.url).pathname;
    return entry === thisFileUrl || entry.endsWith("cleanup-e2e-brand-pollution.ts");
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  runCli()
    .then(async () => {
      await pool.end().catch(() => {
        /* ignore pool-close errors at exit */
      });
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("[cleanup-e2e-brand-pollution] FAILED:", err);
      await pool.end().catch(() => {
        /* ignore pool-close errors at exit */
      });
      process.exit(1);
    });
}
