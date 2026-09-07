import { describe, it, expect, afterAll } from "vitest";
import { TEST_BASE as BASE } from "../helpers/base";

interface Ctx { cookie: string; csrfToken: string }
let admin: Ctx = { cookie: "", csrfToken: "" };
let clientId = "";
let otherClientId = "";
let projectId = "";
let otherProjectId = "";
let caseId = "";
let caseKey = "";
let typeId = "";
const timeEntryIds: string[] = [];

async function api(method: string, path: string, ctx: Ctx, body?: any) {
  const opts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json", Cookie: ctx.cookie, "X-CSRF-Token": ctx.csrfToken },
  };
  if (body) opts.body = JSON.stringify(body);
  return fetch(`${BASE}${path}`, opts);
}

async function login(email: string, password: string): Promise<Ctx> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const cookies = res.headers.getSetCookie?.() ?? [];
  return {
    cookie: cookies.map((c: string) => c.split(";")[0]).join("; "),
    csrfToken: res.headers.get("x-csrf-token") || "",
  };
}

describe("support cases: keys, lifecycle, messages, and hours", () => {
  it("setup: two clients with a project each", async () => {
    admin = await login("admin.test@cwpro.dev", "admin123");
    const c1 = await api("POST", "/api/clients", admin, { name: `ABS Machining, Inc ${Date.now()}` });
    expect(c1.ok).toBe(true);
    clientId = (await c1.json()).id;
    const c2 = await api("POST", "/api/clients", admin, { name: `Other Client ${Date.now()}` });
    expect(c2.ok).toBe(true);
    otherClientId = (await c2.json()).id;
    const p1 = await api("POST", "/api/projects", admin, { clientId, name: "General Support", status: "ACTIVE" });
    expect(p1.ok).toBe(true);
    projectId = (await p1.json()).id;
    const p2 = await api("POST", "/api/projects", admin, { clientId: otherClientId, name: "Other Project", status: "ACTIVE" });
    expect(p2.ok).toBe(true);
    otherProjectId = (await p2.json()).id;
  });

  it("seeds the four default case types on first read", async () => {
    const res = await api("GET", "/api/support/types", admin);
    expect(res.ok).toBe(true);
    const types = await res.json();
    const names = types.map((t: any) => t.name);
    for (const n of ["ERP Support Request", "Customization Request", "Master Files", "Training Request"]) {
      expect(names).toContain(n);
    }
    typeId = types.find((t: any) => t.name === "Customization Request").id;
  });

  it("mints ABS-1 from the client name, then ABS-2", async () => {
    const res = await api("POST", "/api/support/cases", admin, {
      clientId, projectId, typeId, subject: "PO not showing in Purchase Activity", description: "See screenshot",
      requesterName: "Ronald Ndanga", requesterEmail: "ronald@example.com",
    });
    expect(res.status).toBe(201);
    const row = await res.json();
    caseId = row.id;
    caseKey = row.caseKey;
    expect(caseKey).toBe("ABS-1");
    expect(row.status).toBe("NEW");
    expect(row.priority).toBe("MEDIUM");

    const res2 = await api("POST", "/api/support/cases", admin, { clientId, subject: "Second case" });
    expect(res2.status).toBe(201);
    expect((await res2.json()).caseKey).toBe("ABS-2");
  });

  it("respects an explicit prefix and next number (Jira continuation)", async () => {
    const set = await api("PATCH", `/api/support/clients/${clientId}/settings`, admin, { caseKeyPrefix: "ABS", nextCaseNumber: 158 });
    expect(set.ok).toBe(true);
    const res = await api("POST", "/api/support/cases", admin, { clientId, subject: "Continues Jira numbering" });
    expect(res.status).toBe(201);
    expect((await res.json()).caseKey).toBe("ABS-158");
    const bad = await api("PATCH", `/api/support/clients/${clientId}/settings`, admin, { caseKeyPrefix: "abs" });
    expect(bad.status).toBe(400);
  });

  it("rejects a project that belongs to another client", async () => {
    const res = await api("POST", "/api/support/cases", admin, { clientId, projectId: otherProjectId, subject: "Wrong project" });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/does not belong/i);
  });

  it("lists the case in the open view and the summary counts it", async () => {
    const list = await api("GET", "/api/support/cases?view=open&q=ABS-1", admin);
    expect(list.ok).toBe(true);
    const rows = await list.json();
    expect(rows.some((r: any) => r.id === caseId)).toBe(true);
    const sum = await (await api("GET", "/api/support/summary", admin)).json();
    expect(sum.open).toBeGreaterThanOrEqual(3);
  });

  it("a customer-visible reply stamps first response and moves NEW → IN_PROGRESS; an internal note does not", async () => {
    const note = await api("POST", `/api/support/cases/${caseId}/messages`, admin, { body: "Checking the PO table", visibility: "INTERNAL" });
    expect(note.status).toBe(201);
    let d = await (await api("GET", `/api/support/cases/${caseId}`, admin)).json();
    expect(d.status).toBe("NEW");
    expect(d.firstResponseAt).toBeNull();

    const reply = await api("POST", `/api/support/cases/${caseId}/messages`, admin, { body: "We found it, fix coming today.", visibility: "CUSTOMER" });
    expect(reply.status).toBe(201);
    d = await (await api("GET", `/api/support/cases/${caseId}`, admin)).json();
    expect(d.status).toBe("IN_PROGRESS");
    expect(d.firstResponseAt).not.toBeNull();
    expect(d.messages.length).toBe(2);
    expect(d.messages.map((m: any) => m.visibility)).toEqual(["INTERNAL", "CUSTOMER"]);
    expect(d.events.some((e: any) => e.kind === "status" && e.toValue === "IN_PROGRESS")).toBe(true);
  });

  it("status changes write events and resolved/closed timestamps", async () => {
    let r = await api("PATCH", `/api/support/cases/${caseId}`, admin, { status: "RESOLVED", priority: "HIGH" });
    expect(r.ok).toBe(true);
    let row = await r.json();
    expect(row.resolvedAt).not.toBeNull();
    r = await api("PATCH", `/api/support/cases/${caseId}`, admin, { status: "IN_PROGRESS" });
    row = await r.json();
    expect(row.resolvedAt).toBeNull();
    const d = await (await api("GET", `/api/support/cases/${caseId}`, admin)).json();
    expect(d.events.filter((e: any) => e.kind === "status").length).toBeGreaterThanOrEqual(3);
    expect(d.events.some((e: any) => e.kind === "priority" && e.toValue === "HIGH")).toBe(true);
  });

  it("links time entries to the case and totals them; refuses a project from another client", async () => {
    const ok = await api("POST", "/api/time-entries", admin, { projectId, date: new Date().toISOString().slice(0, 10), minutes: 90, billable: true, notes: "ABS-1 - fixed the PO column", supportCaseId: caseId });
    expect(ok.status).toBe(200);
    const e1 = await ok.json();
    timeEntryIds.push(e1.id);
    expect(e1.supportCaseId).toBe(caseId);

    const nonBillable = await api("POST", "/api/time-entries", admin, { projectId, date: new Date().toISOString().slice(0, 10), minutes: 30, billable: false, notes: "internal review", supportCaseId: caseId });
    expect(nonBillable.status).toBe(200);
    timeEntryIds.push((await nonBillable.json()).id);

    const wrong = await api("POST", "/api/time-entries", admin, { projectId: otherProjectId, date: new Date().toISOString().slice(0, 10), minutes: 15, billable: true, notes: "wrong client", supportCaseId: caseId });
    expect(wrong.status).toBe(400);
    expect((await wrong.json()).message).toMatch(/different client/i);

    const time = await (await api("GET", `/api/support/cases/${caseId}/time`, admin)).json();
    expect(time.totals.minutes).toBe(120);
    expect(time.totals.billableMinutes).toBe(90);
    expect(time.totals.unbilledMinutes).toBe(90);
    expect(time.totals.invoicedMinutes).toBe(0);

    const list = await (await api("GET", "/api/support/cases?view=all&q=ABS-1", admin)).json();
    const row = list.find((r: any) => r.id === caseId);
    expect(row.minutesLogged).toBe(120);

    // PATCH can unlink and re-link
    const unlink = await api("PATCH", `/api/time-entries/${e1.id}`, admin, { supportCaseId: null });
    expect(unlink.status).toBe(200);
    expect((await unlink.json()).supportCaseId).toBeNull();
    const relink = await api("PATCH", `/api/time-entries/${e1.id}`, admin, { supportCaseId: caseId });
    expect((await relink.json()).supportCaseId).toBe(caseId);
  });

  it("invoices can group lines by case and the case key appears in the header line", async () => {
    const res = await api("POST", "/api/invoices/generate", admin, { clientId, lineGroupBy: "case", includeUnapproved: true });
    const text = await res.text();
    expect([200, 201], text).toContain(res.status);
    const inv = JSON.parse(text);
    const invoiceId = inv.id || inv.invoice?.id || inv.invoices?.[0]?.id;
    expect(invoiceId).toBeTruthy();
    const detail = await (await api("GET", `/api/invoices/${invoiceId}`, admin)).json();
    const lines = detail.lines || detail.lineItems || detail.items || [];
    expect(lines.some((l: any) => String(l.description).startsWith(caseKey)), JSON.stringify({ keys: Object.keys(detail), lines: lines.map((l: any) => l.description) })).toBe(true);
    // the billable entry is now invoiced; totals reflect it
    const time = await (await api("GET", `/api/support/cases/${caseId}/time`, admin)).json();
    expect(time.totals.invoicedMinutes).toBe(90);
    expect(time.totals.unbilledMinutes).toBe(0);
    await api("DELETE", `/api/invoices/${invoiceId}`, admin);
  });

  it("deleting a case keeps the time on the books, unlinked", async () => {
    const res = await api("DELETE", `/api/support/cases/${caseId}`, admin);
    expect(res.ok).toBe(true);
    const gone = await api("GET", `/api/support/cases/${caseId}`, admin);
    expect(gone.status).toBe(404);
    const entries = await (await api("GET", "/api/time-entries", admin)).json();
    const e = entries.find((x: any) => x.id === timeEntryIds[1]);
    expect(e).toBeTruthy();
    expect(e.supportCaseId).toBeNull();
  });

  afterAll(async () => {
    for (const id of timeEntryIds) await api("DELETE", `/api/time-entries/${id}`, admin).catch(() => {});
    const list = await (await api("GET", `/api/support/cases?view=all&clientId=${clientId}`, admin)).json().catch(() => []);
    for (const r of Array.isArray(list) ? list : []) await api("DELETE", `/api/support/cases/${r.id}`, admin).catch(() => {});
    for (const p of [projectId, otherProjectId]) if (p) await api("DELETE", `/api/projects/${p}`, admin).catch(() => {});
    for (const c of [clientId, otherClientId]) if (c) await api("DELETE", `/api/clients/${c}`, admin).catch(() => {});
  });
});
