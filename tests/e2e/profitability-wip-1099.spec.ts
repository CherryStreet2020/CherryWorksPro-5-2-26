import { test, expect } from "../helpers/po/fixtures";
import { patchJson, loginIsoTeamMember } from "./_helpers";

test("admin opens reports -> runs profitability + wip -> verifies totals not NaN and stable", async ({
  isolatedOrg,
}) => {
  const profitRes = await isolatedOrg.request.get(
    "/api/reports/profitability?startDate=2000-01-01&endDate=2099-12-31",
  );
  expect(profitRes.ok()).toBeTruthy();
  const profitJson = await profitRes.json();
  // The endpoint may return either an array of rows or `{rows: [...]}`.
  const profitData: any[] = Array.isArray(profitJson) ? profitJson : profitJson.rows ?? [];
  expect(Array.isArray(profitData)).toBeTruthy();

  for (const row of profitData) {
    expect(typeof row.revenue).toBe("number");
    expect(typeof row.cost).toBe("number");
    expect(typeof row.profit).toBe("number");
    expect(typeof row.margin).toBe("number");
    expect(Number.isNaN(row.revenue)).toBe(false);
    expect(Number.isNaN(row.cost)).toBe(false);
    expect(Number.isNaN(row.profit)).toBe(false);
    expect(Number.isNaN(row.margin)).toBe(false);
  }

  const profitRes2 = await isolatedOrg.request.get(
    "/api/reports/profitability?startDate=2000-01-01&endDate=2099-12-31",
  );
  expect(profitRes2.ok()).toBeTruthy();
  const profitJson2 = await profitRes2.json();
  expect(profitJson).toEqual(profitJson2);

  const wipRes = await isolatedOrg.request.get("/api/reports/wip-aging");
  expect(wipRes.ok()).toBeTruthy();
  const wipData = await wipRes.json();
  expect(typeof wipData.totalEntries).toBe("number");
  expect(Number.isNaN(wipData.totalEntries)).toBe(false);
  expect(typeof wipData.byTeamMember).toBe("object");
  expect(typeof wipData.byClient).toBe("object");
  expect(typeof wipData.byProject).toBe("object");

  for (const [, buckets] of Object.entries(wipData.byTeamMember) as [
    string,
    Record<string, number>,
  ][]) {
    for (const val of Object.values(buckets)) {
      expect(Number.isNaN(val)).toBe(false);
    }
  }

  const wipRes2 = await isolatedOrg.request.get("/api/reports/wip-aging");
  expect(wipRes2.ok()).toBeTruthy();
  const wipData2 = await wipRes2.json();
  expect(wipData).toEqual(wipData2);
});

test("admin exports 1099 CSV -> verifies CSV non-empty and has expected headers", async ({
  isolatedOrg,
}) => {
  // The iso org starts with 1 admin user and 0 team members. Add one
  // so the 1099-eligible filter has a candidate to surface.
  const tm = await loginIsoTeamMember(isolatedOrg);
  try {
    const teamMembersRes = await isolatedOrg.request.get("/api/users/team-members");
    expect(teamMembersRes.ok()).toBeTruthy();
    const teamMembers = await teamMembersRes.json();
    expect(teamMembers.length).toBeGreaterThan(0);

    const firstTeamMember = teamMembers[0];
    const updateRes = await patchJson(
      isolatedOrg,
      `/api/users/${firstTeamMember.id}/profile`,
      {
        legalName: "Iso Test Member",
        mailingAddress: "1 Iso Way, Test City, ON",
        is1099Eligible: true,
      },
    );
    expect(updateRes.ok()).toBeTruthy();

    const csvRes = await isolatedOrg.request.get(
      "/api/reports/1099-export?startDate=2000-01-01&endDate=2099-12-31",
    );
    expect(csvRes.ok()).toBeTruthy();

    const contentType = csvRes.headers()["content-type"];
    expect(contentType).toContain("text/csv");

    const csv = await csvRes.text();
    const lines = csv.trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(1);

    const header = lines[0];
    expect(header).toBe("legalName,email,totalPaidAmount");

    if (lines.length > 1) {
      const dataLine = lines[1];
      expect(dataLine.length).toBeGreaterThan(0);
      const parts = dataLine.split(",");
      expect(parts.length).toBe(3);
    }

    const updateRes2 = await patchJson(
      isolatedOrg,
      `/api/users/${firstTeamMember.id}/profile`,
      { is1099Eligible: false },
    );
    expect(updateRes2.ok()).toBeTruthy();
  } finally {
    await tm.dispose();
  }
});
