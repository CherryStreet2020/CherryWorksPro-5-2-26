/**
 * Marketing OS — CSV Contact Import.
 *
 * POST /api/marketing/contacts/import
 *   - dryRun=true: synchronous plan/preview, no DB writes (used by the
 *     Review step to project create/update/skip/error counts).
 *   - dryRun=false: enqueue a background job. Returns 202 with importId.
 *
 * GET /api/marketing/contacts/import/:id
 *   - Status polling for the wizard's Results step.
 *
 * Real row processing lives in `server/lib/contact-import-worker.ts`.
 */
import type { Express, Request, Response, RequestHandler } from "express";
import { z } from "zod";
import { eq, and, inArray, sql, desc } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { marketingProspects, contactImports, contactImportPresets } from "@shared/schema";
import { requireAdminOrManager, sanitizeErrorMessage } from "./middleware";
import { requireFeature } from "../services/entitlements";
import {
  planContactImport,
  type DedupeStrategy,
} from "../lib/contact-import";
import { scheduleContactImportJob } from "../lib/contact-import-worker";

/**
 * Async-mode cap. The 5,000-row sync cap is gone — the worker streams
 * progress so the request thread is never blocked. 50k is a soft ceiling
 * to keep request payloads and dedupe lookups bounded.
 */
export const MAX_ASYNC_IMPORT_ROWS = 50_000;

// Sprint 2i.2: entitlement gate replaces the env-flag gate.
const flagGate: RequestHandler = requireFeature("marketing_os");

const importBody = z.object({
  brandId: z.string().uuid(),
  fileName: z.string().min(1).max(255),
  rows: z
    .array(z.record(z.union([z.string(), z.number(), z.null()])))
    .min(1)
    .max(MAX_ASYNC_IMPORT_ROWS),
  mapping: z.record(z.string()),
  dedupeStrategy: z.enum(["skip", "update"]),
  dryRun: z.boolean().optional().default(false),
  // Optional set of existing brand-scoped tag ids to apply to every
  // successfully created or updated contact. Validated server-side against
  // the import's brand. Capped at 50 (matches PUT /contacts/:id/tags).
  tagIds: z.array(z.string().uuid()).max(50).optional().default([]),
});

function errMsg(err: unknown): string {
  return sanitizeErrorMessage(
    err instanceof Error ? err : new Error(String(err)),
  );
}

export function registerMarketingContactImportRoutes(app: Express) {
  app.post(
    "/api/marketing/contacts/import",
    flagGate,
    requireAdminOrManager,
    async (req: Request, res: Response) => {
      const orgId = req.session.orgId!;
      const userId = req.session.userId!;

      let parsed: z.infer<typeof importBody>;
      try {
        parsed = importBody.parse(req.body);
      } catch (err: unknown) {
        return res.status(400).json({ message: errMsg(err) });
      }

      const { brandId, fileName, rows, mapping, dedupeStrategy, dryRun, tagIds } = parsed;

      const brand = await storage.getBrand(brandId, orgId);
      if (!brand) {
        return res
          .status(400)
          .json({ message: "Invalid brand for this organization" });
      }

      // Dry-run path stays synchronous — the Review step needs the
      // projected counts inline. We still hit the existing-emails lookup
      // because dedupe projections depend on it.
      if (dryRun) {
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
          // HR4-FIX-5b1c.1: retargeted to marketingProspects (was clientContacts read on marketing surface).
          // The marketing CSV import worker writes to marketing_prospects, so
          // the dry-run dedupe check must read the same table.
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

        const { plans, summary: planSummary } = planContactImport({
          rows,
          mapping,
          dedupeStrategy: dedupeStrategy as DedupeStrategy,
          existingEmails,
        });

        const projectedErrors = plans
          .filter((p): p is Extract<typeof p, { action: "error" }> => p.action === "error")
          .map((p) => ({ rowIndex: p.rowIndex, message: p.message }));

        return res.json({
          dryRun: true,
          created: planSummary.willCreate,
          updated: planSummary.willUpdate,
          skipped: planSummary.willSkip,
          // Projected: every row that would be created or updated will
          // receive the selected tags. Skipped/error rows do not.
          tagged: tagIds.length > 0
            ? planSummary.willCreate + planSummary.willUpdate
            : 0,
          errors: projectedErrors,
          plan: planSummary,
          status: "completed" as const,
        });
      }

      // Async path: insert pending row, schedule the worker, return 202.
      // Actual row processing — including applying `tagIds` to every
      // successfully created/updated contact — happens in
      // server/lib/contact-import-worker.ts.
      let importId: string;
      try {
        const [inserted] = await db
          .insert(contactImports)
          .values({
            orgId,
            brandId,
            userId,
            fileName,
            rowCount: rows.length,
            successCount: 0,
            errorCount: 0,
            progressCount: 0,
            status: "pending",
            errorsJson: [],
          })
          .returning({ id: contactImports.id });
        importId = inserted.id;
      } catch (insertErr: unknown) {
        return res.status(500).json({ message: errMsg(insertErr) });
      }

      scheduleContactImportJob({
        importId,
        orgId,
        brandId,
        rows,
        mapping,
        dedupeStrategy: dedupeStrategy as DedupeStrategy,
        tagIds,
        actorId: userId,
        fileName,
      });

      return res.status(202).json({
        importId,
        status: "pending" as const,
        rowCount: rows.length,
      });
    },
  );

  // ── Field-mapping presets ──────────────────────────────────────────────
  // Per (orgId, brandId, userId) named mappings so power users don't have
  // to re-confirm the column mapping for every import from the same source.
  //
  // IMPORTANT: these literal-path routes are registered BEFORE the
  // `/:id` status route below, otherwise Express's `:id` placeholder
  // would shadow `/presets` and the GET would 404 as a missing import.

  const presetCreateBody = z.object({
    brandId: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
    mapping: z.record(z.string()),
  });

  app.get(
    "/api/marketing/contacts/import/presets",
    flagGate,
    requireAdminOrManager,
    async (req: Request, res: Response) => {
      const orgId = req.session.orgId!;
      const userId = req.session.userId!;
      const brandId = String(req.query.brandId ?? "");
      if (!brandId) {
        return res.status(400).json({ message: "brandId is required" });
      }
      try {
        const rows = await db
          .select()
          .from(contactImportPresets)
          .where(
            and(
              eq(contactImportPresets.orgId, orgId),
              eq(contactImportPresets.brandId, brandId),
              eq(contactImportPresets.userId, userId),
            ),
          )
          .orderBy(desc(contactImportPresets.updatedAt));
        return res.json(rows);
      } catch (err: unknown) {
        return res.status(500).json({ message: errMsg(err) });
      }
    },
  );

  app.post(
    "/api/marketing/contacts/import/presets",
    flagGate,
    requireAdminOrManager,
    async (req: Request, res: Response) => {
      const orgId = req.session.orgId!;
      const userId = req.session.userId!;
      let parsed: z.infer<typeof presetCreateBody>;
      try {
        parsed = presetCreateBody.parse(req.body);
      } catch (err: unknown) {
        return res.status(400).json({ message: errMsg(err) });
      }
      const brand = await storage.getBrand(parsed.brandId, orgId);
      if (!brand) {
        return res
          .status(400)
          .json({ message: "Invalid brand for this organization" });
      }
      try {
        // Upsert on (org, brand, user, name) — saving with the same name
        // overwrites the prior mapping rather than throwing.
        const [row] = await db
          .insert(contactImportPresets)
          .values({
            orgId,
            brandId: parsed.brandId,
            userId,
            name: parsed.name,
            mappingJson: parsed.mapping,
          })
          .onConflictDoUpdate({
            target: [
              contactImportPresets.orgId,
              contactImportPresets.brandId,
              contactImportPresets.userId,
              contactImportPresets.name,
            ],
            set: {
              mappingJson: parsed.mapping,
              updatedAt: new Date(),
            },
          })
          .returning();
        return res.status(201).json(row);
      } catch (err: unknown) {
        return res.status(500).json({ message: errMsg(err) });
      }
    },
  );

  app.delete(
    "/api/marketing/contacts/import/presets/:id",
    flagGate,
    requireAdminOrManager,
    async (req: Request, res: Response) => {
      const orgId = req.session.orgId!;
      const userId = req.session.userId!;
      const id = String(req.params.id ?? "");
      try {
        const result = await db
          .delete(contactImportPresets)
          .where(
            and(
              eq(contactImportPresets.id, id),
              eq(contactImportPresets.orgId, orgId),
              eq(contactImportPresets.userId, userId),
            ),
          )
          .returning({ id: contactImportPresets.id });
        if (result.length === 0) {
          return res.status(404).json({ message: "Preset not found" });
        }
        return res.json({ ok: true });
      } catch (err: unknown) {
        return res.status(500).json({ message: errMsg(err) });
      }
    },
  );

  // Status route MUST be registered AFTER the literal `/presets` routes
  // above so the `:id` placeholder doesn't shadow them.
  app.get(
    "/api/marketing/contact-imports",
    flagGate,
    requireAdminOrManager,
    async (req: Request, res: Response) => {
      const orgId = req.session.orgId!;
      const brandId = typeof req.query.brandId === "string" ? req.query.brandId : "";
      if (!brandId) {
        return res.status(400).json({ message: "brandId query param is required" });
      }

      const brand = await storage.getBrand(brandId, orgId);
      if (!brand) {
        return res
          .status(400)
          .json({ message: "Invalid brand for this organization" });
      }

      const rows = await db
        .select({
          importId: contactImports.id,
          fileName: contactImports.fileName,
          status: contactImports.status,
          rowCount: contactImports.rowCount,
          progressCount: contactImports.progressCount,
          successCount: contactImports.successCount,
          errorCount: contactImports.errorCount,
          createdAt: contactImports.createdAt,
        })
        .from(contactImports)
        .where(
          and(
            eq(contactImports.orgId, orgId),
            eq(contactImports.brandId, brandId),
          ),
        )
        .orderBy(desc(contactImports.createdAt))
        .limit(10);

      return res.json({ imports: rows });
    },
  );

  app.get(
    "/api/marketing/contacts/import/:id",
    flagGate,
    requireAdminOrManager,
    async (req: Request, res: Response) => {
      const orgId = req.session.orgId!;
      const id = req.params.id;
      if (!id || typeof id !== "string") {
        return res.status(400).json({ message: "Invalid import id" });
      }

      const [row] = await db
        .select()
        .from(contactImports)
        .where(
          and(
            eq(contactImports.id, id),
            eq(contactImports.orgId, orgId),
          ),
        )
        .limit(1);

      if (!row) {
        return res.status(404).json({ message: "Import not found" });
      }

      const errors = Array.isArray(row.errorsJson)
        ? (row.errorsJson as Array<{ rowIndex: number; message: string }>)
        : [];

      // Skipped is derived: anything we've already processed that wasn't
      // imported and wasn't an error must have been a duplicate-skip.
      const processed = row.progressCount;
      const imported = row.successCount;
      const updated = row.updatedCount;
      const created = Math.max(0, imported - updated);
      const errorCount = row.errorCount;
      const skipped = Math.max(0, processed - imported - errorCount);
      const tagged = row.taggedCount;

      return res.json({
        importId: row.id,
        fileName: row.fileName,
        status: row.status,
        rowCount: row.rowCount,
        progressCount: processed,
        imported,
        created,
        updated,
        skipped,
        tagged,
        errorCount,
        errors,
      });
    },
  );
}
