/**
 * Task #244 — End-to-end coverage for sequence enrollment + send-time cadence.
 *
 * Sister spec to marketing-campaign-sequence-editors.spec.ts: that one
 * proves the *editor* UIs work; this one walks an enrolled contact
 * through a multi-step sequence and asserts the scheduled-send worker
 * dispatches each step on the right calendar day.
 *
 * Flow:
 *   1. Provision a fresh brand + a single contact via the marketing API.
 *   2. Create a 2-step sequence (step 0 fires on enrollment, step 1
 *      waits 5 days).
 *   3. Enroll the contact via POST /api/marketing/sequences/:id/enrollments
 *      and assert the new enrollment row is `active`, currentStepIndex=0,
 *      nextSendAt ≈ now (the storage layer schedules step 0 immediately).
 *   4. Tick the worker (processScheduledSequenceEnrollments imported from
 *      server/marketing/scheduled-send) at t0 — assert step 0 dispatches,
 *      a contact_activities row is recorded, and the enrollment advances
 *      to currentStepIndex=1 with nextSendAt = t0 + 5 days.
 *   5. Tick again at t0 + 1 day and assert *no* progress (cadence holds
 *      the next send back until the delay elapses).
 *   6. Tick at t0 + 5 days and assert step 1 dispatches and the
 *      enrollment is marked `completed` (nextSendAt cleared,
 *      currentStepIndex advances past the final step).
 *
 * The worker is invoked directly from the spec — same pattern the
 * cleanup hook uses (it imports cleanupE2EBrandPollution and runs it in
 * afterAll). This avoids inventing a "tick now" admin endpoint just for
 * test coverage and lets us pump synthetic `now` values that would
 * otherwise require waiting calendar days.
 *
 * Cleanup: cleanupE2EBrandPollution removes the brand and cascades to
 * marketing_sequences (which cascades to marketing_sequence_steps and
 * marketing_sequence_enrollments via FK onDelete: cascade) and
 * contact_activities (scoped by brand_id). The temporary contact has its
 * brand_id NULLed by the same script.
 */
process.env.MARKETING_OS_ENABLED = "true";
process.env.VITE_MARKETING_OS_ENABLED = "true";
// Force the SMTP transport branch in selectTransport so a Cherry-Street
// org that's been wired to OAuth in some other branch of the test DB
// can't trip us into MissingMailboxError. The SMTP transport gracefully
// returns a "noop" send result when no SMTP creds are configured, which
// is exactly what we want for a worker assertion that doesn't care
// about the underlying provider.
process.env.EMAIL_OAUTH_ENABLED = "false";
// Wipe any inherited SMTP env so the env-level nodemailer transporter
// inside this spec's process resolves to "no SMTP configured" and
// SmtpTransport short-circuits to its noop branch (transport='noop',
// ok:false). Without this the worker would attempt a real Office365
// authentication against the workspace's SMTP credentials and fail
// with `Authentication unsuccessful`, which would mask cadence bugs
// behind transient SMTP failures. We delete (rather than set "") so
// `if (smtpHost && smtpPort && smtpUser && smtpPass)` short-circuits
// regardless of how createEnvTransporter is checking.
delete process.env.SMTP_HOST;
delete process.env.SMTP_PORT;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;

import { test, expect, type APIRequestContext } from "@playwright/test";
import { cleanupE2EBrandPollution } from "../scripts/cleanup-e2e-brand-pollution";
import { pool } from "../server/db";
import { processScheduledSequenceEnrollments } from "../server/marketing/scheduled-send";

const BASE = `http://localhost:${process.env.PORT || 5000}`;
// We deliberately log in as the cwpro-dev-qa admin (the seeded org that
// already has the marketing_os entitlement active) instead of the
// Cherry-Street admin used by the editor spec. The cadence assertions
// don't care about brand-switching UX, only that the worker dispatches
// each step on the right day, and this org is the canonical "marketing
// is on" fixture (see entitlement-on-smoke.spec.ts).
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
// Reuse the `marketing-editors-e2e-` slug prefix so the standalone
// cleanup CLI (scripts/cleanup-e2e-brand-pollution.ts) sweeps any
// stragglers from a crashed run without us having to widen its
// allow-list.
const BRAND_SLUG = `marketing-editors-e2e-${RUN}`;

const CONTACT_EMAIL = `cadence-${RUN}@example.test`;
const SEQUENCE_NAME = `Cadence ${RUN}`;
const STEP1_SUBJECT = `Day-zero ping ${RUN}`;
const STEP1_BODY = `Hello on the day they enrolled (${RUN}).`;
const STEP2_SUBJECT = `Day-five follow-up ${RUN}`;
const STEP2_BODY = `Five days later, checking in (${RUN}).`;
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

interface ActivityRow {
  contact_id: string;
  type: string;
  payload: { sequence_id?: string; step_index?: number };
}

async function loadEmailSentActivities(
  contactId: string,
  sequenceId: string,
): Promise<ActivityRow[]> {
  const { rows } = await pool.query<ActivityRow>(
    `SELECT contact_id, type, payload
       FROM contact_activities
       WHERE contact_id = $1 AND type = 'email_sent' AND payload->>'sequence_id' = $2
       ORDER BY (payload->>'step_index')::int ASC`,
    [contactId, sequenceId],
  );
  return rows;
}

test.describe("Marketing OS — sequence enrollment send-time cadence", () => {
  const createdBrandIds: string[] = [];

  // Note: no beforeAll seeding is required — the cwpro-dev-qa org
  // ships with marketing_os entitlement turned on (see migrations) and
  // the admin.test password is the seeded fixture admin123.

  test.afterAll(async () => {
    try {
      await cleanupE2EBrandPollution(createdBrandIds);
    } catch (err) {
      console.error("[marketing-sequence-enrollment-cadence afterAll] cleanup failed:", err);
    }
  });

  test("worker dispatches each step on its scheduled day and completes the enrollment", async ({
    request: _unused,
    page,
  }) => {
    test.setTimeout(60_000);
    // Pull request off the page context for cookie sharing — same
    // pattern as marketing-campaign-sequence-editors.spec.ts.
    const request = page.context().request;

    await login(request);
    const csrf = await getCsrfToken(request);
    const headers = { "X-CSRF-Token": csrf };

    // ── Brand
    const brandRes = await request.post(`${BASE}/api/brands`, {
      data: { name: BRAND_NAME, slug: BRAND_SLUG },
      headers,
    });
    expect(brandRes.status()).toBe(201);
    const brand = (await brandRes.json()) as { id: string };
    createdBrandIds.push(brand.id);

    // ── Contact
    const contactRes = await request.post(`${BASE}/api/marketing/contacts`, {
      data: {
        brandId: brand.id,
        firstName: "Cadence",
        lastName: `E2E-${RUN}`,
        email: CONTACT_EMAIL,
      },
      headers,
    });
    expect(contactRes.status()).toBe(201);
    const contact = (await contactRes.json()) as { id: string };

    // ── Sequence + 2 steps (step 0 = immediate, step 1 = +5 days).
    const seqRes = await request.post(`${BASE}/api/marketing/sequences`, {
      data: {
        brandId: brand.id,
        name: SEQUENCE_NAME,
        description: `Cadence spec ${RUN}`,
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
    const steps = (await stepsRes.json()) as Array<{ stepOrder: number; delayDays: number }>;
    expect(steps).toHaveLength(2);

    // ── Enroll the contact.
    const tEnroll = Date.now();
    const enrollRes = await request.post(
      `${BASE}/api/marketing/sequences/${sequence.id}/enrollments`,
      { data: { contactIds: [contact.id] }, headers },
    );
    expect(enrollRes.status()).toBe(201);
    const enrollResult = (await enrollRes.json()) as { inserted: number; skipped: number };
    expect(enrollResult.inserted).toBe(1);

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
    expect(enrollment!.nextSendAt, "step 0 is scheduled immediately").not.toBeNull();
    // Allow a generous 60 s window between when we POSTed and when
    // storage stamped nextSendAt — dev DBs can run slow under CI load.
    const initialNext = new Date(enrollment!.nextSendAt!).getTime();
    expect(Math.abs(initialNext - tEnroll)).toBeLessThan(60_000);

    // ════════════════════════════════════════════════════════════════
    //  TICK 1 — at t0, step 0 must dispatch and step 1 must be queued
    //  exactly STEP2_DELAY_DAYS days later.
    // ════════════════════════════════════════════════════════════════
    const t0 = new Date();
    const tick1 = await processScheduledSequenceEnrollments(t0);
    expect(tick1.processed).toBeGreaterThanOrEqual(1);
    expect(tick1.sent).toBeGreaterThanOrEqual(1);

    const afterTick1 = await loadEnrollment(enrollment!.id);
    expect(afterTick1.status).toBe("active");
    expect(afterTick1.current_step_index).toBe(1);
    expect(afterTick1.next_send_at).not.toBeNull();
    const expectedNext = t0.getTime() + STEP2_DELAY_DAYS * DAY_MS;
    const actualNext = new Date(afterTick1.next_send_at!).getTime();
    // computeNextSendAt is exact (no rounding) so the diff should be 0,
    // but allow 1 s for clock-skew between Date objects on hot paths.
    expect(Math.abs(actualNext - expectedNext)).toBeLessThan(1_000);

    const activitiesAfterTick1 = await loadEmailSentActivities(contact.id, sequence.id);
    expect(activitiesAfterTick1).toHaveLength(1);
    expect(activitiesAfterTick1[0].payload.step_index).toBe(0);

    // ════════════════════════════════════════════════════════════════
    //  TICK 2 — one day later, the next-send gate is still in the
    //  future, so the worker must NOT advance the enrollment.
    // ════════════════════════════════════════════════════════════════
    const tEarly = new Date(t0.getTime() + 1 * DAY_MS);
    const tick2 = await processScheduledSequenceEnrollments(tEarly);
    // The worker may pick up unrelated enrollments from concurrent
    // tests; the assertion that matters is OUR row didn't move.
    const afterTick2 = await loadEnrollment(enrollment!.id);
    expect(afterTick2.current_step_index).toBe(1);
    expect(afterTick2.status).toBe("active");
    const activitiesAfterTick2 = await loadEmailSentActivities(contact.id, sequence.id);
    expect(activitiesAfterTick2).toHaveLength(1);
    void tick2;

    // ════════════════════════════════════════════════════════════════
    //  TICK 3 — at t0 + 5 days the second step is now due. Worker
    //  must dispatch step 1 and mark the enrollment completed.
    // ════════════════════════════════════════════════════════════════
    const tDue = new Date(t0.getTime() + STEP2_DELAY_DAYS * DAY_MS);
    const tick3 = await processScheduledSequenceEnrollments(tDue);
    expect(tick3.processed).toBeGreaterThanOrEqual(1);
    expect(tick3.sent).toBeGreaterThanOrEqual(1);
    expect(tick3.completed).toBeGreaterThanOrEqual(1);

    const afterTick3 = await loadEnrollment(enrollment!.id);
    expect(afterTick3.status).toBe("completed");
    expect(afterTick3.current_step_index).toBe(2);
    expect(afterTick3.next_send_at).toBeNull();

    const activitiesAfterTick3 = await loadEmailSentActivities(contact.id, sequence.id);
    expect(activitiesAfterTick3).toHaveLength(2);
    expect(activitiesAfterTick3[0].payload.step_index).toBe(0);
    expect(activitiesAfterTick3[1].payload.step_index).toBe(1);

    // ════════════════════════════════════════════════════════════════
    //  TICK 4 — re-running the worker after completion is a no-op for
    //  this enrollment (status='completed' is filtered out of the due
    //  query). Guards against accidentally re-dispatching past steps
    //  or "ressurecting" a completed sequence.
    // ════════════════════════════════════════════════════════════════
    const tick4 = await processScheduledSequenceEnrollments(
      new Date(tDue.getTime() + 10 * DAY_MS),
    );
    void tick4;
    const afterTick4 = await loadEnrollment(enrollment!.id);
    expect(afterTick4.status).toBe("completed");
    expect(afterTick4.current_step_index).toBe(2);
    const activitiesFinal = await loadEmailSentActivities(contact.id, sequence.id);
    expect(activitiesFinal).toHaveLength(2);
  });
});
