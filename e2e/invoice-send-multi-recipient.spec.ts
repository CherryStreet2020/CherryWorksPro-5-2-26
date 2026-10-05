/**
 * Send Invoice dialog — several recipients from the client's contacts, PDF attached.
 *
 * Drives the real dialog: the client email + billing contact are pre-selected
 * (exactly who the server would email by default), the user adds a second
 * contact and types an ad-hoc address, then sends. The captured message must
 * carry To = first recipient, every other pick as CC, and the invoice PDF
 * named after the invoice number.
 */
import { test, expect } from "../tests/helpers/po/fixtures";
import { loginIsolated, gotoWithRetry } from "./_iso-helpers";
import { waitForCapturedEmail } from "../tests/helpers/email-capture";
import { closeRevPool, insertClient, revPool, sweepOrgRevenue } from "./_revenue-helpers";

test.afterEach(async ({ isolatedOrg }) => {
  await sweepOrgRevenue(isolatedOrg.orgId);
});
test.afterAll(async () => {
  await closeRevPool();
});

test("send invoice to several contacts with the PDF attached", async ({ page, isolatedOrg }) => {
  const h = { "x-csrf-token": isolatedOrg.csrf };
  // Sending requires a verified sender (requireVerifiedEmail); isolated users start unverified.
  await revPool().query(`UPDATE users SET email_verified_at = now() WHERE id = $1`, [isolatedOrg.userId]);
  const clientId = await insertClient(isolatedOrg.orgId, `Multi Recip ${Date.now()}`);
  const client = await (await isolatedOrg.request.get(`/api/clients/${clientId}`)).json();
  const clientEmail: string = client.email;

  const tag = Date.now().toString(36);
  const ap = `ap-${tag}@example.com`;
  const cfo = `cfo-${tag}@example.com`;
  const adhoc = `adhoc-${tag}@example.com`;
  for (const c of [
    { firstName: "Alex", lastName: "Payable", email: ap, role: "billing" },
    { firstName: "Casey", lastName: "Finance", email: cfo, role: "cfo" },
  ]) {
    const r = await isolatedOrg.request.post(`/api/clients/${clientId}/contacts`, { headers: h, data: c });
    expect(r.ok(), await r.text()).toBe(true);
  }

  const today = new Date().toISOString().slice(0, 10);
  const draft = await (
    await isolatedOrg.request.post("/api/invoices", { headers: h, data: { clientId, issuedDate: today, dueDate: today, currency: "USD" } })
  ).json();
  const line = await isolatedOrg.request.post(`/api/invoices/${draft.id}/lines`, {
    headers: h,
    data: { description: "Consulting", quantity: 2, unitRate: 150 },
  });
  expect(line.status(), await line.text()).toBe(200);

  await loginIsolated(page, isolatedOrg);
  await gotoWithRetry(page, `/invoices/${draft.id}`);
  await page.getByTestId("button-send-invoice").click();
  const modal = page.getByTestId("send-email-modal");
  await expect(modal).toBeVisible();
  await expect(modal.getByTestId("text-pdf-attached")).toContainText(`Invoice-${draft.number}.pdf`);

  // Defaults: client email (To) + the billing contact (CC), already selected.
  await expect(modal.getByTestId("recipient-chip-0")).toContainText(clientEmail);
  await expect(modal.getByTestId("recipient-chip-1")).toContainText(ap);

  // Add the CFO from the contact list and an ad-hoc address.
  await modal.getByRole("checkbox", { name: new RegExp(cfo) }).click();
  await modal.getByTestId("input-email-to").fill(adhoc);
  await modal.getByTestId("input-email-to").press("Enter");
  await expect(modal.getByTestId("recipient-chip-3")).toContainText(adhoc);
  await page.screenshot({ path: `${process.env.E2E_CAPTURE_DIR || "/tmp"}/invoice-send-multi-recipient.png` });

  const since = Date.now();
  await modal.getByTestId("button-confirm-send").click();
  await expect(modal).toBeHidden({ timeout: 15_000 });

  const mail = await waitForCapturedEmail({ to: clientEmail }, { sinceMs: since, timeoutMs: 15_000 });
  expect(mail.cc).toEqual([ap, cfo, adhoc]);
  const attachments = (mail as unknown as { attachments: { filename: string; contentType: string; size: number }[] }).attachments;
  expect(attachments).toHaveLength(1);
  expect(attachments[0].filename).toBe(`Invoice-${draft.number}.pdf`);
  expect(attachments[0].contentType).toBe("application/pdf");
  expect(attachments[0].size).toBeGreaterThan(1000);
});

// The dialog must fit the window: on a short laptop screen with a long contact
// list, Cancel/Send stay visible without shrinking the page (2026-10-05 report).
for (const vp of [
  { name: "laptop-1366x768", width: 1366, height: 768 },
  { name: "small-1280x650", width: 1280, height: 650 },
  { name: "phone-390x844", width: 390, height: 844 },
]) {
  test(`send dialog fits a ${vp.name} screen with many contacts`, async ({ page, isolatedOrg }) => {
    const h = { "x-csrf-token": isolatedOrg.csrf };
    const clientId = await insertClient(isolatedOrg.orgId, `Fit ${vp.name} ${Date.now()}`);
    const tag = Date.now().toString(36);
    for (let i = 0; i < 12; i++) {
      const r = await isolatedOrg.request.post(`/api/clients/${clientId}/contacts`, {
        headers: h,
        data: { firstName: `Person${i}`, lastName: "Contactname", email: `p${i}-${tag}@example.com`, role: i < 3 ? "billing" : "other" },
      });
      expect(r.ok(), await r.text()).toBe(true);
    }
    const today = new Date().toISOString().slice(0, 10);
    const draft = await (
      await isolatedOrg.request.post("/api/invoices", { headers: h, data: { clientId, issuedDate: today, dueDate: today, currency: "USD" } })
    ).json();
    await isolatedOrg.request.post(`/api/invoices/${draft.id}/lines`, { headers: h, data: { description: "Consulting", quantity: 1, unitRate: 100 } });

    await page.setViewportSize({ width: vp.width, height: vp.height });
    await loginIsolated(page, isolatedOrg);
    await gotoWithRetry(page, `/invoices/${draft.id}`);
    await page.getByTestId("button-send-invoice").click();
    const modal = page.getByTestId("send-email-modal");
    await expect(modal).toBeVisible();
    await expect(modal.getByTestId("recipient-chip-3")).toBeVisible(); // client + 3 billing defaults loaded

    const box = (await modal.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
    for (const id of ["button-confirm-send", "button-cancel-send"]) {
      const b = (await modal.getByTestId(id).boundingBox())!;
      expect(b.y + b.height, `${id} below the fold`).toBeLessThanOrEqual(vp.height);
      expect(b.x + b.width, `${id} off the right edge`).toBeLessThanOrEqual(vp.width);
    }
    await expect(modal.getByTestId("button-confirm-send")).toBeInViewport();
    await page.waitForTimeout(400); // let the open animation settle before the screenshot
    await page.screenshot({ path: `${process.env.E2E_CAPTURE_DIR || "/tmp"}/send-dialog-${vp.name}.png` });
  });
}
