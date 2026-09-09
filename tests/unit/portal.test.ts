import { describe, it, expect, afterAll } from "vitest";
import { TEST_BASE as BASE } from "../helpers/base";

interface Ctx { cookie: string; csrfToken: string }
let admin: Ctx = { cookie: "", csrfToken: "" };
let orgSlug = "";
let clientId = "";
let contactId = "";
let otherContactId = "";
let agentCaseId = "";
let portalCookie = "";
let otherPortalCookie = "";
let portalCaseId = "";
const stamp = Date.now();
const contactEmail = `shadi.${stamp}@example.com`;
const otherEmail = `andrew.${stamp}@example.com`;

async function api(method: string, path: string, ctx: Ctx, body?: any) {
  const opts: RequestInit = { method, headers: { "Content-Type": "application/json", Cookie: ctx.cookie, "X-CSRF-Token": ctx.csrfToken } };
  if (body) opts.body = JSON.stringify(body);
  return fetch(`${BASE}${path}`, opts);
}
async function portal(method: string, path: string, cookie: string, body?: any) {
  const opts: RequestInit = { method, headers: { "Content-Type": "application/json", "X-Requested-With": "cwp-portal", ...(cookie ? { Cookie: cookie } : {}) } };
  if (body) opts.body = JSON.stringify(body);
  return fetch(`${BASE}/api/portal/${orgSlug}${path}`, opts);
}
async function login(email: string, password: string): Promise<Ctx> {
  const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const cookies = res.headers.getSetCookie?.() ?? [];
  return { cookie: cookies.map((c: string) => c.split(";")[0]).join("; "), csrfToken: res.headers.get("x-csrf-token") || "" };
}
function tokenFromLink(link: string): string {
  return new URL(link, "http://localhost").searchParams.get("token") || "";
}
async function signIn(email: string): Promise<string> {
  const req = await portal("POST", "/auth/request-link", "", { email });
  if (!req.ok) throw new Error(`request-link ${req.status}: ${await req.text()}`);
  const { debugLink } = await req.json();
  if (!debugLink) throw new Error("test env did not return debugLink (contact not found or not VITEST)");
  const verify = await portal("POST", "/auth/verify", "", { token: tokenFromLink(debugLink) });
  if (!verify.ok) throw new Error(`verify ${verify.status}: ${await verify.text()}`);
  const setCookie = verify.headers.getSetCookie?.() ?? [];
  const c = setCookie.find(x => x.startsWith("cwp_portal="));
  expect(c).toBeTruthy();
  return c!.split(";")[0];
}

describe("customer portal: magic link, cases, replies, visibility, billing", () => {
  it("setup: client, two contacts, one agent-opened case for the primary contact", async () => {
    admin = await login("admin.test@cwpro.dev", "admin123");
    const info = await (await api("GET", "/api/support/portal-info", admin)).json();
    orgSlug = info.orgSlug;
    expect(orgSlug, "org slug").toBeTruthy();
    expect(info.portalUrl).toContain(`/portal/${orgSlug}`);
    expect(info.helpUrl).toContain(`/help/${orgSlug}`);

    const c = await api("POST", "/api/clients", admin, { name: `Portal Client ${stamp}` });
    expect(c.ok).toBe(true);
    clientId = (await c.json()).id;
    // Primary no longer implies anything for the portals: company-wide visibility is the
    // Customer Admin role, money is billing access. (Prod primaries were backfilled.)
    const c1 = await api("POST", `/api/clients/${clientId}/contacts`, admin, { firstName: "Shadi", lastName: "Mohaisen", email: contactEmail, isPrimary: true, portalRole: "admin", billingAccess: true });
    expect(c1.ok, await c1.clone().text()).toBe(true);
    contactId = (await c1.json()).id;
    const c2 = await api("POST", `/api/clients/${clientId}/contacts`, admin, { firstName: "Andrew", lastName: "Mendes", email: otherEmail, isPrimary: false });
    expect(c2.ok).toBe(true);
    otherContactId = (await c2.json()).id;

    const k = await api("POST", "/api/support/cases", admin, { clientId, subject: "Costing report totals are off", requesterContactId: contactId });
    expect(k.status).toBe(201);
    agentCaseId = (await k.json()).id;
  });

  it("a portal write without the request header is refused", async () => {
    const res = await fetch(`${BASE}/api/portal/${orgSlug}/auth/request-link`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: contactEmail }) });
    expect(res.status).toBe(403);
  });

  it("branding is public; unknown emails still get a 200 and no link", async () => {
    const b = await portal("GET", "/branding", "");
    if (!b.ok) throw new Error(`branding ${b.status}: ${await b.text()} (slug=${orgSlug})`);
    expect((await b.json()).slug).toBe(orgSlug);
    const nobody = await portal("POST", "/auth/request-link", "", { email: `nobody.${stamp}@example.com` });
    if (!nobody.ok) throw new Error(`request-link ${nobody.status}: ${await nobody.text()}`);
    expect((await nobody.json()).debugLink).toBeUndefined();
    const unauth = await portal("GET", "/me", "");
    if (unauth.status !== 401) throw new Error(`me ${unauth.status}: ${await unauth.text()}`);
  });

  it("a contact signs in with a one-time link; the link cannot be reused", async () => {
    const req = await portal("POST", "/auth/request-link", "", { email: contactEmail.toUpperCase() });
    const rl = await req.json();
    if (!rl.debugLink) throw new Error(`no debugLink: ${JSON.stringify(rl)}`);
    const token = tokenFromLink(rl.debugLink);
    const first = await portal("POST", "/auth/verify", "", { token });
    expect(first.ok).toBe(true);
    portalCookie = (first.headers.getSetCookie?.() ?? []).find(x => x.startsWith("cwp_portal="))!.split(";")[0];
    const again = await portal("POST", "/auth/verify", "", { token });
    expect(again.status).toBe(400);

    const me = await (await portal("GET", "/me", portalCookie)).json();
    expect(me.contact.id).toBe(contactId);
    expect(me.client.id).toBe(clientId);
    expect(me.client.showHours).toBe(false);
  });

  it("sees the agent-opened case, opens a new one from the portal, and replies", async () => {
    const lres = await portal("GET", "/cases", portalCookie);
    if (!lres.ok) throw new Error(`cases ${lres.status}: ${await lres.text()}`);
    const list = await lres.json();
    expect(list.cases.some((r: any) => r.id === agentCaseId)).toBe(true);

    const types = await (await portal("GET", "/types", portalCookie)).json();
    expect(types.length).toBeGreaterThanOrEqual(4);
    const created = await portal("POST", "/cases", portalCookie, { typeId: types[0].id, subject: "Login fails on the shop floor tablet", description: "Since Monday.", priority: "HIGH" });
    expect(created.status).toBe(201);
    const row = await created.json();
    portalCaseId = row.id;
    expect(row.caseKey).toMatch(/^[A-Z][A-Z0-9]{1,9}-\d+$/);

    // The agent side sees it as a PORTAL case from the contact.
    const agentView = await (await api("GET", `/api/support/cases/${portalCaseId}`, admin)).json();
    expect(agentView.source).toBe("PORTAL");
    expect(agentView.requesterContactId).toBe(contactId);
    expect(agentView.priority).toBe("HIGH");

    // Agent replies (customer-visible) and leaves an internal note; the portal shows only the reply.
    await api("POST", `/api/support/cases/${portalCaseId}/messages`, admin, { body: "Looking at the tablet now.", visibility: "CUSTOMER" });
    await api("POST", `/api/support/cases/${portalCaseId}/messages`, admin, { body: "Probably the cert expired.", visibility: "INTERNAL" });
    const detail = await (await portal("GET", `/cases/${portalCaseId}`, portalCookie)).json();
    expect(detail.messages.length).toBe(1);
    expect(detail.messages[0].fromTeam).toBe(true);
    expect(detail.hours).toBeNull();

    // Customer replies; case leaves WAITING_ON_CUSTOMER once the agent parks it there.
    await api("PATCH", `/api/support/cases/${portalCaseId}`, admin, { status: "WAITING_ON_CUSTOMER" });
    const reply = await portal("POST", `/cases/${portalCaseId}/messages`, portalCookie, { body: "It's the one in bay 3." });
    expect(reply.status).toBe(201);
    expect((await reply.json()).status).toBe("WAITING_ON_SUPPORT");
    const after = await (await api("GET", `/api/support/cases/${portalCaseId}`, admin)).json();
    expect(after.messages.filter((m: any) => m.authorContactId === contactId).length).toBe(1);
    expect(after.lastCustomerMessageAt).not.toBeNull();
  });

  it("shows hours only when the client allows it", async () => {
    const set = await api("PATCH", `/api/support/clients/${clientId}/settings`, admin, { portalShowHours: true });
    expect(set.ok).toBe(true);
    const detail = await (await portal("GET", `/cases/${portalCaseId}`, portalCookie)).json();
    expect(detail.hours).toEqual({ minutes: 0, billableMinutes: 0 });
  });

  it("a non-primary contact sees only their own cases", async () => {
    otherPortalCookie = await signIn(otherEmail);
    const list = await (await portal("GET", "/cases", otherPortalCookie)).json();
    expect(list.cases.length).toBe(0);
    const forbidden = await portal("GET", `/cases/${portalCaseId}`, otherPortalCookie);
    expect(forbidden.status).toBe(404);
    const own = await portal("POST", "/cases", otherPortalCookie, { subject: "Andrew's own request" });
    expect(own.status).toBe(201);
    const mine = await (await portal("GET", "/cases", otherPortalCookie)).json();
    expect(mine.cases.length).toBe(1);
    // …while the primary contact sees everything for the client.
    const all = await (await portal("GET", "/cases", portalCookie)).json();
    expect(all.cases.length).toBeGreaterThanOrEqual(3);
  });

  it("billing is reachable and empty for a fresh client", async () => {
    const bres = await portal("GET", "/billing", portalCookie);
    if (!bres.ok) throw new Error(`billing ${bres.status}: ${await bres.text()}`);
    const b = await bres.json();
    expect(Array.isArray(b.invoices)).toBe(true);
    expect(b.outstanding).toBe("0.00");
  });

  it("an agent can send a sign-in link; sign-out revokes the session", async () => {
    const invite = await api("POST", `/api/support/contacts/${contactId}/portal-invite`, admin);
    expect(invite.ok, await invite.clone().text()).toBe(true);
    const out = await portal("POST", "/auth/logout", portalCookie);
    expect(out.ok).toBe(true);
    const dead = await portal("GET", "/me", portalCookie);
    expect(dead.status).toBe(401);
  });

  afterAll(async () => {
    const list = await (await api("GET", `/api/support/cases?view=all&clientId=${clientId}`, admin)).json().catch(() => []);
    for (const r of Array.isArray(list) ? list : []) await api("DELETE", `/api/support/cases/${r.id}`, admin).catch(() => {});
    for (const id of [contactId, otherContactId]) if (id) await api("DELETE", `/api/clients/${clientId}/contacts/${id}`, admin).catch(() => {});
    if (clientId) await api("DELETE", `/api/clients/${clientId}`, admin).catch(() => {});
  });
});
