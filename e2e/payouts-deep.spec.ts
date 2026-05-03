import { test, expect } from "../tests/helpers/po/fixtures";
import {
  closeRevPool,
  createTeamMember,
  revPool,
  sweepOrgRevenue,
} from "./_revenue-helpers";

test.afterEach(async ({ isolatedOrg }) => {
  await sweepOrgRevenue(isolatedOrg.orgId);
});
test.afterAll(async () => {
  await closeRevPool();
});

test.describe("Payouts — admin surface", () => {
  test("POST creates a payout and surfaces 23505 dedup as 409 when the constraint catches it", async ({
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

    // The route catches Postgres 23505 on `uq_payout_dedup` and returns
    // 409. The constraint isn't installed in every environment, so we
    // only enforce the contract when it exists; otherwise duplicates
    // are allowed and the test simply documents that.
    // Reuse the shared helper pool — never spin up a per-test Pool that
    // we'd have to remember to .end(), or it leaks connections.
    const idx = await revPool().query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM pg_indexes WHERE indexname = 'uq_payout_dedup'
       ) AS exists`,
    );
    const dedupInstalled = idx.rows[0]?.exists === true;

    const dup = await isolatedOrg.request.post("/api/payouts", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: body,
    });
    expect(dup.status()).toBe(dedupInstalled ? 409 : 200);
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
