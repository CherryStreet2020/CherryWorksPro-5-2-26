import { test, expect } from "../tests/helpers/po/fixtures";
import { loginIsolated } from "./_iso-helpers";

async function seedProjectAndTimeEntry(iso: {
  request: import("@playwright/test").APIRequestContext;
  csrf: string;
  userId: string;
}) {
  const cR = await iso.request.post("/api/clients", {
    headers: { "x-csrf-token": iso.csrf },
    data: { name: `TT Client ${Date.now()}`, currency: "USD" },
  });
  const client = (await cR.json()) as { id: string };
  const pR = await iso.request.post("/api/projects", {
    headers: { "x-csrf-token": iso.csrf },
    data: { name: `TT Project ${Date.now()}`, clientId: client.id },
  });
  const project = (await pR.json()) as { id: string; name: string };
  await iso.request
    .post(`/api/projects/${project.id}/members`, {
      headers: { "x-csrf-token": iso.csrf },
      data: { userId: iso.userId, hourlyRate: 100, costRateHourly: 50 },
    })
    .catch(() => undefined);

  // The backend treats Sunday as the week start (shared/schema.ts → getWeekStartDate).
  const now = new Date();
  const utc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  utc.setUTCDate(utc.getUTCDate() - utc.getUTCDay());
  const date = utc.toISOString().slice(0, 10);

  const teR = await iso.request.post("/api/time-entries", {
    headers: { "x-csrf-token": iso.csrf },
    data: {
      projectId: project.id,
      date,
      minutes: 60,
      notes: "e2e",
      billable: true,
    },
  });
  expect(teR.status(), await teR.text()).toBeLessThan(400);
  return { projectId: project.id, projectName: project.name, weekStart: date };
}

test.describe("Time tracking — submit + dialog selectors + week-nav (#440)", () => {
  test("week navigation: prev/next changes the visible week label", async ({
    page,
    isolatedOrg,
  }) => {
    await loginIsolated(page, isolatedOrg);
    await page.goto("/time?view=week");
    await expect(page.getByTestId("text-time-title")).toBeVisible({
      timeout: 15000,
    });
    const initial = await page.getByTestId("text-week-label").textContent();
    await page.getByTestId("button-prev-week").click();
    await expect(page.getByTestId("text-week-label")).not.toHaveText(
      initial || "",
      { timeout: 10000 },
    );
    await page.getByTestId("button-next-week").click();
    await expect(page.getByTestId("text-week-label")).toHaveText(initial || "", {
      timeout: 10000,
    });
  });

  test("submit-week via UI flips the timesheet status to SUBMITTED", async ({
    page,
    isolatedOrg,
  }) => {
    const { weekStart } = await seedProjectAndTimeEntry(isolatedOrg);

    await loginIsolated(page, isolatedOrg);
    await page.goto("/time?view=week");
    await expect(page.getByTestId("text-time-title")).toBeVisible({
      timeout: 15000,
    });

    const submitBtn = page.getByTestId("button-submit-timesheet");
    await expect(submitBtn).toBeVisible({ timeout: 15000 });
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // The backend timesheet for this week must transition to SUBMITTED.
    await expect
      .poll(
        async () => {
          const wk = await isolatedOrg.request.get(
            `/api/timesheets/my-week?weekStartDate=${weekStart}`,
          );
          if (wk.status() !== 200) return null;
          const body = (await wk.json()) as {
            timesheet?: { status?: string } | null;
          };
          return body.timesheet?.status ?? null;
        },
        { timeout: 15000 },
      )
      .toBe("SUBMITTED");
  });

  test("add-time dialog: project + service + notes + billable controls all interactable", async ({
    page,
    isolatedOrg,
  }) => {
    const { projectName } = await seedProjectAndTimeEntry(isolatedOrg);
    await loginIsolated(page, isolatedOrg);
    await page.goto("/time?view=week");
    await expect(page.getByTestId("text-time-title")).toBeVisible({
      timeout: 15000,
    });

    await page.getByTestId("button-add-time").click();
    await expect(page.getByTestId("dialog-title-time-entry")).toBeVisible({
      timeout: 10000,
    });

    // Project select — pick our seeded project.
    await page.getByTestId("select-dialog-project").click();
    await page
      .getByRole("option", { name: new RegExp(projectName, "i") })
      .first()
      .click();

    // Notes input accepts text.
    await page.getByTestId("input-dialog-notes").fill("validation note");
    await expect(page.getByTestId("input-dialog-notes")).toHaveValue(
      "validation note",
    );

    // Billable checkbox starts checked (default true). Toggling via the UI
    // flips the aria-checked attribute on the Radix primitive.
    const billable = page.getByTestId("checkbox-dialog-billable");
    await expect(billable).toBeVisible();
    await expect(billable).toHaveAttribute("aria-checked", "true");
    await billable.click();
    await expect(billable).toHaveAttribute("aria-checked", "false");
    await billable.click();
    await expect(billable).toHaveAttribute("aria-checked", "true");

    // Service selector is present (org may not have services seeded yet — assert visibility only).
    await expect(page.getByTestId("select-dialog-service")).toBeVisible();

    await page.getByTestId("button-dialog-cancel").click();
    await expect(page.getByTestId("dialog-title-time-entry")).toHaveCount(0, {
      timeout: 5000,
    });
  });

  test("submit-empty-week opens the confirm dialog with confirm/cancel buttons", async ({
    page,
    isolatedOrg,
  }) => {
    await loginIsolated(page, isolatedOrg);
    await page.goto("/time?view=week");
    await expect(page.getByTestId("text-time-title")).toBeVisible({
      timeout: 15000,
    });

    const submitBtn = page.getByTestId("button-submit-timesheet");
    await expect(submitBtn).toBeVisible({ timeout: 15000 });
    await submitBtn.click();
    // Brand-new iso org with no entries → empty-week confirm dialog.
    await expect(page.getByTestId("button-confirm-submit-empty")).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByTestId("button-cancel-submit-empty")).toBeVisible();
    await page.getByTestId("button-cancel-submit-empty").click();
  });
});
