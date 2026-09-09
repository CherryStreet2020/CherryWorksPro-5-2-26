import { describe, it, expect, afterAll } from "vitest";
import { TEST_BASE as BASE } from "../helpers/base";
import { mapStatus, mapPriority } from "../../server/support-import";

interface Ctx { cookie: string; csrfToken: string }
let admin: Ctx = { cookie: "", csrfToken: "" };
let clientId = "";
let projectId = "";
const stamp = Date.now();
const timeEntryIds: string[] = [];

async function api(method: string, path: string, ctx: Ctx, body?: any) {
  const opts: RequestInit = { method, headers: { "Content-Type": "application/json", Cookie: ctx.cookie, "X-CSRF-Token": ctx.csrfToken } };
  if (body) opts.body = JSON.stringify(body);
  return fetch(`${BASE}${path}`, opts);
}
async function login(email: string, password: string): Promise<Ctx> {
  const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const cookies = res.headers.getSetCookie?.() ?? [];
  return { cookie: cookies.map((c: string) => c.split(";")[0]).join("; "), csrfToken: res.headers.get("x-csrf-token") || "" };
}

const EXPORT = [
  { key: "ZZQ-100", summary: "WIP report shows 3 problems", description: "See attached.", status: "Waiting for support", statusCategory: "new", priority: "Medium", requestType: "ERP Support Requests", reporterName: "Andrew Mendes", reporterEmail: `andrew.${stamp}@abs.example`, assigneeName: "David", assigneeEmail: null, created: "2025-04-08T10:00:00.000-0400", updated: "2025-07-28T10:00:00.000-0400", resolved: null,
    comments: [
      { author: "Andrew Mendes", email: `andrew.${stamp}@abs.example`, agent: false, public: true, created: "2025-04-08T10:05:00.000-0400", body: "Here is the first problem." },
      { author: "Ada Adminson", email: "admin.test@cwpro.dev", agent: true, public: false, created: "2025-04-08T11:00:00.000-0400", body: "Internal: looks like the cost table." },
      { author: "Ada Adminson", email: "admin.test@cwpro.dev", agent: true, public: true, created: "2025-04-08T12:00:00.000-0400", body: "Thanks Andrew, on it." },
    ],
    transitions: [{ from: "Open", to: "Waiting for support", at: "2025-04-08T10:01:00.000-0400", by: "Andrew Mendes" }] },
  { key: "ZZQ-152", summary: "Costing Report", status: "In Progress", statusCategory: "indeterminate", priority: "High", requestType: "Customization Request", reporterName: "Shadi Mohaisen", reporterEmail: `shadi.${stamp}@abs.example`, assigneeName: "Ada Adminson", assigneeEmail: "admin.test@cwpro.dev", created: "2026-05-04T09:00:00.000-0400", updated: "2026-06-16T09:00:00.000-0400", resolved: null, comments: [], transitions: [] },
  { key: "ZZQ-157", summary: "PO column", status: "Resolved", statusCategory: "done", priority: "Blocker", requestType: "Emailed request", reporterName: "Ronald Ndanga", reporterEmail: `ronald.${stamp}@abs.example`, assigneeName: "Nobody Known", created: "2026-09-01T17:00:00.000-0400", updated: "2026-09-02T08:50:00.000-0400", resolved: "2026-09-02T08:50:00.000-0400", comments: [], transitions: [{ from: "Work in progress", to: "Resolved", at: "2026-09-02T08:50:00.000-0400", by: "Dean Dunagan" }] },
];

describe("mapStatus / mapPriority", () => {
  it("maps Jira's statuses onto ours", () => {
    expect(mapStatus("Waiting for support")).toBe("WAITING_ON_SUPPORT");
    expect(mapStatus("Work in progress")).toBe("IN_PROGRESS");
    expect(mapStatus("In Progress")).toBe("IN_PROGRESS");
    expect(mapStatus("Waiting for customer")).toBe("WAITING_ON_CUSTOMER");
    expect(mapStatus("Resolved")).toBe("RESOLVED");
    for (const s of ["Closed", "Done", "Canceled"]) expect(mapStatus(s)).toBe("CLOSED");
    expect(mapStatus("Something odd", "done")).toBe("CLOSED");
  });
  it("maps Jira's blocked / on-hold statuses onto BLOCKED", () => {
    expect(mapStatus("Blocked")).toBe("BLOCKED");
    expect(mapStatus("On hold")).toBe("BLOCKED");
  });
  it("maps priorities", () => {
    expect(mapPriority("Blocker")).toBe("URGENT");
    expect(mapPriority("High")).toBe("HIGH");
    expect(mapPriority("Low")).toBe("LOW");
    expect(mapPriority(null)).toBe("MEDIUM");
  });
});

describe("Jira import", () => {
  it("setup: client + project + a time entry noted with a key", async () => {
    admin = await login("admin.test@cwpro.dev", "admin123");
    const c = await api("POST", "/api/clients", admin, { name: `ZZQ Import Client ${stamp}` });
    clientId = (await c.json()).id;
    const p = await api("POST", "/api/projects", admin, { clientId, name: "Support", status: "ACTIVE" });
    projectId = (await p.json()).id;
    const t = await api("POST", "/api/time-entries", admin, { projectId, date: new Date().toISOString().slice(0, 10), minutes: 45, billable: true, notes: "ZZQ-152 - report tweaks" });
    expect(t.status).toBe(200);
    timeEntryIds.push((await t.json()).id);
  });

  it("dry run reports without writing", async () => {
    const res = await api("POST", "/api/support/import/jira", admin, { clientId, projectId, items: EXPORT, dryRun: true });
    expect(res.ok, await res.clone().text()).toBe(true);
    const r = await res.json();
    expect(r.imported).toBe(3);
    expect(r.unmatchedAssignees).toContain("Nobody Known");
    const list = await (await api("GET", `/api/support/cases?view=all&clientId=${clientId}`, admin)).json();
    expect(list.length).toBe(0);
  });

  it("imports with keys, dates, statuses, contacts, messages, events; re-links time; bumps the counter", async () => {
    const res = await api("POST", "/api/support/import/jira", admin, { clientId, projectId, items: EXPORT, relinkTime: true });
    expect(res.ok, await res.clone().text()).toBe(true);
    const r = await res.json();
    expect(r.imported).toBe(3);
    expect(r.contactsCreated).toBe(3);
    expect(r.timeEntriesLinked).toBe(1);
    expect(r.nextCaseNumber).toBe(158);
    expect(r.unmatchedTypes).toContain("Emailed request");

    const list = await (await api("GET", `/api/support/cases?view=all&clientId=${clientId}`, admin)).json();
    const byKey = Object.fromEntries(list.map((x: any) => [x.caseKey, x]));
    expect(Object.keys(byKey).sort()).toEqual(["ZZQ-100", "ZZQ-152", "ZZQ-157"]);
    expect(byKey["ZZQ-100"].status).toBe("WAITING_ON_SUPPORT");
    expect(byKey["ZZQ-152"].status).toBe("IN_PROGRESS");
    expect(byKey["ZZQ-152"].assigneeName).toBe("Ada Adminson");
    expect(byKey["ZZQ-152"].minutesLogged).toBe(45);
    expect(byKey["ZZQ-157"].status).toBe("RESOLVED");
    expect(byKey["ZZQ-157"].priority).toBe("URGENT");
    expect(new Date(byKey["ZZQ-100"].createdAt).getFullYear()).toBe(2025);

    const d = await (await api("GET", `/api/support/cases/${byKey["ZZQ-100"].id}`, admin)).json();
    expect(d.source).toBe("IMPORT");
    expect(d.externalRef).toBe("JIRA:ZZQ-100");
    expect(d.typeName).toBe("ERP Support Request");
    expect(d.requesterContactId).toBeTruthy();
    expect(d.messages.map((m: any) => m.visibility)).toEqual(["CUSTOMER", "INTERNAL", "CUSTOMER"]);
    expect(d.messages[2].authorUserId).toBeTruthy();
    expect(d.firstResponseAt).not.toBeNull();
    expect(d.events.some((e: any) => e.kind === "status" && e.toValue === "WAITING_ON_SUPPORT")).toBe(true);

    // The next agent-created case continues after the imported sequence.
    const next = await (await api("POST", "/api/support/cases", admin, { clientId, subject: "After import" })).json();
    expect(next.caseKey).toBe("ZZQ-158");
  });

  it("re-running skips existing keys", async () => {
    const r = await (await api("POST", "/api/support/import/jira", admin, { clientId, projectId, items: EXPORT })).json();
    expect(r.imported).toBe(0);
    expect(r.skipped.sort()).toEqual(["ZZQ-100", "ZZQ-152", "ZZQ-157"]);
  });

  it("refuses a mixed-prefix export", async () => {
    const res = await api("POST", "/api/support/import/jira", admin, { clientId, items: [{ ...EXPORT[0], key: "AAA-1" }, { ...EXPORT[1], key: "BBB-2" }] });
    expect(res.status).toBe(400);
  });

  afterAll(async () => {
    for (const id of timeEntryIds) await api("DELETE", `/api/time-entries/${id}`, admin).catch(() => {});
    const list = await (await api("GET", `/api/support/cases?view=all&clientId=${clientId}`, admin)).json().catch(() => []);
    for (const r of Array.isArray(list) ? list : []) await api("DELETE", `/api/support/cases/${r.id}`, admin).catch(() => {});
    const contacts = await (await api("GET", `/api/clients/${clientId}/contacts`, admin)).json().catch(() => []);
    for (const c of Array.isArray(contacts) ? contacts : []) await api("DELETE", `/api/clients/${clientId}/contacts/${c.id}`, admin).catch(() => {});
    if (projectId) await api("DELETE", `/api/projects/${projectId}`, admin).catch(() => {});
    if (clientId) await api("DELETE", `/api/clients/${clientId}`, admin).catch(() => {});
  });
});
