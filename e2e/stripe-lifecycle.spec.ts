import { test, expect } from "../tests/helpers/po/fixtures";
import { randomBytes } from "node:crypto";
import {
  buildStripeEvent,
  closeRevPool,
  fireSignedStripeEvent,
  readOrgBilling,
  setOrgStripeCustomer,
  signStripePayload,
  sweepOrgRevenue,
} from "./_revenue-helpers";

test.afterEach(async ({ isolatedOrg }) => {
  await sweepOrgRevenue(isolatedOrg.orgId);
});
test.afterAll(async () => {
  await closeRevPool();
});

test.describe("Stripe subscription lifecycle (checkout → past_due → canceled)", () => {
  test("rejects unsigned (and bad-signature) webhooks with 400", async ({
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

  test("checkout.session.completed → trialing; sub.updated past_due preserves planTier; sub.deleted → EXPIRED", async ({
    isolatedOrg,
  }) => {
    const customerId = `cus_e2e_${randomBytes(6).toString("hex")}`;
    const subId = `sub_e2e_${randomBytes(6).toString("hex")}`;

    // Bind customer → org so customer-keyed webhooks can resolve the org.
    await setOrgStripeCustomer(isolatedOrg.orgId, customerId);

    // 1) checkout.session.completed (subscription mode, metadata.orgId)
    const checkoutEvent = buildStripeEvent({
      type: "checkout.session.completed",
      data: {
        id: `cs_e2e_${randomBytes(6).toString("hex")}`,
        object: "checkout.session",
        mode: "subscription",
        customer: customerId,
        subscription: subId,
        // payment_method_collection deliberately omitted to skip the
        // fingerprint-reuse Stripe API call.
        metadata: { orgId: isolatedOrg.orgId, planTier: "PROFESSIONAL" },
      },
    });
    const r1 = await fireSignedStripeEvent(isolatedOrg.request, checkoutEvent);
    expect(r1.status(), await r1.text()).toBe(200);

    let billing = await readOrgBilling(isolatedOrg.orgId);
    expect(billing.subscriptionStatus).toBe("trialing");
    expect(billing.planTier).toBe("PROFESSIONAL");
    expect(billing.stripeSubscriptionId).toBe(subId);

    // Replay the same event id → handler reports duplicate.
    const replay = await fireSignedStripeEvent(isolatedOrg.request, checkoutEvent);
    expect(replay.status()).toBe(200);
    expect(((await replay.json()) as any).duplicate).toBe(true);

    // 2) customer.subscription.updated → past_due
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
    // Tier preserved across past_due (grace window — billing is not yet revoked).
    expect(billing.planTier).toBe("PROFESSIONAL");

    // 3) customer.subscription.deleted → EXPIRED + canceled
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
    // No customer→org match exists, so iso org is untouched.
    expect(after.subscriptionStatus).toBe(before.subscriptionStatus);
    expect(after.planTier).toBe(before.planTier);
    // Sanity: the signing path itself is exercised.
    expect(typeof signStripePayload(JSON.stringify(event))).toBe("string");
  });
});
