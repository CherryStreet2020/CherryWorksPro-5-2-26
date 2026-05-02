import { db } from "./db";
import { orgs, users, clients, projects, invoices, invoiceLines, timeEntries } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { hashPassword } from "./auth";

const DEV_ORG_SLUG = "cwpro-dev-qa";
const DEV_ORG_NAME = "CherryWorks QA Dev Org";

// Sprint 2i.5 — second dev org used by entitlement-off e2e specs. Receives
// only the default `pso_core` row from `seedOrgEntitlements` (no
// `marketing_os`), so logging in as this admin proves the stealth-404
// behavior end-to-end.
const PSO_ORG_SLUG = "cwpro-dev-pso";
const PSO_ORG_NAME = "CherryWorks PSO-Only Dev Org";
const PSO_ADMIN = {
  email: "admin.pso.test@cwpro.dev",
  password: "psoAdmin123",
  firstName: "Pat",
  lastName: "Psoadmin",
  role: "ADMIN" as const,
};

const SEED_USERS = [
  {
    email: "admin.test@cwpro.dev",
    password: "admin123",
    firstName: "Ada",
    lastName: "Adminson",
    role: "ADMIN" as const,
  },
  {
    email: "manager.test@cwpro.dev",
    password: "manager123",
    firstName: "Mara",
    lastName: "Managerton",
    role: "MANAGER" as const,
  },
  {
    email: "team.test@cwpro.dev",
    password: "team123",
    firstName: "Tina",
    lastName: "Teamworth",
    role: "TEAM_MEMBER" as const,
  },
];

export async function seedDevQaUsers() {
  if (process.env.NODE_ENV === "production") {
    console.log("[seed] Skipping dev QA seed — NODE_ENV is production");
    return;
  }

  console.log("[seed] Seeding dev QA role-test users (NODE_ENV !== production)...");

  let orgRow = await db
    .select({ id: orgs.id })
    .from(orgs)
    .where(eq(orgs.slug, DEV_ORG_SLUG))
    .then((r) => r[0]);

  if (!orgRow) {
    const inserted = await db
      .insert(orgs)
      .values({
        name: DEV_ORG_NAME,
        slug: DEV_ORG_SLUG,
        planTier: "ENTERPRISE",
        onboardingComplete: true,
        baseCurrency: "USD",
        // Seed contact fields so the AdminSetupGate firm-profile step
        // is complete (server/routes/settings-routes.ts line ~163) and
        // route navigation isn't hijacked into Mission Control during
        // e2e tests. Sprint 2i.5.
        email: "qa-firm@cwpro.dev",
        phone: "+1-555-0100",
      })
      .returning({ id: orgs.id });
    orgRow = inserted[0];
    console.log(`[seed] Created dev org: ${DEV_ORG_NAME} (${orgRow.id})`);
  } else {
    await db
      .update(orgs)
      .set({
        onboardingComplete: true,
        email: "qa-firm@cwpro.dev",
        phone: "+1-555-0100",
      })
      .where(eq(orgs.id, orgRow.id));
    console.log(`[seed] Dev org already exists: ${orgRow.id}`);
  }

  const orgId = orgRow.id;
  const userIds: Record<string, string> = {};

  for (const u of SEED_USERS) {
    const hashed = await hashPassword(u.password);
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, u.email), eq(users.orgId, orgId)));

    if (existing.length > 0) {
      await db
        .update(users)
        .set({
          password: hashed,
          firstName: u.firstName,
          lastName: u.lastName,
          name: `${u.firstName} ${u.lastName}`,
          role: u.role,
          isActive: true,
          onboardingComplete: true,
          tempPassword: false,
        })
        .where(eq(users.id, existing[0].id));
      userIds[u.role] = existing[0].id;
      console.log(`[seed] Updated: ${u.email} (${u.role})`);
    } else {
      const inserted = await db
        .insert(users)
        .values({
          orgId,
          email: u.email,
          password: hashed,
          firstName: u.firstName,
          lastName: u.lastName,
          name: `${u.firstName} ${u.lastName}`,
          role: u.role,
          isActive: true,
          onboardingComplete: true,
          tempPassword: false,
        })
        .returning({ id: users.id });
      userIds[u.role] = inserted[0].id;
      console.log(`[seed] Created: ${u.email} (${u.role})`);
    }
  }

  let clientRow = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.orgId, orgId), eq(clients.name, "QA Test Client")))
    .then((r) => r[0]);

  if (!clientRow) {
    const inserted = await db
      .insert(clients)
      .values({
        orgId,
        name: "QA Test Client",
        email: "qa-client@example.com",
      })
      .returning({ id: clients.id });
    clientRow = inserted[0];
    console.log(`[seed] Created client: QA Test Client`);
  }

  let projectRow = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.orgId, orgId), eq(projects.name, "QA Test Project")))
    .then((r) => r[0]);

  if (!projectRow) {
    const inserted = await db
      .insert(projects)
      .values({
        orgId,
        clientId: clientRow.id,
        name: "QA Test Project",
        description: "Dev QA seed project",
        status: "ACTIVE",
      })
      .returning({ id: projects.id });
    projectRow = inserted[0];
    console.log(`[seed] Created project: QA Test Project`);
  }

  let invoiceRow = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(eq(invoices.orgId, orgId), eq(invoices.number, "QA-0001")))
    .then((r) => r[0]);

  if (!invoiceRow) {
    const today = new Date().toISOString().split("T")[0];
    const due = new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];
    const insertedInv = await db.insert(invoices).values({
      orgId,
      clientId: clientRow.id,
      number: "QA-0001",
      status: "DRAFT",
      issuedDate: today,
      dueDate: due,
      subtotal: "1000.00",
      total: "1000.00",
    }).returning({ id: invoices.id });
    invoiceRow = insertedInv[0];
    console.log(`[seed] Created invoice: QA-0001 (DRAFT)`);
  }

  const existingLines = await db
    .select({ id: invoiceLines.id })
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, invoiceRow.id));

  if (existingLines.length === 0) {
    await db.insert(invoiceLines).values({
      orgId,
      invoiceId: invoiceRow.id,
      description: "QA Test Service",
      quantity: "1",
      unitRate: "1000.00",
      amount: "1000.00",
      sortOrder: 0,
    });
    console.log(`[seed] Backfilled invoice line for QA-0001`);
  }

  const adminId = userIds["ADMIN"];
  if (adminId) {
    const existingTE = await db
      .select({ id: timeEntries.id })
      .from(timeEntries)
      .where(and(eq(timeEntries.orgId, orgId), eq(timeEntries.userId, adminId), eq(timeEntries.notes, "QA seed time entry")))
      .then((r) => r[0]);

    if (!existingTE) {
      const today = new Date().toISOString().split("T")[0];
      await db.insert(timeEntries).values({
        orgId,
        projectId: projectRow.id,
        userId: adminId,
        date: today,
        minutes: 120,
        billable: true,
        rate: "150.00",
        notes: "QA seed time entry",
      });
      console.log(`[seed] Created time entry: 2h on QA Test Project`);
    }
  }

  const allOrgInvoices = await db
    .select({ id: invoices.id, number: invoices.number, total: invoices.total })
    .from(invoices)
    .where(eq(invoices.orgId, orgId));
  for (const inv of allOrgInvoices) {
    if (Number(inv.total) > 0) {
      const lines = await db
        .select({ id: invoiceLines.id })
        .from(invoiceLines)
        .where(eq(invoiceLines.invoiceId, inv.id));
      if (lines.length === 0) {
        console.warn(`[seed] WARNING: Invoice ${inv.number} has total=${inv.total} but zero line items`);
      }
    }
  }

  // Sprint 2i.5 — also seed a PSO-only dev org (no marketing_os entitlement)
  // so the entitlement-off e2e spec has a real admin to log in as. The
  // entitlement rows themselves are owned by `seedOrgEntitlements`, which
  // runs immediately after this function at startup and grants only
  // `pso_core` to every org by default.
  let psoOrgRow = await db
    .select({ id: orgs.id })
    .from(orgs)
    .where(eq(orgs.slug, PSO_ORG_SLUG))
    .then((r) => r[0]);

  if (!psoOrgRow) {
    const inserted = await db
      .insert(orgs)
      .values({
        name: PSO_ORG_NAME,
        slug: PSO_ORG_SLUG,
        planTier: "PROFESSIONAL",
        onboardingComplete: true,
        baseCurrency: "USD",
        // See firm-profile note on the QA org above. Sprint 2i.5.
        email: "pso-firm@cwpro.dev",
        phone: "+1-555-0200",
      })
      .returning({ id: orgs.id });
    psoOrgRow = inserted[0];
    console.log(`[seed] Created PSO-only dev org: ${PSO_ORG_NAME} (${psoOrgRow.id})`);
  } else {
    await db
      .update(orgs)
      .set({
        onboardingComplete: true,
        email: "pso-firm@cwpro.dev",
        phone: "+1-555-0200",
      })
      .where(eq(orgs.id, psoOrgRow.id));
  }

  const psoHashed = await hashPassword(PSO_ADMIN.password);
  const existingPsoAdmin = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, PSO_ADMIN.email), eq(users.orgId, psoOrgRow.id)));

  if (existingPsoAdmin.length > 0) {
    await db
      .update(users)
      .set({
        password: psoHashed,
        firstName: PSO_ADMIN.firstName,
        lastName: PSO_ADMIN.lastName,
        name: `${PSO_ADMIN.firstName} ${PSO_ADMIN.lastName}`,
        role: PSO_ADMIN.role,
        isActive: true,
        onboardingComplete: true,
        tempPassword: false,
      })
      .where(eq(users.id, existingPsoAdmin[0].id));
    console.log(`[seed] Updated PSO admin: ${PSO_ADMIN.email}`);
  } else {
    await db.insert(users).values({
      orgId: psoOrgRow.id,
      email: PSO_ADMIN.email,
      password: psoHashed,
      firstName: PSO_ADMIN.firstName,
      lastName: PSO_ADMIN.lastName,
      name: `${PSO_ADMIN.firstName} ${PSO_ADMIN.lastName}`,
      role: PSO_ADMIN.role,
      isActive: true,
      onboardingComplete: true,
      tempPassword: false,
    });
    console.log(`[seed] Created PSO admin: ${PSO_ADMIN.email}`);
  }

  console.log("[seed] Dev QA seed complete");
  console.log(`[seed] Org slug: ${DEV_ORG_SLUG}`);
  for (const u of SEED_USERS) {
    console.log(`[seed]   ${u.role.padEnd(12)} ${u.email}`);
  }
  console.log(`[seed] Org slug: ${PSO_ORG_SLUG}`);
  console.log(`[seed]   ${PSO_ADMIN.role.padEnd(12)} ${PSO_ADMIN.email}`);
}

const isDirectRun = process.argv[1]?.includes("seed-role-test-users");
if (isDirectRun) {
  seedDevQaUsers()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Seed failed:", err);
      process.exit(1);
    });
}
