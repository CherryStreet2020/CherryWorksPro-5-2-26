// Task #441 — Marketing OS audit §2.3: campaign metrics + send.
// MARKETING_OS env + SMTP wipe required so processScheduledCampaigns
// resolves the noop SmtpTransport branch instead of attempting a real
// Office365 auth. Same pattern as marketing-sequence-enrollment-cadence.
process.env.MARKETING_OS_ENABLED = "true";
process.env.VITE_MARKETING_OS_ENABLED = "true";
process.env.EMAIL_OAUTH_ENABLED = "false";
delete process.env.SMTP_HOST;
delete process.env.SMTP_PORT;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;

import { test, expect } from "../tests/helpers/po/fixtures";
import { setEntitlement } from "../tests/helpers/po/tier";
import { BASE } from "../tests/helpers/po/auth";
import { createBrand } from "../tests/helpers/po/brands";
import { loginIsolated } from "./_iso-helpers";
import { pool } from "../server/db";
import { processScheduledCampaigns } from "../server/marketing/scheduled-send";

const HDRS = (csrf: string) => ({ "x-csrf-token": csrf });

test.describe("Marketing OS — campaign metrics + scheduled-send", () => {
  test("audience-preview returns count + threshold", async ({ isolatedOrg }) => {
    const { request, csrf, orgId } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);
    const brand = await createBrand(isolatedOrg, {
      name: "Camp Brand", slug: "camp", domain: "camp.test", fromEmail: "noreply@camp.test",
    });
    for (let i = 0; i < 3; i++) {
      await request.post(`${BASE}/api/marketing/contacts`, {
        headers: HDRS(csrf),
        data: { brandId: brand.id, firstName: `Aud${i}`, lastName: "M", email: `aud${i}@camp.test` },
      });
    }
    const prev = await request.get(
      `${BASE}/api/marketing/campaigns/audience-preview?brandId=${brand.id}&audienceType=all`,
    );
    expect(prev.status()).toBe(200);
    const body = await prev.json();
    expect(body.count).toBe(3);
    expect(typeof body.threshold).toBe("number");
    expect(body.isLarge).toBe(false);
  });

  test("send-now precondition matrix: 422 / 400 / 409", async ({ isolatedOrg }) => {
    const { request, csrf, orgId } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);
    const brand = await createBrand(isolatedOrg, {
      name: "Send Brand", slug: "send", domain: "send.test", fromEmail: "noreply@send.test",
    });

    const empty = await (await request.post(`${BASE}/api/marketing/campaigns`, {
      headers: HDRS(csrf),
      data: {
        brandId: brand.id, name: "Empty", subject: "Hi", body: "<p>Hi</p>",
        fromEmail: "noreply@send.test", fromName: "S", audienceType: "all",
      },
    })).json();
    const r422 = await request.post(
      `${BASE}/api/marketing/campaigns/${empty.id}/send-now`,
      { headers: HDRS(csrf), data: {} },
    );
    expect(r422.status()).toBe(422);

    const bad = await (await request.post(`${BASE}/api/marketing/campaigns`, {
      headers: HDRS(csrf),
      data: {
        brandId: brand.id, name: "Bad", subject: "Hi", body: "<p>Hi</p>",
        fromEmail: "noreply@elsewhere.test", fromName: "S", audienceType: "all",
      },
    })).json();
    await request.post(`${BASE}/api/marketing/contacts`, {
      headers: HDRS(csrf),
      data: { brandId: brand.id, firstName: "R", lastName: "1", email: "r@send.test" },
    });
    const r400 = await request.post(
      `${BASE}/api/marketing/campaigns/${bad.id}/send-now`,
      { headers: HDRS(csrf), data: {} },
    );
    expect(r400.status()).toBe(400);
    expect((await r400.json()).message).toMatch(/domain/i);

    // 409: mark sent_at directly so we don't burn a real Resend dispatch.
    const sent = await (await request.post(`${BASE}/api/marketing/campaigns`, {
      headers: HDRS(csrf),
      data: {
        brandId: brand.id, name: "Sent", subject: "Hi", body: "<p/>",
        fromEmail: "noreply@send.test", fromName: "S", audienceType: "all",
      },
    })).json();
    await pool.query(`UPDATE marketing_campaigns SET sent_at = NOW() WHERE id = $1`, [sent.id]);
    const r409 = await request.post(
      `${BASE}/api/marketing/campaigns/${sent.id}/send-now`,
      { headers: HDRS(csrf), data: {} },
    );
    expect(r409.status()).toBe(409);
    expect((await r409.json()).message).toMatch(/already/i);

    const fails = await request.get(`${BASE}/api/marketing/campaigns/${empty.id}/failures`);
    expect(fails.status()).toBe(200);
    expect(Array.isArray(await fails.json())).toBe(true);
  });

  test("processScheduledCampaigns drains a due campaign", async ({ isolatedOrg }) => {
    const { request, csrf, orgId } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);
    const brand = await createBrand(isolatedOrg, {
      name: "Sched", slug: "sched", domain: "sched.test", fromEmail: "noreply@sched.test",
    });
    await request.post(`${BASE}/api/marketing/contacts`, {
      headers: HDRS(csrf),
      data: { brandId: brand.id, firstName: "S", lastName: "1", email: "s1@sched.test" },
    });
    const camp = await (await request.post(`${BASE}/api/marketing/campaigns`, {
      headers: HDRS(csrf),
      data: {
        brandId: brand.id, name: "Sched Camp", subject: "Hi", body: "<p/>",
        fromEmail: "noreply@sched.test", fromName: "S", audienceType: "all",
      },
    })).json();
    await pool.query(
      `UPDATE marketing_campaigns SET send_at = NOW() - INTERVAL '60 seconds' WHERE id = $1`,
      [camp.id],
    );
    const stats = await processScheduledCampaigns(new Date());
    expect(stats.processed + stats.errors + stats.sent).toBeGreaterThan(0);
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM email_send_attempts WHERE campaign_id = $1`,
      [camp.id],
    );
    expect(rows[0].n).toBeGreaterThanOrEqual(1);
  });

  test("UI — campaigns row + failures dialog", async ({ page, isolatedOrg }) => {
    const { request, csrf, orgId } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);
    const brand = await createBrand(isolatedOrg, {
      name: "UI Camp", slug: "ui-camp", domain: "ui-camp.test", fromEmail: "noreply@ui-camp.test",
    });
    const camp = await (await request.post(`${BASE}/api/marketing/campaigns`, {
      headers: HDRS(csrf),
      data: {
        brandId: brand.id, name: "UI Visible Camp", subject: "S", body: "<p/>",
        fromEmail: "noreply@ui-camp.test", fromName: "UI", audienceType: "all",
      },
    })).json();
    await loginIsolated(page, isolatedOrg);
    await page.goto("/marketing/campaigns");
    const row = page.locator(`[data-testid="row-campaign-${camp.id}"]`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(
      page.locator(`[data-testid="text-campaign-name-${camp.id}"]`),
    ).toContainText("UI Visible Camp");
    await page.click(`[data-testid="button-failures-campaign-${camp.id}"]`);
    await expect(
      page.locator('[data-testid="dialog-campaign-failures"]'),
    ).toBeVisible();
  });
});
