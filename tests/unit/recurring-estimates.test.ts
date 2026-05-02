import { describe, test, expect, beforeAll } from "vitest";

import { TEST_BASE as BASE } from "../helpers/base";
let cookie = "";
let csrfToken = "";
let _orgId = "";

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin.test@cwpro.dev", password: "admin123" }),
  });
  const raw = res.headers.getSetCookie?.() ?? [];
  cookie = raw.map(c => c.split(";")[0]).join("; ");
  csrfToken = res.headers.get("x-csrf-token") || "";
  const me = await fetch(`${BASE}/api/auth/me`, { headers: { Cookie: cookie } });
  const user = await me.json();
  _orgId = user.orgId;
}

function authed(url: string, opts: RequestInit = {}) {
  return fetch(`${BASE}${url}`, {
    ...opts,
    headers: { ...((opts.headers as Record<string, string>) || {}), Cookie: cookie, "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
  });
}

beforeAll(login);

describe("Recurring Invoice Templates", () => {
  test("GET /api/recurring-templates returns array", async () => {
    const res = await authed("/api/recurring-templates");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test("templates include clientName field", async () => {
    const clients = await (await authed("/api/clients")).json();
    await authed("/api/recurring-templates", {
      method: "POST",
      body: JSON.stringify({
        clientId: clients[0].id,
        frequency: "MONTHLY",
        nextIssueDate: "2026-05-01",
        dayOfMonth: 1,
        templateLines: [{ description: "Monthly retainer", quantity: 1, unitRate: 5000 }],
      }),
    });
    const res = await authed("/api/recurring-templates");
    const data = await res.json();
    const monthly = data.find((t: any) => t.frequency === "MONTHLY");
    expect(monthly).toBeTruthy();
    expect(monthly.clientName).toBeTruthy();
    expect(monthly.templateLines).toBeTruthy();
    expect(Array.isArray(monthly.templateLines)).toBe(true);
  });

  let newTemplateId = "";

  test("POST /api/recurring-templates creates template", async () => {
    const clients = await (await authed("/api/clients")).json();
    const res = await authed("/api/recurring-templates", {
      method: "POST",
      body: JSON.stringify({
        clientId: clients[0].id,
        frequency: "WEEKLY",
        nextIssueDate: "2026-04-07",
        templateLines: [{ description: "Weekly support", quantity: 5, unitRate: 100 }],
      }),
    });
    expect(res.status).toBe(201);
    const tmpl = await res.json();
    expect(tmpl.frequency).toBe("WEEKLY");
    newTemplateId = tmpl.id;
  });

  test("PATCH /api/recurring-templates/:id updates template", async () => {
    if (!newTemplateId) return;
    const res = await authed(`/api/recurring-templates/${newTemplateId}`, {
      method: "PATCH",
      body: JSON.stringify({ taxRate: 5 }),
    });
    expect(res.status).toBe(200);
    const tmpl = await res.json();
    expect(Number(tmpl.taxRate)).toBe(5);
  });

  test("DELETE /api/recurring-templates/:id deactivates", async () => {
    if (!newTemplateId) return;
    const res = await authed(`/api/recurring-templates/${newTemplateId}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
  });

  test("deactivated template shows isActive=false", async () => {
    if (!newTemplateId) return;
    const res = await authed(`/api/recurring-templates/${newTemplateId}`);
    const tmpl = await res.json();
    expect(tmpl.isActive).toBe(false);
  });

  let activeTemplateId = "";

  test("POST /api/recurring-templates/:id/generate creates invoice from template", async () => {
    const clients = await (await authed("/api/clients")).json();
    const createRes = await authed("/api/recurring-templates", {
      method: "POST",
      body: JSON.stringify({
        clientId: clients[0].id,
        frequency: "MONTHLY",
        nextIssueDate: "2026-03-01",
        templateLines: [
          { description: "Monthly retainer", quantity: 1, unitRate: 2000 },
          { description: "Support hours", quantity: 10, unitRate: 100 },
        ],
        taxRate: 5,
      }),
    });
    expect(createRes.status).toBe(201);
    const tmpl = await createRes.json();
    activeTemplateId = tmpl.id;

    const genRes = await authed(`/api/recurring-templates/${activeTemplateId}/generate`, {
      method: "POST",
    });
    expect(genRes.status).toBe(201);
    const invoice = await genRes.json();
    expect(invoice.status).toBe("DRAFT");
    expect(invoice.lines.length).toBe(2);
    expect(Number(invoice.subtotal)).toBe(3000);
  });

  test("generate advances nextIssueDate on template", async () => {
    if (!activeTemplateId) return;
    const res = await authed(`/api/recurring-templates/${activeTemplateId}`);
    const tmpl = await res.json();
    expect(tmpl.nextIssueDate).toBe("2026-04-01");
  });

  test("generate fails for inactive template", async () => {
    if (!newTemplateId) return;
    const res = await authed(`/api/recurring-templates/${newTemplateId}/generate`, {
      method: "POST",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/inactive/i);
  });
});

describe("Estimates / Proposals", () => {
  test("GET /api/estimates returns array", async () => {
    const res = await authed("/api/estimates");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test("seeded estimates exist with at least 2 numbered entries", async () => {
    const res = await authed("/api/estimates");
    const data = await res.json();
    expect(data.length).toBeGreaterThanOrEqual(2);
    for (const e of data) {
      expect(typeof e.number).toBe("string");
      expect(e.number).toMatch(/EST-\d+/);
    }
  });

  test("at least one estimate has a public token", async () => {
    const res = await authed("/api/estimates");
    const data = await res.json();
    const withToken = data.find((e: any) => e.publicToken);
    expect(withToken).toBeTruthy();
    expect(withToken.publicToken).toBeTruthy();
  });

  test("estimates expose discount and tax fields", async () => {
    const res = await authed("/api/estimates");
    const data = await res.json();
    expect(data.length).toBeGreaterThan(0);
    for (const e of data) {
      expect(e).toHaveProperty("discountAmount");
      expect(e).toHaveProperty("taxAmount");
      expect(Number.isFinite(Number(e.discountAmount))).toBe(true);
      expect(Number.isFinite(Number(e.taxAmount))).toBe(true);
    }
  });

  let newEstId = "";

  test("POST /api/estimates creates estimate with lines", async () => {
    const clients = await (await authed("/api/clients")).json();
    const res = await authed("/api/estimates", {
      method: "POST",
      body: JSON.stringify({
        clientId: clients[0].id,
        issuedDate: "2026-03-04",
        taxRate: 0,
        lines: [
          { description: "Consulting hours", quantity: 10, unitRate: 150 },
          { description: "Travel", quantity: 1, unitRate: 500 },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const est = await res.json();
    expect(est.number).toMatch(/EST-/);
    expect(est.lines.length).toBe(2);
    expect(Number(est.total)).toBe(2000);
    newEstId = est.id;
  });

  test("GET /api/estimates/:id returns estimate with lines", async () => {
    if (!newEstId) return;
    const res = await authed(`/api/estimates/${newEstId}`);
    expect(res.status).toBe(200);
    const est = await res.json();
    expect(est.lines.length).toBe(2);
  });

  test("POST /api/estimates/:id/send transitions DRAFT -> SENT", async () => {
    if (!newEstId) return;
    const res = await authed(`/api/estimates/${newEstId}/send`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.publicToken).toBeTruthy();
  });

  test("POST /api/estimates/:id/accept transitions SENT -> ACCEPTED", async () => {
    if (!newEstId) return;
    const res = await authed(`/api/estimates/${newEstId}/accept`, { method: "POST" });
    expect(res.status).toBe(200);
  });

  test("cannot send already-sent estimate", async () => {
    if (!newEstId) return;
    const res = await authed(`/api/estimates/${newEstId}/send`, { method: "POST" });
    expect(res.status).toBe(400);
  });

  test("public estimate endpoint works", async () => {
    const allEst = await (await authed("/api/estimates")).json();
    const sent = allEst.find((e: any) => e.publicToken);
    if (!sent) return;
    const res = await fetch(`${BASE}/api/public/estimates/${sent.publicToken}`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.number).toBe(sent.number);
    expect(data.lines).toBeTruthy();
  });

  test("POST /api/estimates/:id/convert-to-invoice creates invoice from accepted estimate", async () => {
    if (!newEstId) return;
    const res = await authed(`/api/estimates/${newEstId}/convert-to-invoice`, { method: "POST" });
    expect(res.status).toBe(201);
    const invoice = await res.json();
    expect(invoice.status).toBe("DRAFT");
    expect(Number(invoice.subtotal)).toBe(2000);
    expect(invoice.lines.length).toBe(2);
  });

  test("convert-to-invoice fails for non-ACCEPTED estimate", async () => {
    const allEst = await (await authed("/api/estimates")).json();
    const draft = allEst.find((e: any) => e.status === "DRAFT");
    if (!draft) return;
    const res = await authed(`/api/estimates/${draft.id}/convert-to-invoice`, { method: "POST" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/ACCEPTED/);
  });
});

describe("Org Settings", () => {
  test("GET /api/org/settings returns org", async () => {
    const res = await authed("/api/org/settings");
    expect(res.status).toBe(200);
    const org = await res.json();
    expect(org.name).toBeTruthy();
  });

  test("PATCH /api/org/settings updates settings", async () => {
    const res = await authed("/api/org/settings", {
      method: "PATCH",
      body: JSON.stringify({
        invoicePrefix: "CW-INV-",
        estimatePrefix: "CW-EST-",
        defaultPaymentTermsDays: 45,
        defaultTaxRate: 6.5,
        address: "123 Cherry St",
        phone: "(616) 555-0100",
        email: "admin@cherrystconsulting.com",
        website: "https://cherrystconsulting.com",
      }),
    });
    expect(res.status).toBe(200);
    const org = await res.json();
    expect(org.invoicePrefix).toBe("CW-INV-");
    expect(org.estimatePrefix).toBe("CW-EST-");
    expect(org.defaultPaymentTermsDays).toBe(45);
    expect(Number(org.defaultTaxRate)).toBeCloseTo(6.5);
    expect(org.address).toBe("123 Cherry St");
    expect(org.phone).toBe("(616) 555-0100");
  });

  test("settings persist after re-fetch", async () => {
    const res = await authed("/api/org/settings");
    const org = await res.json();
    expect(org.invoicePrefix).toBe("CW-INV-");
    expect(org.website).toBe("https://cherrystconsulting.com");
  });
});
