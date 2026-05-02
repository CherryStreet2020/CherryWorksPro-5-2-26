/**
 * Sprint 2g.7 — E1, E2: end-to-end mailbox provider flow.
 *
 * E1 — Happy path with the OAuth flag OFF (default in dev). Login → set
 *      provider to "smtp" via the API → generate + send an invoice and
 *      assert the response is OK (the existing nodemailer / SmtpTransport
 *      path is exercised end-to-end through the real Express server).
 *
 * E2 — Flag-on smoke. When EMAIL_OAUTH_ENABLED=true and a stub Graph
 *      endpoint is wired via GRAPH_TRANSPORT_TEST_URL_OVERRIDE, the OAuth
 *      start endpoint becomes reachable and redirects to Microsoft. Without
 *      a live consent screen we can't complete OAuth in CI, so the spec
 *      asserts the gating + redirect behavior.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";

const ADMIN_EMAIL = "dean@cherrystconsulting.com";
const ADMIN_PASS = "CherryWorks2026!";

async function login(api: APIRequestContext): Promise<{ csrf: string }> {
  const r = await api.post("/api/auth/login", { data: { email: ADMIN_EMAIL, password: ADMIN_PASS } });
  expect(r.status()).toBe(200);
  const tok = await api.get("/api/csrf-token");
  expect(tok.status()).toBe(200);
  const body = await tok.json();
  const csrf = (body.token ?? body.csrfToken) as string;
  expect(csrf).toBeTruthy();
  return { csrf };
}

test.describe("E1 — flag-off invoice send via SmtpTransport", () => {
  test("provider read/write API + real invoice send flows end-to-end", async ({ request }) => {
    const { csrf } = await login(request);
    const headers = { "x-csrf-token": csrf };
    const post = (url: string, data?: any) => request.post(url, { data: data ?? {}, headers });

    const before = await request.get("/api/org/email-provider");
    expect(before.status()).toBe(200);
    const beforeBody = await before.json();
    expect(beforeBody).toHaveProperty("providerType");
    expect(beforeBody).toHaveProperty("oauthFlagEnabled");

    const put = await request.put("/api/org/email-provider", { data: { providerType: "smtp" }, headers });
    expect(put.status()).toBe(200);
    expect((await put.json()).providerType).toBe("smtp");

    const after = await request.get("/api/org/email-provider");
    expect((await after.json()).providerType).toBe("smtp");

    // Drive the actual invoice send pipeline. The transport selector should
    // pick SmtpTransport (flag off OR provider='smtp') and the request
    // should succeed regardless of whether real SMTP is configured (the
    // "no transport" branch returns ok=true without throwing).
    const stamp = Date.now();
    const cli = await post("/api/clients", { name: `E1-Client-${stamp}`, email: `e1-${stamp}@example.com`, currency: "USD" });
    expect(cli.status()).toBe(200);
    const clientId = (await cli.json()).id as string;

    const prj = await post("/api/projects", { name: `E1-Project-${stamp}`, clientId, status: "ACTIVE" });
    expect(prj.status()).toBe(200);
    const projectId = (await prj.json()).id as string;

    const today = new Date().toISOString().slice(0, 10);
    const te = await post("/api/time-entries", {
      projectId, date: today, minutes: 60, billable: true, notes: "E1 unit",
    });
    expect(te.status()).toBe(200);

    const inv = await post("/api/invoices/generate", { clientId, includeUnapproved: true });
    expect(inv.status()).toBe(200);
    const invId = (await inv.json()).id as string;

    const send = await post(`/api/invoices/${invId}/send`);
    expect(send.status()).toBe(200);
    const sendBody = await send.json();
    expect(sendBody.ok).toBe(true);
  });

  test("rejects unknown provider type with 400", async ({ request }) => {
    const { csrf } = await login(request);
    const r = await request.put("/api/org/email-provider", {
      data: { providerType: "carrier-pigeon" },
      headers: { "x-csrf-token": csrf },
    });
    expect(r.status()).toBe(400);
  });
});

test.describe("E2 — flag-on Graph stub via GRAPH_TRANSPORT_TEST_URL_OVERRIDE", () => {
  test("microsoft/start returns 404 when EMAIL_OAUTH_ENABLED is OFF", async ({ request }) => {
    await login(request);
    test.skip(
      process.env.EMAIL_OAUTH_ENABLED === "true",
      "Skipping flag-off assertion: EMAIL_OAUTH_ENABLED is true in this run",
    );
    const r = await request.get("/api/auth/oauth/microsoft/start", { maxRedirects: 0 });
    expect(r.status()).toBe(404);
  });

  test("microsoft/start redirects to Microsoft authorize URL when flag is ON", async ({ request }) => {
    await login(request);
    test.skip(
      process.env.EMAIL_OAUTH_ENABLED !== "true" ||
        !process.env.MS_OAUTH_CLIENT_ID ||
        !process.env.GRAPH_TRANSPORT_TEST_URL_OVERRIDE,
      "Skipping flag-on assertion: requires EMAIL_OAUTH_ENABLED=true, MS_OAUTH_CLIENT_ID, and GRAPH_TRANSPORT_TEST_URL_OVERRIDE",
    );
    const r = await request.get("/api/auth/oauth/microsoft/start", { maxRedirects: 0 });
    expect([301, 302]).toContain(r.status());
    const loc = r.headers()["location"] || "";
    expect(loc).toContain("login.microsoftonline.com");
    expect(loc).toContain("client_id=");
  });
});
