import { describe, it, expect, afterAll } from "vitest";
import { TEST_BASE as BASE } from "../helpers/base";

interface Ctx { cookie: string; csrfToken: string }
let admin: Ctx = { cookie: "", csrfToken: "" };
let team: Ctx = { cookie: "", csrfToken: "" };
let clientId = "";
let contactId = "";
let caseId = "";
let attachmentId = "";
let portalCookie = "";
let orgSlug = "";
const stamp = Date.now();
const contactEmail = `files.${stamp}@example.com`;

// 1x1 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

async function api(method: string, path: string, ctx: Ctx, body?: any) {
  const opts: RequestInit = { method, headers: { "Content-Type": "application/json", Cookie: ctx.cookie, "X-CSRF-Token": ctx.csrfToken } };
  if (body) opts.body = JSON.stringify(body);
  return fetch(`${BASE}${path}`, opts);
}
async function upload(path: string, ctx: Ctx, files: { name: string; bytes: Buffer; type: string }[], extraHeaders: Record<string, string> = {}) {
  const fd = new FormData();
  for (const f of files) fd.append("files", new Blob([f.bytes], { type: f.type }), f.name);
  return fetch(`${BASE}${path}`, { method: "POST", headers: { Cookie: ctx.cookie, "X-CSRF-Token": ctx.csrfToken, ...extraHeaders }, body: fd });
}
async function login(email: string, password: string): Promise<Ctx> {
  const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const cookies = res.headers.getSetCookie?.() ?? [];
  return { cookie: cookies.map((c: string) => c.split(";")[0]).join("; "), csrfToken: res.headers.get("x-csrf-token") || "" };
}
async function portal(method: string, path: string, cookie: string, body?: any) {
  const opts: RequestInit = { method, headers: { "Content-Type": "application/json", "X-Requested-With": "cwp-portal", ...(cookie ? { Cookie: cookie } : {}) } };
  if (body) opts.body = JSON.stringify(body);
  return fetch(`${BASE}/api/portal/${orgSlug}${path}`, opts);
}

describe("support case attachments", () => {
  it("setup", async () => {
    admin = await login("admin.test@cwpro.dev", "admin123");
    team = await login("team.test@cwpro.dev", "team123");
    orgSlug = (await (await api("GET", "/api/support/portal-info", admin)).json()).orgSlug;
    const c = await api("POST", "/api/clients", admin, { name: `Files Client ${stamp}` });
    clientId = (await c.json()).id;
    const ct = await api("POST", `/api/clients/${clientId}/contacts`, admin, { firstName: "Ronald", lastName: "Ndanga", email: contactEmail, isPrimary: true });
    contactId = (await ct.json()).id;
    const k = await api("POST", "/api/support/cases", admin, { clientId, subject: "PO column blank", requesterContactId: contactId });
    caseId = (await k.json()).id;
  });

  it("agent uploads an image and a PDF; the case lists them; the image streams inline", async () => {
    const res = await upload(`/api/support/cases/${caseId}/attachments`, admin, [
      { name: "screen shot.png", bytes: PNG, type: "image/png" },
      { name: "spec.pdf", bytes: Buffer.from("%PDF-1.4 test"), type: "application/pdf" },
    ]);
    expect(res.status, await res.clone().text()).toBe(201);
    const rows = await res.json();
    expect(rows.length).toBe(2);
    expect(rows[0].isImage).toBe(true);
    expect(rows[0].filename).toBe("screen shot.png");
    attachmentId = rows[0].id;

    const detail = await (await api("GET", `/api/support/cases/${caseId}`, admin)).json();
    expect(detail.attachments.length).toBe(2);
    expect(detail.attachments[0].url).toBe(`/api/support/attachments/${attachmentId}`);
    expect(JSON.stringify(detail.attachments)).not.toMatch(/storageKey/);

    const dl = await fetch(`${BASE}/api/support/attachments/${attachmentId}`, { headers: { Cookie: admin.cookie } });
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-type")).toContain("image/png");
    expect(dl.headers.get("content-disposition")).toMatch(/^inline/);
    expect(Buffer.from(await dl.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it("refuses dangerous types and empty uploads", async () => {
    const bad = await upload(`/api/support/cases/${caseId}/attachments`, admin, [{ name: "evil.exe", bytes: Buffer.from("MZ"), type: "application/octet-stream" }]);
    expect(bad.status).toBe(400);
    expect((await bad.json()).message).toMatch(/not allowed/i);
    const none = await fetch(`${BASE}/api/support/cases/${caseId}/attachments`, { method: "POST", headers: { Cookie: admin.cookie, "X-CSRF-Token": admin.csrfToken }, body: new FormData() });
    expect(none.status).toBe(400);
  });

  it("the portal contact sees and downloads the files, and can add one", async () => {
    const req = await portal("POST", "/auth/request-link", "", { email: contactEmail });
    const { debugLink } = await req.json();
    const token = new URL(debugLink, "http://localhost").searchParams.get("token")!;
    const verify = await portal("POST", "/auth/verify", "", { token });
    portalCookie = (verify.headers.getSetCookie?.() ?? []).find(x => x.startsWith("cwp_portal="))!.split(";")[0];

    const detail = await (await portal("GET", `/cases/${caseId}`, portalCookie)).json();
    expect(detail.attachments.length).toBe(2);
    expect(detail.attachments[0].url).toBe(`/api/portal/${orgSlug}/attachments/${attachmentId}`);
    const dl = await fetch(`${BASE}${detail.attachments[0].url}`, { headers: { Cookie: portalCookie } });
    expect(dl.status).toBe(200);

    const fd = new FormData();
    fd.append("files", new Blob([PNG], { type: "image/png" }), "from-portal.png");
    const up = await fetch(`${BASE}/api/portal/${orgSlug}/cases/${caseId}/attachments`, { method: "POST", headers: { Cookie: portalCookie, "X-Requested-With": "cwp-portal" }, body: fd });
    expect(up.status, await up.clone().text()).toBe(201);
    const after = await (await api("GET", `/api/support/cases/${caseId}`, admin)).json();
    expect(after.attachments.length).toBe(3);
    expect(after.attachments[2].source).toBe("PORTAL");
  });

  it("a team member cannot remove someone else's upload; a manager can", async () => {
    const denied = await api("DELETE", `/api/support/attachments/${attachmentId}`, team);
    expect(denied.status).toBe(403);
    const ok = await api("DELETE", `/api/support/attachments/${attachmentId}`, admin);
    expect(ok.ok).toBe(true);
    const gone = await fetch(`${BASE}/api/support/attachments/${attachmentId}`, { headers: { Cookie: admin.cookie } });
    expect(gone.status).toBe(404);
  });

  afterAll(async () => {
    if (caseId) await api("DELETE", `/api/support/cases/${caseId}`, admin).catch(() => {});
    if (contactId) await api("DELETE", `/api/clients/${clientId}/contacts/${contactId}`, admin).catch(() => {});
    if (clientId) await api("DELETE", `/api/clients/${clientId}`, admin).catch(() => {});
  });
});
