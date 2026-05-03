import { test, expect } from "../helpers/po/fixtures";
import { postJson, patchJson, delReq } from "./_helpers";

test("Create client → verify in list → edit name → verify updated → delete → verify removed", async ({
  isolatedOrg,
}) => {
  const uniqueName = `E2E Client ${Date.now()}`;
  const updatedName = `${uniqueName} Updated`;

  const createRes = await postJson(isolatedOrg, "/api/clients", {
    name: uniqueName,
    email: "e2e@iso-test.com",
    phone: "555-0199",
  });
  expect(createRes.ok()).toBeTruthy();
  const created = await createRes.json();
  expect(created.id).toBeTruthy();
  expect(created.name).toBe(uniqueName);

  const listRes = await isolatedOrg.request.get("/api/clients");
  expect(listRes.ok()).toBeTruthy();
  const clients = await listRes.json();
  expect(clients.some((c: any) => c.id === created.id)).toBeTruthy();

  const patchRes = await patchJson(isolatedOrg, `/api/clients/${created.id}`, {
    name: updatedName,
  });
  expect(patchRes.ok()).toBeTruthy();
  const patched = await patchRes.json();
  expect(patched.name).toBe(updatedName);

  const detailRes = await isolatedOrg.request.get(`/api/clients/${created.id}`);
  expect(detailRes.ok()).toBeTruthy();
  const detail = await detailRes.json();
  expect(detail.name).toBe(updatedName);

  const deleteRes = await delReq(isolatedOrg, `/api/clients/${created.id}`);
  expect(deleteRes.ok()).toBeTruthy();

  const listRes2 = await isolatedOrg.request.get("/api/clients");
  const clients2 = await listRes2.json();
  expect(clients2.some((c: any) => c.id === created.id)).toBeFalsy();
});
