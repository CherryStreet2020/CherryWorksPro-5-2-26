import { test, expect } from "../helpers/po/fixtures";
import {
  seedClient,
  seedProject,
  addProjectMember,
  loginIsoTeamMember,
  postJson,
  patchJson,
} from "./_helpers";

test("time entry CRUD: create, edit hours, verify updated", async ({ isolatedOrg }) => {
  // Admin: seed a client, project, and add the team member as a project member.
  const tm = await loginIsoTeamMember(isolatedOrg);
  try {
    const client = await seedClient(isolatedOrg);
    const project = await seedProject(isolatedOrg, client.id);
    await addProjectMember(isolatedOrg, project.id, tm.user.userId, 150);

    // Team member: validate their /api/time-entries/my-projects sees the project.
    const projRes = await tm.request.get("/api/time-entries/my-projects");
    expect(projRes.ok()).toBeTruthy();
    const projects = await projRes.json();
    expect(projects.length).toBeGreaterThan(0);
    const visible = projects.find((p: any) => p.id === project.id);
    expect(visible).toBeDefined();

    // Pick a recent weekday in the past to satisfy server schema
    // (which rejects future dates and dates >1y old).
    const randomOffset = 7 + Math.floor(Math.random() * 60);
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - randomOffset);
    while (pastDate.getDay() === 0 || pastDate.getDay() === 6) {
      pastDate.setDate(pastDate.getDate() - 1);
    }
    const dateStr = pastDate.toISOString().split("T")[0];

    const createRes = await postJson(
      { ...isolatedOrg, request: tm.request, csrf: tm.csrf },
      "/api/time-entries",
      {
        projectId: project.id,
        date: dateStr,
        minutes: 120,
        billable: true,
        notes: "E2E time-crud test entry",
      },
    );
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();
    expect(created.id).toBeTruthy();
    expect(created.minutes).toBe(120);

    const allRes = await tm.request.get("/api/time-entries");
    expect(allRes.ok()).toBeTruthy();
    const allEntries = await allRes.json();
    const found = allEntries.find((e: any) => e.id === created.id);
    expect(found).toBeDefined();
    expect(found.minutes).toBe(120);

    const editRes = await patchJson(
      { ...isolatedOrg, request: tm.request, csrf: tm.csrf },
      `/api/time-entries/${created.id}`,
      { minutes: 180 },
    );
    expect(editRes.ok()).toBeTruthy();
    const edited = await editRes.json();
    expect(edited.minutes).toBe(180);

    const allRes2 = await tm.request.get("/api/time-entries");
    expect(allRes2.ok()).toBeTruthy();
    const allEntries2 = await allRes2.json();
    const found2 = allEntries2.find((e: any) => e.id === created.id);
    expect(found2).toBeDefined();
    expect(found2.minutes).toBe(180);
  } finally {
    await tm.dispose();
  }
});
