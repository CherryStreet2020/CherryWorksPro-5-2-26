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

async function seedClient(iso: {
  request: import("@playwright/test").APIRequestContext;
  csrf: string;
  orgId: string;
}) {
  const r = await iso.request.post("/api/clients", {
    headers: { "x-csrf-token": iso.csrf },
    data: {
      name: `Detail Client ${Date.now()}`,
      email: "detail@e2e.test",
      currency: "USD",
    },
  });
  expect(r.status(), await r.text()).toBeLessThan(400);
  return (await r.json()) as ClientLite;
}

test.describe("Client detail — contacts + tabs + notes + billing (#440)", () => {
  test("contacts: create two, toggle primary via UI dialog, delete via UI", async ({
    page,
    isolatedOrg,
  }) => {
    const client = await seedClient(isolatedOrg);
    await loginIsolated(page, isolatedOrg);
    await page.goto(`/clients/${client.id}`);
    await expect(page.getByTestId("hero-client-name")).toBeVisible({
      timeout: 15000,
    });

    await page.getByTestId("tab-contacts").click();
    await expect(page.getByTestId("button-add-contact")).toBeVisible();

    // Add Alex (primary).
    await page.getByTestId("button-add-contact").click();
    await page.getByTestId("input-contact-first-name").fill("Alex");
    await page.getByTestId("input-contact-last-name").fill("Primary");
    await page.getByTestId("input-contact-email").fill("alex@e2e.test");
    await page.getByTestId("checkbox-contact-primary").check();
    await page.getByTestId("button-save-contact").click();
    await expect(page.locator('[data-testid^="contact-row-"]')).toHaveCount(1, {
      timeout: 10000,
    });

    // Add Bob (not primary).
    await page.getByTestId("button-add-contact").click();
    await page.getByTestId("input-contact-first-name").fill("Bob");
    await page.getByTestId("input-contact-last-name").fill("Secondary");
    await page.getByTestId("input-contact-email").fill("bob@e2e.test");
    await page.getByTestId("button-save-contact").click();
    await expect(page.locator('[data-testid^="contact-row-"]')).toHaveCount(2, {
      timeout: 10000,
    });

    // Exactly one primary star is rendered.
    await expect(page.locator('[data-testid^="contact-primary-"]')).toHaveCount(1);

    // Identify the contact ids from the API so we can target the dropdown.
    const list = await isolatedOrg.request.get(
      `/api/clients/${client.id}/contacts`,
    );
    const contacts = (await list.json()) as ContactLite[];
    const alex = contacts.find((c) => c.firstName === "Alex")!;
    const bob = contacts.find((c) => c.firstName === "Bob")!;
    expect(alex).toBeTruthy();
    expect(bob).toBeTruthy();

    // Toggle primary onto Bob via the row dropdown → edit dialog.
    await page.getByTestId(`contact-actions-${bob.id}`).click();
    await page.getByTestId(`contact-edit-${bob.id}`).click();
    await expect(page.getByTestId("checkbox-contact-primary")).toBeVisible();
    await page.getByTestId("checkbox-contact-primary").check();
    await page.getByTestId("button-save-contact").click();

    // After save, the primary star is now next to Bob's row.
    await expect(page.getByTestId(`contact-primary-${bob.id}`)).toBeVisible({
      timeout: 10000,
    });

    // Delete Alex via UI dropdown → AlertDialog confirm.
    await page.getByTestId(`contact-actions-${alex.id}`).click();
    await page.getByTestId(`contact-delete-${alex.id}`).click();
    await expect(page.getByTestId("button-confirm-delete-contact")).toBeVisible();
    await page.getByTestId("button-confirm-delete-contact").click();
    await expect(page.locator('[data-testid^="contact-row-"]')).toHaveCount(1, {
      timeout: 10000,
    });
  });

  test("tabs: each tab activates and renders its own panel", async ({
    page,
    isolatedOrg,
  }) => {
    const client = await seedClient(isolatedOrg);
    await loginIsolated(page, isolatedOrg);
    await page.goto(`/clients/${client.id}`);
    await expect(page.getByTestId("hero-client-name")).toBeVisible({
      timeout: 15000,
    });

    // Overview tab — financial snapshot.
    await page.getByTestId("tab-overview").click();
    await expect(page.getByTestId("financial-snapshot")).toBeVisible();
    await expect(page.getByTestId("text-detail-total-billed")).toBeVisible();

    // Projects tab — empty-state copy is shown for a brand-new client.
    await page.getByTestId("tab-projects").click();
    await expect(page.getByText("No projects yet").first()).toBeVisible({
      timeout: 10000,
    });

    // Activity tab — activity timeline + filter chips.
    await page.getByTestId("tab-activity").click();
    await expect(page.getByTestId("activity-timeline")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByTestId("activity-filters")).toBeVisible();

    // Contacts tab — add-contact button.
    await page.getByTestId("tab-contacts").click();
    await expect(page.getByTestId("button-add-contact")).toBeVisible();

    // Notes tab — note input + add button.
    await page.getByTestId("tab-notes").click();
    await expect(page.getByTestId("input-note-body")).toBeVisible();
    await expect(page.getByTestId("button-add-note")).toBeVisible();
  });

  test("notes: add note via UI persists via API and shows in list", async ({
    page,
    isolatedOrg,
  }) => {
    const client = await seedClient(isolatedOrg);
    await loginIsolated(page, isolatedOrg);
    await page.goto(`/clients/${client.id}`);
    await page.getByTestId("tab-notes").click();
    const noteBody = `e2e note ${Date.now()}`;
    await page.getByTestId("input-note-body").fill(noteBody);
    await page.getByTestId("button-add-note").click();
    await expect(page.getByText(noteBody).first()).toBeVisible({
      timeout: 10000,
    });

    const list = await isolatedOrg.request.get(
      `/api/clients/${client.id}/notes`,
    );
    expect(list.status()).toBe(200);
    const arr = (await list.json()) as Array<{ body: string }>;
    expect(arr.some((n) => n.body === noteBody)).toBe(true);
  });

  test("billing snapshot reflects sent invoice totals", async ({
    page,
    isolatedOrg,
  }) => {
    const client = await seedClient(isolatedOrg);
    const today = new Date().toISOString().slice(0, 10);
    const inv = await isolatedOrg.request.post("/api/invoices", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: {
        clientId: client.id,
        issuedDate: today,
        dueDate: today,
        currency: "USD",
      },
    });
    expect(inv.status(), await inv.text()).toBe(200);
    const draft = (await inv.json()) as { id: string };
    const lineRes = await isolatedOrg.request.post(
      `/api/invoices/${draft.id}/lines`,
      {
        headers: { "x-csrf-token": isolatedOrg.csrf },
        data: { description: "work", quantity: 1, unitRate: 200 },
      },
    );
    expect(lineRes.status()).toBe(200);
    const send = await isolatedOrg.request.post(
      `/api/invoices/${draft.id}/send`,
      {
        headers: { "x-csrf-token": isolatedOrg.csrf },
        data: { emailTo: "" },
      },
    );
    expect(send.status()).toBe(200);

    await loginIsolated(page, isolatedOrg);
    await page.goto(`/clients/${client.id}`);
    await expect(page.getByTestId("financial-snapshot")).toBeVisible({
      timeout: 15000,
    });
    // Billed amount must show > $0 since we sent a $200 invoice.
    const billedText = await page
      .getByTestId("text-detail-total-billed")
      .textContent();
    expect(billedText).toBeTruthy();
    const billedNumber = Number((billedText || "").replace(/[^0-9.]/g, ""));
    expect(billedNumber).toBeGreaterThan(0);
  });
});
