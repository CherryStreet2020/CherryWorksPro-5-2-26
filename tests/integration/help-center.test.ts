/**
 * Help Center (support-only) + Customer Portal (billing) + approved domains + Customer Admin.
 *
 * Runs against the vitest test server (NODE_ENV=test, VITEST=true) which returns
 * `debugLink` from request-link / invite so no mailbox is needed.
 */
import { describe, it, expect } from "vitest";
import { TEST_BASE as BASE } from "../helpers/base";
import { waitForCapturedEmail } from "../helpers/email-capture";

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
    const mineOnly = await (await portal("GET", "/cases?mine=1", adminCookie)).json();
    expect(mineOnly.cases.map((c: any) => c.id)).toEqual([adminCaseId]);
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
    // An invitee who has NOT used their link yet can be re-invited (the link is re-sent).
    const pendEmail = `pend.${stamp}@${domain}`;
    expect((await portal("POST", "/team", adminCookie, { firstName: "Pen", lastName: "Ding", email: pendEmail })).status).toBe(201);
    const re = await portal("POST", "/team", adminCookie, { firstName: "Pen", lastName: "Ding", email: pendEmail });
    expect(re.status).toBe(200);
    expect((await re.json()).resent).toBe(true);
    expect((await portal("POST", "/team", adminCookie, { firstName: "G", lastName: "Mail", email: `g.${stamp}@gmail.com` })).status).toBe(400);
    expect((await portal("POST", "/team", adminCookie, { firstName: "O", lastName: "Ther", email: `o.${stamp}@not-approved-${stamp}.example` })).status).toBe(400);
    expect((await portal("POST", "/team", memberCookie, { firstName: "X", lastName: "Y", email: `x.${stamp}@${domain}` })).status).toBe(403);
    // A Customer Admin of a client WITHOUT approved domains cannot claim someone from a domain another client owns.
    const otherAdminEmail = `oadmin.${stamp}@other-${stamp}.example`;
    const oa = await api("POST", `/api/clients/${otherClientId}/contacts`, admin, { firstName: "Olive", lastName: "Admin", email: otherAdminEmail, portalRole: "admin" });
    expect(oa.status).toBe(201);
    const otherAdminCookie = (await signIn(otherAdminEmail)).cookie;
    const steal = await portal("POST", "/team", otherAdminCookie, { firstName: "Stolen", lastName: "Person", email: `stolen.${stamp}@${domain}` });
    expect(steal.status).toBe(400);
    expect((await steal.json()).message).toContain("another company");

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
    // The firm side is told to "Allow again" instead of mailing a link that cannot work.
    const firmSend = await api("POST", `/api/support/contacts/${aliceContactId}/portal-invite`, admin, {});
    expect(firmSend.status).toBe(400);
    expect((await firmSend.json()).message).toContain("Allow again");

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

// ────────────────────────────────────────────────────────────────────────────
// Help Center request form v2: intake, multipart + idempotent uploads, watchers,
// on-behalf-of, requester ownership, BLOCKED, inbound-mail authority, notifications.
// Self-contained: its own client + approved domain so it never depends on the
// state the first suite leaves behind.
// ────────────────────────────────────────────────────────────────────────────
describe("Help Center request form v2: intake, files, watchers, on-behalf-of, BLOCKED, mail", () => {
  const dom2 = `helix-${stamp}.example`;
  const hAdminEmail = `hadmin.${stamp}@${dom2}`;
  const hReqEmail = `hreq.${stamp}@${dom2}`;
  const hW1Email = `wanda.${stamp}@${dom2}`;
  const hW2Email = `walt.${stamp}@${dom2}`;
  const hOutEmail = `olga.${stamp}@${dom2}`;
  let hClientId = "";
  let hOrgId = "";
  let hOtherClientId = "";
  let hOtherContactId = "";
  let hAdminId = ""; let hReqId = ""; let hW1Id = ""; let hW2Id = ""; let hOutId = "";
  let hAdminCookie = ""; let hReqCookie = ""; let hW1Cookie = ""; let hW2Cookie = ""; let hOutCookie = "";
  let watchedCaseId = ""; let watchedCaseKey = "";
  let reassignedCaseId = ""; let reassignedCaseKey = "";
  let legacyFlagCaseId = "";
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

  const firmCases = async () => (await (await api("GET", `/api/support/cases?view=all&clientId=${hClientId}`, admin)).json()) as any[];
  const firmContacts = async () => (await (await api("GET", `/api/clients/${hClientId}/contacts`, admin)).json()) as any[];
  function multipart(cookie: string, fields: Record<string, string>, files: { name: string; bytes: Buffer; type: string }[]) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    for (const f of files) fd.append("files", new Blob([f.bytes], { type: f.type }), f.name);
    return fetch(`${BASE}/api/portal/${orgSlug}/cases`, { method: "POST", headers: { Cookie: cookie, "X-Requested-With": "cwp-portal" }, body: fd });
  }
  function portalUpload(cookie: string, caseId: string, files: { name: string; bytes: Buffer; type: string }[]) {
    const fd = new FormData();
    for (const f of files) fd.append("files", new Blob([f.bytes], { type: f.type }), f.name);
    return fetch(`${BASE}/api/portal/${orgSlug}/cases/${caseId}/attachments`, { method: "POST", headers: { Cookie: cookie, "X-Requested-With": "cwp-portal" }, body: fd });
  }

  it("setup: a client with an approved domain, a Customer Admin, a requester, three colleagues, and another client's contact", async () => {
    admin = await login("admin.test@cwpro.dev", "admin123");
    orgSlug = (await (await api("GET", "/api/support/portal-info", admin)).json()).orgSlug;
    hOrgId = (await (await api("GET", "/api/auth/me", admin)).json()).orgId;
    expect(hOrgId).toBeTruthy();
    const c = await api("POST", "/api/clients", admin, { name: `Helix Labs ${stamp}` });
    expect(c.ok).toBe(true);
    hClientId = (await c.json()).id;
    const o = await api("POST", "/api/clients", admin, { name: `Quill Co ${stamp}` });
    hOtherClientId = (await o.json()).id;
    const dom = await api("PATCH", `/api/clients/${hClientId}`, admin, { portalEmailDomains: [dom2] });
    expect(dom.ok, await dom.clone().text()).toBe(true);
    const mk = async (clientId: string, firstName: string, lastName: string, email: string, extra: Record<string, unknown> = {}) => {
      const r = await api("POST", `/api/clients/${clientId}/contacts`, admin, { firstName, lastName, email, ...extra });
      expect(r.status, await r.clone().text()).toBe(201);
      return (await r.json()).id as string;
    };
    hAdminId = await mk(hClientId, "Hana", "Admin", hAdminEmail, { portalRole: "admin" });
    hReqId = await mk(hClientId, "Rex", "Requester", hReqEmail);
    hW1Id = await mk(hClientId, "Wanda", "One", hW1Email);
    hW2Id = await mk(hClientId, "Walt", "Two", hW2Email);
    hOutId = await mk(hClientId, "Olga", "Outside", hOutEmail);
    hOtherContactId = await mk(hOtherClientId, "Quinn", "Quill", `quinn.${stamp}@quill-${stamp}.example`);
    hAdminCookie = (await signIn(hAdminEmail)).cookie;
    hReqCookie = (await signIn(hReqEmail)).cookie;
    hW1Cookie = (await signIn(hW1Email)).cookie;
    hW2Cookie = (await signIn(hW2Email)).cookie;
    hOutCookie = (await signIn(hOutEmail)).cookie;
    // The org's inbound address (used by the mail tests below).
    const s = await api("PATCH", "/api/support/settings", admin, { supportInboundAddress: "support@cwpro.dev" });
    expect(s.ok, await s.clone().text()).toBe(true);
  });

  it("JSON create with intake round-trips to the customer detail and the firm detail", async () => {
    const intake = { affectedArea: "Costing report", references: "PO-4471, WO-88", impact: "TEAM", stepsToReproduce: "Open Reports → Costing → run for August", expected: "Totals match the GL", startedAt: "2026-09-01", neededBy: "2026-09-15", environment: "Production" };
    const r = await portal("POST", "/cases", hReqCookie, { subject: `Costing totals drift ${stamp}`, description: "Off by $412.10", priority: "HIGH", intake });
    expect(r.status, await r.clone().text()).toBe(201);
    const j = await r.json();
    expect(j.id).toBeTruthy(); expect(j.caseKey).toBeTruthy(); expect(j.status).toBe("NEW");
    expect(j.attachments).toEqual([]); expect(j.attachmentErrors).toEqual([]);
    const mine = await (await portal("GET", `/cases/${j.id}`, hReqCookie)).json();
    expect(mine.intake).toEqual(intake);
    expect(mine.priority).toBe("HIGH");
    expect(mine.isRequester).toBe(true);
    expect(mine.requesterName).toBe("Rex Requester");
    const firm = await (await api("GET", `/api/support/cases/${j.id}`, admin)).json();
    expect(firm.intake).toEqual(intake);
    expect(firm.source).toBe("PORTAL");
    expect(firm.requesterContactId).toBe(hReqId);
  });

  it("multipart create with two files + clientFileIds; a replay with the same submissionKey returns the same case with no duplicate files", async () => {
    const subject = `Screenshots attached ${stamp}`;
    const key = `form-${stamp}-abc`;
    const ids = [`file-${stamp}-one`, `file-${stamp}-two`];
    const intake = { affectedArea: "Purchasing", impact: "ONE_PERSON" };
    const fields = { subject, description: "See files", priority: "MEDIUM", submissionKey: key, clientFileIds: JSON.stringify(ids), intake: JSON.stringify(intake), watcherContactIds: "[]", watcherEmails: "[]" };
    const files = [{ name: "shot one.png", bytes: PNG, type: "image/png" }, { name: "notes.txt", bytes: Buffer.from("hello from the form"), type: "text/plain" }];
    const r = await multipart(hReqCookie, fields, files);
    expect(r.status, await r.clone().text()).toBe(201);
    const j = await r.json();
    expect(j.attachmentErrors).toEqual([]);
    expect(j.attachments.length).toBe(2);
    expect(j.attachments.map((a: any) => a.clientFileId).sort()).toEqual([...ids].sort());
    expect(j.attachments.map((a: any) => a.filename).sort()).toEqual(["notes.txt", "shot one.png"]);
    const firm = await (await api("GET", `/api/support/cases/${j.id}`, admin)).json();
    expect(firm.attachments.length).toBe(2);
    expect(firm.attachments.every((a: any) => a.source === "PORTAL")).toBe(true);
    expect(firm.intake).toEqual(intake);

    const again = await multipart(hReqCookie, fields, files);
    expect(again.status, await again.clone().text()).toBe(200);
    const rj = await again.json();
    expect(rj.replay).toBe(true);
    expect(rj.id).toBe(j.id);
    expect(rj.attachments.length).toBe(2);
    expect(rj.attachments.map((a: any) => a.id).sort()).toEqual(j.attachments.map((a: any) => a.id).sort());
    const firm2 = await (await api("GET", `/api/support/cases/${j.id}`, admin)).json();
    expect(firm2.attachments.length).toBe(2);
    expect((await firmCases()).filter(c => c.subject === subject).length).toBe(1);
  });

  it("watchers at creation: two colleagues by id + one new approved-domain email; watchers see, list, post and upload; a non-watcher member gets 404", async () => {
    const newEmail = `newbie.${stamp}@${dom2}`;
    const r = await portal("POST", "/cases", hReqCookie, { subject: `Loop in the team ${stamp}`, watcherContactIds: [hW1Id, hW2Id], watcherEmails: [newEmail] });
    expect(r.status, await r.clone().text()).toBe(201);
    const created = await r.json();
    watchedCaseId = created.id; watchedCaseKey = created.caseKey;
    expect(watchedCaseKey).toBeTruthy();
    const ws = await (await portal("GET", `/cases/${watchedCaseId}/watchers`, hReqCookie)).json();
    expect(ws.length).toBe(3);
    expect(ws.map((w: any) => w.email).sort()).toEqual([newEmail, hW1Email, hW2Email].sort());
    expect(ws.map((w: any) => w.contactId)).toEqual(expect.arrayContaining([hW1Id, hW2Id]));
    const newbie = (await firmContacts()).find(c => c.email === newEmail);
    expect(newbie, "the new watcher exists as a contact of this client").toBeTruthy();
    expect(newbie.portalPendingAt).toBeTruthy();
    expect(newbie.portalRole).toBe("member");

    // A watching member sees the case, lists it, posts and uploads.
    const d = await portal("GET", `/cases/${watchedCaseId}`, hW1Cookie);
    expect(d.status, await d.clone().text()).toBe(200);
    const dj = await d.json();
    expect(dj.isRequester).toBe(false);
    expect(dj.watchers.map((w: any) => w.contactId)).toContain(hW1Id);
    const list = await (await portal("GET", "/cases", hW1Cookie)).json();
    expect(list.cases.map((c: any) => c.id)).toContain(watchedCaseId);
    const m = await portal("POST", `/cases/${watchedCaseId}/messages`, hW1Cookie, { body: "Following this one." });
    expect(m.status, await m.clone().text()).toBe(201);
    const up = await portalUpload(hW1Cookie, watchedCaseId, [{ name: "watcher.png", bytes: PNG, type: "image/png" }]);
    expect(up.status, await up.clone().text()).toBe(201);
    // A member who is neither requester nor watcher: nothing.
    expect((await portal("GET", `/cases/${watchedCaseId}`, hOutCookie)).status).toBe(404);
    const outList = await (await portal("GET", "/cases", hOutCookie)).json();
    expect(outList.cases.map((c: any) => c.id)).not.toContain(watchedCaseId);
    expect((await portal("POST", `/cases/${watchedCaseId}/messages`, hOutCookie, { body: "hi" })).status).toBe(404);
  });

  it("a watcher email off the approved domains, or a colleague of another client, refuses the whole submission (no case)", async () => {
    const before = (await firmCases()).length;
    const bad = await portal("POST", "/cases", hReqCookie, { subject: `Bad watcher ${stamp}`, watcherEmails: [`outsider.${stamp}@not-approved-${stamp}.example`] });
    expect(bad.status, await bad.clone().text()).toBe(400);
    expect((await bad.json()).message).toMatch(/approved/i);
    const foreign = await portal("POST", "/cases", hReqCookie, { subject: `Foreign watcher ${stamp}`, watcherContactIds: [hOtherContactId] });
    expect([400, 403], await foreign.clone().text()).toContain(foreign.status);
    const shared = await portal("POST", "/cases", hReqCookie, { subject: `Gmail watcher ${stamp}`, watcherEmails: [`someone.${stamp}@gmail.com`] });
    expect(shared.status).toBe(400);
    const after = await firmCases();
    expect(after.length).toBe(before);
    expect(after.some(c => /Bad watcher|Foreign watcher|Gmail watcher/.test(c.subject))).toBe(false);
    // And no contact was provisioned for the refused address.
    expect((await firmContacts()).some(c => c.email.startsWith(`outsider.${stamp}@`))).toBe(false);
  });

  it("on behalf of: a Customer Admin opens a case for a colleague and keeps watching it; a member may not", async () => {
    const r = await portal("POST", "/cases", hAdminCookie, { subject: `Opened for Wanda ${stamp}`, onBehalfOfContactId: hW1Id });
    expect(r.status, await r.clone().text()).toBe(201);
    const id = (await r.json()).id;
    const d = await (await portal("GET", `/cases/${id}`, hAdminCookie)).json();
    expect(d.requesterName).toBe("Wanda One");
    expect(d.isRequester).toBe(false);
    expect(d.watchers.map((w: any) => w.contactId)).toContain(hAdminId);
    const firm = await (await api("GET", `/api/support/cases/${id}`, admin)).json();
    expect(firm.requesterContactId).toBe(hW1Id);
    expect(firm.watchers.map((w: any) => w.contactId)).toEqual([hAdminId]);
    // Wanda owns it.
    const wd = await portal("GET", `/cases/${id}`, hW1Cookie);
    expect(wd.status).toBe(200);
    expect((await wd.json()).isRequester).toBe(true);
    // A member cannot open for someone else.
    const denied = await portal("POST", "/cases", hReqCookie, { subject: `Sneaky ${stamp}`, onBehalfOfContactId: hW1Id });
    expect(denied.status, await denied.clone().text()).toBe(403);
    expect((await firmCases()).some(c => c.subject === `Sneaky ${stamp}`)).toBe(false);
  });

  it("customer watcher management: add by id and by approved email; self-removal only for watchers; requester removes anyone; events name the colleague", async () => {
    const r = await portal("POST", "/cases", hReqCookie, { subject: `Manage watchers ${stamp}`, description: "no watchers yet" });
    expect(r.status).toBe(201);
    const id = (await r.json()).id;
    const add1 = await portal("POST", `/cases/${id}/watchers`, hReqCookie, { contactId: hW1Id });
    expect(add1.status, await add1.clone().text()).toBe(201);
    expect((await add1.json()).map((w: any) => w.contactId)).toEqual([hW1Id]);
    // Idempotent re-add: 200, still one.
    const addAgain = await portal("POST", `/cases/${id}/watchers`, hReqCookie, { contactId: hW1Id });
    expect(addAgain.status).toBe(200);
    expect((await addAgain.json()).length).toBe(1);
    const fresh = `fresh.${stamp}@${dom2}`;
    const add2 = await portal("POST", `/cases/${id}/watchers`, hReqCookie, { email: fresh });
    expect(add2.status, await add2.clone().text()).toBe(201);
    const ws2 = await add2.json();
    expect(ws2.length).toBe(2);
    const freshId = ws2.find((w: any) => w.email === fresh).contactId;
    expect((await portal("POST", `/cases/${id}/watchers`, hReqCookie, { email: `nope.${stamp}@elsewhere-${stamp}.example` })).status).toBe(400);
    // Another client's contact: refused (the server masks it as not-found rather than confirming the id exists).
    const foreignAdd = await portal("POST", `/cases/${id}/watchers`, hReqCookie, { contactId: hOtherContactId });
    expect([400, 404], await foreignAdd.clone().text()).toContain(foreignAdd.status);
    expect((await (await portal("GET", `/cases/${id}/watchers`, hReqCookie)).json()).length).toBe(2);

    // Wanda (a watcher) may drop herself, not someone else.
    const notMine = await portal("DELETE", `/cases/${id}/watchers/${freshId}`, hW1Cookie);
    expect(notMine.status, await notMine.clone().text()).toBe(404);
    const self = await portal("DELETE", `/cases/${id}/watchers/${hW1Id}`, hW1Cookie);
    expect(self.status, await self.clone().text()).toBe(200);
    expect((await self.json()).map((w: any) => w.contactId)).toEqual([freshId]);
    expect((await portal("GET", `/cases/${id}`, hW1Cookie)).status).toBe(404);
    // The requester re-adds and then removes her.
    expect((await portal("POST", `/cases/${id}/watchers`, hReqCookie, { contactId: hW1Id })).status).toBe(201);
    expect((await portal("GET", `/cases/${id}`, hW1Cookie)).status).toBe(200);
    const byReq = await portal("DELETE", `/cases/${id}/watchers/${hW1Id}`, hReqCookie);
    expect(byReq.status, await byReq.clone().text()).toBe(200);
    expect((await byReq.json()).map((w: any) => w.contactId)).toEqual([freshId]);
    expect((await portal("GET", `/cases/${id}`, hW1Cookie)).status).toBe(404);
    expect((await portal("POST", `/cases/${id}/messages`, hW1Cookie, { body: "still here?" })).status).toBe(404);
    expect((await portalUpload(hW1Cookie, id, [{ name: "late.png", bytes: PNG, type: "image/png" }])).status).toBe(404);
    // A member who is not on the case cannot touch its watchers at all.
    expect((await portal("GET", `/cases/${id}/watchers`, hOutCookie)).status).toBe(404);
    expect((await portal("POST", `/cases/${id}/watchers`, hOutCookie, { contactId: hOutId })).status).toBe(404);

    const d = await (await portal("GET", `/cases/${id}`, hReqCookie)).json();
    const we = (d.events as any[]).filter(e => e.kind === "watcher");
    expect(we.filter(e => e.fromValue === "added" && e.toValue === "Wanda One").length).toBe(2);
    expect(we.filter(e => e.fromValue === "removed" && e.toValue === "Wanda One").length).toBe(2);
    const freshRow = ws2.find((w: any) => w.contactId === freshId);
    const freshName = `${freshRow.firstName ?? ""} ${freshRow.lastName ?? ""}`.trim() || fresh;
    expect(we.some(e => e.fromValue === "added" && e.toValue === freshName)).toBe(true);
    // The Customer Admin can also remove a watcher on a case that is not theirs.
    const byAdmin = await portal("DELETE", `/cases/${id}/watchers/${freshId}`, hAdminCookie);
    expect(byAdmin.status, await byAdmin.clone().text()).toBe(200);
    expect(await byAdmin.json()).toEqual([]);
  });

  it("firm side: agents add and remove watchers; colleagues exclude current watchers and the requester; detail carries watchers", async () => {
    const r = await portal("POST", "/cases", hReqCookie, { subject: `Firm-managed watchers ${stamp}` });
    const id = (await r.json()).id;
    const add = await api("POST", `/api/support/cases/${id}/watchers`, admin, { contactId: hW2Id });
    expect(add.status, await add.clone().text()).toBe(201);
    expect((await add.json()).map((w: any) => w.contactId)).toEqual([hW2Id]);
    const col = await (await api("GET", `/api/support/cases/${id}/colleagues`, admin)).json();
    const colIds = col.map((c: any) => c.id);
    expect(colIds).not.toContain(hW2Id);
    expect(colIds).not.toContain(hReqId);
    expect(colIds).toEqual(expect.arrayContaining([hW1Id, hOutId, hAdminId]));
    expect(colIds).not.toContain(hOtherContactId);
    const d = await (await api("GET", `/api/support/cases/${id}`, admin)).json();
    expect(d.watchers.map((w: any) => w.contactId)).toEqual([hW2Id]);
    expect((await portal("GET", `/cases/${id}`, hW2Cookie)).status).toBe(200);
    expect((await api("POST", `/api/support/cases/${id}/watchers`, admin, { contactId: hOtherContactId })).status).toBe(404);
    expect((await api("POST", `/api/support/cases/${id}/watchers`, admin, { contactId: hReqId })).status).toBe(200); // the requester already follows
    const del = await api("DELETE", `/api/support/cases/${id}/watchers/${hW2Id}`, admin);
    expect(del.status, await del.clone().text()).toBe(200);
    expect(await del.json()).toEqual([]);
    expect((await portal("GET", `/cases/${id}`, hW2Cookie)).status).toBe(404);
    const d2 = await (await api("GET", `/api/support/cases/${id}`, admin)).json();
    expect(d2.events.filter((e: any) => e.kind === "watcher").map((e: any) => [e.fromValue, e.toValue])).toEqual([["added", "Walt Two"], ["removed", "Walt Two"]]);
    expect((await api("GET", `/api/support/cases/${id}/colleagues`, admin)).status).toBe(200);
    expect((await (await api("GET", `/api/support/cases/${id}/colleagues`, admin)).json()).map((c: any) => c.id)).toContain(hW2Id);
  });

  it("visibility tightening: an email-only case is the member's until the agent links a different requester contact", async () => {
    const k = await api("POST", "/api/support/cases", admin, { clientId: hClientId, subject: `Legacy email case ${stamp}`, requesterName: "Wanda One", requesterEmail: hW1Email });
    expect(k.status, await k.clone().text()).toBe(201);
    const row = await k.json();
    reassignedCaseId = row.id; reassignedCaseKey = row.caseKey;
    expect(row.requesterContactId).toBeNull();
    const seen = await portal("GET", `/cases/${reassignedCaseId}`, hW1Cookie);
    expect(seen.status).toBe(200);
    expect((await (await portal("GET", "/cases", hW1Cookie)).json()).cases.map((c: any) => c.id)).toContain(reassignedCaseId);
    // The requester flag for the legacy (email-only) shape is asserted separately below so a wrong
    // flag cannot mask the access rules this test is about.
    const legacyFlag = await api("POST", "/api/support/cases", admin, { clientId: hClientId, subject: `Legacy flag case ${stamp}`, requesterName: "Wanda One", requesterEmail: hW1Email });
    legacyFlagCaseId = (await legacyFlag.json()).id;

    const p = await api("PATCH", `/api/support/cases/${reassignedCaseId}`, admin, { requesterContactId: hW2Id });
    expect(p.ok, await p.clone().text()).toBe(true);
    const after = await (await api("GET", `/api/support/cases/${reassignedCaseId}`, admin)).json();
    expect(after.requesterContactId).toBe(hW2Id);
    expect(after.requesterEmail).toBe(hW1Email); // the stale address stays on the row…
    expect((await portal("GET", `/cases/${reassignedCaseId}`, hW1Cookie)).status).toBe(404); // …but no longer grants access
    expect((await (await portal("GET", "/cases", hW1Cookie)).json()).cases.map((c: any) => c.id)).not.toContain(reassignedCaseId);
    expect((await portal("POST", `/cases/${reassignedCaseId}/messages`, hW1Cookie, { body: "mine?" })).status).toBe(404);
    expect((await portal("GET", `/cases/${reassignedCaseId}`, hW2Cookie)).status).toBe(200);
  });

  it("customer detail marks a legacy email-only case as the member's own (isRequester)", async () => {
    const seen = await portal("GET", `/cases/${legacyFlagCaseId}`, hW1Cookie);
    expect(seen.status).toBe(200);
    const d = await seen.json();
    expect(d.requesterName).toBe("Wanda One");
    expect(d.isRequester).toBe(true);
    // The list view agrees.
    const list = await (await portal("GET", "/cases", hW1Cookie)).json();
    expect(list.cases.find((c: any) => c.id === legacyFlagCaseId)?.mine).toBe(true);
  });

  it("requester ownership on update: an agent cannot point a case at another client's contact", async () => {
    const r = await api("PATCH", `/api/support/cases/${reassignedCaseId}`, admin, { requesterContactId: hOtherContactId });
    expect(r.status, await r.clone().text()).toBe(400);
    expect((await r.json()).message).toMatch(/client/i);
    const d = await (await api("GET", `/api/support/cases/${reassignedCaseId}`, admin)).json();
    expect(d.requesterContactId).toBe(hW2Id);
  });

  it("BLOCKED in the Help Center: the customer sees the status; a Customer Admin can still close and reopen", async () => {
    const r = await portal("POST", "/cases", hReqCookie, { subject: `Vendor holdup ${stamp}` });
    const id = (await r.json()).id;
    const b = await api("PATCH", `/api/support/cases/${id}`, admin, { status: "BLOCKED" });
    expect(b.ok, await b.clone().text()).toBe(true);
    expect((await (await portal("GET", `/cases/${id}`, hReqCookie)).json()).status).toBe("BLOCKED");
    const list = await (await portal("GET", "/cases", hReqCookie)).json();
    expect(list.cases.find((c: any) => c.id === id).status).toBe("BLOCKED");
    // A customer reply on a BLOCKED case leaves it BLOCKED.
    const m = await portal("POST", `/cases/${id}/messages`, hReqCookie, { body: "Any update?" });
    expect(m.status).toBe(201);
    expect((await m.json()).status).toBe("BLOCKED");
    expect((await portal("PATCH", `/cases/${id}`, hReqCookie, { action: "close" })).status).toBe(403);
    expect((await portal("PATCH", `/cases/${id}`, hAdminCookie, { action: "reopen" })).status).toBe(409);
    const closed = await portal("PATCH", `/cases/${id}`, hAdminCookie, { action: "close" });
    expect(closed.status, await closed.clone().text()).toBe(200);
    expect((await closed.json()).status).toBe("CLOSED");
    const reopened = await portal("PATCH", `/cases/${id}`, hAdminCookie, { action: "reopen" });
    expect(reopened.status).toBe(200);
    expect((await reopened.json()).status).toBe("WAITING_ON_SUPPORT");
    const d = await (await api("GET", `/api/support/cases/${id}`, admin)).json();
    expect(d.events.filter((e: any) => e.kind === "status").map((e: any) => e.toValue)).toEqual(expect.arrayContaining(["BLOCKED", "CLOSED", "WAITING_ON_SUPPORT"]));
  });

  it("reviewers are review only: they see the case and its updates but cannot reply, upload or add people; a watcher can be re-added as a reviewer and back", async () => {
    const r = await portal("POST", "/cases", hReqCookie, { subject: `Reviewed ${stamp}`, priority: "BLOCKER", reviewerContactIds: [hOutId] });
    expect(r.status, await r.clone().text()).toBe(201);
    const id = (await r.json()).id;
    // BLOCKER is the top priority and round-trips.
    const mine = await (await portal("GET", `/cases/${id}`, hReqCookie)).json();
    expect(mine.priority).toBe("BLOCKER");
    expect(mine.watchers.map((w: any) => [w.contactId, w.role])).toEqual([[hOutId, "reviewer"]]);
    // Olga (reviewer) sees it, knows her role, and is refused every write.
    const d = await portal("GET", `/cases/${id}`, hOutCookie);
    expect(d.status).toBe(200);
    expect((await d.json()).myRole).toBe("reviewer");
    expect((await portal("GET", "/cases", hOutCookie).then(x => x.json())).cases.map((c: any) => c.id)).toContain(id);
    expect((await portal("POST", `/cases/${id}/messages`, hOutCookie, { body: "reviewer trying to reply" })).status).toBe(404);
    expect((await portalUpload(hOutCookie, id, [{ name: "r.txt", bytes: Buffer.from("x"), type: "text/plain" }])).status).toBe(404);
    expect((await portal("POST", `/cases/${id}/watchers`, hOutCookie, { contactId: hW2Id })).status).toBe(404);
    // A reviewer's email reply is stored, not appended.
    const key = (await (await api("GET", `/api/support/cases/${id}`, admin)).json()).caseKey;
    const inb = await fetch(`${BASE}/api/test/inbound-email`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: `Olga <${hOutEmail}>`, to: "support@cwpro.dev", subject: `Re: [${key}] reviewed`, text: "from a reviewer", messageId: `<rv.${stamp}@test>`, senderAuthenticated: true, orgId: hOrgId }) }).then(x => x.json());
    expect(inb.outcome).toBe("stored");
    // A fellow watcher may invite people but may NOT change an existing follower's role.
    expect((await portal("POST", `/cases/${id}/watchers`, hReqCookie, { contactId: hW1Id })).status).toBe(201);
    expect((await portal("POST", `/cases/${id}/watchers`, hW1Cookie, { contactId: hOutId, role: "watcher" })).status).toBe(404);
    expect((await (await portal("GET", `/cases/${id}/watchers`, hReqCookie)).json()).find((w: any) => w.contactId === hOutId).role).toBe("reviewer");
    // The requester promotes her to a watcher: now she can reply. Then the firm demotes her again.
    expect((await portal("POST", `/cases/${id}/watchers`, hReqCookie, { contactId: hOutId, role: "watcher" })).status).toBe(201);
    expect((await portal("POST", `/cases/${id}/messages`, hOutCookie, { body: "now a watcher" })).status).toBe(201);
    expect((await api("POST", `/api/support/cases/${id}/watchers`, admin, { contactId: hOutId, role: "reviewer" })).status).toBe(201);
    expect((await portal("POST", `/cases/${id}/messages`, hOutCookie, { body: "reviewer again" })).status).toBe(404);
    const firm = await (await api("GET", `/api/support/cases/${id}`, admin)).json();
    expect(firm.watchers.find((w: any) => w.contactId === hOutId).role).toBe("reviewer");
    expect(firm.events.filter((e: any) => e.kind === "watcher").map((e: any) => e.toValue)).toEqual(expect.arrayContaining(["Olga Outside (review only)", "Olga Outside"]));
    // A Customer Admin can set BLOCKER too.
    expect((await portal("PATCH", `/cases/${id}`, hAdminCookie, { priority: "BLOCKER" })).status).toBe(200);
    // A reviewer can still stop following (self-removal), after which the case is gone for her.
    expect((await portal("DELETE", `/cases/${id}/watchers/${hOutId}`, hOutCookie)).status).toBe(200);
    expect((await portal("GET", `/cases/${id}`, hOutCookie)).status).toBe(404);
  });

  it("everyone on the case hears about every change: per-person unread badges, and a customer's reply reaches the other followers", async () => {
    const r = await portal("POST", "/cases", hReqCookie, { subject: `Everyone hears ${stamp}`, watcherContactIds: [hW2Id] });
    expect(r.status, await r.clone().text()).toBe(201);
    const id = (await r.json()).id;
    // Walt (watcher) has never opened it → unread for him, and counted in his nav badge.
    let list = await (await portal("GET", "/cases", hW2Cookie)).json();
    expect(list.cases.find((c: any) => c.id === id).unread).toBe(true);
    expect((await (await portal("GET", "/cases/unread-count", hW2Cookie)).json()).unread).toBeGreaterThanOrEqual(1);
    // Opening it clears his badge; the requester's own view is independent.
    expect((await portal("GET", `/cases/${id}`, hW2Cookie)).status).toBe(200);
    list = await (await portal("GET", "/cases", hW2Cookie)).json();
    expect(list.cases.find((c: any) => c.id === id).unread).toBe(false);
    // An agent reply makes it unread again for Walt.
    expect((await api("POST", `/api/support/cases/${id}/messages`, admin, { body: "On it.", visibility: "CUSTOMER" })).status).toBe(201);
    list = await (await portal("GET", "/cases", hW2Cookie)).json();
    expect(list.cases.find((c: any) => c.id === id).unread).toBe(true);
    // Internal notes never touch the customer side.
    expect((await portal("GET", `/cases/${id}`, hW2Cookie)).status).toBe(200);
    expect((await api("POST", `/api/support/cases/${id}/messages`, admin, { body: "private", visibility: "INTERNAL" })).status).toBe(201);
    list = await (await portal("GET", "/cases", hW2Cookie)).json();
    expect(list.cases.find((c: any) => c.id === id).unread).toBe(false);
  });

  it.skipIf(!process.env.EMAIL_CAPTURE_DIR)("a customer's reply is mailed to the other followers but not to the author", async () => {
    const { waitForCapturedEmail, clearCapturedEmails } = await import("../helpers/email-capture");
    const dir = process.env.EMAIL_CAPTURE_DIR!;
    const r = await portal("POST", "/cases", hReqCookie, { subject: `Fan-out ${stamp}`, watcherContactIds: [hW2Id], reviewerContactIds: [hW1Id] });
    const id = (await r.json()).id;
    await new Promise(res => setTimeout(res, 1500)); // let the creation mails land before clearing
    await clearCapturedEmails(dir).catch(() => {});
    const at = Date.now();
    expect((await portal("POST", `/cases/${id}/messages`, hReqCookie, { body: "Any news?" })).status).toBe(201);
    const walt = await waitForCapturedEmail({ to: hW2Email, subject: new RegExp(`Fan-out ${stamp}`) }, { dir, sinceMs: at - 5, timeoutMs: 8000 });
    expect(walt.text || walt.html).toContain("Any news?");
    const wanda = await waitForCapturedEmail({ to: hW1Email, subject: new RegExp(`Fan-out ${stamp}`) }, { dir, sinceMs: at - 5, timeoutMs: 8000 });
    expect(wanda.text || "").toContain("review only");
    await expect(waitForCapturedEmail({ to: hReqEmail, subject: new RegExp(`Fan-out ${stamp}`) }, { dir, sinceMs: at - 5, timeoutMs: 2500 })).rejects.toThrow();
  });

  it("inbound mail follows the same authority: watchers append until removed; a reassigned requester's old address is stored; legacy email-only requesters append", async () => {
    const inbound = (from: string, subject: string, extra: Record<string, unknown> = {}) => fetch(`${BASE}/api/test/inbound-email`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: "support@cwpro.dev", subject, text: `reply from ${from}`, messageId: `<${Math.random()}.${stamp}@test>`, senderAuthenticated: true, orgId: hOrgId, ...extra }),
    }).then(r => r.json());
    // Wanda is a verified watcher on the watched case.
    const ws = await (await portal("GET", `/cases/${watchedCaseId}/watchers`, hReqCookie)).json();
    expect(ws.map((w: any) => w.contactId)).toContain(hW1Id);
    expect((await inbound(`Wanda <${hW1Email}>`, `Re: [${watchedCaseKey}] loop`)).outcome).toBe("appended");
    const rm = await portal("DELETE", `/cases/${watchedCaseId}/watchers/${hW1Id}`, hReqCookie);
    expect(rm.status, await rm.clone().text()).toBe(200);
    expect((await inbound(`Wanda <${hW1Email}>`, `Re: [${watchedCaseKey}] loop`)).outcome).toBe("stored");
    // Walt still watches → appended; Olga never did → stored.
    expect((await inbound(`Walt <${hW2Email}>`, `Re: [${watchedCaseKey}] loop`)).outcome).toBe("appended");
    expect((await inbound(`Olga <${hOutEmail}>`, `Re: [${watchedCaseKey}] loop`)).outcome).toBe("stored");
    // The old requester email on the reassigned case no longer carries authority; the linked contact does.
    expect((await inbound(`Wanda <${hW1Email}>`, `Re: [${reassignedCaseKey}] legacy`)).outcome).toBe("stored");
    expect((await inbound(`Walt <${hW2Email}>`, `Re: [${reassignedCaseKey}] legacy`)).outcome).toBe("appended");
    // A legacy email-only case (no requesterContactId): its requester_email appends.
    const k = await api("POST", "/api/support/cases", admin, { clientId: hClientId, subject: `Pure email case ${stamp}`, requesterName: "Olga Outside", requesterEmail: hOutEmail });
    const legacy = await k.json();
    expect(legacy.requesterContactId).toBeNull();
    expect((await inbound(`Olga <${hOutEmail}>`, `Re: [${legacy.caseKey}] pure`)).outcome).toBe("appended");
    expect((await inbound(`Olga <${hOutEmail}>`, `Re: [${legacy.caseKey}] pure`, { senderAuthenticated: false })).outcome).toBe("stored");
    const d = await (await api("GET", `/api/support/cases/${legacy.id}`, admin)).json();
    expect(d.messages.length).toBe(1);
    expect(d.messages[0].authorContactId ?? d.messages[0].authorName).toBeTruthy();
    // Nothing above opened a second case.
    expect((await firmCases()).filter(c => /^Re: /.test(c.subject) || /\bloop\b|\blegacy\b|\bpure\b/.test(c.subject)).length).toBe(0);
  });

  // Captured mail needs EMAIL_CAPTURE_DIR on the test server. `cwp vitest` does not set it (only
  // `cwp app-bg` / `cwp e2e` do); run `EMAIL_CAPTURE_DIR=/tmp/cherry-e2e-emails cwp vitest tests/integration/help-center.test.ts`
  // to exercise this test.
  it.skipIf(!process.env.EMAIL_CAPTURE_DIR)("notifications: an agent's reply on a case with a watcher mails both the requester and the watcher (captured mail)", async () => {
    const r = await portal("POST", "/cases", hReqCookie, { subject: `Mail fan-out ${stamp}`, watcherContactIds: [hW2Id] });
    expect(r.status).toBe(201);
    const { id, caseKey } = await r.json();
    const since = Date.now();
    const m = await api("POST", `/api/support/cases/${id}/messages`, admin, { body: "Here is the fix.", visibility: "CUSTOMER" });
    expect(m.status, await m.clone().text()).toBe(201);
    // Every case mail carries "[KEY] subject", so match the reply by its body (the "we've received
    // your request" mail from creation shares the subject line).
    const subject = `[${caseKey}] Mail fan-out ${stamp}`;
    const toReq = await waitForCapturedEmail({ to: hReqEmail, subject, htmlIncludes: "Here is the fix." }, { sinceMs: since, timeoutMs: 8000 });
    const toWatcher = await waitForCapturedEmail({ to: hW2Email, subject, htmlIncludes: "Here is the fix." }, { sinceMs: since, timeoutMs: 8000 });
    expect(toReq.html).toContain(`/help/${orgSlug}/cases/${id}`);
    expect(toWatcher.html).toContain(`/help/${orgSlug}/cases/${id}`);
    // Nobody else on the client is mailed.
    await expect(waitForCapturedEmail({ to: hOutEmail, subject }, { sinceMs: since, timeoutMs: 1500 })).rejects.toThrow(/Timed out/);
  });
});
