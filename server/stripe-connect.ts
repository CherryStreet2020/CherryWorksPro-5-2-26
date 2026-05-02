import Stripe from "stripe";

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  return new Stripe(key);
}

function splitName(name: string | null | undefined): { first: string; last: string } {
  const trimmed = (name || "").trim();
  if (!trimmed) return { first: "Unknown", last: "" };
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx === -1) return { first: trimmed, last: "" };
  return { first: trimmed.slice(0, spaceIdx), last: trimmed.slice(spaceIdx + 1) };
}

export async function createConnectAccount(
  email: string,
  name: string,
): Promise<{ accountId: string }> {
  const stripe = getStripe();
  const { first, last } = splitName(name);
  const account = await stripe.accounts.create({
    type: "express",
    email,
    capabilities: {
      transfers: { requested: true },
    },
    business_type: "individual",
    individual: {
      email,
      first_name: first,
      last_name: last || undefined,
    },
    settings: {
      payouts: {
        schedule: { interval: "manual" },
      },
    },
  });
  return { accountId: account.id };
}

export async function createAccountLink(
  stripeAccountId: string,
  refreshUrl: string,
  returnUrl: string,
): Promise<{ url: string }> {
  const stripe = getStripe();
  const link = await stripe.accountLinks.create({
    account: stripeAccountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: "account_onboarding",
  });
  return { url: link.url };
}

export async function getAccountStatus(
  stripeAccountId: string,
): Promise<{
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requirementsCurrentlyDue: string[];
}> {
  const stripe = getStripe();
  const account = await stripe.accounts.retrieve(stripeAccountId);
  return {
    chargesEnabled: account.charges_enabled ?? false,
    payoutsEnabled: account.payouts_enabled ?? false,
    detailsSubmitted: account.details_submitted ?? false,
    requirementsCurrentlyDue: (account.requirements?.currently_due as string[]) || [],
  };
}

export async function createTransferToConnectedAccount(
  stripeAccountId: string,
  amountCents: number,
  currency: string,
  description: string,
  idempotencyKey: string,
): Promise<{ transferId: string; status: string }> {
  const stripe = getStripe();
  const transfer = await stripe.transfers.create(
    {
      amount: amountCents,
      currency: currency.toLowerCase(),
      destination: stripeAccountId,
      description,
    },
    { idempotencyKey },
  );
  return { transferId: transfer.id, status: "pending" };
}

export async function getTransferHistory(
  stripeAccountId: string,
  limit: number = 25,
): Promise<Array<{ id: string; amount: number; currency: string; created: number; description: string | null }>> {
  const stripe = getStripe();
  const transfers = await stripe.transfers.list({
    destination: stripeAccountId,
    limit,
  });
  return transfers.data.map((t) => ({
    id: t.id,
    amount: t.amount,
    currency: t.currency,
    created: t.created,
    description: t.description,
  }));
}

export async function createConnectLoginLink(
  stripeAccountId: string,
): Promise<{ url: string }> {
  const stripe = getStripe();
  const link = await stripe.accounts.createLoginLink(stripeAccountId);
  return { url: link.url };
}
