import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { hashPassword } from "../server/auth";

const ORG_ID = "perf-test-org-001";
const ORG_NAME = "Perf Test Corp";
const ADMIN_EMAIL = "perfadmin@perftest.com";
const PASSWORD = "Password123!";

const NUM_CLIENTS = 1000;
const NUM_INVOICES = 5000;
const NUM_TIME_ENTRIES = 25000;
const NUM_PAYMENTS = 10000;

function randomDate(startDays: number, endDays: number): string {
  const now = Date.now();
  const start = now - startDays * 86400000;
  const end = now - endDays * 86400000;
  return new Date(start + Math.random() * (end - start)).toISOString().split("T")[0];
}

function randomAmount(min: number, max: number): string {
  return (min + Math.random() * (max - min)).toFixed(2);
}

async function seedPerf() {
  console.log("=== Performance Seed Script ===");
  const startTime = Date.now();

  const existingOrg = await db.execute(sql`SELECT id FROM orgs WHERE id = ${ORG_ID}`);
  const rows = (existingOrg as any).rows || existingOrg;
  if (rows && rows.length > 0) {
    console.log("Perf org already exists, skipping seed");
    process.exit(0);
  }

  console.log("Creating org...");
  await db.execute(sql`INSERT INTO orgs (id, name, slug, base_currency, plan_tier, auto_post_journal_entries)
    VALUES (${ORG_ID}, ${ORG_NAME}, 'perf-test', 'USD', 'BUSINESS', true)`);

  console.log("Creating admin user...");
  const hashed = await hashPassword(PASSWORD);
  await db.execute(sql`INSERT INTO users (id, org_id, email, password, name, role, is_active, onboarding_complete)
    VALUES (${"perf-admin-001"}, ${ORG_ID}, ${ADMIN_EMAIL}, ${hashed}, 'Perf Admin', 'ADMIN', true, true)`);

  console.log(`Seeding ${NUM_CLIENTS} clients...`);
  const clientIds: string[] = [];
  const BATCH = 200;
  for (let b = 0; b < NUM_CLIENTS; b += BATCH) {
    const values: string[] = [];
    for (let i = b; i < Math.min(b + BATCH, NUM_CLIENTS); i++) {
      const cid = `perf-client-${String(i).padStart(5, "0")}`;
      clientIds.push(cid);
      values.push(`('${cid}', '${ORG_ID}', 'Client ${i}', 'client${i}@perftest.com', 'USD')`);
    }
    await db.execute(sql.raw(`INSERT INTO clients (id, org_id, name, email, currency) VALUES ${values.join(",")}`));
  }
  console.log(`  ${clientIds.length} clients created`);

  console.log("Seeding services...");
  await db.execute(sql.raw(`INSERT INTO services (id, org_id, name, default_rate) VALUES
    ('perf-svc-consult', '${ORG_ID}', 'Strategy', '150.00'),
    ('perf-svc-dev', '${ORG_ID}', 'Development', '200.00'),
    ('perf-svc-design', '${ORG_ID}', 'Design', '175.00')
  `));

  console.log("Seeding projects...");
  const projectIds: string[] = [];
  for (let b = 0; b < 500; b += BATCH) {
    const values: string[] = [];
    for (let i = b; i < Math.min(b + BATCH, 500); i++) {
      const pid = `perf-proj-${String(i).padStart(4, "0")}`;
      projectIds.push(pid);
      const clientId = clientIds[i % clientIds.length];
      values.push(`('${pid}', '${ORG_ID}', 'Project ${i}', '${clientId}', 'ACTIVE')`);
    }
    await db.execute(sql.raw(`INSERT INTO projects (id, org_id, name, client_id, status) VALUES ${values.join(",")}`));
  }
  console.log(`  ${projectIds.length} projects created`);

  console.log(`Seeding ${NUM_INVOICES} invoices...`);
  const invoiceIds: string[] = [];
  for (let b = 0; b < NUM_INVOICES; b += BATCH) {
    const values: string[] = [];
    for (let i = b; i < Math.min(b + BATCH, NUM_INVOICES); i++) {
      const iid = `perf-inv-${String(i).padStart(6, "0")}`;
      invoiceIds.push(iid);
      const clientId = clientIds[i % clientIds.length];
      const dt = randomDate(365, 0);
      const total = randomAmount(100, 10000);
      const status = i < 3000 ? "PAID" : i < 4000 ? "SENT" : "DRAFT";
      const paidAmount = status === "PAID" ? total : "0.00";
      values.push(`('${iid}', '${ORG_ID}', 'INV-${String(i).padStart(6, "0")}', '${clientId}', '${dt}', '${dt}', '${total}', '${paidAmount}', '${status}', 'USD')`);
    }
    await db.execute(sql.raw(`INSERT INTO invoices (id, org_id, number, client_id, issued_date, due_date, total, paid_amount, status, currency) VALUES ${values.join(",")}`));
  }
  console.log(`  ${invoiceIds.length} invoices created`);

  console.log("Seeding invoice lines...");
  for (let b = 0; b < NUM_INVOICES; b += BATCH) {
    const values: string[] = [];
    for (let i = b; i < Math.min(b + BATCH, NUM_INVOICES); i++) {
      const invId = invoiceIds[i];
      const qty = (1 + Math.floor(Math.random() * 20)).toString();
      const rate = ["150.00", "200.00", "175.00"][i % 3];
      const amount = (Number(qty) * Number(rate)).toFixed(2);
      values.push(`(gen_random_uuid(), '${ORG_ID}', '${invId}', 'Service line ${i}', ${qty}, '${rate}', '${amount}')`);
    }
    await db.execute(sql.raw(`INSERT INTO invoice_lines (id, org_id, invoice_id, description, quantity, unit_rate, amount) VALUES ${values.join(",")}`));
  }
  console.log(`  ${NUM_INVOICES} invoice lines created`);

  console.log(`Seeding ${NUM_TIME_ENTRIES} time entries...`);
  for (let b = 0; b < NUM_TIME_ENTRIES; b += BATCH) {
    const values: string[] = [];
    for (let i = b; i < Math.min(b + BATCH, NUM_TIME_ENTRIES); i++) {
      const tid = `perf-te-${String(i).padStart(6, "0")}`;
      const projId = projectIds[i % projectIds.length];
      const dt = randomDate(365, 0);
      const minutes = 30 + Math.floor(Math.random() * 450);
      const rate = ["150.00", "200.00", "175.00"][i % 3];
      values.push(`('${tid}', '${ORG_ID}', 'perf-admin-001', '${projId}', '${dt}', ${minutes}, '${rate}', 'Task ${i}')`);
    }
    await db.execute(sql.raw(`INSERT INTO time_entries (id, org_id, user_id, project_id, date, minutes, rate, notes) VALUES ${values.join(",")}`));
  }
  console.log(`  ${NUM_TIME_ENTRIES} time entries created`);

  console.log(`Seeding ${NUM_PAYMENTS} payments...`);
  for (let b = 0; b < NUM_PAYMENTS; b += BATCH) {
    const values: string[] = [];
    for (let i = b; i < Math.min(b + BATCH, NUM_PAYMENTS); i++) {
      const pid = `perf-pmt-${String(i).padStart(6, "0")}`;
      const invId = invoiceIds[i % invoiceIds.length];
      const dt = randomDate(365, 0);
      const amt = randomAmount(50, 5000);
      const method = ["CHECK", "ACH", "WIRE", "STRIPE"][i % 4];
      values.push(`('${pid}', '${ORG_ID}', '${invId}', '${amt}', '${dt}', '${method}', 'USD')`);
    }
    await db.execute(sql.raw(`INSERT INTO payments (id, org_id, invoice_id, amount, date, method, currency) VALUES ${values.join(",")}`));
  }
  console.log(`  ${NUM_PAYMENTS} payments created`);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n=== Seed complete in ${elapsed}s ===`);
  console.log(`  Clients: ${NUM_CLIENTS}`);
  console.log(`  Projects: ${projectIds.length}`);
  console.log(`  Invoices: ${NUM_INVOICES}`);
  console.log(`  Time entries: ${NUM_TIME_ENTRIES}`);
  console.log(`  Payments: ${NUM_PAYMENTS}`);
}

seedPerf().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
