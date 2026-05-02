/**
 * Sprint 2e — Saved Segments API.
 *
 * A segment is a named, brand-scoped contact filter snapshot. Members are
 * computed on read (no member join table). Filter shape is strict:
 * `{ tagIds: uuid[], search: string }`. Only `name` and `filter` are
 * mutable — orgId, brandId, id, createdAt, updatedAt are immutable and
 * any attempt to PATCH them yields 400 with `invalidFields` *before* the
 * route reaches storage.
 */
import type { Express, Request, Response, RequestHandler } from "express";
import { z } from "zod";
import { storage } from "../../storage";
import { requireAuth, requireAdminOrManager, sanitizeErrorMessage } from "../middleware";
import { requireFeature } from "../../services/entitlements";
import { paramId } from "../../lib/req-params";
import {
  insertContactSegmentSchema,
  contactSegmentFilterSchema,
} from "@shared/schema";

// Sprint 2i.2: entitlement gate replaces the env-flag gate.
const flagGate: RequestHandler = requireFeature("marketing_os");

async function assertBrandOwned(brandId: string, orgId: string): Promise<void> {
  const brand = await storage.getBrand(brandId, orgId);
  if (!brand) throw new Error("Invalid brand for this organization");
}

const NAME = z.string().trim().min(1).max(80);

// Sprint 2e: derive create body from the shared insert schema. orgId comes
// from the session, name is trimmed/length-capped, filter uses the strict
// sub-schema (unknown keys → 400).
const createBody = insertContactSegmentSchema
  .omit({ orgId: true })
  .extend({
    name:   NAME,
    filter: contactSegmentFilterSchema,
  });

// Sprint 2e PATCH lock (redline #1): only `name` and `filter` are mutable.
// Anything else — orgId, brandId, id, createdAt, updatedAt, or any unknown
// key — is rejected with 400 + `invalidFields` before any DB read.
// Mirroring redline #4: name still trimmed/length-capped on PATCH.
const PATCHABLE_KEYS = new Set(["name", "filter"]);
const updateBody = z.object({
  name:   NAME.optional(),
  filter: contactSegmentFilterSchema.optional(),
}).strict().refine(
  (p) => Object.keys(p).length > 0,
  { message: "patch must include at least one of name or filter" },
);

function errMsg(err: unknown): string {
  return sanitizeErrorMessage(err instanceof Error ? err : new Error(String(err)));
}

function isUniqueViolation(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return /duplicate key|unique/i.test(m);
}

/**
 * Validate cross-brand tag references inside a segment filter. Returns the
 * list of tag ids that don't belong to (orgId, brandId), or [] when clean.
 */
async function findInvalidFilterTagIds(
  orgId: string,
  brandId: string,
  filter: { tagIds: string[] },
): Promise<string[]> {
  if (!filter.tagIds || filter.tagIds.length === 0) return [];
  return storage.findInvalidTagIds(orgId, brandId, filter.tagIds);
}

export function registerContactSegmentRoutes(app: Express) {
  // ── List segments + per-segment computed contactCount ─────────────────
  app.get("/api/marketing/segments", flagGate, requireAdminOrManager, async (req: Request, res: Response) => {
    try {
      const brandId = z.string().uuid().parse(req.query.brandId);
      const rows = await storage.listSegmentsByBrandWithCounts(req.session.orgId!, brandId);
      return res.json(rows);
    } catch (err: unknown) {
      return res.status(400).json({ message: errMsg(err) });
    }
  });

  // ── Single segment by id ─────────────────────────────────────────────
  app.get("/api/marketing/segments/:id", flagGate, requireAdminOrManager, async (req: Request, res: Response) => {
    try {
      const id = paramId(req);
      const seg = await storage.getSegment(id, req.session.orgId!);
      if (!seg) return res.status(404).json({ message: "Segment not found" });
      return res.json(seg);
    } catch (err: unknown) {
      return res.status(400).json({ message: errMsg(err) });
    }
  });

  // ── Resolved members of a segment (computed on read) ─────────────────
  app.get("/api/marketing/segments/:id/contacts", flagGate, requireAdminOrManager, async (req: Request, res: Response) => {
    try {
      const id = paramId(req);
      const orgId = req.session.orgId!;
      const seg = await storage.getSegment(id, orgId);
      if (!seg) return res.status(404).json({ message: "Segment not found" });
      const rawFilter = (seg.filter ?? {}) as Record<string, unknown>;
      const parsed = contactSegmentFilterSchema.safeParse({
        tagIds: rawFilter.tagIds ?? [],
        search: rawFilter.search ?? "",
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Stored filter is invalid", details: parsed.error.flatten() });
      }
      const limit  = Math.min(Math.max(Number(req.query.limit  ?? 50), 1), 200);
      const offset = Math.max(Number(req.query.offset ?? 0), 0);
      const rows = await storage.resolveSegmentProspects(orgId, seg.brandId, parsed.data, { limit, offset });
      return res.json(rows);
    } catch (err: unknown) {
      return res.status(400).json({ message: errMsg(err) });
    }
  });

  // ── Create segment ───────────────────────────────────────────────────
  app.post("/api/marketing/segments", flagGate, requireAdminOrManager, async (req: Request, res: Response) => {
    try {
      const parsed = createBody.parse(req.body);
      const orgId = req.session.orgId!;
      await assertBrandOwned(parsed.brandId, orgId);
      const invalid = await findInvalidFilterTagIds(orgId, parsed.brandId, parsed.filter);
      if (invalid.length > 0) {
        return res.status(400).json({
          message: "Cross-brand or unknown tag id(s) in filter",
          invalidTagIds: invalid,
        });
      }
      const created = await storage.createSegment({
        orgId,
        brandId: parsed.brandId,
        name: parsed.name,
        filter: parsed.filter,
      });
      return res.status(201).json(created);
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        return res.status(409).json({ message: "A segment with that name already exists for this brand" });
      }
      return res.status(400).json({ message: errMsg(err) });
    }
  });

  // ── Update segment (name and/or filter only) ─────────────────────────
  app.patch("/api/marketing/segments/:id", flagGate, requireAdminOrManager, async (req: Request, res: Response) => {
    try {
      const id = paramId(req);
      const orgId = req.session.orgId!;

      // Sprint 2e redline #1: enforce immutable-keys lock BEFORE Zod parse so
      // we can return a precise `invalidFields` list to the client.
      const body = (req.body ?? {}) as Record<string, unknown>;
      const invalidFields = Object.keys(body).filter((k) => !PATCHABLE_KEYS.has(k));
      if (invalidFields.length > 0) {
        return res.status(400).json({
          message: "Only `name` and `filter` may be updated",
          invalidFields,
        });
      }

      const parsed = updateBody.parse(body);

      // Resolve the segment so we can validate filter.tagIds against its
      // brand. brandId itself is not patchable, so we use the stored value.
      const existing = await storage.getSegment(id, orgId);
      if (!existing) return res.status(404).json({ message: "Segment not found" });

      if (parsed.filter) {
        const invalid = await findInvalidFilterTagIds(orgId, existing.brandId, parsed.filter);
        if (invalid.length > 0) {
          return res.status(400).json({
            message: "Cross-brand or unknown tag id(s) in filter",
            invalidTagIds: invalid,
          });
        }
      }

      const updated = await storage.updateSegment(id, orgId, parsed);
      if (!updated) return res.status(404).json({ message: "Segment not found" });
      return res.json(updated);
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        return res.status(409).json({ message: "A segment with that name already exists for this brand" });
      }
      return res.status(400).json({ message: errMsg(err) });
    }
  });

  // ── Delete segment ───────────────────────────────────────────────────
  app.delete("/api/marketing/segments/:id", flagGate, requireAdminOrManager, async (req: Request, res: Response) => {
    try {
      const id = paramId(req);
      const ok = await storage.deleteSegment(id, req.session.orgId!);
      if (!ok) return res.status(404).json({ message: "Segment not found" });
      return res.json({ ok: true });
    } catch (err: unknown) {
      return res.status(400).json({ message: errMsg(err) });
    }
  });
}
