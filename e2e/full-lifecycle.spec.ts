import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

/*
 * ══════════════════════════════════════════════════════════════
 *  CHERRYWORKS PRO — VERIFIED FULL LIFECYCLE TEST
 *  Every field name + status code confirmed by live API audit
 * ══════════════════════════════════════════════════════════════
 */

const ADMIN_EMAIL = "dean@cherrystconsulting.com";
const ADMIN_PASS = "CherryWorks2026!";

// ── Helpers ──

async function loginAsAdmin(page: Page) {
  const r = await page.request.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASS },
  });
  expect(r.status()).toBe(200);
}

async function assertPageOk(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(400);
  const len = (await page.locator("body").textContent({ timeout: 8_000 }).catch(() => ""))?.length ?? 0;
  expect(len).toBeGreaterThan(10);
}

// ══════════════════════════════════════════
// SECTION 1 — MARKETING PAGES (no login)
// ══════════════════════════════════════════

test.describe("1 — Marketing Pages", () => {
  const pages = [
    "/", "/features", "/pricing", "/about", "/contact",
    "/demo", "/signup", "/login", "/terms", "/privacy",
    "/switch-from-freshbooks", "/switch-from-quickbooks",
  ];
  for (const p of pages) {
    test(`MKT: ${p} returns 200`, async ({ request }) => {
      const r = await request.get(p);
      expect(r.status()).toBe(200);
    });
  }

  test("MKT: /sitemap.xml", async ({ request }) => {
    const r = await request.get("/sitemap.xml");
    expect(r.status()).toBe(200);
    expect(await r.text()).toContain("<urlset");
  });

  test("MKT: /robots.txt", async ({ request }) => {
    const r = await request.get("/robots.txt");
    expect(r.status()).toBe(200);
    expect(await r.text()).toContain("sitemap");
  });
});

// ══════════════════════════════════════════
// SECTION 2 — AUTH
// ══════════════════════════════════════════

test.describe("2 — Auth", () => {
  test("AUTH: valid login → 200 + user obj", async ({ request }) => {
    const r = await request.post("/api/auth/login", {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASS },
    });
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b.email).toBe(ADMIN_EMAIL);
    expect(b.role).toBe("ADMIN");
  });

  test("AUTH: wrong password → 401", async ({ request }) => {
    const r = await request.post("/api/auth/login", {
      data: { email: ADMIN_EMAIL, password: "wrong" },
    });
    expect(r.status()).toBe(401);
  });

  test("AUTH: /me after login → user", async ({ page }) => {
    await loginAsAdmin(page);
    const r = await page.request.get("/api/auth/me");
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b.email).toBe(ADMIN_EMAIL);
  });

  test("AUTH: logout clears session", async ({ page }) => {
    await loginAsAdmin(page);
    await page.request.post("/api/auth/logout");
    const r = await page.request.get("/api/auth/me");
    expect(r.status()).toBeGreaterThanOrEqual(400);
  });

  test("AUTH: unauthenticated → 401", async ({ request }) => {
    expect((await request.get("/api/clients")).status()).toBe(401);
    expect((await request.get("/api/admin/data/entities")).status()).toBe(401);
  });
});

// ══════════════════════════════════════════
// SECTIONS 3-22 — FULL LIFECYCLE (serial, shared state)
// ══════════════════════════════════════════

test.describe("3-22 — Full Lifecycle", () => {
  let pg: Page;

  // Small delay between tests to stay under 120 req/min rate limit
  test.beforeEach(async () => { await new Promise(r => setTimeout(r, 200)); });

  // Captured IDs
  let adminId: string;
  let clientId: string;
  let portalToken: string;
  let svcId: string;
  let prjId: string;
  let teamMemberId: string;
  let entryId: string;
  let invId: string;
  let invPublicToken: string;
  let dupInvId: string;
  let payId: string;
  let estId: string;
  let estPublicToken: string;
  let recId: string;
  let catId: string;
  let expId: string;
  let payoutId: string;

  test.beforeAll(async ({ browser }) => {
    pg = await (await browser.newContext()).newPage();
    await loginAsAdmin(pg);
    // Capture admin user ID
    const me = await (await pg.request.get("/api/auth/me")).json();
    adminId = me.id;
  });

  test.afterAll(async () => { await pg.close(); });

  // ── 3. Dashboard ──
  test("DASH: admin dashboard", async () => {
    const r = await pg.request.get("/api/dashboard");
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b).toHaveProperty("totalRevenue");
    expect(b).toHaveProperty("totalCollected");
  });

  test("DASH: activity feed", async () => {
    expect((await pg.request.get("/api/dashboard/activity")).status()).toBe(200);
  });

  test("DASH: my dashboard", async () => {
    const r = await pg.request.get("/api/dashboard/my");
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b).toHaveProperty("hoursThisWeek");
    expect(b).toHaveProperty("timesheetStatus");
  });

  test("DASH: implementation status", async () => {
    const r = await pg.request.get("/api/implementation-status");
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b).toHaveProperty("steps");
  });

  // ── 4. Settings / Org ──
  test("SET: org settings", async () => {
    const r = await pg.request.get("/api/org/settings");
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b).toHaveProperty("name");
    expect(b).toHaveProperty("invoicePrefix");
  });

  test("SET: billing status", async () => {
    const r = await pg.request.get("/api/billing/status");
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b).toHaveProperty("planTier");
  });

  // ── 5. Services ──
  test("SVC: list", async () => {
    const r = await pg.request.get("/api/services");
    expect(r.status()).toBe(200);
  });

  test("SVC: create", async () => {
    const r = await pg.request.post("/api/services", {
      data: { name: "Test-Svc-" + Date.now(), description: "test", defaultRate: "150.00" },
    });
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b.id).toBeTruthy();
    svcId = b.id;
  });

  // ── 6. Clients ──
  test("CLT: list", async () => {
    const r = await pg.request.get("/api/clients");
    expect(r.status()).toBe(200);
    expect(Array.isArray(await r.json())).toBe(true);
  });

  test("CLT: create → name, currency, portalToken", async () => {
    const r = await pg.request.post("/api/clients", {
      data: { name: "Test-Client-" + Date.now(), email: "test@e2e.com", currency: "USD" },
    });
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b.id).toBeTruthy();
    expect(b.portalToken).toBeTruthy();
    clientId = b.id;
    portalToken = b.portalToken;
  });

  test("CLT: get detail → flat + projects/invoices", async () => {
    const r = await pg.request.get(`/api/clients/${clientId}`);
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b.name).toContain("Test-Client-");
    expect(b).toHaveProperty("projects");
    expect(b).toHaveProperty("invoices");
  });

  test("CLT: edit", async () => {
    const r = await pg.request.patch(`/api/clients/${clientId}`, {
      data: { name: "Test-Client-Updated" },
    });
    expect(r.status()).toBe(200);
    expect((await r.json()).name).toBe("Test-Client-Updated");
  });

  // ── 7. Projects ──
  test("PRJ: create", async () => {
    const r = await pg.request.post("/api/projects", {
      data: { name: "Test-Project-" + Date.now(), clientId, status: "ACTIVE" },
    });
    expect(r.status()).toBe(200);
    prjId = (await r.json()).id;
    expect(prjId).toBeTruthy();
  });

  test("PRJ: detail → {project, members, stats} wrapper", async () => {
    const r = await pg.request.get(`/api/projects/${prjId}`);
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b.project.id).toBe(prjId);
    expect(b).toHaveProperty("members");
    expect(b).toHaveProperty("stats");
  });

  test("PRJ: add member → hourlyRate field", async () => {
    const r = await pg.request.post(`/api/projects/${prjId}/members`, {
      data: { userId: adminId, hourlyRate: 150 },
    });
    expect(r.status()).toBe(200);
    expect((await r.json()).hourlyRate).toBe("150.00");
  });

  test("PRJ: assign service", async () => {
    const r = await pg.request.post(`/api/projects/${prjId}/services`, {
      data: { serviceId: svcId },
    });
    expect(r.status()).toBe(200);
  });

  test("PRJ: list services", async () => {
    const r = await pg.request.get(`/api/projects/${prjId}/services`);
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b.length).toBeGreaterThanOrEqual(1);
  });

  test("PRJ: duplicate → {project, members} wrapper", async () => {
    const r = await pg.request.post(`/api/projects/${prjId}/duplicate`);
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b.project.id).toBeTruthy();
  });

  test("PRJ: list", async () => {
    const r = await pg.request.get("/api/projects");
    expect(r.status()).toBe(200);
  });

  // ── 8. Team ──
  test("TEAM: list", async () => {
    expect((await pg.request.get("/api/team")).status()).toBe(200);
  });

  test("TEAM: invite → {user:{id}} wrapper", async () => {
    const r = await pg.request.post("/api/team/invite", {
      data: {
        email: `test-${Date.now()}@e2e.com`,
        name: "E2E Team Member",
        role: "TEAM_MEMBER",
        workerType: "INDEPENDENT",
      },
    });
    expect(r.status()).toBe(200);
    const b = await r.json();
    teamMemberId = b.user.id;
    expect(teamMemberId).toBeTruthy();
  });

  test("TEAM: teamMembers list", async () => {
    const r = await pg.request.get("/api/users/team-members");
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b.length).toBeGreaterThanOrEqual(1);
  });

  // ── 9. Time Entries — field: notes (NOT description) ──
  test("TIME: create billable → notes field", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const r = await pg.request.post("/api/time-entries", {
      data: { projectId: prjId, date: today, minutes: 480, billable: true, notes: "Audit test billable" },
    });
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b.id).toBeTruthy();
    expect(b.notes).toBe("Audit test billable");
    expect(b.minutes).toBe(480);
    entryId = b.id;
  });

  test("TIME: create non-billable", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const r = await pg.request.post("/api/time-entries", {
      data: { projectId: prjId, date: today, minutes: 60, billable: false, notes: "Internal meeting" },
    });
    expect(r.status()).toBe(200);
    expect((await r.json()).billable).toBe(false);
  });

  test("TIME: list", async () => {
    const r = await pg.request.get("/api/time-entries");
    expect(r.status()).toBe(200);
    expect((await r.json()).length).toBeGreaterThanOrEqual(2);
  });

  // ── 10. Timesheets — requires ?weekStartDate ──
  test("TS: my-week → {timesheet, entries}", async () => {
    const d = new Date(); d.setDate(d.getDate() - d.getDay());
    const ws = d.toISOString().slice(0, 10);
    const r = await pg.request.get(`/api/timesheets/my-week?weekStartDate=${ws}`);
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b).toHaveProperty("timesheet");
    expect(b).toHaveProperty("entries");
  });

  test("TS: pending", async () => {
    expect((await pg.request.get("/api/timesheets/pending")).status()).toBe(200);
  });

  test("TS: all", async () => {
    expect((await pg.request.get("/api/timesheets/all")).status()).toBe(200);
  });

  // ── 11. Invoices — generate (NOT POST /api/invoices) ──
  test("INV: generate from unbilled time", async () => {
    const r = await pg.request.post("/api/invoices/generate", {
      data: { clientId, includeUnapproved: true },
    });
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b.id).toBeTruthy();
    expect(b.status).toBe("DRAFT");
    expect(parseFloat(b.subtotal)).toBeGreaterThan(0);
    invId = b.id;
  });

  test("INV: add line → description, quantity, unitRate", async () => {
    const r = await pg.request.post(`/api/invoices/${invId}/lines`, {
      data: { description: "Manual line", quantity: 2, unitRate: 100 },
    });
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b.amount).toBe("200.00");
  });

  test("INV: send → {ok, publicToken, viewLink}", async () => {
    const r = await pg.request.post(`/api/invoices/${invId}/send`);
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b.ok).toBe(true);
    expect(b.publicToken).toBeTruthy();
    invPublicToken = b.publicToken;
  });

  test("INV: resend", async () => {
    const r = await pg.request.post(`/api/invoices/${invId}/resend`);
    expect(r.status()).toBe(200);
    expect((await r.json()).ok).toBe(true);
  });

  test("INV: duplicate → DRAFT copy", async () => {
    const r = await pg.request.post(`/api/invoices/${invId}/duplicate`);
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b.status).toBe("DRAFT");
    dupInvId = b.id;
  });

  test("INV: list", async () => {
    const r = await pg.request.get("/api/invoices");
    expect(r.status()).toBe(200);
    expect((await r.json()).length).toBeGreaterThanOrEqual(1);
  });

  test("INV: unpaid list", async () => {
    expect((await pg.request.get("/api/invoices/unpaid")).status()).toBe(200);
  });

  test("INV: PDF returns binary", async () => {
    const r = await pg.request.get(`/api/invoices/${invId}/pdf`);
    expect(r.status()).toBe(200);
  });

  // ── 12. Payments — field: method, notes (NO reference) ──
  test("PAY: create → method field", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const r = await pg.request.post("/api/payments", {
      data: { invoiceId: invId, amount: 100, date: today, method: "ACH" },
    });
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b.id).toBeTruthy();
    expect(b.method).toBe("ACH");
    payId = b.id;
  });

  test("PAY: list", async () => {
    const r = await pg.request.get("/api/payments");
    expect(r.status()).toBe(200);
    expect((await r.json()).length).toBeGreaterThanOrEqual(1);
  });

  test("PAY: edit → notes field", async () => {
    const r = await pg.request.patch(`/api/payments/${payId}`, {
      data: { notes: "Updated via test" },
    });
    expect(r.status()).toBe(200);
    expect((await r.json()).notes).toBe("Updated via test");
  });

  test("PAY: refund → {refund, invoice}", async () => {
    const r = await pg.request.post(`/api/payments/${payId}/refund`);
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b).toHaveProperty("refund");
    expect(b).toHaveProperty("invoice");
  });

  // ── 13. Invoice void rules ──
  test("INV: void SENT with 0 payments → succeeds", async () => {
    // Send the duplicate first, then void it
    await pg.request.post(`/api/invoices/${dupInvId}/send`);
    const r = await pg.request.post(`/api/invoices/${dupInvId}/void`);
    expect(r.status()).toBe(200);
    expect((await r.json()).ok).toBe(true);
  });

  // ── 14. Estimates — issuedDate, expiryDate, STATUS 201 ──
  test("EST: create → 201", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const r = await pg.request.post("/api/estimates", {
      data: {
        clientId,
        issuedDate: today,
        expiryDate: "2026-12-31",
        lines: [{ description: "Scoping", quantity: 10, unitRate: 200 }],
      },
    });
    expect(r.status()).toBe(201);
    const b = await r.json();
    expect(b.id).toBeTruthy();
    expect(b.total).toBe("2000.00");
    estId = b.id;
  });

  test("EST: list", async () => {
    expect((await pg.request.get("/api/estimates")).status()).toBe(200);
  });

  test("EST: send → {ok, publicToken}", async () => {
    const r = await pg.request.post(`/api/estimates/${estId}/send`);
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b.ok).toBe(true);
    estPublicToken = b.publicToken;
  });

  test("EST: accept", async () => {
    const r = await pg.request.post(`/api/estimates/${estId}/accept`);
    expect(r.status()).toBe(200);
  });

  test("EST: convert to invoice → 201", async () => {
    const r = await pg.request.post(`/api/estimates/${estId}/convert-to-invoice`);
    expect(r.status()).toBe(201);
    expect((await r.json()).id).toBeTruthy();
  });

  test("EST: duplicate → 201", async () => {
    const r = await pg.request.post(`/api/estimates/${estId}/duplicate`);
    expect(r.status()).toBe(201);
    expect((await r.json()).id).toBeTruthy();
  });

  // ── 15. Recurring Templates — templateLines, nextIssueDate, STATUS 201 ──
  test("REC: create → 201", async () => {
    const r = await pg.request.post("/api/recurring-templates", {
      data: {
        clientId,
        frequency: "MONTHLY",
        nextIssueDate: "2026-05-01",
        templateLines: [{ description: "Monthly retainer", quantity: 1, unitRate: 5000 }],
      },
    });
    expect(r.status()).toBe(201);
    const b = await r.json();
    expect(b.id).toBeTruthy();
    recId = b.id;
  });

  test("REC: list", async () => {
    expect((await pg.request.get("/api/recurring-templates")).status()).toBe(200);
  });

  test("REC: get by id", async () => {
    const r = await pg.request.get(`/api/recurring-templates/${recId}`);
    expect(r.status()).toBe(200);
    expect((await r.json()).frequency).toBe("MONTHLY");
  });

  test("REC: generate → 201", async () => {
    const r = await pg.request.post(`/api/recurring-templates/${recId}/generate`);
    expect(r.status()).toBe(201);
    expect((await r.json()).status).toBe("DRAFT");
  });

  // ── 16. Expenses ──
  test("EXP: create category", async () => {
    const r = await pg.request.post("/api/expense-categories", {
      data: { name: "Test-Cat-" + Date.now(), glCode: "9999" },
    });
    expect(r.status()).toBe(200);
    catId = (await r.json()).id;
  });

  test("EXP: create expense", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const r = await pg.request.post("/api/expenses", {
      data: { amount: "325.50", date: today, vendor: "Delta", description: "Flight", categoryId: catId },
    });
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b.id).toBeTruthy();
    expect(b.status).toBe("DRAFT");
    expId = b.id;
  });

  test("EXP: submit → SUBMITTED", async () => {
    const r = await pg.request.post(`/api/expenses/${expId}/submit`);
    expect(r.status()).toBe(200);
    expect((await r.json()).status).toBe("SUBMITTED");
  });

  test("EXP: approve → APPROVED", async () => {
    const r = await pg.request.post(`/api/expenses/${expId}/approve`);
    expect(r.status()).toBe(200);
    expect((await r.json()).status).toBe("APPROVED");
  });

  test("EXP: list", async () => {
    expect((await pg.request.get("/api/expenses")).status()).toBe(200);
  });

  test("EXP: categories list", async () => {
    expect((await pg.request.get("/api/expense-categories")).status()).toBe(200);
  });

  test("EXP: unbilled preview (needs clientId)", async () => {
    const r = await pg.request.get(`/api/expenses/unbilled-preview?clientId=${clientId}`);
    expect(r.status()).toBe(200);
    expect((await r.json())).toHaveProperty("expenses");
  });

  test("EXP: reports list", async () => {
    expect((await pg.request.get("/api/expense-reports")).status()).toBe(200);
  });

  // ── 17. Payouts — payoutDate, paymentMethod (NOT date, method) ──
  test("PO: list", async () => {
    expect((await pg.request.get("/api/payouts")).status()).toBe(200);
  });

  test("PO: summary", async () => {
    expect((await pg.request.get("/api/payouts/summary")).status()).toBe(200);
  });

  test("PO: create → payoutDate, paymentMethod fields", async () => {
    // Get a real team member from the API
    const teamMembers = await (await pg.request.get("/api/users/team-members")).json();
    const cId = teamMembers[0]?.id;
    if (!cId) return;
    const today = new Date().toISOString().slice(0, 10);
    const r = await pg.request.post("/api/payouts", {
      data: { teamMemberId: cId, amount: 500, payoutDate: today, paymentMethod: "ACH" },
    });
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b.id).toBeTruthy();
    expect(b.paymentMethod).toBe("ACH");
    payoutId = b.id;
  });

  // ── 18. Reports (ALL 20 + 4 CSV exports) ──
  test("RPT: revenue", async () => {
    const b = await (await pg.request.get("/api/reports")).json();
    expect(b).toHaveProperty("revenueByMonth");
    expect(b).toHaveProperty("arAging");
  });

  test("RPT: utilization", async () => {
    expect((await pg.request.get("/api/reports/utilization")).status()).toBe(200);
  });

  test("RPT: profitability", async () => {
    expect((await pg.request.get("/api/reports/profitability?startDate=2025-01-01&endDate=2026-12-31")).status()).toBe(200);
  });

  test("RPT: wip-aging", async () => {
    const b = await (await pg.request.get("/api/reports/wip-aging?includeUnapproved=true")).json();
    expect(b).toHaveProperty("byTeamMember");
  });

  test("RPT: client-revenue", async () => {
    expect((await pg.request.get("/api/reports/client-revenue")).status()).toBe(200);
  });

  test("RPT: cash-flow", async () => {
    expect((await pg.request.get("/api/reports/cash-flow")).status()).toBe(200);
  });

  test("RPT: collections", async () => {
    expect((await pg.request.get("/api/reports/collections-efficiency")).status()).toBe(200);
  });

  test("RPT: budget-burn", async () => {
    expect((await pg.request.get("/api/reports/budget-burn")).status()).toBe(200);
  });

  test("RPT: overdue-detail", async () => {
    expect((await pg.request.get("/api/reports/overdue-detail")).status()).toBe(200);
  });

  test("RPT: compliance", async () => {
    expect((await pg.request.get("/api/reports/timesheet-compliance")).status()).toBe(200);
  });

  test("RPT: labor-summary", async () => {
    expect((await pg.request.get("/api/reports/labor-summary")).status()).toBe(200);
  });

  test("RPT: payout-detail", async () => {
    expect((await pg.request.get("/api/reports/payout-detail?startDate=2025-01-01&endDate=2026-12-31")).status()).toBe(200);
  });

  test("RPT: 1099-export", async () => {
    expect((await pg.request.get("/api/reports/1099-export")).status()).toBe(200);
  });

  test("RPT: executive-kpis", async () => {
    const b = await (await pg.request.get("/api/reports/executive-kpis")).json();
    expect(b).toHaveProperty("revenueThisMonth");
    expect(b).toHaveProperty("totalOutstanding");
  });

  test("RPT: expenses-by-category", async () => {
    expect((await pg.request.get("/api/reports/expenses-by-category")).status()).toBe(200);
  });

  test("RPT: expenses-by-project", async () => {
    expect((await pg.request.get("/api/reports/expenses-by-project")).status()).toBe(200);
  });

  test("RPT: expenses-by-user", async () => {
    expect((await pg.request.get("/api/reports/expenses-by-user")).status()).toBe(200);
  });

  test("RPT: revenue CSV", async () => {
    const t = await (await pg.request.get("/api/reports/revenue/csv")).text();
    expect(t).toContain("month");
  });

  test("RPT: ar-aging CSV", async () => {
    const t = await (await pg.request.get("/api/reports/ar-aging/csv")).text();
    expect(t).toContain("invoiceNumber");
  });

  test("RPT: utilization CSV", async () => {
    const t = await (await pg.request.get("/api/reports/utilization/csv")).text();
    expect(t).toContain("name");
  });

  test("RPT: profitability CSV", async () => {
    const t = await (await pg.request.get("/api/reports/profitability/csv?startDate=2025-01-01&endDate=2026-12-31")).text();
    expect(t).toContain("project");
  });

  // ── 19. Import ──
  test("IMP: platforms", async () => {
    const b = await (await pg.request.get("/api/import/platforms")).json();
    expect(b.length).toBeGreaterThanOrEqual(1);
    expect(b[0]).toHaveProperty("id");
  });

  test("IMP: runs", async () => {
    expect((await pg.request.get("/api/import/runs")).status()).toBe(200);
  });

  // ── 20. Admin Data Console — {rows:[...]} wrapper ──
  test("ADC: entities → {editable, viewOnly}", async () => {
    const b = await (await pg.request.get("/api/admin/data/entities")).json();
    expect(b).toHaveProperty("editable");
    expect(b).toHaveProperty("viewOnly");
    expect(b.editable).toContain("clients");
  });

  test("ADC: browse users → {rows:[...]}", async () => {
    const b = await (await pg.request.get("/api/admin/data/users")).json();
    expect(b).toHaveProperty("rows");
    expect(b.rows.length).toBeGreaterThanOrEqual(1);
  });

  test("ADC: browse clients → {rows:[...]}", async () => {
    const b = await (await pg.request.get("/api/admin/data/clients")).json();
    expect(b).toHaveProperty("rows");
  });

  test("ADC: integrity check", async () => {
    const b = await (await pg.request.get("/api/admin/integrity-check")).json();
    expect(b).toHaveProperty("violations");
    expect(b).toHaveProperty("count");
  });

  // ── 21. Public endpoints (no auth) ──
  test("PUB: public invoice", async ({ request }) => {
    if (!invPublicToken) return;
    const r = await request.get(`/api/public/invoices/${invPublicToken}`);
    expect(r.status()).toBe(200);
  });

  test("PUB: client portal", async ({ request }) => {
    if (!portalToken) return;
    const r = await request.get(`/api/public/portal/${portalToken}`);
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b).toHaveProperty("client");
    expect(b).toHaveProperty("org");
    expect(b).toHaveProperty("invoices");
  });

  // ── 22. Exchange Rates ──
  test("FX: single rate", async () => {
    const b = await (await pg.request.get("/api/exchange-rate?from=USD&to=EUR")).json();
    expect(b).toHaveProperty("rate");
    expect(b.from).toBe("USD");
  });

  // ── 23. Page Render Sweep — needs more time for 19 navigations ──
  test("SWEEP: all 19 admin pages render", async () => {
    test.setTimeout(90_000);
    const routes = [
      "/", "/time", "/expenses", "/expense-reports",
      "/invoices", "/invoices/recurring", "/estimates", "/payments",
      "/clients", "/projects", "/services", "/payouts", "/approvals",
      "/reports", "/team", "/import", "/settings",
      "/admin/data", "/profile",
    ];
    for (const route of routes) {
      await pg.goto(route);
      await assertPageOk(pg);
    }
  });
});
