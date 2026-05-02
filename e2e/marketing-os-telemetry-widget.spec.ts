/**
 * Task #204 — Automated coverage for the Marketing OS upgrade interest widget
 * (admin dashboard).
 *
 * The widget is wired end-to-end:
 *   POST /api/telemetry/marketing-os         persists each discovery event
 *   GET  /api/telemetry/marketing-os/summary aggregates 7d / 30d funnels
 *   <MarketingOsTelemetryCard />             renders the funnel on /dashboard
 *
 * Assertions:
 *   1. Admin posts a known mix of events; the dashboard card shows counts and
 *      conversion percentages that match the API summary (delta == what we
 *      posted, rates derived from the new totals).
 *   2. Events created from a *different* org (the seeded PSO-only dev org) do
 *      not bleed into the QA org's funnel counts.
 *   3. A non-admin (TEAM_MEMBER) does not see the widget on /dashboard, and
 *      the underlying admin endpoints reject them with 403.
 */
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { pool } from "../server/db";

const QA_ADMIN_EMAIL = "admin.test@cwpro.dev";
const QA_ADMIN_PASS = "admin123";
const QA_TEAM_EMAIL = "team.test@cwpro.dev";
const QA_TEAM_PASS = "team123";
const PSO_ADMIN_EMAIL = "admin.pso.test@cwpro.dev";
const PSO_ADMIN_PASS = "psoAdmin123";

type SummaryWindow = {
  days: number;
  sectionShown: number;
  modalOpened: number;
  checkoutClicked: number;
  shownToModalRate: number;
  modalToCheckoutRate: number;
  shownToCheckoutRate: number;
};
type Summary = { last7Days: SummaryWindow; last30Days: SummaryWindow };

async function loginViaApi(
  api: APIRequestContext,
  email: string,
  password: string,
): Promise<{ csrf: string }> {
  const r = await api.post("/api/auth/login", { data: { email, password } });
  expect(r.status(), `login as ${email} should succeed`).toBe(200);
  const tok = await api.get("/api/csrf-token");
  expect(tok.status()).toBe(200);
  const body = await tok.json();
  const csrf = (body.token ?? body.csrfToken) as string;
  expect(csrf, "csrf token should be returned").toBeTruthy();
  return { csrf };
}

async function logout(api: APIRequestContext, csrf: string) {
  await api.post("/api/auth/logout", { headers: { "x-csrf-token": csrf } });
}

async function loginViaUi(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.waitForSelector('[data-testid="input-email"]', { timeout: 15_000 });
  await page.fill('[data-testid="input-email"]', email);
  await page.fill('[data-testid="input-password"]', password);
  await page.click('[data-testid="button-login"]');
  await page.waitForURL("**/", { timeout: 15_000 });
}

async function getSummary(api: APIRequestContext): Promise<Summary> {
  const r = await api.get("/api/telemetry/marketing-os/summary");
  expect(r.status()).toBe(200);
  return (await r.json()) as Summary;
}

async function postEvent(
  api: APIRequestContext,
  csrf: string,
  event:
    | "marketing_os.discovery.section_shown"
    | "marketing_os.discovery.modal_opened"
    | "marketing_os.discovery.checkout_clicked",
  props: Record<string, unknown> = {},
) {
  const r = await api.post("/api/telemetry/marketing-os", {
    data: { event, props },
    headers: { "x-csrf-token": csrf },
  });
  expect(r.status(), `posting ${event} should succeed`).toBe(204);
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

/**
 * Independent reimplementation of the server's `safeRate` so the UI/API
 * percentages can be checked against locally-derived ground truth instead of
 * trusting the rate fields the server returned. A regression in the
 * server-side conversion math would now show up as a mismatch between this
 * function's output and what the widget renders.
 */
function expectedRate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 1000;
}

test.describe("Marketing OS upgrade interest widget — admin", () => {
  test("widget shows real counts and percentages from posted events", async ({
    page,
    request,
  }) => {
    const { csrf } = await loginViaApi(request, QA_ADMIN_EMAIL, QA_ADMIN_PASS);

    // Baseline: capture what the QA org already has so we can assert deltas.
    const before = await getSummary(request);

    // Seed a known mix into THIS org. Choose values that would give a
    // distinctive shown -> checkout rate so the percentage assertion is
    // meaningful (not 0% or 100%).
    const SHOWN = 5;
    const MODAL = 3;
    const CHECKOUT = 2;
    for (let i = 0; i < SHOWN; i++) {
      await postEvent(request, csrf, "marketing_os.discovery.section_shown");
    }
    for (let i = 0; i < MODAL; i++) {
      await postEvent(request, csrf, "marketing_os.discovery.modal_opened", {
        source: "card",
      });
    }
    for (let i = 0; i < CHECKOUT; i++) {
      await postEvent(request, csrf, "marketing_os.discovery.checkout_clicked");
    }

    // The summary must reflect those exact deltas in BOTH windows (7d and 30d
    // contain "now", so freshly inserted rows land in both).
    const after = await getSummary(request);
    expect(after.last7Days.sectionShown - before.last7Days.sectionShown).toBe(SHOWN);
    expect(after.last7Days.modalOpened - before.last7Days.modalOpened).toBe(MODAL);
    expect(after.last7Days.checkoutClicked - before.last7Days.checkoutClicked).toBe(
      CHECKOUT,
    );
    expect(after.last30Days.sectionShown - before.last30Days.sectionShown).toBe(SHOWN);
    expect(after.last30Days.modalOpened - before.last30Days.modalOpened).toBe(MODAL);
    expect(
      after.last30Days.checkoutClicked - before.last30Days.checkoutClicked,
    ).toBe(CHECKOUT);

    // Render the dashboard and assert the widget shows what the API returned.
    await loginViaUi(page, QA_ADMIN_EMAIL, QA_ADMIN_PASS);
    await page.goto("/");

    const card = page.locator('[data-testid="card-marketing-os-telemetry"]');
    await expect(card).toBeVisible({ timeout: 15_000 });

    for (const w of [after.last7Days, after.last30Days] as const) {
      // Compute percentages locally from the raw counts so a regression in
      // the server's conversion math (a faulty rate field) would surface
      // here instead of being masked by reusing the API's own rates.
      const expectedShownToModal = expectedRate(w.modalOpened, w.sectionShown);
      const expectedModalToCheckout = expectedRate(
        w.checkoutClicked,
        w.modalOpened,
      );
      const expectedShownToCheckout = expectedRate(
        w.checkoutClicked,
        w.sectionShown,
      );
      expect(w.shownToModalRate).toBe(expectedShownToModal);
      expect(w.modalToCheckoutRate).toBe(expectedModalToCheckout);
      expect(w.shownToCheckoutRate).toBe(expectedShownToCheckout);

      await expect(
        page.locator(
          `[data-testid="text-marketing-os-telemetry-${w.days}d-section-shown"]`,
        ),
      ).toHaveText(String(w.sectionShown));
      await expect(
        page.locator(
          `[data-testid="text-marketing-os-telemetry-${w.days}d-modal-opened"]`,
        ),
      ).toHaveText(String(w.modalOpened));
      await expect(
        page.locator(
          `[data-testid="text-marketing-os-telemetry-${w.days}d-checkout-clicked"]`,
        ),
      ).toHaveText(String(w.checkoutClicked));
      await expect(
        page.locator(
          `[data-testid="text-marketing-os-telemetry-${w.days}d-shown-to-modal"]`,
        ),
      ).toHaveText(pct(expectedShownToModal));
      await expect(
        page.locator(
          `[data-testid="text-marketing-os-telemetry-${w.days}d-modal-to-checkout"]`,
        ),
      ).toHaveText(pct(expectedModalToCheckout));
      await expect(
        page.locator(
          `[data-testid="text-marketing-os-telemetry-${w.days}d-conversion"]`,
        ),
      ).toContainText(pct(expectedShownToCheckout));
    }
  });

  test("events from another org do NOT count toward this org's funnel", async ({
    request,
  }) => {
    // Snapshot QA org first.
    const qa1 = await loginViaApi(request, QA_ADMIN_EMAIL, QA_ADMIN_PASS);
    const qaBefore = await getSummary(request);
    await logout(request, qa1.csrf);

    // Switch to PSO-only dev org and post a bunch of events.
    const pso = await loginViaApi(request, PSO_ADMIN_EMAIL, PSO_ADMIN_PASS);
    const FOREIGN_SHOWN = 4;
    const FOREIGN_MODAL = 2;
    const FOREIGN_CHECKOUT = 1;
    for (let i = 0; i < FOREIGN_SHOWN; i++) {
      await postEvent(request, pso.csrf, "marketing_os.discovery.section_shown");
    }
    for (let i = 0; i < FOREIGN_MODAL; i++) {
      await postEvent(request, pso.csrf, "marketing_os.discovery.modal_opened", {
        source: "card",
      });
    }
    for (let i = 0; i < FOREIGN_CHECKOUT; i++) {
      await postEvent(
        request,
        pso.csrf,
        "marketing_os.discovery.checkout_clicked",
      );
    }
    await logout(request, pso.csrf);

    // Back to QA admin — its funnel must be unchanged.
    await loginViaApi(request, QA_ADMIN_EMAIL, QA_ADMIN_PASS);
    const qaAfter = await getSummary(request);

    expect(qaAfter.last7Days.sectionShown).toBe(qaBefore.last7Days.sectionShown);
    expect(qaAfter.last7Days.modalOpened).toBe(qaBefore.last7Days.modalOpened);
    expect(qaAfter.last7Days.checkoutClicked).toBe(
      qaBefore.last7Days.checkoutClicked,
    );
    expect(qaAfter.last30Days.sectionShown).toBe(qaBefore.last30Days.sectionShown);
    expect(qaAfter.last30Days.modalOpened).toBe(qaBefore.last30Days.modalOpened);
    expect(qaAfter.last30Days.checkoutClicked).toBe(
      qaBefore.last30Days.checkoutClicked,
    );
  });
});

test.describe("Marketing OS upgrade interest widget — cache isolation", () => {
  /**
   * Task #219 — Same browser session, two orgs.
   *
   * The React Query cache key for the widget is shared across orgs
   * (`/api/telemetry/marketing-os/summary`). If the cache is not cleared on
   * login/logout, switching accounts in the same tab could render the
   * previous org's counts before the refetch lands. This test guarantees the
   * widget always reflects the *currently logged in* org.
   */
  test("widget never shows the previous org's counts after re-login", async ({
    page,
    request,
  }) => {
    // 1. Seed differential telemetry into both orgs so their summaries cannot
    //    coincidentally match.
    const qaApi = await loginViaApi(request, QA_ADMIN_EMAIL, QA_ADMIN_PASS);
    for (let i = 0; i < 2; i++) {
      await postEvent(request, qaApi.csrf, "marketing_os.discovery.section_shown");
    }
    await logout(request, qaApi.csrf);

    const psoApi = await loginViaApi(request, PSO_ADMIN_EMAIL, PSO_ADMIN_PASS);
    for (let i = 0; i < 5; i++) {
      await postEvent(
        request,
        psoApi.csrf,
        "marketing_os.discovery.section_shown",
      );
    }
    await logout(request, psoApi.csrf);

    // Capture the per-org ground truth via fresh API calls (used to assert
    // the widget renders the right values after each login).
    await loginViaApi(request, QA_ADMIN_EMAIL, QA_ADMIN_PASS);
    const qaSummary = await getSummary(request);
    await logout(request, (await request.get("/api/csrf-token").then(r => r.json())).token);

    await loginViaApi(request, PSO_ADMIN_EMAIL, PSO_ADMIN_PASS);
    const psoSummary = await getSummary(request);
    await logout(request, (await request.get("/api/csrf-token").then(r => r.json())).token);

    // Sanity: the two orgs *must* have different totals or the test cannot
    // distinguish a stale-cache bleed from a correct render.
    expect(qaSummary.last7Days.sectionShown).not.toBe(
      psoSummary.last7Days.sectionShown,
    );

    const shown7d = () =>
      page.locator(
        `[data-testid="text-marketing-os-telemetry-7d-section-shown"]`,
      );

    // The seeded counts are the lower bound for what each org should show in
    // the dashboard. Visiting the dashboard itself can emit one additional
    // section_shown event, so allow a small +N drift over the snapshot but
    // require the rendered count to fall in a band that cannot overlap with
    // the *other* org's seeded total.
    const qaSeeded = qaSummary.last7Days.sectionShown;
    const psoSeeded = psoSummary.last7Days.sectionShown;
    expect(psoSeeded - qaSeeded).toBeGreaterThanOrEqual(2);

    async function logoutViaPage() {
      const tokRes = await page.request.get("/api/csrf-token");
      const csrf = (await tokRes.json()).token as string;
      const r = await page.request.post("/api/auth/logout", {
        headers: { "x-csrf-token": csrf },
      });
      expect(r.ok()).toBeTruthy();
    }

    async function liveSummaryFromPage(): Promise<Summary> {
      const r = await page.request.get("/api/telemetry/marketing-os/summary");
      expect(r.status()).toBe(200);
      return (await r.json()) as Summary;
    }

    const card = page.locator('[data-testid="card-marketing-os-telemetry"]');

    // 2. Login as QA admin in the browser, render dashboard, capture rendered
    //    count, and confirm it matches a live API call from the same session.
    await loginViaUi(page, QA_ADMIN_EMAIL, QA_ADMIN_PASS);
    await page.goto("/dashboard");
    await expect(card).toBeVisible({ timeout: 15_000 });
    const liveQa = await liveSummaryFromPage();
    await expect(shown7d()).toHaveText(String(liveQa.last7Days.sectionShown));
    const qaRendered = Number(await shown7d().textContent());
    expect(qaRendered).toBeGreaterThanOrEqual(qaSeeded);
    expect(qaRendered).toBeLessThan(psoSeeded);

    // 3. Logout in the same browser session, then login as the *other* org's
    //    admin in the same tab.
    await logoutViaPage();
    await loginViaUi(page, PSO_ADMIN_EMAIL, PSO_ADMIN_PASS);
    await page.goto("/dashboard");
    await expect(card).toBeVisible({ timeout: 15_000 });

    // 4. The rendered count must move into the PSO org's band. If the React
    //    Query cache leaked the prior org's payload, the widget would briefly
    //    show the QA value (qaRendered) — toHaveText auto-retries, so we add
    //    an explicit not-equal guard against the previous org's value.
    await expect
      .poll(async () => Number(await shown7d().textContent()), {
        timeout: 15_000,
      })
      .toBeGreaterThanOrEqual(psoSeeded);
    await expect(shown7d()).not.toHaveText(String(qaRendered));

    // 5. And the rendered value must agree with a fresh API call made from
    //    the same browser cookies — i.e. it is genuinely the PSO org's data,
    //    not a coincidence.
    const livePso = await liveSummaryFromPage();
    expect(livePso.last7Days.sectionShown).toBeGreaterThanOrEqual(psoSeeded);
    await expect(shown7d()).toHaveText(
      String(livePso.last7Days.sectionShown),
    );
  });
});

test.describe("Marketing OS upgrade interest widget — non-admin", () => {
  test("team member does not see the widget and API rejects them", async ({
    page,
    request,
  }) => {
    await loginViaUi(page, QA_TEAM_EMAIL, QA_TEAM_PASS);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(
      page.locator('[data-testid="card-marketing-os-telemetry"]'),
    ).toHaveCount(0);

    // Underlying endpoints must refuse a non-admin session.
    const apiLogin = await request.post("/api/auth/login", {
      data: { email: QA_TEAM_EMAIL, password: QA_TEAM_PASS },
    });
    expect(apiLogin.status()).toBe(200);

    const summary = await request.get("/api/telemetry/marketing-os/summary");
    expect(summary.status()).toBe(403);

    const tok = await request.get("/api/csrf-token");
    expect(tok.status(), "csrf token fetch should succeed for non-admin").toBe(
      200,
    );
    const csrf = (await tok.json()).token as string;
    expect(csrf, "csrf token should be returned").toBeTruthy();
    const post = await request.post("/api/telemetry/marketing-os", {
      data: { event: "marketing_os.discovery.section_shown" },
      headers: { "x-csrf-token": csrf },
    });
    expect(post.status()).toBe(403);
  });
});

/**
 * Task #292 — End-to-end coverage for the "Run cleanup now" button on the
 * Marketing OS telemetry admin card.
 *
 * The button POSTs to /api/telemetry/marketing-os/cleanup/run, refreshes the
 * "Last cleanup" line via React Query cache invalidation, and surfaces a
 * skipped/error message inline. This describe block exercises both the
 * success path (a real run lands and the row count refreshes) and the
 * "another run in progress" path (the route observes the advisory lock as
 * held and returns { ran: false, skipped: true }).
 *
 * The advisory lock key (220_001) mirrors what the route uses internally
 * — see MARKETING_OS_TELEMETRY_CLEANUP_LOCK_KEY in
 * server/routes/marketing-os-telemetry-routes.ts. The integration test
 * `tests/integration/marketing-os-telemetry-cleanup-run-route.test.ts`
 * uses the same key for the same reason.
 */
test.describe("Marketing OS telemetry — Run cleanup now button (#292)", () => {
  const PROD_LOCK_KEY = 220_001;

  test("clicking the button records a fresh run and refreshes the Last cleanup line", async ({
    page,
  }) => {
    await loginViaUi(page, QA_ADMIN_EMAIL, QA_ADMIN_PASS);
    await page.goto("/dashboard");

    const card = page.locator('[data-testid="card-marketing-os-telemetry"]');
    await expect(card).toBeVisible({ timeout: 15_000 });

    const runButton = page.locator(
      '[data-testid="button-marketing-os-telemetry-run-cleanup"]',
    );
    await expect(runButton).toBeVisible();
    await expect(runButton).toBeEnabled();

    // Capture whatever the "Last cleanup" line shows right now (could be
    // "never", or some prior run with a relative time like "5m ago"). After
    // clicking the button it must change — either from empty to populated,
    // or to "just now" / "0 rows removed" — proving the cache was actually
    // invalidated and the line re-rendered with the freshly recorded run.
    const lastCleanupSection = page.locator(
      '[data-testid="section-marketing-os-telemetry-last-cleanup"]',
    );
    const beforeText = (await lastCleanupSection.innerText()).trim();

    // Issue the request and wait for the POST to land so we can assert
    // both the disabled-while-in-flight state and the eventual success.
    const responsePromise = page.waitForResponse(
      (resp) =>
        resp.url().endsWith("/api/telemetry/marketing-os/cleanup/run") &&
        resp.request().method() === "POST",
    );
    await runButton.click();
    const resp = await responsePromise;
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.ran).toBe(true);
    expect(body.lastRun).toBeTruthy();
    expect(typeof body.lastRun.deletedCount).toBe("number");
    expect(body.lastRun.retentionDays).toBeGreaterThanOrEqual(1);

    // Success message renders, and the skipped/error variants do not.
    const successMsg = page.locator(
      '[data-testid="text-marketing-os-telemetry-run-cleanup-success"]',
    );
    await expect(successMsg).toBeVisible({ timeout: 8_000 });
    await expect(successMsg).toHaveText(
      `Cleanup ran — ${body.lastRun.deletedCount} rows removed.`,
    );
    await expect(
      page.locator(
        '[data-testid="text-marketing-os-telemetry-run-cleanup-skipped"]',
      ),
    ).toHaveCount(0);
    await expect(
      page.locator(
        '[data-testid="text-marketing-os-telemetry-run-cleanup-error"]',
      ),
    ).toHaveCount(0);

    // Button returns to its idle "Run cleanup now" label and is enabled
    // again (not stuck in the "Running…" state).
    await expect(runButton).toBeEnabled();
    await expect(runButton).toHaveText("Run cleanup now");

    // The "Last cleanup" line was driven by /api/telemetry/marketing-os/
    // cleanup/last; the mutation seeds + invalidates that cache so the
    // populated row + relative time + retention must all be present and
    // the rendered text must differ from the pre-click snapshot.
    const populated = page.locator(
      '[data-testid="text-marketing-os-telemetry-last-cleanup"]',
    );
    await expect(populated).toBeVisible();
    const deletedText = await page
      .locator('[data-testid="text-marketing-os-telemetry-last-cleanup-deleted"]')
      .innerText();
    expect(deletedText).toBe(`${body.lastRun.deletedCount} rows removed`);
    await expect(
      page.locator(
        '[data-testid="text-marketing-os-telemetry-last-cleanup-relative"]',
      ),
    ).toHaveText("just now");
    await expect(
      page.locator(
        '[data-testid="text-marketing-os-telemetry-last-cleanup-retention"]',
      ),
    ).toHaveText(`(retention ${body.lastRun.retentionDays} days)`);
    const afterText = (await lastCleanupSection.innerText()).trim();
    expect(afterText).not.toBe(beforeText);
  });

  test("disables the button and swaps the label to 'Running…' while the request is in flight", async ({
    page,
  }) => {
    await loginViaUi(page, QA_ADMIN_EMAIL, QA_ADMIN_PASS);
    await page.goto("/dashboard");

    const card = page.locator('[data-testid="card-marketing-os-telemetry"]');
    await expect(card).toBeVisible({ timeout: 15_000 });

    const runButton = page.locator(
      '[data-testid="button-marketing-os-telemetry-run-cleanup"]',
    );
    await expect(runButton).toBeEnabled();
    await expect(runButton).toHaveText("Run cleanup now");

    // Intercept the cleanup POST and stall it long enough that we can
    // observe the in-flight UI state deterministically (button disabled
    // + spinner label "Running…"). We hand-craft a "ran:true" envelope so
    // the success branch is what the card eventually renders.
    let releaseHold: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    await page.route(
      "**/api/telemetry/marketing-os/cleanup/run",
      async (route) => {
        await held;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ran: true,
            lastRun: {
              ranAt: new Date().toISOString(),
              cutoff: new Date().toISOString(),
              deletedCount: 0,
              retentionDays: 30,
            },
          }),
        });
      },
    );

    const responsePromise = page.waitForResponse((resp) =>
      resp.url().endsWith("/api/telemetry/marketing-os/cleanup/run"),
    );

    try {
      await runButton.click();

      // While the route is held, the button must be disabled and the
      // spinner label "Running…" must be showing — proving the mutation's
      // isPending state is wired into the button.
      await expect(runButton).toBeDisabled();
      await expect(runButton).toContainText("Running…");
    } finally {
      releaseHold();
    }

    // Drain the stalled response, then drop the route handler.
    await responsePromise;
    await page.unroute("**/api/telemetry/marketing-os/cleanup/run");

    // After the response resolves the button comes back to its idle
    // state and the success message renders.
    await expect(runButton).toBeEnabled();
    await expect(runButton).toHaveText("Run cleanup now");
    await expect(
      page.locator(
        '[data-testid="text-marketing-os-telemetry-run-cleanup-success"]',
      ),
    ).toBeVisible({ timeout: 8_000 });
  });

  test("renders the 'Another run in progress' message when the advisory lock is held", async ({
    page,
  }) => {
    await loginViaUi(page, QA_ADMIN_EMAIL, QA_ADMIN_PASS);
    await page.goto("/dashboard");

    const card = page.locator('[data-testid="card-marketing-os-telemetry"]');
    await expect(card).toBeVisible({ timeout: 15_000 });

    const runButton = page.locator(
      '[data-testid="button-marketing-os-telemetry-run-cleanup"]',
    );
    await expect(runButton).toBeEnabled();

    // Hold the same advisory lock the route tries to grab so
    // pg_try_advisory_lock returns false and the handler responds with
    // { ran: false, skipped: true, reason: "lock-held" }.
    const client = await pool.connect();
    try {
      const lockRes = await client.query(
        "SELECT pg_try_advisory_lock($1) AS acquired",
        [PROD_LOCK_KEY],
      );
      expect(Boolean(lockRes.rows[0]?.acquired)).toBe(true);

      const responsePromise = page.waitForResponse(
        (resp) =>
          resp.url().endsWith("/api/telemetry/marketing-os/cleanup/run") &&
          resp.request().method() === "POST",
      );
      await runButton.click();
      const resp = await responsePromise;
      expect(resp.status()).toBe(200);
      const body = await resp.json();
      expect(body.ran).toBe(false);
      expect(body.skipped).toBe(true);
      expect(body.reason).toBe("lock-held");

      const skippedMsg = page.locator(
        '[data-testid="text-marketing-os-telemetry-run-cleanup-skipped"]',
      );
      await expect(skippedMsg).toBeVisible({ timeout: 8_000 });
      await expect(skippedMsg).toHaveText(
        "Another run in progress — try again in a moment.",
      );
      await expect(
        page.locator(
          '[data-testid="text-marketing-os-telemetry-run-cleanup-success"]',
        ),
      ).toHaveCount(0);
      await expect(
        page.locator(
          '[data-testid="text-marketing-os-telemetry-run-cleanup-error"]',
        ),
      ).toHaveCount(0);

      // Button is restored to its idle state — not stuck on "Running…".
      await expect(runButton).toBeEnabled();
      await expect(runButton).toHaveText("Run cleanup now");
    } finally {
      await client
        .query("SELECT pg_advisory_unlock($1)", [PROD_LOCK_KEY])
        .catch(() => {});
      client.release();
    }
  });

  /**
   * Task #320 — Coverage for the cleanup error path.
   *
   * The card has three message variants (success, skipped, error). The
   * success and skipped paths are covered above; this test forces the POST
   * /api/telemetry/marketing-os/cleanup/run endpoint to fail in two distinct
   * ways and asserts the inline error copy + the button's recovery to its
   * idle state in each case so admins can retry.
   */
  test("renders the cleanup-failed error message when the server returns 500", async ({
    page,
  }) => {
    await loginViaUi(page, QA_ADMIN_EMAIL, QA_ADMIN_PASS);
    await page.goto("/dashboard");

    const card = page.locator('[data-testid="card-marketing-os-telemetry"]');
    await expect(card).toBeVisible({ timeout: 15_000 });

    const runButton = page.locator(
      '[data-testid="button-marketing-os-telemetry-run-cleanup"]',
    );
    await expect(runButton).toBeEnabled();
    await expect(runButton).toHaveText("Run cleanup now");

    // Force the cleanup endpoint to return a non-2xx response so the
    // mutation's onError branch fires and the card renders the
    // "Cleanup failed. Try again in a moment." inline message.
    await page.route(
      "**/api/telemetry/marketing-os/cleanup/run",
      async (route) => {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "internal" }),
        });
      },
    );

    try {
      const responsePromise = page.waitForResponse(
        (resp) =>
          resp.url().endsWith("/api/telemetry/marketing-os/cleanup/run") &&
          resp.request().method() === "POST",
      );
      await runButton.click();
      const resp = await responsePromise;
      expect(resp.status()).toBe(500);

      const errorMsg = page.locator(
        '[data-testid="text-marketing-os-telemetry-run-cleanup-error"]',
      );
      await expect(errorMsg).toBeVisible({ timeout: 8_000 });
      await expect(errorMsg).toHaveText(
        "Cleanup failed. Try again in a moment.",
      );

      // The other two message variants must NOT render alongside the error.
      await expect(
        page.locator(
          '[data-testid="text-marketing-os-telemetry-run-cleanup-success"]',
        ),
      ).toHaveCount(0);
      await expect(
        page.locator(
          '[data-testid="text-marketing-os-telemetry-run-cleanup-skipped"]',
        ),
      ).toHaveCount(0);

      // Button is restored to its idle, enabled state — admins must be
      // able to click "Run cleanup now" again to retry.
      await expect(runButton).toBeEnabled();
      await expect(runButton).toHaveText("Run cleanup now");
    } finally {
      await page.unroute("**/api/telemetry/marketing-os/cleanup/run");
    }
  });

  test("renders the cleanup-didn't-run error message when the server reports ran:false without skipped", async ({
    page,
  }) => {
    await loginViaUi(page, QA_ADMIN_EMAIL, QA_ADMIN_PASS);
    await page.goto("/dashboard");

    const card = page.locator('[data-testid="card-marketing-os-telemetry"]');
    await expect(card).toBeVisible({ timeout: 15_000 });

    const runButton = page.locator(
      '[data-testid="button-marketing-os-telemetry-run-cleanup"]',
    );
    await expect(runButton).toBeEnabled();

    // Simulate a 200-OK envelope where the run did not happen but the
    // route did not flag it as a lock-held skip either (e.g. an unforeseen
    // future branch). The card's "else" arm must surface the
    // "Cleanup didn't run. Try again in a moment." copy.
    await page.route(
      "**/api/telemetry/marketing-os/cleanup/run",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ran: false }),
        });
      },
    );

    try {
      const responsePromise = page.waitForResponse(
        (resp) =>
          resp.url().endsWith("/api/telemetry/marketing-os/cleanup/run") &&
          resp.request().method() === "POST",
      );
      await runButton.click();
      const resp = await responsePromise;
      expect(resp.status()).toBe(200);

      const errorMsg = page.locator(
        '[data-testid="text-marketing-os-telemetry-run-cleanup-error"]',
      );
      await expect(errorMsg).toBeVisible({ timeout: 8_000 });
      await expect(errorMsg).toHaveText(
        "Cleanup didn't run. Try again in a moment.",
      );

      await expect(
        page.locator(
          '[data-testid="text-marketing-os-telemetry-run-cleanup-success"]',
        ),
      ).toHaveCount(0);
      await expect(
        page.locator(
          '[data-testid="text-marketing-os-telemetry-run-cleanup-skipped"]',
        ),
      ).toHaveCount(0);

      await expect(runButton).toBeEnabled();
      await expect(runButton).toHaveText("Run cleanup now");
    } finally {
      await page.unroute("**/api/telemetry/marketing-os/cleanup/run");
    }
  });
});
