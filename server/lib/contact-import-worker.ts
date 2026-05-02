/**
 * Marketing OS — CSV contact import background worker.
 *
 * The route handler enqueues a job (writes a `contact_imports` row with
 * status="pending") and returns 202 immediately. This module is responsible
 * for actually processing the rows: dedupe lookup, executing each plan
 * against `storage`, periodically updating `progressCount`, and finally
 * marking the row completed/failed with per-row errors in `errorsJson`.
 *
 * Runs in-process via `setImmediate` — there is no external queue. That is
 * sufficient for our scale (single Node server, imports up to 50k rows) and
 * keeps deployment simple. If multiple workers ever need to coordinate,
 * swap this for a real queue without changing the route or wizard.
 */
import { eq, and, inArray, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import {
  marketingProspects,
  contactImports,
  contactActivities,
  type InsertMarketingProspect,
  type MarketingProspectLifecycleStage,
} from "@shared/schema";
import {
  planContactImport,
  type DedupeStrategy,
  type ValidatedImportRow,
} from "./contact-import";
import { sanitizeErrorMessage } from "../routes/middleware";

// Sprint 2o.0 5b1d (HR4): valid marketing-prospect lifecycle enum values.
// CSV import accepts lifecycleStage as free text (PSO schema); we coerce to
// the marketing enum here and fall back to "lead" on miss.
const VALID_PROSPECT_STAGES: ReadonlySet<MarketingProspectLifecycleStage> =
  new Set(["lead", "mql", "sql", "opportunity", "converted", "lost", "nurture"]);

/**
 * Sprint 2o.0 5b1d (HR4): field-map a planContactImport row (PSO clientContact
 * shape) to InsertMarketingProspect. Drops PSO-only fields (role, companyName,
 * twitterUrl, leadStatus); maps `source` → `leadSource` with a "csv-import"
 * default; coerces lifecycleStage against the marketing enum. Scope-fenced:
 * does NOT modify the planner — only the payload at the write site.
 */
function mapPlanDataToProspect(
  data: ValidatedImportRow,
  orgId: string,
  brandId: string,
): InsertMarketingProspect {
  const stage = data.lifecycleStage as MarketingProspectLifecycleStage | undefined;
  const lifecycleStage: MarketingProspectLifecycleStage =
    stage && VALID_PROSPECT_STAGES.has(stage) ? stage : "lead";
  return {
    orgId,
    brandId,
    firstName: data.firstName ?? null,
    lastName: data.lastName ?? null,
    email: data.email ?? null,
    phone: data.phone ?? null,
    title: data.title ?? null,
    location: data.location ?? null,
    linkedinUrl: data.linkedinUrl ?? null,
    notes: data.notes ?? null,
    lifecycleStage,
    leadSource: data.source ?? "csv-import",
  };
}

function errMsg(err: unknown): string {
  return sanitizeErrorMessage(
    err instanceof Error ? err : new Error(String(err)),
  );
}

export interface RunImportJobInput {
  importId: string;
  orgId: string;
  brandId: string;
  rows: Record<string, unknown>[];
  mapping: Record<string, string>;
  dedupeStrategy: DedupeStrategy;
  // Optional set of brand-scoped tag ids to apply to every successfully
  // created/updated contact after the row loop completes.
  tagIds?: string[];
  // Sprint 2f: actor (the user who uploaded the CSV) and source filename
  // for the `imported` summary activity row emitted on completion.
  actorId?: string | null;
  fileName?: string;
}

/**
 * Execute a queued import. Idempotent against the `status` column: a row
 * already past "pending"/"processing" is skipped so a stray re-trigger
 * cannot double-write rows.
 */
export async function runContactImportJob(
  input: RunImportJobInput,
): Promise<void> {
  const { importId, orgId, brandId, rows, mapping, dedupeStrategy } = input;
  const tagIds = input.tagIds ?? [];
  const actorId = input.actorId ?? null;
  const fileName = input.fileName ?? "";

  // Claim the job: only transition pending → processing once. If another
  // process already moved it forward we bail out.
  const claimed = await db
    .update(contactImports)
    .set({ status: "processing" })
    .where(
      and(
        eq(contactImports.id, importId),
        eq(contactImports.status, "pending"),
      ),
    )
    .returning({ id: contactImports.id });

  if (claimed.length === 0) {
    return;
  }

  try {
    // Dedupe lookup deferred to the worker so the request returns fast.
    const candidateEmails = new Set<string>();
    for (const row of rows) {
      for (const [csvHeader, target] of Object.entries(mapping)) {
        if (target !== "email") continue;
        const v = row[csvHeader];
        if (v && typeof v === "string" && v.trim()) {
          candidateEmails.add(v.trim().toLowerCase());
        }
      }
    }

    const existingEmails = new Set<string>();
    if (candidateEmails.size > 0) {
      // Sprint 2o.0 5b1c: dedupe lookup retargeted from client_contacts
      // (legacy PSO) to marketing_prospects so the marketing OS no longer
      // depends on the PSO contact tables (HR4).
      const existingRows = await db
        .select({ email: marketingProspects.email })
        .from(marketingProspects)
        .where(
          and(
            eq(marketingProspects.orgId, orgId),
            eq(marketingProspects.brandId, brandId),
            inArray(
              sql`lower(${marketingProspects.email})`,
              Array.from(candidateEmails),
            ),
          ),
        );
      for (const r of existingRows) {
        if (r.email) existingEmails.add(r.email.trim().toLowerCase());
      }
    }

    const { plans } = planContactImport({
      rows,
      mapping,
      dedupeStrategy,
      existingEmails,
    });

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: Array<{ rowIndex: number; message: string }> = [];
    // Sprint 2o.0 5b1d (HR4): worker writes go through storage.createProspect /
    // updateProspect (marketing_prospects), not storage.createContact /
    // updateContact (PSO client_contacts). This array now genuinely holds
    // marketing_prospects ids (was aspirationally named in 5b1c).
    const taggableProspectIds: string[] = [];

    // Update progress at most ~100 times across the run so we don't hammer
    // the DB on a 50k-row import. Floor at 1 so tiny imports still tick.
    const total = plans.length;
    const updateEvery = Math.max(1, Math.floor(total / 100));
    let processed = 0;

    for (const plan of plans) {
      try {
        if (plan.action === "insert") {
          try {
            // Sprint 2o.0 5b1d (HR4): write to marketing_prospects via
            // createProspect. createProspect does not emit per-row activities
            // (the import emits one `imported` summary row per touched
            // prospect at the end), so no emit-suppression flag is needed.
            const inserted = await storage.createProspect(
              mapPlanDataToProspect(plan.data, orgId, brandId),
            );
            created++;
            taggableProspectIds.push(inserted.id);
          } catch (insertErr: unknown) {
            errors.push({
              rowIndex: plan.rowIndex,
              message: errMsg(insertErr),
            });
          }
        } else if (plan.action === "update") {
          const [existing] = await db
            .select({ id: marketingProspects.id })
            .from(marketingProspects)
            .where(
              and(
                eq(marketingProspects.orgId, orgId),
                eq(marketingProspects.brandId, brandId),
                eq(sql`lower(${marketingProspects.email})`, plan.emailKey),
              ),
            )
            .limit(1);
          if (!existing) {
            const inserted = await storage.createProspect(
              mapPlanDataToProspect(plan.data, orgId, brandId),
            );
            created++;
            taggableProspectIds.push(inserted.id);
          } else {
            // Sprint 2o.0 5b1d (HR4): update via updateProspect. Pass only the
            // marketing-prospect-shaped patch (orgId/brandId immutable here).
            const { orgId: _o, brandId: _b, ...patch } =
              mapPlanDataToProspect(plan.data, orgId, brandId);
            void _o;
            void _b;
            await storage.updateProspect(existing.id, orgId, patch);
            updated++;
            taggableProspectIds.push(existing.id);
          }
        } else if (plan.action === "skip") {
          skipped++;
        } else {
          errors.push({ rowIndex: plan.rowIndex, message: plan.message });
        }
      } catch (err: unknown) {
        errors.push({ rowIndex: plan.rowIndex, message: errMsg(err) });
      }

      processed++;
      if (processed % updateEvery === 0 && processed < total) {
        try {
          await db
            .update(contactImports)
            .set({
              progressCount: processed,
              successCount: created + updated,
              updatedCount: updated,
              errorCount: errors.length,
            })
            .where(eq(contactImports.id, importId));
        } catch (progressErr: unknown) {
          console.error(
            "[contact-import-worker] progress update failed:",
            errMsg(progressErr),
          );
        }
      }
    }

    // Bulk-attach selected tags to every contact created or updated. The
    // helper is idempotent (ON CONFLICT DO NOTHING) so re-imports of an
    // already-tagged cohort don't fail or duplicate. Tagging errors do NOT
    // mark the whole run failed: contacts are already persisted, so we
    // surface the failure as a per-row error and keep the import status.
    let tagged = 0;
    if (tagIds.length > 0 && taggableProspectIds.length > 0) {
      try {
        tagged = await storage.addTagsToContacts(
          orgId,
          brandId,
          taggableProspectIds,
          tagIds,
        );
      } catch (tagErr: unknown) {
        errors.push({
          rowIndex: -1,
          message: `Tag assignment failed: ${errMsg(tagErr)}`,
        });
      }
    }

    const status =
      errors.length > 0 && created === 0 && updated === 0
        ? "failed"
        : "completed";

    // Sprint 2f: when the run actually wrote contacts, emit ONE summary
    // `imported` activity per touched contact in the SAME tx as the
    // import-status `completed` UPDATE. If the emit fails, the status
    // flip rolls back so the wizard does NOT see a stale "completed"
    // without its activity rows.
    const successCount = created + updated;
    await db.transaction(async (tx) => {
      await tx
        .update(contactImports)
        .set({
          progressCount: total,
          successCount,
          updatedCount: updated,
          taggedCount: tagged,
          errorCount: errors.length,
          status,
          errorsJson: errors,
          completedAt: new Date(),
        })
        .where(eq(contactImports.id, importId));
      if (status === "completed" && taggableProspectIds.length > 0) {
        // Sprint 2f: emit ONE `imported` summary row per touched contact so
        // each contact's timeline shows the import event with {count,
        // file_name}. CSV imports may carry up to 50k contacts (worker cap),
        // far above the 1000-pair cap that applies to bulk tag actions —
        // so we chunk the INSERT in 1000-row batches to keep each statement
        // within the same constant-bound shape.
        const CHUNK = 1000;
        for (let i = 0; i < taggableProspectIds.length; i += CHUNK) {
          const slice = taggableProspectIds.slice(i, i + CHUNK);
          await tx.insert(contactActivities).values(
            slice.map((prospectId) => ({
              orgId,
              brandId,
              prospectId,
              type: "imported" as const,
              payload: { count: successCount, file_name: fileName },
              actorId,
            })),
          );
        }
      }
    });
  } catch (jobErr: unknown) {
    // Catastrophic failure (e.g. dedupe query threw). Mark the row failed
    // so the wizard stops polling.
    console.error(
      "[contact-import-worker] job failed:",
      errMsg(jobErr),
    );
    try {
      await db
        .update(contactImports)
        .set({
          status: "failed",
          // Keep status payload internally consistent: a catastrophic
          // failure means we couldn't account for any rows, so flag the
          // whole batch as one synthetic error and zero out progress.
          progressCount: 0,
          successCount: 0,
          updatedCount: 0,
          taggedCount: 0,
          errorCount: 1,
          errorsJson: [{ rowIndex: -1, message: errMsg(jobErr) }],
          completedAt: new Date(),
        })
        .where(eq(contactImports.id, importId));
    } catch {
      // give up — already logged above
    }
  }
}

/**
 * Recover orphaned `contact_imports` rows after a server restart.
 *
 * Because the worker runs in-process via `setImmediate`, a restart mid-import
 * leaves rows stuck in `pending`/`processing` forever and the wizard polls
 * indefinitely. On boot we sweep any such rows older than the threshold and
 * mark them `failed` with a synthetic error so users get clear feedback.
 *
 * Important: this is intended to be invoked **once at process startup only**
 * (see `server/index.ts`). At boot time, every existing `pending`/`processing`
 * row is by definition orphaned — its worker died with the previous process.
 * We do NOT schedule this on an interval: there's no per-job heartbeat, so
 * a periodic sweep would race against legitimate long-running imports and
 * mark them failed mid-flight.
 *
 * Tradeoff: we do NOT requeue, because the source rows + mapping aren't
 * persisted on the import record (only on the originating request). Adding
 * requeue would require persisting the request payload (potentially
 * megabytes of CSV per job) — out of scope for this sweep.
 */
export async function recoverStuckContactImports(
  thresholdMs = 10 * 60_000,
): Promise<number> {
  const cutoff = new Date(Date.now() - thresholdMs);
  try {
    const result = await db
      .update(contactImports)
      .set({
        status: "failed",
        errorCount: 1,
        errorsJson: [
          {
            rowIndex: -1,
            message:
              "Import was interrupted by a server restart and could not be resumed. Please re-upload the CSV.",
          },
        ],
        completedAt: new Date(),
      })
      .where(
        and(
          inArray(contactImports.status, ["pending", "processing"]),
          lt(contactImports.createdAt, cutoff),
        ),
      )
      .returning({ id: contactImports.id });
    if (result.length > 0) {
      console.log(
        `[contact-import-worker] Recovered ${result.length} stuck import(s): ${result.map((r) => r.id).join(", ")}`,
      );
    }
    return result.length;
  } catch (err: unknown) {
    console.error(
      "[contact-import-worker] recoverStuckContactImports failed:",
      errMsg(err),
    );
    return 0;
  }
}

/**
 * Schedule a job to run on the next tick, decoupled from the request that
 * enqueued it. Errors inside the job are caught and logged; they must
 * never crash the server process.
 */
export function scheduleContactImportJob(input: RunImportJobInput): void {
  setImmediate(() => {
    runContactImportJob(input).catch((err) => {
      console.error(
        "[contact-import-worker] unhandled job rejection:",
        err instanceof Error ? err.message : String(err),
      );
    });
  });
}
