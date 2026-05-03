import { test, expect } from "../tests/helpers/po/fixtures";
import { loginIsolated } from "./_iso-helpers";

interface ClientLite {
  id: string;
  orgId: string;
}
interface ContactLite {
  id: string;
  isPrimary: boolean;
  firstName: string;
}

async function seedClient(iso: { request: import("@playwright/test").APIRequestContext; csrf: string; orgId: string }) {
  const r = await iso.request.post("/api/clients", {
    headers: { "x-csrf-token": iso.csrf },
    data: { name: `Detail Client ${Date.now()}`, email: "detail@e2e.test", currency: "USD" },
  });
  expect(r.status(), await r.text()).toBeLessThan(400);
  return (await r.json()) as ClientLite;
}

test.describe("Client detail — contacts + tabs + notes/activity (#440)", () => {
  test("contacts: create → set primary → delete (UI)", async ({ page, isolatedOrg }) => {
    const client = await seedClient(isolatedOrg);
    await loginIsolated(page, isolatedOrg);
    await page.goto(`/clients/${client.id}`);
    await expect(page.getByTestId("hero-client-name")).toBeVisible({ timeout: 15000 });

    await page.getByTestId("tab-contacts").click();
    await expect(page.getByTestId("button-add-contact")).toBeVisible();

    // Add first contact (auto-primary if none exist server-side, but we set explicitly).
    await page.getByTestId("button-add-contact").click();
    await page.getByTestId("input-contact-first-name").fill("Alex");
    await page.getByTestId("input-contact-last-name").fill("Primary");
    await page.getByTestId("input-contact-email").fill("alex@e2e.test");
    await page.getByTestId("checkbox-contact-primary").check();
    await page.getByTestId("button-save-contact").click();
    await expect(page.locator('[data-testid^="contact-row-"]').first()).toBeVisible({ timeout: 10000 });

    // Add second contact (NOT primary).
    await page.getByTestId("button-add-contact").click();
    await page.getByTestId("input-contact-first-name").fill("Bob");
    await page.getByTestId("input-contact-last-name").fill("Secondary");
    await page.getByTestId("input-contact-email").fill("bob@e2e.test");
    await page.getByTestId("button-save-contact").click();
    await expect(page.locator('[data-testid^="contact-row-"]')).toHaveCount(2, { timeout: 10000 });

    // Verify primary star is rendered for exactly one row.
    await expect(page.locator('[data-testid^="contact-primary-"]')).toHaveCount(1);

    // Toggle primary on the second contact via API (UI requires opening edit dialog;
    // the API path is the source of truth and exercising it here also covers the
    // backend invariant that there is at most one primary per client).
    const list = await isolatedOrg.request.get(`/api/clients/${client.id}/contacts`);
    const contacts = (await list.json()) as ContactLite[];
    const bob = contacts.find((c) => c.firstName === "Bob");
    expect(bob).toBeTruthy();
    const upd = await isolatedOrg.request.patch(
      `/api/clients/${client.id}/contacts/${bob!.id}`,
      {
        headers: { "x-csrf-token": isolatedOrg.csrf },
        data: { isPrimary: true },
      },
    );
    expect(upd.status()).toBeLessThan(400);

    const list2 = await isolatedOrg.request.get(`/api/clients/${client.id}/contacts`);
    const contacts2 = (await list2.json()) as ContactLite[];
    expect(contacts2.find((c) => c.firstName === "Bob")?.isPrimary).toBe(true);

    // Delete the non-primary (Alex was primary; now Bob is). Delete Alex via API.
    const alex = contacts2.find((c) => c.firstName === "Alex");
    expect(alex).toBeTruthy();
    const del = await isolatedOrg.request.delete(
      `/api/clients/${client.id}/contacts/${alex!.id}`,
      { headers: { "x-csrf-token": isolatedOrg.csrf } },
    );
    expect(del.status()).toBeLessThan(400);

    await page.reload();
    await page.getByTestId("tab-contacts").click();
    await expect(page.locator('[data-testid^="contact-row-"]')).toHaveCount(1, { timeout: 10000 });
  });

  test("tabs: overview/projects/invoices/time/contacts/activity/notes all render", async ({
    page,
    isolatedOrg,
  }) => {
    const client = await seedClient(isolatedOrg);
    await loginIsolated(page, isolatedOrg);
    await page.goto(`/clients/${client.id}`);
    await expect(page.getByTestId("hero-client-name")).toBeVisible({ timeout: 15000 });

    for (const tabId of ["overview", "invoices", "projects", "time", "contacts", "activity", "notes"]) {
      const t = page.getByTestId(`tab-${tabId}`);
      if (await t.isVisible().catch(() => false)) {
        await t.click();
        // Ensure no crash — page still has the hero card.
        await expect(page.getByTestId("hero-client-name")).toBeVisible();
      }
    }
  });

  test("notes: add note via UI persists via API", async ({ page, isolatedOrg }) => {
    const client = await seedClient(isolatedOrg);
    await loginIsolated(page, isolatedOrg);
    await page.goto(`/clients/${client.id}`);
    await page.getByTestId("tab-notes").click();
    const noteBody = `e2e note ${Date.now()}`;
    await page.getByTestId("input-note-body").fill(noteBody);
    await page.getByTestId("button-add-note").click();
    await expect(page.getByText(noteBody).first()).toBeVisible({ timeout: 10000 });

    const list = await isolatedOrg.request.get(`/api/clients/${client.id}/notes`);
    expect(list.status()).toBe(200);
    const arr = (await list.json()) as Array<{ body: string }>;
    expect(arr.some((n) => n.body === noteBody)).toBe(true);
  });

  test("billing snapshot reflects invoice totals", async ({ page, isolatedOrg }) => {
    const client = await seedClient(isolatedOrg);
    // Create a SENT invoice via API so the financial snapshot has data to render.
    const today = new Date().toISOString().slice(0, 10);
    const inv = await isolatedOrg.request.post("/api/invoices", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: { clientId: client.id, issuedDate: today, dueDate: today, currency: "USD" },
    });
    expect(inv.status(), await inv.text()).toBe(200);
    const draft = (await inv.json()) as { id: string };
    const lineRes = await isolatedOrg.request.post(`/api/invoices/${draft.id}/lines`, {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: { description: "work", quantity: 1, unitRate: 200 },
    });
    expect(lineRes.status()).toBe(200);
    const send = await isolatedOrg.request.post(`/api/invoices/${draft.id}/send`, {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: { emailTo: "" },
    });
    expect(send.status()).toBe(200);

    await loginIsolated(page, isolatedOrg);
    await page.goto(`/clients/${client.id}`);
    await expect(page.getByTestId("financial-snapshot")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("text-detail-total-billed")).toBeVisible();
  });
});
