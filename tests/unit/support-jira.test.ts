import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import type { AddressInfo } from "net";
import { TEST_BASE as BASE } from "../helpers/base";
import { adfToText, shapeIssue } from "../../server/support-jira";

const stamp = Date.now();
interface Ctx { cookie: string; csrfToken: string }
let admin: Ctx = { cookie: "", csrfToken: "" };
let clientId = "";
let fake: http.Server;
let fakeUrl = "";
let authSeen = "";

const ADF = (text: string) => ({ type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const issue = (n: number, extra: any = {}) => ({
  key: `ZJR-${n}`,
  fields: {
    summary: `Issue ${n}`, description: ADF(`Body of ${n}`), status: { name: n % 2 ? "Waiting for support" : "Resolved", statusCategory: { key: n % 2 ? "new" : "done" } },
    created: `2026-0${(n % 8) + 1}-10T09:00:00.000-0400`, updated: `2026-08-20T09:00:00.000-0400`, resolutiondate: n % 2 ? null : "2026-08-21T09:00:00.000-0400",
    reporter: { displayName: "Shadi Mohaisen", emailAddress: `shadi.${stamp}@abs.example`, accountType: "customer" },
    assignee: { displayName: "Ada Adminson", emailAddress: "admin.test@cwpro.dev", accountType: "atlassian" },
    priority: { name: "High" }, issuetype: { name: "Support" }, customfield_10010: { requestType: { name: "ERP Support Requests" } }, components: [],
    ...extra,
  },
  changelog: { histories: [{ created: "2026-08-11T09:00:00.000-0400", author: { displayName: "Ada Adminson" }, items: [{ field: "status", fromString: "Open", toString: "Waiting for support" }] }] },
});

describe("Jira fetcher", () => {
  beforeAll(async () => {
    fake = http.createServer((req, res) => {
      authSeen = String(req.headers.authorization || "");
      const url = new URL(req.url || "/", "http://x");
      const json = (o: any) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(o)); };
      if (url.pathname === "/rest/api/3/myself") return json({ displayName: "Dean Dunagan", emailAddress: "dean@example.com" });
      if (url.pathname === "/rest/api/3/search/jql") {
        const token = url.searchParams.get("nextPageToken");
        if (!token) return json({ issues: [issue(1), issue(2)], isLast: false, nextPageToken: "p2" });
        return json({ issues: [issue(3)], isLast: true });
      }
      const m = url.pathname.match(/^\/rest\/api\/3\/issue\/([^/]+)\/comment$/);
      if (m) {
        return json({ total: 2, comments: [
          { author: { displayName: "Shadi Mohaisen", emailAddress: `shadi.${stamp}@abs.example`, accountType: "customer" }, jsdPublic: true, created: "2026-08-10T10:00:00.000-0400", body: ADF("Customer says hi") },
          { author: { displayName: "Ada Adminson", emailAddress: "admin.test@cwpro.dev", accountType: "atlassian" }, jsdPublic: false, created: "2026-08-10T11:00:00.000-0400", body: ADF("Internal note") },
        ] });
      }
      res.statusCode = 404; res.end("nope");
    });
    await new Promise<void>(r => fake.listen(0, "127.0.0.1", () => r()));
    fakeUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
    admin = await login("admin.test@cwpro.dev", "admin123");
    const c = await api("POST", "/api/clients", admin, { name: `ZJR Jira Client ${stamp}` });
    clientId = (await c.json()).id;
  });

  it("flattens ADF", () => {
    expect(adfToText({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello " }, { type: "mention", attrs: { text: "@Dean" } }] }, { type: "mediaSingle" }] }).trim()).toBe("Hello @Dean\n[attachment]");
  });

  it("shapes an issue with comments and transitions", () => {
    const s = shapeIssue(issue(5), []);
    expect(s.key).toBe("ZJR-5");
    expect(s.description).toBe("Body of 5");
    expect(s.requestType).toBe("ERP Support Requests");
    expect(s.reporterIsAgent).toBe(false);
    expect(s.transitions[0]).toEqual({ from: "Open", to: "Waiting for support", at: "2026-08-11T09:00:00.000-0400", by: "Ada Adminson" });
  });

  it("jira-test connects with Basic auth and counts issues across pages", async () => {
    const res = await api("POST", "/api/support/import/jira-test", admin, { baseUrl: fakeUrl, email: "dean@example.com", apiToken: "tok_12345678", projectKey: "ZJR" });
    expect(res.ok, await res.clone().text()).toBe(true);
    const r = await res.json();
    expect(r.connectedAs).toBe("Dean Dunagan");
    expect(r.issues).toBe(3);
    expect(r.lastKey).toBe("ZJR-3");
    expect(authSeen.startsWith("Basic ")).toBe(true);
    expect(Buffer.from(authSeen.slice(6), "base64").toString()).toBe("dean@example.com:tok_12345678");
  });

  it("jira-fetch pulls, imports, and reports", async () => {
    const dry = await (await api("POST", "/api/support/import/jira-fetch", admin, { baseUrl: fakeUrl, email: "dean@example.com", apiToken: "tok_12345678", projectKey: "ZJR", clientId, dryRun: true })).json();
    expect(dry.pulled).toBe(3);
    expect(dry.imported).toBe(3);
    const real = await (await api("POST", "/api/support/import/jira-fetch", admin, { baseUrl: fakeUrl, email: "dean@example.com", apiToken: "tok_12345678", projectKey: "ZJR", clientId })).json();
    expect(real.imported).toBe(3);
    expect(real.nextCaseNumber).toBe(4);
    const list = await (await api("GET", `/api/support/cases?view=all&clientId=${clientId}`, admin)).json();
    expect(list.map((r: any) => r.caseKey).sort()).toEqual(["ZJR-1", "ZJR-2", "ZJR-3"]);
    const d = await (await api("GET", `/api/support/cases/${list.find((r: any) => r.caseKey === "ZJR-2").id}`, admin)).json();
    expect(d.status).toBe("RESOLVED");
    expect(d.messages.map((m: any) => m.visibility)).toEqual(["CUSTOMER", "INTERNAL"]);
    expect(d.typeName).toBe("ERP Support Request");
  });

  it("refuses bad credentials cleanly", async () => {
    const res = await api("POST", "/api/support/import/jira-test", admin, { baseUrl: fakeUrl + "/missing", email: "dean@example.com", apiToken: "tok_12345678", projectKey: "ZJR" });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/Jira 404/);
  });

  afterAll(async () => {
    await new Promise<void>(r => fake.close(() => r()));
    const list = await (await api("GET", `/api/support/cases?view=all&clientId=${clientId}`, admin)).json().catch(() => []);
    for (const r of Array.isArray(list) ? list : []) await api("DELETE", `/api/support/cases/${r.id}`, admin).catch(() => {});
    const contacts = await (await api("GET", `/api/clients/${clientId}/contacts`, admin)).json().catch(() => []);
    for (const c of Array.isArray(contacts) ? contacts : []) await api("DELETE", `/api/clients/${clientId}/contacts/${c.id}`, admin).catch(() => {});
    if (clientId) await api("DELETE", `/api/clients/${clientId}`, admin).catch(() => {});
  });
});

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
