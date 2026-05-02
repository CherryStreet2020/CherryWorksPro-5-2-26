import { storage } from "./storage";
import { hashPassword } from "./auth";
import { db } from "./db";
import { orgs, expenseCategories } from "@shared/schema";
import { sql, eq } from "drizzle-orm";
import { randomBytes } from "crypto";

export async function seedDatabase() {
  if (process.env.NODE_ENV === 'production') {
    console.log('[seed] skipped in production');
    return;
  }

  const [existing] = await db
    .select({ count: sql<number>`count(*)` })
    .from(orgs);

  if (Number(existing?.count) > 0) {
    return;
  }

  console.log("Seeding database with CherryWorks Pro (clean start)...");

  const org = await storage.createOrg({
    name: "CherryWorks Pro",
    slug: "cherryworks-pro",
    address: "222 Commerce Street, Suite 400, Dallas TX 75201",
    phone: "(214) 555-0142",
    email: "info@cherrystconsulting.com",
    website: "https://cherrystconsulting.com",
  });

  const generatedPassword = randomBytes(16).toString("base64url");
  const adminEmail = process.env.ADMIN_EMAIL || "admin@cherryworks.pro";
  const adminPass = await hashPassword(generatedPassword);

  await storage.createUser({
    orgId: org.id,
    email: adminEmail,
    password: adminPass,
    name: "Admin",
    role: "ADMIN",
    isActive: true,
    onboardingComplete: true,
    tempPassword: true,
  });

  console.log("========================================");
  console.log("  CLEAN DATABASE SEEDED");
  console.log("  Org: CherryWorks Pro");
  console.log(`  Admin: ${adminEmail}`);
  if (process.env.NODE_ENV !== 'production') { console.log("  Password:", generatedPassword); } else { console.log("  Password: [hidden in production - reset via email]"); }
  console.log("  ⚠ Change this password immediately!");
  console.log("  No services, clients, or team members.");
  console.log("  Add everything yourself from the app.");
  console.log("========================================");

  await seedExpenseCategories();
}

// Default expense categories with GL account codes.
// Operating expenses use the 6001–6009 block matching the chart of accounts
// seeded in storage.ts → seedDefaultGLAccounts(). Keep both in sync.
//   6001 Travel           6004 Meals & Entertainment   6007 Insurance
//   6002 Software & Subs  6005 Professional Dev        6008 Rent & Facilities
//   6003 Office Supplies  6006 Marketing & Advertising 6009 Miscellaneous Expense
const STANDARD_EXPENSE_CATEGORIES: { name: string; glCode: string }[] = [
  { name: "Travel",                  glCode: "6001" },
  { name: "Meals & Entertainment",   glCode: "6004" },
  { name: "Office Supplies",         glCode: "6003" },
  { name: "Software & Subscriptions",glCode: "6002" },
  { name: "Professional Services",   glCode: "6005" },
  { name: "Marketing & Advertising", glCode: "6006" },
  { name: "Equipment",               glCode: "6009" },
  { name: "Telecommunications",      glCode: "6009" },
  { name: "Training & Education",    glCode: "6005" },
  { name: "Insurance",               glCode: "6007" },
  { name: "Utilities",               glCode: "6008" },
  { name: "Vehicle & Mileage",       glCode: "6001" },
  { name: "Shipping & Postage",      glCode: "6009" },
  { name: "Bank Fees & Interest",    glCode: "6009" },
  { name: "Miscellaneous",           glCode: "6009" },
];

export async function seedExpenseCategories() {
  const allOrgs = await db.select({ id: orgs.id }).from(orgs);
  for (const org of allOrgs) {
    const [existing] = await db
      .select({ count: sql<number>`count(*)` })
      .from(expenseCategories)
      .where(eq(expenseCategories.orgId, org.id));
    if (Number(existing?.count) > 0) continue;
    console.log(`[seed] Seeding expense categories for org ${org.id}`);
    for (const cat of STANDARD_EXPENSE_CATEGORIES) {
      await db.insert(expenseCategories).values({
        orgId: org.id,
        name: cat.name,
        glCode: cat.glCode,
        isActive: true,
      });
    }
  }
}
