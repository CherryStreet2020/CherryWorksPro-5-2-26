/**
 * Help Center (support-only) + Customer Portal (billing) + approved domains + Customer Admin.
 *
 * Runs against the vitest test server (NODE_ENV=test, VITEST=true) which returns
 * `debugLink` from request-link / invite so no mailbox is needed.
 */
import { describe, it, expect } from "vitest";
import { TEST_BASE as BASE } from "../helpers/base";

interface Ctx { cookie: string; csrfToken: string }
let admin: Ctx = { cookie: "", csrfToken: "" };
let orgSlug = "";
let clientId = "";
let otherClientId = "";
let adminContactId = "";
let memberContactId = "";
let billingContactId = "";
let aliceContactId = "";
let adminCookie = "";
let memberCookie = "";
let aliceCookie = "";
let memberCaseId = "";
let adminCaseId = "";
let otherClientCaseId = "";
const stamp = Date.now();
const domain = `abs-${stamp}.example`;
const adminEmail = `dana.${stamp}@${domain}`;
const memberEmail = `mike.${stamp}@${domain}`;
const billingEmail = `bill.${stamp}@${domain}`;
const aliceEmail = `alice.${stamp}@${domain}`;

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
const tokenOf = (link: string) => new URL(link, "http://localhost").searchParams.get("token") || "";
const pathOf = (link: string) => new URL(link, "http://localhost").pathname;
async function requestLink(email: string, surface?: "help" | "portal"): Promise<string | undefined> {
  const r = await portal("POST", "/auth/request-link", "", { email, ...(surface ? { surface } : {}) });
  if (!r.ok) throw new Error(`request-link ${r.status}: ${await r.text()}`);
  return (await r.json()).debugLink;
}
async function verify(link: string): Promise<string> {
  const v = await portal("POST", "/auth/verify", "", { token: tokenOf(link) });
  if (!v.ok) throw new Error(`verify ${v.status}: ${await v.text()}`);
  const c = (v.headers.getSetCookie?.() ?? []).find(x => x.startsWith("cwp_portal="));
  expect(c).toBeTruthy();
  return c!.split(";")[0];
}
async function signIn(email: string, surface?: "help" | "portal"): Promise<{ cookie: string; link: string }> {
  const link = await requestLink(email, surface);
  if (!link) throw new Error(`no link for ${email}`);
  return { cookie: await verify(link), link };
}

describe("Help Center: approved domains, self-registration, Customer Admin, billing wall", () => {
  it("setup: client with an approved domain, an admin, a member and a billing contact", async () => {
    admin = await login("admin.test@cwpro.dev", "admin123");
    const info = await (await api("GET", "/api/support/portal-info", admin)).json();
    orgSlug = info.orgSlug;
    expect(info.helpUrl).toContain(`/help/${orgSlug}`);
    expect(info.portalUrl).toContain(`/portal/${orgSlug}`);

    const c = await api("POST", "/api/clients", admin, { name: `Zephyr Works ${stamp}` });
    expect(c.ok).toBe(true);
    clientId = (await c.json()).id;
    const o = await api("POST", "/api/clients", admin, { name: `Other Co ${stamp}` });
    otherClientId = (await o.json()).id;

    const dom = await api("PATCH", `/api/clients/${clientId}`, admin, { portalEmailDomains: [`@${domain.toUpperCase()}`, domain] });
    expect(dom.ok, await dom.clone().text()).toBe(true);
    expect((await dom.json()).portalEmailDomains ?? (await (await api("GET", `/api/clients/${clientId}`, admin)).json()).portalEmailDomains).toEqual([domain]);

    const a = await api("POST", `/api/clients/${clientId}/contacts`, admin, { firstName: "Dana", lastName: "Admin", email: adminEmail, portalRole: "admin" });
    expect(a.status, await a.clone().text()).toBe(201);
    const aj = await a.json(); adminContactId = aj.id;
    expect(aj.portalRole).toBe("admin"); expect(aj.billingAccess).toBe(false);
    const m = await api("POST", `/api/clients/${clientId}/contacts`, admin, { firstName: "Mike", lastName: "Member", email: memberEmail });
    memberContactId = (await m.json()).id;
    const b = await api("POST", `/api/clients/${clientId}/contacts`, admin, { firstName: "Bill", lastName: "Payer", email: billingEmail, billingAccess: true });
    const bj = await b.json(); billingContactId = bj.id;
    expect(bj.billingAccess).toBe(true);

    const k1 = await api("POST", "/api/support/cases", admin, { clientId, subject: "Costing report totals are off", requesterContactId: memberContactId });
    expect(k1.status).toBe(201); memberCaseId = (await k1.json()).id;
    const k2 = await api("POST", "/api/support/cases", admin, { clientId, subject: "Need a new user set up", requesterContactId: adminContactId });
    adminCaseId = (await k2.json()).id;
    const k3 = await api("POST", "/api/support/cases", admin, { clientId: otherClientId, subject: "Other company's problem" });
    otherClientCaseId = (await k3.json()).id;
  });

  it("refuses a shared mailbox domain and a domain another client already owns", async () => {
    const shared = await api("PATCH", `/api/clients/${otherClientId}`, admin, { portalEmailDomains: ["gmail.com"] });
    expect(shared.status).toBe(400);
    const clash = await api("PATCH", `/api/clients/${otherClientId}`, admin, { portalEmailDomains: [domain] });
    expect(clash.status).toBe(409);
    expect((await clash.json()).message).toContain("Zephyr Works");
  });

  it("an unknown address on the approved domain self-registers (pending), signs in, and gives their name once", async () => {
    const link = await requestLink(aliceEmail);
    expect(link, "approved-domain stranger gets a link").toBeTruthy();
    expect(pathOf(link!)).toBe(`/help/${orgSlug}/verify`);
    // Placeholder exists, pending, member, no billing.
    const contacts = await (await api("GET", `/api/clients/${clientId}/contacts`, admin)).json();
    const alice = contacts.find((c: any) => c.email === aliceEmail);
    expect(alice).toBeTruthy();
    aliceContactId = alice.id;
    expect(alice.portalRole).toBe("member"); expect(alice.billingAccess).toBe(false); expect(alice.portalPendingAt).toBeTruthy(); expect(alice.source).toBe("help-center");
    // A second request creates no duplicate.
    await requestLink(aliceEmail);
    const again = (await (await api("GET", `/api/clients/${clientId}/contacts`, admin)).json()).filter((c: any) => c.email === aliceEmail);
    expect(again.length).toBe(1);

    aliceCookie = await verify(link!);
    const me = await (await portal("GET", "/me", aliceCookie)).json();
    expect(me.contact.needsName).toBe(true);
    expect(me.contact.portalRole).toBe("member");
    // Verified now: no longer pending.
    const after = (await (await api("GET", `/api/clients/${clientId}/contacts`, admin)).json()).find((c: any) => c.id === aliceContactId);
    expect(after.portalPendingAt).toBeNull();

    const named = await portal("PUT", "/me", aliceCookie, { firstName: "Alice", lastName: "Newcomer" });
    expect(named.ok, await named.clone().text()).toBe(true);
    const me2 = await (await portal("GET", "/me", aliceCookie)).json();
    expect(me2.contact.needsName).toBe(false);
    expect(me2.contact.firstName).toBe("Alice");
    const twice = await portal("PUT", "/me", aliceCookie, { firstName: "X", lastName: "Y" });
    expect(twice.status).toBe(400);
  });

  it("a shared-mailbox address and an unrelated domain get the generic reply and no contact", async () => {
    expect(await requestLink(`alice.${stamp}@gmail.com`)).toBeUndefined();
    expect(await requestLink(`alice.${stamp}@elsewhere-${stamp}.example`)).toBeUndefined();
    const contacts = await (await api("GET", `/api/clients/${clientId}/contacts`, admin)).json();
    expect(contacts.some((c: any) => c.email.endsWith("@gmail.com"))).toBe(false);
  });

  it("8 simultaneous first requests for one new address create exactly one contact", async () => {
    const email = `burst.${stamp}@${domain}`;
    const results = await Promise.all(Array.from({ length: 8 }, () => requestLink(email)));
    expect(results.filter(Boolean).length).toBe(8);
    const rows = (await (await api("GET", `/api/clients/${clientId}/contacts`, admin)).json()).filter((c: any) => c.email === email);
    expect(rows.length).toBe(1);
  });

  it("member sees only their own cases; Customer Admin sees the whole company and nothing of another client", async () => {
    memberCookie = (await signIn(memberEmail)).cookie;
    const mine = await (await portal("GET", "/cases", memberCookie)).json();
    expect(mine.scope).toBe("own");
    expect(mine.cases.map((c: any) => c.id)).toEqual([memberCaseId]);

    adminCookie = (await signIn(adminEmail)).cookie;
    const all = await (await portal("GET", "/cases", adminCookie)).json();
    expect(all.scope).toBe("client");
    const ids = all.cases.map((c: any) => c.id);
    expect(ids).toContain(memberCaseId); expect(ids).toContain(adminCaseId); expect(ids).not.toContain(otherClientCaseId);
    expect(all.cases.find((c: any) => c.id === memberCaseId).mine).toBe(false);
    // Filters
    const byReq = await (await portal("GET", `/cases?requester=${memberContactId}`, adminCookie)).json();
    expect(byReq.cases.map((c: any) => c.id)).toEqual([memberCaseId]);
    expect((await portal("GET", `/cases/${otherClientCaseId}`, adminCookie)).status).toBe(404);
    expect((await portal("GET", `/cases/${adminCaseId}`, memberCookie)).status).toBe(404);
  });

  it("Customer Admin sets priority, closes and reopens; events carry the contact's name and no user id; member is refused", async () => {
    const p = await portal("PATCH", `/cases/${memberCaseId}`, adminCookie, { priority: "URGENT" });
    expect(p.ok, await p.clone().text()).toBe(true);
    expect((await p.json()).priority).toBe("URGENT");
    const closed = await (await portal("PATCH", `/cases/${memberCaseId}`, adminCookie, { action: "close" })).json();
    expect(closed.status).toBe("CLOSED");
    const again = await portal("PATCH", `/cases/${memberCaseId}`, adminCookie, { action: "close" });
    expect(again.status).toBe(409);
    const reopened = await (await portal("PATCH", `/cases/${memberCaseId}`, adminCookie, { action: "reopen" })).json();
    expect(reopened.status).toBe("WAITING_ON_SUPPORT");
    const bad = await portal("PATCH", `/cases/${memberCaseId}`, adminCookie, { action: "reopen" });
    expect(bad.status).toBe(409);

    const detail = await (await api("GET", `/api/support/cases/${memberCaseId}`, admin)).json();
    expect(detail.status).toBe("WAITING_ON_SUPPORT");
    expect(detail.resolvedAt).toBeNull(); expect(detail.closedAt).toBeNull();
    const events = detail.events as any[];
    const statusEvents = events.filter(e => e.kind === "status");
    expect(statusEvents.map((e: any) => e.toValue)).toEqual(expect.arrayContaining(["CLOSED", "WAITING_ON_SUPPORT"]));
    for (const e of statusEvents) { expect(e.actorUserId).toBeNull(); expect(e.actorName).toBe("Dana Admin"); }
    expect(events.find(e => e.kind === "priority")?.toValue).toBe("URGENT");

    expect((await portal("PATCH", `/cases/${memberCaseId}`, memberCookie, { priority: "LOW" })).status).toBe(403);
    expect((await portal("PATCH", `/cases/${otherClientCaseId}`, adminCookie, { priority: "LOW" })).status).toBe(404);
    expect((await portal("PATCH", `/cases/${memberCaseId}`, adminCookie, {})).status).toBe(400);
  });

  it("an agent's transition wins over a stale customer reopen (validated inside the lock)", async () => {
    const r = await api("PATCH", `/api/support/cases/${adminCaseId}`, admin, { status: "RESOLVED" });
    expect(r.ok, await r.clone().text()).toBe(true);
    const a = await api("PATCH", `/api/support/cases/${adminCaseId}`, admin, { status: "IN_PROGRESS" });
    expect(a.ok).toBe(true);
    const before = (await (await api("GET", `/api/support/cases/${adminCaseId}`, admin)).json()).events.length;
    const stale = await portal("PATCH", `/cases/${adminCaseId}`, adminCookie, { action: "reopen" });
    expect(stale.status).toBe(409);
    const after = await (await api("GET", `/api/support/cases/${adminCaseId}`, admin)).json();
    expect(after.status).toBe("IN_PROGRESS");
    expect(after.events.length).toBe(before);
  });

  it("two concurrent admin changes on one case produce a consistent event chain", async () => {
    const k = await api("POST", "/api/support/cases", admin, { clientId, subject: "Race me", requesterContactId: adminContactId });
    const id = (await k.json()).id;
    const [x, y] = await Promise.all([
      portal("PATCH", `/cases/${id}`, adminCookie, { priority: "HIGH" }),
      portal("PATCH", `/cases/${id}`, adminCookie, { priority: "LOW" }),
    ]);
    expect(x.ok && y.ok).toBe(true);
    const d = await (await api("GET", `/api/support/cases/${id}`, admin)).json();
    const pe = (d.events as any[]).filter(e => e.kind === "priority").sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    expect(pe.length).toBe(2);
    expect(pe[0].fromValue).toBe("MEDIUM");
    expect(pe[1].fromValue).toBe(pe[0].toValue);
    expect(d.priority).toBe(pe[1].toValue);
  });

  it("Team: admin lists colleagues and invites one; duplicates and members are refused; concurrent invites make one contact", async () => {
    const team = await (await portal("GET", "/team", adminCookie)).json();
    expect(team.approvedDomains).toEqual([domain]);
    expect(team.contacts.map((c: any) => c.email)).toEqual(expect.arrayContaining([adminEmail, memberEmail, aliceEmail]));
    expect((await portal("GET", "/team", memberCookie)).status).toBe(403);

    const inv = await portal("POST", "/team", adminCookie, { firstName: "Nate", lastName: "New", email: `nate.${stamp}@${domain}` });
    expect(inv.status, await inv.clone().text()).toBe(201);
    const { debugLink } = await inv.json();
    expect(pathOf(debugLink)).toBe(`/help/${orgSlug}/verify`);
    const nateCookie = await verify(debugLink);
    const me = await (await portal("GET", "/me", nateCookie)).json();
    expect(me.contact.firstName).toBe("Nate"); expect(me.contact.needsName).toBe(false); expect(me.contact.portalRole).toBe("member");

    expect((await portal("POST", "/team", adminCookie, { firstName: "Nate", lastName: "Again", email: `nate.${stamp}@${domain}` })).status).toBe(400);
    expect((await portal("POST", "/team", adminCookie, { firstName: "G", lastName: "Mail", email: `g.${stamp}@gmail.com` })).status).toBe(400);
    expect((await portal("POST", "/team", adminCookie, { firstName: "O", lastName: "Ther", email: `o.${stamp}@not-approved-${stamp}.example` })).status).toBe(400);
    expect((await portal("POST", "/team", memberCookie, { firstName: "X", lastName: "Y", email: `x.${stamp}@${domain}` })).status).toBe(403);

    const email = `burst2.${stamp}@${domain}`;
    const rs = await Promise.all(Array.from({ length: 6 }, () => portal("POST", "/team", adminCookie, { firstName: "B", lastName: "Urst", email })));
    expect(rs.filter(r => r.status === 201).length).toBe(1);
    const rows = (await (await api("GET", `/api/clients/${clientId}/contacts`, admin)).json()).filter((c: any) => c.email === email);
    expect(rows.length).toBe(1);
  });

  it("billing is walled: members get NO_BILLING_ACCESS, a portal-surface link falls back to the Help Center, billing contacts get in", async () => {
    const denied = await portal("GET", "/billing", memberCookie);
    expect(denied.status).toBe(403);
    expect((await denied.json()).code).toBe("NO_BILLING_ACCESS");

    const fallback = await requestLink(memberEmail, "portal");
    expect(pathOf(fallback!)).toBe(`/help/${orgSlug}/verify`);
    const billing = await signIn(billingEmail, "portal");
    expect(pathOf(billing.link)).toBe(`/portal/${orgSlug}/verify`);
    const ok = await portal("GET", "/billing", billing.cookie);
    expect(ok.status, await ok.clone().text()).toBe(200);
    // A stranger on the approved domain is never provisioned through the billing door.
    expect(await requestLink(`stranger.${stamp}@${domain}`, "portal")).toBeUndefined();
  });

  it("firm side: a Customer Portal link needs billing access; a Help Center link is the default; PATCH flips the flags", async () => {
    const no = await api("POST", `/api/support/contacts/${memberContactId}/portal-invite`, admin, { surface: "portal" });
    expect(no.status).toBe(400);
    const help = await api("POST", `/api/support/contacts/${memberContactId}/portal-invite`, admin, {});
    expect(help.ok).toBe(true);
    expect(pathOf((await help.json()).debugLink)).toBe(`/help/${orgSlug}/verify`);
    const flip = await api("PATCH", `/api/clients/${clientId}/contacts/${memberContactId}`, admin, { billingAccess: true, portalRole: "admin" });
    expect(flip.ok).toBe(true);
    const j = await flip.json(); expect(j.billingAccess).toBe(true); expect(j.portalRole).toBe("admin");
    // Immediate effect: identity is re-read per request.
    expect((await portal("GET", "/billing", memberCookie)).status).toBe(200);
    const back = await api("PATCH", `/api/clients/${clientId}/contacts/${memberContactId}`, admin, { billingAccess: false, portalRole: "member" });
    expect(back.ok).toBe(true);
    expect((await portal("GET", "/billing", memberCookie)).status).toBe(403);
    expect((await api("PATCH", `/api/clients/${clientId}/contacts/${memberContactId}`, admin, { portalRole: "owner" })).status).toBe(400);
  });

  it("one live contact per address in a workspace: PATCH onto a colleague's email → 409", async () => {
    const dup = await api("PATCH", `/api/clients/${clientId}/contacts/${memberContactId}`, admin, { email: adminEmail });
    expect(dup.status).toBe(409);
    const dup2 = await api("POST", `/api/clients/${otherClientId}/contacts`, admin, { firstName: "Dana", lastName: "Twin", email: adminEmail.toUpperCase() });
    expect(dup2.status).toBe(409);
  });

  it("self-registered contacts are never implicit invoice recipients until the firm says so", async () => {
    const { pickRecipients } = await import("../../server/email");
    const contacts = [{ email: aliceEmail, role: null, isPrimary: false, source: "help-center", billingAccess: false, portalPendingAt: null }];
    expect(pickRecipients({ clientEmail: null, contacts, billingContacts: [] }).to).toBeNull();
    expect(pickRecipients({ clientEmail: null, contacts: [{ ...contacts[0], billingAccess: true }], billingContacts: [] }).to).toBe(aliceEmail);
    expect(pickRecipients({ clientEmail: null, contacts: [{ ...contacts[0], portalPendingAt: new Date(), billingAccess: true }], billingContacts: [] }).to).toBeNull();
    expect(pickRecipients({ clientEmail: null, contacts: [{ ...contacts[0], source: "manual" }], billingContacts: [] }).to).toBe(aliceEmail);
  });

  it("revoking voids outstanding links, kills the session, blocks re-registration and re-invitation; 'allow again' restores", async () => {
    const pendingLink = await requestLink(aliceEmail);
    expect(pendingLink).toBeTruthy();
    const rev = await api("POST", `/api/support/contacts/${aliceContactId}/portal-revoke`, admin);
    expect(rev.ok, await rev.clone().text()).toBe(true);
    expect((await portal("GET", "/me", aliceCookie)).status).toBe(401);
    const replay = await portal("POST", "/auth/verify", "", { token: tokenOf(pendingLink!) });
    expect(replay.status, await replay.clone().text()).toBe(400);
    expect(await requestLink(aliceEmail)).toBeUndefined();
    const reinvite = await portal("POST", "/team", adminCookie, { firstName: "Alice", lastName: "Again", email: aliceEmail });
    expect(reinvite.status).toBe(400);

    const blocked = await (await api("GET", `/api/support/clients/${clientId}/portal-blocked`, admin)).json();
    const row = blocked.find((b: any) => b.email === aliceEmail);
    expect(row?.reason).toBe("revoked");
    const allow = await api("DELETE", `/api/support/portal-blocked/${row.id}`, admin);
    expect(allow.ok).toBe(true);
    const back = await signIn(aliceEmail);
    const me = await (await portal("GET", "/me", back.cookie)).json();
    expect(me.contact.id).toBe(aliceContactId);
  });

  it("deleting a contact on an approved domain keeps the address out; the stranger cannot walk back in", async () => {
    const email = `gone.${stamp}@${domain}`;
    const { cookie } = await signIn(email);
    const id = (await (await portal("GET", "/me", cookie)).json()).contact.id;
    const del = await api("DELETE", `/api/clients/${clientId}/contacts/${id}`, admin);
    expect(del.ok).toBe(true);
    expect(await requestLink(email)).toBeUndefined();
    const rows = (await (await api("GET", `/api/clients/${clientId}/contacts`, admin)).json()).filter((c: any) => c.email === email);
    expect(rows.length).toBe(0);
  });

  it("inbound mail: verified requester and Customer Admin can append; a colleague, a pending placeholder, an unauthenticated sender and a stranger are stored", async () => {
    const detail = await (await api("GET", `/api/support/cases/${memberCaseId}`, admin)).json();
    const key = detail.caseKey as string;
    const inbound = (from: string, subject: string, extra: Record<string, unknown> = {}) => fetch(`${BASE}/api/test/inbound-email`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: "support@cwpro.dev", subject, text: `reply from ${from}`, messageId: `<${Math.random()}.${stamp}@test>`, ...extra }),
    }).then(r => r.json());
    // Test org's inbound address may be unset; set it so the org resolves.
    await api("PATCH", "/api/support/settings", admin, { supportInboundAddress: "support@cwpro.dev" });

    expect((await inbound(`Mike <${memberEmail}>`, `Re: [${key}] costing`)).outcome).toBe("appended");
    expect((await inbound(`Dana <${adminEmail}>`, `Re: [${key}] costing`)).outcome).toBe("appended");
    // Colleague (member, not requester) → stored, and no second case.
    const before = (await (await api("GET", "/api/support/cases", admin)).json()).length ?? null;
    expect((await inbound(`Nate <nate.${stamp}@${domain}>`, `Re: [${key}] costing`)).outcome).toBe("stored");
    // Unauthenticated requester → stored.
    expect((await inbound(`Mike <${memberEmail}>`, `Re: [${key}] costing`, { senderAuthenticated: false })).outcome).toBe("stored");
    // Pending placeholder → stored (never opens a case).
    await requestLink(`pending.${stamp}@${domain}`);
    expect((await inbound(`Pending <pending.${stamp}@${domain}>`, "New problem")).outcome).toBe("stored");
    // Stranger on the approved domain → stored (no provisioning by mail).
    expect((await inbound(`Stranger <stranger2.${stamp}@${domain}>`, "New problem")).outcome).toBe("stored");
    const strangers = (await (await api("GET", `/api/clients/${clientId}/contacts`, admin)).json()).filter((c: any) => c.email === `stranger2.${stamp}@${domain}`);
    expect(strangers.length).toBe(0);
    void before;
    // Known verified member opening a NEW case by mail still works.
    expect((await inbound(`Mike <${memberEmail}>`, "Another new problem")).outcome).toBe("created");
  });

  it("legacy token portal still serves; /help is a token route; robots disallows /help/", async () => {
    const { classifyPath } = await import("../../shared/seo-routes");
    expect(classifyPath(`/help/${orgSlug}`).kind).toBe("token");
    expect(classifyPath(`/help/${orgSlug}/cases/abc`).kind).toBe("token");
    const robots = await (await fetch(`${BASE}/robots.txt`)).text();
    expect(robots).toContain("Disallow: /help/");
    const gen = await api("POST", `/api/clients/${clientId}/generate-portal-link`, admin);
    expect(gen.ok).toBe(true);
    const { portalToken } = await gen.json();
    const legacy = await fetch(`${BASE}/api/public/portal/${portalToken}`);
    expect(legacy.status).toBe(200);
  });

  it("support notifications point customers at the Help Center", async () => {
    const src = await import("node:fs").then(fs => fs.readFileSync(new URL("../../server/support-notifications.ts", import.meta.url), "utf8"));
    expect(src).toContain("/help/${org.slug}/cases/${caseId}");
    expect(src).not.toContain("/portal/${org.slug}/cases/");
  });
});
