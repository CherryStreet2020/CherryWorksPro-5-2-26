import { test, expect } from "@playwright/test";

test("timesheet flow: log time, submit, lock, approve, invoice, utilization", async ({
  request,
}) => {
  const teamMemberLogin = await request.post("/api/auth/login", {
    data: { email: "kellyjo@cherrystconsulting.com", password: "cherry2026" },
  });
  expect(teamMemberLogin.ok()).toBeTruthy();

  const myProjects = await request.get("/api/time-entries/my-projects");
  expect(myProjects.ok()).toBeTruthy();
  const projects = await myProjects.json();
  expect(projects.length).toBeGreaterThan(0);
  const project = projects[0];

  const randomOffset = 1200 + Math.floor(Math.random() * 2000);
  const futureMonday = new Date();
  futureMonday.setDate(futureMonday.getDate() + randomOffset);
  while (futureMonday.getDay() !== 1) {
    futureMonday.setDate(futureMonday.getDate() + 1);
  }
  const weekStartDate = futureMonday.toISOString().split("T")[0];
  const tuesdayDate = new Date(futureMonday);
  tuesdayDate.setDate(tuesdayDate.getDate() + 1);
  const wednesdayDate = new Date(futureMonday);
  wednesdayDate.setDate(wednesdayDate.getDate() + 2);

  const entry1Res = await request.post("/api/time-entries", {
    data: {
      projectId: project.id,
      date: weekStartDate,
      minutes: 480,
      billable: true,
      notes: "E2E timesheet billable work",
    },
  });
  expect(entry1Res.ok()).toBeTruthy();

  const entry2Res = await request.post("/api/time-entries", {
    data: {
      projectId: project.id,
      date: tuesdayDate.toISOString().split("T")[0],
      minutes: 60,
      billable: false,
      notes: "E2E timesheet non-billable",
    },
  });
  expect(entry2Res.ok()).toBeTruthy();

  const weekBefore = await request.get(
    `/api/timesheets/my-week?weekStartDate=${weekStartDate}`,
  );
  expect(weekBefore.ok()).toBeTruthy();
  const weekDataBefore = await weekBefore.json();
  expect(weekDataBefore.entries.length).toBeGreaterThanOrEqual(2);

  const submitRes = await request.post("/api/timesheets/submit", {
    data: { weekStartDate },
  });
  expect(submitRes.ok()).toBeTruthy();
  const submittedTs = await submitRes.json();
  expect(submittedTs.status).toBe("SUBMITTED");

  const lockedEntry = await request.post("/api/time-entries", {
    data: {
      projectId: project.id,
      date: wednesdayDate.toISOString().split("T")[0],
      minutes: 60,
      billable: true,
      notes: "Should be blocked",
    },
  });
  expect(lockedEntry.status()).toBe(403);

  const lockedBody = await lockedEntry.json();
  expect(lockedBody.message).toContain("locked");

  const adminLogin = await request.post("/api/auth/login", {
    data: { email: "dean@cherrystconsulting.com", password: "admin123", orgSlug: "cherry-st" },
  });
  expect(adminLogin.ok()).toBeTruthy();

  const pendingRes = await request.get("/api/timesheets/pending");
  expect(pendingRes.ok()).toBeTruthy();
  const pending = await pendingRes.json();
  const tsToApprove = pending.find(
    (t: any) => t.weekStartDate === weekStartDate,
  );
  expect(tsToApprove).toBeDefined();

  const entriesRes = await request.get(
    `/api/timesheets/${tsToApprove.id}/entries`,
  );
  expect(entriesRes.ok()).toBeTruthy();
  const tsEntries = await entriesRes.json();
  expect(tsEntries.length).toBeGreaterThanOrEqual(2);

  const approveRes = await request.post(
    `/api/timesheets/${tsToApprove.id}/approve`,
  );
  expect(approveRes.ok()).toBeTruthy();

  const allTs = await request.get("/api/timesheets/all");
  const allTimesheets = await allTs.json();
  const approvedTs = allTimesheets.find(
    (t: any) => t.id === tsToApprove.id,
  );
  expect(approvedTs.status).toBe("APPROVED");

  const clients = await request.get("/api/clients");
  const clientList = await clients.json();
  const clientId = clientList.find(
    (c: any) => c.name === project.clientName,
  )?.id;

  if (clientId) {
    const genRes = await request.post("/api/invoices/generate", {
      data: { clientId },
    });

    if (genRes.ok()) {
      const invoice = await genRes.json();
      expect(invoice.lines.length).toBeGreaterThan(0);
      expect(Number(invoice.total)).toBeGreaterThan(0);
    }
  }

  const utilRes = await request.get("/api/reports/utilization");
  expect(utilRes.ok()).toBeTruthy();
  const utilData = await utilRes.json();
  expect(utilData.length).toBeGreaterThan(0);

  const teamMemberUtil = utilData.find(
    (u: any) => u.weeks.some((w: any) => w.weekStartDate === weekStartDate),
  );
  expect(teamMemberUtil).toBeDefined();
  expect(teamMemberUtil.overallUtilization).toBeGreaterThan(0);
  expect(teamMemberUtil.overallUtilization).toBeLessThanOrEqual(1);

  const weekUtil = teamMemberUtil.weeks.find(
    (w: any) => w.weekStartDate === weekStartDate,
  );
  expect(weekUtil).toBeDefined();
  expect(weekUtil.billableMinutes).toBe(480);
  expect(weekUtil.nonBillableMinutes).toBe(60);
  const expectedUtil = Math.round((480 / 540) * 10000) / 10000;
  expect(weekUtil.utilization).toBe(expectedUtil);
});
