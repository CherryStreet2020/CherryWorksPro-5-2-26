/**
 * Multi-tenant isolation — audit §3.3 / §7 gap #1 (highest-risk untested flow).
 *
 * Supersedes the earlier read-side smoke (which only probed a non-existent
 * UUID — that proves nothing about cross-tenant isolation). This spec seeds
 * REAL entities in org A, then, authenticated as org B, attempts to read,
 * list, modify, and delete each one and asserts the security invariant:
 *   - READ/LIST: org A's data is never exposed (no 200-with-data; absent from lists).
 *   - WRITE/DELETE: org A's rows are never modified or destroyed (verified in the DB).
 *
 * The authoritative check for writes/deletes is the DB state (data intact),
 * not the HTTP status: the org-scoped storage layer makes cross-org writes
 * a 0-row no-op, but some delete routes still return a (harmless) 200 for a
 * row that isn't in the caller's org — see KNOWN-FINDING below. That is a
 * REST-semantics/defense-in-depth nit (no data is exposed or destroyed), so
 * it is recorded here rather than asserted as a security failure.
 *
 * Uses the isolatedOrg fixture (two fresh, disposable orgs) so it is
 * hermetic and parallel-safe, and seeds via the DB to keep the test focused
 * on the access invariant rather than per-entity create-payload validation.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";
import { Pool } from "pg";
import {
  createIsolatedOrg,
  deleteIsolatedOrg,
  buildIsolatedRequest,
  type IsolatedOrg,
} from "../tests/helpers/po/isolation";

const db = new Pool({ connectionString: process.env.DATABASE_URL });

async function seedClient(orgId: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO clients (org_id, name, email) VALUES ($1, $2, $3) RETURNING id`,
    [orgId, "Org A Confidential Client", "secret@org-a.test"],
  );
  return r.rows[0].id;
}
async function seedProject(orgId: string, clientId: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO projects (org_id, client_id, name, status) VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
    [orgId, clientId, "Org A Secret Project"],
  );
  return r.rows[0].id;
}
async function seedInvoice(orgId: string, clientId: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO invoices (org_id, client_id, number, status, issued_date, due_date, subtotal, total)
     VALUES ($1, $2, $3, 'SENT', CURRENT_DATE, CURRENT_DATE + 30, '4242.42', '4242.42') RETURNING id`,
    [orgId, clientId, `ORGA-${Date.now()}`],
  );
  return r.rows[0].id;
}
async function seedTimeEntry(orgId: string, projectId: string, userId: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO time_entries (org_id, project_id, user_id, date, minutes, rate, notes)
     VALUES ($1, $2, $3, CURRENT_DATE, 120, '150.00', 'Org A confidential work log') RETURNING id`,
    [orgId, projectId, userId],
  );
  return r.rows[0].id;
}

/** READ exposure is the catastrophic case: a cross-org read must never 200. */
function expectReadDenied(status: number, label: string) {
  expect(status, `${label} should be denied (401/403/404), got ${status}`).not.toBe(200);
  expect([401, 403, 404], `${label} unexpected status ${status}`).toContain(status);
}

test.describe.serial("Multi-tenant isolation (audit §7 #1)", () => {
  let orgA: IsolatedOrg;
  let orgB: IsolatedOrg;
  let reqB: APIRequestContext;
  let csrfB: string;
  const id = { client: "", project: "", invoice: "", timeEntry: "" };

  test.beforeAll(async () => {
    orgA = await createIsolatedOrg();
    orgB = await createIsolatedOrg();
    id.client = await seedClient(orgA.orgId);
    id.project = await seedProject(orgA.orgId, id.client);
    id.invoice = await seedInvoice(orgA.orgId, id.client);
    id.timeEntry = await seedTimeEntry(orgA.orgId, id.project, orgA.userId);
    const b = await buildIsolatedRequest(orgB);
    reqB = b.request;
    csrfB = b.csrf;
  });

  test.afterAll(async () => {
    await reqB?.dispose();
    if (orgA) await deleteIsolatedOrg(orgA.orgId).catch(() => undefined);
    if (orgB) await deleteIsolatedOrg(orgB.orgId).catch(() => undefined);
    await db.end().catch(() => undefined);
  });

  const csrf = () => ({ "X-CSRF-Token": csrfB });

  test("clients: org B cannot read, list, modify, or delete org A's client", async () => {
    expectReadDenied((await reqB.get(`/api/clients/${id.client}`)).status(), "GET /api/clients/:id");

    const list = await reqB.get(`/api/clients`);
    if (list.status() === 200) {
      const arr = await list.json();
      expect(Array.isArray(arr) ? arr.some((c: any) => c.id === id.client) : false,
        "org A client must not appear in org B's client list").toBe(false);
    }

    await reqB.patch(`/api/clients/${id.client}`, { headers: csrf(), data: { name: "HACKED BY ORG B" } });
    await reqB.delete(`/api/clients/${id.client}`, { headers: csrf() });

    // Authoritative: org A's client is intact + unchanged regardless of status.
    const row = await db.query<{ name: string }>(`SELECT name FROM clients WHERE id=$1 AND org_id=$2`, [id.client, orgA.orgId]);
    expect(row.rowCount, "org A client must still exist after org B's write/delete").toBe(1);
    expect(row.rows[0].name, "org A client name must be unchanged").toBe("Org A Confidential Client");
  });

  test("projects: org B cannot read, list, modify, or delete org A's project", async () => {
    expectReadDenied((await reqB.get(`/api/projects/${id.project}`)).status(), "GET /api/projects/:id");

    const list = await reqB.get(`/api/projects`);
    if (list.status() === 200) {
      const arr = await list.json();
      expect(Array.isArray(arr) ? arr.some((p: any) => p.id === id.project) : false,
        "org A project must not appear in org B's project list").toBe(false);
    }

    await reqB.patch(`/api/projects/${id.project}`, { headers: csrf(), data: { name: "HACKED" } });
    await reqB.delete(`/api/projects/${id.project}`, { headers: csrf() });

    const row = await db.query<{ name: string }>(`SELECT name FROM projects WHERE id=$1 AND org_id=$2`, [id.project, orgA.orgId]);
    expect(row.rowCount, "org A project must still exist").toBe(1);
    expect(row.rows[0].name, "org A project name must be unchanged").toBe("Org A Secret Project");
  });

  test("invoices: org B cannot read, list, or delete org A's invoice", async () => {
    expectReadDenied((await reqB.get(`/api/invoices/${id.invoice}`)).status(), "GET /api/invoices/:id");

    const list = await reqB.get(`/api/invoices`);
    if (list.status() === 200) {
      const arr = await list.json();
      expect(Array.isArray(arr) ? arr.some((i: any) => i.id === id.invoice) : false,
        "org A invoice must not appear in org B's invoice list").toBe(false);
    }

    await reqB.delete(`/api/invoices/${id.invoice}`, { headers: csrf() });

    const row = await db.query(`SELECT 1 FROM invoices WHERE id=$1 AND org_id=$2`, [id.invoice, orgA.orgId]);
    expect(row.rowCount, "org A invoice must still exist after org B's delete").toBe(1);
  });

  test("time entries: org B cannot list, modify, or delete org A's time entry", async () => {
    const list = await reqB.get(`/api/time-entries`);
    if (list.status() === 200) {
      const arr = await list.json();
      expect(Array.isArray(arr) ? arr.some((t: any) => t.id === id.timeEntry) : false,
        "org A time entry must not appear in org B's list").toBe(false);
    }

    await reqB.patch(`/api/time-entries/${id.timeEntry}`, { headers: csrf(), data: { minutes: 1 } });
    await reqB.delete(`/api/time-entries/${id.timeEntry}`, { headers: csrf() });

    const row = await db.query<{ minutes: number }>(`SELECT minutes FROM time_entries WHERE id=$1 AND org_id=$2`, [id.timeEntry, orgA.orgId]);
    expect(row.rowCount, "org A time entry must still exist").toBe(1);
    expect(Number(row.rows[0].minutes), "org A time entry must be unchanged").toBe(120);
  });

  /**
   * KNOWN-FINDING (defense-in-depth nit, NOT a security failure): some delete
   * routes return a no-op 200 when the target row isn't in the caller's org,
   * instead of 404 like the GET/PATCH paths do. No data is exposed or
   * destroyed (the org-scoped WHERE makes it a 0-row delete), so this is
   * recorded, not failed. If/when the routes are hardened to 404, tighten
   * this to expect 404.
   */
  test("cross-org DELETE is a harmless no-op (documents the 200-vs-404 nit)", async () => {
    const c2 = await seedClient(orgA.orgId);
    const status = (await reqB.delete(`/api/clients/${c2}`, { headers: csrf() })).status();
    const row = await db.query(`SELECT 1 FROM clients WHERE id=$1 AND org_id=$2`, [c2, orgA.orgId]);
    expect(row.rowCount, "org A client must survive a cross-org delete attempt").toBe(1);
    // Document current behavior without making it a hard security failure:
    expect([200, 401, 403, 404], `cross-org DELETE status ${status}`).toContain(status);
    await db.query(`DELETE FROM clients WHERE id=$1`, [c2]);
  });
});
