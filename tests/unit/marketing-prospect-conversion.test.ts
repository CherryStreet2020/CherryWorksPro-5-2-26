/**
 * Sprint 2o.0 — Step 2 storage layer
 *
 * Direct DB-backed unit tests for convertProspectToCustomer and
 * convertMarketingCompanyToClient. Covers the four scenarios the
 * spec calls out:
 *
 *   1. prospect-only (no company)            — creates contact, no client
 *   2. prospect + company                    — creates contact AND client
 *   3. already-converted reuse path          — second prospect on a
 *                                              previously-converted company
 *                                              attaches to the existing client
 *                                              (no duplicate client)
 *   4. idempotency                           — calling convert again on the
 *                                              same prospect/company returns
 *                                              the existing rows with
 *                                              alreadyConverted=true
 *
 * Each test creates its own org so runs are hermetic and self-cleaning.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { storage } from "../../server/storage";
import { db } from "../../server/db";
import {
  marketingProspects,
  marketingCompanies,
  clients,
  clientContacts,
  orgs,
} from "@shared/schema";
import { eq } from "drizzle-orm";

let orgId: string;

beforeAll(async () => {
  const stamp = Date.now();
  const org = await storage.createOrg({
    name: `sprint-2o0-conversion-${stamp}`,
    slug: `sprint-2o0-conv-${stamp}`,
    plan: "free",
  } as any);
  orgId = org.id;
});

afterAll(async () => {
  // Clean up in dependency-safe order. marketing_* have no FK to PSO,
  // PSO has no FK to marketing_*, so order between the two trees is
  // arbitrary; within each tree, children before parents.
  await db.delete(clientContacts).where(eq(clientContacts.orgId, orgId));
  await db.delete(clients).where(eq(clients.orgId, orgId));
  await db.delete(marketingProspects).where(eq(marketingProspects.orgId, orgId));
  await db.delete(marketingCompanies).where(eq(marketingCompanies.orgId, orgId));
  await db.delete(orgs).where(eq(orgs.id, orgId));
});

describe("convertProspectToCustomer / convertMarketingCompanyToClient", () => {
  it("Scenario 1: prospect-only (no company) creates a contact with clientId=null", async () => {
    const prospect = await storage.createProspect({
      orgId,
      firstName: "Solo",
      lastName: "Lead",
      email: `solo+${Date.now()}@example.com`,
      lifecycleStage: "lead",
    });

    const out = await storage.convertProspectToCustomer(orgId, prospect.id);

    expect(out.alreadyConverted).toBe(false);
    expect(out.reusedExistingClient).toBe(false);
    expect(out.client).toBeNull();
    expect(out.clientContact.clientId).toBeNull();
    expect(out.clientContact.originatedFromProspectId).toBe(prospect.id);
    expect(out.clientContact.email).toBe(prospect.email);

    const refreshed = await storage.getProspect(prospect.id, orgId);
    expect(refreshed?.convertedToClientContactId).toBe(out.clientContact.id);
    expect(refreshed?.lifecycleStage).toBe("converted");
    expect(refreshed?.convertedAt).not.toBeNull();
  });

  it("Scenario 2: prospect + company converts both and links them", async () => {
    const company = await storage.createMarketingCompany({
      orgId,
      name: "Acme Co",
      domain: `acme-${Date.now()}.example`,
      industry: "software",
    });
    const prospect = await storage.createProspect({
      orgId,
      companyId: company.id,
      firstName: "Anna",
      lastName: "Acme",
      email: `anna+${Date.now()}@example.com`,
      lifecycleStage: "mql",
    });

    const out = await storage.convertProspectToCustomer(orgId, prospect.id);

    expect(out.alreadyConverted).toBe(false);
    expect(out.reusedExistingClient).toBe(false);
    expect(out.client).not.toBeNull();
    expect(out.client!.name).toBe("Acme Co");
    expect(out.client!.originatedFromMarketingCompanyId).toBe(company.id);
    expect(out.clientContact.clientId).toBe(out.client!.id);
    expect(out.clientContact.originatedFromProspectId).toBe(prospect.id);

    const refreshedCompany = await storage.getMarketingCompany(company.id, orgId);
    expect(refreshedCompany?.convertedToClientId).toBe(out.client!.id);
    expect(refreshedCompany?.lifecycleStage).toBe("customer");
  });

  it("Scenario 3: second prospect on already-converted company reuses the client", async () => {
    const company = await storage.createMarketingCompany({
      orgId,
      name: "Globex Corp",
      domain: `globex-${Date.now()}.example`,
    });
    const prospectA = await storage.createProspect({
      orgId,
      companyId: company.id,
      firstName: "First",
      lastName: "Globex",
      email: `first+${Date.now()}@globex.example`,
    });
    const prospectB = await storage.createProspect({
      orgId,
      companyId: company.id,
      firstName: "Second",
      lastName: "Globex",
      email: `second+${Date.now()}@globex.example`,
    });

    const outA = await storage.convertProspectToCustomer(orgId, prospectA.id);
    const outB = await storage.convertProspectToCustomer(orgId, prospectB.id);

    expect(outA.client?.id).toBeDefined();
    expect(outB.client?.id).toBe(outA.client!.id);
    expect(outB.reusedExistingClient).toBe(true);
    expect(outB.alreadyConverted).toBe(false);
    // Both contacts share the same parent client → no duplicate client row.
    expect(outA.clientContact.clientId).toBe(outB.clientContact.clientId);

    const allClientsForCompany = await db
      .select()
      .from(clients)
      .where(eq(clients.originatedFromMarketingCompanyId, company.id));
    expect(allClientsForCompany.length).toBe(1);
  });

  it("Scenario 4a: re-converting a prospect is idempotent", async () => {
    const prospect = await storage.createProspect({
      orgId,
      firstName: "Ida",
      lastName: "Idem",
      email: `ida+${Date.now()}@example.com`,
    });

    const first = await storage.convertProspectToCustomer(orgId, prospect.id);
    const second = await storage.convertProspectToCustomer(orgId, prospect.id);

    expect(second.alreadyConverted).toBe(true);
    expect(second.clientContact.id).toBe(first.clientContact.id);

    const dupes = await db
      .select()
      .from(clientContacts)
      .where(eq(clientContacts.originatedFromProspectId, prospect.id));
    expect(dupes.length).toBe(1);
  });

  it("Scenario 4b: re-converting a marketing_company is idempotent", async () => {
    const company = await storage.createMarketingCompany({
      orgId,
      name: "Idempotent Inc",
      domain: `idem-${Date.now()}.example`,
    });

    const first = await storage.convertMarketingCompanyToClient(orgId, company.id);
    const second = await storage.convertMarketingCompanyToClient(orgId, company.id);

    expect(second.alreadyConverted).toBe(true);
    expect(second.client.id).toBe(first.client.id);

    const dupes = await db
      .select()
      .from(clients)
      .where(eq(clients.originatedFromMarketingCompanyId, company.id));
    expect(dupes.length).toBe(1);
  });

  it("createClient=false leaves the contact unparented even when company exists", async () => {
    const company = await storage.createMarketingCompany({
      orgId,
      name: "NoClient LLC",
      domain: `noclient-${Date.now()}.example`,
    });
    const prospect = await storage.createProspect({
      orgId,
      companyId: company.id,
      firstName: "Dont",
      lastName: "Convert",
      email: `dc+${Date.now()}@example.com`,
    });

    const out = await storage.convertProspectToCustomer(orgId, prospect.id, {
      createClient: false,
    });

    expect(out.client).toBeNull();
    expect(out.clientContact.clientId).toBeNull();
    const refreshedCompany = await storage.getMarketingCompany(company.id, orgId);
    expect(refreshedCompany?.convertedToClientId).toBeNull();
    expect(refreshedCompany?.lifecycleStage).not.toBe("customer");
  });
});
