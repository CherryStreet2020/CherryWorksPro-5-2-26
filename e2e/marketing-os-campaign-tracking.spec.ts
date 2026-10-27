// First-party open / click tracking, end to end: a campaign is delivered for
// real (through the org's own SMTP settings, pointed at an in-process sink),
// the spec reads the pixel and click URLs out of the delivered message, hits
// them over HTTP, and checks the counts in the metrics API and the UI.
process.env.MARKETING_OS_ENABLED = "true";
process.env.VITE_MARKETING_OS_ENABLED = "true";
process.env.EMAIL_OAUTH_ENABLED = "false";
process.env.MARKETING_EMAIL_TRACKING_ENABLED = "true";
delete process.env.SMTP_HOST;
delete process.env.SMTP_PORT;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;

import { request as pwRequest } from "@playwright/test";
import { test, expect } from "../tests/helpers/po/fixtures";
import { setEntitlement } from "../tests/helpers/po/tier";
import { BASE } from "../tests/helpers/po/auth";
import { createBrand } from "../tests/helpers/po/brands";
import {
  addUserToIsolatedOrg,
  buildIsolatedRequest,
  createIsolatedOrg,
  deleteIsolatedOrg,
} from "../tests/helpers/po/isolation";
import { loginIsolated } from "./_iso-helpers";
import { htmlPartOf, startSmtpSink, type SmtpSink } from "./_smtp-sink";
import { pool } from "../server/db";
import { runScheduledSendTick } from "../server/marketing/scheduled-send";

/**
 * Dispatch through the advisory-locked tick, as the app's own worker does, so
 * the two can never deliver the same campaign at once. While the worker holds
 * the lock the tick returns null; retry until we run one ourselves, by which
 * time any concurrent worker tick has finished.
 */
async function dispatchLocked(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while ((await runScheduledSendTick()) === null) {
    if (Date.now() > deadline) throw new Error("scheduled-send lock never came free");
    await new Promise((r) => setTimeout(r, 200));
  }
}

const HDRS = (csrf: string) => ({ "x-csrf-token": csrf });
const LANDING = "https://example.test/landing?a=1&b=2";

let sink: SmtpSink;
test.beforeAll(async () => { sink = await startSmtpSink(); });
test.afterAll(async () => { await sink?.close(); });

/** Point the org's own SMTP settings at the sink (plaintext pass is read back as-is). */
async function useSink(orgId: string) {
  await pool.query(
    `UPDATE orgs SET smtp_host = '127.0.0.1', smtp_port = $2, smtp_user = $3, smtp_pass = 'sinkpass',
                     email_provider_type = 'smtp'
      WHERE id = $1`,
    [orgId, sink.port, `sink-${orgId}`],
  );
}

/** Path + query of the first URL in `html` matching `re`. */
function pathOf(html: string, re: RegExp): string {
  const m = re.exec(html);
  if (!m) throw new Error(`no URL matching ${re} in delivered html`);
  const u = new URL(m[0]);
  return u.pathname + u.search;
}

test.describe("Marketing OS — campaign open / click tracking", () => {
  test("a delivered campaign counts its open and click, and the UI shows them", async ({ page, isolatedOrg }) => {
    test.setTimeout(60_000);
    const { request, csrf, orgId } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);
    await useSink(orgId);
    const brand = await createBrand(isolatedOrg, {
      name: "Track", slug: "track", domain: "track.test", fromEmail: "noreply@track.test",
    });
    const to = `reader-${orgId.slice(0, 8)}@track.test`;
    const contact = await request.post(`${BASE}/api/marketing/contacts`, {
      headers: HDRS(csrf),
      data: { brandId: brand.id, firstName: "Rea", lastName: "Der", email: to },
    });
    expect(contact.status()).toBeLessThan(300);
    const camp = await (await request.post(`${BASE}/api/marketing/campaigns`, {
      headers: HDRS(csrf),
      data: {
        brandId: brand.id, name: "Tracked Camp", subject: "Hello",
        body: `<p>Read <a href="https://example.test/landing?a=1&amp;b=2">our news</a>.</p>`,
        fromEmail: "noreply@track.test", fromName: "Track", audienceType: "all",
      },
    })).json();
    await pool.query(
      `UPDATE marketing_campaigns SET send_at = NOW() - INTERVAL '60 seconds' WHERE id = $1`,
      [camp.id],
    );
    await dispatchLocked();

    const attempts = await pool.query(
      `SELECT status FROM email_send_attempts WHERE campaign_id = $1`, [camp.id],
    );
    expect(attempts.rows.map((r) => r.status)).toEqual(["success"]);

    const html = htmlPartOf((await sink.waitFor(to)).raw);
    expect(sink.messages.filter((m) => m.to.includes(to))).toHaveLength(1);
    expect(html).not.toContain("https://example.test/landing");
    const pixel = pathOf(html, /https?:\/\/[^"'\s]+\/api\/public\/email\/o\/[A-Za-z0-9_-]{32}\.gif/);
    const clickPath = pathOf(html, /https?:\/\/[^"'\s]+\/api\/public\/email\/c\/[A-Za-z0-9_-]{32}\/0/);
    const token = /\/c\/([A-Za-z0-9_-]{32})\//.exec(clickPath)![1];
    // The unsubscribe footer stays a direct link.
    expect(html).toMatch(/href="[^"]*\/unsubscribe\/[0-9a-f-]{36}"/);

    // Recipients are anonymous; a stale session cookie from a mail client must not matter.
    const anon = await pwRequest.newContext({ baseURL: BASE });
    try {
      const gif = await anon.get(`${BASE}${pixel}`, { headers: { Cookie: "connect.sid=s%3Astale.junk" } });
      expect(gif.status()).toBe(200);
      expect(gif.headers()["content-type"]).toContain("image/gif");
      expect(gif.headers()["cache-control"]).toContain("no-store");

      const click = await anon.get(`${BASE}${clickPath}`, { maxRedirects: 0 });
      expect(click.status()).toBe(302);
      expect(click.headers()["location"]).toBe(LANDING);

      // Only stored destinations: a bad index or an unknown token is a 404 with no Location.
      for (const bad of [`/api/public/email/c/${token}/1`, `/api/public/email/c/${"A".repeat(32)}/0`]) {
        const r = await anon.get(`${BASE}${bad}`, { maxRedirects: 0 });
        expect(r.status(), bad).toBe(404);
        expect(r.headers()["location"], bad).toBeUndefined();
      }
    } finally {
      await anon.dispose();
    }

    const metrics = await (await request.get(`${BASE}/api/marketing/campaigns/${camp.id}/metrics`)).json();
    expect(metrics).toMatchObject({ sent: 1, opened: 1, clicked: 1, opens: 1, clicks: 1 });
    const engagement = await (await request.get(
      `${BASE}/api/marketing/campaigns/engagement?brandId=${brand.id}`,
    )).json();
    expect(engagement[camp.id]).toMatchObject({ sent: 1, opened: 1, clicked: 1 });

    await loginIsolated(page, isolatedOrg);
    await page.goto(`/marketing/campaigns/${camp.id}`);
    await expect(page.locator('[data-testid="tile-metric-opened-value"]')).toHaveText("1", { timeout: 15_000 });
    await expect(page.locator('[data-testid="tile-metric-clicked-value"]')).toHaveText("1");
    await expect(page.locator('[data-testid="tile-metric-opened-rate"]')).toHaveText("100%");
    await page.screenshot({ path: `${process.env.E2E_CAPTURE_DIR || "/tmp"}/campaign-tracking-detail.png` });
    await page.goto("/marketing/campaigns");
    await expect(page.locator(`[data-testid="text-campaign-opened-${camp.id}"]`)).toHaveText("1", { timeout: 15_000 });
    await expect(page.locator(`[data-testid="text-campaign-clicked-${camp.id}"]`)).toHaveText("1");
    await page.screenshot({ path: `${process.env.E2E_CAPTURE_DIR || "/tmp"}/campaign-tracking-list.png` });

    // Links already in inboxes keep working after the campaign is deleted.
    expect((await request.delete(`${BASE}/api/marketing/campaigns/${camp.id}`, { headers: HDRS(csrf) })).status()).toBe(200);
    const after = await request.get(`${BASE}${clickPath}`, { maxRedirects: 0 });
    expect(after.status()).toBe(302);
    expect(after.headers()["location"]).toBe(LANDING);
  });

  test("engagement is admin/manager-only and scoped to the caller's brands", async ({ isolatedOrg }) => {
    const { request, csrf, orgId } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);
    const brandA = await createBrand(isolatedOrg, { name: "EngA", slug: "eng-a", domain: "eng-a.test" });
    const brandB = await createBrand(isolatedOrg, { name: "EngB", slug: "eng-b", domain: "eng-b.test" });
    const campA = await (await request.post(`${BASE}/api/marketing/campaigns`, {
      headers: HDRS(csrf),
      data: { brandId: brandA.id, name: "A", subject: "A", body: "<p/>", fromEmail: "a@eng-a.test", fromName: "A", audienceType: "all" },
    })).json();
    const campB = await (await request.post(`${BASE}/api/marketing/campaigns`, {
      headers: HDRS(csrf),
      data: { brandId: brandB.id, name: "B", subject: "B", body: "<p/>", fromEmail: "b@eng-b.test", fromName: "B", audienceType: "all" },
    })).json();

    const draftA = await (await request.post(`${BASE}/api/marketing/campaigns`, {
      headers: HDRS(csrf),
      data: { brandId: brandA.id, name: "Draft", subject: "D", body: "<p/>", fromEmail: "a@eng-a.test", fromName: "A", audienceType: "all" },
    })).json();
    // Delivered sends with distinct counts per brand: A one, B two. The draft has none.
    for (const [c, n] of [[campA, 1], [campB, 2]] as const) {
      for (let i = 0; i < n; i++) {
        await pool.query(
          `INSERT INTO email_send_attempts (org_id, kind, campaign_id, recipient_email, status, transport)
           VALUES ($1, 'campaign', $2, $3, 'success', 'mailbox')`,
          [orgId, c.id, `r${i}@eng.test`],
        );
      }
    }
    const a = await (await request.get(`${BASE}/api/marketing/campaigns/engagement?brandId=${brandA.id}`)).json();
    expect(a).toEqual({ [campA.id]: { sent: 1, opened: 0, clicked: 0 } });
    expect(Object.keys(a)).not.toContain(draftA.id);
    const b = await (await request.get(`${BASE}/api/marketing/campaigns/engagement?brandId=${brandB.id}`)).json();
    expect(b).toEqual({ [campB.id]: { sent: 2, opened: 0, clicked: 0 } });

    const anon = await pwRequest.newContext({ baseURL: BASE });
    try {
      // flagGate answers anonymous callers with its stealth 404.
      expect((await anon.get(`${BASE}/api/marketing/campaigns/engagement?brandId=${brandA.id}`)).status()).toBe(404);
    } finally {
      await anon.dispose();
    }

    const member = await addUserToIsolatedOrg(orgId, "TEAM_MEMBER");
    const memberCtx = await buildIsolatedRequest({ ...isolatedOrg, email: member.email, password: member.password });
    try {
      expect((await memberCtx.request.get(`${BASE}/api/marketing/campaigns/engagement?brandId=${brandA.id}`)).status()).toBe(403);
    } finally {
      await memberCtx.request.dispose();
    }

    const other = await createIsolatedOrg({ firmProfileComplete: true });
    try {
      const otherCtx = await buildIsolatedRequest(other);
      try {
        await setEntitlement(other.orgId, "marketing_os", true);
        const r = await otherCtx.request.get(`${BASE}/api/marketing/campaigns/engagement?brandId=${brandA.id}`);
        expect(r.status()).toBe(404);
      } finally {
        await otherCtx.request.dispose();
      }
    } finally {
      await deleteIsolatedOrg(other.orgId);
    }
  });
});
