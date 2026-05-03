import { test, expect } from "../tests/helpers/po/fixtures";
import {
  closeRevPool,
  createTeamMember,
  payoutDedupIndexInstalled,
  sweepOrgRevenue,
} from "./_revenue-helpers";

let dedupIndexInstalled = false;
test.beforeAll(async () => {
  dedupIndexInstalled = await payoutDedupIndexInstalled();
});
test.afterEach(async ({ isolatedOrg }) => {
  await sweepOrgRevenue(isolatedOrg.orgId);
});
test.afterAll(async () => {
  await closeRevPool();
});

test.describe("Payouts — admin surface", () => {
  test("POST creates a payout; duplicate (same TM/date/amount/method) returns 409", async ({
    isolatedOrg,
  }) => {
    const tm = await createTeamMember(isolatedOrg.orgId);
    const today = new Date().toISOString().slice(0, 10);
    const body = {
      teamMemberId: tm,
      amount: 125.5,
      payoutDate: today,
      paymentMethod: "ACH",
      status: "COMPLETED",
    };

    const ok = await isolatedOrg.request.post("/api/payouts", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: body,
    });
    expect(ok.status(), await ok.text()).toBe(200);
    const payout = await ok.json();
    expect(payout.status).toBe("COMPLETED");
    expect(Number(payout.amount)).toBeCloseTo(125.5, 2);

    test.skip(
      !dedupIndexInstalled,
      "uq_payout_dedup index not present in this environment; dedup contract is migration-owned",
    );
    const dup = await isolatedOrg.request.post("/api/payouts", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: body,
    });
    expect(dup.status()).toBe(409);
    expect((await dup.json()).message).toMatch(/already exists/i);
  });

  test("Payouts listing returns only the iso org's payouts", async ({
    isolatedOrg,
  }) => {
    const tm = await createTeamMember(isolatedOrg.orgId);
    await isolatedOrg.request.post("/api/payouts", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: {
        teamMemberId: tm,
        amount: 42,
        payoutDate: new Date().toISOString().slice(0, 10),
        paymentMethod: "ACH",
        status: "COMPLETED",
      },
    });

    const list = await isolatedOrg.request.get("/api/payouts");
    expect(list.status()).toBe(200);
    const payouts = await list.json();
    expect(Array.isArray(payouts)).toBe(true);
    expect(payouts.length).toBeGreaterThanOrEqual(1);
    expect(
      payouts.every((p: { teamMemberId: string }) => p.teamMemberId === tm),
    ).toBe(true);
  });

  test("/execute on COMPLETED payout is rejected (only PENDING)", async ({
    isolatedOrg,
  }) => {
    const tm = await createTeamMember(isolatedOrg.orgId, {
      stripeConnectStatus: "ACTIVE",
      stripeConnectAccountId: "acct_e2e_done",
    });
    const created = await isolatedOrg.request.post("/api/payouts", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: {
        teamMemberId: tm,
        amount: 200,
        payoutDate: new Date().toISOString().slice(0, 10),
        paymentMethod: "ACH",
        status: "COMPLETED",
      },
    });
    expect(created.status()).toBe(200);
    const payout = await created.json();

    const exec = await isolatedOrg.request.post(
      `/api/payouts/${payout.id}/execute`,
      { headers: { "x-csrf-token": isolatedOrg.csrf } },
    );
    expect(exec.status()).toBe(400);
    expect((await exec.json()).message).toMatch(/PENDING/);
  });

  test("/execute rejects W-2 employee with 400 before any Stripe call", async ({
    isolatedOrg,
  }) => {
    const tm = await createTeamMember(isolatedOrg.orgId, {
      workerType: "W2_EMPLOYEE",
      stripeConnectStatus: "ACTIVE",
      stripeConnectAccountId: "acct_e2e_w2",
    });
    const created = await isolatedOrg.request.post("/api/payouts", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: {
        teamMemberId: tm,
        amount: 333,
        payoutDate: new Date().toISOString().slice(0, 10),
        paymentMethod: "ACH",
        status: "PENDING",
      },
    });
    expect(created.status()).toBe(200);
    const payout = await created.json();

    const exec = await isolatedOrg.request.post(
      `/api/payouts/${payout.id}/execute`,
      { headers: { "x-csrf-token": isolatedOrg.csrf } },
    );
    expect(exec.status()).toBe(400);
    expect((await exec.json()).message).toMatch(/W-?2/);
  });
});
