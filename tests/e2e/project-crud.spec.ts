import { test, expect } from "../helpers/po/fixtures";
import { postJson, delReq, seedClient, loginIsoTeamMember } from "./_helpers";

test("create project, duplicate, verify copy in list", async ({ isolatedOrg }) => {
  const client = await seedClient(isolatedOrg);

  const uniqueSuffix = Date.now().toString(36);
  const projectName = `E2E Test Project ${uniqueSuffix}`;

  const createRes = await postJson(isolatedOrg, "/api/projects", {
    name: projectName,
    clientId: client.id,
    description: "E2E duplicate test project",
  });
  expect(createRes.ok()).toBeTruthy();
  const created = await createRes.json();
  expect(created.name).toBe(projectName);

  const projectsRes = await isolatedOrg.request.get("/api/projects");
  expect(projectsRes.ok()).toBeTruthy();
  const projectsList = await projectsRes.json();
  const found = projectsList.find((p: any) => p.id === created.id);
  expect(found).toBeDefined();
  expect(found.name).toBe(projectName);

  const dupRes = await postJson(isolatedOrg, `/api/projects/${created.id}/duplicate`, {});
  expect(dupRes.ok()).toBeTruthy();
  const duplicated = await dupRes.json();
  expect(duplicated.project.name).toBe(`${projectName} (Copy)`);
  expect(duplicated.project.clientId).toBe(client.id);
  expect(duplicated.project.description).toBe("E2E duplicate test project");
  expect(duplicated.project.status).toBe("ACTIVE");

  const projectsRes2 = await isolatedOrg.request.get("/api/projects");
  const projectsList2 = await projectsRes2.json();
  const foundCopy = projectsList2.find((p: any) => p.id === duplicated.project.id);
  expect(foundCopy).toBeDefined();
  expect(foundCopy.name).toBe(`${projectName} (Copy)`);

  await delReq(isolatedOrg, `/api/projects/${duplicated.project.id}`);
  await delReq(isolatedOrg, `/api/projects/${created.id}`);
});

test("duplicate copies project members", async ({ isolatedOrg }) => {
  // Create an extra TEAM_MEMBER in the iso org so /api/users/team-members
  // returns at least one assignable user.
  const tm = await loginIsoTeamMember(isolatedOrg);
  try {
    const client = await seedClient(isolatedOrg);

    const teamMembersRes = await isolatedOrg.request.get("/api/users/team-members");
    expect(teamMembersRes.ok()).toBeTruthy();
    const teamMembers = await teamMembersRes.json();
    expect(teamMembers.length).toBeGreaterThan(0);

    const uniqueSuffix = Date.now().toString(36);
    const createRes = await postJson(isolatedOrg, "/api/projects", {
      name: `Member Copy Test ${uniqueSuffix}`,
      clientId: client.id,
    });
    expect(createRes.ok()).toBeTruthy();
    const project = await createRes.json();

    const memberRes = await postJson(
      isolatedOrg,
      `/api/projects/${project.id}/members`,
      { userId: teamMembers[0].id, hourlyRate: 150 },
    );
    expect(memberRes.ok()).toBeTruthy();

    const dupRes = await postJson(isolatedOrg, `/api/projects/${project.id}/duplicate`, {});
    expect(dupRes.ok()).toBeTruthy();
    const duplicated = await dupRes.json();
    expect(duplicated.members.length).toBeGreaterThanOrEqual(1);
    expect(duplicated.members[0].userId).toBe(teamMembers[0].id);

    await delReq(isolatedOrg, `/api/projects/${duplicated.project.id}`);
    await delReq(isolatedOrg, `/api/projects/${project.id}`);
  } finally {
    await tm.dispose();
  }
});
