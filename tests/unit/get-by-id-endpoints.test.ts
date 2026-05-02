import { describe, it, expect, beforeAll } from "vitest";

import { TEST_BASE as BASE } from "../helpers/base";
const LOGIN_EMAIL = "admin.test@cwpro.dev";
const LOGIN_PASSWORD = "admin123";
const FAKE_UUID = "00000000-0000-0000-0000-000000000000";

let cookies = "";
let realInvoiceId = "";
let realProjectId = "";

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: LOGIN_EMAIL, password: LOGIN_PASSWORD }),
  });
  const setCookie = res.headers.getSetCookie?.() || [];
  cookies = setCookie.map((c: string) => c.split(";")[0]).join("; ");
}

function authHeaders(): Record<string, string> {
  return { Cookie: cookies };
}

beforeAll(async () => {
  await login();

  const invRes = await fetch(`${BASE}/api/invoices`, { headers: authHeaders() });
  const invoices = await invRes.json();
  if (invoices.length > 0) realInvoiceId = invoices[0].id;

  const projRes = await fetch(`${BASE}/api/projects`, { headers: authHeaders() });
  const projects = await projRes.json();
  if (projects.length > 0) realProjectId = projects[0].id;
});

describe("GET /api/invoices/:id", () => {
  it("200 — returns full invoice with line items for valid org-scoped id", async () => {
    expect(realInvoiceId).toBeTruthy();
    const res = await fetch(`${BASE}/api/invoices/${realInvoiceId}`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.id).toBe(realInvoiceId);
    expect(body).toHaveProperty("number");
    expect(body).toHaveProperty("status");
    expect(body).toHaveProperty("clientId");
    expect(body).toHaveProperty("clientName");
    expect(body).toHaveProperty("subtotal");
    expect(body).toHaveProperty("total");
    expect(body).toHaveProperty("lines");
    expect(Array.isArray(body.lines)).toBe(true);
  });

  it("404 — cross-org isolation (non-existent UUID returns 404)", async () => {
    const res = await fetch(`${BASE}/api/invoices/${FAKE_UUID}`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.message).toBe("Invoice not found");
  });
});

describe("GET /api/projects/:id", () => {
  it("200 — returns full project detail for valid org-scoped id", async () => {
    expect(realProjectId).toBeTruthy();
    const res = await fetch(`${BASE}/api/projects/${realProjectId}`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty("project");
    expect(body.project.id).toBe(realProjectId);
    expect(body.project).toHaveProperty("name");
    expect(body.project).toHaveProperty("clientId");
    expect(body.project).toHaveProperty("clientName");
    expect(body).toHaveProperty("members");
    expect(Array.isArray(body.members)).toBe(true);
    expect(body).toHaveProperty("stats");
  });

  it("404 — cross-org isolation (non-existent UUID returns 404)", async () => {
    const res = await fetch(`${BASE}/api/projects/${FAKE_UUID}`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.message).toBe("Project not found");
  });
});
