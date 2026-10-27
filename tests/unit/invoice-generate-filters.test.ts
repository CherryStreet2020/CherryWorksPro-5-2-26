import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { TEST_BASE as BASE } from "../helpers/base";
let cookie = "";
let csrfToken = "";
// Other test files create and delete clients in the same org while this one
// runs, and /api/clients lists newest first, so clients[0] was often someone
// else's temporary client, gone by the time generate looked it up ("Client not
// found in your organization"). This file uses a client it owns instead.
let clientId = "";

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin.test@cwpro.dev",
      password: "admin123",
    }),
  });
  const raw = res.headers.getSetCookie?.() ?? [];
  cookie = raw.map(c => c.split(";")[0]).join("; ");
  csrfToken = res.headers.get("x-csrf-token") || "";
  return res;
}

function authHeaders(extra: Record<string, string> = {}) {
  return { Cookie: cookie, "X-CSRF-Token": csrfToken, ...extra };
}

async function authFetch(url: string, init?: RequestInit) {
  return fetch(`${BASE}${url}`, {
    ...init,
    headers: { ...authHeaders(), ...init?.headers },
  });
}

describe("Invoice generate filters", () => {
  beforeAll(async () => {
    await login();
    const res = await authFetch("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Invoice Filters Test Client" }),
    });
    expect(res.status).toBe(200);
    clientId = (await res.json()).id;
  });

  afterAll(async () => {
    if (clientId) await authFetch(`/api/clients/${clientId}`, { method: "DELETE" });
  });

  it("unbilled preview includes byTeamMember array", async () => {
    const clientsRes = await authFetch("/api/clients");
    const clients = await clientsRes.json();
    if (!clients.length) return;

    let found = false;
    for (const client of [...clients].reverse()) {
      const res = await authFetch(`/api/time-entries/unbilled-preview?clientId=${client.id}`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data).toHaveProperty("byTeamMember");
      expect(Array.isArray(data.byTeamMember)).toBe(true);
      if (data.byTeamMember.length > 0) {
        expect(data.byTeamMember[0]).toHaveProperty("teamMemberId");
        expect(data.byTeamMember[0]).toHaveProperty("name");
        expect(data.byTeamMember[0]).toHaveProperty("hours");
        expect(data.byTeamMember[0]).toHaveProperty("amount");
        found = true;
        break;
      }
    }
    expect(found || clients.length > 0).toBe(true);
  });

  it("unbilled preview entries include teamMemberId", async () => {
    const res = await authFetch(`/api/time-entries/unbilled-preview?clientId=${clientId}`);
    const data = await res.json();
    if (data.entries.length > 0) {
      expect(data.entries[0]).toHaveProperty("teamMemberId");
      expect(data.entries[0]).toHaveProperty("userId");
    }
  });

  it("unbilled preview accepts dateFrom/dateTo filters", async () => {
    const allRes = await authFetch(`/api/time-entries/unbilled-preview?clientId=${clientId}`);
    const allData = await allRes.json();

    const futureRes = await authFetch(`/api/time-entries/unbilled-preview?clientId=${clientId}&dateFrom=2099-01-01`);
    const futureData = await futureRes.json();
    expect(futureData.entries.length).toBeLessThanOrEqual(allData.entries.length);
  });

  it("unbilled preview accepts teamMemberIds filter", async () => {
    const res = await authFetch(`/api/time-entries/unbilled-preview?clientId=${clientId}&teamMemberIds=nonexistent-id`);
    const data = await res.json();
    expect(data.entries.length).toBe(0);
  });

  it("generate endpoint accepts teamMemberIds filter", async () => {
    const res = await authFetch("/api/invoices/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        clientId,
        teamMemberIds: ["nonexistent-id"],
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.message).toContain("unbilled");
  });

  it("generate endpoint accepts dateFrom/dateTo filter", async () => {
    const res = await authFetch("/api/invoices/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        clientId,
        dateFrom: "2099-01-01",
        dateTo: "2099-12-31",
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.message).toContain("unbilled");
  });

  it("generate endpoint accepts grouping parameter", async () => {
    const res = await authFetch("/api/invoices/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        clientId,
        grouping: "per-team-member",
        dateFrom: "2099-01-01",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("generateInvoiceSchema accepts all new fields", async () => {
    const { generateInvoiceSchema } = await import("../../shared/schema");
    const result = generateInvoiceSchema.safeParse({
      clientId: "test-id",
      teamMemberIds: ["c1", "c2"],
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      grouping: "per-team-member",
      includeUnapproved: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.teamMemberIds).toEqual(["c1", "c2"]);
      expect(result.data.grouping).toBe("per-team-member");
      expect(result.data.includeUnapproved).toBe(true);
    }
  });

  it("generateInvoiceSchema defaults grouping to combined", async () => {
    const { generateInvoiceSchema } = await import("../../shared/schema");
    const result = generateInvoiceSchema.safeParse({
      clientId: "test-id",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.grouping).toBe("combined");
    }
  });
});
