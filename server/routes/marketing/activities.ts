/**
 * Sprint 2f — Marketing OS contact-activity routes.
 *
 * Three endpoints, all flag-gated and tenant-scoped:
 *
 *   POST   /api/marketing/activities          (admin) manual log entry
 *   GET    /api/marketing/activities          (auth)  brand-scoped firehose
 *   DELETE /api/marketing/activities/:id      (admin) hard-delete
 *
 * Strict separation of manual vs. system writes (R7): the POST surface
 * accepts ONLY the four manual variants in `insertContactActivityManualSchema`
 * (note / call / meeting / email_manual). System types
 * (`contact_created`, `tag_*`, `segment_*`, `imported`) are rejected with 400
 * to prevent audit-row spoofing — those are emitted single-tx by their
 * parent writes.
 *
 * The GET firehose REQUIRES `brandId` (R6) so cross-brand reads are
 * structurally impossible, and caps any `from..to` range at 365 days (R5)
 * before touching the database.
 */
import type { Express, Request, Response, RequestHandler } from "express";
import { z } from "zod";
import { storage } from "../../storage";
import { requireAuth, requireAdminOrManager, sanitizeErrorMessage } from "../middleware";
import { requireFeature } from "../../services/entitlements";
import {
  insertContactActivityManualSchema,
  CONTACT_ACTIVITY_SYSTEM_TYPES,
  CONTACT_ACTIVITY_TYPES,
} from "@shared/schema";

// Sprint 2i.2: entitlement gate replaces the env-flag gate.
const flagGate: RequestHandler = requireFeature("marketing_os");

function errMsg(err: unknown): string {
  return sanitizeErrorMessage(err instanceof Error ? err : new Error(String(err)));
}

const idParam = z.string().uuid();

// ── POST body ─────────────────────────────────────────────────────────
// Wrap the manual discriminated union so we can attach prospectId/brandId/
// occurredAt at the top level and keep the inner `payload` strictly
// validated by the union variant.
const manualPostBody = z.object({
  prospectId: z.string().uuid(),
  brandId:    z.string().uuid(),
  occurredAt: z.string().datetime().optional(),
}).and(insertContactActivityManualSchema);

// ── GET filters ───────────────────────────────────────────────────────
const FIREHOSE_MAX_RANGE_MS = 365 * 24 * 60 * 60 * 1000;

const firehoseQuery = z.object({
  brandId:    z.string().uuid(),                       // R6: REQUIRED
  prospectId: z.string().uuid().optional(),
  // 5b3-ALIAS-REMOVAL-PENDING: query-param alias, drop in 5b3.
  // Legacy `contactId=` query param is still accepted and mapped onto
  // prospectId at read time. Frontend has been flipped to prospectId.
  contactId:  z.string().uuid().optional(),
  // Comma-separated list of activity types — both manual and system are
  // valid filters because the firehose is a read surface.
  types:      z.string().optional(),
  from:       z.string().datetime().optional(),
  to:         z.string().datetime().optional(),
  limit:      z.coerce.number().int().min(1).max(200).optional(),
  offset:     z.coerce.number().int().min(0).optional(),
});

export function registerMarketingActivityRoutes(app: Express) {
  // ── POST /api/marketing/activities ─────────────────────────────────
  // Manual log entry. Admin-only. Validates against the manual union;
  // system types are rejected with 400 (defense-in-depth — the union
  // wouldn't match them anyway, but we surface a clearer error).
  app.post(
    "/api/marketing/activities",
    flagGate,
    requireAdminOrManager,
    async (req: Request, res: Response) => {
      try {
        // Pre-flight: explicit system-type rejection with a useful message.
        const rawType = (req.body && typeof req.body === "object")
          ? (req.body as Record<string, unknown>).type
          : undefined;
        if (typeof rawType === "string" &&
            (CONTACT_ACTIVITY_SYSTEM_TYPES as readonly string[]).includes(rawType)) {
          return res.status(400).json({
            message: `System activity type '${rawType}' cannot be created via the public API`,
          });
        }

        const parsed = manualPostBody.parse(req.body);
        const orgId = req.session.orgId!;

        // Verify brand belongs to org.
        const brand = await storage.getBrand(parsed.brandId, orgId);
        if (!brand) return res.status(400).json({ message: "Invalid brand for this organization" });

        // Verify prospect belongs to (org, brand) — rejects cross-brand at the
        // boundary so the firehose can never surface mis-attributed rows.
        const prospect = await storage.getProspect(parsed.prospectId, orgId);
        if (!prospect) return res.status(404).json({ message: "Prospect not found" });
        if (prospect.brandId && prospect.brandId !== parsed.brandId) {
          return res.status(400).json({ message: "Prospect does not belong to the supplied brand" });
        }

        // occurredAt bounds: reject >5min in future or >5yr in past so the
        // firehose ordering stays sane and accidental year-typos surface.
        let occurredAt = new Date();
        if (parsed.occurredAt) {
          const t = new Date(parsed.occurredAt);
          if (Number.isNaN(t.getTime())) {
            return res.status(400).json({ message: "Invalid occurredAt" });
          }
          const now = Date.now();
          if (t.getTime() - now > 5 * 60 * 1000) {
            return res.status(400).json({ message: "occurredAt cannot be more than 5 minutes in the future" });
          }
          if (now - t.getTime() > 5 * 365 * 24 * 60 * 60 * 1000) {
            return res.status(400).json({ message: "occurredAt cannot be more than 5 years in the past" });
          }
          occurredAt = t;
        }

        const created = await storage.createActivity({
          orgId,
          brandId: parsed.brandId,
          prospectId: parsed.prospectId,
          type: parsed.type,
          payload: parsed.payload,
          actorId: req.session.userId ?? null,
          occurredAt,
        });
        return res.status(201).json(created);
      } catch (err: unknown) {
        return res.status(400).json({ message: errMsg(err) });
      }
    },
  );

  // ── GET /api/marketing/activities ──────────────────────────────────
  // Brand-scoped firehose. brandId REQUIRED (R6). Optional types/contactId/
  // from/to filters. 365-day range cap (R5) enforced BEFORE the DB read.
  app.get(
    "/api/marketing/activities",
    flagGate,
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const q = firehoseQuery.parse(req.query);
        const orgId = req.session.orgId!;

        // Verify brand belongs to org so the firehose cannot leak across orgs.
        const brand = await storage.getBrand(q.brandId, orgId);
        if (!brand) return res.status(400).json({ message: "Invalid brand for this organization" });

        // Parse + range-cap the date window.
        let from: Date | undefined;
        let to: Date | undefined;
        if (q.from) {
          const t = new Date(q.from);
          if (Number.isNaN(t.getTime())) return res.status(400).json({ message: "Invalid from" });
          from = t;
        }
        if (q.to) {
          const t = new Date(q.to);
          if (Number.isNaN(t.getTime())) return res.status(400).json({ message: "Invalid to" });
          to = t;
        }
        if (from && to && to.getTime() - from.getTime() > FIREHOSE_MAX_RANGE_MS) {
          return res.status(400).json({
            message: "Date range exceeds 365-day cap",
          });
        }

        // Validate types against the read-time superset so unknown values
        // surface as 400 instead of silently filtering to nothing.
        let types: string[] | undefined;
        if (q.types) {
          const parsed = q.types.split(",").map((s) => s.trim()).filter(Boolean);
          const ok = parsed.every((t) => (CONTACT_ACTIVITY_TYPES as readonly string[]).includes(t));
          if (!ok) return res.status(400).json({ message: "Unknown activity type in filter" });
          types = parsed;
        }

        const rows = await storage.listActivities(orgId, q.brandId, {
          types,
          // 5b3-ALIAS-REMOVAL-PENDING: contactId fallback maps to prospectId.
          contactId: q.prospectId ?? q.contactId,
          from,
          to,
          limit: q.limit,
          offset: q.offset,
        });
        return res.json(rows);
      } catch (err: unknown) {
        return res.status(400).json({ message: errMsg(err) });
      }
    },
  );

  // ── DELETE /api/marketing/activities/:id ───────────────────────────
  // Admin-only hard delete. The frontend wraps the trigger in an
  // AlertDialog (R10) so the user has to confirm before the request fires.
  app.delete(
    "/api/marketing/activities/:id",
    flagGate,
    requireAdminOrManager,
    async (req: Request, res: Response) => {
      try {
        const id = idParam.parse(req.params.id);
        const deleted = await storage.deleteActivity(req.session.orgId!, id);
        if (!deleted) return res.status(404).json({ message: "Activity not found" });
        return res.json({ ok: true, id: deleted.id });
      } catch (err: unknown) {
        return res.status(400).json({ message: errMsg(err) });
      }
    },
  );
}
