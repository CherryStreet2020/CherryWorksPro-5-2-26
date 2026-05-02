interface CheckoutParams {
  invoiceNumber: string;
  amountCents: number;
  currency?: string;
  successUrl: string;
  cancelUrl: string;
  publicToken: string;
  idempotencyKey?: string;
}

interface CheckoutResult {
  url: string;
  sessionId: string;
}

export async function createStripeCheckout(params: CheckoutParams): Promise<CheckoutResult> {
  if (!Number.isInteger(params.amountCents) || params.amountCents <= 0 || params.amountCents > 999_999_999) {
    throw new Error("Invalid payment amount");
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    throw new Error("Stripe secret key is not configured");
  }

  const Stripe = (await import("stripe")).default;
  const stripe = new Stripe(stripeKey);

  const createParams: any = {
    payment_method_types: ["card", "us_bank_account"],
    payment_method_options: {
      us_bank_account: {
        verification_method: "instant",
      },
    },
    line_items: [
      {
        price_data: {
          currency: (params.currency || "USD").toLowerCase(),
          product_data: {
            name: `Invoice ${params.invoiceNumber}`,
          },
          unit_amount: params.amountCents,
        },
        quantity: 1,
      },
    ],
    mode: "payment",
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    metadata: {
      publicToken: params.publicToken,
    },
  };

  const requestOptions: any = {};
  if (params.idempotencyKey) {
    requestOptions.idempotencyKey = params.idempotencyKey;
  }

  const session = await stripe.checkout.sessions.create(createParams, requestOptions);

  return {
    url: session.url || params.cancelUrl,
    sessionId: session.id,
  };
}
