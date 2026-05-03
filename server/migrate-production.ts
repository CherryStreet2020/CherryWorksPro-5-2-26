import { pool, db } from "./db";
import { sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Sprint 2i.6 — Phase 0 boot-safe SQL replay.
 *
 * Reads every migrations/*.sql file from disk in lexicographic order and
 * executes it against the prod DB. The existing files are idempotent
 * (CREATE TABLE IF NOT EXISTS, DO $$ ... duplicate_object enum guards),
 * so replaying on every boot is safe. This guarantees the schema is in
 * place even when Replit Autoscale silently skips the `npm prestart`
 * hook that would otherwise run `drizzle-kit push --force`.
 *
 * Each file is wrapped in its own try/catch so one failing migration
 * cannot block the others. Task #171: failures are now tracked and
 * surfaced loudly via a `[startup] migration <file> failed — refusing
 * to seed` log line so operators (and the e2e harness) can detect a
 * half-migrated database instead of finding out later via cryptic
 * "relation does not exist" crashes. In non-production we additionally
 * throw after the loop so callers can skip seeding entirely; in
 * production we keep replaying so a single bad file cannot keep the
 * HTTP server from coming up, but the loud warning + the
 * `getLastMigrationFailures()` accessor let downstream steps decide to
 * skip themselves.
 *
 * Files prefixed with `rollback-` are explicitly skipped because they
 * contain destructive `DROP TABLE` / `ALTER TABLE ... DROP COLUMN`
 * statements meant to be applied manually by an operator during a
 * deliberate rollback. Replaying them on every boot would silently
 * destroy production data. This exclusion is documented in the
 * Sprint 2i.6 plan at `.local/tasks/sprint-2i6-boot-safe-migrations.md`.
 */
let lastMigrationFailures: string[] = [];

export function getLastMigrationFailures(): string[] {
  return [...lastMigrationFailures];
}

async function runPhase0SqlReplay(): Promise<void> {
  lastMigrationFailures = [];
  const migrationsDir = path.resolve(process.cwd(), "migrations");
  let entries: string[];
  try {
    entries = await fs.readdir(migrationsDir);
  } catch (e: any) {
    // Task #171 — treat an unreadable migrations dir as a migration
    // failure so the seed gate in server/index.ts skips seeding instead
    // of running against a possibly-empty schema.
    lastMigrationFailures.push("<migrations-dir-unreadable>");
    console.error(
      `[startup] migration <migrations-dir-unreadable> failed — refusing to seed: cannot read ${migrationsDir}: ${e?.message ?? e} (code=${e?.code ?? "n/a"})`,
    );
    if (process.env.NODE_ENV !== "production") {
      throw new Error(
        `[startup] cannot read migrations dir ${migrationsDir} — aborting startup in non-production`,
        { cause: e },
      );
    }
    return;
  }

  const sqlFiles = entries
    .filter((f) => f.endsWith(".sql") && !f.startsWith("rollback-"))
    .sort();
  const skipped = entries.filter((f) => f.endsWith(".sql") && f.startsWith("rollback-")).sort();
  if (skipped.length > 0) {
    console.log(
      `[migrate-production] Phase 0: skipping ${skipped.length} rollback file(s) (destructive, manual-only): ${skipped.join(", ")}`,
    );
  }

  for (const file of sqlFiles) {
    const full = path.join(migrationsDir, file);
    try {
      const contents = await fs.readFile(full, "utf8");
      console.log(`[migrate-production] Phase 0: executing migrations/${file}`);
      await db.execute(sql.raw(contents));
      console.log(`[migrate-production] Phase 0: ${file} done`);
    } catch (e: any) {
      lastMigrationFailures.push(file);
      // Loud, greppable single-line warning. The `[startup] migration X
      // failed — refusing to seed` prefix is what CI/e2e greps for.
      console.error(
        `[startup] migration ${file} failed — refusing to seed: ${e?.message ?? e} (code=${e?.code ?? "n/a"})`,
      );
      // Do not rethrow inside the loop — keep replaying remaining files
      // so we can report every failure in one boot, not just the first.
    }
  }

  if (lastMigrationFailures.length > 0) {
    const summary = `[startup] ${lastMigrationFailures.length} boot-time migration(s) failed: ${lastMigrationFailures.join(", ")}`;
    if (process.env.NODE_ENV !== "production") {
      // Fail fast in dev/test so a regression in a new migration file
      // surfaces immediately instead of leaving a half-migrated DB.
      throw new Error(`${summary} — aborting startup in non-production`);
    }
    console.error(`${summary} — continuing in production; downstream seed steps will be skipped`);
  }
}

export async function runProductionMigrations(): Promise<void> {
  await runPhase0SqlReplay();

  const client = await pool.connect();
  try {
    console.log("[migration] Running production data migrations...");

    const deanAcct = await client.query(
      `SELECT u.id, u.password, o.id as org_id, o.plan_tier FROM users u JOIN orgs o ON u.org_id = o.id WHERE u.email = 'dd2011@me.com' AND u.name = 'Dean Dunagan' LIMIT 1`
    );
    if (deanAcct.rows.length > 0) {
      const row = deanAcct.rows[0];
      const alreadySet = await bcrypt.compare("Jetsin2026!", row.password || "");
      if (!alreadySet || row.plan_tier !== "ENTERPRISE") {
        const newHash = await bcrypt.hash("Jetsin2026!", 10);
        await client.query(`UPDATE users SET password = $1, role = 'ADMIN' WHERE email = 'dd2011@me.com'`, [newHash]);
        await client.query(`UPDATE orgs SET plan_tier = 'ENTERPRISE' WHERE id = $1 AND plan_tier != 'ENTERPRISE'`, [row.org_id]);
        console.log("[migration] dd2011@me.com password reset + enterprise tier applied");
      }
    }

    let totalFixed = 0;

    const r2 = await client.query(`
      UPDATE invoice_lines SET org_id = (
        SELECT org_id FROM invoices WHERE invoices.id = invoice_lines.invoice_id
      ) WHERE org_id IS NULL AND invoice_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM invoices WHERE invoices.id = invoice_lines.invoice_id AND invoices.org_id IS NOT NULL)
    `);
    if (r2.rowCount) totalFixed += r2.rowCount;

    const r3 = await client.query(`
      UPDATE invoice_revisions SET org_id = (
        SELECT org_id FROM invoices WHERE invoices.id = invoice_revisions.invoice_id
      ) WHERE org_id IS NULL AND invoice_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM invoices WHERE invoices.id = invoice_revisions.invoice_id AND invoices.org_id IS NOT NULL)
    `);
    if (r3.rowCount) totalFixed += r3.rowCount;

    const r4 = await client.query(`
      UPDATE estimate_lines SET org_id = (
        SELECT org_id FROM estimates WHERE estimates.id = estimate_lines.estimate_id
      ) WHERE org_id IS NULL AND estimate_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM estimates WHERE estimates.id = estimate_lines.estimate_id AND estimates.org_id IS NOT NULL)
    `);
    if (r4.rowCount) totalFixed += r4.rowCount;

    const r5 = await client.query(`
      UPDATE project_members SET org_id = (
        SELECT org_id FROM projects WHERE projects.id = project_members.project_id
      ) WHERE org_id IS NULL AND project_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM projects WHERE projects.id = project_members.project_id AND projects.org_id IS NOT NULL)
    `);
    if (r5.rowCount) totalFixed += r5.rowCount;

    const r6 = await client.query(`
      UPDATE imported_keys SET org_id = (
        SELECT org_id FROM import_runs WHERE import_runs.id = imported_keys.import_run_id
      ) WHERE org_id IS NULL AND import_run_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM import_runs WHERE import_runs.id = imported_keys.import_run_id AND import_runs.org_id IS NOT NULL)
    `);
    if (r6.rowCount) totalFixed += r6.rowCount;

    // ─── stripe_events FK consolidation (all cleanup + FK in one atomic block) ───
    {
      const seFkCheck = await client.query(
        `SELECT rc.delete_rule FROM information_schema.table_constraints tc
         JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.constraint_schema
         WHERE tc.table_name = 'stripe_events' AND tc.constraint_name = 'stripe_events_org_id_orgs_id_fk' AND tc.constraint_type = 'FOREIGN KEY'`
      );
      const fkExists = seFkCheck.rowCount! > 0;
      const fkCorrect = fkExists && seFkCheck.rows[0]?.delete_rule === "CASCADE";

      if (!fkCorrect) {
        const r7check = await client.query(`SELECT COUNT(*) AS cnt FROM stripe_events WHERE org_id IS NULL`);
        const orphanedNull = Number(r7check.rows[0]?.cnt || 0);
        if (orphanedNull > 0) {
          const orgCount = await client.query(`SELECT COUNT(*) AS cnt FROM orgs`);
          const numOrgs = Number(orgCount.rows[0]?.cnt || 0);
          if (numOrgs === 1) {
            const r7 = await client.query(`UPDATE stripe_events SET org_id = (SELECT id FROM orgs LIMIT 1) WHERE org_id IS NULL`);
            if (r7.rowCount) totalFixed += r7.rowCount;
          } else if (orphanedNull > 0) {
            await client.query(`DELETE FROM stripe_events WHERE org_id IS NULL`);
            console.log(`[migration] Deleted ${orphanedNull} stripe_events with NULL org_id (${numOrgs} orgs, cannot auto-assign)`);
          }
        }

        const orphanedInvalid = await client.query(
          `DELETE FROM stripe_events WHERE org_id IS NOT NULL AND org_id NOT IN (SELECT id FROM orgs)`
        );
        if (orphanedInvalid.rowCount && orphanedInvalid.rowCount > 0) {
          console.log(`[migration] Deleted ${orphanedInvalid.rowCount} orphaned stripe_events with invalid org_id`);
        }

        if (fkExists) {
          await client.query(`ALTER TABLE stripe_events DROP CONSTRAINT stripe_events_org_id_orgs_id_fk`);
        }
        await client.query(`ALTER TABLE stripe_events ADD CONSTRAINT stripe_events_org_id_orgs_id_fk FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE`);
        console.log(`[migration] stripe_events FK ensured (org_id -> orgs.id CASCADE)`);
      }
    }

    const colTypeChecks = [
      { table: 'users', column: 'hourly_pay_rate', targetType: 'text' },
      { table: 'users', column: 'salary_amount', targetType: 'text' },
    ];
    for (const { table, column, targetType } of colTypeChecks) {
      const typeResult = await client.query(
        `SELECT data_type FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
        [table, column]
      );
      if (typeResult.rows.length > 0 && typeResult.rows[0].data_type !== targetType) {
        const currentType = typeResult.rows[0].data_type;
        console.log(`[migration] Converting ${table}.${column} from ${currentType} to ${targetType}`);
        await client.query(`ALTER TABLE "${table}" ALTER COLUMN "${column}" SET DATA TYPE ${targetType} USING "${column}"::${targetType}`);
        console.log(`[migration] ${table}.${column} converted to ${targetType}`);
      }
    }

    // ─── P0-TERM-PURGE: Rename CONSULTANT → TEAM_MEMBER ───
    try {
      const enumCheck = await client.query(`SELECT 1 FROM pg_enum WHERE enumlabel = 'CONSULTANT' AND enumtypid = 'user_role'::regtype`);
      if (enumCheck.rows.length > 0) {
        await client.query(`ALTER TYPE user_role RENAME VALUE 'CONSULTANT' TO 'TEAM_MEMBER'`);
        console.log("[migration] user_role enum: CONSULTANT → TEAM_MEMBER");
      }
    } catch (e: any) { console.warn("[migration] user_role enum rename skipped:", e.message); }

    try {
      const colCheck = await client.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'orgs' AND column_name = 'max_consultants'`);
      if (colCheck.rows.length > 0) {
        await client.query(`ALTER TABLE orgs RENAME COLUMN max_consultants TO max_team_members`);
        console.log("[migration] orgs.max_consultants → max_team_members");
      }
    } catch (e: any) { console.warn("[migration] orgs column rename skipped:", e.message); }

    try {
      const colCheck2 = await client.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'consultant_payouts_v2' AND column_name = 'consultant_id'`);
      if (colCheck2.rows.length > 0) {
        await client.query(`ALTER TABLE consultant_payouts_v2 RENAME COLUMN consultant_id TO team_member_id`);
        console.log("[migration] consultant_payouts_v2.consultant_id → team_member_id");
      }
    } catch (e: any) { console.warn("[migration] payouts column rename skipped:", e.message); }

    try {
      const tblCheck = await client.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'consultant_payouts_v2'`);
      if (tblCheck.rows.length > 0) {
        await client.query(`ALTER TABLE consultant_payouts_v2 RENAME TO team_member_payouts_v2`);
        console.log("[migration] consultant_payouts_v2 → team_member_payouts_v2");
      }
    } catch (e: any) { console.warn("[migration] payouts table rename skipped:", e.message); }

    // ─── Contractor term purge (Bundle 29) ───
    try {
      const cptCheck = await client.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'contractor_payouts'`);
      if (cptCheck.rows.length > 0) {
        await client.query(`ALTER TABLE contractor_payouts RENAME TO imported_payouts`);
        console.log("[migration] contractor_payouts → imported_payouts");
      }
    } catch (e: any) { console.warn("[migration] imported_payouts rename skipped:", e.message); }

    try {
      const casCheck = await client.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'contractor_agreement_signed'`);
      if (casCheck.rows.length > 0) {
        await client.query(`ALTER TABLE users RENAME COLUMN contractor_agreement_signed TO agreement_signed`);
        console.log("[migration] users.contractor_agreement_signed → agreement_signed");
      }
    } catch (e: any) { console.warn("[migration] agreement_signed rename skipped:", e.message); }

    try {
      const wtResult = await client.query(`UPDATE users SET worker_type = 'INDEPENDENT' WHERE worker_type = '1099_CONTRACTOR'`);
      if (wtResult.rowCount && wtResult.rowCount > 0) {
        console.log(`[migration] Updated ${wtResult.rowCount} users from 1099_CONTRACTOR → INDEPENDENT`);
      }
    } catch (e: any) { console.warn("[migration] worker_type update skipped:", e.message); }

    // ─── GL account terminology fix (Bundle 38) ───
    try {
      const r2100 = await client.query(
        `UPDATE gl_accounts SET name = 'Accrued Team Member Payable' WHERE account_number = '2100' AND name != 'Accrued Team Member Payable'`
      );
      if (r2100.rowCount && r2100.rowCount > 0) console.log(`[migration] GL 2100: ${r2100.rowCount} row(s) → "Accrued Team Member Payable"`);
    } catch (e: any) { console.warn("[migration] GL 2100 rename skipped:", e.message); }

    try {
      const r5100 = await client.query(
        `UPDATE gl_accounts SET name = 'Team Payout Costs' WHERE account_number = '5100' AND name != 'Team Payout Costs'`
      );
      if (r5100.rowCount && r5100.rowCount > 0) console.log(`[migration] GL 5100: ${r5100.rowCount} row(s) → "Team Payout Costs"`);
    } catch (e: any) { console.warn("[migration] GL 5100 rename skipped:", e.message); }

    try {
      const rExp = await client.query(
        `UPDATE expense_categories SET description = REPLACE(description, 'contractors', 'professionals') WHERE description ILIKE '%contractors%'`
      );
      if (rExp.rowCount && rExp.rowCount > 0) console.log(`[migration] expense_categories: ${rExp.rowCount} row(s) "contractors" → "professionals"`);
    } catch (e: any) { console.warn("[migration] expense_categories fix skipped:", e.message); }

    // ─── exchange_rates.org_id column ───
    const erColCheck = await client.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'exchange_rates' AND column_name = 'org_id'
    `);
    if (erColCheck.rows.length === 0) {
      await client.query(`ALTER TABLE exchange_rates ADD COLUMN org_id VARCHAR(36)`);
      console.log("[migration] exchange_rates.org_id column added");
    }

    // ─── Invoice/estimate org+number uniqueness ───
    try {
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS invoices_org_number_idx ON invoices(org_id, number)`);
      console.log("[migration] invoices_org_number_idx unique index ensured");
    } catch (e: any) {
      console.warn("[migration] invoices_org_number_idx skipped (duplicates exist):", e.message);
    }
    try {
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS estimates_org_number_idx ON estimates(org_id, number)`);
      console.log("[migration] estimates_org_number_idx unique index ensured");
    } catch (e: any) {
      console.warn("[migration] estimates_org_number_idx skipped (duplicates exist):", e.message);
    }

    // ─── Performance indexes (idempotent — IF NOT EXISTS) ───
    const indexStatements = [
      `CREATE INDEX IF NOT EXISTS idx_users_org_id ON users(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_clients_org_id ON clients(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_client_contacts_org_id ON client_contacts(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_projects_org_id ON projects(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_project_members_org_id ON project_members(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_project_services_project_id ON project_services(project_id)`,
      `CREATE INDEX IF NOT EXISTS idx_services_org_id ON services(org_id)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_services_org_name ON services(org_id, lower(name)) WHERE is_active = true`,
      `CREATE INDEX IF NOT EXISTS idx_time_entries_org_id ON time_entries(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_time_entries_user_id ON time_entries(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_time_entries_project_id ON time_entries(project_id)`,
      `CREATE INDEX IF NOT EXISTS idx_time_entries_date ON time_entries(date)`,
      `CREATE INDEX IF NOT EXISTS idx_invoices_org_id ON invoices(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_invoices_client_id ON invoices(client_id)`,
      `CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status)`,
      `CREATE INDEX IF NOT EXISTS idx_invoice_lines_org_id ON invoice_lines(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice_id ON invoice_lines(invoice_id)`,
      `CREATE INDEX IF NOT EXISTS idx_invoice_revisions_org_id ON invoice_revisions(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_invoice_revisions_invoice_id ON invoice_revisions(invoice_id)`,
      `CREATE INDEX IF NOT EXISTS idx_payments_org_id ON payments(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_payments_invoice_id ON payments(invoice_id)`,
      `CREATE INDEX IF NOT EXISTS idx_outbox_emails_org_id ON outbox_emails(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_timesheet_weeks_org_id ON timesheet_weeks(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_audit_logs_org_id ON audit_logs(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_import_runs_org_id ON import_runs(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_import_files_import_run_id ON import_files(import_run_id)`,
      `CREATE INDEX IF NOT EXISTS idx_imported_payouts_org_id ON imported_payouts(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_team_member_payouts_v2_org_id ON team_member_payouts_v2(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_payout_time_entries_payout_id ON payout_time_entries(payout_id)`,
      `CREATE INDEX IF NOT EXISTS idx_recurring_invoice_templates_org_id ON recurring_invoice_templates(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_estimates_org_id ON estimates(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_estimates_client_id ON estimates(client_id)`,
      `CREATE INDEX IF NOT EXISTS idx_estimate_lines_org_id ON estimate_lines(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_expense_categories_org_id ON expense_categories(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_expenses_org_id ON expenses(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_expenses_user_id ON expenses(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date)`,
      `CREATE INDEX IF NOT EXISTS idx_expenses_report_id ON expenses(report_id)`,
      `CREATE INDEX IF NOT EXISTS idx_expense_reports_org_id ON expense_reports(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_expense_reports_user_id ON expense_reports(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_bank_connections_org_id ON bank_connections(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_bank_transactions_org_id ON bank_transactions(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_bank_transaction_matches_org_id ON bank_transaction_matches(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_bank_reconciliation_logs_org_id ON bank_reconciliation_logs(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_gl_accounts_org_id ON gl_accounts(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_gl_journal_entries_org_id ON gl_journal_entries(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_gl_journal_lines_journal_entry_id ON gl_journal_lines(journal_entry_id)`,
      `CREATE INDEX IF NOT EXISTS idx_support_requests_org_id ON support_requests(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_api_keys_org_id ON api_keys(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_api_keys_key_prefix ON api_keys(key_prefix)`,
      `CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_org_id ON webhook_endpoints(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_org_id ON webhook_deliveries(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_endpoint_id ON webhook_deliveries(webhook_endpoint_id)`,
      `CREATE INDEX IF NOT EXISTS idx_stripe_events_org_id ON stripe_events(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_project_services_project_id ON project_services(project_id)`,
      `CREATE INDEX IF NOT EXISTS idx_expenses_category_id ON expenses(category_id)`,
      `CREATE INDEX IF NOT EXISTS idx_expenses_org_status ON expenses(org_id, status)`,
      `CREATE INDEX IF NOT EXISTS idx_time_entries_org_date ON time_entries(org_id, date)`,
      `CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_org_status ON webhook_deliveries(org_id, status)`,
      `CREATE INDEX IF NOT EXISTS idx_import_runs_org_id ON import_runs(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_project_members_project_id ON project_members(project_id)`,
      `CREATE INDEX IF NOT EXISTS idx_project_members_user_id ON project_members(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_gl_journal_lines_account_id ON gl_journal_lines(account_id)`,
      `CREATE INDEX IF NOT EXISTS idx_timesheet_weeks_user_id ON timesheet_weeks(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_support_requests_user_id ON support_requests(user_id)`,
    ];
    let indexesCreated = 0;
    for (const stmt of indexStatements) {
      try {
        await client.query(stmt);
        indexesCreated++;
      } catch (idxErr: any) {
        if (!idxErr.message.includes("already exists")) {
          console.error(`[migration] Index error: ${idxErr.message}`);
        }
      }
    }
    console.log(`[migration] Ensured ${indexesCreated} performance indexes`);

    try {
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_gl_accounts_org_account_number ON gl_accounts(org_id, account_number)`);
    } catch (uqErr: any) {
      if (!uqErr.message.includes("already exists")) {
        console.warn(`[migration] gl_accounts unique index: ${uqErr.message}`);
      }
    }
    console.log("[migration] gl_accounts(org_id, account_number) unique index ensured");

    await client.query(`
      CREATE OR REPLACE FUNCTION trigger_set_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    const updatedAtTables = [
      'orgs', 'users', 'clients', 'client_contacts', 'projects', 'services',
      'time_entries', 'invoices', 'payments', 'outbox_emails',
      'timesheet_weeks', 'expenses', 'expense_reports', 'expense_categories',
      'recurring_invoice_templates', 'team_member_payouts_v2', 'estimates',
      'gl_accounts', 'gl_journal_entries', 'gl_journal_lines',
      'support_requests', 'api_keys', 'webhook_endpoints', 'webhook_deliveries',
      'bank_connections', 'bank_transactions', 'bank_transaction_matches',
    ];
    for (const tbl of updatedAtTables) {
      try {
        await client.query(`ALTER TABLE "${tbl}" ADD COLUMN updated_at TIMESTAMP DEFAULT NOW() NOT NULL`);
      } catch {}
      try {
        await client.query(`DROP TRIGGER IF EXISTS set_updated_at ON "${tbl}"`);
        await client.query(`CREATE TRIGGER set_updated_at BEFORE UPDATE ON "${tbl}" FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at()`);
      } catch (trigErr: any) {
        if (!trigErr.message?.includes("already exists")) {
          console.warn(`[migration] trigger on ${tbl}: ${trigErr.message}`);
        }
      }
    }

    try {
      await client.query(`ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 4`);
      await client.query(`ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMP`);
    } catch {}

    await client.query(`
      CREATE TABLE IF NOT EXISTS newsletter_subscribers (
        id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT NOT NULL UNIQUE,
        org_id VARCHAR(36),
        subscribed_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);

    const orgIdChildTables = [
      {
        table: 'project_services',
        parent: 'projects',
        fk: 'project_id',
        parentPk: 'id',
      },
      {
        table: 'import_files',
        parent: 'import_runs',
        fk: 'import_run_id',
        parentPk: 'id',
      },
      {
        table: 'payout_time_entries',
        parent: 'team_member_payouts_v2',
        fk: 'payout_id',
        parentPk: 'id',
      },
      {
        table: 'gl_journal_lines',
        parent: 'gl_journal_entries',
        fk: 'journal_entry_id',
        parentPk: 'id',
      },
    ];

    for (const { table, parent, fk, parentPk } of orgIdChildTables) {
      try {
        await client.query(`ALTER TABLE "${table}" ADD COLUMN org_id VARCHAR(36) REFERENCES orgs(id)`);
        console.log(`[migration] Added org_id column to ${table}`);
      } catch {}
      const backfillResult = await client.query(`
        UPDATE "${table}" SET org_id = (
          SELECT org_id FROM "${parent}" WHERE "${parent}"."${parentPk}" = "${table}"."${fk}"
        ) WHERE org_id IS NULL AND "${fk}" IS NOT NULL
        AND EXISTS (SELECT 1 FROM "${parent}" WHERE "${parent}"."${parentPk}" = "${table}"."${fk}" AND "${parent}".org_id IS NOT NULL)
      `);
      if (backfillResult.rowCount && backfillResult.rowCount > 0) {
        totalFixed += backfillResult.rowCount;
        console.log(`[migration] Backfilled ${backfillResult.rowCount} org_id rows in ${table}`);
      }
      try {
        await client.query(`ALTER TABLE "${table}" ALTER COLUMN org_id SET NOT NULL`);
      } catch {}
      try {
        await client.query(`CREATE INDEX IF NOT EXISTS idx_${table}_org_id ON "${table}"(org_id)`);
      } catch {}
    }

    try {
      await client.query(`ALTER TABLE time_entries ADD COLUMN cost_rate_snapshot NUMERIC(10,2)`);
      console.log("[migration] Added cost_rate_snapshot column to time_entries");
    } catch {}

    try {
      await client.query(`
        UPDATE time_entries SET cost_rate_snapshot = (
          SELECT COALESCE(pm.cost_rate_hourly, 0)
          FROM project_members pm
          WHERE pm.project_id = time_entries.project_id AND pm.user_id = time_entries.user_id
          LIMIT 1
        ) WHERE cost_rate_snapshot IS NULL
      `);
    } catch {}

    const orphanCheck = await client.query(`
      SELECT 'invoice_lines' AS tbl, COUNT(*) AS cnt FROM invoice_lines WHERE org_id IS NULL
      UNION ALL SELECT 'invoice_revisions', COUNT(*) FROM invoice_revisions WHERE org_id IS NULL
      UNION ALL SELECT 'estimate_lines', COUNT(*) FROM estimate_lines WHERE org_id IS NULL
      UNION ALL SELECT 'project_members', COUNT(*) FROM project_members WHERE org_id IS NULL
      UNION ALL SELECT 'imported_keys', COUNT(*) FROM imported_keys WHERE org_id IS NULL
      UNION ALL SELECT 'stripe_events', COUNT(*) FROM stripe_events WHERE org_id IS NULL
      UNION ALL SELECT 'project_services', COUNT(*) FROM project_services WHERE org_id IS NULL
      UNION ALL SELECT 'import_files', COUNT(*) FROM import_files WHERE org_id IS NULL
      UNION ALL SELECT 'payout_time_entries', COUNT(*) FROM payout_time_entries WHERE org_id IS NULL
      UNION ALL SELECT 'gl_journal_lines', COUNT(*) FROM gl_journal_lines WHERE org_id IS NULL
    `);
    const orphans = orphanCheck.rows.filter((r: any) => Number(r.cnt) > 0);
    if (orphans.length > 0) {
      for (const o of orphans) {
        console.error(`[migration] CRITICAL: ${o.cnt} rows in ${o.tbl} still have NULL org_id with no resolvable parent`);
      }
    }

    if (totalFixed > 0) {
      console.log(`[migration] Backfilled org_id on ${totalFixed} rows across child tables`);
    } else {
      console.log("[migration] No null org_id values found, nothing to fix");
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(36) NOT NULL REFERENCES users(id),
        token VARCHAR(128) NOT NULL UNIQUE,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    console.log("[migration] password_reset_tokens table ensured");

    await client.query(`
      ALTER TABLE orgs ADD COLUMN IF NOT EXISTS date_format VARCHAR(20) DEFAULT 'MM/DD/YYYY'
    `);
    console.log("[migration] orgs.date_format column ensured");

    await client.query(`
      ALTER TABLE orgs ADD COLUMN IF NOT EXISTS tax_calculation_mode VARCHAR(30) NOT NULL DEFAULT 'tax_after_discount'
    `);
    console.log("[migration] orgs.tax_calculation_mode column ensured");

    await client.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMP`);
    await client.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS deletion_scheduled_for TIMESTAMP`);
    console.log("[migration] orgs deletion columns ensured");

    await client.query(`
      CREATE TABLE IF NOT EXISTS active_sessions (
        id SERIAL PRIMARY KEY,
        org_id VARCHAR(36) NOT NULL REFERENCES orgs(id),
        user_id VARCHAR(36) NOT NULL REFERENCES users(id),
        session_id TEXT NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        device_label TEXT,
        city TEXT,
        last_active_at TIMESTAMP NOT NULL DEFAULT NOW(),
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_active_sessions_user ON active_sessions(user_id)`);
    await client.query(`DROP INDEX IF EXISTS idx_active_sessions_session`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_active_sessions_session_uniq ON active_sessions(session_id)`);
    console.log("[migration] active_sessions table ensured");

    await client.query(`
      ALTER TABLE webhook_endpoints ADD COLUMN IF NOT EXISTS dns_consecutive_failures INTEGER NOT NULL DEFAULT 0
    `);
    console.log("[migration] webhook_endpoints.dns_consecutive_failures column ensured");

    await client.query(`ALTER TABLE webhook_endpoints ADD COLUMN IF NOT EXISTS old_secret TEXT`);
    await client.query(`ALTER TABLE webhook_endpoints ADD COLUMN IF NOT EXISTS secret_rotated_at TIMESTAMP`);
    console.log("[migration] webhook_endpoints secret rotation columns ensured");

    await client.query(`
      ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS last_error_type VARCHAR(30)
    `);
    console.log("[migration] webhook_deliveries.last_error_type column ensured");

    const fkMigrations = [
      { table: "project_members", col: "org_id", constraint: "project_members_org_id_orgs_id_fk" },
      { table: "invoice_lines", col: "org_id", constraint: "invoice_lines_org_id_orgs_id_fk" },
      { table: "invoice_revisions", col: "org_id", constraint: "invoice_revisions_org_id_orgs_id_fk" },
      { table: "estimate_lines", col: "org_id", constraint: "estimate_lines_org_id_orgs_id_fk" },
      { table: "imported_keys", col: "org_id", constraint: "imported_keys_org_id_orgs_id_fk" },
      { table: "support_requests", col: "org_id", constraint: "support_requests_org_id_orgs_id_fk" },
    ];
    for (const fk of fkMigrations) {
      const exists = await client.query(
        `SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = $1 AND table_name = $2`,
        [fk.constraint, fk.table]
      );
      if (exists.rowCount === 0) {
        await client.query(`ALTER TABLE ${fk.table} ADD CONSTRAINT ${fk.constraint} FOREIGN KEY (${fk.col}) REFERENCES orgs(id)`);
      }
    }
    console.log("[migration] orgId FK constraints ensured on 6 tables");

    const userFkExists = await client.query(
      `SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'support_requests_user_id_users_id_fk' AND table_name = 'support_requests'`
    );
    if (userFkExists.rowCount === 0) {
      await client.query(`ALTER TABLE support_requests ADD CONSTRAINT support_requests_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users(id)`);
    }
    console.log("[migration] support_requests.user_id FK constraint ensured");

    // V18: Drop global users.email unique constraint, add composite (org_id, email) unique index
    const globalUniqueExists = await client.query(
      `SELECT 1 FROM pg_indexes WHERE indexname = 'users_email_unique'`
    );
    if (globalUniqueExists.rowCount! > 0) {
      await client.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_unique`);
      console.log("[migration] Dropped global users.email unique constraint");
    }
    const compositeExists = await client.query(
      `SELECT 1 FROM pg_indexes WHERE indexname = 'users_org_email_unique'`
    );
    if (compositeExists.rowCount === 0) {
      await client.query(`CREATE UNIQUE INDEX users_org_email_unique ON users (org_id, email)`);
      console.log("[migration] Created composite unique index users(org_id, email)");
    }

    // V18: stripe_events FK — handled in consolidated block above (line ~53)

    // V18: Force-enable autoPostJournalEntries for all orgs
    const enableGlResult = await client.query(
      `UPDATE orgs SET auto_post_journal_entries = true WHERE auto_post_journal_entries IS NULL OR auto_post_journal_entries = false`
    );
    if (enableGlResult.rowCount && enableGlResult.rowCount > 0) {
      console.log(`[migration] Force-enabled autoPostJournalEntries for ${enableGlResult.rowCount} orgs`);
    }

    // V18: Widen gl_journal_entries.source_ref from varchar(36) to varchar(64) for void refs
    const sourceRefType = await client.query(
      `SELECT character_maximum_length FROM information_schema.columns WHERE table_name = 'gl_journal_entries' AND column_name = 'source_ref'`
    );
    if (sourceRefType.rows.length > 0 && Number(sourceRefType.rows[0].character_maximum_length) < 64) {
      await client.query(`ALTER TABLE gl_journal_entries ALTER COLUMN source_ref TYPE varchar(64)`);
      console.log("[migration] Widened gl_journal_entries.source_ref to varchar(64)");
    }

    // V18: Add onDelete CASCADE to gl_journal_lines.journal_entry_id and RESTRICT to gl_journal_lines.account_id
    const glLineJeFk = await client.query(
      `SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'gl_journal_lines_journal_entry_id_gl_journal_entries_id_fk' AND table_name = 'gl_journal_lines'`
    );
    if (glLineJeFk.rowCount! > 0) {
      await client.query(`ALTER TABLE gl_journal_lines DROP CONSTRAINT gl_journal_lines_journal_entry_id_gl_journal_entries_id_fk`);
      await client.query(`ALTER TABLE gl_journal_lines ADD CONSTRAINT gl_journal_lines_journal_entry_id_gl_journal_entries_id_fk FOREIGN KEY (journal_entry_id) REFERENCES gl_journal_entries(id) ON DELETE CASCADE`);
      console.log("[migration] Updated gl_journal_lines.journal_entry_id FK to CASCADE");
    }
    const glLineAcctFk = await client.query(
      `SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'gl_journal_lines_account_id_gl_accounts_id_fk' AND table_name = 'gl_journal_lines'`
    );
    if (glLineAcctFk.rowCount! > 0) {
      await client.query(`ALTER TABLE gl_journal_lines DROP CONSTRAINT gl_journal_lines_account_id_gl_accounts_id_fk`);
      await client.query(`ALTER TABLE gl_journal_lines ADD CONSTRAINT gl_journal_lines_account_id_gl_accounts_id_fk FOREIGN KEY (account_id) REFERENCES gl_accounts(id) ON DELETE RESTRICT`);
      console.log("[migration] Updated gl_journal_lines.account_id FK to RESTRICT");
    }
    // M2: Backfill expense category_id for expenses that have no category
    const uncategorizedExpenses = await client.query(
      `SELECT COUNT(*) as cnt FROM expenses WHERE category_id IS NULL`
    );
    if (Number(uncategorizedExpenses.rows[0].cnt) > 0) {
      const backfilled = await client.query(`
        UPDATE expenses e
        SET category_id = (
          SELECT ec.id FROM expense_categories ec
          WHERE ec.org_id = e.org_id
          ORDER BY ec.name ASC
          LIMIT 1
        )
        WHERE e.category_id IS NULL
        AND EXISTS (SELECT 1 FROM expense_categories ec2 WHERE ec2.org_id = e.org_id)
      `);
      if (backfilled.rowCount && backfilled.rowCount > 0) {
        console.log(`[migration] Backfilled category_id on ${backfilled.rowCount} expense(s)`);
      }
    }

    const costBackfill = await client.query(`
      UPDATE project_members pm
      SET cost_rate_hourly = CAST(u.hourly_pay_rate AS numeric)
      FROM users u
      WHERE pm.user_id = u.id
      AND (pm.cost_rate_hourly IS NULL OR pm.cost_rate_hourly = 0)
      AND u.hourly_pay_rate IS NOT NULL
      AND u.hourly_pay_rate != ''
      AND u.hourly_pay_rate != '0'
      AND u.hourly_pay_rate ~ '^[0-9]+(\\.[0-9]+)?$'
    `);
    if (costBackfill.rowCount && costBackfill.rowCount > 0) {
      console.log(`[migration] Backfilled cost_rate_hourly on ${costBackfill.rowCount} project member(s)`);
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS mfa_enrollments (
        user_id VARCHAR(36) PRIMARY KEY REFERENCES users(id),
        org_id VARCHAR(36) NOT NULL REFERENCES orgs(id),
        secret TEXT NOT NULL,
        method TEXT NOT NULL DEFAULT 'totp',
        enabled BOOLEAN NOT NULL DEFAULT false,
        recovery_codes JSONB NOT NULL DEFAULT '[]',
        used_recovery_codes JSONB NOT NULL DEFAULT '[]',
        webauthn_credentials JSONB NOT NULL DEFAULT '[]',
        enforce_for_admins BOOLEAN NOT NULL DEFAULT false,
        enrolled_at TIMESTAMP NOT NULL DEFAULT NOW(),
        last_verified_at TIMESTAMP
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mfa_enrollments_org ON mfa_enrollments (org_id)`);
    console.log("[migration] mfa_enrollments table ensured");

    await client.query(`
      CREATE TABLE IF NOT EXISTS bulk_ops (
        id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id VARCHAR(36) NOT NULL REFERENCES orgs(id),
        user_id VARCHAR(36) NOT NULL REFERENCES users(id),
        entity TEXT NOT NULL,
        action TEXT NOT NULL,
        item_ids JSONB NOT NULL,
        tag TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        confirmed_at TIMESTAMP,
        undone_at TIMESTAMP,
        expires_at TIMESTAMP
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_bulk_ops_org_status ON bulk_ops (org_id, status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_bulk_ops_expires ON bulk_ops (expires_at) WHERE expires_at IS NOT NULL`);
    console.log("[migration] bulk_ops table ensured");

    await client.query(`
      CREATE TABLE IF NOT EXISTS org_email_alert_webhooks (
        org_id VARCHAR(36) PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,
        webhook_url TEXT NOT NULL,
        cooldown_ms INTEGER,
        updated_by VARCHAR(36),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      ALTER TABLE org_email_alert_webhooks
        ADD COLUMN IF NOT EXISTS last_tested_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS last_test_ok BOOLEAN,
        ADD COLUMN IF NOT EXISTS last_test_error TEXT
    `);
    console.log("[migration] org_email_alert_webhooks table ensured");

    // ─── Collapse duplicate project_members + backfill time_entries rates ───
    try {
      const dupCheck = await client.query(`
        SELECT project_id, user_id, COUNT(*) AS cnt
        FROM project_members
        GROUP BY project_id, user_id
        HAVING COUNT(*) > 1
      `);
      if (dupCheck.rows.length > 0) {
        console.log(`[migration] Found ${dupCheck.rows.length} duplicate project_member groups, collapsing...`);

        await client.query(`
          DELETE FROM project_members
          WHERE id NOT IN (
            SELECT DISTINCT ON (project_id, user_id) id
            FROM project_members
            ORDER BY project_id, user_id,
              CAST(hourly_rate AS numeric) DESC,
              CAST(cost_rate_hourly AS numeric) DESC,
              id ASC
          )
        `);

        const deleted = await client.query(`SELECT COUNT(*) AS c FROM project_members`);
        console.log(`[migration] Duplicate project_members collapsed. Remaining rows: ${deleted.rows[0]?.c}`);
      } else {
        console.log("[migration] No duplicate project_members found");
      }

      const backfilled = await client.query(`
        UPDATE time_entries te
        SET
          rate = CASE WHEN (te.rate IS NULL OR CAST(te.rate AS numeric) = 0)
                      THEN COALESCE(pm.hourly_rate, te.rate) ELSE te.rate END,
          cost_rate_snapshot = CASE WHEN (te.cost_rate_snapshot IS NULL OR CAST(te.cost_rate_snapshot AS numeric) = 0)
                                   THEN COALESCE(pm.cost_rate_hourly, te.cost_rate_snapshot) ELSE te.cost_rate_snapshot END
        FROM project_members pm
        WHERE te.project_id = pm.project_id
          AND te.user_id = pm.user_id
          AND (
            (te.rate IS NULL OR CAST(te.rate AS numeric) = 0)
            OR (te.cost_rate_snapshot IS NULL OR CAST(te.cost_rate_snapshot AS numeric) = 0)
          )
      `);
      console.log(`[migration] Backfilled ${backfilled.rowCount} time_entries with rates from project_members`);

      // Bundle 48: Backfill cost_rate_snapshot for true legacy-orphaned entries
      // — those whose (project_id, user_id) project_members row no longer
      // exists at all (e.g. the team member was removed from the project after
      // the entry was logged). We deliberately DO NOT touch entries whose
      // membership still exists with a null/zero rate, because that's an
      // active "rate not set yet" case that should keep showing the missing-
      // rate warning rather than silently inheriting an unrelated rate.
      // Order of preference: the user's most recent prior snapshot, then any
      // other project_members.cost_rate_hourly they have in the same org.
      // Entries with no derivable rate are left NULL so the warning can flag
      // them as needing a fresh cost-rate decision.
      const legacyByPriorSnapshot = await client.query(`
        UPDATE time_entries te
        SET cost_rate_snapshot = src.snap
        FROM (
          SELECT DISTINCT ON (user_id, org_id) user_id, org_id, cost_rate_snapshot AS snap
          FROM time_entries
          WHERE cost_rate_snapshot IS NOT NULL
            AND CAST(cost_rate_snapshot AS numeric) > 0
          ORDER BY user_id, org_id, date DESC, id DESC
        ) src
        WHERE te.user_id = src.user_id
          AND te.org_id = src.org_id
          AND (te.cost_rate_snapshot IS NULL OR CAST(te.cost_rate_snapshot AS numeric) = 0)
          AND NOT EXISTS (
            SELECT 1 FROM project_members pm
            WHERE pm.project_id = te.project_id
              AND pm.user_id = te.user_id
          )
      `);
      if (legacyByPriorSnapshot.rowCount && legacyByPriorSnapshot.rowCount > 0) {
        console.log(`[migration] Backfilled ${legacyByPriorSnapshot.rowCount} legacy time_entries from prior snapshots`);
      }

      const legacyByOtherMembership = await client.query(`
        UPDATE time_entries te
        SET cost_rate_snapshot = src.rate
        FROM (
          SELECT DISTINCT ON (user_id, org_id) user_id, org_id, cost_rate_hourly AS rate
          FROM project_members
          WHERE cost_rate_hourly IS NOT NULL
            AND CAST(cost_rate_hourly AS numeric) > 0
          ORDER BY user_id, org_id, CAST(cost_rate_hourly AS numeric) DESC, id DESC
        ) src
        WHERE te.user_id = src.user_id
          AND te.org_id = src.org_id
          AND (te.cost_rate_snapshot IS NULL OR CAST(te.cost_rate_snapshot AS numeric) = 0)
          AND NOT EXISTS (
            SELECT 1 FROM project_members pm
            WHERE pm.project_id = te.project_id
              AND pm.user_id = te.user_id
          )
      `);
      if (legacyByOtherMembership.rowCount && legacyByOtherMembership.rowCount > 0) {
        console.log(`[migration] Backfilled ${legacyByOtherMembership.rowCount} legacy time_entries from other project memberships`);
      }

      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_project_members_proj_user ON project_members(project_id, user_id)`);
      console.log("[migration] ux_project_members_proj_user unique index ensured");
    } catch (e: any) {
      console.warn("[migration] project_members dedup/index failed:", e.message);
    }

    const payInvFks = await client.query(
      `SELECT tc.constraint_name, rc.delete_rule
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
       JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
       JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
       WHERE tc.table_name = 'payments' AND kcu.column_name = 'invoice_id'
         AND ccu.table_name = 'invoices' AND ccu.column_name = 'id'
         AND tc.constraint_type = 'FOREIGN KEY'`
    );
    const hasCascade = payInvFks.rows.some((r: any) => r.delete_rule === "CASCADE");
    if (!hasCascade) {
      for (const row of payInvFks.rows) {
        await client.query(`ALTER TABLE payments DROP CONSTRAINT "${row.constraint_name}"`);
      }
      await client.query(`ALTER TABLE payments ADD CONSTRAINT payments_invoice_id_invoices_id_fk FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE`);
      console.log("[migration] Updated payments.invoice_id FK to CASCADE");
    }

    const npExists = await client.query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notification_preferences') AS exists`
    );
    if (!npExists.rows[0]?.exists) {
      await client.query(`
        CREATE TABLE notification_preferences (
          id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id VARCHAR(36) NOT NULL REFERENCES users(id),
          org_id VARCHAR(36) NOT NULL REFERENCES orgs(id),
          invoice_alerts BOOLEAN NOT NULL DEFAULT true,
          timesheet_reminders BOOLEAN NOT NULL DEFAULT true,
          approval_notifications BOOLEAN NOT NULL DEFAULT true,
          system_updates BOOLEAN NOT NULL DEFAULT true,
          marketing_tips BOOLEAN NOT NULL DEFAULT false,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);
      await client.query(`CREATE UNIQUE INDEX notification_prefs_user_org_idx ON notification_preferences (user_id, org_id)`);
      console.log("[migration] notification_preferences table created");
    }

    try {
      await client.query(`ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS mailbox_alerts BOOLEAN NOT NULL DEFAULT true`);
    } catch (e: any) {
      console.warn("[migration] notification_preferences.mailbox_alerts add skipped:", e.message);
    }

    // Task #303 — Quiet-hours window for non-urgent admin failure emails.
    try {
      await client.query(`
        ALTER TABLE notification_preferences
          ADD COLUMN IF NOT EXISTS quiet_hours_enabled BOOLEAN NOT NULL DEFAULT false,
          ADD COLUMN IF NOT EXISTS quiet_hours_start TEXT NOT NULL DEFAULT '22:00',
          ADD COLUMN IF NOT EXISTS quiet_hours_end TEXT NOT NULL DEFAULT '07:00',
          ADD COLUMN IF NOT EXISTS quiet_hours_timezone TEXT NOT NULL DEFAULT 'UTC'
      `);
    } catch (e: any) {
      console.warn("[migration] notification_preferences.quiet_hours_* add skipped:", e.message);
    }

    // Task #303 — Buffer table for admin failure emails delayed by quiet hours.
    try {
      const panExists = await client.query(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'pending_admin_notifications') AS exists`
      );
      if (!panExists.rows[0]?.exists) {
        await client.query(`
          CREATE TABLE pending_admin_notifications (
            id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
            org_id VARCHAR(36) NOT NULL REFERENCES orgs(id),
            recipient_email TEXT NOT NULL,
            subject TEXT NOT NULL,
            html TEXT NOT NULL,
            body_text TEXT NOT NULL,
            context_tag TEXT NOT NULL,
            release_at TIMESTAMP NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
          )
        `);
        await client.query(
          `CREATE INDEX pending_admin_notifications_release_at_idx ON pending_admin_notifications (release_at)`,
        );
        console.log("[migration] pending_admin_notifications table created");
      }
    } catch (e: any) {
      console.warn("[migration] pending_admin_notifications create skipped:", e.message);
    }

    const ieExists = await client.query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'inbound_emails') AS exists`
    );
    if (!ieExists.rows[0]?.exists) {
      await client.query(`
        CREATE TABLE inbound_emails (
          id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
          from_address TEXT NOT NULL,
          to_address TEXT NOT NULL,
          subject TEXT,
          body_text TEXT,
          body_html TEXT,
          headers JSONB,
          resend_message_id VARCHAR(255),
          created_at TIMESTAMP DEFAULT NOW() NOT NULL
        )
      `);
      console.log("[migration] inbound_emails table created");
    }

    const piExists = await client.query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'pending_invites') AS exists`
    );
    if (!piExists.rows[0]?.exists) {
      await client.query(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invite_status') THEN
            CREATE TYPE invite_status AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');
          END IF;
        END $$
      `);
      await client.query(`
        CREATE TABLE pending_invites (
          id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
          org_id VARCHAR(36) NOT NULL REFERENCES orgs(id),
          email VARCHAR(255) NOT NULL,
          first_name VARCHAR(255) NOT NULL,
          last_name VARCHAR(255),
          role user_role NOT NULL DEFAULT 'TEAM_MEMBER',
          invited_by_user_id VARCHAR(36) NOT NULL REFERENCES users(id),
          invite_token VARCHAR(128) NOT NULL UNIQUE,
          expires_at TIMESTAMP NOT NULL,
          status invite_status NOT NULL DEFAULT 'PENDING',
          last_resent_at TIMESTAMP,
          resend_count INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMP DEFAULT NOW() NOT NULL
        )
      `);
      await client.query(`CREATE INDEX pending_invites_org_idx ON pending_invites (org_id)`);
      await client.query(`CREATE INDEX pending_invites_token_idx ON pending_invites (invite_token)`);
      await client.query(`CREATE INDEX pending_invites_email_org_idx ON pending_invites (email, org_id)`);
      console.log("[migration] pending_invites table created");
    }

    // ─── ACCT-RECOVERY: Cherry Street Consulting org + admin user + junk org cleanup ───
    // Task #457: this block originally always created the
    // `cherry-street-consulting` org if missing, but `dean@cherrystconsulting.com`
    // already lives on the canonical `cherry-st` org seeded elsewhere. Re-running
    // the migration after `cherry-st` exists produced a *second* org with the same
    // admin user, which made `POST /api/auth/login` return `{needsOrgPick: true}`
    // for every test that did not pre-supply an `orgSlug`. Guard the entire
    // recovery block: if the admin already exists on any org, skip recreating it,
    // and drop the empty duplicate `cherry-street-consulting` row if one snuck in
    // before this guard landed.
    const cscSlug = 'cherry-street-consulting';
    const adminEmail = 'dean@cherrystconsulting.com';
    const existingAdmin = await client.query<{ org_id: string; slug: string }>(
      `SELECT u.org_id, o.slug
         FROM users u
         JOIN orgs o ON o.id = u.org_id
        WHERE u.email = $1`,
      [adminEmail],
    );

    if (existingAdmin.rows.length > 0) {
      const canonical = existingAdmin.rows.find((r) => r.slug !== cscSlug)
        ?? existingAdmin.rows[0];
      console.log(
        `[migration] Admin user ${adminEmail} already exists on org ` +
          `${canonical.slug} (${canonical.org_id}); skipping CSC recovery insert.`,
      );

      // If the duplicate `cherry-street-consulting` org is hanging around with
      // *only* the dean user (and no real consulting data), purge it so logins
      // stop offering an org-pick. Tables checked are the same heavy hitters
      // the migration cleans for the historical junk orgs below.
      const dupRow = existingAdmin.rows.find(
        (r) => r.slug === cscSlug && r.org_id !== canonical.org_id,
      );
      if (dupRow) {
        const dupId = dupRow.org_id;
        const heavyTables = [
          'invoices', 'estimates', 'projects', 'clients',
          'time_entries', 'expenses', 'payments',
        ];
        let hasRealData = false;
        for (const tbl of heavyTables) {
          try {
            const { rows } = await client.query<{ n: string }>(
              `SELECT COUNT(*)::text AS n FROM "${tbl}" WHERE org_id = $1`,
              [dupId],
            );
            if (Number(rows[0]?.n ?? 0) > 0) { hasRealData = true; break; }
          } catch {
            /* table missing on older schemas — ignore */
          }
        }
        if (hasRealData) {
          console.warn(
            `[migration] Duplicate ${cscSlug} org ${dupId} has real data; ` +
              `leaving it intact for manual review.`,
          );
        } else {
          // Best-effort cascade. The audit_logs table carries an immutable
          // trigger (`prevent_audit_log_modification`); we briefly disable it
          // so the org row's FK doesn't pin the duplicate in place forever.
          // All other tables are cleaned with try/catch so a missing-on-this-
          // schema table can't abort the whole sweep.
          const dupUserIds = await client.query<{ id: string }>(
            `SELECT id FROM users WHERE org_id = $1`,
            [dupId],
          );
          for (const { id: uid } of dupUserIds.rows) {
            await client.query(`DELETE FROM password_reset_tokens WHERE user_id = $1`, [uid]).catch(() => {});
            await client.query(`DELETE FROM active_sessions WHERE user_id = $1`, [uid]).catch(() => {});
            await client.query(`DELETE FROM notification_preferences WHERE user_id = $1`, [uid]).catch(() => {});
            await client.query(`DELETE FROM mfa_enrollments WHERE user_id = $1`, [uid]).catch(() => {});
          }
          for (const tbl of [
            'active_sessions', 'notification_preferences', 'mfa_enrollments',
            'pending_invites', 'support_requests', 'api_keys',
            'webhook_deliveries', 'webhook_endpoints',
            'expense_categories', 'gl_accounts', 'org_entitlements',
          ]) {
            await client
              .query(`DELETE FROM "${tbl}" WHERE org_id = $1`, [dupId])
              .catch(() => { /* table missing on older schemas */ });
          }
          await client.query(`DELETE FROM users WHERE org_id = $1`, [dupId]);
          // Wrap the trigger-disable + audit-log delete in try/finally so a
          // mid-cleanup failure (e.g. an unexpected FK) can never leave the
          // immutable-audit-log protection off after this block returns.
          let triggerDisabled = false;
          try {
            await client.query(
              `ALTER TABLE audit_logs DISABLE TRIGGER prevent_audit_log_modification`,
            );
            triggerDisabled = true;
            await client.query(`DELETE FROM audit_logs WHERE org_id = $1`, [dupId]);
          } catch (e: any) {
            console.warn(
              `[migration] Audit-log cleanup for duplicate ${cscSlug} ` +
                `failed (${e.message?.slice(0, 80)}); leaving org row in place.`,
            );
          } finally {
            if (triggerDisabled) {
              await client
                .query(`ALTER TABLE audit_logs ENABLE TRIGGER prevent_audit_log_modification`)
                .catch((reErr) => {
                  // This is the worst-case scenario — bubble it up so the
                  // outer migration handler logs loudly. Audit-log writes
                  // are still allowed; only DELETE/UPDATE were blocked.
                  console.error(
                    `[migration] CRITICAL: failed to re-enable ` +
                      `prevent_audit_log_modification trigger:`,
                    reErr,
                  );
                });
            }
          }
          await client.query(`DELETE FROM orgs WHERE id = $1`, [dupId]).catch((e) => {
            console.warn(
              `[migration] Could not delete duplicate ${cscSlug} org row ` +
                `${dupId}: ${e.message?.slice(0, 100)}`,
            );
          });
          console.log(
            `[migration] Removed empty duplicate ${cscSlug} org ${dupId} ` +
              `(task #457 — was forcing org-pick on every login).`,
          );
        }
      }
    } else {
      // No admin anywhere — bootstrap the recovery org + user as before.
      const cscCheck = await client.query(
        `SELECT id FROM orgs WHERE slug = $1`,
        [cscSlug],
      );
      let cscOrgId: string;
      if (cscCheck.rows.length === 0) {
        const cscResult = await client.query(`
          INSERT INTO orgs (
            id, name, slug, plan_tier, subscription_status, max_team_members,
            trial_ends_at, base_currency, auto_post_journal_entries,
            data_retention_days, rate_limit_rpm, default_bill_rate,
            invoice_prefix, estimate_prefix, default_payment_terms_days,
            onboarding_complete, created_at, updated_at
          ) VALUES (
            gen_random_uuid(),
            'Cherry Street Consulting', $1, 'ENTERPRISE', 'active', 999999,
            NULL, 'USD', true,
            0, 1000, 125,
            'CSC-INV-', 'CSC-EST-', 30,
            false, NOW(), NOW()
          ) RETURNING id
        `, [cscSlug]);
        cscOrgId = cscResult.rows[0].id;
        console.log(`[migration] Created Cherry Street Consulting org: ${cscOrgId}`);
      } else {
        cscOrgId = cscCheck.rows[0].id;
        console.log(`[migration] Cherry Street Consulting org already exists: ${cscOrgId}`);
      }

      const tempHash = '$2b$12$7knJb3wAmMkrbqgyGxHKxeufOXTGMfRYqNOiYjxbCXc/Rq.LIIwfe';
      await client.query(`
        INSERT INTO users (
          id, org_id, email, password, name, first_name, last_name,
          role, is_active, onboarding_complete, temp_password,
          created_at, updated_at
        ) VALUES (
          gen_random_uuid(), $1, $2, $3,
          'Dean Dunagan', 'Dean', 'Dunagan',
          'ADMIN', true, false, true,
          NOW(), NOW()
        )
      `, [cscOrgId, adminEmail, tempHash]);
      console.log(`[migration] Created admin user ${adminEmail} on org ${cscOrgId}`);
    }

    const junkOrgIds = [
      'e361d4ba-adec-41b2-beeb-ee7952217abe',
      '816fdb8d-e285-4400-8ab4-ad906b258623',
    ];
    const orgScopedTables = [
      'active_sessions', 'webhook_deliveries', 'webhook_endpoints', 'api_keys',
      'support_requests', 'close_periods', 'notification_preferences', 'pending_invites',
      'mfa_enrollments', 'bulk_ops',
      'bank_reconciliation_logs', 'bank_transaction_matches', 'bank_transactions', 'bank_connections',
      'gl_journal_lines', 'gl_journal_entries', 'gl_accounts',
      'payout_time_entries', 'team_member_payouts_v2', 'imported_payouts', 'imported_keys',
      'import_files', 'import_runs',
      'expense_reports', 'expenses', 'expense_categories',
      'estimate_lines', 'estimates',
      'recurring_invoice_templates',
      'timesheet_weeks', 'time_entries',
      'stripe_events', 'payments', 'outbox_emails',
      'invoice_revisions', 'invoice_lines', 'invoices',
      'project_service_members', 'project_services', 'project_members', 'projects',
      'audit_logs', 'services', 'client_contacts', 'clients',
      'exchange_rates', 'newsletter_subscribers',
      'users',
    ];
    for (const orgId of junkOrgIds) {
      const orgExists = await client.query(`SELECT name FROM orgs WHERE id = $1`, [orgId]);
      if (orgExists.rows.length === 0) {
        console.log(`[migration] Junk org ${orgId} already deleted, skipping`);
        continue;
      }
      const orgName = orgExists.rows[0].name;
      console.log(`[migration] Deleting junk org: ${orgName} (${orgId})`);
      let totalDeleted = 0;
      for (const tbl of orgScopedTables) {
        try {
          const del = await client.query(`DELETE FROM "${tbl}" WHERE org_id = $1`, [orgId]);
          if (del.rowCount && del.rowCount > 0) {
            totalDeleted += del.rowCount;
            console.log(`[migration]   ${tbl}: ${del.rowCount} rows deleted`);
          }
        } catch (e: any) {
          console.warn(`[migration]   ${tbl}: skip (${e.message?.slice(0, 80)})`);
        }
      }
      await client.query(`DELETE FROM orgs WHERE id = $1`, [orgId]);
      const verifyGone = await client.query(`SELECT id FROM orgs WHERE id = $1`, [orgId]);
      if (verifyGone.rows.length > 0) {
        console.error(`[migration] FAILED to delete org ${orgName} (${orgId}) — org row still exists!`);
      } else {
        console.log(`[migration] Verified: org ${orgName} (${orgId}) fully deleted — ${totalDeleted} related rows removed`);
      }
    }

  } catch (err: any) {
    console.error("[migration] Error during production migrations:", err.message);
  } finally {
    client.release();
  }
}
