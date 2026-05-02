/**
 * Task #360 — Pre-test sweeper must be org-scoped.
 *
 * The sweeper introduced for task #360 cleans stale "BrandB %",
 * "Phase7 Activity Brand %", and "E2E Test Vendor%" rows. This regression
 * test pins the cross-org isolation contract: a sweep run against org A
 * must NOT touch matching rows that live in org B, even when the brand
 * name and expense vendor look identical.
 */
process.env.MARKETING_OS_ENABLED = "true";

import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { randomUUID } from "crypto";
import { db, pool } from "../../server/db";
import {
  orgs,
  brands,
  expenses,
  users,
  expenseCategories,
} from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { sweepE2ETestPollution } from "../../scripts/cleanup-e2e-brand-pollution";

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ORG_A = randomUUID();
const ORG_B = randomUUID();

const brandIds: string[] = [];
const expenseIds: string[] = [];
const userIds: string[] = [];
const categoryIds: string[] = [];

async function seedOrg(orgId: string, suffix: string) {
  await db.insert(orgs).values({
    id: orgId,
    name: `t360-${suffix} ${RUN}`,
    slug: `t360-${suffix}-${RUN}`,
  });
  const userId = randomUUID();
  await db.insert(users).values({
    id: userId,
    orgId,
    email: `t360-${suffix}-${RUN}@example.test`,
    password: "x",
    name: `T360 ${suffix}`,
    firstName: "T360",
    lastName: suffix,
    role: "ADMIN",
  });
  userIds.push(userId);
  const categoryId = randomUUID();
  await db.insert(expenseCategories).values({
    id: categoryId,
    orgId,
    name: `t360-cat-${suffix}-${RUN}`,
  });
  categoryIds.push(categoryId);
  return { userId, categoryId };
}

beforeAll(async () => {
  const a = await seedOrg(ORG_A, "A");
  const b = await seedOrg(ORG_B, "B");

  // Insert a "stale" BrandB row in BOTH orgs with names that match the
  // sweeper's BRAND_NAME_PREFIXES list.
  const [brandA] = await db
    .insert(brands)
    .values({
      orgId: ORG_A,
      name: `BrandB ${RUN}-A`,
      slug: `t360-brand-a-${RUN}`,
    })
    .returning();
  const [brandB] = await db
    .insert(brands)
    .values({
      orgId: ORG_B,
      name: `BrandB ${RUN}-B`,
      slug: `t360-brand-b-${RUN}`,
    })
    .returning();
  brandIds.push(brandA.id, brandB.id);

  const [expA] = await db
    .insert(expenses)
    .values({
      orgId: ORG_A,
      userId: a.userId,
      categoryId: a.categoryId,
      amount: "10.00",
      date: new Date().toISOString().slice(0, 10),
      vendor: `E2E Test Vendor ${RUN}-A`,
    })
    .returning();
  const [expB] = await db
    .insert(expenses)
    .values({
      orgId: ORG_B,
      userId: b.userId,
      categoryId: b.categoryId,
      amount: "10.00",
      date: new Date().toISOString().slice(0, 10),
      vendor: `E2E Test Vendor ${RUN}-B`,
    })
    .returning();
  expenseIds.push(expA.id, expB.id);
});

afterAll(async () => {
  // Defensive cleanup — any rows the sweeper left behind get tidied here
  // so the test harness doesn't pollute the dev DB even if it failed.
  await db.delete(expenses).where(inArray(expenses.id, expenseIds)).catch(() => {});
  await db.delete(brands).where(inArray(brands.id, brandIds)).catch(() => {});
  await db
    .delete(expenseCategories)
    .where(inArray(expenseCategories.id, categoryIds))
    .catch(() => {});
  await db.delete(users).where(inArray(users.id, userIds)).catch(() => {});
  await db.delete(orgs).where(inArray(orgs.id, [ORG_A, ORG_B])).catch(() => {});
});

describe("sweepE2ETestPollution org scoping (task #360)", () => {
  it("only deletes matching brand+expense rows in the target org", async () => {
    // Sweep org A. Org B's identical-pattern rows must remain untouched.
    const report = await sweepE2ETestPollution(ORG_A);
    expect(report.brandsDeleted).toBeGreaterThanOrEqual(1);
    expect(report.expensesDeleted).toBeGreaterThanOrEqual(1);

    // Org A rows are gone.
    const aBrand = await db.select().from(brands).where(eq(brands.id, brandIds[0]));
    expect(aBrand.length).toBe(0);
    const aExp = await db.select().from(expenses).where(eq(expenses.id, expenseIds[0]));
    expect(aExp.length).toBe(0);

    // Org B rows survive (cross-tenant safety).
    const bBrand = await db.select().from(brands).where(eq(brands.id, brandIds[1]));
    expect(bBrand.length).toBe(1);
    expect(bBrand[0].orgId).toBe(ORG_B);
    const bExp = await db.select().from(expenses).where(eq(expenses.id, expenseIds[1]));
    expect(bExp.length).toBe(1);
    expect(bExp[0].orgId).toBe(ORG_B);
  });

  it("refuses to run when orgId is empty", async () => {
    await expect(sweepE2ETestPollution("")).rejects.toThrow(/orgId/);
  });
});
