/**
 * Help Center / Customer Portal — browser proofs the API tests cannot give:
 *   1. cache isolation: a Customer Admin and a member sign in one after another in
 *      the SAME browser; the member never sees the admin's cached company-wide list;
 *   2. an old `/portal/<slug>/cases/<id>` link (from already-sent emails) lands on the
 *      Help Center login when signed out, and on the case once signed in;
 *   3. the billing wall: a member who opens the Customer Portal is told billing isn't
 *      enabled and sent to the Help Center.
 * Sign-in links are read from the e2e email capture directory (NODE_ENV=test).
 */
import { test, expect, request as pwRequest, type APIRequestContext, type Page } from "@playwright/test";
import { waitForCapturedEmail, clearCapturedEmails, DEFAULT_CAPTURE_DIR } from "../tests/helpers/email-capture";

const BASE = `http://localhost:${process.env.PORT || 5000}`;
const dir = process.env.EMAIL_CAPTURE_DIR || DEFAULT_CAPTURE_DIR;
const stamp = Date.now();
const domain = `hc-${stamp}.example`;
const adminEmail = `dana.${stamp}@${domain}`;
const memberEmail = `mike.${stamp}@${domain}`;

let api: APIRequestContext;
let slug = "";
let clientId = "";
let memberCaseId = "";
let adminCaseId = "";

async function linkFor(email: string, surface: "help" | "portal" = "help"): Promise<string> {
  const watermark = Date.now();
  const r = await api.post(`${BASE}/api/portal/${slug}/auth/request-link`, { headers: { "X-Requested-With": "cwp-portal" }, data: { email, surface } });
  expect(r.status()).toBe(200);
  const mail = await waitForCapturedEmail({ to: email, subject: /sign-in link|invited you/i }, { dir, sinceMs: watermark - 5, timeoutMs: 8000 });
  const m = (mail.text || mail.html || "").match(/https?:\/\/[^\s"'<]+\/(help|portal)\/[^\s"'<]+verify\?token=[A-Za-z0-9_-]+/);
  expect(m, `sign-in link in mail to ${email}`).toBeTruthy();
  return m![0].replace(/^https?:\/\/[^/]+/, BASE);
}

async function signInInBrowser(page: Page, email: string, surface: "help" | "portal" = "help") {
  const link = await linkFor(email, surface);
  await page.goto(link);
  // The link is exchanged only on the click (mail scanners must not spend it).
  await page.getByTestId("portal-verify-continue").click();
  await page.waitForURL(url => !url.pathname.endsWith("/verify"), { timeout: 15000 });
}

test.describe("Help Center in the browser", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    api = await pwRequest.newContext();
    const login = await api.post(`${BASE}/api/auth/login`, { data: { email: "admin.test@cwpro.dev", password: "admin123" } });
    expect(login.ok()).toBeTruthy();
    const csrf = login.headers()["x-csrf-token"] || "";
    api = await pwRequest.newContext({ storageState: await api.storageState(), extraHTTPHeaders: { "X-CSRF-Token": csrf } });
    slug = (await (await api.get(`${BASE}/api/support/portal-info`)).json()).orgSlug;
    const c = await api.post(`${BASE}/api/clients`, { data: { name: `HC Browser Co ${stamp}` } });
    clientId = (await c.json()).id;
    await api.patch(`${BASE}/api/clients/${clientId}`, { data: { portalEmailDomains: [domain] } });
    const a = await api.post(`${BASE}/api/clients/${clientId}/contacts`, { data: { firstName: "Dana", lastName: "Admin", email: adminEmail, portalRole: "admin" } });
    const adminContactId = (await a.json()).id;
    const m = await api.post(`${BASE}/api/clients/${clientId}/contacts`, { data: { firstName: "Mike", lastName: "Member", email: memberEmail } });
    const memberContactId = (await m.json()).id;
    memberCaseId = (await (await api.post(`${BASE}/api/support/cases`, { data: { clientId, subject: `Mike's printer ${stamp}`, requesterContactId: memberContactId } })).json()).id;
    adminCaseId = (await (await api.post(`${BASE}/api/support/cases`, { data: { clientId, subject: `Dana's report ${stamp}`, requesterContactId: adminContactId } })).json()).id;
    await clearCapturedEmails(dir).catch(() => {});
  });

  test.afterAll(async () => { await api?.dispose(); });

  /** Exchange a link for a session WITHOUT leaving the mounted app (same document, same QueryClient). */
  async function verifyInPlace(page: Page, email: string) {
    const link = await linkFor(email);
    const token = new URL(link).searchParams.get("token");
    const status = await page.evaluate(async ({ slug, token }) => {
      const r = await fetch(`/api/portal/${slug}/auth/verify`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", "X-Requested-With": "cwp-portal" }, body: JSON.stringify({ token }) });
      // What the app's verify page does after a successful exchange: tell the other tabs.
      if (r.ok) localStorage.setItem("cwp-portal-auth-epoch", `${slug}:${Date.now()}`);
      return r.status;
    }, { slug, token });
    expect(status).toBe(200);
  }
  /** Client-side navigation (wouter listens to popstate) — no new document. */
  async function navigateInPlace(page: Page, path: string) {
    await page.evaluate((p) => { history.pushState({}, "", p); window.dispatchEvent(new PopStateEvent("popstate")); }, path);
  }

  test("admin then member in one browser: the member never sees the admin's cached list", async ({ page }) => {
    await signInInBrowser(page, adminEmail);
    await expect(page.getByTestId("portal-title")).toContainText("Support cases at");
    await expect(page.getByTestId("portal-case-list")).toContainText(`Mike's printer ${stamp}`);
    await expect(page.getByTestId("portal-case-list")).toContainText(`Dana's report ${stamp}`);
    await expect(page.getByTestId("portal-nav-team")).toBeVisible();

    // Sign out in the mounted app (SPA navigation to /login, same document).
    await page.getByTestId("portal-signout").click();
    await page.waitForURL(/\/help\/[^/]+\/login$/);
    // Become the member WITHOUT a reload: the QueryClient that held the admin's list is
    // still alive; it must not show that list to the member.
    await verifyInPlace(page, memberEmail);
    await navigateInPlace(page, `/help/${slug}`);
    await expect(page.getByTestId("portal-title")).toHaveText("Your support cases");
    await expect(page.getByTestId("portal-case-list")).toContainText(`Mike's printer ${stamp}`);
    await expect(page.getByTestId("portal-case-list")).not.toContainText(`Dana's report ${stamp}`);
    await expect(page.getByTestId("portal-nav-team")).toHaveCount(0);
    await expect(page.getByTestId("portal-nav-billing")).toHaveCount(0);
  });

  test("a second tab in the same browser follows a sign-out and a switch of person", async ({ page, context }) => {
    await signInInBrowser(page, adminEmail);
    const other = await context.newPage();
    await other.goto(`${BASE}/help/${slug}`);
    await expect(other.getByTestId("portal-title")).toContainText("Support cases at");
    // Tab 1 signs out → tab 2 must drop the admin's list and land on login.
    await page.getByTestId("portal-signout").click();
    await page.waitForURL(/\/help\/[^/]+\/login$/);
    await other.waitForURL(/\/help\/[^/]+\/login(\?.*)?$/, { timeout: 15000 });
    // Tab 1 becomes the member → tab 2 (still the same document, sitting on /login) is
    // navigated client-side back to the list and must show the member's view.
    await verifyInPlace(page, memberEmail);
    await navigateInPlace(other, `/help/${slug}`);
    await expect(other.getByTestId("portal-title")).toHaveText("Your support cases");
    await expect(other.getByTestId("portal-case-list")).not.toContainText(`Dana's report ${stamp}`);
    await other.close();
  });

  test("an old portal case link redirects into the Help Center: login when signed out, the case once signed in", async ({ page }) => {
    await page.goto(`${BASE}/portal/${slug}/cases/${memberCaseId}`);
    await page.waitForURL(/\/help\/[^/]+\/login\?next=/, { timeout: 15000 });
    // Sign in FROM that login page: the emailed link carries the destination.
    const watermark = Date.now();
    await page.getByTestId("portal-email").fill(memberEmail);
    await page.getByTestId("portal-request-link").click();
    await expect(page.getByTestId("portal-link-sent")).toBeVisible();
    const mail = await waitForCapturedEmail({ to: memberEmail, subject: /sign-in link/i }, { dir, sinceMs: watermark - 5, timeoutMs: 8000 });
    const link = (mail.text || mail.html || "").match(/https?:\/\/[^\s"'<]+\/help\/[^\s"'<]+verify\?token=[^\s"'<]+/)![0].replace(/^https?:\/\/[^/]+/, BASE).replace(/&amp;/g, "&");
    expect(link).toContain("next=");
    await page.goto(link);
    await page.getByTestId("portal-verify-continue").click();
    await page.waitForURL(new RegExp(`/help/[^/]+/cases/${memberCaseId}$`), { timeout: 15000 });
    await expect(page.getByTestId("portal-case-subject")).toHaveText(`Mike's printer ${stamp}`);
    // A member cannot reach a colleague's case by URL either.
    await page.goto(`${BASE}/help/${slug}/cases/${adminCaseId}`);
    await expect(page.getByText("That case isn't available.")).toBeVisible();
  });

  test("the billing wall: a member on the Customer Portal is sent to the Help Center", async ({ page }) => {
    await signInInBrowser(page, memberEmail);
    await page.goto(`${BASE}/portal/${slug}`);
    await expect(page.getByTestId("portal-billing-denied")).toBeVisible();
    await page.getByTestId("portal-go-help").click();
    await page.waitForURL(new RegExp(`/help/${slug}$`));
    await expect(page.getByTestId("portal-title")).toHaveText("Your support cases");
  });

  test("request form v2: intake, a file, a colleague and on-behalf-of, then the case page shows all of it", async ({ page }) => {
    await signInInBrowser(page, adminEmail);
    await page.goto(`${BASE}/help/${slug}/cases/new`);
    await page.getByTestId("portal-subject").fill(`PO column missing ${stamp}`);
    await page.getByTestId("portal-description").fill("The PO number no longer shows in Purchase Activity.");
    await page.getByTestId("portal-intake-affectedArea").fill("Purchase Activity");
    await page.getByTestId("portal-intake-references").fill("PO 44817");
    await page.getByTestId("portal-impact-TEAM").click();
    await page.getByTestId("portal-priority-HIGH").click();
    await page.getByTestId("portal-intake-more").click();
    await page.getByTestId("portal-intake-stepsToReproduce").fill("1. Open Purchase Activity\n2. Filter by vendor\n3. PO column is blank");
    await page.getByTestId("portal-intake-neededBy").fill("2026-09-30");
    await page.getByTestId("portal-new-file-input").setInputFiles({ name: "po-screen.png", mimeType: "image/png", buffer: Buffer.from("PNG!") });
    await expect(page.getByTestId("portal-new-file-row")).toHaveCount(1);
    // Open it for Mike, and add a colleague by email on the approved domain.
    await page.getByTestId("portal-on-behalf").selectOption({ label: `Mike Member · ${memberEmail}` });
    await page.getByTestId("portal-watcher-email").fill(`nia.${stamp}@${domain}`);
    await page.getByTestId("portal-watcher-add").click();
    await expect(page.getByTestId("portal-watcher-chips")).toContainText(`nia.${stamp}@${domain}`);
    await page.screenshot({ path: `${process.env.E2E_CAPTURE_DIR || "/tmp"}/help-center-form-v2.png`, fullPage: true });
    await page.getByTestId("portal-submit-case").click();
    await page.waitForURL(/\/help\/[^/]+\/cases\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("portal-case-subject")).toHaveText(`PO column missing ${stamp}`);
    await expect(page.getByTestId("portal-case-priority")).toHaveText("High");
    await expect(page.getByTestId("portal-intake")).toContainText("Purchase Activity");
    await expect(page.getByTestId("portal-intake-impact")).toHaveText("A team");
    await expect(page.getByTestId("portal-intake-neededBy")).toHaveText("2026-09-30");
    await expect(page.getByTestId("portal-attachments")).toContainText("po-screen.png");
    // Requester is Mike; Dana (the admin who opened it) and Nia follow it.
    await expect(page.locator("text=by Mike Member")).toBeVisible();
    await expect(page.getByTestId("portal-watchers")).toContainText("Dana Admin");
    await expect(page.getByTestId("portal-watchers")).toContainText(`nia.${stamp}@${domain}`);
    await expect(page.getByTestId("portal-thread")).toContainText("Added Dana Admin as a follower");
    await page.screenshot({ path: `${process.env.E2E_CAPTURE_DIR || "/tmp"}/help-center-case-v2.png`, fullPage: true });
  });

  test("a Customer Admin closes and reopens from the case page", async ({ page }) => {
    await signInInBrowser(page, adminEmail);
    await page.goto(`${BASE}/help/${slug}/cases/${memberCaseId}`);
    await expect(page.getByTestId("portal-admin-actions")).toBeVisible();
    page.once("dialog", d => d.accept());
    await page.getByTestId("portal-admin-close").click();
    await expect(page.getByTestId("portal-chip-CLOSED")).toBeVisible();
    await page.getByTestId("portal-admin-reopen").click();
    await expect(page.getByTestId("portal-chip-WAITING_ON_SUPPORT")).toBeVisible();
  });
});
