import { db } from "./db";
import { orgs, users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "./auth";
import { storage } from "./storage";

const TIERS = ["STARTER", "PROFESSIONAL", "BUSINESS", "ENTERPRISE"] as const;
const PASSWORD = "E2ETest2026!";

// Sprint 2h.1 — gate this seeder so it cannot recreate the E2E pollution
// rows on a normal `npm run dev` boot or a casual `tsx server/seed-e2e-orgs.ts`
// invocation. It must only run when the test harness explicitly opts in.
async function seedE2EOrgs() {
  if (process.env.NODE_ENV !== "test" || process.env.E2E_SEED_ENABLED !== "true") {
    console.log(
      "[seed-e2e-orgs] Disabled. Refusing to run unless NODE_ENV=test AND E2E_SEED_ENABLED=true. Exiting cleanly.",
    );
    return;
  }
  const hashedPassword = await hashPassword(PASSWORD);
  const results: { tier: string; orgId: string; email: string }[] = [];

  for (const tier of TIERS) {
    const orgName = `E2E Test ${tier}`;
    const email = `e2e-${tier.toLowerCase()}@cherrytest.com`;
    const slug = `e2e-test-${tier.toLowerCase()}`;

    const existing = await db
      .select({ id: orgs.id })
      .from(orgs)
      .where(eq(orgs.name, orgName));

    for (const ex of existing) {
      await db.delete(users).where(eq(users.orgId, ex.id));
      await db.delete(orgs).where(eq(orgs.id, ex.id));
    }

    const slugConflict = await storage.getOrgBySlug(slug);
    if (slugConflict) {
      await db.delete(users).where(eq(users.orgId, slugConflict.id));
      await db.delete(orgs).where(eq(orgs.id, slugConflict.id));
    }

    const org = await storage.createOrg({
      name: orgName,
      slug,
      planTier: tier,
      maxTeamMembers: 999999,
      subscriptionStatus: "active",
    });

    await storage.createUser({
      orgId: org.id,
      email,
      password: hashedPassword,
      name: `E2E Admin (${tier})`,
      role: "ADMIN",
      isActive: true,
      onboardingComplete: true,
      tempPassword: false,
    });

    results.push({ tier, orgId: org.id, email });
  }

  console.log("\n╔══════════════════════════════════════════════════════════════════════════════════════╗");
  console.log("║  E2E Test Orgs Seeded Successfully                                                ║");
  console.log("╠══════════════╦══════════════════════════════════════════╦══════════════════════════════╣");
  console.log("║ Tier         ║ Org ID                                 ║ Email                        ║");
  console.log("╠══════════════╬══════════════════════════════════════════╬══════════════════════════════╣");
  for (const r of results) {
    console.log(`║ ${r.tier.padEnd(12)} ║ ${r.orgId.padEnd(38)} ║ ${r.email.padEnd(28)} ║`);
  }
  console.log("╠══════════════╩══════════════════════════════════════════╩══════════════════════════════╣");
  console.log(`║ Password: ${PASSWORD.padEnd(71)} ║`);
  console.log(`║ Login URL: /login                                                                    ║`);
  console.log("╚══════════════════════════════════════════════════════════════════════════════════════╝\n");
}

seedE2EOrgs()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
