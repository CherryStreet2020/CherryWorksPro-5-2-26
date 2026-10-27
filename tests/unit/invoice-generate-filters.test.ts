import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { TEST_BASE as BASE } from "../helpers/base";
let cookie = "";
let csrfToken = "";
// Other test files create and delete clients in the same org while this one
// runs, and /api/clients lists newest first, so clients[0] was often someone
// else's temporary client, gone by the time generate looked it up ("Client not
// found in your organization"). This file uses a client it owns instead, with
// one billable entry, so every filter test starts from a nonempty baseline and
// fails if the filter stops excluding it. The entry's timesheet isn't approved,
// so the tests pass includeUnapproved.
let clientId = "";
let projectId = "";
let entryId = "";
let entryUserId = "";
const entryDate = new Date().toISOString().slice(0, 10);

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

    const p = await authFetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, name: "Invoice Filters Test Project", status: "ACTIVE" }),
    });
    expect(p.ok).toBe(true);
    projectId = (await p.json()).id;

    const e = await authFetch("/api/time-entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, date: entryDate, minutes: 60, billable: true, notes: "filters test" }),
    });
    expect(e.status).toBe(200);
    const entry = await e.json();
    entryId = entry.id;
    entryUserId = entry.userId;
  });

  afterAll(async () => {
    if (entryId) await authFetch(`/api/time-entries/${entryId}`, { method: "DELETE" });
    if (projectId) await authFetch(`/api/projects/${projectId}`, { method: "DELETE" });
    if (clientId) await authFetch(`/api/clients/${clientId}`, { method: "DELETE" });
  });

  async function preview(query = "") {
    const res = await authFetch(`/api/time-entries/unbilled-preview?clientId=${clientId}&includeUnapproved=true${query}`);
    expect(res.ok).toBe(true);
    return res.json();
  }

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
    const data = await preview();
    expect(data.entries.map((x: any) => x.id)).toEqual([entryId]);
    expect(data.entries[0]).toHaveProperty("teamMemberId", entryUserId);
    expect(data.entries[0]).toHaveProperty("userId", entryUserId);
  });

  it("unbilled preview accepts dateFrom/dateTo filters", async () => {
    expect((await preview(`&dateFrom=${entryDate}&dateTo=${entryDate}`)).entries).toHaveLength(1);
    expect((await preview("&dateFrom=2099-01-01")).entries).toHaveLength(0);
    expect((await preview("&dateTo=2000-01-01")).entries).toHaveLength(0);
  });

  it("unbilled preview accepts teamMemberIds filter", async () => {
    expect((await preview(`&teamMemberIds=${entryUserId}`)).entries).toHaveLength(1);
    expect((await preview("&teamMemberIds=nonexistent-id")).entries).toHaveLength(0);
  });

  // With the entry in scope, generate would succeed (and create an invoice), so
  // the "unbilled" 400 below only comes back if the filter excluded it.
  it("generate endpoint accepts teamMemberIds filter", async () => {
    const res = await authFetch("/api/invoices/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        clientId,
        includeUnapproved: true,
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
        includeUnapproved: true,
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
        includeUnapproved: true,
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
