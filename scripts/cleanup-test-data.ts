import { Pool } from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const TEST_CLIENT_PATTERNS = [
  "%E2E Test%",
  "%AUDIT-Test%",
  "%Test-Client%",
  "Token Test",
  "Test Corp",
];

const TEST_PROJECT_PATTERNS = [
  "%E2E Test%",
  "%AUDIT-Test%",
  "%Test-Project%",
];

async function cleanup() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const clientWhere = TEST_CLIENT_PATTERNS
      .map((_, i) => `name LIKE $${i + 1} OR name = $${i + 1}`)
      .join(" OR ");
    const clientPatternParams = TEST_CLIENT_PATTERNS;

    const { rows: testClients } = await client.query(
      `SELECT id, name FROM clients WHERE ${TEST_CLIENT_PATTERNS.map((p, i) =>
        p.includes("%") ? `name LIKE $${i + 1}` : `name = $${i + 1}`
      ).join(" OR ")}`,
      clientPatternParams
    );

    if (testClients.length === 0) {
      console.log("No test clients found. Database is already clean.");
      await client.query("ROLLBACK");
      return;
    }

    console.log(`Found ${testClients.length} test clients to remove:`);
    testClients.forEach((c) => console.log(`  - ${c.name} (${c.id})`));

    const clientIds = testClients.map((c) => c.id);

    const { rows: testProjects } = await client.query(
      `SELECT id, name FROM projects WHERE client_id = ANY($1)`,
      [clientIds]
    );
    const projectIds = testProjects.map((p) => p.id);
    console.log(`Found ${testProjects.length} linked projects`);

    const { rows: extraProjects } = await client.query(
      `SELECT id, name FROM projects WHERE ${TEST_PROJECT_PATTERNS.map((p, i) =>
        p.includes("%") ? `name LIKE $${i + 1}` : `name = $${i + 1}`
      ).join(" OR ")} AND id != ALL($${TEST_PROJECT_PATTERNS.length + 1})`,
      [...TEST_PROJECT_PATTERNS, projectIds]
    );
    const allProjectIds = [...projectIds, ...extraProjects.map((p) => p.id)];
    if (extraProjects.length > 0) {
      console.log(`Found ${extraProjects.length} additional test projects by name`);
    }

    const { rows: testInvoices } = await client.query(
      `SELECT id, number FROM invoices WHERE client_id = ANY($1)`,
      [clientIds]
    );
    const invoiceIds = testInvoices.map((i) => i.id);
    console.log(`Found ${testInvoices.length} linked invoices`);

    if (invoiceIds.length > 0) {
      const r1 = await client.query(`DELETE FROM payments WHERE invoice_id = ANY($1)`, [invoiceIds]);
      console.log(`Deleted ${r1.rowCount} payments`);

      const r2 = await client.query(`DELETE FROM invoice_lines WHERE invoice_id = ANY($1)`, [invoiceIds]);
      console.log(`Deleted ${r2.rowCount} invoice lines`);

      const r3 = await client.query(`DELETE FROM invoice_revisions WHERE invoice_id = ANY($1)`, [invoiceIds]);
      console.log(`Deleted ${r3.rowCount} invoice revisions`);
    }

    if (allProjectIds.length > 0) {
      const { rows: testTimeEntries } = await client.query(
        `SELECT id FROM time_entries WHERE project_id = ANY($1)`, [allProjectIds]
      );
      const timeEntryIds = testTimeEntries.map(t => t.id);

      if (timeEntryIds.length > 0) {
        const { rows: affectedPayoutIds } = await client.query(
          `SELECT DISTINCT payout_id FROM payout_time_entries WHERE time_entry_id = ANY($1)`, [timeEntryIds]
        );
        const payoutIds = affectedPayoutIds.map(r => r.payout_id);

        const rPTE = await client.query(`DELETE FROM payout_time_entries WHERE time_entry_id = ANY($1)`, [timeEntryIds]);
        console.log(`Deleted ${rPTE.rowCount} payout time entries`);

        if (payoutIds.length > 0) {
          const rCP = await client.query(
            `DELETE FROM imported_payouts WHERE id = ANY($1)
             AND NOT EXISTS (SELECT 1 FROM payout_time_entries WHERE payout_time_entries.payout_id = imported_payouts.id)`,
            [payoutIds]
          );
          console.log(`Deleted ${rCP.rowCount} orphaned independent payouts`);

          const rCPV2 = await client.query(
            `DELETE FROM team_member_payouts_v2 WHERE id = ANY($1)
             AND NOT EXISTS (SELECT 1 FROM payout_time_entries WHERE payout_time_entries.payout_id = team_member_payouts_v2.id)`,
            [payoutIds]
          );
          console.log(`Deleted ${rCPV2.rowCount} orphaned team member payouts v2`);
        }
      }

      const r4 = await client.query(`DELETE FROM time_entries WHERE project_id = ANY($1)`, [allProjectIds]);
      console.log(`Deleted ${r4.rowCount} time entries`);

      const r5 = await client.query(`DELETE FROM project_members WHERE project_id = ANY($1)`, [allProjectIds]);
      console.log(`Deleted ${r5.rowCount} project members`);

      const r6 = await client.query(`DELETE FROM project_services WHERE project_id = ANY($1)`, [allProjectIds]);
      console.log(`Deleted ${r6.rowCount} project services`);
    }

    const r7 = await client.query(`DELETE FROM expenses WHERE client_id = ANY($1)${allProjectIds.length > 0 ? ` OR project_id = ANY($2)` : ""}`,
      allProjectIds.length > 0 ? [clientIds, allProjectIds] : [clientIds]);
    console.log(`Deleted ${r7.rowCount} expenses`);

    const { rows: testEstimates } = await client.query(
      `SELECT id FROM estimates WHERE client_id = ANY($1)`,
      [clientIds]
    );
    if (testEstimates.length > 0) {
      const estimateIds = testEstimates.map(e => e.id);
      const r8a = await client.query(`DELETE FROM estimate_lines WHERE estimate_id = ANY($1)`, [estimateIds]);
      console.log(`Deleted ${r8a.rowCount} estimate lines`);
    }
    const r8 = await client.query(`DELETE FROM estimates WHERE client_id = ANY($1)`, [clientIds]);
    console.log(`Deleted ${r8.rowCount} estimates`);

    const r9 = await client.query(`DELETE FROM recurring_invoice_templates WHERE client_id = ANY($1)`, [clientIds]);
    console.log(`Deleted ${r9.rowCount} recurring templates`);

    if (invoiceIds.length > 0) {
      const rOE = await client.query(`DELETE FROM outbox_emails WHERE invoice_id = ANY($1)`, [invoiceIds]);
      console.log(`Deleted ${rOE.rowCount} outbox emails`);

      const r10 = await client.query(`DELETE FROM invoices WHERE id = ANY($1)`, [invoiceIds]);
      console.log(`Deleted ${r10.rowCount} invoices`);
    }

    if (allProjectIds.length > 0) {
      const r11 = await client.query(`DELETE FROM projects WHERE id = ANY($1)`, [allProjectIds]);
      console.log(`Deleted ${r11.rowCount} projects`);
    }

    const r12 = await client.query(`DELETE FROM clients WHERE id = ANY($1)`, [clientIds]);
    console.log(`Deleted ${r12.rowCount} clients`);

    const r13 = await client.query(
      `DELETE FROM audit_logs WHERE details::text LIKE '%E2E Test%' OR details::text LIKE '%AUDIT-Test%' OR details::text LIKE '%Test-Client%'`
    );
    console.log(`Deleted ${r13.rowCount} audit log entries`);

    await client.query("COMMIT");
    console.log("\nCleanup complete! Transaction committed.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error during cleanup, transaction rolled back:", err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

cleanup().catch((err) => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
