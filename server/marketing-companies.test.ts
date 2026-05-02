/**
 * Marketing OS Sprint 2b — companies + auto-link storage tests.
 *
 * Mirrors server/marketing-contacts.test.ts: real DB hits, unique RUN_TAG
 * per run, full afterAll cleanup. ~21 cases covering scoping, soft-delete,
 * domain unique-index, single-round-trip counts, and SET-ONLY auto-link.
 */
process.env.MARKETING_OS_ENABLED = "true";

import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { storage } from "./storage";
import { db, pool } from "./db";
import {
  brands,
  clientContacts,
  psoContactActivities,
  contactTags,
  companies,
} from "@shared/schema";
import { inArray, eq, and } from "drizzle-orm";
import { normalizeDomain, extractDomainFromEmail, isFreeMailDomain } from "./lib/domains";

const ORG_A = "c89d120d-1f07-4010-938f-070a0e13b8f2";
const ORG_B = "30cb6705-f98e-44c5-8e2a-fbe3f150a3eb";

const RUN_TAG = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const slugFor = (label: string) => `t2b-${label}-${RUN_TAG}`;
const dom = (label: string) => `${label}-${RUN_TAG}.example`;

let brandA: { id: string };
let brandB: { id: string };
const createdContactIds: string[] = [];
const createdCompanyIds: string[] = [];
const createdBrandIds: string[] = [];

beforeAll(async () => {
  brandA = await storage.createBrand({ orgId: ORG_A, name: `BrandA ${RUN_TAG}`, slug: slugFor("ba") });
  brandB = await storage.createBrand({ orgId: ORG_B, name: `BrandB ${RUN_TAG}`, slug: slugFor("bb") });
  createdBrandIds.push(brandA.id, brandB.id);
});

afterAll(async () => {
  if (createdContactIds.length > 0) {
    await db.delete(psoContactActivities).where(inArray(psoContactActivities.clientContactId, createdContactIds));
    // 5b1e: PSO tag writes ripped; no contact_tag_assignments rows to clean.
    await db.delete(clientContacts).where(inArray(clientContacts.id, createdContactIds));
  }
  if (createdCompanyIds.length > 0) {
    await db.delete(companies).where(inArray(companies.id, createdCompanyIds));
  }
  if (createdBrandIds.length > 0) {
    await db.delete(brands).where(inArray(brands.id, createdBrandIds));
  }
  await pool.end();
});

// ── Domain util (REV 3) ─────────────────────────────────────────────────
describe("normalizeDomain / extractDomainFromEmail / isFreeMailDomain", () => {
  it("normalizes case + whitespace; rejects malformed inputs", () => {
    expect(normalizeDomain("  FOO.COM  ")).toBe("foo.com");
    expect(normalizeDomain("Foo.Bar.Co")).toBe("foo.bar.co");
    expect(normalizeDomain(".foo.com")).toBeNull();
    expect(normalizeDomain("..foo.com")).toBeNull();
    expect(normalizeDomain("-foo.com")).toBeNull();
    expect(normalizeDomain("foo")).toBeNull();
    expect(normalizeDomain("foo.c")).toBeNull();
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain(null)).toBeNull();
    expect(normalizeDomain(undefined)).toBeNull();
    // 64-char label rejected (max 63)
    expect(normalizeDomain("a".repeat(64) + ".com")).toBeNull();
    // 63-char label accepted
    expect(normalizeDomain("a".repeat(63) + ".com")).toBe("a".repeat(63) + ".com");
    // Punycode (still ASCII)
    expect(normalizeDomain("xn--bcher-kva.de")).toBe("xn--bcher-kva.de");
  });

  it("extractDomainFromEmail handles plus-addressing + bad input", () => {
    expect(extractDomainFromEmail("dean+x@Foo.Com")).toBe("foo.com");
    expect(extractDomainFromEmail("noatsign")).toBeNull();
    expect(extractDomainFromEmail("trailing@")).toBeNull();
    expect(extractDomainFromEmail(null)).toBeNull();
  });

  it("isFreeMailDomain matches gmail/outlook etc; not corporate", () => {
    expect(isFreeMailDomain("gmail.com")).toBe(true);
    expect(isFreeMailDomain("proton.me")).toBe(true);
    expect(isFreeMailDomain("acmecorp.com")).toBe(false);
  });
});

// ── Scoping / CRUD ──────────────────────────────────────────────────────
describe("companies storage — CRUD + scoping", () => {
  it("createCompany + getCompany + tenant isolation", async () => {
    const c = await storage.createCompany(ORG_A, {
      brandId: brandA.id,
      name: `Acme ${RUN_TAG}`,
      domain: dom("acme"),
    });
    createdCompanyIds.push(c.id);
    expect(c.id).toBeTruthy();
    expect(c.source).toBe("manual");
    expect(c.deletedAt).toBeNull();
    expect(c.domain).toBe(dom("acme"));

    const ok = await storage.getCompany(ORG_A, c.id);
    expect(ok?.id).toBe(c.id);
    const wrong = await storage.getCompany(ORG_B, c.id);
    expect(wrong).toBeUndefined();
  });

  it("listCompanies scoped by orgId + brandId", async () => {
    const a = await storage.createCompany(ORG_A, { brandId: brandA.id, name: `A1-${RUN_TAG}`, domain: dom("a1") });
    const b = await storage.createCompany(ORG_B, { brandId: brandB.id, name: `B1-${RUN_TAG}`, domain: dom("b1") });
    createdCompanyIds.push(a.id, b.id);

    const aList = await storage.listCompanies(ORG_A, { brandId: brandA.id });
    expect(aList.find((r) => r.id === a.id)).toBeTruthy();
    expect(aList.find((r) => r.id === b.id)).toBeUndefined();

    const bList = await storage.listCompanies(ORG_B, { brandId: brandB.id });
    expect(bList.find((r) => r.id === b.id)).toBeTruthy();
    expect(bList.find((r) => r.id === a.id)).toBeUndefined();
  });

  it("updateCompany respects orgId + normalizes domain", async () => {
    const c = await storage.createCompany(ORG_A, { brandId: brandA.id, name: `U-${RUN_TAG}` });
    createdCompanyIds.push(c.id);

    const wrong = await storage.updateCompany(ORG_B, c.id, { name: "wrong" });
    expect(wrong).toBeUndefined();

    const ok = await storage.updateCompany(ORG_A, c.id, { name: "renamed", domain: "  EXAMPLE.com " });
    expect(ok?.name).toBe("renamed");
    expect(ok?.domain).toBe("example.com");
  });

  it("softDeleteCompany sets deleted_at; deleted filter works", async () => {
    const c = await storage.createCompany(ORG_A, { brandId: brandA.id, name: `D-${RUN_TAG}`, domain: dom("d") });
    createdCompanyIds.push(c.id);
    await storage.softDeleteCompany(ORG_A, c.id);
    const after = await storage.getCompany(ORG_A, c.id);
    expect(after?.deletedAt).toBeTruthy();

    const exclude = await storage.listCompanies(ORG_A, { brandId: brandA.id });
    expect(exclude.find((r) => r.id === c.id)).toBeUndefined();
    const only = await storage.listCompanies(ORG_A, { brandId: brandA.id, deleted: "only" });
    expect(only.find((r) => r.id === c.id)).toBeTruthy();
    const all = await storage.listCompanies(ORG_A, { brandId: brandA.id, deleted: "all" });
    expect(all.find((r) => r.id === c.id)).toBeTruthy();
  });

  it("partial unique allows multiple soft-deleted dupes + one live", async () => {
    const d = dom("uniq");
    const c1 = await storage.createCompany(ORG_A, { brandId: brandA.id, name: "c1", domain: d });
    createdCompanyIds.push(c1.id);
    await storage.softDeleteCompany(ORG_A, c1.id);
    const c2 = await storage.createCompany(ORG_A, { brandId: brandA.id, name: "c2", domain: d });
    createdCompanyIds.push(c2.id);
    await storage.softDeleteCompany(ORG_A, c2.id);
    const c3 = await storage.createCompany(ORG_A, { brandId: brandA.id, name: "c3", domain: d });
    createdCompanyIds.push(c3.id);
    expect(c3.id).toBeTruthy();
  });

  it("domain unique-index collision throws on a second LIVE row with same (org,brand,domain)", async () => {
    const d = dom("collide");
    const a = await storage.createCompany(ORG_A, { brandId: brandA.id, name: "first", domain: d });
    createdCompanyIds.push(a.id);
    await expect(
      storage.createCompany(ORG_A, { brandId: brandA.id, name: "dupe", domain: d }),
    ).rejects.toThrow();
  });

  it("findOrCreateCompanyByDomain is idempotent + transactional", async () => {
    const d = dom("foc");
    const x = await storage.findOrCreateCompanyByDomain(ORG_A, brandA.id, d);
    createdCompanyIds.push(x.id);
    const y = await storage.findOrCreateCompanyByDomain(ORG_A, brandA.id, d);
    expect(y.id).toBe(x.id);
    // Parallel race
    const [p, q] = await Promise.all([
      storage.findOrCreateCompanyByDomain(ORG_A, brandA.id, dom("race")),
      storage.findOrCreateCompanyByDomain(ORG_A, brandA.id, dom("race")),
    ]);
    createdCompanyIds.push(p.id);
    expect(p.id).toBe(q.id);
  });
});

// ── listCompanyContacts + countCompanyContacts ──────────────────────────
describe("listCompanyContacts / countCompanyContacts", () => {
  it("returns contacts scoped by orgId; excludes soft-deleted by default", async () => {
    const co = await storage.createCompany(ORG_A, { brandId: brandA.id, name: `LC-${RUN_TAG}`, domain: dom("lc") });
    createdCompanyIds.push(co.id);

    const c1 = await storage.createContact({
      orgId: ORG_A, brandId: brandA.id, firstName: "L", lastName: "1", companyId: co.id,
    });
    const c2 = await storage.createContact({
      orgId: ORG_A, brandId: brandA.id, firstName: "L", lastName: "2", companyId: co.id,
    });
    createdContactIds.push(c1.id, c2.id);

    const both = await storage.listCompanyContacts(ORG_A, co.id);
    expect(both.length).toBe(2);

    await storage.softDeleteContact(c2.id, ORG_A);
    const live = await storage.listCompanyContacts(ORG_A, co.id);
    expect(live.length).toBe(1);
    expect(await storage.countCompanyContacts(ORG_A, co.id)).toBe(1);
  });
});

// ── listCompaniesWithCounts (REV 2) ─────────────────────────────────────
describe("listCompaniesWithCounts — single round trip + soft-delete exclusion", () => {
  it("returns correct contactsCount and excludes soft-deleted contacts", async () => {
    const co = await storage.createCompany(ORG_A, { brandId: brandA.id, name: `WC-${RUN_TAG}`, domain: dom("wc") });
    createdCompanyIds.push(co.id);

    const c1 = await storage.createContact({
      orgId: ORG_A, brandId: brandA.id, firstName: "WC", lastName: "1", companyId: co.id,
    });
    const c2 = await storage.createContact({
      orgId: ORG_A, brandId: brandA.id, firstName: "WC", lastName: "2", companyId: co.id,
    });
    createdContactIds.push(c1.id, c2.id);

    const before = await storage.listCompaniesWithCounts(ORG_A, { brandId: brandA.id });
    const rowBefore = before.find((r) => r.id === co.id);
    expect(rowBefore?.contactsCount).toBe(2);

    await storage.softDeleteContact(c2.id, ORG_A);
    const after = await storage.listCompaniesWithCounts(ORG_A, { brandId: brandA.id });
    const rowAfter = after.find((r) => r.id === co.id);
    expect(rowAfter?.contactsCount).toBe(1);
  });

  it("is a single round trip (pg pool query-counter spy)", async () => {
    // Spy on the underlying pg pool's query method. drizzle-orm/node-postgres
    // executes one .query() per SQL statement; a successful single round trip
    // means exactly one .query() call against the pool for our list helper.
    const orig = (pool as any).query.bind(pool);
    let count = 0;
    let lastSql = "";
    (pool as any).query = (...args: any[]) => {
      const sqlText = typeof args[0] === "string" ? args[0] : args[0]?.text ?? "";
      if (/from\s+"?companies"?/i.test(sqlText)) { count += 1; lastSql = sqlText; }
      return orig(...args);
    };
    try {
      await storage.listCompaniesWithCounts(ORG_A, { brandId: brandA.id, limit: 10 });
    } finally {
      (pool as any).query = orig;
    }
    expect(count).toBe(1);
    // Confirm correlated subquery is in the SQL (single statement).
    expect(/from\s+"?client_contacts"?/i.test(lastSql)).toBe(true);
    expect(/deleted_at"?\s+IS\s+NULL/i.test(lastSql)).toBe(true);
  });
});

// ── Auto-link rule (REV 1) — SET-ONLY ───────────────────────────────────
describe("contact auto-link to company by email domain — SET-ONLY", () => {
  it("happy path: new contact + non-free-mail email → company created + activity row", async () => {
    const d = dom("happy");
    const c = await storage.createContact({
      orgId: ORG_A, brandId: brandA.id, firstName: "H", lastName: "P",
      email: `alice@${d}`,
    });
    createdContactIds.push(c.id);
    expect(c.companyId).toBeTruthy();
    if (c.companyId) createdCompanyIds.push(c.companyId);

    const co = await storage.getCompany(ORG_A, c.companyId!);
    expect(co?.name).toBe(d);
    expect(co?.source).toBe("auto_domain");

    const acts = await db
      .select()
      .from(psoContactActivities)
      .where(and(eq(psoContactActivities.clientContactId, c.id), eq(psoContactActivities.type, "company_linked")));
    expect(acts.length).toBe(1);
    expect((acts[0].payload as any)?.via).toBe("auto_domain");
  });

  it("free-mail (gmail.com) → companyId NULL, no company, no activity", async () => {
    const c = await storage.createContact({
      orgId: ORG_A, brandId: brandA.id, firstName: "F", lastName: "M",
      email: `bob+x@gmail.com`,
    });
    createdContactIds.push(c.id);
    expect(c.companyId).toBeNull();
    const acts = await db
      .select()
      .from(psoContactActivities)
      .where(and(eq(psoContactActivities.clientContactId, c.id), eq(psoContactActivities.type, "company_linked")));
    expect(acts.length).toBe(0);
  });

  it("existing company same domain → reuses, no new row created", async () => {
    const d = dom("reuse");
    const seed = await storage.findOrCreateCompanyByDomain(ORG_A, brandA.id, d);
    createdCompanyIds.push(seed.id);

    const c = await storage.createContact({
      orgId: ORG_A, brandId: brandA.id, firstName: "R", lastName: "U",
      email: `c@${d}`,
    });
    createdContactIds.push(c.id);
    expect(c.companyId).toBe(seed.id);
  });

  it("update fires when email is added AND companyId was NULL", async () => {
    const c = await storage.createContact({
      orgId: ORG_A, brandId: brandA.id, firstName: "AddE", lastName: "Mail",
    });
    createdContactIds.push(c.id);
    expect(c.companyId).toBeNull();

    const d = dom("addemail");
    const u = await storage.updateContact(c.id, ORG_A, { email: `x@${d}` });
    expect(u?.companyId).toBeTruthy();
    if (u?.companyId) createdCompanyIds.push(u.companyId);
  });

  it("update does NOT overwrite manually-set companyId when email changes to a new non-free-mail domain", async () => {
    const seed = await storage.createCompany(ORG_A, { brandId: brandA.id, name: `Manual-${RUN_TAG}`, domain: dom("manual") });
    createdCompanyIds.push(seed.id);

    const c = await storage.createContact({
      orgId: ORG_A, brandId: brandA.id, firstName: "Man", lastName: "Set",
      companyId: seed.id,
    });
    createdContactIds.push(c.id);
    expect(c.companyId).toBe(seed.id);

    const u = await storage.updateContact(c.id, ORG_A, { email: `y@${dom("other")}` });
    expect(u?.companyId).toBe(seed.id); // unchanged
  });

  it("update does NOT overwrite manually-set companyId when email is added for the first time", async () => {
    const seed = await storage.createCompany(ORG_A, { brandId: brandA.id, name: `M2-${RUN_TAG}`, domain: dom("m2") });
    createdCompanyIds.push(seed.id);

    const c = await storage.createContact({
      orgId: ORG_A, brandId: brandA.id, firstName: "Man", lastName: "Email",
      companyId: seed.id,
    });
    createdContactIds.push(c.id);

    const u = await storage.updateContact(c.id, ORG_A, { email: `z@${dom("addr")}` });
    expect(u?.companyId).toBe(seed.id); // unchanged
  });

  it("auto-link does NOT clear companyId when email changes to a free-mail address", async () => {
    const d = dom("preserve");
    const c = await storage.createContact({
      orgId: ORG_A, brandId: brandA.id, firstName: "Pre", lastName: "Serve",
      email: `original@${d}`,
    });
    createdContactIds.push(c.id);
    if (c.companyId) createdCompanyIds.push(c.companyId);
    const linked = c.companyId;
    expect(linked).toBeTruthy();

    const u = await storage.updateContact(c.id, ORG_A, { email: `now@gmail.com` });
    expect(u?.companyId).toBe(linked); // not cleared
  });

  it("explicit unlink (companyId=null in patch) is preserved — auto-link MUST NOT relink in same request", async () => {
    const d = dom("unlink");
    const c = await storage.createContact({
      orgId: ORG_A, brandId: brandA.id, firstName: "Un", lastName: "Link",
      email: `who@${d}`,
    });
    createdContactIds.push(c.id);
    if (c.companyId) createdCompanyIds.push(c.companyId);
    expect(c.companyId).toBeTruthy();

    const u = await storage.updateContact(c.id, ORG_A, { companyId: null });
    expect(u?.companyId).toBeNull();

    const u2 = await storage.updateContact(c.id, ORG_A, { firstName: "Un2" });
    expect(u2?.companyId).toBeTruthy();
  });

  it("auto-link DOES fire when email is added for the first time AND companyId is NULL", async () => {
    const c = await storage.createContact({
      orgId: ORG_A, brandId: brandA.id, firstName: "Fst", lastName: "Mail",
    });
    createdContactIds.push(c.id);
    expect(c.companyId).toBeNull();

    const d = dom("first");
    const u = await storage.updateContact(c.id, ORG_A, { email: `first@${d}` });
    expect(u?.companyId).toBeTruthy();
    if (u?.companyId) createdCompanyIds.push(u.companyId);
  });
});
