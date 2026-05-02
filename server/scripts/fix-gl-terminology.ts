import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
});

async function run() {
  const client = await pool.connect();
  try {
    console.log("[fix-gl-terminology] Starting one-time GL account + expense category terminology fix...\n");

    // ─── 1. GL Account 2100: "Accrued Consultant Payable" → "Accrued Team Member Payable" ───
    const before2100 = await client.query(
      `SELECT id, account_number, name, org_id FROM gl_accounts WHERE account_number = '2100'`
    );
    console.log(`[2100] BEFORE — ${before2100.rows.length} row(s):`);
    for (const r of before2100.rows) console.log(`  org=${r.org_id}  name="${r.name}"`);

    const update2100 = await client.query(
      `UPDATE gl_accounts SET name = 'Accrued Team Member Payable' WHERE account_number = '2100' AND name != 'Accrued Team Member Payable' RETURNING id, org_id, name`
    );
    console.log(`[2100] UPDATED ${update2100.rowCount} row(s)`);
    for (const r of update2100.rows) console.log(`  org=${r.org_id}  name="${r.name}"`);

    const after2100 = await client.query(
      `SELECT id, account_number, name, org_id FROM gl_accounts WHERE account_number = '2100'`
    );
    console.log(`[2100] AFTER — ${after2100.rows.length} row(s):`);
    for (const r of after2100.rows) console.log(`  org=${r.org_id}  name="${r.name}"`);
    console.log();

    // ─── 2. GL Account 5100: "Contractor Costs" / "Team Member Costs" → "Team Payout Costs" ───
    const before5100 = await client.query(
      `SELECT id, account_number, name, org_id FROM gl_accounts WHERE account_number = '5100'`
    );
    console.log(`[5100] BEFORE — ${before5100.rows.length} row(s):`);
    for (const r of before5100.rows) console.log(`  org=${r.org_id}  name="${r.name}"`);

    const update5100 = await client.query(
      `UPDATE gl_accounts SET name = 'Team Payout Costs' WHERE account_number = '5100' AND name != 'Team Payout Costs' RETURNING id, org_id, name`
    );
    console.log(`[5100] UPDATED ${update5100.rowCount} row(s)`);
    for (const r of update5100.rows) console.log(`  org=${r.org_id}  name="${r.name}"`);

    const after5100 = await client.query(
      `SELECT id, account_number, name, org_id FROM gl_accounts WHERE account_number = '5100'`
    );
    console.log(`[5100] AFTER — ${after5100.rows.length} row(s):`);
    for (const r of after5100.rows) console.log(`  org=${r.org_id}  name="${r.name}"`);
    console.log();

    // ─── 3. Expense categories: description containing "contractors" → "professionals" ───
    const beforeExp = await client.query(
      `SELECT id, name, description, org_id FROM expense_categories WHERE description ILIKE '%contractors%'`
    );
    console.log(`[expense_categories] BEFORE — ${beforeExp.rows.length} row(s) with "contractors" in description:`);
    for (const r of beforeExp.rows) console.log(`  org=${r.org_id}  name="${r.name}"  description="${r.description}"`);

    const updateExp = await client.query(
      `UPDATE expense_categories SET description = REPLACE(description, 'contractors', 'professionals') WHERE description ILIKE '%contractors%' RETURNING id, org_id, name, description`
    );
    console.log(`[expense_categories] UPDATED ${updateExp.rowCount} row(s)`);
    for (const r of updateExp.rows) console.log(`  org=${r.org_id}  name="${r.name}"  description="${r.description}"`);

    const afterExp = await client.query(
      `SELECT id, name, description, org_id FROM expense_categories WHERE description ILIKE '%professional%'`
    );
    console.log(`[expense_categories] AFTER — ${afterExp.rows.length} row(s) with "professional" in description:`);
    for (const r of afterExp.rows) console.log(`  org=${r.org_id}  name="${r.name}"  description="${r.description}"`);

    console.log("\n[fix-gl-terminology] Done.");
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error("[fix-gl-terminology] FATAL:", err);
  process.exit(1);
});
