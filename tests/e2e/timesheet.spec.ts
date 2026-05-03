import { test, expect } from "../helpers/po/fixtures";
import {
  seedClient,
  seedProject,
  addProjectMember,
  loginIsoTeamMember,
  postJson,
  generateInvoice,
} from "./_helpers";

test("timesheet flow: log time, submit, lock, approve, invoice, utilization", async ({
  isolatedOrg,
}) => {
  const tm = await loginIsoTeamMember(isolatedOrg);
  try {
    const client = await seedClient(isolatedOrg);
    const project = await seedProject(isolatedOrg, client.id);
    await addProjectMember(isolatedOrg, project.id, tm.user.userId, 150);

    const tmIso = { ...isolatedOrg, request: tm.request, csrf: tm.csrf };

    const myProjectsRes = await tm.request.get("/api/time-entries/my-projects");
    expect(myProjectsRes.ok()).toBeTruthy();
    const projects = await myProjectsRes.json();
    expect(projects.length).toBeGreaterThan(0);

    // Server's getWeekStartDate uses Sunday (UTC day 0) as the week start,
    // and rejects future dates / dates >1y old.
    const randomOffset = 14 + Math.floor(Math.random() * 60);
    const pastSunday = new Date();
    pastSunday.setUTCDate(pastSunday.getUTCDate() - randomOffset);
    while (pastSunday.getUTCDay() !== 0) {
      pastSunday.setUTCDate(pastSunday.getUTCDate() - 1);
    }
    const weekStartDate = pastSunday.toISOString().split("T")[0];
    const tuesdayDate = new Date(pastSunday);
    tuesdayDate.setUTCDate(tuesdayDate.getUTCDate() + 2);
    const wednesdayDate = new Date(pastSunday);
    wednesdayDate.setUTCDate(wednesdayDate.getUTCDate() + 3);

    const entry1Res = await postJson(tmIso, "/api/time-entries", {
      projectId: project.id,
      date: weekStartDate,
      minutes: 480,
      billable: true,
      notes: "E2E timesheet billable work",
    });
    expect(entry1Res.ok()).toBeTruthy();

    const entry2Res = await postJson(tmIso, "/api/time-entries", {
      projectId: project.id,
      date: tuesdayDate.toISOString().split("T")[0],
      minutes: 60,
      billable: false,
      notes: "E2E timesheet non-billable",
    });
    expect(entry2Res.ok()).toBeTruthy();

    const weekBefore = await tm.request.get(
      `/api/timesheets/my-week?weekStartDate=${weekStartDate}`,
    );
    expect(weekBefore.ok()).toBeTruthy();
    const weekDataBefore = await weekBefore.json();
    expect(weekDataBefore.entries.length).toBeGreaterThanOrEqual(2);

    const submitRes = await postJson(tmIso, "/api/timesheets/submit", { weekStartDate });
    expect(submitRes.ok()).toBeTruthy();
    const submittedTs = await submitRes.json();
    expect(submittedTs.status).toBe("SUBMITTED");

    const lockedEntry = await postJson(tmIso, "/api/time-entries", {
      projectId: project.id,
      date: wednesdayDate.toISOString().split("T")[0],
      minutes: 60,
      billable: true,
      notes: "Should be blocked",
    });
    expect(lockedEntry.status()).toBe(403);
    const lockedBody = await lockedEntry.json();
    expect(lockedBody.message).toContain("locked");

    // Admin (iso) approves
    const pendingRes = await isolatedOrg.request.get("/api/timesheets/pending");
    expect(pendingRes.ok()).toBeTruthy();
    const pending = await pendingRes.json();
    const tsToApprove = pending.find((t: any) => t.weekStartDate === weekStartDate);
    expect(tsToApprove).toBeDefined();

    const entriesRes = await isolatedOrg.request.get(
      `/api/timesheets/${tsToApprove.id}/entries`,
    );
    expect(entriesRes.ok()).toBeTruthy();
    const tsEntries = await entriesRes.json();
    expect(tsEntries.length).toBeGreaterThanOrEqual(2);

    const approveRes = await postJson(
      isolatedOrg,
      `/api/timesheets/${tsToApprove.id}/approve`,
      {},
    );
    expect(approveRes.ok()).toBeTruthy();

    const allTs = await isolatedOrg.request.get("/api/timesheets/all");
    const allTimesheets = await allTs.json();
    const approvedTs = allTimesheets.find((t: any) => t.id === tsToApprove.id);
    expect(approvedTs.status).toBe("APPROVED");

    const genRes = await generateInvoice(isolatedOrg, client.id);
    expect(genRes.lines.length).toBeGreaterThan(0);
    expect(Number(genRes.total)).toBeGreaterThan(0);

    const utilRes = await isolatedOrg.request.get("/api/reports/utilization");
    expect(utilRes.ok()).toBeTruthy();
    const utilData = await utilRes.json();
    expect(utilData.length).toBeGreaterThan(0);

    const teamMemberUtil = utilData.find((u: any) =>
      u.weeks.some((w: any) => w.weekStartDate === weekStartDate),
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
  } finally {
    await tm.dispose();
  }
});
