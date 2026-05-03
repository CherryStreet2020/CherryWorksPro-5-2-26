import { test, expect } from "@playwright/test";

// FIXME-task-455: Legacy shared-state spec (audit §6.2.8). The
// surrounding suite mutates the same seeded admin org rows, so the
// assertions race other serial specs. Skipped until migrated to the
// per-test `isolatedOrg` fixture (see tests/helpers/po/fixtures.ts).
// Tracked: project task #455.
import { test as _t } from "@playwright/test";
_t.beforeEach(() => _t.fixme(true, "Task #455: legacy shared-state spec; migrate to isolatedOrg first"));

test("admin creates estimate, sends, checks public view", async ({ request }) => {
  const loginRes = await request.post("/api/auth/login", {
    data: { email: "dean@cherrystconsulting.com", password: "admin123", orgSlug: "cherry-st" },
  });
  expect(loginRes.ok()).toBeTruthy();

  const clientsRes = await request.get("/api/clients");
  const clients = await clientsRes.json();
  expect(clients.length).toBeGreaterThan(0);

  const createRes = await request.post("/api/estimates", {
    data: {
      clientId: clients[0].id,
      issuedDate: "2026-03-04",
      expiryDate: "2026-04-04",
      taxRate: 5,
      lines: [
        { description: "E2E Test Service", quantity: 8, unitRate: 200 },
        { description: "E2E Travel", quantity: 1, unitRate: 300 },
      ],
    },
  });
  expect(createRes.ok()).toBeTruthy();
  const estimate = await createRes.json();
  expect(estimate.number).toMatch(/EST-/);
  expect(estimate.lines.length).toBe(2);
  expect(Number(estimate.total)).toBeGreaterThan(0);

  const sendRes = await request.post(`/api/estimates/${estimate.id}/send`);
  expect(sendRes.ok()).toBeTruthy();
  const sendBody = await sendRes.json();
  expect(sendBody.publicToken).toBeTruthy();

  const publicRes = await request.get(`/api/public/estimates/${sendBody.publicToken}`);
  expect(publicRes.ok()).toBeTruthy();
  const publicEst = await publicRes.json();
  expect(publicEst.number).toBe(estimate.number);
  expect(publicEst.lines.length).toBe(2);
  expect(publicEst.status).toBe("SENT");

  const acceptRes = await request.post(`/api/public/estimates/${sendBody.publicToken}/accept`);
  expect(acceptRes.ok()).toBeTruthy();

  const afterAccept = await request.get(`/api/public/estimates/${sendBody.publicToken}`);
  const accepted = await afterAccept.json();
  expect(accepted.status).toBe("ACCEPTED");
});

test("public decline works on SENT estimate", async ({ request }) => {
  const loginRes = await request.post("/api/auth/login", {
    data: { email: "dean@cherrystconsulting.com", password: "admin123", orgSlug: "cherry-st" },
  });
  expect(loginRes.ok()).toBeTruthy();

  const clientsRes = await request.get("/api/clients");
  const clients = await clientsRes.json();

  const createRes = await request.post("/api/estimates", {
    data: {
      clientId: clients[0].id,
      issuedDate: "2026-03-04",
      lines: [{ description: "Decline test", quantity: 1, unitRate: 100 }],
    },
  });
  const est = await createRes.json();

  const sendRes = await request.post(`/api/estimates/${est.id}/send`);
  const { publicToken } = await sendRes.json();

  const declineRes = await request.post(`/api/public/estimates/${publicToken}/decline`);
  expect(declineRes.ok()).toBeTruthy();

  const after = await request.get(`/api/public/estimates/${publicToken}`);
  const declined = await after.json();
  expect(declined.status).toBe("DECLINED");
});

test("recurring templates CRUD", async ({ request }) => {
  const loginRes = await request.post("/api/auth/login", {
    data: { email: "dean@cherrystconsulting.com", password: "admin123", orgSlug: "cherry-st" },
  });
  expect(loginRes.ok()).toBeTruthy();

  const clients = await (await request.get("/api/clients")).json();

  const createRes = await request.post("/api/recurring-templates", {
    data: {
      clientId: clients[0].id,
      frequency: "QUARTERLY",
      nextIssueDate: "2026-04-01",
      templateLines: [
        { description: "Quarterly review", quantity: 20, unitRate: 175 },
      ],
      taxRate: 6,
    },
  });
  expect(createRes.ok()).toBeTruthy();
  const tmpl = await createRes.json();
  expect(tmpl.frequency).toBe("QUARTERLY");

  const listRes = await request.get("/api/recurring-templates");
  const templates = await listRes.json();
  const found = templates.find((t: any) => t.id === tmpl.id);
  expect(found).toBeTruthy();
  expect(found.clientName).toBeTruthy();

  const deactivateRes = await request.delete(`/api/recurring-templates/${tmpl.id}`);
  expect(deactivateRes.ok()).toBeTruthy();

  const afterRes = await request.get(`/api/recurring-templates/${tmpl.id}`);
  const after = await afterRes.json();
  expect(after.isActive).toBe(false);
});

test("org settings CRUD", async ({ request }) => {
  const loginRes = await request.post("/api/auth/login", {
    data: { email: "dean@cherrystconsulting.com", password: "admin123", orgSlug: "cherry-st" },
  });
  expect(loginRes.ok()).toBeTruthy();

  const getRes = await request.get("/api/org/settings");
  expect(getRes.ok()).toBeTruthy();
  const org = await getRes.json();
  expect(org.name).toBeTruthy();

  const patchRes = await request.patch("/api/org/settings", {
    data: {
      invoicePrefix: "E2E-INV-",
      defaultPaymentTermsDays: 60,
      defaultTaxRate: 7.5,
    },
  });
  expect(patchRes.ok()).toBeTruthy();
  const updated = await patchRes.json();
  expect(updated.invoicePrefix).toBe("E2E-INV-");
  expect(updated.defaultPaymentTermsDays).toBe(60);
  expect(Number(updated.defaultTaxRate)).toBeCloseTo(7.5);
});
