import { db } from "./db";
import { orgs, orgEntitlements } from "@shared/schema";
import { eq, and } from "drizzle-orm";

const DEV_QA_SLUG = "cwpro-dev-qa";

export type SeedOrgEntitlementsResult = {
  totalOrgs: number;
  psoCoreInserted: number;
  marketingOsInserted: number;
  perOrg: { slug: string; orgId: string; psoCore: boolean; marketingOs: boolean }[];
};

export async function seedOrgEntitlements(): Promise<SeedOrgEntitlementsResult> {
  // Task #171 — the previous soft-fail for `42P01` (undefined_table) was
  // dropped now that boot-time migrations fail loudly and the startup
  // orchestrator skips seeding when any migration failed. If we ever see
  // a missing-table error here again it's a real bug, so let it propagate
  // instead of silently returning empty stats that mask the problem.
  return await seedOrgEntitlementsInner();
}

async function seedOrgEntitlementsInner(): Promise<SeedOrgEntitlementsResult> {
  const allOrgs = await db.select({ id: orgs.id, slug: orgs.slug }).from(orgs);

  let psoCoreInserted = 0;
  let marketingOsInserted = 0;

  for (const o of allOrgs) {
    const existingPso = await db
      .select({ id: orgEntitlements.id })
      .from(orgEntitlements)
      .where(and(eq(orgEntitlements.orgId, o.id), eq(orgEntitlements.feature, "pso_core")));

    if (existingPso.length === 0) {
      await db.insert(orgEntitlements).values({
        orgId: o.id,
        feature: "pso_core",
        active: true,
        activatedAt: new Date(),
      });
      psoCoreInserted += 1;
    } else {
      await db
        .update(orgEntitlements)
        .set({ active: true, updatedAt: new Date() })
        .where(eq(orgEntitlements.id, existingPso[0].id));
    }

    if (o.slug === DEV_QA_SLUG) {
      const existingMkt = await db
        .select({ id: orgEntitlements.id })
        .from(orgEntitlements)
        .where(and(eq(orgEntitlements.orgId, o.id), eq(orgEntitlements.feature, "marketing_os")));

      if (existingMkt.length === 0) {
        await db.insert(orgEntitlements).values({
          orgId: o.id,
          feature: "marketing_os",
          active: true,
          activatedAt: new Date(),
        });
        marketingOsInserted += 1;
      } else {
        await db
          .update(orgEntitlements)
          .set({ active: true, updatedAt: new Date() })
          .where(eq(orgEntitlements.id, existingMkt[0].id));
      }
    }
  }

  const perOrgRows = await db
    .select({
      slug: orgs.slug,
      orgId: orgs.id,
      feature: orgEntitlements.feature,
      active: orgEntitlements.active,
    })
    .from(orgs)
    .leftJoin(orgEntitlements, eq(orgEntitlements.orgId, orgs.id));

  const grouped = new Map<string, { slug: string; orgId: string; psoCore: boolean; marketingOs: boolean }>();
  for (const r of perOrgRows) {
    const key = r.orgId;
    const existing = grouped.get(key) ?? { slug: r.slug, orgId: r.orgId, psoCore: false, marketingOs: false };
    if (r.feature === "pso_core" && r.active) existing.psoCore = true;
    if (r.feature === "marketing_os" && r.active) existing.marketingOs = true;
    grouped.set(key, existing);
  }

  return {
    totalOrgs: allOrgs.length,
    psoCoreInserted,
    marketingOsInserted,
    perOrg: Array.from(grouped.values()).sort((a, b) => a.slug.localeCompare(b.slug)),
  };
}

const isDirectRun = process.argv[1]?.includes("seed-org-entitlements");
if (isDirectRun) {
  seedOrgEntitlements()
    .then((res) => {
      const lines: string[] = [];
      lines.push(`Sprint 2i.1 — org_entitlements seed`);
      lines.push(`====================================`);
      lines.push(`Total orgs:               ${res.totalOrgs}`);
      lines.push(`pso_core rows inserted:   ${res.psoCoreInserted}`);
      lines.push(`marketing_os rows inserted: ${res.marketingOsInserted}`);
      lines.push(``);
      lines.push(`Per-org entitlement counts (active):`);
      lines.push(`slug                          | org_id                                | pso_core | marketing_os`);
      lines.push(`------------------------------+--------------------------------------+----------+-------------`);
      for (const o of res.perOrg) {
        lines.push(
          `${o.slug.padEnd(30)}| ${o.orgId.padEnd(37)}| ${(o.psoCore ? "1" : "0").padEnd(9)}| ${o.marketingOs ? "1" : "0"}`,
        );
      }
      const totalPso = res.perOrg.filter((o) => o.psoCore).length;
      const totalMkt = res.perOrg.filter((o) => o.marketingOs).length;
      lines.push(``);
      lines.push(`Totals: pso_core=${totalPso}, marketing_os=${totalMkt}`);
      console.log(lines.join("\n"));
      process.exit(0);
    })
    .catch((err) => {
      console.error("Seed failed:", err);
      process.exit(1);
    });
}
