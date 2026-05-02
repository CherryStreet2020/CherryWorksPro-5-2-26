import { db } from "../server/db";
import { sql } from "drizzle-orm";

const INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_clients_org_id ON clients(org_id)",
  "CREATE INDEX IF NOT EXISTS idx_invoices_org_id ON invoices(org_id)",
  "CREATE INDEX IF NOT EXISTS idx_invoices_client_id ON invoices(client_id)",
  "CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(org_id, status)",
  "CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(org_id, due_date)",
  "CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice_id ON invoice_lines(invoice_id)",
  "CREATE INDEX IF NOT EXISTS idx_invoice_lines_org_id ON invoice_lines(org_id)",
  "CREATE INDEX IF NOT EXISTS idx_payments_org_id ON payments(org_id)",
  "CREATE INDEX IF NOT EXISTS idx_payments_invoice_id ON payments(invoice_id)",
  "CREATE INDEX IF NOT EXISTS idx_time_entries_org_id ON time_entries(org_id)",
  "CREATE INDEX IF NOT EXISTS idx_time_entries_project_id ON time_entries(project_id)",
  "CREATE INDEX IF NOT EXISTS idx_time_entries_user_id ON time_entries(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_time_entries_date ON time_entries(org_id, date)",
  "CREATE INDEX IF NOT EXISTS idx_projects_org_id ON projects(org_id)",
  "CREATE INDEX IF NOT EXISTS idx_projects_client_id ON projects(client_id)",
  "CREATE INDEX IF NOT EXISTS idx_expenses_org_id ON expenses(org_id)",
  "CREATE INDEX IF NOT EXISTS idx_gl_journal_entries_org_id ON gl_journal_entries(org_id)",
  "CREATE INDEX IF NOT EXISTS idx_gl_journal_lines_entry_id ON gl_journal_lines(journal_entry_id)",
  "CREATE INDEX IF NOT EXISTS idx_audit_logs_org_id ON audit_logs(org_id)",
  "CREATE INDEX IF NOT EXISTS idx_team_member_payouts_v2_org_id ON team_member_payouts_v2(org_id)",
  "CREATE INDEX IF NOT EXISTS idx_services_org_id ON services(org_id)",
  "CREATE INDEX IF NOT EXISTS idx_project_members_project_id ON project_members(project_id)",
];

async function createIndexes() {
  console.log("Creating performance indexes...");
  let created = 0;
  for (const idx of INDEXES) {
    try {
      await db.execute(sql.raw(idx));
      created++;
      console.log(`  OK: ${idx.split(" ON ")[0].replace("CREATE INDEX IF NOT EXISTS ", "")}`);
    } catch (err: any) {
      console.warn(`  SKIP: ${err.message}`);
    }
  }
  console.log(`Done: ${created}/${INDEXES.length} indexes`);
}

createIndexes().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
