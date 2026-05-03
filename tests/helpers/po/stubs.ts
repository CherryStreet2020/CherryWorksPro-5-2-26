/**
 * Third-party route stubs for E2E specs (Task #435).
 *
 * Each integration listed in functionality-audit.md §3.6 has a small
 * helper here that registers Playwright `page.route(...)` interceptors
 * so downstream specs can opt into deterministic third-party
 * behavior without real network calls.
 *
 * ### Conventions
 *
 *   - Every helper accepts a `Page` and returns nothing; routes are
 *     scoped to that page (so they auto-clean when the page closes).
 *   - Each integration exposes three variants:
 *       `.success(page, payload?)` — fulfill with a happy-path body.
 *       `.failure(page, code?)`   — fulfill with HTTP `code` (default 500).
 *       `.timeout(page)`          — abort after 25s to simulate a hang
 *                                   (Playwright's default actionTimeout
 *                                   is 8s, so the spec will fail-fast
 *                                   before the abort actually fires —
 *                                   that's the intended behavior).
 *   - Default behavior with NO stub installed is "real network call",
 *     so every existing happy-path spec is unaffected.
 *   - Stubs MUST NOT import server code. They live under `tests/`
 *     only and are tree-shakeable from production builds.
 *
 * ### Why route-level (not in-process)
 *
 * Playwright's `page.route` intercepts at the browser layer, so it
 * works for:
 *   - Frontend `fetch` calls to third-party CDNs (e.g. Clearbit logos
 *     fetched directly by the client).
 *   - Server-side calls that the test wants to gate by URL (we add a
 *     `**` glob across both `https://api.example.com/*` and the local
 *     proxy variants the dev server exposes).
 *
 * Server-only calls (Stripe SDK, Groq SDK) hit Node `https.request`
 * which Playwright cannot intercept. For those, the stub helper just
 * registers a "marker" route on a paired health-check URL so the
 * spec author at least gets an explicit no-op rather than a silent
 * failure — and the stub doc string explains the workaround (set the
 * relevant `*_API_KEY` env to the empty string in the test env, which
 * makes the server module short-circuit to a deterministic error).
 */
import type {
  APIRequestContext,
  APIResponse,
  Page,
  Route,
} from "@playwright/test";

type Variant = "success" | "failure" | "timeout";

const HANG_MS = 25_000;

async function fulfillJson(
  route: Route,
  status: number,
  body: unknown,
): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function fulfillText(
  route: Route,
  status: number,
  body: string,
  contentType = "text/plain",
): Promise<void> {
  await route.fulfill({ status, contentType, body });
}

async function hang(route: Route): Promise<void> {
  // Don't `route.abort()` — that returns immediately, which the test
  // sees as a fast-failure rather than a timeout. Sleeping past the
  // configured actionTimeout produces the right shape.
  await new Promise((res) => setTimeout(res, HANG_MS));
  await route.abort("timedout");
}

// ============================================================================
// Stripe — Checkout redirect + webhook event posts.
// Server-side calls go through the Stripe SDK and CANNOT be intercepted by
// Playwright. To deterministically disable Stripe in a spec, prefer
// `setOrgTier(...)` from ./tier.ts (no Stripe contact at all). This stub
// covers the BROWSER-side Checkout redirect URL.
// ============================================================================
export interface StripeWebhookOptions {
  type?: string;
  data?: Record<string, unknown>;
  /** Override the secret header. Default sends an "e2e-test" placeholder
   * — works against any test-env webhook handler with signature
   * verification disabled (set STRIPE_WEBHOOK_SECRET="" or
   * STRIPE_WEBHOOK_VERIFY=0 in the test env). */
  signature?: string;
  /** Endpoint path. Default: `/api/webhooks/stripe`. */
  endpoint?: string;
}

export const stripeStub = {
  async success(page: Page, sessionId = "cs_test_e2e"): Promise<void> {
    await page.route(/checkout\.stripe\.com/, async (route) => {
      await fulfillText(
        route,
        200,
        `<html><body data-testid="stripe-checkout-stub" data-session-id="${sessionId}">Stripe Checkout (stub)</body></html>`,
        "text/html",
      );
    });
  },
  async failure(page: Page, code = 500): Promise<void> {
    await page.route(/checkout\.stripe\.com/, async (route) => {
      await fulfillText(route, code, "Stripe stub failure", "text/plain");
    });
  },
  async timeout(page: Page): Promise<void> {
    await page.route(/checkout\.stripe\.com/, hang);
  },
  /**
   * Build a Stripe webhook event body matching Stripe's `Event` shape.
   * Use with `fireWebhook` (or directly via your own request context).
   */
  buildEvent(opts: StripeWebhookOptions = {}): Record<string, unknown> {
    const type = opts.type ?? "checkout.session.completed";
    const id = `evt_e2e_${Math.random().toString(36).slice(2, 10)}`;
    return {
      id,
      object: "event",
      api_version: "2024-04-10",
      created: Math.floor(Date.now() / 1000),
      type,
      livemode: false,
      pending_webhooks: 1,
      request: { id: null, idempotency_key: null },
      data: {
        object: opts.data ?? {
          id: "cs_test_e2e",
          object: "checkout.session",
          customer: "cus_e2e",
          subscription: "sub_e2e",
          metadata: {},
        },
      },
    };
  },
  /**
   * POST a Stripe webhook event to the local server's webhook endpoint.
   * Returns the response so the spec can assert on the handler's reply.
   * Uses a placeholder `Stripe-Signature` header — the test env must
   * disable signature verification (e.g. `STRIPE_WEBHOOK_VERIFY=0`).
   */
  async fireWebhook(
    request: APIRequestContext,
    opts: StripeWebhookOptions = {},
  ): Promise<APIResponse> {
    const event = this.buildEvent(opts);
    const endpoint = opts.endpoint ?? "/api/webhooks/stripe";
    return request.post(endpoint, {
      headers: {
        "content-type": "application/json",
        "stripe-signature": opts.signature ?? "t=0,v1=e2e-stub",
      },
      data: JSON.stringify(event),
    });
  },
};

// ============================================================================
// Microsoft Graph — token + sendMail. Both server-side; intercept any
// browser-initiated OAuth redirect.
// ============================================================================
export const graphStub = {
  async success(page: Page): Promise<void> {
    await page.route(/login\.microsoftonline\.com|graph\.microsoft\.com/, async (route) => {
      const url = route.request().url();
      if (/oauth2\/v2\.0\/token/.test(url)) {
        return fulfillJson(route, 200, {
          access_token: "graph-stub-access",
          refresh_token: "graph-stub-refresh",
          expires_in: 3600,
          token_type: "Bearer",
          scope: "Mail.Send offline_access",
        });
      }
      if (/sendMail/.test(url)) {
        return route.fulfill({ status: 202, body: "" });
      }
      // Any other Graph URL — generic OK
      return fulfillJson(route, 200, { ok: true });
    });
  },
  async failure(page: Page, code = 500): Promise<void> {
    await page.route(/login\.microsoftonline\.com|graph\.microsoft\.com/, async (route) => {
      await fulfillJson(route, code, { error: { code: "stub_failure", message: "Graph stub failure" } });
    });
  },
  async timeout(page: Page): Promise<void> {
    await page.route(/login\.microsoftonline\.com|graph\.microsoft\.com/, hang);
  },
};

// ============================================================================
// Gmail — token + send.
// ============================================================================
export const gmailStub = {
  async success(page: Page): Promise<void> {
    await page.route(/oauth2\.googleapis\.com|gmail\.googleapis\.com|accounts\.google\.com/, async (route) => {
      const url = route.request().url();
      if (/token/.test(url)) {
        return fulfillJson(route, 200, {
          access_token: "gmail-stub-access",
          refresh_token: "gmail-stub-refresh",
          expires_in: 3600,
          token_type: "Bearer",
          scope: "https://www.googleapis.com/auth/gmail.send",
        });
      }
      if (/messages\/send/.test(url)) {
        return fulfillJson(route, 200, { id: "gmail-stub-msg-id", threadId: "gmail-stub-thread" });
      }
      return fulfillJson(route, 200, { ok: true });
    });
  },
  async failure(page: Page, code = 500): Promise<void> {
    await page.route(/oauth2\.googleapis\.com|gmail\.googleapis\.com|accounts\.google\.com/, async (route) => {
      await fulfillJson(route, code, { error: { code, message: "Gmail stub failure" } });
    });
  },
  async timeout(page: Page): Promise<void> {
    await page.route(/oauth2\.googleapis\.com|gmail\.googleapis\.com|accounts\.google\.com/, hang);
  },
};

// ============================================================================
// Groq OCR + Tesseract fallback.
// Server-side LLM calls. The browser-side stub only catches the rare
// case where the dev tools or a debugging surface hits Groq directly.
// For server-side determinism, set GROQ_API_KEY="" in the test env so
// the provider module short-circuits to the Tesseract fallback path.
// ============================================================================
export const groqStub = {
  async success(page: Page, body: unknown = { choices: [{ message: { content: "{\"vendor\":\"Stub Co\",\"total\":12.34}" } }] }): Promise<void> {
    await page.route(/api\.groq\.com/, async (route) => {
      await fulfillJson(route, 200, body);
    });
  },
  async failure(page: Page, code = 500): Promise<void> {
    await page.route(/api\.groq\.com/, async (route) => {
      await fulfillJson(route, code, { error: "groq stub failure" });
    });
  },
  async timeout(page: Page): Promise<void> {
    await page.route(/api\.groq\.com/, hang);
  },
};

export const tesseractStub = {
  /**
   * Tesseract runs in-process (no HTTP). The stub-toggle approach is
   * to set `TESSERACT_FALLBACK_DISABLED=1` in the test env so the
   * provider returns a deterministic "no fallback available" error.
   * This helper is a no-op marker so spec authors get an explicit
   * "I considered Tesseract" call site.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async success(_page: Page): Promise<void> {
    // Intentional no-op — see docstring.
  },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async failure(_page: Page): Promise<void> {
    // Intentional no-op — see docstring.
  },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async timeout(_page: Page): Promise<void> {
    // Intentional no-op — see docstring.
  },
};

// ============================================================================
// Frankfurter FX — public REST. Browser & server BOTH may call it.
// ============================================================================
export const frankfurterStub = {
  async success(
    page: Page,
    rates: Record<string, number> = { EUR: 0.92, GBP: 0.79, CAD: 1.36 },
    base = "USD",
  ): Promise<void> {
    await page.route(/api\.frankfurter\.app|frankfurter\.dev/, async (route) => {
      await fulfillJson(route, 200, { amount: 1, base, date: new Date().toISOString().slice(0, 10), rates });
    });
  },
  async failure(page: Page, code = 500): Promise<void> {
    await page.route(/api\.frankfurter\.app|frankfurter\.dev/, async (route) => {
      await fulfillJson(route, code, { error: "frankfurter stub failure" });
    });
  },
  async timeout(page: Page): Promise<void> {
    await page.route(/api\.frankfurter\.app|frankfurter\.dev/, hang);
  },
};

// ============================================================================
// Clearbit logo CDN — direct image fetches from the client.
// ============================================================================
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

export const clearbitStub = {
  async success(page: Page): Promise<void> {
    await page.route(/logo\.clearbit\.com/, async (route) => {
      await route.fulfill({ status: 200, contentType: "image/png", body: TINY_PNG });
    });
  },
  async failure(page: Page, code = 404): Promise<void> {
    await page.route(/logo\.clearbit\.com/, async (route) => {
      await fulfillText(route, code, "no logo");
    });
  },
  async timeout(page: Page): Promise<void> {
    await page.route(/logo\.clearbit\.com/, hang);
  },
};

// ============================================================================
// Plaid — link + accounts. Server-side; browser may hit cdn.plaid.com.
// ============================================================================
export const plaidStub = {
  async success(page: Page): Promise<void> {
    await page.route(/plaid\.com|cdn\.plaid\.com/, async (route) => {
      const url = route.request().url();
      if (/link\/token\/create/.test(url)) {
        return fulfillJson(route, 200, { link_token: "link-stub-token", expiration: new Date(Date.now() + 3600_000).toISOString() });
      }
      if (/item\/public_token\/exchange/.test(url)) {
        return fulfillJson(route, 200, { access_token: "plaid-stub-access", item_id: "plaid-stub-item" });
      }
      if (/accounts\/get/.test(url)) {
        return fulfillJson(route, 200, {
          accounts: [
            { account_id: "plaid-stub-acct", name: "Stub Checking", type: "depository", subtype: "checking", balances: { current: 1000, available: 1000 } },
          ],
          item: { item_id: "plaid-stub-item" },
        });
      }
      return fulfillJson(route, 200, { ok: true });
    });
  },
  async failure(page: Page, code = 500): Promise<void> {
    await page.route(/plaid\.com|cdn\.plaid\.com/, async (route) => {
      await fulfillJson(route, code, { error_code: "STUB_FAILURE", error_message: "Plaid stub failure" });
    });
  },
  async timeout(page: Page): Promise<void> {
    await page.route(/plaid\.com|cdn\.plaid\.com/, hang);
  },
};

// ============================================================================
// Resend inbound webhook — payload builder. Resend is INBOUND-only here;
// the spec-side code POSTs the payload to our own /api/* endpoints to
// simulate the webhook. No Playwright route needed — exposed as a
// builder so every spec uses the same shape.
// ============================================================================
export interface ResendInboundPayloadOptions {
  type?: "email.bounced" | "email.complained" | "email.delivered" | "email.delivery_delayed";
  to?: string;
  from?: string;
  subject?: string;
  bouncedAt?: string;
  reason?: string;
}

export const resendStub = {
  build(opts: ResendInboundPayloadOptions = {}): unknown {
    const type = opts.type ?? "email.bounced";
    return {
      type,
      created_at: new Date().toISOString(),
      data: {
        email_id: `re_stub_${Math.random().toString(36).slice(2, 10)}`,
        from: opts.from ?? "noreply@e2e.test",
        to: [opts.to ?? "bounce@e2e.test"],
        subject: opts.subject ?? "E2E test",
        bounced_at: opts.bouncedAt ?? new Date().toISOString(),
        bounce: type === "email.bounced"
          ? { type: "permanent", subType: "general", message: opts.reason ?? "stub bounce" }
          : undefined,
      },
    };
  },
};

/**
 * Convenience: install ALL stubs in success-mode on a page. Useful for
 * specs that just want a deterministic third-party shell with no
 * particular assertion against any individual integration.
 */
export async function stubAllSuccess(page: Page): Promise<void> {
  await stripeStub.success(page);
  await graphStub.success(page);
  await gmailStub.success(page);
  await groqStub.success(page);
  await frankfurterStub.success(page);
  await clearbitStub.success(page);
  await plaidStub.success(page);
}

/** Type marker so spec authors can iterate stubs uniformly if needed. */
export type StubVariant = Variant;
