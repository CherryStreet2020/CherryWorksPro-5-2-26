import { test, expect } from "@playwright/test";

test("create project, duplicate, verify copy in list", async ({ request }) => {
  const loginRes = await request.post("/api/auth/login", {
    data: { email: "dean@cherrystconsulting.com", password: "admin123" },
  });
  expect(loginRes.ok()).toBeTruthy();

  const clientsRes = await request.get("/api/clients");
  expect(clientsRes.ok()).toBeTruthy();
  const clients = await clientsRes.json();
  expect(clients.length).toBeGreaterThan(0);
  const client = clients[0];

  const uniqueSuffix = Date.now().toString(36);
  const projectName = `E2E Test Project ${uniqueSuffix}`;

  const createRes = await request.post("/api/projects", {
    data: {
      name: projectName,
      clientId: client.id,
      description: "E2E duplicate test project",
    },
  });
  expect(createRes.ok()).toBeTruthy();
  const created = await createRes.json();
  expect(created.name).toBe(projectName);

  const projectsRes = await request.get("/api/projects");
  expect(projectsRes.ok()).toBeTruthy();
  const projectsList = await projectsRes.json();
  const found = projectsList.find((p: any) => p.id === created.id);
  expect(found).toBeDefined();
  expect(found.name).toBe(projectName);

  const dupRes = await request.post(`/api/projects/${created.id}/duplicate`);
  expect(dupRes.ok()).toBeTruthy();
  const duplicated = await dupRes.json();
  expect(duplicated.project.name).toBe(`${projectName} (Copy)`);
  expect(duplicated.project.clientId).toBe(client.id);
  expect(duplicated.project.description).toBe("E2E duplicate test project");
  expect(duplicated.project.status).toBe("ACTIVE");

  const projectsRes2 = await request.get("/api/projects");
  expect(projectsRes2.ok()).toBeTruthy();
  const projectsList2 = await projectsRes2.json();
  const foundCopy = projectsList2.find((p: any) => p.id === duplicated.project.id);
  expect(foundCopy).toBeDefined();
  expect(foundCopy.name).toBe(`${projectName} (Copy)`);

  await request.delete(`/api/projects/${duplicated.project.id}`);
  await request.delete(`/api/projects/${created.id}`);
});

test("duplicate copies project members", async ({ request }) => {
  const loginRes = await request.post("/api/auth/login", {
    data: { email: "dean@cherrystconsulting.com", password: "admin123" },
  });
  expect(loginRes.ok()).toBeTruthy();

  const clientsRes = await request.get("/api/clients");
  const clients = await clientsRes.json();
  const client = clients[0];

  const teamMembersRes = await request.get("/api/users/team-members");
  const teamMembers = await teamMembersRes.json();

  const uniqueSuffix = Date.now().toString(36);
  const createRes = await request.post("/api/projects", {
    data: {
      name: `Member Copy Test ${uniqueSuffix}`,
      clientId: client.id,
    },
  });
  expect(createRes.ok()).toBeTruthy();
  const project = await createRes.json();

  if (teamMembers.length > 0) {
    const memberRes = await request.post(`/api/projects/${project.id}/members`, {
      data: {
        userId: teamMembers[0].id,
        hourlyRate: 150,
      },
    });
    expect(memberRes.ok()).toBeTruthy();

    const dupRes = await request.post(`/api/projects/${project.id}/duplicate`);
    expect(dupRes.ok()).toBeTruthy();
    const duplicated = await dupRes.json();
    expect(duplicated.members.length).toBeGreaterThanOrEqual(1);
    expect(duplicated.members[0].userId).toBe(teamMembers[0].id);

    await request.delete(`/api/projects/${duplicated.project.id}`);
  }

  await request.delete(`/api/projects/${project.id}`);
});
