import { test, expect } from "@playwright/test";

test("Create client → verify in list → edit name → verify updated → delete → verify removed", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.waitForSelector('[data-testid="input-email"]', { timeout: 15000 });

  await page.fill('[data-testid="input-email"]', "dean@cherrystconsulting.com");
  await page.fill('[data-testid="input-password"]', "admin123");
  await page.click('[data-testid="button-login"]');
  await page.waitForURL("**/", { timeout: 10000 });

  const loginRes = await request.post("/api/auth/login", {
    data: { email: "dean@cherrystconsulting.com", password: "admin123" },
  });
  expect(loginRes.ok()).toBeTruthy();

  const uniqueName = `E2E Client ${Date.now()}`;
  const updatedName = `${uniqueName} Updated`;

  const createRes = await request.post("/api/clients", {
    data: { name: uniqueName, email: "e2e@test.com", phone: "555-0199" },
  });
  expect(createRes.ok()).toBeTruthy();
  const created = await createRes.json();
  expect(created.id).toBeTruthy();
  expect(created.name).toBe(uniqueName);

  const listRes = await request.get("/api/clients");
  expect(listRes.ok()).toBeTruthy();
  const clients = await listRes.json();
  expect(clients.some((c: any) => c.id === created.id)).toBeTruthy();

  const patchRes = await request.patch(`/api/clients/${created.id}`, {
    data: { name: updatedName },
  });
  expect(patchRes.ok()).toBeTruthy();
  const patched = await patchRes.json();
  expect(patched.name).toBe(updatedName);

  const detailRes = await request.get(`/api/clients/${created.id}`);
  expect(detailRes.ok()).toBeTruthy();
  const detail = await detailRes.json();
  expect(detail.name).toBe(updatedName);

  const deleteRes = await request.delete(`/api/clients/${created.id}`);
  expect(deleteRes.ok()).toBeTruthy();

  const listRes2 = await request.get("/api/clients");
  const clients2 = await listRes2.json();
  expect(clients2.some((c: any) => c.id === created.id)).toBeFalsy();
});
