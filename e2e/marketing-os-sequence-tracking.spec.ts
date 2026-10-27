// First-party open / click tracking for sequence steps, end to end: a step is
// delivered for real (through the org's own SMTP settings, pointed at an
// in-process sink), the spec reads the pixel and click URLs out of the
// delivered message, hits them over HTTP, and checks the timeline, the
// engagement API and the sequence editor.
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
import { buildIsolatedRequest, createIsolatedOrg, deleteIsolatedOrg } from "../tests/helpers/po/isolation";
import { loginIsolated } from "./_iso-helpers";
import { htmlPartOf, startSmtpSink, type SmtpSink } from "./_smtp-sink";
import { pool } from "../server/db";
import { runScheduledSendTick } from "../server/marketing/scheduled-send";

/** Dispatch through the advisory-locked tick, as the app's own worker does. */
async function dispatchLocked(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while ((await runScheduledSendTick()) === null) {
    if (Date.now() > deadline) throw new Error("scheduled-send lock never came free");
    await new Promise((r) => setTimeout(r, 200));
  }
}

const HDRS = (csrf: string) => ({ "x-csrf-token": csrf });
const LANDING = "https://example.test/step?a=1&b=2";

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

test.describe("Marketing OS — sequence-step open / click tracking", () => {
  test("a delivered step counts its open and click, the timeline names the sequence, and the editor shows them", async ({ page, isolatedOrg }) => {
    test.setTimeout(60_000);
    const { request, csrf, orgId } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);
    await useSink(orgId);
    const brand = await createBrand(isolatedOrg, {
      name: "SeqTrack", slug: "seq-track", domain: "seq-track.test", fromEmail: "noreply@seq-track.test",
    });
    const to = `reader-${orgId.slice(0, 8)}@seq-track.test`;
    const contact = await (await request.post(`${BASE}/api/marketing/contacts`, {
      headers: HDRS(csrf),
      data: { brandId: brand.id, firstName: "Rea", lastName: "Der", email: to },
    })).json();
    const seqRes = await request.post(`${BASE}/api/marketing/sequences`, {
      headers: HDRS(csrf),
      data: { brandId: brand.id, name: "Tracked Seq" },
    });
    expect(seqRes.status()).toBe(201);
    const seq = (await seqRes.json()) as { id: string };
    expect((await request.put(`${BASE}/api/marketing/sequences/${seq.id}/steps`, {
      headers: HDRS(csrf),
      data: {
        steps: [
          { delayDays: 0, subject: "Hello", body: `<p>Read <a href="https://example.test/step?a=1&amp;b=2">this</a>.</p>` },
          { delayDays: 30, subject: "Later", body: "<p>Later</p>" },
        ],
      },
    })).status()).toBe(200);
    expect((await request.post(`${BASE}/api/marketing/sequences/${seq.id}/enrollments`, {
      headers: HDRS(csrf),
      data: { prospectIds: [contact.id] },
    })).status()).toBeLessThan(300);
    await pool.query(
      `UPDATE marketing_sequence_enrollments SET next_send_at = NOW() - INTERVAL '60 seconds' WHERE sequence_id = $1`,
      [seq.id],
    );
    await dispatchLocked();

    const attempts = await pool.query(
      `SELECT status, step_index FROM email_send_attempts WHERE sequence_id = $1`, [seq.id],
    );
    expect(attempts.rows).toEqual([{ status: "success", step_index: 0 }]);

    const html = htmlPartOf((await sink.waitFor(to)).raw);
    expect(sink.messages.filter((m) => m.to.includes(to))).toHaveLength(1);
    expect(html).not.toContain("https://example.test/step");
    const pixel = pathOf(html, /https?:\/\/[^"'\s]+\/api\/public\/email\/o\/[A-Za-z0-9_-]{32}\.gif/);
    const clickPath = pathOf(html, /https?:\/\/[^"'\s]+\/api\/public\/email\/c\/[A-Za-z0-9_-]{32}\/0/);
    // The unsubscribe footer stays a direct link.
    expect(html).toMatch(/href="[^"]*\/unsubscribe\/[0-9a-f-]{36}"/);

    const anon = await pwRequest.newContext({ baseURL: BASE });
    try {
      const gif = await anon.get(`${BASE}${pixel}`);
      expect(gif.status()).toBe(200);
      expect(gif.headers()["content-type"]).toContain("image/gif");
      const click = await anon.get(`${BASE}${clickPath}`, { maxRedirects: 0 });
      expect(click.status()).toBe(302);
      expect(click.headers()["location"]).toBe(LANDING);
    } finally {
      await anon.dispose();
    }

    const acts = await pool.query(
      `SELECT type, payload FROM contact_activities
        WHERE prospect_id = $1 AND type IN ('email_opened', 'email_clicked') ORDER BY type`,
      [contact.id],
    );
    expect(acts.rows.map((r) => r.type)).toEqual(["email_clicked", "email_opened"]);
    for (const r of acts.rows) {
      expect(r.payload).toMatchObject({ sequence_id: seq.id, sequence_name: "Tracked Seq", step_index: 0 });
    }

    const engagement = await (await request.get(`${BASE}/api/marketing/sequences/${seq.id}/engagement`)).json();
    expect(engagement).toEqual({ 0: { sent: 1, opened: 1, clicked: 1 } });

    await loginIsolated(page, isolatedOrg);
    await page.goto("/marketing/sequences");
    await page.click(`[data-testid="button-edit-sequence-${seq.id}"]`);
    const row = page.locator('[data-testid="row-step-engagement-0"]');
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText("Step 1");
    await expect(page.locator('[data-testid="text-step-opened-0"]')).toHaveText("1");
    await expect(page.locator('[data-testid="text-step-clicked-0"]')).toHaveText("1");
    await expect(page.locator('[data-testid="row-step-engagement-1"]')).toHaveCount(0);
    await page.screenshot({ path: `${process.env.E2E_CAPTURE_DIR || "/tmp"}/sequence-tracking-editor.png` });
  });

  test("sequence engagement is 404 for another org's sequence and for anonymous callers", async ({ isolatedOrg }) => {
    const { request, csrf, orgId } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);
    const brand = await createBrand(isolatedOrg, { name: "SeqEng", slug: "seq-eng", domain: "seq-eng.test" });
    const seq = await (await request.post(`${BASE}/api/marketing/sequences`, {
      headers: HDRS(csrf),
      data: { brandId: brand.id, name: "Eng Seq" },
    })).json();
    expect((await request.get(`${BASE}/api/marketing/sequences/${seq.id}/engagement`)).status()).toBe(200);

    const anon = await pwRequest.newContext({ baseURL: BASE });
    try {
      expect((await anon.get(`${BASE}/api/marketing/sequences/${seq.id}/engagement`)).status()).toBe(404);
    } finally {
      await anon.dispose();
    }

    const other = await createIsolatedOrg({ firmProfileComplete: true });
    try {
      const otherCtx = await buildIsolatedRequest(other);
      try {
        await setEntitlement(other.orgId, "marketing_os", true);
        expect((await otherCtx.request.get(`${BASE}/api/marketing/sequences/${seq.id}/engagement`)).status()).toBe(404);
      } finally {
        await otherCtx.request.dispose();
      }
    } finally {
      await deleteIsolatedOrg(other.orgId);
    }
  });
});
