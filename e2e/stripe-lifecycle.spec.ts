import { test, expect } from "../tests/helpers/po/fixtures";
import { randomBytes } from "node:crypto";
import {
  buildStripeEvent,
  closeRevPool,
  fireSignedStripeEvent,
  readOrgBilling,
  setOrgStripeCustomer,
  sweepOrgRevenue,
} from "./_revenue-helpers";

interface WebhookAck {
  received?: boolean;
  duplicate?: boolean;
  routed?: string;
}

test.afterEach(async ({ isolatedOrg }) => {
  await sweepOrgRevenue(isolatedOrg.orgId);
});
test.afterAll(async () => {
  await closeRevPool();
});

test.describe("Stripe subscription lifecycle (checkout → past_due → canceled)", () => {
  test("rejects unsigned and bad-signature webhooks with 400", async ({
    isolatedOrg,
  }) => {
    const event = buildStripeEvent({
      type: "customer.subscription.updated",
      data: { id: "sub_x", customer: "cus_x", status: "active" },
    });

    const noSig = await isolatedOrg.request.post("/api/webhooks/stripe", {
      headers: { "content-type": "application/json" },
      data: JSON.stringify(event),
    });
    expect(noSig.status()).toBe(400);

    const badSig = await isolatedOrg.request.post("/api/webhooks/stripe", {
      headers: {
        "content-type": "application/json",
        "stripe-signature": "t=0,v1=deadbeef",
      },
      data: JSON.stringify(event),
    });
    expect(badSig.status()).toBe(400);
  });

  test("checkout → trialing; past_due preserves planTier; deleted → EXPIRED + canceled", async ({
    isolatedOrg,
  }) => {
    const customerId = `cus_e2e_${randomBytes(6).toString("hex")}`;
    const subId = `sub_e2e_${randomBytes(6).toString("hex")}`;

    await setOrgStripeCustomer(isolatedOrg.orgId, customerId);

    const checkoutEvent = buildStripeEvent({
      type: "checkout.session.completed",
      data: {
        id: `cs_e2e_${randomBytes(6).toString("hex")}`,
        object: "checkout.session",
        mode: "subscription",
        customer: customerId,
        subscription: subId,
        metadata: { orgId: isolatedOrg.orgId, planTier: "PROFESSIONAL" },
      },
    });
    const r1 = await fireSignedStripeEvent(isolatedOrg.request, checkoutEvent);
    expect(r1.status(), await r1.text()).toBe(200);

    let billing = await readOrgBilling(isolatedOrg.orgId);
    expect(billing.subscriptionStatus).toBe("trialing");
    expect(billing.planTier).toBe("PROFESSIONAL");
    expect(billing.stripeSubscriptionId).toBe(subId);

    const replay = await fireSignedStripeEvent(isolatedOrg.request, checkoutEvent);
    expect(replay.status()).toBe(200);
    const replayBody = (await replay.json()) as WebhookAck;
    expect(replayBody.duplicate).toBe(true);

    const pastDueEvent = buildStripeEvent({
      type: "customer.subscription.updated",
      data: {
        id: subId,
        object: "subscription",
        customer: customerId,
        status: "past_due",
        items: { data: [] },
      },
    });
    const r2 = await fireSignedStripeEvent(isolatedOrg.request, pastDueEvent);
    expect(r2.status(), await r2.text()).toBe(200);

    billing = await readOrgBilling(isolatedOrg.orgId);
    expect(billing.subscriptionStatus).toBe("past_due");
    expect(billing.planTier).toBe("PROFESSIONAL");

    const deletedEvent = buildStripeEvent({
      type: "customer.subscription.deleted",
      data: {
        id: subId,
        object: "subscription",
        customer: customerId,
        status: "canceled",
        items: { data: [] },
      },
    });
    const r3 = await fireSignedStripeEvent(isolatedOrg.request, deletedEvent);
    expect(r3.status(), await r3.text()).toBe(200);

    billing = await readOrgBilling(isolatedOrg.orgId);
    expect(billing.subscriptionStatus).toBe("canceled");
    expect(billing.planTier).toBe("EXPIRED");
    expect(billing.stripeSubscriptionId).toBeNull();
  });

  test("signed webhook for unknown customer is acknowledged (no org mutation)", async ({
    isolatedOrg,
  }) => {
    const event = buildStripeEvent({
      type: "customer.subscription.updated",
      data: {
        id: "sub_unknown",
        object: "subscription",
        customer: "cus_does_not_exist",
        status: "active",
        items: { data: [] },
      },
    });
    const before = await readOrgBilling(isolatedOrg.orgId);
    const r = await fireSignedStripeEvent(isolatedOrg.request, event);
    expect(r.status()).toBe(200);
    const after = await readOrgBilling(isolatedOrg.orgId);
    expect(after.subscriptionStatus).toBe(before.subscriptionStatus);
    expect(after.planTier).toBe(before.planTier);
  });
});
