import { describe, it, expect, beforeAll } from "vitest";

import { TEST_BASE as BASE } from "../helpers/base";

let cookie = "";
let csrfToken = "";

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin.test@cwpro.dev", password: "admin123" }),
  });
  const raw = res.headers.getSetCookie?.() ?? [];
  cookie = raw.map(c => c.split(";")[0]).join("; ");
  csrfToken = res.headers.get("x-csrf-token") || "";
  return res;
}

function authHeaders(extra: Record<string, string> = {}) {
  return { Cookie: cookie, "Content-Type": "application/json", "X-CSRF-Token": csrfToken, ...extra };
}

beforeAll(async () => {
  await login();
});

describe("Client CRUD API", () => {
  let testClientId: string;

  it("PATCH /api/clients/:id updates name — verify 200 + updated field", async () => {
    const createRes = await fetch(`${BASE}/api/clients`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: "CRUD Test Client" }),
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json();
    testClientId = created.id;

    const patchRes = await fetch(`${BASE}/api/clients/${testClientId}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ name: "CRUD Test Client Updated" }),
    });
    expect(patchRes.status).toBe(200);
    const patched = await patchRes.json();
    expect(patched.name).toBe("CRUD Test Client Updated");
  });

  it("DELETE /api/clients/:id with no refs — verify 200", async () => {
    const createRes = await fetch(`${BASE}/api/clients`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: "Delete Me Client" }),
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json();

    const deleteRes = await fetch(`${BASE}/api/clients/${created.id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(deleteRes.status).toBe(200);
    const body = await deleteRes.json();
    expect(body.success).toBe(true);
  });

  it("DELETE /api/clients/:id with invoices — verify 409 + conflict message", async () => {
    const clientsRes = await fetch(`${BASE}/api/clients`, {
      headers: authHeaders(),
    });
    const clients = await clientsRes.json();

    const invoicesRes = await fetch(`${BASE}/api/invoices`, {
      headers: authHeaders(),
    });
    const invoices = await invoicesRes.json();

    const clientWithInvoice = clients.find((c: any) =>
      invoices.some((inv: any) => inv.clientId === c.id)
    );

    if (!clientWithInvoice) {
      console.log("No client with invoices found — skipping 409 test");
      return;
    }

    const deleteRes = await fetch(`${BASE}/api/clients/${clientWithInvoice.id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(deleteRes.status).toBe(409);
    const body = await deleteRes.json();
    expect(body.message).toContain("Cannot delete client");
  });

  it("cleanup test client", async () => {
    if (testClientId) {
      await fetch(`${BASE}/api/clients/${testClientId}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
    }
  });
});
