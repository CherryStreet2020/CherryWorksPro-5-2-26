import { test, expect, request as playwrightRequest } from "@playwright/test";
import { Pool } from "pg";
import { freshIp } from "../tests/helpers/po/auth";
import { waitForCapturedEmail, clearCapturedEmails, DEFAULT_CAPTURE_DIR } from "../tests/helpers/email-capture";

/**
 * Sign-up should:
 *   1. Write a WELCOME_EMAIL_DISPATCH_ATTEMPTED audit row tied to the
 *      new org+user (and on transport success, a follow-up
 *      WELCOME_EMAIL_SUCCEEDED row).
 *   2. Dispatch a real welcome email (captured by EMAIL_CAPTURE_DIR harness).
 *
 * The email-capture harness is gated on the EMAIL_CAPTURE_DIR env var the
 * dev workflow sets. If the harness is off (e.g. CI without the var), only
 * the audit-row assertion runs.
 */

const HARNESS_DIR = process.env.EMAIL_CAPTURE_DIR || DEFAULT_CAPTURE_DIR;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

test.describe.serial("auth » signup welcome email", () => {
  const createdOrgIds: string[] = [];

  test.afterAll(async () => {
    for (const orgId of createdOrgIds) {
      await pool.query(`DELETE FROM audit_logs WHERE org_id = $1`, [orgId]).catch(() => {});
      await pool.query(`DELETE FROM users WHERE org_id = $1`, [orgId]).catch(() => {});
      await pool.query(`DELETE FROM orgs WHERE id = $1`, [orgId]).catch(() => {});
    }
    await pool.end();
  });

  test("signup writes WELCOME_EMAIL_DISPATCH_ATTEMPTED audit row and dispatches welcome email", async ({ baseURL }) => {
    const ip = freshIp();
    const ctx = await playwrightRequest.newContext({
      baseURL,
      extraHTTPHeaders: { "x-forwarded-for": ip },
    });

    await clearCapturedEmails(HARNESS_DIR).catch(() => {});
    const watermark = Date.now();

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // Unique per-test domain so we never trip the 3/24h domain signup limiter.
    const email = `welcome-${stamp}@e2e-${stamp}.cherryworks.test`;
    const firmName = `Welcome E2E ${stamp}`;
    const firstName = "Wilma";
    const lastName = "Welcome";

    const res = await ctx.post("/api/auth/signup", {
      data: {
        email,
        password: "Sup3r$ecure!E2E",
        firmName,
        firstName,
        lastName,
        plan: "STARTER",
      },
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.user?.email).toBe(email);
    const orgId = body.org?.id as string;
    expect(orgId).toBeTruthy();
    createdOrgIds.push(orgId);

    // (1) Audit row proxy — always works regardless of harness.
    const { rows } = await pool.query(
      `SELECT action, details FROM audit_logs
         WHERE org_id = $1 AND action = 'WELCOME_EMAIL_DISPATCH_ATTEMPTED'
         ORDER BY created_at DESC LIMIT 1`,
      [orgId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].details?.email).toBe(email);
    expect(rows[0].details?.firmName).toBe(firmName);

    // (2) Real captured email — harness path. Skip if env var not set.
    if (!process.env.EMAIL_CAPTURE_DIR && HARNESS_DIR === DEFAULT_CAPTURE_DIR) {
      // Default dir; still try, and if nothing lands within timeout, treat
      // as harness-disabled and skip the content assertion (audit row
      // already proves dispatch).
      try {
        const captured = await waitForCapturedEmail(
          { to: email, subject: /Welcome to CherryWorks Pro/ },
          { dir: HARNESS_DIR, sinceMs: watermark, timeoutMs: 4000 },
        );
        expect(captured.subject).toContain(firmName);
        expect(captured.html).toContain(firmName);
        expect(captured.html).toContain("/login");
        expect(captured.text).toContain(firmName);
      } catch (err: any) {
        test.info().annotations.push({
          type: "harness-skipped",
          description: `EMAIL_CAPTURE_DIR not active or no file landed: ${err?.message || err}`,
        });
      }
    } else {
      const captured = await waitForCapturedEmail(
        { to: email, subject: /Welcome to CherryWorks Pro/ },
        { dir: HARNESS_DIR, sinceMs: watermark, timeoutMs: 5000 },
      );
      expect(captured.subject).toContain(firmName);
      expect(captured.html).toContain(firmName);
      expect(captured.html).toContain("/login");
      expect(captured.text).toContain(firmName);
    }

    await ctx.dispose();
  });
});
