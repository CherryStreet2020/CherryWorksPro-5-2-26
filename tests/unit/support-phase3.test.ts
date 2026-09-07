import { describe, it, expect, afterAll } from "vitest";
import { TEST_BASE as BASE } from "../helpers/base";

interface Ctx { cookie: string; csrfToken: string }
let admin: Ctx = { cookie: "", csrfToken: "" };
let team: Ctx = { cookie: "", csrfToken: "" };
let teamUserId = "";
let clientId = "";
let contactId = "";
let caseId = "";
const stamp = Date.now();
const contactEmail = `ronald.${stamp}@example.com`;
const inboundAddress = `support.${stamp}@cherryworks-test.example`;

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
async function webhook(payload: any) {
  return fetch(`${BASE}/api/test/inbound-email`, { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "vitest" }, body: JSON.stringify({ type: payload.type, ...(payload.data || {}), messageId: payload.data?.message_id }) });
}

describe("support phase 3: service levels, persisted notifications, email-to-case", () => {
  it("setup", async () => {
    admin = await login("admin.test@cwpro.dev", "admin123");
    team = await login("team.test@cwpro.dev", "team123");
    teamUserId = (await (await api("GET", "/api/auth/me", team)).json()).id;
    const c = await api("POST", "/api/clients", admin, { name: `SLA Client ${stamp}` });
    clientId = (await c.json()).id;
    const ct = await api("POST", `/api/clients/${clientId}/contacts`, admin, { firstName: "Ronald", lastName: "Ndanga", email: contactEmail, isPrimary: true });
    contactId = (await ct.json()).id;
    const set = await api("PATCH", "/api/support/settings", admin, { supportInboundAddress: inboundAddress });
    expect(set.ok, await set.clone().text()).toBe(true);
  });

  it("org policy is the built-in default until saved; saving changes new cases' targets", async () => {
    const before = await (await api("GET", "/api/support/sla", admin)).json();
    expect(before.isDefault).toBe(true);
    expect(before.policy.firstResponseHours).toBe(8);
    const save = await api("PUT", "/api/support/sla", admin, { firstResponseHours: 2, resolutionHours: 10, businessHoursOnly: false, businessStartHour: 9, businessEndHour: 17, timezone: "America/New_York" });
    expect(save.ok, await save.clone().text()).toBe(true);
    const bad = await api("PUT", "/api/support/sla", admin, { firstResponseHours: 2, resolutionHours: 10, businessHoursOnly: true, businessStartHour: 17, businessEndHour: 9, timezone: "America/New_York" });
    expect(bad.status).toBe(400);

    const created = await api("POST", "/api/support/cases", admin, { clientId, subject: "SLA case", requesterContactId: contactId, assigneeUserId: teamUserId });
    expect(created.status).toBe(201);
    const row = await created.json();
    caseId = row.id;
    const frMs = new Date(row.firstResponseDueAt).getTime() - new Date(row.createdAt).getTime();
    const rsMs = new Date(row.resolutionDueAt).getTime() - new Date(row.createdAt).getTime();
    expect(Math.round(frMs / 3600000)).toBe(2);
    expect(Math.round(rsMs / 3600000)).toBe(10);
    const detail = await (await api("GET", `/api/support/cases/${caseId}`, admin)).json();
    expect(detail.sla.firstResponse).toBe("ok");
    expect(detail.sla.label).toMatch(/^Reply in/);
  });

  it("assignment persisted a notification for the team member", async () => {
    const list = await (await api("GET", "/api/notifications", team)).json();
    const mine = list.notifications.filter((n: any) => n.type === "case.new" && n.metadata?.caseId === caseId);
    expect(mine.length).toBe(1);
    expect(mine[0].read).toBe(false);
    const unread = await (await api("GET", "/api/notifications/unread-count", team)).json();
    expect(unread.unreadCount).toBeGreaterThanOrEqual(1);
    const mark = await api("POST", `/api/notifications/${mine[0].id}/read`, team);
    expect(mark.ok).toBe(true);
    const after = await (await api("GET", "/api/notifications", team)).json();
    expect(after.notifications.find((n: any) => n.id === mine[0].id).read).toBe(true);
    // another user cannot touch it
    const other = await api("POST", `/api/notifications/${mine[0].id}/read`, admin);
    expect(other.status).toBe(403);
  });

  it("waiting on customer pauses the clocks; resuming shifts the targets", async () => {
    const before = await (await api("GET", `/api/support/cases/${caseId}`, admin)).json();
    const paused = await api("PATCH", `/api/support/cases/${caseId}`, admin, { status: "WAITING_ON_CUSTOMER" });
    expect((await paused.json()).slaPausedAt).not.toBeNull();
    const mid = await (await api("GET", `/api/support/cases/${caseId}`, admin)).json();
    expect(mid.sla.firstResponse).toBe("paused");
    await new Promise(r => setTimeout(r, 1100));
    const resumed = await (await api("PATCH", `/api/support/cases/${caseId}`, admin, { status: "IN_PROGRESS" })).json();
    expect(resumed.slaPausedAt).toBeNull();
    expect(new Date(resumed.firstResponseDueAt).getTime()).toBeGreaterThan(new Date(before.firstResponseDueAt).getTime());
    expect(new Date(resumed.resolutionDueAt).getTime()).toBeGreaterThan(new Date(before.resolutionDueAt).getTime());
  });

  it("an email with the case key from the requester becomes a customer message; a fresh email from a contact opens a case; unknown senders are only stored", async () => {
    const key = (await (await api("GET", `/api/support/cases/${caseId}`, admin)).json()).caseKey;
    const reply = await webhook({ type: "email.received", data: { from: `Ronald Ndanga <${contactEmail}>`, to: [inboundAddress], subject: `Re: [${key}] SLA case`, text: "Here is the screenshot you asked for.\n\nOn Mon Dean wrote:\n> quoted", message_id: `<m1.${stamp}@example.com>` } });
    expect(reply.ok, await reply.clone().text()).toBe(true);
    const r1 = await reply.json();
    expect(r1.outcome).toBe("appended");
    const detail = await (await api("GET", `/api/support/cases/${caseId}`, admin)).json();
    const msg = detail.messages.find((m: any) => m.authorContactId === contactId);
    expect(msg).toBeTruthy();
    expect(msg.body).toBe("Here is the screenshot you asked for.");
    expect(msg.visibility).toBe("CUSTOMER");

    // A redelivery of the same message id is claimed once: no second customer message.
    const again = await webhook({ type: "email.received", data: { from: `Ronald Ndanga <${contactEmail}>`, to: [inboundAddress], subject: `Re: [${key}] SLA case`, text: "Here is the screenshot you asked for.", message_id: `<m1.${stamp}@example.com>` } });
    expect(again.ok).toBe(true);
    expect((await again.json()).duplicate).toBe(true);
    const afterDup = await (await api("GET", `/api/support/cases/${caseId}`, admin)).json();
    expect(afterDup.messages.filter((m: any) => m.authorContactId === contactId).length).toBe(1);

    const fresh = await webhook({ type: "email.received", data: { from: contactEmail, to: inboundAddress, subject: "Fwd: Printer on the shop floor is offline", text: "Since this morning." } });
    const r2 = await fresh.json();
    expect(r2.outcome).toBe("created");
    const created = await (await api("GET", `/api/support/cases/${r2.caseId}`, admin)).json();
    expect(created.source).toBe("EMAIL");
    expect(created.subject).toBe("Printer on the shop floor is offline");
    expect(created.requesterContactId).toBe(contactId);

    const stranger = await (await webhook({ type: "email.received", data: { from: `nobody.${stamp}@example.com`, to: inboundAddress, subject: "hello", text: "hi" } })).json();
    expect(stranger.outcome).toBe("stored");
    const wrongOrg = await (await webhook({ type: "email.received", data: { from: contactEmail, to: `unknown.${stamp}@nowhere.example`, subject: "hello", text: "hi" } })).json();
    expect(wrongOrg.outcome).toBe("no_org");
    const ignored = await (await webhook({ type: "email.delivered", data: {} })).json();
    expect(ignored.message).toMatch(/ignored/i);
  });

  it("the breaching view lists a case whose target is inside the hour", async () => {
    await api("PUT", "/api/support/sla", admin, { firstResponseHours: 0.25, resolutionHours: 0.5, businessHoursOnly: false, businessStartHour: 9, businessEndHour: 17, timezone: "America/New_York" });
    const created = await (await api("POST", "/api/support/cases", admin, { clientId, subject: "Tight SLA" })).json();
    const rows = await (await api("GET", "/api/support/cases?view=breaching", admin)).json();
    expect(rows.some((r: any) => r.id === created.id)).toBe(true);
    expect(rows.find((r: any) => r.id === created.id).sla.firstResponse).toBe("warning");
    const summary = await (await api("GET", "/api/support/summary", admin)).json();
    expect(summary.breaching).toBeGreaterThanOrEqual(1);
  });

  afterAll(async () => {
    await api("PUT", "/api/support/sla", admin, { firstResponseHours: 8, resolutionHours: 24, businessHoursOnly: true, businessStartHour: 9, businessEndHour: 17, timezone: "America/New_York" }).catch(() => {});
    const list = await (await api("GET", `/api/support/cases?view=all&clientId=${clientId}`, admin)).json().catch(() => []);
    for (const r of Array.isArray(list) ? list : []) await api("DELETE", `/api/support/cases/${r.id}`, admin).catch(() => {});
    if (contactId) await api("DELETE", `/api/clients/${clientId}/contacts/${contactId}`, admin).catch(() => {});
    if (clientId) await api("DELETE", `/api/clients/${clientId}`, admin).catch(() => {});
  });
});
