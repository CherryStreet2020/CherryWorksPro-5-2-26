/**
 * Task #273 — End-to-end coverage for sequence enrollment cadence when a
 * step *fails* to deliver.
 *
 * Sister spec to marketing-sequence-enrollment-cadence.spec.ts (which
 * walks the all-green happy path). This one proves that when delivery
 * for a step is rejected by the transport, the worker:
 *
 *   1. Records a permanent_failure attempt row in `email_send_attempts`
 *      so the failure is auditable.
 *   2. Does NOT emit an `email_sent` contact_activities row for the
 *      failed step (the firehose only records actual sends).
 *   3. Advances the enrollment past the failed step on the documented
 *      schedule (i.e. cadence still ticks correctly — failure does not
 *      stall the enrollment forever).
 *   4. Eventually marks the enrollment `completed` once every step has
 *      either sent or been classified as a permanent failure.
 *
 * How we force the failure deterministically:
 *   * `MARKETING_SEND_MAX_ATTEMPTS=1` — a single failed attempt is
 *     classified as `permanent_failure` (instead of being retried with
 *     exponential backoff), so the worker advances the step on the
 *     same tick we observe the failure. This keeps the assertions
 *     simple and avoids a synthetic-time loop through 5 retries.
 *   * Add the contact's email to the org's masked-recipient suppression
 *     list via the admin API. `sendViaConnectedMailbox` checks the
 *     suppression list before invoking the transport and throws
 *     `RecipientSuppressedError`, which propagates to the worker as a
 *     real send failure.
 *
 * The HTTP API is used (not a direct SQL insert) so the server's
 * in-process suppression cache stays consistent with the DB — otherwise
 * the server's background worker tick could race ahead of us with a
 * stale cache and dispatch the step "successfully" through the noop
 * transport before our test-process tick runs.
 */
process.env.MARKETING_OS_ENABLED = "true";
process.env.VITE_MARKETING_OS_ENABLED = "true";
process.env.EMAIL_OAUTH_ENABLED = "false";
// Set BEFORE importing scheduled-send so the module-level
// MAX_SEND_ATTEMPTS constant in this test process picks it up. Note:
// Task #271 made this configurable per-org via the
// `orgs.marketing_send_max_attempts` column; we ALSO override that
// column for the test org below so the per-org policy wins over the
// module default consistently.
process.env.MARKETING_SEND_MAX_ATTEMPTS = "1";
delete process.env.SMTP_HOST;
delete process.env.SMTP_PORT;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;

import { test, expect, type APIRequestContext } from "@playwright/test";
import { cleanupE2EBrandPollution } from "../scripts/cleanup-e2e-brand-pollution";
import { pool } from "../server/db";
import {
  MAX_SEND_ATTEMPTS,
  processScheduledSequenceEnrollments,
} from "../server/marketing/scheduled-send";
import { maskRecipient } from "../server/email/failure-tracker";

const BASE = `http://localhost:${process.env.PORT || 5000}`;
const ADMIN_EMAIL = "admin.test@cwpro.dev";
const ADMIN_PASS = "admin123";
const DAY_MS = 24 * 60 * 60 * 1000;

async function login(request: APIRequestContext) {
  const r = await request.post(`${BASE}/api/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASS },
  });
  expect(r.status()).toBe(200);
}

async function getCsrfToken(request: APIRequestContext): Promise<string> {
  const r = await request.get(`${BASE}/api/csrf-token`);
  expect(r.status()).toBe(200);
  return r.headers()["x-csrf-token"] || "";
}

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const BRAND_NAME = `Marketing Editors E2E ${RUN}`;
// Reuse the cleanup script's allow-listed slug prefix.
const BRAND_SLUG = `marketing-editors-e2e-${RUN}`;
const CONTACT_EMAIL = `cadence-fail-${RUN}@example.test`;
const SEQUENCE_NAME = `Cadence Failure ${RUN}`;
const STEP1_SUBJECT = `Failing day-zero ping ${RUN}`;
const STEP1_BODY = `This step is suppressed at send time (${RUN}).`;
const STEP2_SUBJECT = `Failing day-five follow-up ${RUN}`;
const STEP2_BODY = `Same recipient, still suppressed (${RUN}).`;
const STEP2_DELAY_DAYS = 5;

interface EnrollmentRow {
  id: string;
  current_step_index: number;
  next_send_at: Date | null;
  status: string;
}

async function loadEnrollment(id: string): Promise<EnrollmentRow> {
  const { rows } = await pool.query<EnrollmentRow>(
    `SELECT id, current_step_index, next_send_at, status
       FROM marketing_sequence_enrollments WHERE id = $1`,
    [id],
  );
  expect(rows.length).toBe(1);
  return rows[0];
}

interface AttemptRow {
  step_index: number | null;
  attempt_number: number;
  status: string;
  error_code: string | null;
}

async function loadSequenceAttempts(
  sequenceId: string,
  contactId: string,
): Promise<AttemptRow[]> {
  const { rows } = await pool.query<AttemptRow>(
    `SELECT step_index, attempt_number, status, error_code
       FROM email_send_attempts
       WHERE sequence_id = $1 AND contact_id = $2
       ORDER BY step_index ASC, attempt_number ASC`,
    [sequenceId, contactId],
  );
  return rows;
}

async function loadEmailSentActivityCount(
  contactId: string,
  sequenceId: string,
): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM contact_activities
       WHERE contact_id = $1
         AND type = 'email_sent'
         AND payload->>'sequence_id' = $2`,
    [contactId, sequenceId],
  );
  return Number(rows[0]?.n ?? 0);
}

test.describe("Marketing OS — sequence enrollment cadence on delivery failure", () => {
  const createdBrandIds: string[] = [];
  const cleanupHashes: Array<{ orgId: string; hash: string }> = [];
  const restoreOrgPolicy: Array<{
    orgId: string;
    maxAttempts: number;
    baseMs: number;
  }> = [];

  test.afterAll(async () => {
    // Drop the suppression we added so the org doesn't carry it
    // across test runs. Direct DELETE keeps cleanup independent of
    // having a fresh CSRF/login session this late in the lifecycle.
    for (const { orgId, hash } of cleanupHashes) {
      try {
        await pool.query(
          `DELETE FROM email_recipient_suppressions
             WHERE org_id = $1 AND hash = $2`,
          [orgId, hash],
        );
      } catch (err) {
        console.error(
          "[marketing-sequence-enrollment-failure-cadence afterAll] suppression cleanup failed:",
          err,
        );
      }
    }
    // Restore the per-org retry policy we lowered for the test so
    // unrelated specs that share this org observe their normal default.
    for (const { orgId, maxAttempts, baseMs } of restoreOrgPolicy) {
      try {
        await pool.query(
          `UPDATE orgs
              SET marketing_send_max_attempts = $2,
                  marketing_send_retry_base_ms = $3
            WHERE id = $1`,
          [orgId, maxAttempts, baseMs],
        );
      } catch (err) {
        console.error(
          "[marketing-sequence-enrollment-failure-cadence afterAll] org policy restore failed:",
          err,
        );
      }
    }
    try {
      await cleanupE2EBrandPollution(createdBrandIds);
    } catch (err) {
      console.error(
        "[marketing-sequence-enrollment-failure-cadence afterAll] cleanup failed:",
        err,
      );
    }
  });

  test("worker advances past a failed step, records the failure, and still completes the enrollment", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const request = page.context().request;

    // Sanity-check our env override took effect for this process — if
    // somebody bumps the default we want the spec to fail loudly here
    // rather than silently retry through the test window.
    expect(MAX_SEND_ATTEMPTS).toBe(1);

    await login(request);
    const csrf = await getCsrfToken(request);
    const headers = { "X-CSRF-Token": csrf };

    // ── Brand
    const brandRes = await request.post(`${BASE}/api/brands`, {
      data: { name: BRAND_NAME, slug: BRAND_SLUG },
      headers,
    });
    expect(brandRes.status()).toBe(201);
    const brand = (await brandRes.json()) as { id: string; orgId: string };
    createdBrandIds.push(brand.id);

    // ── Contact
    const contactRes = await request.post(`${BASE}/api/marketing/contacts`, {
      data: {
        brandId: brand.id,
        firstName: "Cadence",
        lastName: `Fail-${RUN}`,
        email: CONTACT_EMAIL,
      },
      headers,
    });
    expect(contactRes.status()).toBe(201);
    const contact = (await contactRes.json()) as { id: string };

    // Resolve orgId from the contact (the brand response shape varies
    // between routes, but the contact row always carries org_id).
    const { rows: contactRows } = await pool.query<{ org_id: string }>(
      `SELECT org_id FROM client_contacts WHERE id = $1`,
      [contact.id],
    );
    expect(contactRows.length).toBe(1);
    const orgId = contactRows[0].org_id;

    // ── Lower the per-org retry policy to "1 attempt = permanent" so a
    //    single suppressed send classifies as `permanent_failure`
    //    instead of looping through 5 transient retries inside the
    //    test window. We snapshot the original values and restore in
    //    afterAll so unrelated specs aren't affected.
    const { rows: policyRows } = await pool.query<{
      marketing_send_max_attempts: number;
      marketing_send_retry_base_ms: number;
    }>(
      `SELECT marketing_send_max_attempts, marketing_send_retry_base_ms
         FROM orgs WHERE id = $1`,
      [orgId],
    );
    expect(policyRows.length).toBe(1);
    restoreOrgPolicy.push({
      orgId,
      maxAttempts: policyRows[0].marketing_send_max_attempts,
      baseMs: policyRows[0].marketing_send_retry_base_ms,
    });
    await pool.query(
      `UPDATE orgs
          SET marketing_send_max_attempts = 1
        WHERE id = $1`,
      [orgId],
    );

    // ── Suppress the contact's email at the org level so the worker's
    //    sendViaConnectedMailbox throws RecipientSuppressedError on
    //    every attempt.
    const masked = maskRecipient(CONTACT_EMAIL);
    expect(masked, "maskRecipient must produce a masked address").not.toBeNull();
    const supRes = await request.post(
      `${BASE}/api/admin/email/masked-suppressions`,
      {
        data: { recipient: masked, reason: "test:cadence-failure" },
        headers,
      },
    );
    // 201 = created, 200 also acceptable if an earlier crashed run
    // left a row behind for this hash (the route is idempotent).
    expect([200, 201]).toContain(supRes.status());
    const supBody = (await supRes.json()) as { entry?: { hash: string } };
    expect(supBody.entry?.hash).toBeTruthy();
    cleanupHashes.push({ orgId, hash: supBody.entry!.hash });

    // ── Sequence + 2 steps (step 0 = immediate, step 1 = +5 days).
    const seqRes = await request.post(`${BASE}/api/marketing/sequences`, {
      data: {
        brandId: brand.id,
        name: SEQUENCE_NAME,
        description: `Cadence failure spec ${RUN}`,
      },
      headers,
    });
    expect(seqRes.status()).toBe(201);
    const sequence = (await seqRes.json()) as { id: string };

    const stepsRes = await request.put(
      `${BASE}/api/marketing/sequences/${sequence.id}/steps`,
      {
        data: {
          steps: [
            { delayDays: 0, subject: STEP1_SUBJECT, body: STEP1_BODY },
            { delayDays: STEP2_DELAY_DAYS, subject: STEP2_SUBJECT, body: STEP2_BODY },
          ],
        },
        headers,
      },
    );
    expect(stepsRes.status()).toBe(200);

    // ── Enroll the contact.
    const enrollRes = await request.post(
      `${BASE}/api/marketing/sequences/${sequence.id}/enrollments`,
      { data: { contactIds: [contact.id] }, headers },
    );
    expect(enrollRes.status()).toBe(201);

    const listRes = await request.get(
      `${BASE}/api/marketing/sequences/${sequence.id}/enrollments`,
    );
    expect(listRes.status()).toBe(200);
    const listed = (await listRes.json()) as Array<{
      id: string;
      contactId: string;
      currentStepIndex: number;
      status: string;
      nextSendAt: string | null;
    }>;
    const enrollment = listed.find((e) => e.contactId === contact.id);
    expect(enrollment, "enrollment row visible via API").toBeDefined();
    expect(enrollment!.status).toBe("active");
    expect(enrollment!.currentStepIndex).toBe(0);

    // ════════════════════════════════════════════════════════════════
    //  TICK 1 — step 0 must FAIL (suppressed) but cadence still ticks:
    //  the enrollment advances to step 1 with nextSendAt = t0 + 5 days.
    // ════════════════════════════════════════════════════════════════
    const t0 = new Date();
    const tick1 = await processScheduledSequenceEnrollments(t0);
    // The worker counts failed sends in `errors`, not `sent`.
    expect(tick1.processed).toBeGreaterThanOrEqual(1);
    expect(tick1.errors).toBeGreaterThanOrEqual(1);

    const afterTick1 = await loadEnrollment(enrollment!.id);
    expect(afterTick1.status).toBe("active");
    expect(afterTick1.current_step_index).toBe(1);
    expect(afterTick1.next_send_at).not.toBeNull();
    const expectedNext = t0.getTime() + STEP2_DELAY_DAYS * DAY_MS;
    const actualNext = new Date(afterTick1.next_send_at!).getTime();
    expect(Math.abs(actualNext - expectedNext)).toBeLessThan(1_000);

    // Failure is recorded in email_send_attempts, NOT in the
    // contact-visible email_sent activity firehose.
    const attemptsAfterTick1 = await loadSequenceAttempts(sequence.id, contact.id);
    expect(attemptsAfterTick1).toHaveLength(1);
    expect(attemptsAfterTick1[0].step_index).toBe(0);
    expect(attemptsAfterTick1[0].attempt_number).toBe(1);
    expect(attemptsAfterTick1[0].status).toBe("permanent_failure");
    expect(attemptsAfterTick1[0].error_code).not.toBeNull();
    expect(await loadEmailSentActivityCount(contact.id, sequence.id)).toBe(0);

    // ════════════════════════════════════════════════════════════════
    //  TICK 2 — one day later, step 1 is not yet due. Worker must
    //  not advance the enrollment, regardless of step 0's failure.
    // ════════════════════════════════════════════════════════════════
    const tEarly = new Date(t0.getTime() + 1 * DAY_MS);
    await processScheduledSequenceEnrollments(tEarly);
    const afterTick2 = await loadEnrollment(enrollment!.id);
    expect(afterTick2.current_step_index).toBe(1);
    expect(afterTick2.status).toBe("active");
    expect(await loadSequenceAttempts(sequence.id, contact.id)).toHaveLength(1);

    // ════════════════════════════════════════════════════════════════
    //  TICK 3 — at t0 + 5 days step 1 is now due. Same recipient is
    //  still suppressed → step 1 also fails permanently → enrollment
    //  marked completed (no further steps).
    // ════════════════════════════════════════════════════════════════
    const tDue = new Date(t0.getTime() + STEP2_DELAY_DAYS * DAY_MS);
    const tick3 = await processScheduledSequenceEnrollments(tDue);
    expect(tick3.processed).toBeGreaterThanOrEqual(1);
    expect(tick3.errors).toBeGreaterThanOrEqual(1);
    expect(tick3.completed).toBeGreaterThanOrEqual(1);

    const afterTick3 = await loadEnrollment(enrollment!.id);
    expect(afterTick3.status).toBe("completed");
    expect(afterTick3.current_step_index).toBe(2);
    expect(afterTick3.next_send_at).toBeNull();

    const attemptsAfterTick3 = await loadSequenceAttempts(sequence.id, contact.id);
    expect(attemptsAfterTick3).toHaveLength(2);
    expect(attemptsAfterTick3[0].step_index).toBe(0);
    expect(attemptsAfterTick3[0].status).toBe("permanent_failure");
    expect(attemptsAfterTick3[1].step_index).toBe(1);
    expect(attemptsAfterTick3[1].status).toBe("permanent_failure");
    // No real sends happened, so the firehose stays empty for this
    // sequence — the user does not see misleading "email sent" rows.
    expect(await loadEmailSentActivityCount(contact.id, sequence.id)).toBe(0);

    // ── User-facing surface: the same enrollments API the sequences UI
    //    reads must show the run as completed (not stuck on step 0)
    //    and clear nextSendAt — this is what the operator actually
    //    sees when they open the sequence.
    const listAfterRes = await request.get(
      `${BASE}/api/marketing/sequences/${sequence.id}/enrollments`,
    );
    expect(listAfterRes.status()).toBe(200);
    const listedAfter = (await listAfterRes.json()) as Array<{
      contactId: string;
      currentStepIndex: number;
      status: string;
      nextSendAt: string | null;
    }>;
    const enrollmentAfter = listedAfter.find((e) => e.contactId === contact.id);
    expect(enrollmentAfter, "enrollment still listed via API").toBeDefined();
    expect(enrollmentAfter!.status).toBe("completed");
    expect(enrollmentAfter!.currentStepIndex).toBe(2);
    expect(enrollmentAfter!.nextSendAt).toBeNull();

    // ════════════════════════════════════════════════════════════════
    //  TICK 4 — re-running after completion is a no-op for this
    //  enrollment. Guards against accidentally re-dispatching a
    //  failed step or resurrecting the enrollment.
    // ════════════════════════════════════════════════════════════════
    await processScheduledSequenceEnrollments(
      new Date(tDue.getTime() + 10 * DAY_MS),
    );
    const afterTick4 = await loadEnrollment(enrollment!.id);
    expect(afterTick4.status).toBe("completed");
    expect(afterTick4.current_step_index).toBe(2);
    expect(await loadSequenceAttempts(sequence.id, contact.id)).toHaveLength(2);
  });
});
